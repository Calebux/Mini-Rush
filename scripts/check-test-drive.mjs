// Browser acceptance with isolated NEAR/backend fixtures. Short driven samples
// test the real physics; synthetic finishes exercise reports, not lap validity.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base = process.argv[2] ?? 'http://127.0.0.1:5174';
const out = '/tmp/minirush-test-drive'; await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], writes = [];
page.on('pageerror', e => errors.push(e.message));
const account = 'driver.minirush-garage.testnet';
await page.addInitScript(() => {
 localStorage.setItem('minirush.controls-guide','1'); localStorage.setItem('minirush.welcomed','1');
});
await page.route('**/*', async route => {
 const req = route.request(); if (req.method() !== 'POST') return route.continue();
 let body; try { body = req.postDataJSON(); } catch { return route.abort(); }
 if (body.jsonrpc) {
  const value = body.params?.method_name === 'component_inventory'
   ? [{ id:'component:1', recipe_id:'street-slick', owner:account, maker:account, installed_on:'viper', price:null, offer:0, created_ms:0 }]
   : body.params?.method_name === 'mt_tokens_for_owner' ? [{token_id:'part:nitro-can',balance:'3'}] : [];
  return route.fulfill({json:{jsonrpc:'2.0',id:body.id,result:{result:[...Buffer.from(JSON.stringify(value))],logs:[]}}});
 }
 writes.push(body.path);
 const value = body.path === 'near:createPlayer' ? {account,welcome:0,created:true} : body.path === 'near:beginRace' ? 'ordinary-race' : [];
 return route.fulfill({json:{status:'success',value}});
});
const snapshot = () => page.evaluate(() => {
 const g = window.__game;
 return {mode:g.modeIndex,map:g.mapIndex,seed:g.seedCounter,laps:g.laps,
   storage:Object.fromEntries(Object.entries(localStorage).filter(([k])=>!/near|controls|tutorial|welcomed|quality/.test(k)))};
});
const drive = async () => {
 await page.waitForFunction(() => window.__game.state === 'racing');
 await page.keyboard.down('ArrowUp');
 await page.waitForFunction(() => window.__game.testDrive.telemetry.launch !== null);
 await page.keyboard.up('ArrowUp');
};
const finish = time => page.evaluate(time => { const g=window.__game; g.raceTime=time; g.player.s=g.player.raceLength; g.finishRace(); },time);
try {
 await page.goto(`${base}/?q=1`,{waitUntil:'networkidle'});
 await page.waitForFunction(() => window.__game?.state === 'menu');
 await page.waitForFunction(() => window.__game.carSpec(0).grip === 1.08);
 await page.click('#btn-garage-menu');
 // A class restriction must not prevent testing an owned car, or disappear on return.
 await page.evaluate(async () => { const g=window.__game; const {MODES}=await import('/src/modes.ts'); const i=MODES.findIndex(m=>m.id==='hypercup'); g.setMode(i); g.ui.setMode(i); });
 const before = await snapshot(); writes.length=0;
 await page.click('#btn-test-drive');
 await page.screenshot({path:`${out}/briefing-desktop.png`});
 assert.match(await page.locator('.td-profile').textContent(),/Corner specialist/);
 await page.click('[data-test=fitted]');
 await page.waitForFunction(() => window.__game.state === 'racing');
 await page.waitForTimeout(200);
 assert.equal(await page.evaluate(()=>window.__game.player.v),0,'waits at rest for throttle');
 assert.deepEqual(await page.evaluate(()=>{ const g=window.__game; return [g.rivals.rivals.length,g.traffic.cars.length,g.scenery.rampS.length,g.entities.pickups.length,g.weather.gripMul,g.rewardRace,g.player.speedMul,g.player.spec.grip,g.track.length]; }),[0,0,0,0,1,null,.97,1.08,908]);
 await drive();
 assert.ok(await page.evaluate(()=>window.__game.testDrive.telemetry.peak)>100);
 await page.keyboard.press('Space');
 await page.waitForFunction(()=>window.__game.testDrive.telemetry.boostUsed);
 await page.screenshot({path:`${out}/driving-desktop.png`});
 await page.click('[data-test=pause]');
 const pausedTime=await page.evaluate(()=>window.__game.raceTime);
 await page.waitForTimeout(150);
 assert.equal(await page.evaluate(()=>window.__game.raceTime),pausedTime);
 await page.click('#btn-resume');
 await finish(32);
 await page.waitForSelector('#test-drive:not(.hidden)');
 await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>window.__game.paused),true);
 assert.match(await page.locator('.td-note').textContent(),/Nitro was used/);
 assert.match(await page.locator('.td-comparison').textContent(),/First completed/);
 await page.screenshot({path:`${out}/report-desktop.png`});
 await page.click('#test-drive [data-test=stock]');
 await drive();
 assert.deepEqual(await page.evaluate(()=>[window.__game.player.spec.speed,window.__game.player.spec.grip]),[1,1]);
 await finish(34);
 assert.match(await page.locator('.td-comparison').textContent(),/2.00s slower.*fitted build/);
 assert.match(await page.locator('.td-note').textContent(),/No nitro used/);
 for (const size of [{width:390,height:844},{width:360,height:640}]) {
  await page.setViewportSize(size);
  assert.equal(await page.locator('#test-drive').evaluate(e=>e.scrollWidth>e.clientWidth),false);
  await page.locator('#test-drive [data-test=exit]').scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/report-${size.width}.png`});
 }
 await page.click('#test-drive [data-test=restart]');
 await page.waitForFunction(()=>window.__game.state==='racing');
 assert.equal(await page.evaluate(()=>window.__game.testDrive.telemetry.launch),null);
 assert.equal(await page.evaluate(()=>window.__game.player.nitroTanks),1);
 await page.waitForTimeout(650);
 await page.screenshot({path:`${out}/driving-mobile.png`});
 await page.click('#test-drive-hud [data-test=restart]');
 await page.waitForFunction(()=>window.__game.state==='racing');
 assert.equal(await page.evaluate(()=>window.__game.practice.setup),'stock');
 await page.click('#test-drive-hud [data-test=exit]');
 assert.equal(await page.evaluate(()=>window.__game.practice),null);
 assert.equal(await page.locator('#garage').isVisible(),true);
 assert.equal(await page.locator('#btn-garage-done').isDisabled(),true,'original class restriction survives');
 assert.deepEqual(await snapshot(),before,'practice cannot write race progression or change saved setup');
 assert.equal(writes.some(p=>/near:(beginRace|raceProgress|relay)|post.*Run|leaderboard/i.test(p)),false,'no race rewards, inventory burns or board posts');
 await page.waitForTimeout(450); // let the existing HUD fade and showroom render settle
 assert.ok(await page.evaluate(()=>{const s=window.__game.showroom; return s.camera.position.distanceTo(s.bounds.getCenter(s.camera.position.clone()));}) <= 11.001,'short-screen garage camera stays inside the showroom walls');
 await page.screenshot({path:`${out}/garage-mobile.png`});
 // Cancel before driving and enter again: no temporary mode or stale report leaks.
 await page.click('#btn-test-drive'); await page.click('#test-drive [data-test=exit]');
 assert.deepEqual(await snapshot(),before);
 // Locked cars cannot enter the test drive through UI or the callback.
 await page.evaluate(()=>{const g=window.__game; g.setCar(1); g.ui.setCar(1);});
 assert.equal(await page.locator('#btn-test-drive').isDisabled(),true);
 await page.evaluate(()=>window.__game.openTestDrive());
 assert.equal(await page.evaluate(()=>window.__game.practice),null);
 // An ordinary race still uses its actual selected mode and opens a reward session.
 await page.evaluate(()=>{const g=window.__game; g.setCar(0); g.ui.setCar(0); g.setMode(0); g.ui.setMode(0);});
 await page.click('#btn-garage-done');
 await page.waitForFunction(()=>window.__game.state==='countdown');
 assert.equal(await page.evaluate(()=>window.__game.rewardRace !== null),true);
 assert.equal(await page.evaluate(()=>window.__game.rivals.rivals.length),3);
 assert.deepEqual(errors,[]);
 console.log('PASS: actual launch telemetry, fitted/stock physics, restart/pause/exit, mobile report, selection restoration, no practice rewards or consumable burns, and normal-race isolation.');
 console.log(`Screenshots: ${out}`);
} finally { await browser.close(); }
