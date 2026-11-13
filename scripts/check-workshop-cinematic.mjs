// Visual and interaction checks only. Every POST is blocked: no accounts or transactions.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base=process.argv[2]??'http://localhost:3000', out='/tmp/minirush-cinematic-workshop';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',r=>r.request().method()==='POST'?r.abort():r.continue());
await page.addInitScript(()=>{localStorage.setItem('minirush.welcomed','1');localStorage.setItem('minirush.controls-guide','1');});
try{
 await page.goto(`${base}/?q=1`,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__game?.state==='menu');
 await page.click('#btn-garage-menu');await page.click('#btn-workshop-garage');
 await page.click('[data-part="wide"]');
 await page.waitForTimeout(1000);
 assert.equal(await page.locator('#workshop-parts svg').count(),3);
 assert.match(await page.locator('#workshop-style-detail').textContent(),/NO STAT ADVANTAGE/);
 await page.screenshot({path:`${out}/customize-desktop.png`});
 await page.click('[data-workshop-section="performance"]');
 await page.click('[data-slot="tires"]');
 for(const [id,tag,stat] of [['street-slick','CORNER SPECIALIST','+8%'],['slide-compound','SLIDE / BOOST','−7%'],['low-drag','STRAIGHT-LINE SPECIALIST','+3%']]){
  await page.click(`[data-recipe="${id}"]`);
  await page.waitForFunction(id=>window.__game.showroom?.specimenKey===id,id);
  await page.waitForTimeout(900);
  assert.match(await page.locator('#workshop-spotlight').textContent(),new RegExp(tag));
  assert.ok((await page.locator('.ws-tradeoffs').textContent()).includes(stat));
  assert.equal(await page.evaluate(()=>window.__game.carSpec(0).grip),1,'preview does not equip');
  assert.equal(await page.evaluate(()=>window.__game.showroom.car.visible),false);
  await page.screenshot({path:`${out}/${id}-desktop.png`});
 }
 await page.click('[data-part-view="car"]');
 await page.waitForFunction(()=>!window.__game.showroom.specimen&&window.__game.showroom.car.visible);
 await page.click('[data-part-view="part"]');
 await page.waitForFunction(()=>!!window.__game.showroom.specimen);
 await page.evaluate(()=>window.dispatchEvent(new Event('minirush:session')));
 await page.waitForFunction(()=>window.__game.showroom.specimenKey==='low-drag');
 assert.equal(await page.locator('#workshop-car-stage').getAttribute('data-view'),'part','session changes preserve the performance preview');
 await page.click('#workshop-car-stage [data-home-motion]');
 assert.equal(await page.locator('#workshop-car-stage').getAttribute('data-orbit'),'false');
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.waitForFunction(()=>document.querySelector('#workshop-car-stage [data-home-motion]').disabled);
 await page.waitForTimeout(150);
 const angle=await page.evaluate(()=>window.__game.showroom.angle);
 await page.waitForTimeout(400);
 assert.ok(Math.abs(angle-await page.evaluate(()=>window.__game.showroom.angle))<.003);
 for(const [slot,id] of [['engine','street-turbo'],['gearbox','short-ratio'],['nitro','long-bottle']]){
  await page.click(`[data-slot="${slot}"]`);await page.click(`[data-recipe="${id}"]`);
  await page.waitForFunction(id=>window.__game.showroom.specimenKey===id,id);
  await page.screenshot({path:`${out}/${slot}-desktop.png`});
 }
 await page.click('[data-slot="tires"]');await page.click('[data-recipe="street-slick"]');
 for(const width of [390,360]){
  await page.setViewportSize({width,height:844});
  await page.locator('#workshop').evaluate(el=>el.scrollTop=0);
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`${out}/tires-${width}.png`});
  await page.locator('.ws-tradeoffs').scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/details-${width}.png`});
 }
 await page.click('#workshop-back');
 await page.waitForFunction(()=>!window.__game.showroom.specimen&&window.__game.showroom.car.visible);
 assert.deepEqual(errors,[]);
 console.log('PASS: part identity, 3D inspection, unchanged driving stats, car toggle, pause, reduced motion, model disposal and mobile layouts. Screenshots: '+out);
}finally{await browser.close();}
