// Limited editions in the Car Market, against an in-memory chain and backend.
// Isolated browser fixture: no transactions or backend writes leave this test.
// The contract's own accounting is tested in Rust (contracts/near/src/editions.rs).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import * as borsh from 'borsh';
import { SCHEMA, PublicKey } from 'near-api-js';

const base = process.argv[2] ?? 'http://127.0.0.1:5174';
const out = '/tmp/minirush-editions'; await mkdir(out, { recursive: true });
const NEAR = 10n ** 24n, me = 'preview.minirush-garage.testnet', rival = 'p0rival000001.minirush-garage.testnet';
const edition = { id: 'lagos-gold', name: 'LAGOS GOLD', model: 'tourbillon', color: 0xffc531, price: String(2n * NEAR), size: 50, minted: 6,
  story: 'Fifty cars for the first season. Numbered, and yours to resell.', created_ms: Date.now() };
const car = (serial, owner, price = null) => ({ id: `edition:lagos-gold:${serial}`, edition_id: 'lagos-gold', serial, owner, first_owner: owner,
  minted_ms: Date.now(), price, offer: price ? 10 + serial : 0, last_price: String(2n * NEAR), sales: 0 });
let cars = [car(3, rival, String(3n * NEAR / 2n))], revision = 40;
let garagePublicKey;
let balance = NEAR / 100n, grants = 0, offline = false;
const calls = [];

/** Applies one garage call to the in-memory chain. `via` is how it arrived: sent by the garage, or relayed by the game. */
function settle(call, via) {
  const args = JSON.parse(Buffer.from(call.args).toString()), deposit = BigInt(call.deposit);
  calls.push({ method: call.methodName, args, deposit, via });
  // A relayed deposit would be charged to the game, so paid calls must come from the garage and free ones from the relay.
  assert.equal(via, deposit > 0n ? 'garage' : 'relay', `${call.methodName} arrived by ${via}`);
  let value = null;
  if (call.methodName === 'buy_edition') {
    assert.equal(deposit, BigInt(edition.price), 'the full price is attached'); assert.equal(args.max_price, edition.price);
    edition.minted++; balance -= deposit; value = car(edition.minted, me); cars.push(value);
  } else if (call.methodName === 'list_edition_car') {
    value = cars.find(c => c.id === args.car_id); value.price = args.price; value.offer = ++revision;
  } else if (call.methodName === 'cancel_edition_listing') {
    cars.find(c => c.id === args.car_id).price = null;
  } else if (call.methodName === 'buy_edition_car') {
    value = cars.find(c => c.id === args.car_id);
    assert.equal(deposit, BigInt(value.price), 'the asking price is attached'); assert.equal(args.offer, value.offer);
    balance -= deposit; value.last_price = value.price; value.owner = me; value.price = null; value.sales++;
  } else assert.fail(`unexpected call ${call.methodName}`);
  return value;
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error(e.stack); });
await page.addInitScript(() => {
  localStorage.setItem('minirush.controls-guide', '1'); localStorage.setItem('minirush.welcomed', '1');
});
await page.route('**/*', async route => {
  const req = route.request(); if (req.method() !== 'POST') return route.continue();
  let body; try { body = req.postDataJSON(); } catch { return route.abort(); }
  if (body.jsonrpc) {
    if (offline) return route.abort('failed');
    const p = body.params; let result;
    if (body.method === 'send_tx' || body.method === 'broadcast_tx_commit') {
      assert.equal(p.wait_until, 'FINAL', 'wait for finalized receipts before refreshing final-block inventory');
      // A transaction the garage signed and sent itself: the only way a NEAR-paid call may arrive.
      const tx = borsh.deserialize(SCHEMA.SignedTransaction, Buffer.from(p.signed_tx_base64 ?? p[0], 'base64')).transaction;
      assert.equal(tx.signerId, me); assert.equal(tx.receiverId, 'minirush-garage.testnet');
      const value = Buffer.from(JSON.stringify(settle(tx.actions[0].functionCall, 'garage'))).toString('base64');
      const outcome = status => ({ id: 'fixture', block_hash: 'fixture', outcome: { status, logs: [], receipt_ids: [], gas_burnt: 0, tokens_burnt: '0', executor_id: me } });
      return route.fulfill({ json: { jsonrpc: '2.0', id: body.id, result: { final_execution_status: 'FINAL', status: { SuccessValue: value },
        transaction: { hash: 'fixture-direct' }, transaction_outcome: outcome({ SuccessReceiptId: 'fixture' }), receipts_outcome: [outcome({ SuccessValue: value })] } } });
    }
    if (body.method === 'block') result = { header: { height: 100, hash: '11111111111111111111111111111111' } };
    else if (p.request_type === 'view_access_key') result = { nonce: 1, permission: 'FullAccess' };
    else if (p.request_type === 'view_account') result = { amount: String(balance + 182n * 10n ** 19n + NEAR / 20n), storage_usage: 182 };
    else {
      const m = p.method_name;
      const value = m === 'editions' ? [edition] : m === 'edition_asks' ? cars.filter(c => c.price) : m === 'edition_garage' ? cars.filter(c => c.owner === me)
        : m === 'mt_tokens_for_owner' ? [{ token_id: 'rush', balance: '120' }] : [];
      result = { result: [...Buffer.from(JSON.stringify(value))], logs: [] };
    }
    return route.fulfill({ json: { jsonrpc: '2.0', id: body.id, result } });
  }
  if (body.path === 'near:createPlayer') { garagePublicKey = body.args.publicKey; return route.fulfill({ json: { status: 'success', value: { account: me, welcome: 0, created: true } } }); }
  if (body.path === 'near:testNear') {
    assert.equal(body.args.account, me);
    assert.ok(Math.abs(Date.now() - body.args.at) < 60_000);
    assert.ok(PublicKey.from(garagePublicKey).verify(new TextEncoder().encode(`minirush:test-near:${me}:${body.args.at}`), Buffer.from(body.args.signature, 'base64')), 'top-up is authorized by this garage key');
    grants++; balance += 4n * NEAR;
    return route.fulfill({ json: { status: 'success', value: { state: 'sent', message: 'Test NEAR added to your garage.', tx: 'fixture-grant' } } });
  }
  if (body.path === 'near:relayTracked') {
    const delegate = borsh.deserialize(SCHEMA.SignedDelegate, Buffer.from(body.args.signedDelegate, 'base64'));
    return route.fulfill({ json: { status: 'success', value: { state: 'confirmed', tx: 'fixture-receipt', value: settle(delegate.delegateAction.actions[0].functionCall, 'relay') } } });
  }
  return route.fulfill({ json: { status: 'success', value: [] } });
});
const live = () => page.waitForFunction(() => document.querySelector('.mk-status')?.textContent === 'Live dealer prices' && !document.querySelector('.mk-refresh').disabled);
try {
  await page.goto(`${base}/?q=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game?.state === 'menu');
  await page.waitForSelector('#home-price-wire[data-state="live"]');
  assert.match(await page.locator('.hpw-strip').first().innerText(), /OWNER LISTINGS.*1 FOR SALE/s);
  assert.match(await page.locator('.hpw-strip').first().innerText(), /LAGOS GOLD.*2 NEAR/s);
  assert.equal(await page.locator('.hpw-window').getAttribute('href'), 'economy/#s-dealers');
  await page.click('.hpw-pause');
  assert.equal(await page.locator('#home-price-wire').getAttribute('data-paused'), 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelectorAll('.hpw-strip').length === 1);
  assert.equal(await page.locator('.hpw-strip').count(), 1, 'reduced motion uses one manually scrollable strip');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.screenshot({ path: `${out}/home-wire-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const wireBox = await page.locator('#home-price-wire').boundingBox();
  assert.ok(wireBox && wireBox.x >= 0 && wireBox.x + wireBox.width <= 390 && wireBox.y + wireBox.height <= 844);
  await page.screenshot({ path: `${out}/home-wire-mobile.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.click('#btn-market-home'); await live();
  assert.equal(await page.locator('#home-price-wire').isVisible(), false, 'price wire stays on the home screen');
  // Editions lead the rail and are marked as limited; the garage balance appears beside RUSH.
  const first = page.locator('.mk-select').first();
  assert.equal(await first.getAttribute('data-select'), 'edition:lagos-gold');
  assert.match(await first.innerText(), /LIMITED · 6\/50/);
  assert.equal(await page.locator('.mk-near').innerText(), '0.01 NEAR ＋');
  await first.click(); await page.click('.mk-motion'); await page.waitForTimeout(900);
  const shown = await page.evaluate(() => JSON.parse(window.__game.showroom.key));
  assert.equal(shown.id, 'tourbillon'); assert.equal(shown.color, 0xffc531, 'the stage wears the edition paint');
  assert.equal(await page.locator('.mk-heading h1').innerText(), 'LAGOS GOLD');
  assert.equal(await page.locator('.mk-nearprice b').first().innerText(), '2');
  assert.match(await page.locator('.mk-ed .mk-dealer').innerText(), /NEXT CAR #7 OF 50/);
  assert.equal(await page.locator('.mk-ask').count(), 1, 'another owner is selling #3');
  await page.screenshot({ path: `${out}/edition-desktop.png` });

  // Not enough NEAR: nothing is sent, the balance card opens instead.
  assert.match(await page.locator('[data-edition-buy]').innerText(), /ADD NEAR TO BUY · 2 NEAR/);
  await page.click('[data-edition-buy]');
  await page.waitForSelector('.mk-wallet:not([hidden])');
  assert.equal(calls.length, 0);
  assert.match(await page.locator('.mk-wallet-note').innerText(), /costs 2 NEAR/);
  assert.equal(await page.locator('.mk-wallet code').innerText(), me);
  await page.click('[data-test-near]');
  await page.waitForFunction(() => document.querySelector('.mk-wallet-note')?.textContent.includes('Test NEAR added'));
  assert.equal(grants, 1); assert.equal(await page.locator('.mk-near').innerText(), '4.01 NEAR ＋');
  await page.screenshot({ path: `${out}/wallet-desktop.png` });
  await page.click('[data-wallet-close]');

  // First sale: the price leaves the garage, the next numbered car arrives, and its model becomes drivable.
  assert.match(await page.locator('[data-edition-buy]').innerText(), /ACQUIRE #7 · 2 NEAR/);
  await page.click('[data-edition-buy]');
  await page.waitForFunction(() => document.querySelector('.mk-own-head strong')?.textContent === 'YOU OWN #7 OF 50');
  assert.deepEqual(calls.map(c => c.method), ['buy_edition']);
  assert.equal(calls[0].via, 'garage', 'the garage pays for its own car; the game never fronts the price');
  assert.match(await page.locator('.mk-toast').innerText(), /LAGOS GOLD #7 of 50/);
  assert.equal(await page.locator('.mk-near').innerText(), '2.01 NEAR ＋');
  assert.match(await page.locator('.mk-select').first().innerText(), /LIMITED · 7\/50/);
  assert.equal(await page.evaluate(async () => (await import(performance.getEntriesByType('resource').findLast(r => r.name.includes('/src/economy.ts'))?.name ?? '/src/economy.ts')).owned().has('tourbillon')), true, 'the edition unlocks its model');

  // Resale: list for NEAR, see the proceeds after the royalty, cancel.
  await page.fill('.mk-list-price', 'abc'); await page.click('[data-edition-list]');
  assert.equal(calls.length, 1, 'an unusable price sends nothing');
  await page.fill('.mk-list-price', '5');
  assert.match(await page.locator('[data-proceeds]').innerText(), /You receive 4\.9 NEAR after the 2% royalty/);
  await page.click('[data-edition-list]');
  await page.waitForFunction(() => document.querySelector('.mk-own p')?.textContent.includes('Listed for 5 NEAR'));
  assert.equal(calls[1].method, 'list_edition_car'); assert.equal(calls[1].args.price, String(5n * NEAR)); assert.equal(calls[1].via, 'relay');
  await page.screenshot({ path: `${out}/listed-desktop.png` });
  await page.click('[data-edition-cancel]');
  await page.waitForFunction(() => !!document.querySelector('.mk-list-price'));
  assert.equal(calls[2].method, 'cancel_edition_listing');

  // Buying from another owner pays their asking price.
  await page.click('[data-ask-buy]');
  await page.waitForFunction(() => document.querySelectorAll('.mk-own').length === 2);
  assert.equal(calls[3].method, 'buy_edition_car'); assert.equal(calls[3].deposit, 3n * NEAR / 2n);
  assert.equal(await page.locator('.mk-ask').count(), 0);
  assert.match(await page.locator('.mk-asks').innerText(), /FROM OWNERS.*No other players have listed/s, 'empty owner market stays discoverable');
  assert.equal(await page.locator('.mk-near').innerText(), '0.51 NEAR ＋');

  // Phone layout: everything reachable, nothing wider than the screen.
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll');
  for (const sel of ['.mk-near', '[data-edition-buy]', '.mk-list-price']) {
    const box = await page.locator(sel).first().boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390.5, `${sel} fits the phone`);
  }
  await page.screenshot({ path: `${out}/edition-mobile.png` });
  await page.locator('[data-edition-buy]').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${out}/edition-mobile-panel.png` });
  await page.click('.mk-near'); await page.waitForSelector('.mk-wallet:not([hidden])');
  const wallet = await page.locator('.mk-wallet').boundingBox();
  assert.ok(wallet.x >= 0 && wallet.x + wallet.width <= 390.5, 'balance card fits the phone');
  await page.screenshot({ path: `${out}/wallet-mobile.png` });
  await page.click('[data-wallet-close]'); await page.click('.mk-back');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => document.querySelector('.hpw-strip')?.textContent.includes('NONE YET'));
  offline = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForSelector('#home-price-wire[data-state="stale"]');
  assert.equal(await page.locator('[data-wire-status]').innerText(), 'LAST SEEN');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#home-price-wire[data-state="offline"]');
  assert.match(await page.locator('.hpw-track').innerText(), /Prices unavailable/);
  assert.deepEqual(errors, []);
  console.log(`PASS: home price wire, pause/reduced motion, stale/offline states, owner-listing empty state, edition purchase and resale, phone layout. Screenshots: ${out}`);
} finally { await browser.close(); }
