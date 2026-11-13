// Hosted-build check: isolated local coins, no account creation or on-chain writes.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base=process.argv[2]??'https://minirush.site',out='/tmp/minirush-live-customization';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],backends=new Set();
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&/THREE.WebGLProgram|shader error/i.test(m.text())) errors.push(m.text());});
await page.route('**/*',r=>{
 const host=new URL(r.request().url()).hostname;
 if(host.endsWith('.convex.cloud')) backends.add(host);
 return r.request().method()==='POST'?r.abort():r.continue();
});
await page.addInitScript(()=>{
 localStorage.setItem('minirush.welcomed','1');localStorage.setItem('minirush.controls-guide','1');
 if(!localStorage.getItem('minirush.bank'))localStorage.setItem('minirush.bank','300');
});
try {
 await page.goto(base+'/?q=1',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__game?.state==='menu');
 await page.click('#btn-garage-menu');await page.click('[data-skin="1"]');
 await page.selectOption('[data-skin-option="pattern"]','stripes');
 await page.selectOption('[data-skin-option="finish"]','satin');
 await page.locator('[data-skin-color="color"]').evaluate(el=>{el.value='#168f82';el.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.waitForFunction(()=>window.__game.showroom.car.userData.skinDesign?.pattern==='stripes');
 assert.equal(await page.evaluate(()=>window.__game.carSpec(0).color),0xff2e8a);
 await page.click('[data-skin-save]');
 await page.waitForFunction(()=>document.querySelector('#skin-status').textContent.includes('equipped'));
 assert.equal(await page.evaluate(()=>localStorage.getItem('minirush.bank')),'220');
 await page.click('[data-skin-save]');
 assert.equal(await page.evaluate(()=>localStorage.getItem('minirush.bank')),'220');
 await page.screenshot({path:out+'/skin-desktop.png'});
 await page.reload({waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__game?.state==='menu');
 assert.equal(await page.evaluate(()=>window.__game.carSpec(0).skin.color),0x168f82);
 await page.click('#btn-garage-menu');await page.setViewportSize({width:390,height:844});
 await page.click('[data-skin="1"]');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:out+'/skin-mobile.png'});
 await page.click('[data-skin-cancel]');await page.click('#btn-garage-done');
 await page.waitForFunction(()=>window.__game.state==='racing');
 assert.equal(await page.evaluate(()=>window.__game.player.mesh.userData.skinDesign.color),0x168f82);
 await page.screenshot({path:out+'/skin-racing.png'});
 assert.ok(backends.has('precious-dalmatian-332.eu-west-1.convex.cloud'));
 assert.ok(![...backends].some(host=>host.includes('resilient-loris')));
 // Public economy data only; no relayed actions, mutations or RPC broadcasts.
 const economy=await browser.newPage();economy.on('pageerror',e=>errors.push(e.message));
 await economy.route('**/*',r=>{
   const req=r.request();if(req.method()!=='POST')return r.continue();
   let body;try{body=req.postDataJSON();}catch{return r.abort();}
   if(body?.jsonrpc&&['query','block','status'].includes(body.method))return r.continue();
   if(new URL(req.url()).pathname==='/api/query')return r.continue();
   return r.abort();
 });
 await economy.goto(base+'/economy/',{waitUntil:'domcontentloaded'});
 await economy.waitForFunction(()=>{const s=document.querySelector('#supply')?.textContent?.trim();return s&&s!=='—';},{},{timeout:30000});
 console.log('Live economy supply:',await economy.locator('#supply').textContent());
 assert.deepEqual(errors,[]);
 console.log('PASS: live domain, production backend, skin preview, local purchase, no duplicate charge, reload, mobile layout, saved skin racing, public economy reads. Screenshots: '+out);
}finally{await browser.close();}
