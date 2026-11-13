// Rehearses the garage upgrade and the NEAR-paid edition flow on a THROWAWAY
// testnet account, so the real garage is never the first place either runs.
//
//   node scripts/near-upgrade-rehearsal.mjs <throwaway>.testnet --testnet
//
// It copies the code the live garage runs today onto the throwaway account,
// gives it some state, upgrades it with the local build exactly as the real
// upgrade would, then buys and resells an edition car through relayed calls.
// The live garage is only read (its code), never written.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { Account, KeyPair, actions } from 'near-api-js';

const [target] = process.argv.slice(2).filter(a => !a.startsWith('-'));
const LIVE = 'minirush-garage.testnet', RPC = process.env.NEAR_RPC ?? 'https://test.rpc.fastnear.com';
if (!process.argv.includes('--testnet') || !target?.endsWith('.testnet')) throw new Error('Usage: near-upgrade-rehearsal.mjs <throwaway>.testnet --testnet');
if (target === LIVE || target.endsWith(`.${LIVE}`)) throw new Error('Refusing to rehearse on the live garage. Use a throwaway account.');

const NEAR = 10n ** 24n, TGAS = 10n ** 12n, near = y => (Number(y / 10n ** 18n) / 1e6).toFixed(4);
const rpc = async params => {
  const res = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params }) });
  const body = await res.json(); if (body.error || body.result?.error) throw new Error(JSON.stringify(body.error ?? body.result.error)); return body.result;
};
const { private_key } = JSON.parse(await readFile(path.join(homedir(), '.near-credentials', 'testnet', `${target}.json`), 'utf8'));
const game = new Account(target, RPC, private_key);
const view = (method, args = {}) => game.provider.callFunction({ contractId: target, method, args });
const total = async id => BigInt((await rpc({ request_type: 'view_account', finality: 'optimistic', account_id: id })).amount);
const call = (method, args, deposit = 0n, gas = 70n) => actions.functionCall(method, args, gas * TGAS, deposit);
const settle = () => new Promise(r => setTimeout(r, 5000)); // let state reads catch up with the last transaction
const step = (text, tx) => console.log(`✓ ${text}${tx ? `  https://testnet.nearblocks.io/txns/${tx.transaction.hash}` : ''}`);

// 1. Start from the code the live garage runs, with some state worth preserving.
const state = await rpc({ request_type: 'view_account', finality: 'final', account_id: target });
if (state.code_hash === '11111111111111111111111111111111') {
  const liveCode = Buffer.from((await rpc({ request_type: 'view_code', finality: 'final', account_id: LIVE })).code_base64, 'base64');
  step(`live garage code copied (${liveCode.length} bytes)`, await game.signAndSendTransaction({ receiverId: target, actions: [
    actions.deployContract(liveCode), call('new', { owner_id: target }, 0n, 30n),
    call('register_token', { token_id: 'car:viper', kind: 'car', name: 'VIPER GT' }, 0n, 20n),
    call('mint', { receiver_id: target, token_id: 'rush', amount: '500', memo: 'rehearsal' }, 0n, 20n)] }));
  await settle();
}
const upgraded = await view('editions').then(() => true, () => false);
if (!upgraded) {
  // 2. The upgrade itself: new code and the migration in one transaction, as the real one will be.
  const code = await readFile(new URL('../contracts/near/target/near/minirush_garage.wasm', import.meta.url));
  step(`upgraded with the local build (${code.length} bytes) and migrated`, await game.signAndSendTransaction({ receiverId: target,
    actions: [actions.deployContract(code), call('migrate_components', {}, 0n, 100n)] }));
  await settle();
}
assert.equal(await view('mt_balance_of', { account_id: target, token_id: 'rush' }), '500', 'balances survive the upgrade');
assert.ok((await view('tokens')).some(([id]) => id === 'car:viper'), 'registered tokens survive the upgrade');
assert.equal((await view('component_recipes')).length, 12);
step('old balances and tokens are intact; parts and editions are live');

// 3. A limited run, two players with a little NEAR each.
const run = `run-${Date.now().toString(36)}`, price = NEAR / 5n, ask = NEAR / 4n;
step(`edition ${run} opened at ${near(price)} NEAR`, await game.signAndSendTransaction({ receiverId: target,
  actions: [call('create_edition', { id: run, name: 'REHEARSAL RUN', model: 'tourbillon', color: 0xffc531, price: price.toString(), size: 2, story: 'Upgrade rehearsal.' }, 0n, 30n)] }));
const player = async tag => {
  const key = KeyPair.fromRandom('ed25519'), id = `p${tag}${Date.now().toString(36)}.${target}`;
  await game.signAndSendTransaction({ receiverId: id, actions: [actions.createAccount(), actions.transfer(NEAR / 100n + 35n * NEAR / 100n), actions.addFullAccessKey(key.getPublicKey())] });
  return { id, account: new Account(id, RPC, key.toString()) };
};
const [ada, bo] = [await player('a'), await player('b')];
step(`players ${ada.id.split('.')[0]} and ${bo.id.split('.')[0]} created with 0.36 NEAR each`);
const failed = res => { const f = res.receipts_outcome.map(r => r.outcome.status.Failure).find(Boolean); if (f) throw new Error(JSON.stringify(f)); return res; };
// Free calls are relayed: the player signs, the game pays the gas.
const relay = async (p, method, args) => {
  const { signedDelegate } = await p.account.createSignedMetaTransaction({ receiverId: target, actions: [call(method, args)] });
  // The outer transaction succeeds even when the player's call fails, so read every receipt, as the game's relay does.
  return failed(await game.signAndSendTransaction({ receiverId: p.id, actions: [actions.signedDelegate({ delegateAction: signedDelegate.delegateAction, signature: signedDelegate.signature })] }));
};
// Paid calls are sent by the player's garage itself. A relayed deposit is charged to the relayer
// (the first version of this rehearsal showed the buyer's balance unchanged), so they are never relayed.
const direct = async (p, method, args, deposit) => failed(await p.account.signAndSendTransaction({ receiverId: target, actions: [call(method, args, deposit, 30n)] }));
const delta = async (ids, work) => {
  const before = await Promise.all(ids.map(total)); const tx = await work(); await settle();
  const after = await Promise.all(ids.map(total)); return { tx, moved: after.map((a, i) => a - before[i]) };
};
const close = (actual, expected, what) => assert.ok((actual > expected ? actual - expected : expected - actual) < NEAR / 1000n, `${what}: ${near(actual)} NEAR, expected ${near(expected)}`);

const paidWithFee = (moved, price, what) => assert.ok(moved <= -price && moved > -price - NEAR / 100n, `${what}: ${near(moved)} NEAR for a ${near(price)} NEAR price`);

// 4. First sale: the buyer's garage pays the price and its own small fee; the game keeps the whole price.
await settle();
const underpaid = await direct(ada, 'buy_edition', { edition_id: run, max_price: price.toString() }, price / 2n).then(() => null, e => String(e?.message ?? e));
assert.match(underpaid ?? '', /attach the full price/, 'an underpaid purchase is rejected on chain');
await settle();
assert.equal((await view('editions')).find(e => e.id === run).minted, 0);
step('an underpaid purchase is rejected and mints nothing');
const sale = await delta([ada.id, target], () => direct(ada, 'buy_edition', { edition_id: run, max_price: price.toString() }, price));
paidWithFee(sale.moved[0], price, 'buyer paid the price plus a fee under 0.01 NEAR');
close(sale.moved[1], price, 'the game received the whole price and paid nothing');
const carId = `edition:${run}:1`;
assert.equal((await view('edition_car', { car_id: carId })).owner, ada.id);
step(`first sale: buyer ${near(sale.moved[0])} NEAR, game +${near(sale.moved[1])} NEAR`, sale.tx);

// 5. Resale between players: seller paid in the same call, 2% stays with the game.
const gameBefore = await total(target);
step(`${carId} listed for ${near(ask)} NEAR through the relay`, await relay(ada, 'list_edition_car', { car_id: carId, price: ask.toString() }));
await settle();
const listed = await view('edition_car', { car_id: carId });
const resale = await delta([bo.id, ada.id], () => direct(bo, 'buy_edition_car', { car_id: carId, offer: listed.offer, max_price: ask.toString() }, ask));
paidWithFee(resale.moved[0], ask, 'second buyer paid the asking price plus a fee under 0.01 NEAR');
close(resale.moved[1], ask - ask / 50n, 'seller received the price less the 2% royalty');
const token = await view('nft_token', { token_id: carId }), ledger = (await view('economy')).near.ledger;
assert.equal(token.owner_id, bo.id); assert.equal(token.metadata.title, 'REHEARSAL RUN #1 of 2');
assert.ok(BigInt(ledger.primary_volume) >= price && BigInt(ledger.resale_volume) >= ask && BigInt(ledger.royalties) >= ask / 50n);
close(await total(target) - gameBefore, ask / 50n, 'the game is up by the royalty, less the gas of one relayed listing');
step(`resale: buyer ${near(resale.moved[0])}, seller +${near(resale.moved[1])}, royalty ${near(ask / 50n)} NEAR kept`, resale.tx);
console.log(`PASS on ${target}: upgrade keeps old state; players pay for first sales and resales from their own garages, and the game's balance only ever goes up by what it earned.`);
