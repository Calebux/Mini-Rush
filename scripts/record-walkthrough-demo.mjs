// Capture real UI/physics for an edited demo. Uses a dedicated demo browser,
// allows public reads, and blocks HTTP writes. Never use a personal profile.
// node scripts/record-walkthrough-demo.mjs [http://localhost:3000]
import { chromium } from 'playwright';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.argv[2] ?? 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const out = '/tmp/minirush-walkthrough-demo';
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
// Cursor is recorded with the UI. Rings only fire on real pointer presses.
await context.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = `*{cursor:none!important}.demo-pointer{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 4px #0009)}.demo-click{position:fixed;width:54px;height:54px;border:3px solid #f4d29c;border-radius:50%;z-index:2147483646;pointer-events:none;transform:translate(-50%,-50%);animation:demo-pulse .8s ease-out forwards}@keyframes demo-pulse{from{opacity:1;scale:.4}to{opacity:0;scale:1.7}}`;
    document.head.append(style);
    const pointer = document.createElement('div'); pointer.className = 'demo-pointer';
    pointer.innerHTML = '<svg width="34" height="43" viewBox="0 0 34 43"><path d="M3 2L29 25L18 26L24 38L17 41L11 28L3 35Z" fill="#fff5dc" stroke="#171b18" stroke-width="2.5" stroke-linejoin="round"/></svg>';
    document.body.append(pointer);
    addEventListener('mousemove', e => { pointer.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; });
    addEventListener('pointerdown', e => {
      const ring = document.createElement('div'); ring.className = 'demo-click';
      ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px';
      document.body.append(ring); setTimeout(() => ring.remove(), 850);
    });
  });
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
async function point(selector) {
  const loc = page.locator(selector).first(); await loc.waitFor({state:'visible'});
  const b = await loc.boundingBox();
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:35}); await hold(450);
}
async function click(selector) { await point(selector); await page.mouse.down(); await hold(100); await page.mouse.up(); await hold(650); }
async function choose(selector,value) { await point(selector); await page.selectOption(selector,value); await hold(900); }
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
  await page.mouse.move(960,500);
  await shot('home', 11, null, async () => { await hold(1800); await point('#btn-play'); await hold(2000); await point('#home-build-goal'); });
  await shot('controls', 10, null, async () => { await click('#btn-how'); });
  await click('#btn-resume');
  await shot('route', 13, null, async () => { await click('#btn-play'); await hold(4000); await click('#btn-tour-done'); await hold(3000); await point('#btn-garage-done'); });
  await shot('start', 12, null, async () => {
    await click('#btn-garage-done');
    await page.waitForFunction(() => window.__game.state === 'racing', {}, {timeout:45000});
    await page.evaluate(() => {
      window.__demoDriver = setInterval(() => {
        const g = window.__game;
        if (g.state !== 'racing') { g.input.uiGas = false; g.input.heldSteer = 0; return; }
        g.input.uiGas = true; g.input.heldSteer = Math.max(-1, Math.min(1,(g.player.x+1.6)*.5));
      },30);
    });
    await page.mouse.move(1700,880,{steps:25});
  });
  await shot('drive', 11, null, async () => { await hold(3500); await page.keyboard.press('Space'); });
  await shot('camera', 12, null, async () => { await click('#btn-cam'); await hold(3500); await click('#btn-cam'); await hold(3000); await click('#btn-cam'); });
  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__game.state === 'finished', {}, {timeout:240000});
  await page.evaluate(() => { clearInterval(window.__demoDriver); window.__game.input.uiGas=false; window.__game.input.heldSteer=0; });
  await click('#btn-menu');
  await shot('garage', 10, null, async () => { await click('#btn-garage-menu'); await hold(2000); await point('[data-skin="1"]'); });
  await shot('skin', 17, null, async () => {
    await click('[data-skin="1"]'); await hold(1200);
    await choose('[data-skin-option="pattern"]','stripes'); await hold(2000);
    await point('[data-skin-color="color"]');
    await page.locator('[data-skin-color="color"]').evaluate(el => {el.value='#168f82';el.dispatchEvent(new Event('input',{bubbles:true}));});
    await hold(2000); await choose('[data-skin-option="finish"]','satin');
  });
  await click('[data-skin-cancel]');
  await shot('custom', 11, null, async () => { await click('#btn-workshop-garage'); await hold(2000); await click('[data-part="wide"]'); });
  await shot('performance', 16, null, async () => {
    await click('[data-workshop-section="performance"]'); await click('[data-slot="tires"]'); await click('[data-recipe="street-slick"]');
    await hold(5500); await click('[data-recipe="slide-compound"]');
  });
  await click('#workshop-back'); await click('#garage-back'); await click('#tour-back');
  await shot('market', 16, null, async () => {
    await click('#btn-market-home'); await page.waitForSelector('[data-select="edition:lagos-gold"]',{timeout:45000});
    await click('[data-select="edition:lagos-gold"]'); await hold(3500); await click('[data-shot="side"]'); await hold(2500); await click('[data-shot="rear"]');
  });
  await click('.mk-back');
  await shot('outro', 10, null, async () => { await point('#btn-play'); });
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
