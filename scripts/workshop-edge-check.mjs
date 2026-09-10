import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(`${process.argv[2] || 'http://127.0.0.1:5174'}/?q=0`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game?.state === 'menu');
  console.log('NIM CONFIG:', await page.evaluate(() => ({ configured: window.__game.ui.wallet.marketReady, nativeHost: window.__game.ui.wallet.available })));
  const checks = await page.evaluate(async () => {
    const w = await import('/src/workshop.ts'); const failures = [];
    const check = (ok, label) => { if (!ok) failures.push(label); };
    localStorage.setItem('minirush.workshop.v1', '{bad json');
    check(w.workshopStore().builds.length === 3, 'corrupt store fallback');
    localStorage.setItem('minirush.workshop.v1', JSON.stringify({ owned: ['bogus'], active: -3, builds: [{ name: 'test', parts: { body: 'gt', paint: 'lagoon' } }] }));
    check(w.equippedBuild().parts.body === 'street' && w.equippedBuild().parts.paint === 'sun', 'wrong slot and unowned parts rejected');
    localStorage.setItem('minirush.bank', '500');
    check(!!w.purchasePart('unknown'), 'invalid purchase rejected');
    check(localStorage.getItem('minirush.bank') === '500', 'invalid purchase no charge');
    check(!!w.saveBuild(7, w.freshBuild()), 'bad preset rejected');
    check(!!w.saveBuild(0, { ...w.freshBuild(), parts: { ...w.freshBuild().parts, paint: 'lagoon' } }), 'unowned save rejected');
    const set = Storage.prototype.setItem; let interrupted = false;
    Storage.prototype.setItem = function(key, value) { if (key === 'minirush.bank' && !interrupted) { interrupted = true; throw new DOMException('Test interruption', 'QuotaExceededError'); } return set.call(this, key, value); };
    try { check(!!w.purchasePart('wide'), 'interruption reported'); } finally { Storage.prototype.setItem = set; }
    check(!!localStorage.getItem('minirush.workshop.v1.purchase'), 'journal retained');
    w.recoverPurchase(); check(w.ownsPart('wide') && localStorage.getItem('minirush.bank') === '340', 'recovery commits exactly once');
    w.purchasePart('wide'); check(localStorage.getItem('minirush.bank') === '340', 'duplicate purchase no charge');
    check(!localStorage.getItem('minirush.workshop.v1.purchase'), 'journal cleaned');
    return failures;
  });
  assert.deepEqual(checks, []);
  await page.click('#wallet-chip'); assert.equal(await page.locator('#profile').isVisible(), true); await page.click('#btn-profile-close');
  await page.click('#btn-market-home');
  assert.equal(await page.locator('#btn-market-nim').isDisabled(), true);
  // UI-only wallet stub: no provider, account, network payment or real funds involved.
  await page.evaluate(() => {
    const g = window.__game; const wallet = g.ui.wallet;
    Object.defineProperty(wallet, 'available', { get: () => true });
    Object.defineProperty(wallet, 'marketReady', { get: () => true });
    window.testPayments = 0;
    wallet.buyMarketCar = () => { window.testPayments++; return new Promise(resolve => { window.resolveTestPayment = resolve; }); };
    g.ui.renderCar();
  });
  await page.click('#btn-market-nim'); await page.click('#car-next');
  assert.equal(await page.locator('#btn-market-nim').isDisabled(), true);
  await page.evaluate(() => { void window.__game.ui.buyMarketCar(); window.resolveTestPayment(null); });
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => window.testPayments), 1);
  assert.equal(await page.evaluate(() => localStorage.getItem('minirush.owned')), null);
  await page.click('#btn-market-nim');
  const purchaseId = await page.evaluate(async () => (await import('/src/cars.ts')).CARS[window.__game.carIndex].id);
  await page.click('#car-next'); await page.evaluate(() => window.resolveTestPayment('test-only-reference'));
  await page.waitForTimeout(50);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('minirush.owned'))), [purchaseId]);
  await page.click('#btn-workshop-garage');
  await page.click('[data-part="street"]'); await page.waitForTimeout(100);
  const before = await page.evaluate(() => window.__game.renderer.info.memory.geometries);
  for (let i = 0; i < 12; i++) { await page.click('[data-part="wide"]'); await page.click('[data-part="street"]'); }
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => window.__game.renderer.info.memory.geometries);
  assert.ok(after <= before + 4, `Preview geometry grew: ${before} -> ${after}`);
  assert.deepEqual(errors, []);
  console.log('PASS: corrupt storage, invalid IDs/slots, unowned save, interrupted-purchase recovery, duplicate charge prevention, local profile, native-only market, mocked payment rejection/concurrency/car identity, preview cleanup.', { before, after });
} finally { await browser.close(); }
