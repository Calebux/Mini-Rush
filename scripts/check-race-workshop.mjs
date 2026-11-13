import { signedInDriver } from './auth-fixture.mjs';
// UI acceptance with mocked NEAR settlement. The finish is accelerated below;
// this does not validate reward eligibility or replace a live two-account test.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import * as borsh from 'borsh';
import { SCHEMA } from 'near-api-js';
const recipes = JSON.parse(await readFile(new URL('../shared/components.json', import.meta.url)));
const base = process.argv[2] ?? 'http://127.0.0.1:5174', out = '/tmp/minirush-race-workshop';
await mkdir(out, { recursive: true });
const me = 'race-builder.minirush-garage.testnet';
let inventory = [], balance = { rush: 10, 'material:alloy': 2, 'material:circuit': 0 };
let rejectClaim = true, rejectInstall = true, offline = false, emptyReceipt = false, rewardCalls = 0, minted = 0;
// Mirrors race_rush in the contract: the finish claims a podium tier and the server pays that tier.
const tierRush = place => ({ 1: 45, 2: 36, 3: 30 })[place] ?? 24;
const claimedPlaces = [];
const paid = new Set(), errors = [], mutations = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
page.on('pageerror', e => { errors.push(e.message); console.error(e.stack); });
await page.addInitScript(() => { localStorage.setItem('minirush.controls-guide','1'); localStorage.setItem('minirush.welcomed','1'); });
await page.route('**/*', async route => {
  const req = route.request(); if (req.method() !== 'POST') return route.continue();
  let body; try { body = req.postDataJSON(); } catch { return route.abort(); }
  const ok = value => route.fulfill({ json: { status: 'success', value } });
  if (body.jsonrpc) {
    if (offline) return route.abort('failed');
    let result;
    if (body.method === 'block') result = { header: { height: 100, hash: '11111111111111111111111111111111' } };
    else if (body.params.request_type === 'view_access_key') result = { nonce: 1, permission: 'FullAccess' };
    else {
      const value = body.params.method_name === 'component_inventory' ? inventory
        : body.params.method_name === 'mt_tokens_for_owner' ? Object.entries(balance).map(([token_id,n]) => ({ token_id, balance: String(n) })) : [];
      result = { result: [...Buffer.from(JSON.stringify(value))], logs: [] };
    }
    return route.fulfill({ json: { jsonrpc: '2.0', id: body.id, result } });
  }
  if (body.path === 'near:createPlayer') return ok({ account: me, welcome: 0, created: true });
  if (body.path === 'near:beginRace') return ok(`race-${body.args.run}`);
  if (body.path === 'near:raceProgress') {
    if (!body.args.finish) return ok(null);
    rewardCalls++;
    claimedPlaces.push(body.args.place);
    if (emptyReceipt) return ok(null);
    if (rejectClaim) return route.fulfill({ json: { status: 'error', errorMessage: 'Fixture: relay unavailable' } });
    if (!paid.has(body.args.race)) {
      paid.add(body.args.race); minted += tierRush(body.args.place);
      balance.rush += tierRush(body.args.place); balance['material:alloy'] += 2; balance['material:circuit']++;
    }
    return ok({ minted: tierRush(body.args.place), alloy: 2, circuit: 1, place: body.args.place, tx: 'race-receipt' });
  }
  if (body.path === 'near:relayTracked') {
    const delegate = borsh.deserialize(SCHEMA.SignedDelegate, Buffer.from(body.args.signedDelegate, 'base64'));
    const call = delegate.delegateAction.actions[0].functionCall, args = JSON.parse(Buffer.from(call.args).toString());
    mutations.push(call.methodName);
    if (call.methodName === 'craft_component') {
      const recipe = recipes.find(r => r.id === args.recipe_id);
      assert.ok(balance.rush >= recipe.rush && balance['material:alloy'] >= recipe.alloy && balance['material:circuit'] >= recipe.circuit);
      balance.rush -= recipe.rush; balance['material:alloy'] -= recipe.alloy; balance['material:circuit'] -= recipe.circuit;
      inventory.push({ id: 'component:1', recipe_id: recipe.id, owner: me, maker: me, created_ms: Date.now(), installed_on: null, price: null, offer: 0 });
    } else if (call.methodName === 'install_component') {
      if (rejectInstall) return ok({ state: 'failed', message: 'Fixture: installation rejected' });
      inventory.find(p => p.id === args.part_id).installed_on = args.chassis;
    } else throw new Error(`Unexpected mutation ${call.methodName}`);
    return ok({ state: 'confirmed', tx: 'component-receipt', value: 'component:1' });
  }
  return ok([]); // Block analytics and any other backend writes.
});
const idle = () => page.waitForFunction(() => !document.querySelector('.pw-status')?.textContent?.match(/Completing|Confirming|Refreshing/));
const rewardStatus = status => page.waitForFunction(s => document.querySelector('#race-rewards')?.dataset.status === s, status);
try {
  await page.goto(`${base}/?q=1`, { waitUntil: 'networkidle' });
  await signedInDriver(page);
  await page.waitForFunction(() => window.__game?.state === 'menu');
  await page.click('#btn-play'); await page.click('#btn-tour-done'); await page.click('#btn-garage-done');
  await page.waitForFunction(() => window.__game.state === 'racing');
  await page.keyboard.down('ArrowUp'); await page.waitForFunction(() => window.__game.raceTime >= 4.5); await page.keyboard.up('ArrowUp');
  // Exercise the actual game's finish/report plumbing without a minute-long drive.
  await page.evaluate(() => {
    const g = window.__game; g.raceTime = 61; g.player.s = g.player.raceLength; g.finishRace();
  });
  await page.waitForFunction(() => !document.querySelector('#results').classList.contains('hidden'));
  await rewardStatus('pending');
  assert.equal(await page.locator('.rr-payout b').first().textContent(), '—');
  assert.equal(minted, 0);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('minirush.near.pending-races.v2')).length), 1);
  await page.screenshot({ path: `${out}/pending-desktop.png` });
  rejectClaim = false; await page.click('[data-reward-action="retry"]');
  await rewardStatus('confirmed');
  await page.waitForFunction(() => document.querySelector('.rr-workshop').textContent.includes('CRAFT THIS PART'));
  // The fixture wins its race, so both the failed claim and its retry must sign the same podium tier.
  const place = await page.evaluate(() => window.__game.playerPlace), won = tierRush(place);
  assert.equal(place, 1); assert.deepEqual(claimedPlaces, [1, 1]);
  assert.equal(rewardCalls, 2); assert.equal(minted, won);
  assert.deepEqual(await page.locator('.rr-payout b').allTextContents(), [`+${won}`,'+2','+1']);
  assert.equal((await page.locator('.rr-tiers li[aria-current]').textContent()).trim(), `WIN${won}`);
  assert.deepEqual(await page.locator('.rr-tiers b').allTextContents(), ['45','36','30','24']);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('minirush.near.pending-races.v2')).length), 0);
  await page.selectOption('#reward-target','long-bottle');
  assert.match(await page.locator('.rr-progress-note').textContent(), /2 more eligible races/);
  await page.selectOption('#reward-target','street-slick');
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${out}/confirmed-desktop.png` });
  await page.click('[data-reward-action="workshop"]'); await idle();
  assert.equal(await page.evaluate(() => window.__game.uiScene), 'workshop');
  assert.equal(await page.locator('[data-recipe="street-slick"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#parts-chassis').inputValue(), 'viper');
  assert.equal(await page.locator('[data-action="track"]').getAttribute('aria-pressed'), 'true');
  await page.click('[data-action="craft"]'); await idle();
  assert.equal(await page.locator('[data-page="garage"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.pw-detail').getAttribute('data-part'), 'component:1');
  await page.click('[data-action="install"]'); await idle();
  assert.match(await page.locator('.pw-status').textContent(), /installation rejected/);
  assert.equal(await page.locator('#workshop-installation').isVisible(), false);
  assert.equal(await page.evaluate(() => window.__game.carSpec(0).grip), 1);
  rejectInstall = false; await page.click('[data-action="install"]'); await idle();
  assert.equal(await page.locator('#workshop-installation').isVisible(), true);
  assert.match(await page.locator('#workshop-installation').textContent(), /Grip 100 → 108/);
  assert.equal(await page.evaluate(() => window.__game.showroom.installation.root.name), 'installed-street-slick');
  assert.equal(await page.evaluate(() => window.__game.carSpec(0).speed), .97);
  await page.screenshot({ path: `${out}/installation-desktop.png` });
  await page.setViewportSize({width:390,height:844});
  await page.locator('#workshop').evaluate(el => el.scrollTop = 0);
  await page.screenshot({ path: `${out}/installation-mobile.png` });
  await page.click('#workshop-back');
  assert.equal(await page.locator('#results').evaluate(e => e.classList.contains('hidden')), false);
  assert.equal(await page.locator('#garage').evaluate(e => e.classList.contains('hidden')), true);
  await page.waitForFunction(() => document.querySelector('.rr-materials strong')?.textContent === '15 / 40');
  assert.deepEqual(await page.locator('.rr-payout b').allTextContents(), [`+${won}`,'+2','+1']);
  assert.equal(minted, won, 'opening the workshop never claims a second reward');
  await page.locator('#race-rewards').scrollIntoViewIfNeeded();
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}/progress-mobile.png` });
  for (const size of [{width:360,height:640},{width:900,height:600}]) {
    await page.setViewportSize(size);
    assert.equal(await page.locator('#results').evaluate(e => e.scrollWidth > e.clientWidth), false);
    await page.locator('.rr-workshop').scrollIntoViewIfNeeded();
    await page.locator('#btn-retry').scrollIntoViewIfNeeded();
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.click('[data-reward-action="workshop"]'); await idle();
  await page.click('[data-page="garage"]');
  await page.click('[data-action="install"]'); await idle(); // uninstall
  await page.click('[data-action="install"]'); await idle();
  assert.equal(await page.locator('#workshop-installation').isVisible(), true);
  assert.equal(await page.evaluate(() => window.__game.showroom.installation.part.visible), false);
  await page.selectOption('#parts-chassis','rush-one');
  assert.equal(await page.locator('#workshop-installation').isVisible(), false);
  assert.equal(await page.evaluate(() => window.__game.showroom.installation), null);
  await page.click('#workshop-back');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  offline = true; await page.click('[data-reward-action="refresh"]');
  await page.waitForFunction(() => document.querySelector('.rr-progress-note')?.textContent.includes('Balance unavailable'));
  assert.equal(await page.locator('.rr-materials strong').first().textContent(), '— / 40');
  await page.click('[data-reward-action="workshop"]'); await idle();
  assert.equal(await page.locator('[data-action="craft"]').count(), 0, 'offline crafting is unavailable');
  assert.equal(await page.locator('[data-action="race"]').isEnabled(), true);
  await page.click('#workshop-back');
  offline = false;
  // A late result from a previous race must not replace the current report.
  await page.evaluate(() => {
    const ui = window.__game.ui;
    ui.completeRaceRewards('viper', () => new Promise(resolve => { window.resolveOldReward = resolve; }));
    ui.completeRaceRewards('viper', null, 'This race was under 40 seconds.');
    window.resolveOldReward({ minted: 30, alloy: 2, circuit: 1, tx: 'old-receipt' });
  });
  await rewardStatus('ineligible');
  assert.equal(await page.locator('.rr-payout b').first().textContent(), '—');
  assert.match(await page.locator('.rr-status').textContent(), /under 40/);
  // An unavailable session never displays a successful payout.
  await page.evaluate(() => window.__game.ui.completeRaceRewards('viper', async () => null));
  await rewardStatus('unavailable');
  assert.equal(await page.locator('.rr-payout b').first().textContent(), '—');
  // A custom build saved from a class event must pass garage eligibility again.
  await page.evaluate(async () => {
    const { MODES } = await import('/src/modes.ts');
    window.__game.ui.setMode(MODES.findIndex(m => m.requiresClass === 'hyper'));
  });
  await page.click('[data-reward-action="workshop"]'); await idle();
  await page.click('[data-workshop-section="style"]');
  await page.click('#workshop-save');
  assert.equal(await page.locator('#garage').isVisible(), true);
  assert.equal(await page.locator('#results').evaluate(e => e.classList.contains('hidden')), true);
  assert.equal(await page.locator('#btn-garage-done').isDisabled(), true);
  emptyReceipt = true;
  const nullReceipt = await page.evaluate(async () => {
    const near = await import('/src/near.ts'); const run = new near.RewardRace(500);
    try { await run.finish(500,60); return false; } catch { return near.hasPendingReward(); }
  });
  assert.equal(nullReceipt, true, 'missing settlement receipt preserves the claim');
  emptyReceipt = false;
  await page.evaluate(async () => { const near = await import('/src/near.ts'); await near.retryRaceReward(); });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('minirush.near.pending-races.v2')).length), 0);
  await page.reload({ waitUntil: 'networkidle' });
  await signedInDriver(page);
  assert.equal(await page.evaluate(() => localStorage.getItem('minirush.crafting-target.v1')), 'street-slick');
  assert.deepEqual(errors, []);
  assert.deepEqual(mutations,['craft_component','install_component','install_component','install_component','install_component']);
  console.log(`PASS: finish → pending claim → retry → confirmed salvage → target recipe → craft → failed/successful installation → results; honest balances, mobile layouts and stale-response isolation. Screenshots: ${out}`);
} finally { await browser.close(); }
