// Real SDK adapter with fake Auth0 session/RPC. No credentials or transactions.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { KeyPair } from 'near-api-js';
import { createHash } from 'node:crypto';
import { identityMessage, identityPayload, identityStartMessage } from '../shared/identityProof.ts';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const publicKey = KeyPair.fromRandom('ed25519').getPublicKey().toString();
const garageKey = KeyPair.fromRandom('ed25519');
let challenge, submissions = 0, completions = 0;
let holdRestore, releaseRestore;
const errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(key => {
  localStorage.setItem('minirush.controls-guide', '1'); localStorage.setItem('minirush.welcomed', '1');
  localStorage.setItem('minirush.driver', JSON.stringify({ name: 'TEST DRIVER', chosen: true }));
  localStorage.setItem('minirush.near.account', 'preview.minirush-garage.testnet');
  localStorage.setItem('minirush.near.key', key);
  localStorage.setItem('minirush.garage-actions.v1', '[]');
}, garageKey.toString());
await page.route('**/*', async route => {
  const request = route.request();
  if (request.method() !== 'POST') return route.continue();
  const body = request.postDataJSON();
  if (body.path === 'near:beginIdentityProof') {
    const a = body.args;
    assert.ok(garageKey.getPublicKey().verify(new TextEncoder().encode(identityStartMessage(a.account, a.identityKey, a.recipient, a.request, a.at)), Buffer.from(a.signature, 'base64')));
    const expiresAt = Date.now() + 300000;
    challenge = { id: 'fixture-proof', account: a.account, garageKey: garageKey.getPublicKey().toString(), identityKey: publicKey,
      recipient: a.recipient, nonce: Buffer.alloc(32, 7).toString('base64'), expiresAt,
      message: identityMessage(a.account, garageKey.getPublicKey().toString(), publicKey, 'minirush-garage.testnet', expiresAt) };
    return route.fulfill({ json: { status: 'success', value: challenge } });
  }
  if (body.path === 'near:completeIdentityProof') {
    completions++;
    const payload = identityPayload(challenge.message, challenge.recipient, Buffer.from(challenge.nonce, 'base64'));
    assert.ok(garageKey.getPublicKey().verify(createHash('sha256').update(payload).digest(), Buffer.from(body.args.garageSignature, 'base64')));
    assert.equal(body.args.id, challenge.id);
    if (body.args.signingToken) {
      submissions++;
      const claims = JSON.parse(Buffer.from(body.args.signingToken.split('.')[1], 'base64url'));
      assert.deepEqual(claims.fatxn, [...payload]); assert.equal(payload.at(-1), 0);
      return route.abort(); // Response lost after the fixture completed the ownership check.
    }
    if (holdRestore) await holdRestore;
    return route.fulfill({ json: { status: 'success', value: { state: 'verified', tx: 'fixture-proof-receipt', message: 'Ownership link verified. Account recovery is not enabled yet.' } } });
  }
  if (body.jsonrpc && body.method === 'query' && body.params.method_name === 'derived_public_key') {
    requests.push(body.params);
    return route.fulfill({ json: { jsonrpc: '2.0', id: body.id, result: { result: [...Buffer.from(JSON.stringify(publicKey))], logs: [] } } });
  }
  return route.abort();
});
try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5174/?q=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game?.state === 'menu');
  const original = await page.evaluate(() => Object.fromEntries(['minirush.near.account', 'minirush.near.key', 'minirush.garage-actions.v1'].map(k => [k, localStorage.getItem(k)])));
  assert.equal(await page.locator('#home-sign-in').isVisible(), true, 'sign-in is off on this server; start it with VITE_SHOP_SIGN_IN=required to run this check');
  assert.equal(await page.locator('#profile [data-social-sign-in]').count(), 0);
  await page.screenshot({ path: '/tmp/minirush-home-account-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: '/tmp/minirush-home-account-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    localStorage.setItem('minirush.bank', '5000');
    const economy = await import('/src/economy.ts');
    const workshop = await import('/src/workshop.ts');
    const skins = await import('/src/skins.ts');
    const upgrades = await import('/src/upgrades.ts');
    if (economy.buyCar('r8', 100) || skins.buySkin('viper', 1) || upgrades.buyTier('viper', 'speed') || !workshop.purchasePart('wide')) throw new Error('Guest purchase accepted');
    if (economy.bank() !== 5000) throw new Error('Guest purchase spent coins');
    if (!economy.spend(10)) throw new Error('Guest race fine was incorrectly gated');
  });
  await page.waitForFunction(() => document.querySelector('#social-sign-in').open);
  await page.waitForFunction(() => !document.querySelector('[data-auth-login]')?.disabled);
  await page.evaluate(async () => {
    // Vite may append an HMR timestamp; patch the same module instance the UI loaded.
    const url = performance.getEntriesByType('resource').findLast(r => r.name.includes('/src/nearAuth.ts')).name;
    const { provider } = await (await import(url)).loadNearAuth();
    window.authFixture = { signedIn: false, cancel: true, popupCalls: 0, logoutCalls: 0 };
    const fixture = window.authFixture;
    provider.client.isAuthenticated = async () => fixture.signedIn;
    provider.client.getIdTokenClaims = async () => fixture.signedIn ? { sub: 'google-oauth2|fixture', __raw: 'fixture-login-token', exp: Math.floor(Date.now() / 1000) + 3600 } : undefined;
    provider.client.loginWithPopup = async options => {
      fixture.popupCalls++;
      if (fixture.cancel) throw { error: 'cancelled', error_description: 'SECRET-MUST-NOT-RENDER' };
      fixture.signedIn = true;
      if (options?.authorizationParams?.nep413) {
        if (options.authorizationParams.scope !== 'transaction:sign' || options.authorizationParams.audience !== 'auth0.jwt.fast-auth.testnet') throw new Error('wrong signing authorization');
        const payload = fixture.wrongPayload ? [0] : options.authorizationParams.nep413;
        fixture.token = [btoa(JSON.stringify({ alg: 'RS256' })), btoa(JSON.stringify({ sub: 'google-oauth2|fixture', fatxn: payload })), 'fixture-signature'].join('.');
      }
    };
    provider.client.getTokenSilently = async () => fixture.token;
    provider.client.handleRedirectCallback = async () => { fixture.signedIn = true; };
    provider.client.logout = async options => {
      if (options.openUrl !== false || Array.isArray(options)) throw new Error('wrong logout options');
      fixture.logoutCalls++; fixture.signedIn = false;
    };
  });
  await page.click('[data-auth-login]');
  await page.waitForFunction(() => document.querySelector('[data-auth-status]').textContent.includes('cancelled'));
  assert.equal(await page.locator('[data-auth-redirect]').isVisible(), true);
  assert.ok(!(await page.locator('#social-sign-in').innerText()).includes('SECRET-MUST-NOT-RENDER'));
  await page.evaluate(() => { window.authFixture.cancel = false; });
  await page.click('[data-auth-login]');
  await page.waitForFunction(() => document.querySelector('[data-auth-status]').textContent.includes('Google sign-in verified'));
  assert.equal(await page.locator('[data-auth-key]').textContent(), publicKey);
  assert.equal(await page.locator('[data-auth-login]').isVisible(), false);
  assert.equal(await page.locator('#home-sign-in').textContent(), 'ACCOUNT ↗');
  await page.evaluate(async () => {
    const economy = await import('/src/economy.ts');
    const workshop = await import('/src/workshop.ts');
    const skins = await import('/src/skins.ts');
    const upgrades = await import('/src/upgrades.ts');
    if (!economy.buyCar('r8', 100) || !skins.buySkin('viper', 1) || !upgrades.buyTier('viper', 'speed') || workshop.purchasePart('wide')) throw new Error('Signed-in purchase blocked');
  });
  assert.ok((await page.locator('#social-sign-in').innerText()).includes('recovery is not linked'));
  await page.click('[data-auth-proof]');
  await page.waitForFunction(() => document.querySelector('[data-auth-proof]').textContent === 'Approve ownership check');
  await page.evaluate(() => { window.authFixture.wrongPayload = true; });
  await page.click('[data-auth-proof]');
  await page.waitForFunction(() => document.querySelector('[data-auth-proof-status]').textContent.includes('did not complete'));
  assert.equal(completions, 0, 'payload mismatch rejected before backend signing');
  await page.evaluate(() => { window.authFixture.wrongPayload = false; });
  await page.click('[data-auth-proof]');
  await page.waitForFunction(() => document.querySelector('[data-auth-proof]').textContent === 'Check ownership progress');
  assert.equal(submissions, 1);
  const popups = await page.evaluate(() => window.authFixture.popupCalls);
  await page.click('[data-auth-proof]');
  await page.waitForFunction(() => document.querySelector('[data-auth-proof-status]').textContent.includes('Ownership link verified'));
  assert.equal(submissions, 1, 'recovery reuses the challenge without another signing token');
  assert.equal(await page.evaluate(() => window.authFixture.popupCalls), popups);
  assert.equal(await page.locator('[data-auth-proof]').isVisible(), false);
  assert.ok(await page.evaluate(() => !localStorage.getItem('minirush.identity-proof.v1').includes(window.authFixture.token)), 'JWT is never stored in browser journal');
  await page.click('[data-auth-details] summary');
  await page.screenshot({ path: '/tmp/minirush-google-sign-in-mobile.png' });
  const fits = await page.evaluate(() => {
    const dialog = document.querySelector('#social-sign-in');
    const b = dialog.getBoundingClientRect();
    return b.left >= 0 && b.right <= innerWidth && dialog.scrollWidth <= dialog.clientWidth;
  });
  assert.equal(fits, true);
  await page.click('[data-auth-logout]');
  await page.waitForFunction(() => document.querySelector('[data-auth-status]').textContent.includes('Signed out'));
  assert.equal(await page.locator('[data-auth-details]').isVisible(), false);
  assert.equal(await page.locator('[data-auth-key]').textContent(), '');
  assert.equal(await page.evaluate(() => window.authFixture.logoutCalls), 1);
  assert.equal(await page.locator('#home-sign-in').textContent(), 'SIGN IN ↗');
  assert.equal(await page.evaluate(async () => (await import('/src/economy.ts')).buyCar('divo', 100)), false);
  // Returning sign-in rechecks a saved success before allowing another action.
  holdRestore = new Promise(resolve => { releaseRestore = resolve; });
  const previousCompletions = completions;
  await page.click('[data-auth-login]');
  await page.waitForFunction(() => document.querySelector('[data-auth-proof-status]').textContent.includes('Checking your previous'));
  assert.equal(await page.locator('[data-auth-proof]').isDisabled(), true);
  releaseRestore(); holdRestore = undefined;
  await page.waitForFunction(() => document.querySelector('[data-auth-proof-status]').textContent.includes('Ownership link verified'));
  assert.equal(completions, previousCompletions + 1);
  assert.equal(submissions, 1);
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').findLast(r => r.name.includes('/src/nearAuth.ts')).name;
    const auth = await import(url);
    const returnUrl = `${location.origin}/?q=1`;
    sessionStorage.setItem(auth.AUTH_CALLBACK_KEY, JSON.stringify({ at: Date.now(), returnUrl }));
    history.replaceState(null, '', '/?code=fixture&state=fixture');
    const identity = await auth.finishAuthCallback();
    if (!identity.google || location.href !== returnUrl || sessionStorage.getItem(auth.AUTH_CALLBACK_KEY)) throw new Error('callback cleanup failed');
    sessionStorage.setItem(auth.AUTH_CALLBACK_KEY, JSON.stringify({ at: Date.now() - 11 * 60_000, returnUrl }));
    history.replaceState(null, '', '/?code=stale&state=stale');
    let rejected = false;
    try { await auth.finishAuthCallback(); } catch { rejected = true; }
    if (!rejected || location.search.includes('code')) throw new Error('expired callback accepted');
    sessionStorage.setItem(auth.AUTH_CALLBACK_KEY, JSON.stringify({ at: Date.now(), returnUrl: 'https://example.com/' }));
    history.replaceState(null, '', '/?code=foreign&state=foreign');
    rejected = false;
    try { await auth.finishAuthCallback(); } catch { rejected = true; }
    if (!rejected || location.origin !== returnUrl.split('/?')[0]) throw new Error('unsafe return URL');
  });
  assert.deepEqual(await page.evaluate(() => Object.fromEntries(['minirush.near.account', 'minirush.near.key', 'minirush.garage-actions.v1'].map(k => [k, localStorage.getItem(k)]))), original);
  assert.ok(requests.length >= 1);
  const args = JSON.parse(Buffer.from(requests[0].args_base64, 'base64'));
  assert.equal(requests[0].account_id, 'v1.signer-prod.testnet');
  assert.equal(args.predecessor, 'fast-auth.testnet');
  assert.equal(args.domain_id, 1);
  assert.deepEqual(errors, []);
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').findLast(r => r.name.includes('/src/nearAuth.ts')).name;
    await (await import(url)).logoutAuth();
  });
  await page.locator('[data-auth-close]').first().click();
  await page.click('#btn-play');
  await page.click('#btn-tour-done');
  await page.click('#btn-garage-done');
  await page.waitForFunction(() => ['countdown', 'racing'].includes(window.__game.state));
  assert.equal(await page.evaluate(() => document.querySelector('#social-sign-in').open), false, 'guest can start a race without a sign-in prompt');
  console.log(JSON.stringify({ passed: true, checks: ['cancel', 'login', 'real SDK key derivation', 'ownership approval without callbackUrl', 'wrong-payload rejection', 'lost-response recovery without second approval', 'saved success rechecked', 'logout', 'callback cleanup', 'expired callback', 'return URL validation', 'garage untouched', 'mobile layout'], screenshot: '/tmp/minirush-google-sign-in-mobile.png' }));
} finally { await browser.close(); }
