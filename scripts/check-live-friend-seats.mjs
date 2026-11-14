// Creates only its own temporary friendly room. No accounts or economy actions.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.argv[2] ?? 'https://minirush.site';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const errors = [];
let host;
async function player(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  await context.addInitScript(name => {
    localStorage.setItem('minirush.welcomed', '1');
    localStorage.setItem('minirush.controls-guide', '1');
    localStorage.setItem('minirush.driver', JSON.stringify({ name, chosen: true }));
  }, name);
  await context.route('**/*', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    let body; try { body = route.request().postDataJSON(); } catch { return route.abort(); }
    // Room traffic uses Convex WebSockets. Block all HTTP writes/economy calls.
    if (body?.jsonrpc) return route.fulfill({ json: { jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'Economy isolated in lobby test' } } });
    return route.fulfill({ json: { status: 'success', value: null } });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return page;
}
async function join(page, code) {
  await page.goto(`${base}/?q=0&race=${code}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.state === 'menu');
  await page.locator('#friends-dialog form button').click();
}
try {
  host = await player('LOBBY CHECK HOST');
  await host.goto(`${base}/?q=0`, { waitUntil: 'domcontentloaded' });
  await host.waitForFunction(() => window.__game?.state === 'menu');
  await host.click('#btn-friends');
  await host.click('[data-friend="create"]');
  await host.waitForFunction(() => !!window.__game.friends.room);
  const code = await host.locator('[data-friend-code]').textContent();
  assert.match(code, /^[A-F0-9]{8}$/);
  const guest = await player('LOBBY CHECK GUEST');
  await join(guest, code);
  await guest.waitForFunction(() => window.__game.friends.room?.players.length === 2);
  assert.equal(await guest.evaluate(() => window.__game.friends.slot), 1);
  await guest.reload({ waitUntil: 'domcontentloaded' });
  await guest.waitForFunction(() => window.__game?.friends.room?.players.length === 2);
  assert.equal(await guest.evaluate(() => window.__game.friends.slot), 1);
  console.log('PASS: first-attempt join and reload retain the second seat on the live domain.');
  const replacement = await player('LOBBY CHECK REPLACEMENT');
  await join(replacement, code);
  await replacement.waitForFunction(() => document.querySelector('[data-friend-message]')?.textContent.includes('two connected drivers'));
  console.log('PASS: an active second driver is protected from a third join.');
  await guest.context().close();
  await host.click('[data-friend="ready"]');
  console.log('Checking the real one-minute disconnected-seat timeout...');
  await host.waitForFunction(() => window.__game.friends.room?.players.length === 1, {}, { timeout: 80000 });
  assert.equal(await host.evaluate(() => window.__game.friends.room.players[0].ready), false);
  await replacement.locator('#friends-dialog form button').click();
  await replacement.waitForFunction(() => window.__game.friends.room?.players.length === 2);
  assert.equal(await replacement.evaluate(() => window.__game.friends.slot), 1);
  console.log('PASS: stale waiting seat releases, host readiness resets, and replacement joins as driver two.');
  assert.deepEqual(errors, []);
} finally {
  if (host && !host.isClosed()) {
    await host.locator('[data-friend="leave"]').click({ timeout: 5000 }).catch(() => {});
    await host.waitForFunction(() => !window.__game?.friends.room, {}, { timeout: 5000 }).catch(() => {});
  }
  await browser.close();
}
