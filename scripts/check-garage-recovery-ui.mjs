// Isolated browser test: all backend writes and NEAR RPC calls are intercepted.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import * as borsh from 'borsh';
import { SCHEMA } from 'near-api-js';
const out='/tmp/minirush-garage-recovery';await mkdir(out,{recursive:true});
const account='recovery-player.testnet', journalKey='minirush.garage-actions.v1';
let held=[{token_id:'rush',balance:'5000'}], effectCount=0, requests=[], responseLost=true, reject=false, rewardReady=false, rewarded=0;
const receipts=new Map(), errors=[];
const listings=[{token_id:'car:r8',kind:'car',name:'AURORA V10',dealer:'oga-motors.testnet',price:'1800',stock:4,sold:0,reason:'Four available.',updated_ms:Date.now()}];
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{localStorage.setItem('minirush.welcomed','1');localStorage.setItem('minirush.controls-guide','1');});
await page.route('**/*',async route=>{
 const req=route.request();if(req.method()!=='POST')return route.continue();
 let body;try{body=req.postDataJSON();}catch{return route.abort();}
 const ok=value=>route.fulfill({json:{status:'success',value}});
 if(body.jsonrpc){
  let result;
  if(body.method==='block')result={header:{height:100,hash:'11111111111111111111111111111111'}};
  else if(body.params.request_type==='view_access_key')result={nonce:requests.length+1,permission:'FullAccess'};
  else {const value=body.params.method_name==='mt_tokens_for_owner'?held:body.params.method_name==='listings'?listings:[];result={result:[...Buffer.from(JSON.stringify(value))],logs:[]};}
  return route.fulfill({json:{jsonrpc:'2.0',id:body.id,result}});
 }
 if(body.path==='near:createPlayer')return ok({account,created:true,welcome:0});
 if(body.path==='near:relayTracked'){
  const encoded=body.args.signedDelegate;requests.push(encoded);
  const d=borsh.deserialize(SCHEMA.SignedDelegate,Buffer.from(encoded,'base64'));
  assert.equal(d.delegateAction.actions[0].functionCall.methodName,'buy');
  if(reject)return ok({state:'failed',message:'Sold out. Please choose another listing.'});
  if(!receipts.has(encoded)){
   effectCount++;held[0].balance=String(Number(held[0].balance)-1800);held.push({token_id:'car:r8',balance:'1'});
   receipts.set(encoded,{state:'confirmed',tx:'recovered-purchase',value:'1800'});
  }
  if(responseLost)return route.abort('failed');
  return ok(receipts.get(encoded));
 }
 if(body.path==='near:beginRace')return ok('recovery-race');
 if(body.path==='near:raceProgress'){
  if(!rewardReady)return ok(null);
  if(!rewarded){rewarded++;held[0].balance=String(Number(held[0].balance)+24);}
  return ok({minted:24,alloy:2,circuit:1,tx:'recovered-reward'});
 }
 return ok([]);
});
try{
 await page.goto(process.argv[2]??'http://127.0.0.1:5174/?q=1',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__game?.state==='menu');
 await page.click('#btn-market-home');await page.waitForFunction(()=>document.querySelector('.mk-status')?.textContent==='Live dealer prices');
 await page.click('[data-select="car:r8"]');await page.click('.mk-buy');
 await page.waitForFunction(()=>document.querySelector('.mk-toast')?.textContent?.includes('still completing'));
 assert.equal(effectCount,1);
 assert.equal(await page.locator('.mk-buy').isDisabled(),true);
 assert.doesNotMatch(await page.locator('.mk-toast').textContent(),/is yours/);
 assert.equal(await page.evaluate(k=>JSON.parse(localStorage.getItem(k))[0].result.state,journalKey),'pending');
 await page.click('#market [data-garage-activity]');
 assert.match(await page.locator('#garage-activity').innerText(),/PROCESSING/);
 await page.screenshot({path:`${out}/pending-desktop.png`});
 responseLost=false;
 await page.reload({waitUntil:'networkidle'});
 await page.waitForFunction(k=>JSON.parse(localStorage.getItem(k))[0].result.state==='confirmed',journalKey);
 assert.equal(effectCount,1);assert.ok(requests.length>=2);assert.equal(new Set(requests).size,1,'recovery reuses the original signed action');
 await page.click('#btn-garage-menu');await page.click('#garage-owned-cars');
 assert.equal(await page.locator('[data-car-id="r8"]').isVisible(),true);
 await page.click('#garage [data-garage-activity]');
 assert.match(await page.locator('#garage-activity').innerText(),/COMPLETED/);
 assert.doesNotMatch(await page.locator('#garage-activity').innerText(),/NEAR|testnet|gas|wallet/,'chain details stay collapsed');
 await page.locator('#garage-activity li summary').click();
 assert.match(await page.locator('#garage-activity').innerText(),/NEAR testnet/);
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.locator('#garage-activity').evaluate(e=>e.scrollWidth>e.clientWidth),false);
 await page.screenshot({path:`${out}/completed-mobile.png`});
 await page.click('[data-activity-close]');
 const before=requests.length;
 const blocked=await page.evaluate(async k=>{
  const original=Storage.prototype.setItem;
  Storage.prototype.setItem=function(key,value){if(key===k)throw new Error('quota');return original.call(this,key,value);};
  try{await (await import('/src/near.ts')).relayed('buy',{token_id:'car:r8',max_price:'1800'});return false;}
  catch(e){return /Nothing was sent/.test(e.message);}finally{Storage.prototype.setItem=original;}
 },journalKey);
 assert.equal(blocked,true);assert.equal(requests.length,before,'storage failure blocks before submission');
 reject=true;
 const message=await page.evaluate(async()=>{try{await(await import('/src/near.ts')).relayed('buy',{token_id:'car:r8',max_price:'1800'});}catch(e){return e.message;}});
 assert.match(message,/Sold out/);assert.equal(effectCount,1);
 assert.equal(await page.evaluate(async()=> (await import('/src/near.ts')).hasPendingAction()),false);
 await page.evaluate(async()=>{const n=await import('/src/near.ts');const race=new n.RewardRace(500);window.__game.ui.completeRaceRewards('viper',()=>race.finish(500,60));});
 await page.waitForFunction(()=>document.querySelector('#race-rewards').dataset.status==='pending');
 rewardReady=true;
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await page.waitForFunction(()=>document.querySelector('#race-rewards').dataset.status==='confirmed');
 assert.equal(rewarded,1);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('minirush.near.pending-races.v2')).length),0);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,effects:effectCount,uniquePurchaseRequests:1,recoveredRewards:rewarded,screenshots:out},null,2));
}catch(err){
 console.error(await page.evaluate(()=>({status:document.querySelector('#race-rewards')?.dataset.status,
  pendingRace:window.__game?.ui.rewards.pendingRace,claims:localStorage.getItem('minirush.near.pending-races.v2')})));
 throw err;
}finally{await browser.close();}
