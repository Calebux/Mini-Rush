// UI uses an isolated backend fixture. Rust tests validate real contract settlement.
// All browser POSTs are intercepted: no accounts or transactions are sent to NEAR.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import * as borsh from 'borsh';
import { SCHEMA } from 'near-api-js';
import { dealerOrderPlan, orderPayout } from '../shared/dealerOrders.ts';
const recipes = JSON.parse(await readFile(new URL('../shared/components.json', import.meta.url)));
const dealer = 'mama-t.minirush-garage.testnet', me = 'builder.minirush-garage.testnet';
const plan = dealerOrderPlan(dealer, recipes, [], 500);
assert.equal(plan.order.quantity, 2);
assert.equal(recipes.find(r => r.id === plan.order.recipe_id).slot, 'tires');
assert.ok(Number(plan.order.price) * plan.order.quantity <= 250);
assert.equal(dealerOrderPlan(dealer, recipes, [], 0).order, null);
assert.equal(dealerOrderPlan(dealer, recipes, [], 10).order, null);
const dealerStock = [{ id:'component:1', recipe_id:plan.order.recipe_id, price:null }];
const stocked = dealerOrderPlan(dealer, recipes, dealerStock, 500);
assert.notEqual(stocked.order.recipe_id,plan.order.recipe_id,'next purchase responds to changed inventory');
assert.ok(orderPayout(stocked.listings[0].price) > Number(plan.order.price),'resale covers acquisition including fees');
const full = recipes.filter(r=>r.slot==='tires').flatMap(r=>Array.from({length:2},(_,i)=>({id:`${r.id}-${i}`,recipe_id:r.id,price:null})));
assert.equal(dealerOrderPlan(dealer,recipes,full,5000).order,null,'sufficient inventory stops purchasing');
assert.ok(dealerOrderPlan(dealer,recipes,full.slice(1),5000).order,'sale reopens demand');
assert.equal(recipes.find(r=>r.id===dealerOrderPlan('oga-motors.testnet',recipes,[],500).order.recipe_id).slot,'engine');
assert.equal(recipes.find(r=>r.id===dealerOrderPlan('tuner-ade.testnet',recipes,[],500).order.recipe_id).slot,'nitro');

const base = process.argv[2] ?? 'http://127.0.0.1:5174', out = '/tmp/minirush-dealer-orders';
await mkdir(out,{recursive:true});
let orders = [{dealer,recipe_id:'street-slick',revision:1,price:'100',remaining:2,expires_ms:Date.now()+3600000,reason:'No street slicks on my shelf. Buying two from local builders.'}];
let inventory=[], offers=[], balance={rush:180,'material:alloy':12,'material:circuit':6};
let unavailable=false, reject=false, calls=[], errors=[], serial=0;
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{localStorage.setItem('minirush.controls-guide','1');localStorage.setItem('minirush.welcomed','1');});
await page.route('**/*',async route=>{
  const req=route.request(); if(req.method()!=='POST') return route.continue();
  let body; try {body=req.postDataJSON();} catch{return route.abort();}
  const ok=value=>route.fulfill({json:{status:'success',value}});
  if(body.jsonrpc){
    let result;
    if(body.method==='block') result={header:{height:100,hash:'11111111111111111111111111111111'}};
    else if(body.params.request_type==='view_access_key') result={nonce:1,permission:'FullAccess'};
    else {
      if(body.params.method_name==='component_orders' && unavailable) return route.fulfill({json:{error:{message:'Method unavailable'}}});
      const values={component_inventory:inventory,component_offers:offers,component_orders:orders,
        mt_tokens_for_owner:Object.entries(balance).map(([token_id,n])=>({token_id,balance:String(n)})),listings:[]};
      result={result:[...Buffer.from(JSON.stringify(values[body.params.method_name]??[]))],logs:[]};
    }
    return route.fulfill({json:{jsonrpc:'2.0',id:body.id,result}});
  }
  if(body.path==='near:createPlayer') return ok({account:me,welcome:0,created:true});
  if(body.path==='near:relayTracked'){
    const d=borsh.deserialize(SCHEMA.SignedDelegate,Buffer.from(body.args.signedDelegate,'base64'));
    const call=d.delegateAction.actions[0].functionCall, args=JSON.parse(Buffer.from(call.args).toString());
    calls.push({method:call.methodName,args});
    if(call.methodName==='craft_component'){
      const r=recipes.find(r=>r.id===args.recipe_id);
      balance.rush-=r.rush; balance['material:alloy']-=r.alloy; balance['material:circuit']-=r.circuit;
      inventory.push({id:`component:${++serial}`,recipe_id:r.id,owner:me,maker:me,created_ms:Date.now(),installed_on:null,price:null,offer:0});
    } else if(call.methodName==='fill_component_order'){
      if(reject) return ok({state:'failed',message:'Order changed; refresh'});
      const order=orders.find(o=>o.revision===args.revision), p=inventory.find(p=>p.id===args.part_id);
      assert.equal(args.dealer,dealer); assert.equal(p.recipe_id,order.recipe_id);
      assert.equal(args.min_payout,'98'); assert.equal(p.installed_on,null); assert.equal(p.price,null);
      inventory=inventory.filter(q=>q.id!==p.id); balance.rush+=98;
      order.remaining--; if(!order.remaining) orders=orders.filter(o=>o!==order);
      offers.push({...p,owner:dealer,price:'130',offer:9});
    } else if(call.methodName==='buy_component'){
      const p=offers.find(p=>p.id===args.part_id);
      assert.equal(args.max_price,p.price);assert.equal(args.offer,p.offer);
      balance.rush-=Number(p.price);inventory.push({...p,owner:me,price:null}); offers=offers.filter(q=>q.id!==p.id);
    } else if(call.methodName==='install_component') inventory.find(p=>p.id===args.part_id).installed_on=args.chassis;
    else throw new Error(`Unexpected mutation: ${call.methodName}`);
    return ok({state:'confirmed',tx:'fixture-receipt',value:null});
  }
  return ok([]);
});
const action=(name)=>page.locator(`[data-action="${name}"]`);
const idle=()=>page.waitForFunction(()=>!document.querySelector('.pw-status')?.textContent?.match(/Completing|Confirming|Refreshing/));
try {
  await page.goto(`${base}/?q=1`,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__game?.state==='menu');
  await page.click('#btn-garage-menu');await page.click('#btn-workshop-garage');
  await page.click('[data-workshop-section="performance"]');await idle();
  await page.click('[data-page="exchange"]');await page.click('[data-market="orders"]');
  assert.match(await page.locator('.pw-order').textContent(),/FUNDS RESERVED/);
  assert.match(await page.locator('.pw-order').textContent(),/98/);
  await page.screenshot({path:`${out}/orders-desktop.png`});
  await action('order-recipe').click();
  assert.equal(await page.locator('[data-recipe="street-slick"]').getAttribute('aria-pressed'),'true');
  assert.match(await page.locator('.pw-track').textContent(),/TRACKED/);
  await action('craft').click();await idle();
  assert.equal(inventory.length,1);assert.equal(balance.rush,140);
  await action('show-orders').click();
  await page.setViewportSize({width:390,height:844});
  await action('deliver').scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/delivery-mobile.png`});
  reject=true;await action('deliver').click();await idle();
  assert.match(await page.locator('.pw-status').textContent(),/Order changed/);
  assert.equal(inventory.length,1);assert.equal(balance.rush,140);
  reject=false;await action('deliver').click();await idle();
  assert.equal(inventory.length,0);assert.equal(balance.rush,238);assert.equal(orders[0].remaining,1);
  assert.equal(await action('deliver').count(),0,'no duplicate delivery button');
  assert.match(await page.locator('.pw-status').textContent(),/98 RUSH received/);
  await page.click('[data-market="listings"]');
  assert.match(await page.locator('.pw-provenance').textContent(),/Made by builder.*Owned by mama-t/);
  await action('buy').click();await idle();
  await page.click('[data-page="garage"]');await action('install').click();await idle();
  assert.equal(await page.evaluate(()=>window.__game.carSpec(0).grip),1.08);
  await page.click('[data-page="exchange"]');await page.click('[data-market="orders"]');
  assert.equal(await action('deliver').count(),0,'installed part cannot be delivered');
  assert.match(await page.locator('.pw-order-hint').textContent(),/Uninstall/);
  for(const width of [360,390]){
    await page.setViewportSize({width,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.locator('.pw-order').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${out}/orders-${width}.png`});
  }
  orders[0].expires_ms=Date.now()-1;await action('refresh').click();await idle();
  assert.match(await page.locator('.pw-empty').textContent(),/No funded orders/);
  unavailable=true;await action('refresh').click();await idle();
  assert.match(await page.locator('.pw-empty').textContent(),/Dealer orders unavailable/);
  await page.click('[data-page="craft"]'); assert.equal(await action('craft').isDisabled(),false,'old backend does not disable crafting');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,policy:'budget, inventory, resale margin, dealer specialties',flow:'craft → rejected delivery → delivery → dealer resale → install',screenshots:out,calls:calls.map(c=>c.method)},null,2));
} finally {await browser.close();}
