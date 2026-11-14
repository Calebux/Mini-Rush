// Real testnet account, one faucet grant, and one limited-edition purchase.
// Dedicated disposable demo profile only. Never print or export its private key.
// node scripts/record-account-demo.mjs --send [http://localhost:3000]
import { chromium } from 'playwright';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

if(!process.argv.includes('--send')) throw new Error('Pass --send to authorize the testnet recording.');
const base = process.argv.slice(2).find(a=>a.startsWith('http')) ?? 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const out = '/tmp/minirush-account-demo';
await mkdir(out, { recursive: true });
const context = await chromium.launchPersistentContext('/tmp/minirush-account-demo-browser', {
  channel: 'chrome', headless: true,
  viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  recordVideo: { dir: out, size: { width: 1920, height: 1080 } }
});
let allowPurchase = false;
await context.route('**/*', async route => {
  const req=route.request(); if(req.method()!=='POST')return route.continue();
  let body;try{body=req.postDataJSON();}catch{return route.abort();}
  if(body?.jsonrpc){
    if(!/testnet|test\.rpc/.test(req.url()))return route.abort();
    if(['query','block','status','tx','EXPERIMENTAL_tx_status'].includes(body.method))return route.continue();
    if(allowPurchase && ['broadcast_tx_commit','broadcast_tx_async','send_tx'].includes(body.method))return route.continue();
    return route.abort();
  }
  if(new URL(req.url()).pathname==='/api/query')return route.continue();
  if(['near:createPlayer','near:testNear'].includes(body?.path))return route.continue();
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
const shots = [], errors = [], receipts = [];
const evidence={network:"testnet",receipts};
page.on("response",async response=>{
  try {
    const req=response.request();if(req.method()!=="POST")return;
    const body=req.postDataJSON();
    if(body?.path==="near:testNear"){const result=await response.json();if(result.value?.tx)receipts.push({kind:"faucet",tx:result.value.tx});}
    if(body?.jsonrpc && ["send_tx","broadcast_tx_commit"].includes(body.method)){const result=await response.json();if(result.result?.transaction?.hash)receipts.push({kind:"purchase",tx:result.result.transaction.hash});}
  }catch{}
});
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
  assert.equal(await page.evaluate(async()=> (await import('/src/near.ts')).GARAGE), 'minirush-garage.testnet');
  await page.waitForFunction(async()=>!!(await import('/src/near.ts')).nearAccount(),{}, {timeout:90000});
  evidence.account=await page.evaluate(async()=>await (await import('/src/near.ts')).ensureAccount());
  assert.ok(evidence.account?.endsWith('.minirush-garage.testnet'));
  evidence.before=await page.evaluate(async()=>{const n=await import('/src/near.ts');return {desk:await n.editionDesk(),spendable:(await n.nearSpendable()).toString()};});
  assert.equal(evidence.before.desk.mine.length,0,'Fresh demo garage required; do not buy again on a retry.');
  const edition=evidence.before.desk.editions.find(e=>e.id==='island-night');
  assert.ok(edition && edition.minted<edition.size,'Island Night must be available.');
  assert.ok(BigInt(edition.price)<=750000000000000000000000n,'Demo purchase limited to 0.75 test NEAR.');
  await shot('account-home',8,null,async()=>{await point('[data-home-session-copy]');});
  await shot('account-open',10,null,async()=>{await click('#btn-market-home');await page.waitForSelector('[data-near-wallet]:not([hidden])',{timeout:45000});await click('[data-near-wallet]');});
  await shot('account-address',9,null,async()=>{await point('.mk-wallet code');});
  await shot('account-faucet',7,null,async()=>{await click('[data-test-near]');});
  await page.waitForFunction(()=>document.querySelector('.mk-wallet-note')?.textContent?.includes('Test NEAR added'),{}, {timeout:90000});
  evidence.funded=(await page.evaluate(async()=>(await import('/src/near.ts')).nearSpendable())).toString();
  await shot('account-funded',7,null,async()=>{await point('.mk-wallet .mk-price');});
  await click('[data-wallet-close]');
  await shot('account-car',10,null,async()=>{await click('[data-select="edition:island-night"]');await point('[data-edition-buy="island-night"]');});
  assert.match(await page.locator('[data-edition-buy="island-night"]').innerText(),/ACQUIRE/);
  allowPurchase=true;
  await shot('account-buy',7,null,async()=>{await click('[data-edition-buy="island-night"]');});
  await page.waitForSelector('.mk-own',{timeout:120000});
  allowPurchase=false;
  evidence.after=await page.evaluate(async()=>{const n=await import('/src/near.ts');return {desk:await n.editionDesk(),spendable:(await n.nearSpendable()).toString()};});
  const car=evidence.after.desk.mine.find(c=>c.edition_id==='island-night');
  assert.ok(car && car.owner===evidence.account,'Confirmed chain ownership required.');
  evidence.car=car;
  await shot('account-owned',10,null,async()=>{await point('.mk-own-head');});
  await shot('account-balance',8,null,async()=>{await click('[data-near-wallet]');});
  await click('[data-wallet-close]');
  await shot('account-about',10,null,async()=>{await click('.mk-activity');await click('.ga-about summary');});
  await click('[data-activity-close]');
  await click('.mk-back');
  await shot('account-garage',9,null,async()=>{await click('#btn-garage-menu');await click('#garage-owned-cars');});
  console.log('Capture complete.');
} finally {
  if (audioStart !== null) {
    const b64 = await page.evaluate(() => window.__finishDemoAudio()).catch(() => null);
    if (b64) await writeFile(`${out}/game-audio.webm`, Buffer.from(b64, 'base64'));
  }
  await writeFile(`${out}/capture.json`, JSON.stringify({ base, width: 1920, height: 1080,
    network: 'testnet', audioStart: audioStart === null ? null : (audioStart - started) / 1000,
    driving: 'no driving; real testnet account and purchase demonstration',
    purchases: 'one real Island Night edition, max 0.75 test NEAR; one faucet grant; no mainnet actions', shots, errors }, null, 2));
  await writeFile(`${out}/evidence.json`,JSON.stringify(evidence,null,2));
  const path = await video.path(); await context.close(); await copyFile(path, `${out}/capture.webm`);
  console.log(`Raw capture and edit markers: ${out}`);
}
