// MiniRushTrackerV2 stress test — Celo mainnet.
//
// Creates N throwaway wallets, funds each from the deployer, then fires a
// concurrent burst of recordRace() txs from every wallet at once to stress the
// contract. Leftover CELO is swept back to the deployer at the end.
//
// Wallet keys are written to scripts/.stress-wallets.json (gitignored) so the
// run is recoverable if it dies mid-flight.
//
//   node scripts/stress.mjs           # full run: fund -> burst -> sweep
//   node scripts/stress.mjs sweep     # sweep existing wallets back only
//   WALLETS=16 TOTAL_TXS=28 node scripts/stress.mjs
//
// Real funds. Reads DEPLOYER_PRIVATE_KEY + VITE_TRACKER_V2_ADDRESS from .env.local.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createPublicClient, createWalletClient, http, encodeFunctionData,
  formatEther, parseEther,
} from 'viem';
import { celo } from 'viem/chains';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const KEYS_FILE = join(HERE, '.stress-wallets.json');

// ---- knobs -----------------------------------------------------------------
const WALLETS = Number(process.env.WALLETS ?? 29);
const TOTAL_TXS = process.env.TOTAL_TXS ? Number(process.env.TOTAL_TXS) : null;
const RACES_PER_WALLET = Number(process.env.RACES ?? 3);
// Fund must cover RACES x (GAS_LIMIT x gasPrice) reserved up front, + sweep gas.
// By default this is calculated from the current buffered gas price. Set FUND
// to override it, for example FUND=0.10.
const FUND_PER_WALLET_OVERRIDE = process.env.FUND ? parseEther(process.env.FUND) : null;
const GAS_LIMIT = BigInt(process.env.GAS_LIMIT ?? 110_000); // ~90k first call, ~65k after; headroom
const GAS_PRICE_BUFFER_BPS = 12_500n;        // 1.25x current gasPrice
const RPC = 'https://forno.celo.org';
const V2_ABI = [{
  type: 'function', name: 'recordRace', stateMutability: 'nonpayable',
  inputs: [{ type: 'uint32' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint16' }], outputs: [],
}, {
  type: 'function', name: 'totalRaces', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }],
}, {
  type: 'function', name: 'totalPlayers', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }],
}];
// ----------------------------------------------------------------------------

function loadEnv() {
  const raw = readFileSync(join(ROOT, '.env.local'), 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return env;
}

const env = loadEnv();
const DEPLOYER_PK = env.DEPLOYER_PRIVATE_KEY.startsWith('0x') ? env.DEPLOYER_PRIVATE_KEY : `0x${env.DEPLOYER_PRIVATE_KEY}`;
const V2 = env.VITE_TRACKER_V2_ADDRESS;
if (!V2 || !/^0x[0-9a-fA-F]{40}$/.test(V2)) throw new Error(`bad V2 address: ${V2}`);

const deployer = privateKeyToAccount(DEPLOYER_PK);
const pub = createPublicClient({ chain: celo, transport: http(RPC) });
const deployerWallet = createWalletClient({ account: deployer, chain: celo, transport: http(RPC) });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const celoStr = (wei) => `${Number(formatEther(wei)).toFixed(5)} CELO`;

async function gasPrice() {
  const gp = await pub.getGasPrice();
  return (gp * GAS_PRICE_BUFFER_BPS) / 10_000n;
}

function plannedTxCount(walletCount) {
  return TOTAL_TXS ?? (walletCount * RACES_PER_WALLET);
}

function racesForWallet(walletIndex, walletCount) {
  if (TOTAL_TXS === null) return RACES_PER_WALLET;

  const base = Math.floor(TOTAL_TXS / walletCount);
  const remainder = TOTAL_TXS % walletCount;
  return base + (walletIndex < remainder ? 1 : 0);
}

function maxRacesPerWallet(walletCount) {
  if (TOTAL_TXS === null) return RACES_PER_WALLET;
  return Math.ceil(TOTAL_TXS / walletCount);
}

function fundPerWallet(gp, walletCount) {
  if (FUND_PER_WALLET_OVERRIDE !== null) return FUND_PER_WALLET_OVERRIDE;
  const maxRaceGas = GAS_LIMIT * BigInt(maxRacesPerWallet(walletCount));
  const sweepGas = 21_000n;
  return ((maxRaceGas + sweepGas) * gp * 11n) / 10n;
}

function assertPositiveInteger(name, value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, got ${value}`);
  }
}

function newWallet() {
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  return { pk, address: account.address, account };
}

function saveWallets(wallets) {
  writeFileSync(KEYS_FILE, JSON.stringify(wallets.map(({ pk, address }) => ({ pk, address })), null, 2));
}

function loadOrCreateWallets(targetCount = WALLETS) {
  if (existsSync(KEYS_FILE)) {
    const saved = JSON.parse(readFileSync(KEYS_FILE, 'utf8'));
    const wallets = saved.map((w) => ({ ...w, account: privateKeyToAccount(w.pk) }));
    if (targetCount === null) {
      console.log(`Reusing all ${wallets.length} existing wallets from ${KEYS_FILE}`);
      return wallets;
    }
    if (wallets.length < targetCount) {
      const missing = targetCount - wallets.length;
      for (let i = 0; i < missing; i++) wallets.push(newWallet());
      saveWallets(wallets);
      console.log(`Reusing ${saved.length} existing wallets and added ${missing} new wallets -> ${KEYS_FILE}`);
      return wallets;
    }
    if (wallets.length > targetCount) {
      console.log(`Reusing first ${targetCount}/${wallets.length} existing wallets from ${KEYS_FILE}`);
      return wallets.slice(0, targetCount);
    }
    console.log(`Reusing ${wallets.length} existing wallets from ${KEYS_FILE}`);
    return wallets;
  }
  if (targetCount === null) {
    console.log(`No existing wallets at ${KEYS_FILE}`);
    return [];
  }
  const wallets = [];
  for (let i = 0; i < targetCount; i++) wallets.push(newWallet());
  saveWallets(wallets);
  console.log(`Created ${wallets.length} wallets -> ${KEYS_FILE}`);
  return wallets;
}

// Send many txs from one account with explicit sequential nonces, no waiting
// between sends (the burst). Returns array of {hash} or {error}.
async function fireBurst(account, txs, startNonce, gp) {
  const wallet = createWalletClient({ account, chain: celo, transport: http(RPC) });
  const results = await Promise.allSettled(
    txs.map((t, i) => wallet.sendTransaction({
      to: t.to, data: t.data, value: t.value ?? 0n,
      nonce: startNonce + i, gas: t.gas ?? GAS_LIMIT, gasPrice: gp,
    })),
  );
  return results.map((r) => (r.status === 'fulfilled' ? { hash: r.value } : { error: r.reason?.shortMessage || String(r.reason) }));
}

async function waitAll(hashes, label) {
  let ok = 0, fail = 0, gasUsed = 0n;
  const receipts = await Promise.allSettled(hashes.map((h) => pub.waitForTransactionReceipt({ hash: h, timeout: 180_000 })));
  for (const r of receipts) {
    if (r.status === 'fulfilled' && r.value.status === 'success') { ok++; gasUsed += r.value.gasUsed; }
    else fail++;
  }
  console.log(`  ${label}: ${ok} ok, ${fail} failed, gasUsed ${gasUsed}`);
  return { ok, fail, gasUsed };
}

async function fundPhase(wallets, gp) {
  const bal = await pub.getBalance({ address: deployer.address });
  const perWallet = fundPerWallet(gp, wallets.length);
  const fundingNeeded = perWallet * BigInt(wallets.length);
  const fundingGasNeeded = 21_000n * gp * BigInt(wallets.length);
  const reserve = parseEther('0.05');
  const needed = fundingNeeded + fundingGasNeeded + reserve;
  console.log(`\n== FUND ==\nDeployer ${deployer.address} balance ${celoStr(bal)}; funding ${wallets.length} x ${celoStr(perWallet)} = ${celoStr(fundingNeeded)}`);
  console.log(`  deployer funding tx gas: ~${celoStr(fundingGasNeeded)}; reserve: ${celoStr(reserve)}; needed: ~${celoStr(needed)}`);
  if (bal < needed) throw new Error(`deployer balance too low: need ~${celoStr(needed)}, have ${celoStr(bal)}`);
  const startNonce = await pub.getTransactionCount({ address: deployer.address, blockTag: 'pending' });
  const txs = wallets.map((w) => ({ to: w.address, value: perWallet, gas: 21_000n }));
  const sent = await fireBurst(deployer, txs, startNonce, gp);
  const hashes = sent.filter((s) => s.hash).map((s) => s.hash);
  sent.forEach((s, i) => { if (s.error) console.log(`  fund ${wallets[i].address} FAILED to send: ${s.error}`); });
  await waitAll(hashes, 'funding');
}

async function racePhase(wallets, gp) {
  const totalTxs = plannedTxCount(wallets.length);
  const maxPerWallet = maxRacesPerWallet(wallets.length);
  console.log(`\n== RACE BURST ==\n${wallets.length} wallets -> ${totalTxs} recordRace txs total${TOTAL_TXS === null ? ` (${RACES_PER_WALLET} each)` : ` (up to ${maxPerWallet} per wallet)`}, concurrent`);
  const before = await pub.readContract({ address: V2, abi: V2_ABI, functionName: 'totalRaces' });
  // Prepare each wallet's burst, then launch all wallets at once.
  const bursts = await Promise.all(wallets.map(async (w, index) => {
    const txCount = racesForWallet(index, wallets.length);
    if (txCount === 0) return null;
    const nonce = await pub.getTransactionCount({ address: w.address, blockTag: 'pending' });
    const txs = Array.from({ length: txCount }, () => ({
      to: V2,
      data: encodeFunctionData({
        abi: V2_ABI, functionName: 'recordRace',
        args: [
          Math.floor(1000 + Math.random() * 14000), // score
          1 + Math.floor(Math.random() * 8),         // place
          Math.floor(Math.random() * 3),             // mapId (3 cities)
          Math.floor(Math.random() * 3),             // modeId (3 modes)
        ],
      }),
    }));
    return { w, nonce, txs };
  }));
  const activeBursts = bursts.filter(Boolean);
  const t0 = Date.now();
  const allSent = await Promise.all(activeBursts.map((b) => fireBurst(b.w.account, b.txs, b.nonce, gp)));
  const submitMs = Date.now() - t0;
  const hashes = [];
  allSent.flat().forEach((s) => { if (s.hash) hashes.push(s.hash); else console.log(`  send FAILED: ${s.error}`); });
  console.log(`  submitted ${hashes.length}/${totalTxs} txs in ${submitMs}ms`);
  const res = await waitAll(hashes, 'races');
  const after = await pub.readContract({ address: V2, abi: V2_ABI, functionName: 'totalRaces' });
  const players = await pub.readContract({ address: V2, abi: V2_ABI, functionName: 'totalPlayers' });
  console.log(`  V2 totalRaces ${before} -> ${after} (+${after - before}); totalPlayers now ${players}`);
  return res;
}

async function sweepPhase(wallets, gp) {
  console.log(`\n== SWEEP back to deployer ==`);
  const gasCost = 21_000n * gp;
  let recovered = 0n;
  const hashes = [];
  for (const w of wallets) {
    const bal = await pub.getBalance({ address: w.address });
    if (bal <= gasCost) { console.log(`  ${w.address}: ${celoStr(bal)} — nothing to sweep`); continue; }
    const value = bal - gasCost;
    const wallet = createWalletClient({ account: w.account, chain: celo, transport: http(RPC) });
    try {
      const nonce = await pub.getTransactionCount({ address: w.address, blockTag: 'pending' });
      const hash = await wallet.sendTransaction({ to: deployer.address, value, gas: 21_000n, gasPrice: gp, nonce });
      hashes.push(hash); recovered += value;
      console.log(`  ${w.address}: sweeping ${celoStr(value)} (${hash})`);
    } catch (e) { console.log(`  ${w.address}: sweep failed — ${e.shortMessage || e.message}`); }
  }
  await waitAll(hashes, 'sweep');
  console.log(`  recovered ~${celoStr(recovered)} to deployer`);
}

async function main() {
  assertPositiveInteger('WALLETS', WALLETS);
  if (TOTAL_TXS === null) assertPositiveInteger('RACES', RACES_PER_WALLET);
  else assertPositiveInteger('TOTAL_TXS', TOTAL_TXS);

  const mode = process.argv[2];
  const gp = await gasPrice();
  console.log(`Chain: Celo mainnet | V2: ${V2} | gasPrice(buffered): ${celoStr(gp * 1_000_000_000n)}/Ggas | wallets: ${WALLETS} | planned txs: ${TOTAL_TXS ?? `${RACES_PER_WALLET} per wallet`}`);
  const wallets = mode === 'sweep' ? loadOrCreateWallets(null) : loadOrCreateWallets();

  if (mode === 'sweep') { await sweepPhase(wallets, gp); return; }
  if (mode === 'fund') { await fundPhase(wallets, gp); return; }
  if (mode === 'race') { await racePhase(wallets, gp); return; }

  await fundPhase(wallets, gp);
  await sleep(2000);
  await racePhase(wallets, gp);
  await sleep(2000);
  await sweepPhase(wallets, gp);

  const finalBal = await pub.getBalance({ address: deployer.address });
  console.log(`\nDone. Deployer final balance: ${celoStr(finalBal)}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
