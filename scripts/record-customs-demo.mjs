// Capture real UI/physics for an edited demo. Uses a dedicated demo browser,
// allows public reads, and blocks HTTP writes. Never use a personal profile.
// node scripts/record-customs-demo.mjs [http://localhost:3000]
import { chromium } from 'playwright';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.argv[2] ?? 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const out = '/tmp/minirush-customs-demo';
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
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:35}); await hold(450);
}
async function click(selector) { await point(selector); await page.mouse.down(); await hold(100); await page.mouse.up(); await hold(650);
  if(selector.startsWith('[data-part=') || selector.startsWith('[data-recipe=')) await page.waitForFunction(sel=>document.querySelector(sel)?.getAttribute('aria-pressed')==='true',selector);
}
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
  await click('#btn-garage-menu');
  await shot('custom',12,null,async()=>{
    await click('#btn-workshop-garage');
    await page.waitForSelector('#workshop .ws-card');
    await hold(1800);await click('[data-part="wide"]');
  });
  await shot('wheels',10,null,async()=>{await click('#workshop-tabs [data-slot="wheels"]');await click('[data-part="turbine"]');await hold(1500);await click('[data-part="disc"]');});
  await shot('wing',10,null,async()=>{await click('#workshop-tabs [data-slot="wing"]');await click('[data-part="gt"]');});
  await shot('paint',12,null,async()=>{await click('#workshop-tabs [data-slot="paint"]');await click('[data-part="lagoon"]');await hold(2000);await click('[data-part="graphite"]');});
  await shot('tune',10,null,async()=>{await click('#workshop-tabs [data-slot="power"]');await click('[data-part="sprint"]');await hold(2000);await click('[data-part="touring"]');});
  await shot('build',8,null,async()=>{
    await point('#workshop-car-stage');
    await page.mouse.move(700,650,{steps:20});await page.mouse.down();await page.mouse.move(1000,650,{steps:50});await page.mouse.up();
    await point('#workshop-save');
  });
  await shot('slick',12,null,async()=>{
    await click('[data-workshop-section="performance"]');await click('#workshop-performance [data-slot="tires"]');await click('[data-recipe="street-slick"]');
    await page.waitForFunction(()=>window.__game.showroom.specimenKey==='street-slick');
  });
  await shot('slide',10,null,async()=>{await click('[data-recipe="slide-compound"]');});
  await shot('lowdrag',12,null,async()=>{await click('[data-recipe="low-drag"]');await hold(2500);await click('[data-part-view="car"]');await hold(1500);await click('[data-part-view="part"]');});
  await shot('turbo',10,null,async()=>{await click('#workshop-performance [data-slot="engine"]');await click('[data-recipe="street-turbo"]');});
  await shot('trade',12,null,async()=>{await click('[data-page="exchange"]');await click('[data-market="orders"]');});
  console.log('Capture complete.');
} finally {
  if (audioStart !== null) {
    const b64 = await page.evaluate(() => window.__finishDemoAudio()).catch(() => null);
    if (b64) await writeFile(`${out}/game-audio.webm`, Buffer.from(b64, 'base64'));
  }
  await writeFile(`${out}/capture.json`, JSON.stringify({ base, width: 1920, height: 1080,
    network: 'testnet', audioStart: audioStart === null ? null : (audioStart - started) / 1000,
    driving: 'no driving in this capture; current Customs Shop preview only',
    purchases: 'previews only; HTTP writes blocked; no simulated receipts', shots, errors }, null, 2));
  const path = await video.path(); await context.close(); await copyFile(path, `${out}/capture.webm`);
  console.log(`Raw capture and edit markers: ${out}`);
}
