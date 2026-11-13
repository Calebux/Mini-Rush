import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createServer as httpServer } from 'node:http';
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, watch: null, ws: { server: httpServer() } }, appType: 'custom' });
const originalNow = Date.now;
try {
  const f = await server.ssrLoadModule('/convex/friends.ts');
  let now = 1_000_000, serial = 0;
  Date.now = () => now;
  const rows = new Map();
  const ctx = { scheduler: { runAfter: async () => {} }, db: {
    insert: async (_, row) => { const id = String(++serial); rows.set(id, { ...structuredClone(row), _id: id }); return id; },
    get: async id => structuredClone(rows.get(id) ?? null),
    patch: async (id, fields) => rows.set(id, { ...rows.get(id), ...structuredClone(fields) }),
    delete: async id => rows.delete(id),
    query: () => ({ withIndex: (_, build) => {
      const checks = [], index = { eq: (key, value) => { checks.push(r => r[key] === value); return index; },
        gte: (key, value) => { checks.push(r => r[key] >= value); return index; }, lt: (key, value) => { checks.push(r => r[key] < value); return index; } };
      build(index);
      const matching = () => [...rows.values()].filter(r => checks.every(test => test(r))).map(r => structuredClone(r));
      return { unique: async () => matching()[0] ?? null, take: async n => matching().slice(0, n) };
    } })
  } };
  const host = { code: 'AABBCCDD', token: 'a'.repeat(64) }, guest = { code: host.code, token: 'b'.repeat(64) }, other = { code: host.code, token: 'c'.repeat(64) };
  const invoke = (name, args) => f[name]._handler(ctx, args);
  const view = () => invoke('view', host);
  const command = (who, action, round = 1) => invoke('command', { ...who, action, round });
  await invoke('create', { ...host, name: 'Host' });
  await invoke('create', { ...host, name: 'Host' }); assert.equal(rows.size, 1, 'creation retry is idempotent');
  await assert.rejects(invoke('view', other), /Join/);
  await command(host, 'ready'); assert.equal((await view()).state, 'lobby', 'cannot start alone');
  await invoke('join', { ...guest, name: '<script>driver</script>' });
  await assert.rejects(invoke('join', { ...other, name: 'Third' }), /two drivers/);
  assert.ok((await view()).players.every(p => !('token' in p)));
  await command(guest, 'ready'); assert.equal((await view()).state, 'loading');
  await command(host, 'loaded'); assert.equal((await view()).startAt, 0, 'one loaded driver does not start the clock');
  await command(guest, 'loaded'); const start = (await view()).startAt; assert.equal(start, now + 4000);
  const sample = (who, seq, s, extra = {}) => invoke('sample', { ...who, round: 1, seq, s, x: 0, v: 37, ...extra });
  assert.equal((await sample(host, 0, 1)).accepted, false, 'no early launch');
  now = start + 1000;
  for (const extra of [{ s: 1800 }, { s: NaN }, { x: Infinity }, { x: 20 }, { v: -1 }, { seq: 1.5 }]) {
    assert.equal((await sample(host, 0, 10, extra)).accepted, false);
  }
  assert.equal((await sample(host, 0, 30)).accepted, true);
  now += 250;
  assert.equal((await sample(host, 0, 35)).accepted, false, 'replayed sequence rejected');
  assert.equal((await sample(host, 1, 10)).accepted, false, 'reverse progress rejected');
  let seq = 1;
  for (let distance = 100; distance <= 1800; distance += 100) {
    now = start + distance / 30 * 1000;
    assert.equal((await sample(host, seq, distance)).accepted, true);
    now += 200;
    assert.equal((await sample(guest, seq++, distance)).accepted, true);
  }
  const result = await view();
  assert.equal(result.state, 'finished'); assert.ok(result.players[0].finishAt < result.players[1].finishAt);
  assert.equal((await sample(host, 1000, 1800)).accepted, false, 'finish is immutable');
  await command(host, 'ready'); await command(guest, 'ready');
  assert.equal((await view()).round, 2); assert.equal((await view()).state, 'loading');
  assert.ok((await view()).players.every(p => p.s === 0 && p.finishAt === null && p.seq === -1));
  assert.equal((await sample(host, 2000, 1800)).accepted, false, 'stale round rejected');
  await command(host, 'loaded', 2); await command(guest, 'loaded', 2);
  now += 21000; await command(host, 'ping', 2);
  const timeout = await view();
  assert.ok(timeout.players.every(p => p.dnf), 'late heartbeat cannot revive a timed-out driver');
  await command(host, 'leave', 2); assert.equal((await view()).state, 'closed');
  now += 46 * 60_000;
  await assert.rejects(view(), /expired/);
  await invoke('prune', {}); assert.equal(rows.size, 0);
  console.log('PASS: room ownership/capacity, load barrier, start clock, telemetry bounds/replay, finish order, rematch isolation, timeout, leave and expiry cleanup.');
} finally { Date.now = originalNow; await server.close(); }
