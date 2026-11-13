// Upgrade the garage contract in place: new code and `migrate_components` in one
// transaction, so the contract is never left running new code on old state.
// Rehearse first with scripts/near-upgrade-rehearsal.mjs.
//
//   node scripts/near-upgrade.mjs            # show what would happen
//   node scripts/near-upgrade.mjs --send     # upgrade
//
// Signs as the garage account with NEAR_GAME_KEY, or with the near-cli key in
// ~/.near-credentials/<network>/<garage>.json.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { Account, actions } from 'near-api-js';

const GARAGE = process.env.NEAR_GARAGE ?? 'minirush-garage.testnet';
const NETWORK = GARAGE.endsWith('.testnet') ? 'testnet' : 'mainnet';
const RPC = process.env.NEAR_RPC ?? (NETWORK === 'testnet' ? 'https://test.rpc.fastnear.com' : 'https://free.rpc.fastnear.com');
const file = path.join(homedir(), '.near-credentials', NETWORK, `${GARAGE}.json`);
const key = process.env.NEAR_GAME_KEY ?? await readFile(file, 'utf8').then(text => JSON.parse(text).private_key).catch(() => null);
if (!key) { console.error(`No key for ${GARAGE}. Set NEAR_GAME_KEY or add ${file}.`); process.exit(1); }
const garage = new Account(GARAGE, RPC, key);
const view = (method, args = {}) => garage.provider.callFunction({ contractId: GARAGE, method, args });
/** What must be identical after the upgrade: supply, dealers, every stall, and what the dealers hold. */
const snapshot = async () => {
  const dealers = await view('dealers');
  return JSON.stringify({ dealers, tokens: await view('tokens'), listings: (await view('listings')).map(l => [l.token_id, l.dealer, l.price, l.stock, l.sold]),
    supply: await view('mt_batch_supply', { token_ids: ['rush', 'material:alloy', 'material:circuit'] }),
    tills: await Promise.all(dealers.map(d => view('mt_balance_of', { account_id: d, token_id: 'rush' }))) });
};
const code = await readFile(new URL('../contracts/near/target/near/minirush_garage.wasm', import.meta.url));
const state = await garage.getState();
const needed = BigInt(state.storageUsage + code.length) * 10n ** 19n; // upper bound: old code still counted
console.log(`${GARAGE}: ${Number(state.balance.total / 10n ** 21n) / 1000} NEAR, ${state.storageUsage} bytes stored`);
console.log(`new build: ${code.length} bytes, sha256 ${createHash('sha256').update(code).digest('hex').slice(0, 16)}…`);
assert.ok(state.balance.total > needed + 10n ** 23n, `not enough NEAR to store the new code (needs about ${Number(needed / 10n ** 21n) / 1000})`);
if (await view('editions').then(() => true, () => false)) { console.log('Already upgraded: the editions view exists. Nothing to do.'); process.exit(0); }
const before = await snapshot();
console.log(`before: ${JSON.parse(before).listings.length} stalls, supply ${JSON.parse(before).supply}`);
if (!process.argv.includes('--send')) { console.log('Dry run. Add --send to upgrade.'); process.exit(0); }
const res = await garage.signAndSendTransaction({ receiverId: GARAGE,
  actions: [actions.deployContract(code), actions.functionCall('migrate_components', {}, 100_000_000_000_000n, 0n)] });
console.log(`upgraded: ${res.transaction.hash}`);
await new Promise(r => setTimeout(r, 6000));
assert.equal(await snapshot(), before, 'supply, dealers and stalls are unchanged by the upgrade');
assert.equal((await view('component_recipes')).length, 12); assert.deepEqual(await view('editions'), []);
console.log('PASS: old state is intact; parts and editions are live.');
