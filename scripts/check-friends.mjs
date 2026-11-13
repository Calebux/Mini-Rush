// Two isolated browsers, real development Convex room traffic, no NEAR transactions.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const base = process.argv[2] ?? 'http://localhost:3000';
const env = await readFile(new URL('../.env.local', import.meta.url), 'utf8');
const backend = env.match(/^VITE_CONVEX_URL=["']?([^\s"']+)/m)?.[1];
assert.match(backend ?? '', /resilient-loris-654/, 'This test only uses the development backend.');
const out = '/tmp/minirush-friends'; await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const errors = [], forbidden = [];
const pages = [];
const call = async (kind, name, args) => {
  const r = await fetch(`${backend}/api/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: `friends:${name}`, args, format: 'json' }) });
  return r.json();
};
try {
  for (const name of ['CALEB', 'CHALLENGER']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
    await context.addInitScript(name => {
      localStorage.setItem('minirush.welcomed', '1'); localStorage.setItem('minirush.controls-guide', '1');
      localStorage.setItem('minirush.driver', JSON.stringify({ name, chosen: true }));
    }, name);
    await context.route('**/*', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      let body; try { body = route.request().postDataJSON(); } catch { return route.abort(); }
      // Multiplayer WebSockets pass through; all account/economy calls are isolated.
      if (body?.path?.startsWith('near:') && /startRace|finishRace|reward|relay|nitro/i.test(body.path)) forbidden.push(body.path);
      if (body?.jsonrpc) return route.fulfill({ json: { jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'Economy isolated in multiplayer test' } } });
      return route.fulfill({ json: { status: 'success', value: null } });
    });
    const page = await context.newPage(); pages.push(page);
    page.on('pageerror', e => errors.push(e.message));
  }
  const [a, b] = pages;
  await a.goto(`${base}/?q=0`, { waitUntil: 'domcontentloaded' });
  await a.waitForFunction(() => window.__game?.state === 'menu');
  await a.screenshot({ path: `${out}/home.png` });
  await a.click('#btn-friends');
  await a.click('[data-friend="create"]');
  await a.waitForFunction(() => !!window.__game.friends.room);
  const code = await a.locator('[data-friend-code]').textContent();
  assert.match(code, /^[A-F0-9]{8}$/);
  await b.goto(`${base}/?q=0&race=${code}`, { waitUntil: 'domcontentloaded' });
  await b.waitForFunction(() => window.__game?.state === 'menu');
  assert.equal(await b.inputValue('#friends-code'), code);
  await b.locator('#friends-dialog form button').click();
  await a.waitForFunction(() => window.__game.friends.room.players.length === 2);
  await b.waitForFunction(() => window.__game.friends.room?.players.length === 2);
  await a.screenshot({ path: `${out}/lobby-desktop.png` });
  await b.setViewportSize({ width: 390, height: 844 });
  await b.screenshot({ path: `${out}/lobby-mobile.png` });
  assert.equal(await b.evaluate(() => document.querySelector('#friends-dialog').getBoundingClientRect().right <= innerWidth), true);
  await b.setViewportSize({ width: 1280, height: 850 });
  const credentials = await a.evaluate(() => ({ code: window.__game.friends.code, token: window.__game.friends.token }));
  const outsider = randomBytes(32).toString('hex');
  assert.equal((await call('mutation', 'join', { code, token: outsider, name: 'THIRD' })).status, 'error');
  assert.equal((await call('query', 'view', { code, token: outsider })).status, 'error');
  const publicRoom = await call('query', 'view', credentials);
  assert.ok(publicRoom.value.players.every(p => !('token' in p)), 'seat capabilities must never be exposed');
  await a.click('[data-friend="ready"]'); await b.click('[data-friend="ready"]');
  await Promise.all(pages.map(p => p.waitForFunction(() => window.__game.state === 'racing', { }, { timeout: 30000 })));
  const starts = await Promise.all(pages.map(p => p.evaluate(() => ({ start: window.__game.friends.room.startAt, length: window.__game.track.length,
    rivals: window.__game.rivals.rivals.length, traffic: window.__game.traffic.cars.length, reward: window.__game.rewardRace, ghost: window.__game.ghostRec,
    car: window.__game.player.speedMul, remote: !!window.__game.friendCar, round: window.__game.friends.room.round }))));
  assert.equal(starts[0].start, starts[1].start); assert.equal(starts[0].length, starts[1].length);
  starts.forEach(s => { assert.equal(s.rivals, 0); assert.equal(s.traffic, 0); assert.equal(s.reward, null); assert.equal(s.ghost, null); assert.equal(s.remote, true); assert.equal(s.car, 1); });
  assert.equal((await call('mutation', 'sample', { ...credentials, round: 1, seq: 100000, s: 1800, x: 0, v: 100 })).value.accepted, false, 'early teleport rejected');
  console.log('PASS: private seats, invite, mobile lobby, shared start, stock cars, zero bots/traffic/rewards, teleport rejected.');
  // Drive using the real input/physics loop, without writing player positions.
  const drive = page => page.evaluate(() => {
    window.__steerTest = setInterval(() => {
      const g = window.__game;
      if (g.state !== 'racing') return;
      g.input.uiGas = true;
      const lane = g.friends.slot === 0 ? -1.6 : 1.6;
      g.input.heldSteer = Math.max(-1, Math.min(1, (g.player.x - lane) * .5));
    }, 30);
  });
  for (const page of pages) await drive(page);
  await a.waitForFunction(() => window.__game.friends.room.players.every(p => p.s > 50), {}, { timeout: 25000 });
  assert.ok(await a.evaluate(() => window.__game.friendS > 40));
  await a.screenshot({ path: `${out}/live-race.png` });
  const progress = await b.evaluate(() => window.__game.friends.room.players[1].s);
  await b.reload({ waitUntil: 'domcontentloaded' });
  await b.waitForFunction(() => window.__game?.state === 'racing' && window.__game.friends.room?.players.length === 2, {}, { timeout: 18000 });
  assert.equal(await b.evaluate(() => window.__game.friends.slot), 1);
  assert.ok(await b.evaluate(s => window.__game.player.s / window.__game.track.length * 1800 >= s - 2, progress));
  await drive(b);
  console.log('PASS: reload restores the same private seat and accepted progress.');
  await Promise.all(pages.map(p => p.waitForFunction(() => window.__game.friends.room?.state === 'finished', {}, { timeout: 180000 })));
  const results = await Promise.all(pages.map(p => p.evaluate(() => window.__game.friends.room.players.map(d => ({ finish: d.finishAt, dnf: d.dnf, s: d.s })))));
  assert.deepEqual(results[0], results[1]);
  assert.ok(results[0].every(p => p.finish && !p.dnf && p.s === 1800), JSON.stringify(results));
  await a.screenshot({ path: `${out}/results.png` });
  console.log('PASS: two live physics runs finished; both clients show identical server results.');
  await b.reload({ waitUntil: 'domcontentloaded' });
  await b.waitForFunction(() => window.__game?.friends.room?.state === 'finished');
  assert.equal(await b.evaluate(() => window.__game.friendRun), null, 'finished refresh must not restart the car');
  await drive(b);
  await a.click('[data-friend="ready"]'); await b.click('[data-friend="ready"]');
  await a.waitForFunction(() => window.__game.friends.room?.round === 2 && window.__game.state === 'racing');
  assert.equal((await call('mutation', 'sample', { ...credentials, round: 1, seq: 999999, s: 1800, x: 0, v: 0 })).value.accepted, false, 'old round cannot finish rematch');
  await b.context().setOffline(true);
  await a.waitForFunction(() => window.__game.friends.room.players[1].dnf, {}, { timeout: 35000 });
  assert.match(await a.locator('#friends-bar span').textContent(), /DISCONNECTED/);
  await b.context().setOffline(false);
  await b.waitForFunction(() => window.__game.friends.room.players[1].dnf, {}, { timeout: 20000 });
  await a.locator('#friends-bar button').click();
  await a.waitForFunction(() => window.__game.state === 'menu' && !window.__game.friendRun);
  await b.waitForFunction(() => window.__game.friends.room.state === 'closed');
  await b.locator('[data-friend="leave"]').click();
  assert.deepEqual(errors, []); assert.deepEqual(forbidden, []);
  console.log('PASS: rematch round isolation, disconnect/DNF, reconnect, leave/return home; no page errors or economy reward calls.');
} catch (error) {
  console.error('Browser errors:', errors);
  for (const [i, page] of pages.entries()) {
    if (!page.isClosed()) {
      await page.screenshot({ path: `${out}/failure-${i}.png` }).catch(() => {});
      console.error('Client state:', await page.evaluate(() => ({ state: window.__game?.state, room: window.__game?.friends?.room?.state, message: document.querySelector('[data-friend-message]')?.textContent })).catch(() => null));
    }
  }
  throw error;
} finally { await browser.close(); }
