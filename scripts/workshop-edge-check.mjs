import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.addInitScript(() => localStorage.setItem('minirush.welcomed', '1')); // not a first-open run
  await page.goto(`${process.argv[2] || 'http://127.0.0.1:5174'}/?q=0`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game?.state === 'menu');
  const checks = await page.evaluate(async () => {
    const w = await import('/src/workshop.ts'); const failures = [];
    const check = (ok, label) => { if (!ok) failures.push(label); };
    localStorage.setItem('minirush.workshop.v1', '{bad json');
    check(w.workshopStore().builds.length === 3, 'corrupt store fallback');
    localStorage.setItem('minirush.workshop.v1', JSON.stringify({ owned: ['bogus'], active: -3, builds: [{ name: 'test', parts: { body: 'gt', paint: 'lagoon' } }] }));
    check(w.equippedBuild().parts.body === 'street' && w.equippedBuild().parts.paint === 'sun', 'wrong slot and unowned parts rejected');
    localStorage.setItem('minirush.bank', '500');
    localStorage.setItem('minirush.welcomed', '1'); // not a first-open run
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
  // the chip offers a username first, then the driver card
  await page.click('#driver-chip'); assert.equal(await page.locator('#username').isVisible(), true);
  await page.click('#btn-username-skip'); assert.equal(await page.locator('#profile').isVisible(), true); await page.click('#btn-profile-close');
  await page.click('#btn-market-home');
  assert.equal(await page.locator('#btn-buy-car').isDisabled(), true);
  // coins buy cars: the bank covers it, the car unlocks once, a second tap charges nothing
  const purchase = await page.evaluate(async () => {
    const { CARS } = await import('/src/cars.ts');
    const car = CARS[window.__game.carIndex];
    localStorage.setItem('minirush.bank', String(car.price + 100));
    window.__game.ui.renderCar();
    return { id: car.id, price: car.price };
  });
  assert.equal(await page.locator('#btn-buy-car').isDisabled(), false);
  await page.click('#btn-buy-car');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('minirush.owned'))), [purchase.id]);
  assert.equal(await page.evaluate(() => localStorage.getItem('minirush.bank')), '100');
  await page.evaluate(() => window.__game.ui.buyGarageCar());
  assert.equal(await page.evaluate(() => localStorage.getItem('minirush.bank')), '100');
  await page.click('#btn-workshop-garage');
  await page.click('[data-part="street"]'); await page.waitForTimeout(100);
  const before = await page.evaluate(() => window.__game.renderer.info.memory.geometries);
  for (let i = 0; i < 12; i++) { await page.click('[data-part="wide"]'); await page.click('[data-part="street"]'); }
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => window.__game.renderer.info.memory.geometries);
  assert.ok(after <= before + 4, `Preview geometry grew: ${before} -> ${after}`);
  assert.deepEqual(errors, []);
  console.log('PASS: corrupt storage, invalid IDs/slots, unowned save, interrupted-purchase recovery, duplicate charge prevention, local profile, coin market (unaffordable, purchase, no double charge), preview cleanup.', { before, after });
} finally { await browser.close(); }
