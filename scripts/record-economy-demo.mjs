// Real TESTNET recording, not a fixture. Creates a dedicated garage if needed,
// earns rewards through normal physics, crafts one part and sells it to a funded
// dealer (or installs it if no suitable order survives). Never use a personal profile.
// Usage: node scripts/record-economy-demo.mjs --send [http://localhost:3000]
import { chromium } from 'playwright';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

if (!process.argv.includes('--send')) throw new Error('This sends real testnet transactions. Read the script, then pass --send.');
const base = process.argv.slice(2).find(a => a.startsWith('http')) ?? 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use the local development frontend.');
const out = '/tmp/minirush-economy-demo';
await mkdir(out, { recursive: true });
const context = await chromium.launchPersistentContext('/tmp/minirush-demo-browser', {
  channel: 'chrome', headless: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
  recordVideo: { dir: out, size: { width: 1440, height: 900 } }
});
const page = await context.newPage(), video = page.video();
const started = Date.now(), steps = [], receipts = [];
const mark = label => { steps.push({ label, seconds: (Date.now() - started) / 1000 }); console.log(label); };
const idle = () => page.waitForFunction(() => {
  const status = document.querySelector('.pw-status')?.textContent ?? '';
  return status && !/Completing|Confirming|Refreshing/.test(status);
}, {}, { timeout: 90000 });
// A blank successful status is valid, too.
const settled = () => page.waitForFunction(() => document.querySelector('.pw-wallet b')?.textContent !== '—'
  && !/Completing|Confirming|Refreshing/.test(document.querySelector('.pw-status')?.textContent ?? ''), {}, { timeout: 90000 });
const pause = () => page.waitForTimeout(2500);
await page.addInitScript(() => {
  localStorage.setItem('minirush.welcomed', '1'); localStorage.setItem('minirush.controls-guide', '1');
  localStorage.setItem('minirush.driver', JSON.stringify({ name: 'MINIRUSH DEMO', chosen: true }));
});
try {
  await page.goto(`${base}/?q=1&map=lagos&mode=gp`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.state === 'menu', {}, { timeout: 60000 });
  assert.equal(await page.evaluate(async () => (await import('/src/near.ts')).GARAGE.endsWith('.testnet')), true);
  await page.waitForSelector('#home-build-goal[data-state="earning"], #home-build-goal[data-state="ready"]', { timeout: 90000 });
  mark('Home: confirmed garage and build goal'); await pause();
  await page.click('#home-build-goal'); await settled();
  await page.click('[data-page="exchange"]'); await page.click('[data-market="orders"]');
  const mama = page.locator('.pw-order').filter({ hasText: 'Mama T' }).first();
  if (await mama.count() && await mama.locator('[data-action="order-recipe"]').count()) {
    mark('Funded dealer demand'); await pause();
    await mama.locator('[data-action="order-recipe"]').click();
  } else { await page.click('[data-page="craft"]'); }
  mark('Recipe and material shortfall'); await pause();
  for (let race = 1; race <= 3; race++) {
    if (await page.locator('[data-action="craft"]:enabled').count()) break;
    await page.click('[data-action="race"]'); await page.click('#btn-garage-done');
    await page.waitForFunction(() => window.__game?.state === 'racing', {}, { timeout: 60000 });
    mark(`Race ${race}: normal physics start`);
    await page.evaluate(() => {
      window.__demoDriver = setInterval(() => {
        const g = window.__game;
        if (g.state !== 'racing') { g.input.uiGas = false; g.input.heldSteer = 0; return; }
        g.input.uiGas = true;
        g.input.heldSteer = Math.max(-1, Math.min(1, (g.player.x + 1.6) * .5));
      }, 30);
    });
    await page.waitForFunction(() => window.__game.state === 'finished', {}, { timeout: 240000 });
    await page.evaluate(() => clearInterval(window.__demoDriver));
    mark(`Race ${race}: finish`);
    await page.waitForSelector('#race-rewards[data-status="confirmed"]', { timeout: 90000 });
    receipts.push(await page.locator('.rr-payment-details a').getAttribute('href'));
    await page.locator('#race-rewards').scrollIntoViewIfNeeded();
    mark(`Race ${race}: reward confirmed`); await pause();
    await page.click('[data-reward-action="workshop"]'); await settled(); await pause();
  }
  assert.equal(await page.locator('[data-action="craft"]:enabled').count(), 1, 'Enough confirmed resources after at most three races');
  await page.click('[data-action="craft"]'); await idle();
  assert.match(await page.locator('.pw-status').textContent(), /crafted/);
  receipts.push(await page.locator('.pw-payment-details a').getAttribute('href'));
  mark('Craft confirmed: numbered part and ownership choice'); await pause();
  await page.screenshot({ path: `${out}/crafted-choice.png` });
  if (await page.locator('[data-action="show-orders"]').count()) {
    await page.click('[data-action="show-orders"]');
    const offer = page.locator('.pw-order').filter({ has: page.locator('[data-action="deliver"]') }).first();
    await offer.scrollIntoViewIfNeeded(); mark('Review dealer payment after fees'); await pause();
    await offer.locator('[data-action="deliver"]').click(); await idle();
    assert.match(await page.locator('.pw-status').textContent(), /RUSH received/);
    mark('Delivery confirmed: dealer owns the serial; maker credit remains');
  } else {
    await page.click('[data-action="install"]'); await idle();
    assert.match(await page.locator('.pw-status').textContent(), /Build updated/);
    mark('Install confirmed: fitted handling changes');
  }
  receipts.push(await page.locator('.pw-payment-details a').getAttribute('href'));
  await pause(); await page.screenshot({ path: `${out}/settled.png` });
  mark('Complete');
} catch (error) {
  mark(`Stopped: ${error.message}`);
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${out}/evidence.json`, JSON.stringify({ base, network: 'testnet', automatedDriving: 'normal input and physics; no position/time edits', steps, receipts }, null, 2));
  const videoPath = video ? await video.path() : null;
  await context.close();
  if (videoPath) await copyFile(videoPath, `${out}/economy-demo-raw.webm`);
  console.log(`Recording and public receipts: ${out}`);
}
