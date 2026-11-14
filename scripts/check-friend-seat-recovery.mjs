// Isolated real FriendRace UI with a simulated server that accepts a seat but
// loses its reply. No real backend, account creation or NEAR traffic.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const fixture=`
import {getFunctionName} from 'convex/server';
const key='fixture.friend-server';
export class ConvexClient {
 async mutation(ref,args){
  const method=getFunctionName(ref);
  if(method==='friends:command')return {now:Date.now()};
  const old=JSON.parse(localStorage.getItem(key)||'null');
  window.__requests??=[];window.__requests.push({method,...args});
  if(!old){
   localStorage.setItem(key,JSON.stringify({...args,slot:method==='friends:create'?0:1}));
   return new Promise(()=>{}); // Accepted remotely, response lost.
  }
  if(old.code!==args.code||old.token!==args.token)throw {data:'This race already has two drivers.'};
  return {slot:old.slot};
 }
 onUpdate(ref,args,callback,error){
  window.__releaseSeat=()=>error({data:"Join this room first."});
  const old=JSON.parse(localStorage.getItem(key));
  const player={name:'Driver',ready:false,loaded:false,seen:Date.now(),s:0,x:0,v:0,seq:-1,sampleAt:0,finishAt:null,dnf:false};
  queueMicrotask(()=>callback({code:args.code,round:1,state:'lobby',startAt:0,expiresAt:Date.now()+60000,slot:old.slot,players:old.slot===0?[player]:[player,player]}));
  return ()=>{};
 }
 async close(){}
}`;
const server=await createServer({configFile:false,appType:'custom',define:{'import.meta.env.VITE_CONVEX_URL':JSON.stringify('https://fixture.invalid')},
 plugins:[{name:'friend-seat-fixture',enforce:'pre',resolveId(id){if(id==='convex/browser')return '\0friend-fixture';},load(id){if(id==='\0friend-fixture')return fixture;},
 configureServer(s){s.middlewares.use((req,res,next)=>{
  if(!req.url?.startsWith('/__friend-seat-test'))return next();
  res.setHeader('Content-Type','text/html');res.end('<button id="btn-friends">Friends</button><script type="module">import {FriendRace} from "/src/friendRace.ts";window.__friends=new FriendRace({prepare:async()=>{},update:()=>{},exit:()=>{}});</script>');
 });}}],server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
await server.listen();
const base=`http://127.0.0.1:${server.httpServer.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const mode of ['retry','reload','blocked-storage','create-reload']){
  const context=await browser.newContext();const page=await context.newPage();
  await page.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  await page.addInitScript(blocked=>{
   const timeout=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>timeout(fn,ms===15000?100:ms,...args);
   if(blocked)Storage.prototype.setItem=new Proxy(Storage.prototype.setItem,{apply(target,self,args){if(self===sessionStorage)throw new Error('storage blocked');return Reflect.apply(target,self,args);}});
  },mode==='blocked-storage');
  const creating=mode==='create-reload';
  await page.goto(base+'/__friend-seat-test'+(creating?'':'?race=AABBCCDD'));
  await page.waitForFunction(()=>!!window.__friends);
  if(creating){await page.click('#btn-friends');await page.click('[data-friend="create"]');}
  else await page.click('form button');
  await page.waitForFunction(()=>document.querySelector('[data-friend-message]').textContent.includes('Connection interrupted'));
  const accepted=await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture.friend-server')));
  if(mode!=='blocked-storage')assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('minirush.friend-seat')).token),accepted.token,'seat persisted before reply');
  if(mode.includes('reload'))await page.reload();
  else await page.click('form button');
  await page.waitForFunction(()=>!!window.__friends?.room);
  assert.equal(await page.evaluate(()=>window.__friends.token),accepted.token);
  assert.equal(await page.evaluate(()=>window.__friends.slot),creating?0:1);
  assert.equal(await page.evaluate(()=>window.__friends.room.code),accepted.code);
  if(creating)assert.equal(await page.evaluate(()=>window.__requests[0].method),'friends:create','unfinished creation retries its original room');
  if(mode==='retry'){
   await page.evaluate(()=>window.__releaseSeat());
   assert.equal(await page.evaluate(()=>window.__friends.room),null);
   assert.equal(await page.locator('[data-friend-setup]').isVisible(),true);
   await page.click('form button');
   await page.waitForFunction(()=>!!window.__friends.room);
   assert.equal(await page.evaluate(()=>window.__friends.token),accepted.token);
  }
  await page.click('[data-friend="leave"]');
  assert.equal(await page.evaluate(()=>window.__friends.seat),null,'explicit leave clears pending credentials');
  console.log('PASS:',mode,'reuses accepted seat after lost reply');
  await context.close();
 }
}finally{await browser.close();await server.close();}
