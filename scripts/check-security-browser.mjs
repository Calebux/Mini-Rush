// Serve the production build with the actual Vercel security headers. Block all
// external requests and POSTs: this check cannot provision accounts or spend.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const root=resolve('dist');
const {headers:[{headers}]}=JSON.parse(await readFile('vercel.json','utf8'));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.wasm':'application/wasm','.mp3':'audio/mpeg'};
const server=createServer(async(req,res)=>{
 try{
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(root,'.'+path+(path.endsWith('/')?'index.html':''));
  if(!file.startsWith(root+sep))throw new Error('path');
  for(const {key,value} of headers)res.setHeader(key,value);
  res.setHeader('Content-Type',types[extname(file)]??'application/octet-stream');res.end(await readFile(file));
 }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().method()==='POST'||new URL(r.request().url()).origin!==origin?r.abort():r.continue());
 await page.addInitScript(()=>{
  window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push({directive:e.effectiveDirective,blocked:e.blockedURI.slice(0,100)}));
  localStorage.setItem('minirush.welcomed','1');localStorage.setItem('minirush.controls-guide','1');localStorage.setItem('minirush.bank','300');
 });
 const response=await page.goto(origin+'/?q=1',{waitUntil:'networkidle'});
 assert.equal(response.headers()['x-frame-options'],'DENY');
 await page.waitForFunction(()=>window.__game?.state==='menu');
 await page.click('#btn-garage-menu');await page.click('[data-skin="1"]');
 await page.selectOption('[data-skin-option="pattern"]','stripes');
 await page.click('[data-skin-save]');
 await page.waitForFunction(()=>document.querySelector('#skin-status').textContent.includes('equipped'));
 assert.equal(await page.evaluate(()=>localStorage.getItem('minirush.bank')),'220');
 await page.click('[data-skin-cancel]');await page.click('#btn-garage-done');
 await page.waitForFunction(()=>window.__game.state==='racing');
 assert.equal(await page.evaluate(()=>window.__game.player.mesh.userData.skinDesign.pattern),'stripes');
 assert.deepEqual(await page.evaluate(()=>window.__csp),[],'normal game must comply with CSP');
 // An injected inline executable script is blocked, even if inserted through DOM.
 await page.evaluate(()=>{const s=document.createElement('script');s.textContent='window.__injected=true';document.head.append(s);});
 await page.waitForFunction(()=>window.__csp.some(v=>v.directive==='script-src-elem'));
 assert.equal(await page.evaluate(()=>window.__injected),undefined);
 for(const path of ['/economy/','/stats/']){
  await page.goto(origin+path,{waitUntil:'networkidle'});
  assert.deepEqual(await page.evaluate(()=>window.__csp),[],`${path} must comply with CSP`);
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: production security headers, home/garage/skin purchase/racing/economy/stats under CSP, injected inline script rejected. All external traffic blocked.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
