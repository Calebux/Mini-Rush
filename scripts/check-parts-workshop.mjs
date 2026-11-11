// Browser interaction check with an isolated, in-memory chain/backend fixture.
// Contract accounting and authorization are tested in Rust, not by this fixture.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import * as borsh from 'borsh';
import { SCHEMA } from 'near-api-js';
const recipes = JSON.parse(await readFile(new URL('../shared/components.json', import.meta.url)));
const base = process.argv[2] ?? 'http://127.0.0.1:5174';
const out = '/tmp/minirush-parts'; await mkdir(out, { recursive: true });
const me = 'player.minirush-garage.testnet';
let inventory = [], balance = { rush: 180, 'material:alloy': 12, 'material:circuit': 6 };
let offers = [], serial = 0, offline = false, calls = [], progressCalls = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  localStorage.setItem('minirush.controls-guide', '1');
  localStorage.setItem('minirush.welcomed', '1');
});
await page.route('**/*', async route => {
  const req = route.request();
  if (req.method() !== 'POST') return route.continue();
  let body; try { body = req.postDataJSON(); } catch { return route.continue(); }
  if (body.jsonrpc) {
    if (offline) return route.abort('failed');
    let result;
    if (body.method === 'block') result = { header: { height: 100, hash: '11111111111111111111111111111111' } };
    else if (body.params.request_type === 'view_access_key') result = { nonce: 1, permission: 'FullAccess' };
    else {
      let value;
      switch (body.params.method_name) {
        case 'component_inventory': value = inventory; break;
        case 'component_offers': value = offers; break;
        case 'mt_tokens_for_owner': value = Object.entries(balance).map(([token_id, n]) => ({ token_id, balance: String(n) })); break;
        case 'listings': value = []; break;
        default: throw new Error(`Unmocked view ${body.params.method_name}`);
      }
      result = { result: [...Buffer.from(JSON.stringify(value))], logs: [] };
    }
    return route.fulfill({ json: { jsonrpc: '2.0', id: body.id, result } });
  }
  if (body.path === 'near:createPlayer') return route.fulfill({ json: { status: 'success', value: { account: me, welcome: 0, created: true } } });
  if (body.path === 'near:relay') {
    const delegate = borsh.deserialize(SCHEMA.SignedDelegate, Buffer.from(body.args.signedDelegate, 'base64'));
    const call = delegate.delegateAction.actions[0].functionCall;
    const args = JSON.parse(Buffer.from(call.args).toString()); calls.push(call.methodName);
    const part = inventory.find(p => p.id === args.part_id);
    switch (call.methodName) {
      case 'craft_component': {
        const r = recipes.find(r => r.id === args.recipe_id);
        balance.rush -= r.rush; balance['material:alloy'] -= r.alloy; balance['material:circuit'] -= r.circuit;
        inventory.push({ id: `component:${++serial}`, recipe_id: r.id, owner: me, maker: me, created_ms: Date.now(), installed_on: null, price: null, offer: 0 }); break;
      }
      case 'install_component': part.installed_on = args.chassis; break;
      case 'list_component': part.price = args.price; part.installed_on = null; part.offer++; offers.push({ ...part }); break;
      case 'cancel_component': part.price = null; offers = offers.filter(o => o.id !== part.id); break;
      case 'recycle_component': {
        const r = recipes.find(r => r.id === part.recipe_id);
        balance['material:alloy'] += Math.floor(r.alloy / 2); balance['material:circuit'] += Math.floor(r.circuit / 2);
        inventory = inventory.filter(p => p.id !== part.id); break;
      }
      case 'buy_component': {
        const offer = offers.find(p => p.id === args.part_id);
        assert.equal(args.offer, offer.offer); assert.equal(args.max_price, offer.price);
        balance.rush -= Number(offer.price); inventory.push({ ...offer, owner: me, price: null }); offers = offers.filter(p => p.id !== offer.id); break;
      }
      default: throw new Error(`Unmocked mutation ${call.methodName}`);
    }
    return route.fulfill({ json: { status: 'success', value: { tx: 'test-transaction', value: null } } });
  }
  if (body.path === 'near:beginRace') return route.fulfill({ json: { status: 'success', value: 'fixture-race' } });
  if (body.path === 'near:raceProgress') { progressCalls.push(body.args); return route.fulfill({ json: { status: 'success', value: null } }); }
  // No analytics, profile changes or other backend writes escape this fixture.
  return route.fulfill({ json: { status: 'success', value: [] } });
});
const action = (name, id) => page.locator(`[data-action="${name}"]${id ? `[data-id="${id}"]` : ''}`);
const idle = async () => { await page.waitForFunction(() => !document.querySelector('.pw-status')?.textContent?.match(/Confirming|Refreshing/)); };
try {
  await page.goto(`${base}/?q=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game?.state === 'menu');
  await page.click('#btn-garage-menu');
  await page.click('#btn-workshop-garage');
  await page.click('[data-part="wide"]');
  assert.equal(await page.locator('#workshop-buy').isDisabled(), true);
  await page.click('[data-workshop-section="performance"]'); await idle();
  assert.equal(await page.locator('#workshop-car-stage').isVisible(), true);
  assert.equal(await page.locator('#workshop-performance').evaluate(el => el.closest('.workshop-panel') !== null), true);
  assert.equal(await page.locator('.pw-intro').count(), 0);
  assert.equal(await page.evaluate(() => window.__game.workshopChassis), 'viper');
  await page.selectOption('#parts-chassis', 'rush-one');
  assert.equal(await page.evaluate(() => window.__game.workshopChassis), 'rush-one');
  await page.selectOption('#parts-chassis', 'viper');
  await page.click('[data-workshop-section="style"]');
  assert.equal(await page.locator('#workshop-parts [data-part="wide"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => window.__game.workshopChassis), null);
  await page.click('[data-workshop-section="performance"]'); await idle();
  await page.waitForFunction(() => document.querySelector('[data-action="craft"]')?.disabled === false);
  assert.equal(await page.locator('.pw-card').count(), 3);
  for (const slot of ['engine','gearbox','tires','nitro']) {
    await page.click(`#workshop-performance [data-slot="${slot}"]`); assert.equal(await page.locator('.pw-card').count(), 3);
  }
  await page.click('#workshop-performance [data-slot="engine"]');
  await page.screenshot({ path: `${out}/craft-mobile.png`, fullPage: true });
  await action('craft','street-turbo').click(); await idle();
  assert.equal(balance.rush,120); assert.equal(inventory.length,1);
  await page.click('[data-page="garage"]');
  await action('install','component:1').click(); await idle();
  assert.equal(inventory[0].installed_on,'viper');
  assert.equal(await page.evaluate(() => window.__game.carSpec(0).speed), 1.04);
  assert.equal(await page.evaluate(() => window.__game.carSpec(0).accel), .95);
  await page.locator('[data-price-for="component:1"]').fill('100');
  await action('list','component:1').click(); await idle();
  assert.equal(inventory[0].installed_on,null);
  assert.equal(await page.evaluate(() => window.__game.carSpec(0).speed),1);
  await page.click('[data-page="exchange"]');
  await action('cancel','component:1').click(); await idle();
  assert.equal(offers.length,0);
  offers.push({ id:'component:99',recipe_id:'street-slick',owner:'maker.testnet',maker:'maker.testnet',created_ms:Date.now(),installed_on:null,price:'40',offer:99 });
  await action('refresh').click(); await idle();
  await action('buy','component:99').click(); await idle();
  assert.equal(inventory.length,2); assert.equal(balance.rush,80);
  await page.click('[data-page="garage"]');
  await page.click('[data-select-part="component:99"]');
  await action('install','component:99').click(); await idle();
  await page.screenshot({ path: `${out}/inventory-mobile.png`, fullPage: true });
  await page.click('[data-select-part="component:1"]');
  await action('recycle','component:1').click(); await idle();
  assert.equal(inventory.length,1); assert.equal(balance['material:alloy'],9);
  await page.setViewportSize({width:1440,height:900});
  await page.click('[data-page="craft"]'); await page.locator('#workshop').evaluate(el => el.scrollTop = 0); await page.screenshot({ path: `${out}/craft-desktop.png`,fullPage:true });
  await page.setViewportSize({width:360,height:640});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
  offline = true; await action('refresh').click(); await idle();
  assert.match(await page.locator('.pw-status').textContent(), /connection unavailable/);
  assert.equal(await action('craft','street-turbo').isDisabled(),true);
  assert.equal(await page.evaluate(() => window.__game.carSpec(0).grip),1);
  offline = false; await action('refresh').click(); await idle();
  assert.equal(await page.evaluate(() => window.__game.carSpec(0).grip),1.08);
  await page.click('#workshop-back');
  assert.equal(await page.locator('#workshop').evaluate(e => e.classList.contains('hidden')),true);
  assert.equal(await page.locator('#garage').isVisible(),true);
  assert.equal(await page.evaluate(() => window.__game.workshopChassis),null);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game?.state === 'menu' && window.__game.carSpec(0).grip === 1.08);
  await page.click('#btn-play'); await page.click('#btn-tour-done'); await page.click('#btn-garage-done');
  await page.waitForFunction(() => window.__game?.state === 'racing');
  assert.equal(await page.evaluate(() => window.__game.player.spec.grip), 1.08);
  await page.keyboard.down('ArrowUp');
  // The game caps frame delta, so wall-clock waits under GPU load can be less
  // than four simulated seconds (the first checkpoint). Wait for game time.
  await page.waitForFunction(() => window.__game.raceTime >= 5);
  await page.keyboard.up('ArrowUp');
  assert.ok(progressCalls.length > 0, 'race sends checkpoints');
  assert.equal(progressCalls[0].finish, false);
  assert.equal(progressCalls[0].account, me);
  assert.ok(progressCalls[0].signature.length > 0);
  assert.ok(await page.evaluate(() => window.__game.player.s > 0), 'car actually drives with installed component');
  assert.deepEqual(errors, []);
  assert.deepEqual(calls,['craft_component','install_component','list_component','cancel_component','buy_component','install_component','recycle_component']);
  console.log(`PASS: original Customs UI, showroom chassis preview, preserved cosmetic draft, crafting, installation affects driving, listing uninstalls, cancellation, buying, recycling, provenance, offline restrictions, desktop/mobile, reload, actual race handling and signed checkpoints. Screenshots: ${out}`);
} finally { await browser.close(); }
