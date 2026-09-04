import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createPublicClient, createWalletClient, http, encodeFunctionData,
  formatEther, parseEther,
} from 'viem';
import { celo } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const ENV_FILE = join(ROOT, '.env.local');
const KEYS_FILE = join(HERE, '.stress-wallets.json');

const TOTAL_TXS = 86;
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

function loadWallets() {
  if (existsSync(KEYS_FILE)) {
    const saved = JSON.parse(readFileSync(KEYS_FILE, 'utf8'));
    console.log(`Loaded ${saved.length} existing wallets from ${KEYS_FILE}`);
    return saved.map((w) => ({ ...w, account: privateKeyToAccount(w.pk) }));
  }
  throw new Error(`Could not find wallets file at ${KEYS_FILE}`);
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
  console.log(`\n== RACE (${TOTAL_TXS} total) ==\nUsing ${wallets.length} wallets for ${TOTAL_TXS} recordRace txs`);
  const before = await pub.readContract({ address: V2, abi: V2_ABI, functionName: 'totalRaces' });
  const playersBefore = await pub.readContract({ address: V2, abi: V2_ABI, functionName: 'totalPlayers' });
  
  const hashes = [];
  const nonces = {};
  for (const w of wallets) {
    nonces[w.address] = await pub.getTransactionCount({ address: w.address, blockTag: 'pending' });
  }

  for (let i = 0; i < TOTAL_TXS; i++) {
    const w = wallets[i % wallets.length];
    const wallet = createWalletClient({ account: w.account, chain: celo, transport: http(RPC) });
    const nonce = nonces[w.address]++;
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
    console.log(`  ${w.address}: recordRace (${hash}) (nonce: ${nonce})`);
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
  const wallets = loadWallets();

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
