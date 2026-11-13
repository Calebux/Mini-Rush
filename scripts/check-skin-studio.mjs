// Isolated local purchases only: every POST is blocked.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { signedInDriver } from './auth-fixture.mjs';
const base = process.argv[2] ?? 'http://localhost:3000', out = '/tmp/minirush-skin-studio';
await mkdir(out, {recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:true});
const page = await browser.newPage({viewport:{width:1600,height:1000}});
const errors=[];
page.on('pageerror', e=>errors.push(e.message));
page.on('console', m=>{if(m.type()==='error' && /THREE.WebGLProgram|shader error/i.test(m.text())) errors.push(m.text());});
await page.route('**/*', r=>r.request().method()==='POST'?r.abort():r.continue());
await page.addInitScript(()=>{localStorage.setItem('minirush.welcomed','1');localStorage.setItem('minirush.controls-guide','1');});
const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('minirush.skins')??'{}'));
const colour=async (field,value)=>page.locator(`[data-skin-color="${field}"]`).evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},value);
try {
 await page.goto(base+'/?q=1',{waitUntil:'networkidle'});
 await signedInDriver(page);
 await page.waitForFunction(()=>window.__game?.state==='menu');
 await page.click('#btn-garage-menu');
 await page.click('[data-skin="1"]');
 assert.equal(await page.locator('[data-skin-save]').isDisabled(),true,'cannot overspend');
 assert.deepEqual(await saved(),{});
 await page.evaluate(()=>localStorage.setItem('minirush.bank','300'));
 await page.click('[data-skin="1"]');
 await page.selectOption('[data-skin-option="pattern"]','stripes');
 await page.selectOption('[data-skin-option="finish"]','satin');
 await colour('color','#168f82'); await colour('accent','#ffcc44');
 await page.waitForFunction(()=>window.__game.showroom?.car?.userData.skinDesign?.pattern==='stripes');
 assert.equal(await page.evaluate(()=>window.__game.carSpec(0).color),0xff2e8a,'draft never changes racing loadout');
 assert.equal(await page.evaluate(()=>localStorage.getItem('minirush.bank')),'300');
 await page.screenshot({path:out+'/preview-desktop.png'});
 await page.click('[data-skin-save]');
 await page.waitForFunction(()=>document.querySelector('#skin-status').textContent.includes('equipped'));
 assert.equal(await page.evaluate(()=>localStorage.getItem('minirush.bank')),'220');
 assert.equal((await saved()).designs.viper[1].accent,0xffcc44);
 assert.equal(await page.evaluate(()=>window.__game.carSpec(0).grip),1);
 await colour('accent','#ffffff'); await page.click('[data-skin-save]');
 assert.equal(await page.evaluate(()=>localStorage.getItem('minirush.bank')),'220','editing owned skins is free');
 await colour('color','#ff0000'); await page.click('[data-skin-cancel]');
 assert.equal((await saved()).designs.viper[1].color,0x168f82);
 await page.reload({waitUntil:'networkidle'}); await signedInDriver(page);
 await page.waitForFunction(()=>window.__game?.state==='menu');
 assert.equal(await page.evaluate(()=>window.__game.carSpec(0).skin.pattern),'stripes');
 await page.click('#btn-garage-menu');
 await page.screenshot({path:out+'/equipped-desktop.png'});
 for (const width of [390,360]) {
   await page.setViewportSize({width,height:844});
   await page.click('[data-skin="1"]');
   await page.locator('#skin-row').scrollIntoViewIfNeeded();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:out+`/studio-${width}.png`});
 }
 // Check that every offered chassis has a paint surface, not just a renamed UI swatch.
 const audit = await page.evaluate(async()=>{
   const {CARS}=await import('/src/cars.ts'),{disposeCarInstance}=await import('/src/assets.ts'),{supportsSkinDesign}=await import('/src/skins.ts');
   const rows=[];
   for (const c of CARS) {
     if (!supportsSkinDesign(c)) continue;
     await window.__game.assets.ensureCar(c);
     const root=window.__game.assets.cloneCar({...c,color:0x168f82,skin:{color:0x168f82,accent:0xffffff,pattern:'stripes',finish:'satin'}});
     let painted=0;const materials=[];
     root.traverse(o=>{if(o.isMesh) for(const m of Array.isArray(o.material)?o.material:[o.material]) {if(m.userData.skinPattern) painted++;else materials.push({name:m.name,role:m.userData.carRole,texture:!!m.map});}});
     rows.push({id:c.id,painted,...(!painted?{materials}: {})});disposeCarInstance(root);
   }
   return rows;
 });
 console.log('Paint-surface audit:',JSON.stringify(audit));
 assert.ok(audit.every(c=>c.painted>0),'every car offered skins must have paintable bodywork');
 const storageChecks = await page.evaluate(async()=>{
   const s=await import('/src/skins.ts');
   const d={color:0x168f82,accent:0xffffff,pattern:'stripes',finish:'satin'};
   const denied=s.saveSkinDesign('r8',1,d), unsupported=s.saveSkinDesign('gecko',1,d);
   const invalid=s.saveSkinDesign('viper',1,{...d,color:NaN}),duplicate=s.buySkin('viper',1);
   const unchanged=localStorage.getItem('minirush.bank');
   // Interrupt after ownership is stored but before the bank write, then recover twice.
   const setter=Storage.prototype.setItem;let fail=true;
   Storage.prototype.setItem=function(key,value){if(key==='minirush.bank'&&fail){fail=false;throw new Error('fixture storage interruption');}return setter.call(this,key,value);};
   let interrupted;try {interrupted=s.saveSkinDesign('viper',2,d);}finally {Storage.prototype.setItem=setter;}
   s.recoverSkinPurchase();s.recoverSkinPurchase();
   const recovered=localStorage.getItem('minirush.bank');
   s.saveSkinDesign('viper',1,d);
   const rushSaved=s.saveSkinDesign('rush-one',1,{...d,color:0xb8142a});
   const independent=s.activeColor('viper')===0x168f82 && s.activeColor('rush-one')===0xb8142a;
   s.saveSkinDesign('rush-one',0,d);
   const factory=s.activeColor('rush-one',0xffc531)===0xffc531;
   return {denied,unsupported,invalid,duplicate,unchanged,interrupted,recovered,rushSaved,independent,factory};
 });
 assert.match(storageChecks.denied,/Own this car/);assert.match(storageChecks.unsupported,/not available/);
 assert.match(storageChecks.invalid,/valid skin/);assert.equal(storageChecks.duplicate,false);
 assert.equal(storageChecks.unchanged,'220');assert.match(storageChecks.interrupted,/Could not save/);
 assert.equal(storageChecks.recovered,'140');assert.equal(storageChecks.rushSaved,null);
 assert.equal(storageChecks.independent,true);assert.equal(storageChecks.factory,true);
 await colour('color','#ff0000'); // Starting a race must discard this unsaved display colour.
 await page.click('#btn-garage-done');
 await page.waitForFunction(()=>window.__game.state==='racing');
 assert.equal(await page.evaluate(()=>window.__game.player.mesh.userData.skinDesign.pattern),'stripes');
 assert.equal(await page.evaluate(()=>window.__game.player.mesh.userData.skinDesign.color),0x168f82);
 await page.screenshot({path:out+'/skin-racing.png'});
 assert.deepEqual(errors,[]);
 console.log('PASS: preview isolation, affordability, purchase, free customization, cancel, persistence, cosmetic-only stats, mobile, paintable models and racing. Screenshots: '+out);
} finally { await browser.close(); }
