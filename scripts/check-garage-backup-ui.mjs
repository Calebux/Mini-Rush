// Isolated real-browser test. Disposable keys; every external request is mocked.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { KeyPair } from 'near-api-js';
const base = process.argv[2] ?? 'http://localhost:3000';
const out = '/tmp/minirush-garage-backup'; await mkdir(out,{recursive:true});
const a = { account:'backup-a.minirush-garage.testnet', key:KeyPair.fromRandom('ed25519') };
const b = { account:'backup-b.minirush-garage.testnet', key:KeyPair.fromRandom('ed25519') };
const password = 'demo-only long passphrase 42!';
const browser = await chromium.launch({channel:'chrome',headless:true});
const errors = [], writes = [], accessReads = [];
let access = 'full';
async function setup(driver, size) {
  const context = await browser.newContext({viewport:size,acceptDownloads:true});
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  await context.addInitScript(({account,key})=>{
    if (!['http:','https:'].includes(location.protocol)) return;
    if (localStorage.getItem('backup-test-initialized')) return;
    localStorage.setItem('backup-test-initialized','1');
    localStorage.setItem('minirush.near.account',account);localStorage.setItem('minirush.near.key',key);
    localStorage.setItem('minirush.welcomed','1');localStorage.setItem('minirush.controls-guide','1');
    localStorage.setItem('minirush.bank','47');
  },{account:driver.account,key:driver.key.toString()});
  await context.route('**/*',async route=>{
    const req=route.request(), url=new URL(req.url());
    const sent = req.url() + (req.postData() ?? '');
    assert.ok(![a.key.toString(),b.key.toString(),password].some(secret=>sent.includes(secret)), 'recovery never sends private keys or passwords');
    if(req.method()!=='POST') return url.origin===new URL(base).origin ? route.continue() : route.abort();
    let body;try{body=req.postDataJSON();}catch{return route.abort();}
    if(body.jsonrpc && body.method==='query') {
      let result;
      if(body.params.request_type==='view_access_key'){
        accessReads.push(body.params);
        if(access==='offline')return route.abort();
        const driver=[a,b].find(x=>x.account===body.params.account_id && x.key.getPublicKey().toString()===body.params.public_key);
        if(!driver || access==='revoked')return route.fulfill({json:{jsonrpc:'2.0',id:body.id,error:{code:-32000,message:'access key missing'}}});
        result={nonce:1,permission:access==='limited'?{FunctionCall:{receiver_id:'minirush-garage.testnet',method_names:['buy'],allowance:'1'}}:'FullAccess'};
      }else if(body.params.request_type==='view_account')result={amount:'2000000000000000000000000',storage_usage:200};
      else {
        const args=JSON.parse(Buffer.from(body.params.args_base64??'e30=','base64'));
        const value=body.params.method_name==='mt_tokens_for_owner'?[{token_id:args.account_id===a.account?'car:r8':'car:svj',balance:'1'}]:[];
        result={result:[...Buffer.from(JSON.stringify(value))],logs:[]};
      }
      return route.fulfill({json:{jsonrpc:'2.0',id:body.id,result}});
    }
    if(url.pathname==='/api/query')return route.fulfill({json:{status:'success',value:[]}});
    // Optional usage metrics are suppressed, too. No chain/backend action is sent.
    if(body.path?.startsWith('near:') || body.jsonrpc)writes.push(body.path??body.method);
    return route.abort();
  });
  const page=await context.newPage();await page.goto(base+'/?q=1',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__game?.state==='menu');
  return {context,page};
}
const account = page=>page.evaluate(async()=>(await import('/src/near.ts')).nearAccount());
const status = page=>page.locator('[data-protection-status]');
const inputFile = (page,buffer)=>page.locator('#garage-recovery-file').setInputFiles({name:'garage-recovery.json',mimeType:'application/json',buffer});
async function check(page,file,pass=password) {
  await inputFile(page,file);await page.fill('#garage-backup-password',pass);
  await page.click('[data-protection-form] button[type=submit]');
  await page.waitForFunction(()=>document.querySelector('#garage-protection').getAttribute('aria-busy')==='false');
}
try {
  const source=await setup(a,{width:1440,height:900});
  await source.page.click('[data-protect-garage]');
  await source.page.fill('#garage-backup-password',password);await source.page.fill('#garage-backup-confirm','a mismatched password');
  await source.page.click('[data-protection-form] button[type=submit]');assert.match(await status(source.page).textContent(),/do not match/);
  await source.page.fill('#garage-backup-confirm',password);await source.page.click('[data-protection-form] button[type=submit]');
  await source.page.waitForFunction(()=>document.querySelector('#garage-protection').getAttribute('aria-busy')==='false');
  assert.equal(await source.page.locator('[data-backup-download]').isVisible(),true,await status(source.page).textContent());
  assert.equal(await source.page.inputValue('#garage-backup-password'),'');
  await source.page.screenshot({path:out+'/protect-desktop.png'});
  const downloaded=source.page.waitForEvent('download');await source.page.click('[data-backup-download]');
  const file=await readFile(await (await downloaded).path());
  assert.ok(!file.toString().includes(a.key.toString()));
  await source.page.click('[data-protection-close]');assert.equal(await account(source.page),a.account);

  const target=await setup(b,{width:390,height:844}), page=target.page;
  await page.screenshot({path:out+'/home-mobile.png'});
  await page.click('[data-restore-garage]');
  await check(page,file,'incorrect password');assert.match(await status(page).textContent(),/password is incorrect/);assert.equal(await account(page),b.account);
  const changed=JSON.parse(file);changed.network='mainnet';await check(page,Buffer.from(JSON.stringify(changed)));assert.match(await status(page).textContent(),/not a supported/);
  access='offline';await check(page,file);assert.match(await status(page).textContent(),/Reconnect/);
  access='limited';await check(page,file);assert.match(await status(page).textContent(),/no longer has full access/);
  access='full';await check(page,file);assert.equal(await page.locator('[data-restore-account]').textContent(),a.account);
  assert.equal(await account(page),b.account,'checking never switches');
  await page.click('[data-restore-confirm]');assert.match(await status(page).textContent(),/acknowledge/);
  await page.locator('[data-restore-ack]').check();
  access='revoked';await page.click('[data-restore-confirm]');await page.waitForFunction(()=>document.querySelector('#garage-protection').getAttribute('aria-busy')==='false');
  assert.match(await status(page).textContent(),/no longer has full access/);assert.equal(await account(page),b.account,'revocation after preview prevents commit');
  access='full';
  await page.evaluate(()=>{window.__game.state='racing';});
  await page.click('[data-restore-confirm]');await page.waitForFunction(()=>document.querySelector('#garage-protection').getAttribute('aria-busy')==='false');
  assert.match(await status(page).textContent(),/home screen/);await page.evaluate(()=>{window.__game.state='menu';});
  await page.evaluate(account=>localStorage.setItem('minirush.near.pending-races.v2',JSON.stringify([{account,race:'fixture',progress:1,elapsed:45}])),b.account);
  await page.click('[data-restore-confirm]');await page.waitForFunction(()=>document.querySelector('#garage-protection').getAttribute('aria-busy')==='false');
  assert.match(await status(page).textContent(),/race rewards finish/);await page.evaluate(()=>localStorage.removeItem('minirush.near.pending-races.v2'));
  const sibling=await target.context.newPage();await sibling.goto(base+'/?q=1',{waitUntil:'networkidle'});
  await sibling.evaluate(()=>{window.__held=false;navigator.locks.request('minirush-garage-write',async()=>{window.__held=true;await new Promise(r=>window.__release=r);});});
  await sibling.waitForFunction(()=>window.__held);
  await page.click('[data-restore-confirm]');await page.waitForFunction(()=>document.querySelector('#garage-protection').getAttribute('aria-busy')==='false');
  assert.match(await status(page).textContent(),/another tab/);await sibling.evaluate(()=>window.__release());
  await page.evaluate(()=>{window.__storageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='minirush.near.credentials.v1')throw new Error('Test storage quota failure');return window.__storageSet.call(this,k,v);};});
  await page.click('[data-restore-confirm]');await page.waitForFunction(()=>document.querySelector('#garage-protection').getAttribute('aria-busy')==='false');
  assert.equal(await account(page),b.account,'quota failure keeps old account');
  await page.evaluate(()=>{Storage.prototype.setItem=window.__storageSet;});
  await page.screenshot({path:out+'/restore-mobile.png'});
  assert.equal(await page.locator('#garage-protection').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  // Closing and reopening clears all decrypted preview state.
  await page.click('[data-protection-close]');await page.click('[data-restore-garage]');
  assert.equal(await page.locator('[data-protection-preview]').isVisible(),false);assert.equal(await page.inputValue('#garage-backup-password'),'');
  await check(page,file);await page.locator('[data-restore-ack]').check();
  await page.screenshot({path:out+'/restore-ready-mobile.png'});
  await Promise.all([page.waitForEvent('domcontentloaded'),page.click('[data-restore-confirm]')]);
  await page.waitForFunction(async()=>!!window.__game && (await import('/src/near.ts')).nearAccount()==='backup-a.minirush-garage.testnet');
  await page.waitForFunction(async()=>(await import('/src/economy.ts')).owned().has('r8'));
  assert.equal(await page.evaluate(async()=>(await import('/src/economy.ts')).owned().has('svj')),false,'old account chain cars do not leak');
  assert.equal(await page.evaluate(()=>localStorage.getItem('minirush.bank')),'47','device-local coins stay local');
  await sibling.waitForFunction(()=>document.querySelector('[data-home-session-label]')?.textContent.includes('BACKUP-A'));
  assert.equal(await account(sibling),a.account,'other tab reloads to restored account');
  await page.screenshot({path:out+'/restored-home-mobile.png'});
  assert.ok(accessReads.length>=8);assert.deepEqual(writes,[],'all recovery operations are reads');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:['real Web Crypto download','wrong password','wrong network','offline','restricted key','revoked key after preview','explicit switch','active race','pending rewards','cross-tab lock','storage failure','cancel cleanup','cross-device restore','fresh ownership cache','cross-tab reload','mobile layout'],screenshots:out}));
} finally {await browser.close();}
