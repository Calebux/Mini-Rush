// One-off: 6 fresh wallets, fund each, 1 recordRace each, sweep back.
// Diagnostic for the totalRaces vs totalPlayers gap — 6 brand-new player
// addresses, one race apiece. Real funds on Celo mainnet.
//
// Keys are saved to this dir's stress6-wallets.json for recovery.
//   node stress6.mjs           # full: fund -> 1 race each -> sweep
//   node stress6.mjs sweep     # sweep existing wallets back only

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
const ENV_FILE = '/Users/nn/New game/.env.local';
const KEYS_FILE = '/private/tmp/claude-501/-Users-nn-New-game/a1b84a43-1077-4928-8d92-144383086141/scratchpad/stress6-wallets.json';

const WALLETS = 6;
const FUND_PER_WALLET = parseEther('0.05');
const GAS_LIMIT = 110_000n;
const GAS_PRICE_BUFFER_BPS = 12_500n;
const RPC = 'https://forno.celo.org';
const V2_ABI = [
  { type: 'function', name: 'recordRace', stateMutability: 'nonpayable',
    inputs: [{ type: 'uint32' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint16' }], outputs: [] },
  { type: 'function', name: 'totalRaces', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalPlayers', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];

function loadEnv() {
  const raw = readFileSync(ENV_FILE, 'utf8');
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

function loadOrCreateWallets() {
  if (existsSync(KEYS_FILE)) {
    const saved = JSON.parse(readFileSync(KEYS_FILE, 'utf8'));
    console.log(`Reusing ${saved.length} existing wallets from ${KEYS_FILE}`);
    return saved.map((w) => ({ ...w, account: privateKeyToAccount(w.pk) }));
  }
  const wallets = [];
  for (let i = 0; i < WALLETS; i++) {
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    wallets.push({ pk, address: account.address, account });
  }
  writeFileSync(KEYS_FILE, JSON.stringify(wallets.map(({ pk, address }) => ({ pk, address })), null, 2));
  console.log(`Created ${wallets.length} fresh wallets -> ${KEYS_FILE}`);
  return wallets;
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
  const needed = FUND_PER_WALLET * BigInt(wallets.length);
  console.log(`\n== FUND ==\nDeployer ${deployer.address} balance ${celoStr(bal)}; funding ${wallets.length} x ${celoStr(FUND_PER_WALLET)} = ${celoStr(needed)}`);
  if (bal < needed + parseEther('0.05')) throw new Error(`deployer balance too low for funding + gas`);
  const startNonce = await pub.getTransactionCount({ address: deployer.address, blockTag: 'pending' });
  const hashes = [];
  for (let i = 0; i < wallets.length; i++) {
    const hash = await deployerWallet.sendTransaction({
      to: wallets[i].address, value: FUND_PER_WALLET, gas: 21_000n, gasPrice: gp, nonce: startNonce + i,
    });
    hashes.push(hash);
  }
  await waitAll(hashes, 'funding');
}

async function racePhase(wallets, gp) {
  console.log(`\n== RACE (1 each) ==\n${wallets.length} fresh wallets x 1 recordRace = ${wallets.length} txs`);
  const before = await pub.readContract({ address: V2, abi: V2_ABI, functionName: 'totalRaces' });
  const playersBefore = await pub.readContract({ address: V2, abi: V2_ABI, functionName: 'totalPlayers' });
  const hashes = [];
  for (const w of wallets) {
    const wallet = createWalletClient({ account: w.account, chain: celo, transport: http(RPC) });
    const nonce = await pub.getTransactionCount({ address: w.address, blockTag: 'pending' });
    const data = encodeFunctionData({
      abi: V2_ABI, functionName: 'recordRace',
      args: [
        Math.floor(1000 + Math.random() * 14000), // score
        1 + Math.floor(Math.random() * 8),         // place
        Math.floor(Math.random() * 3),             // mapId
        Math.floor(Math.random() * 3),             // modeId
      ],
    });
    const hash = await wallet.sendTransaction({ to: V2, data, gas: GAS_LIMIT, gasPrice: gp, nonce });
    hashes.push(hash);
    console.log(`  ${w.address}: recordRace (${hash})`);
  }
  const res = await waitAll(hashes, 'races');
  const after = await pub.readContract({ address: V2, abi: V2_ABI, functionName: 'totalRaces' });
  const playersAfter = await pub.readContract({ address: V2, abi: V2_ABI, functionName: 'totalPlayers' });
  console.log(`  V2 totalRaces ${before} -> ${after} (+${after - before})`);
  console.log(`  V2 totalPlayers ${playersBefore} -> ${playersAfter} (+${playersAfter - playersBefore})`);
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
  const mode = process.argv[2];
  const gp = await gasPrice();
  console.log(`Chain: Celo mainnet | V2: ${V2} | gasPrice(buffered): ${celoStr(gp * 1_000_000_000n)}/Ggas`);
  const wallets = loadOrCreateWallets();

  if (mode === 'sweep') { await sweepPhase(wallets, gp); return; }

  await fundPhase(wallets, gp);
  await sleep(2000);
  await racePhase(wallets, gp);
  await sleep(2000);
  await sweepPhase(wallets, gp);

  const finalBal = await pub.getBalance({ address: deployer.address });
  console.log(`\nDone. Deployer final balance: ${celoStr(finalBal)}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
