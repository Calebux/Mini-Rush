import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base = process.argv[2] || 'http://127.0.0.1:5174';
const shots = '/tmp/minirush-workshop';
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true });
const errors = []; page.on('pageerror', e => errors.push(e.message));
// the customs workshop is reached from the garage
const openWorkshop = async () => {
  if (await page.locator('#garage').evaluate(el => el.classList.contains('hidden'))) await page.click('#btn-garage-menu');
  await page.click('#btn-workshop-garage');
};
try {
  await page.addInitScript(() => {
    localStorage.setItem('minirush.controls-guide', '1');
    localStorage.setItem('minirush.welcomed', '1'); // not a first-open run
  });
  await page.goto(`${base}/?q=1&len=600&laps=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game?.state === 'menu');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${shots}/home-mobile.png` });
  await openWorkshop();
  await page.click('[data-part="wide"]');
  assert.equal(await page.locator('#workshop-buy').isDisabled(), true);
  assert.equal(await page.locator('#workshop-save').isDisabled(), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('minirush.bank')), null);
  await page.click('#workshop-back');
  assert.equal(await page.evaluate(() => window.__game.workshopPreview), null);
  await page.evaluate(() => localStorage.setItem('minirush.bank', '1000'));
  await openWorkshop();
  await page.click('[data-part="wide"]'); await page.click('#workshop-buy');
  assert.equal(await page.evaluate(() => localStorage.getItem('minirush.bank')), '840');
  assert.equal(await page.locator('#workshop-buy').isDisabled(), true);
  await page.click('[data-slot="paint"]'); await page.click('[data-part="lagoon"]'); await page.click('#workshop-buy');
  await page.click('[data-slot="wheels"]'); await page.click('[data-part="turbine"]'); await page.click('#workshop-buy');
  await page.click('[data-slot="wing"]'); await page.click('[data-part="gt"]'); await page.click('#workshop-buy');
  await page.click('[data-slot="power"]'); await page.click('[data-part="sprint"]'); await page.click('#workshop-buy');
  await page.fill('#workshop-name', 'LAGOS SPECIAL');
  await page.screenshot({ path: `${shots}/workshop-mobile.png` });
  await page.click('#workshop-save');
  assert.equal(await page.locator('#home-car-name').textContent(), 'LAGOS SPECIAL');
  assert.equal(await page.evaluate(() => window.__game.carSpec(window.__game.carIndex).accel), 1.1);
  assert.equal(await page.evaluate(() => localStorage.getItem('minirush.bank')), '410');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game?.state === 'menu');
  assert.equal(await page.locator('#home-car-name').textContent(), 'LAGOS SPECIAL');
  await page.screenshot({ path: `${shots}/home-custom-mobile.png` });
  await openWorkshop();
  await page.click('#workshop-presets button:nth-child(2)');
  await page.fill('#workshop-name', 'SUNDAY DRIVE'); await page.click('#workshop-save');
  assert.equal(await page.locator('#home-car-name').textContent(), 'SUNDAY DRIVE');
  assert.equal(await page.evaluate(() => window.__game.carSpec(window.__game.carIndex).accel), 1);
  await openWorkshop(); await page.click('#workshop-presets button:first-child'); await page.click('#workshop-save');
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/home-desktop.png` });
  await openWorkshop(); await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/workshop-desktop.png` });
  await page.click('#workshop-back');
  await page.setViewportSize({ width: 360, height: 640 }); await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/home-small.png` });
  await openWorkshop(); await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/workshop-small.png` });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.click('#workshop-back');
  await page.click('#btn-garage-done'); // closing the workshop lands back in the garage
  await page.waitForFunction(() => window.__game.state === 'racing', { timeout: 15000 });
  assert.equal(await page.evaluate(() => window.__game.player.mesh.userData.workshopCar), true);
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(1800); await page.keyboard.up('ArrowUp');
  await page.screenshot({ path: `${shots}/custom-racing.png` });
  assert.deepEqual(errors, []);
  console.log('PASS: preview, affordability, purchase, no duplicate charge, save/equip, reload, presets, mobile/desktop layouts, custom car races. Screenshots:', shots);
} finally { await browser.close(); }
