// Capture real UI/physics for an edited demo. Uses a dedicated demo browser,
// allows public reads, and blocks HTTP writes. Never use a personal profile.
// node scripts/record-cinematic-demo.mjs [http://localhost:3000]
import { chromium } from 'playwright';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.argv[2] ?? 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const out = '/tmp/minirush-cinematic-demo';
await mkdir(out, { recursive: true });
const context = await chromium.launchPersistentContext('/tmp/minirush-demo-browser', {
  channel: 'chrome', headless: true,
  viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  recordVideo: { dir: out, size: { width: 1920, height: 1080 } }
});
await context.route('**/*', async route => {
  const req = route.request();
  if (req.method() !== 'POST') return route.continue();
  let body; try { body = req.postDataJSON(); } catch { return route.abort(); }
  if (body?.jsonrpc && ['query', 'block', 'status', 'tx', 'EXPERIMENTAL_tx_status'].includes(body.method)) return route.continue();
  if (new URL(req.url()).pathname === '/api/query') return route.continue();
  return route.abort();
});
await context.addInitScript(() => {
  localStorage.setItem('minirush.welcomed', '1');
  localStorage.setItem('minirush.controls-guide', '1');
});
const started = Date.now(), page = await context.newPage(), video = page.video();
const shots = [], errors = [];
let audioStart = null;
page.on('pageerror', error => errors.push(error.message));
const hold = ms => page.waitForTimeout(ms);
async function shot(id, seconds, focus, action) {
  await hold(900);
  const bounds = focus ? await page.locator(focus).first().boundingBox() : null;
  const start = (Date.now() - started) / 1000;
  console.log(`Recording ${id}`);
  if (action) await action();
  const left = seconds * 1000 - (Date.now() - started - start * 1000);
  if (left > 0) await hold(left);
  shots.push({ id, start, duration: (Date.now() - started) / 1000 - start, focus: bounds });
  await page.screenshot({ path: `${out}/${id}.jpg`, type: 'jpeg', quality: 88 });
}
try {
  await page.goto(`${base}/?q=1&map=lagos&mode=gp`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.state === 'menu', {}, { timeout: 60000 });
  await page.waitForSelector('#home-price-wire[data-state="live"]', { timeout: 45000 });
  // Unlock sound through the actual UI, then capture the game's effects bus.
  await page.click('#btn-garage-menu'); await hold(1200); await page.click('#garage-back'); await page.click('#tour-back');
  audioStart = await page.evaluate(() => {
    const a = window.__game.audio; a.unlock(); a.setRadio(true);
    const dest = a.ctx.createMediaStreamDestination(); a.masterGain.connect(dest);
    const recorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks = []; recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    window.__finishDemoAudio = () => new Promise(resolve => {
      recorder.onstop = async () => {
        const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
        let binary = ''; for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
        resolve(btoa(binary));
      }; recorder.stop();
    });
    recorder.start(1000); return Date.now();
  });
  await shot('hero', 8, '#home-car-stage');
  await page.click('#btn-garage-menu');
  await shot('garage', 9, '#garage-car-stage');
  await page.click('[data-skin="1"]');
  await page.selectOption('[data-skin-option="pattern"]', 'stripes');
  await shot('skin', 11, '#garage-car-stage', async () => {
    await hold(2000);
    await page.locator('[data-skin-color="color"]').evaluate(el => { el.value = '#168f82'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await hold(2500);
    await page.locator('[data-skin-color="accent"]').evaluate(el => { el.value = '#efdab0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.selectOption('[data-skin-option="finish"]', 'satin');
  });
  await page.click('[data-skin-cancel]');
  await page.click('#btn-workshop-garage'); await page.click('[data-part="wide"]');
  await shot('custom', 9, '#workshop-car-stage');
  await page.click('[data-workshop-section="performance"]');
  await page.click('[data-slot="tires"]'); await page.click('[data-recipe="street-slick"]');
  await page.waitForFunction(() => window.__game.showroom.specimenKey === 'street-slick');
  await shot('slick', 9, '#workshop-car-stage');
  await page.click('[data-recipe="slide-compound"]');
  await shot('slide', 7, '#workshop-car-stage');
  await page.click('[data-slot="engine"]'); await page.click('[data-recipe="street-turbo"]');
  await shot('turbo', 8, '#workshop-car-stage');
  await page.click('#workshop-back'); await page.click('#garage-back'); await page.click('#tour-back');
  await page.click('#btn-market-home');
  await page.waitForSelector('[data-select="edition:lagos-gold"]', { timeout: 45000 });
  await page.click('[data-select="edition:lagos-gold"]');
  await shot('market', 12, '#market-car-stage', async () => {
    await hold(3500); await page.click('[data-shot="side"]');
    await hold(3500); await page.click('[data-shot="rear"]');
  });
  await page.click('.mk-back'); await page.click('#btn-garage-menu');
  await page.click('#btn-garage-done');
  await page.waitForFunction(() => window.__game.state === 'racing', {}, { timeout: 45000 });
  await page.evaluate(() => {
    // Input assistance only. Do not edit positions, speed, score or finish order.
    window.__demoDriver = setInterval(() => {
      const g = window.__game;
      if (g.state !== 'racing') { g.input.uiGas = false; g.input.heldSteer = 0; return; }
      g.input.uiGas = true;
      g.input.heldSteer = Math.max(-1, Math.min(1, (g.player.x + 1.6) * .5));
    }, 30);
  });
  await shot('race-chase', 12, null, async () => { await hold(6500); await page.keyboard.press('Space'); });
  await page.keyboard.press('c'); await shot('race-low', 10);
  await page.keyboard.press('c'); await shot('race-high', 9);
  await page.keyboard.press('c'); await shot('race-driver', 9);
  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__game.state === 'finished', {}, { timeout: 240000 });
  await page.evaluate(() => { clearInterval(window.__demoDriver); window.__game.input.uiGas = false; window.__game.input.heldSteer = 0; });
  await shot('results', 7);
  await page.click('#btn-menu'); await shot('outro', 9, '#home-car-stage');
  console.log('Capture complete.');
} finally {
  if (audioStart !== null) {
    const b64 = await page.evaluate(() => window.__finishDemoAudio()).catch(() => null);
    if (b64) await writeFile(`${out}/game-audio.webm`, Buffer.from(b64, 'base64'));
  }
  await writeFile(`${out}/capture.json`, JSON.stringify({ base, width: 1920, height: 1080,
    network: 'testnet', audioStart: audioStart === null ? null : (audioStart - started) / 1000,
    driving: 'automated steering and gas through normal input; unmodified physics and results',
    purchases: 'previews only; HTTP writes blocked; no simulated receipts', shots, errors }, null, 2));
  const path = await video.path(); await context.close(); await copyFile(path, `${out}/capture.webm`);
  console.log(`Raw capture and edit markers: ${out}`);
}
