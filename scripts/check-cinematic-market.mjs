import { signedInDriver } from './auth-fixture.mjs';
// Isolated browser fixture: no transactions or backend writes leave this test.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import * as borsh from 'borsh';
import { SCHEMA } from 'near-api-js';
const base = process.argv[2] ?? 'http://127.0.0.1:5174';
let loginRequired = false; // set once the market shows whether this server asks for a login
const out = '/tmp/minirush-cinematic'; await mkdir(out, { recursive: true });
const me = 'preview.minirush-garage.testnet';
let offline = false, held = [{ token_id: 'rush', balance: '5000' }], calls = [];
const list = [
  { token_id: 'car:r8', kind: 'car', name: 'AURORA V10', dealer: 'oga-motors.testnet', price: '1800', stock: 4, sold: 2, reason: 'Four available. Priced for the next grid.', updated_ms: Date.now() },
  { token_id: 'part:nitro-can', kind: 'part', name: 'NITRO CAN', dealer: 'tuner-ade.testnet', price: '20', stock: 10, sold: 4, reason: 'Race supply.', updated_ms: Date.now() }
];
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
    let result;
    if (body.method === 'block') result = { header: { height: 100, hash: '11111111111111111111111111111111' } };
    else if (body.params.request_type === 'view_access_key') result = { nonce: 1, permission: 'FullAccess' };
    else {
      const value = body.params.method_name === 'listings' ? list : body.params.method_name === 'mt_tokens_for_owner' ? held : [];
      result = { result: [...Buffer.from(JSON.stringify(value))], logs: [] };
    }
    return route.fulfill({ json: { jsonrpc: '2.0', id: body.id, result } });
  }
  if (body.path === 'near:createPlayer') return route.fulfill({ json: { status: 'success', value: { account: me, welcome: 0, created: true } } });
  if (body.path === 'near:relayTracked') {
    const delegate = borsh.deserialize(SCHEMA.SignedDelegate, Buffer.from(body.args.signedDelegate, 'base64'));
    const call = delegate.delegateAction.actions[0].functionCall, args = JSON.parse(Buffer.from(call.args).toString());
    if (call.methodName === 'consume') {
      assert.equal(args.token_id, 'part:nitro-can');
      held = held.filter(h => h.token_id !== args.token_id);
      return route.fulfill({ json: { status: 'success', value: { state: 'confirmed', tx: 'fixture-consume', value: null } } });
    }
    assert.equal(call.methodName, 'buy'); calls.push(args);
    assert.equal(req.headers().authorization, loginRequired ? 'Bearer fixture-login-token' : undefined, 'a purchase carries a login token only where sign-in is required');
    const offer = list.find(l => l.token_id === args.token_id); assert.equal(args.max_price, offer.price);
    held[0].balance = String(Number(held[0].balance) - Number(offer.price)); held.push({ token_id: args.token_id, balance: '1' }); offer.stock--;
    return route.fulfill({ json: { status: 'success', value: { state: 'confirmed', tx: 'fixture-receipt', value: null } } });
  }
  return route.fulfill({ json: { status: 'success', value: body.path === 'near:beginRace' ? 'fixture-race' : [] } });
});
try {
  await page.goto(`${base}/?q=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game?.state === 'menu');
  await page.click('#btn-market-home');
  await page.waitForFunction(() => document.querySelector('.mk-status')?.textContent === 'Live dealer prices');
  await page.click('.mk-motion'); // stop the default orbit for repeatable images
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/market-desktop.png` });
  assert.equal(await page.evaluate(() => window.__game.uiScene), 'market');
  assert.equal(await page.evaluate(() => JSON.parse(window.__game.showroom.key).id), 'rush-one');
  await page.click('button[data-shot="rear"]'); await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/rush-rear.png` });
  await page.click('button[data-shot="side"]'); await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/rush-side.png` });
  await page.locator('#market-car-stage').focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('.mk-motion').getAttribute('aria-pressed'), 'false');
  await page.click('.mk-motion');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const angle = await page.evaluate(() => window.__game.showroom.angle);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__game.showroom.angle), angle, 'reduced motion stops auto orbit');
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.click('.mk-motion');
  await page.click('[data-select="car:r8"]');
  await page.waitForFunction(() => JSON.parse(window.__game.showroom.key).id === 'r8');
  assert.equal(await page.locator('.mk-price b').textContent(), '1,800');
  // The dealer's reasoning and its distance from list price are on show without a tap.
  assert.equal(await page.locator('.mk-reason').isVisible(), true);
  assert.match(await page.locator('.mk-reason p').textContent(), /Four available/);
  assert.equal(await page.locator('.mk-trend').textContent(), '▼ 10% UNDER LIST');
  assert.equal(await page.locator('.mk-ledger').getAttribute('href'), 'economy/');
  // By default the garage on this device buys directly. A server started with
  // VITE_SHOP_SIGN_IN=required puts the login in front of the first purchase.
  loginRequired = await page.locator('.mk-buy').textContent() === 'SIGN IN TO BUY';
  if (loginRequired) {
    await page.click('.mk-buy');
    await page.waitForFunction(() => document.querySelector('#social-sign-in').open);
    assert.equal(calls.length, 0, 'guest cannot send a purchase');
    assert.equal(held[0].balance, '5000');
    await page.locator('[data-auth-close]').first().click();
    await signedInDriver(page);
  } else assert.equal(await page.locator('#social-sign-in').count(), 0, 'no login panel when the garage is the access');
  await page.click('.mk-buy');
  await page.waitForFunction(() => document.querySelector('.mk-meta')?.textContent.includes('Owned ×1'));
  assert.equal(calls.length, 1); assert.equal(calls[0].token_id, 'car:r8');
  await page.click('[data-select="part:nitro-can"]'); await page.click('.mk-buy');
  await page.waitForFunction(() => document.querySelector('.mk-meta')?.textContent.includes('Owned ×1') && document.querySelector('.mk-buy')?.textContent === 'BUY SUPPLY ↗');
  assert.equal(calls.length, 2); assert.equal(calls[1].token_id, 'part:nitro-can');
  await page.click('[data-select="car:r8"]');
  assert.equal(await page.evaluate(() => window.__game.carIndex), 0, 'preview does not equip a different race car');
  await page.click('button[data-shot="front"]'); await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/dealer-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#market').evaluate(e => e.scrollTop = 0); await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/market-mobile.png` });
  assert.equal(await page.evaluate(() => document.querySelector('#market').scrollWidth > innerWidth), false);
  offline = true; await page.click('.mk-refresh');
  await page.waitForFunction(() => document.querySelector('.mk-status')?.textContent.includes('unavailable'));
  assert.equal(await page.locator('.mk-buy').isDisabled(), true);
  await page.click('[data-select="car:rush-one"]');
  await page.waitForFunction(() => JSON.parse(window.__game.showroom.key).id === 'rush-one');
  await page.locator('#market').evaluate(e => e.scrollTop = 0);
  await page.screenshot({ path: `${out}/rush-mobile.png` });
  await page.setViewportSize({ width: 360, height: 640 });
  assert.equal(await page.evaluate(() => document.querySelector('#market').scrollWidth > innerWidth), false);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__game.uiScene), 'menu');
  assert.equal(await page.locator('#btn-market-home').evaluate(e => e === document.activeElement), true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.click('#btn-garage-menu'); await page.click('#btn-workshop-garage');
  await page.click('[data-part="wide"]');
  await page.click('#workshop-tabs [data-slot="wing"]'); await page.click('[data-part="gt"]');
  await page.click('#workshop-tabs [data-slot="wheels"]'); await page.click('[data-part="turbine"]');
  await page.click('#workshop-tabs [data-slot="paint"]'); await page.click('[data-part="ice"]');
  await page.waitForFunction(() => JSON.parse(window.__game.showroom.key).build?.parts.paint === 'ice');
  assert.equal(await page.evaluate(() => window.__game.showroom.marketSet.visible), false);
  assert.equal(await page.evaluate(() => window.__game.showroom.garageSet.visible), true);
  await page.screenshot({ path: `${out}/custom-gt.png` });
  await page.click('#workshop-tabs [data-slot="body"]'); await page.click('[data-part="rally"]');
  await page.waitForFunction(() => JSON.parse(window.__game.showroom.key).build?.parts.body === 'rally');
  await page.screenshot({ path: `${out}/custom-rally.png` });
  await page.click('#workshop-back');
  await page.click('#garage-back');
  await page.click('#tour-back');
  offline = false;
  await page.click('#btn-play'); await page.click('#btn-tour-done'); await page.click('#btn-garage-done');
  await page.waitForFunction(() => window.__game?.state === 'racing');
  assert.equal(await page.evaluate(() => window.__game.traffic.cars.length), 0);
  const racers = await page.evaluate(() => window.__game.rivals.rivals.map(r => r.car));
  assert.equal(racers.length, 3); assert.ok(racers.every(Boolean));
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(2500); await page.keyboard.up('ArrowUp');
  assert.ok(await page.evaluate(() => window.__game.player.s > 0));
  assert.deepEqual(errors, []);
  console.log(`PASS: cinematic selection, camera angles, quoted-price purchase, offline browsing, mobile sizing, menu restoration, racing without civilian traffic. Screenshots: ${out}`);
} finally { await browser.close(); }
