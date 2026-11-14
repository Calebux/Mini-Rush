// Browser onboarding with disposable identities and mocked backend/RPC responses.
// Never provisions a real account or sends a transaction.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { KeyPair } from 'near-api-js';
const base = process.argv[2] ?? 'http://localhost:3000';
const out = '/tmp/minirush-driver-onboarding'; await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], writes = [];
const key = KeyPair.fromRandom('ed25519'), account = 'onboarding.minirush-garage.testnet';
const password = 'fixture-only recovery passphrase';
async function setup({ fresh = false, offline = false, width = 390 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, acceptDownloads: true });
  let publicKey = key.getPublicKey().toString();
  await context.addInitScript(({ account, key, fresh }) => {
    if (!['http:', 'https:'].includes(location.protocol) || localStorage.getItem('onboarding-fixture')) return;
    localStorage.setItem('onboarding-fixture', '1');
    localStorage.setItem('minirush.controls-guide', '1');
    if (!fresh) {
      localStorage.setItem('minirush.near.account', account);
      localStorage.setItem('minirush.near.key', key);
      localStorage.setItem('minirush.welcomed', '1');
    }
  }, { account, key: key.toString(), fresh });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    assert.ok(!(req.url() + (req.postData() ?? '')).includes(key.toString()));
    assert.ok(!(req.postData() ?? '').includes(password));
    if (req.method() !== 'POST') return url.origin === new URL(base).origin ? route.continue() : route.abort();
    let body; try { body = req.postDataJSON(); } catch { return route.abort(); }
    if (body.path === 'near:createPlayer') {
      if (offline) return route.abort();
      publicKey = body.args.publicKey;
      return route.fulfill({ json: { status: 'success', value: { account } } });
    }
    // The explicit "Race now" skip check can request a race session; block it.
    if (body.path === 'near:beginRace') return route.abort();
    if (body.jsonrpc && body.method === 'query') {
      if (offline) return route.abort();
      const result = body.params.request_type === 'view_access_key'
        ? { nonce: 1, permission: body.params.public_key === publicKey ? 'FullAccess' : {} }
        : body.params.request_type === 'view_account' ? { amount: '2000000000000000000000000', storage_usage: 200 }
        : { result: [...Buffer.from('[]')], logs: [] };
      return route.fulfill({ json: { jsonrpc: '2.0', id: body.id, result } });
    }
    if (url.pathname === '/api/query') return route.fulfill({ json: { status: 'success', value: [] } });
    if (body.path?.startsWith('near:') || body.jsonrpc) writes.push(body.path ?? body.method);
    return route.abort();
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/?q=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__game);
  return { context, page };
}
try {
  const { context, page } = await setup({ fresh: true });
  assert.equal(await page.locator('#welcome').isVisible(), true);
  await page.screenshot({ path: out + '/welcome-mobile.png' });
  await page.click('#welcome [data-driver-onboarding]');
  assert.equal(await page.locator('#welcome').isVisible(), false);
  await page.fill('#onboarding-name', 'YOU'); await page.click('[data-driver-form] button');
  assert.match(await page.locator('#driver-name-error').textContent(), /rival/);
  await page.fill('#onboarding-name', 'caleb rush'); await page.screenshot({ path: out + '/name-mobile.png' });
  await page.click('[data-driver-form] button');
  await page.waitForFunction(() => document.querySelector('[data-driver-device-status]')?.textContent.includes('GARAGE READY'));
  assert.equal(await page.locator('[data-driver-preview]').textContent(), 'CALEB RUSH');
  assert.equal(await page.locator('#driver-chip').textContent(), 'CALEB RUSH');
  await page.screenshot({ path: out + '/garage-mobile.png' });
  assert.equal(await page.locator('#driver-onboarding').evaluate(el => el.scrollWidth <= el.clientWidth), true);
  await page.click('[data-driver-backup]');
  assert.equal(await page.locator('#driver-onboarding').isVisible(), false);
  await page.fill('#garage-backup-password', password); await page.fill('#garage-backup-confirm', password);
  await page.click('[data-protection-form] button');
  await page.waitForFunction(() => !document.querySelector('[data-protection-download]').hidden);
  assert.equal(await page.locator('[data-backup-saved]').isVisible(), false, 'creating a file alone does not confirm a backup');
  const download = page.waitForEvent('download'); await page.click('[data-backup-download]');
  const file = await readFile(await (await download).path());
  assert.equal(JSON.parse(file).format, 'minirush-garage-backup');
  assert.equal(await page.evaluate(() => localStorage.getItem('minirush.garage.backup-confirmation.v1')), null, 'download alone does not confirm a backup');
  await page.click('[data-backup-saved]');
  await page.waitForFunction(() => document.querySelector('#driver-onboarding').open);
  assert.match(await page.locator('[data-driver-backup-title]').textContent(), /file is saved/);
  await page.click('[data-driver-finish]');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('[data-home-backup-status]')?.dataset.saved === 'true');
  assert.equal(await page.locator('[data-home-driver-name]').textContent(), 'CALEB RUSH');
  assert.match(await page.locator('[data-home-session-label]').textContent(), /DEVICE ACCOUNT ACTIVE/);
  await page.screenshot({ path: out + '/ready-home-mobile.png' });
  const sibling = await context.newPage(); await sibling.goto(base + '/?q=1', { waitUntil: 'networkidle' });
  await page.click('#menu [data-driver-onboarding]'); await page.click('[data-driver-edit]');
  await page.fill('#onboarding-name', 'nitro caleb'); await page.click('[data-driver-form] button');
  await sibling.waitForFunction(() => document.querySelector('[data-home-driver-name]')?.textContent === 'NITRO CALEB');
  assert.equal(await sibling.locator('#driver-chip').textContent(), 'NITRO CALEB');
  await page.click('[data-driver-finish]');
  await page.evaluate(key => localStorage.setItem('minirush.near.key', key), KeyPair.fromRandom('ed25519').toString());
  await sibling.waitForFunction(() => document.querySelector('[data-home-backup-status]')?.dataset.saved === 'false');
  await context.close();

  const disconnected = await setup({ fresh: true, offline: true });
  await disconnected.page.click('#welcome [data-driver-onboarding]'); await disconnected.page.click('[data-driver-keep]');
  await disconnected.page.waitForFunction(() => document.querySelector('[data-driver-device-status]')?.textContent.includes('OFFLINE'));
  assert.equal(await disconnected.page.locator('[data-driver-backup]').isDisabled(), true);
  assert.equal(await disconnected.page.locator('[data-driver-retry]').isVisible(), true);
  await disconnected.page.click('[data-driver-finish]');
  assert.equal(await disconnected.page.locator('#btn-play').isVisible(), true);
  await disconnected.page.screenshot({ path: out + '/offline-mobile.png' });
  await disconnected.context.close();

  const returning = await setup({ width: 1440 });
  await returning.page.click('#menu [data-driver-onboarding]');
  await returning.page.fill('#onboarding-name', 'garage king');
  await returning.page.evaluate(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v) { if (k === 'minirush.driver') throw new Error('fixture quota'); return set.call(this, k, v); }; });
  await returning.page.click('[data-driver-form] button');
  assert.match(await returning.page.locator('[data-driver-garage-copy]').textContent(), /only for this session/);
  await returning.page.screenshot({ path: out + '/garage-desktop.png' });
  await returning.page.click('[data-driver-finish]'); await returning.context.close();

  const instant = await setup({ fresh: true });
  await instant.page.click('#btn-welcome-race');
  assert.equal(await instant.page.locator('#driver-onboarding').isVisible(), false);
  assert.equal(await instant.page.locator('#welcome').isVisible(), false);
  await instant.context.close();
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ['first visit', 'automatic device account', 'name validation', 'race name sync', 'encrypted download', 'explicit backup confirmation', 'returning player', 'cross-tab name sync', 'key-specific backup marker', 'offline racing', 'storage failure', 'skip setup', 'mobile layout'], screenshots: out }));
} finally { await browser.close(); }
