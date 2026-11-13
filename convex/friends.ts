import { v, ConvexError } from 'convex/values';
import { mutation, query, internalMutation, type MutationCtx, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { FRIEND_LENGTH, FRIEND_TIMEOUT, FRIEND_DURATION, validFriendSample } from '../shared/friendRace';

const credentials = { code: v.string(), token: v.string() };
function check(code: string, token: string) {
  if (!/^[A-F0-9]{8}$/.test(code) || !/^[a-f0-9]{64}$/.test(token)) throw new ConvexError('Invalid room credentials.');
}
const driver = (token: string, name: string, slot: number) => ({ token, name: name.trim().slice(0, 24) || `Driver ${slot + 1}`,
  ready: false, loaded: false, seen: Date.now(), s: 0, x: slot === 0 ? -2 : 2, v: 0, seq: -1, sampleAt: 0, finishAt: null as number | null, dnf: false });
async function member(ctx: QueryCtx | MutationCtx, code: string, token: string) {
  check(code, token);
  const room = await ctx.db.query('friendRooms').withIndex('by_code', q => q.eq('code', code)).unique();
  if (!room || room.expiresAt <= Date.now()) throw new ConvexError('This room has expired. Create a new race.');
  const slot = room.players.findIndex(p => p.token === token);
  if (slot < 0) throw new ConvexError('Join this room first.');
  return { room, slot };
}
function expireDrivers(room: Doc<'friendRooms'>, now: number) {
  if (room.state !== 'race' && room.state !== 'loading') return;
  for (const p of room.players) {
    if (p.finishAt === null && (now - p.seen > FRIEND_TIMEOUT || (room.startAt > 0 && now - room.startAt > FRIEND_DURATION))) p.dnf = true;
  }
  if (room.players.some(p => p.dnf) && room.state === 'loading') {
    room.players.forEach(p => { p.dnf = true; });
  }
  if (room.players.every(p => p.dnf || p.finishAt !== null)) room.state = 'finished';
}
export const create = mutation({ args: { ...credentials, name: v.string() }, handler: async (ctx, a) => {
  check(a.code, a.token);
  const old = await ctx.db.query('friendRooms').withIndex('by_code', q => q.eq('code', a.code)).unique();
  if (old) {
    if (old.players[0].token === a.token && old.expiresAt > Date.now()) return { slot: 0 };
    throw new ConvexError('Room code already taken. Try creating again.');
  }
  const recent = await ctx.db.query('friendRooms').withIndex('by_created', q => q.gte('createdAt', Date.now() - 3600_000)).take(120);
  if (recent.length >= 120) throw new ConvexError('The paddock is full. Please try again later.');
  const id = await ctx.db.insert('friendRooms', { code: a.code, createdAt: Date.now(), expiresAt: Date.now() + 45 * 60_000,
    round: 1, state: 'lobby', startAt: 0, players: [driver(a.token, a.name, 0)] });
  await ctx.scheduler.runAfter(5000, internal.friends.watchdog, { id });
  return { slot: 0 };
} });
export const join = mutation({ args: { ...credentials, name: v.string() }, handler: async (ctx, a) => {
  check(a.code, a.token);
  const room = await ctx.db.query('friendRooms').withIndex('by_code', q => q.eq('code', a.code)).unique();
  if (!room || room.expiresAt <= Date.now() || room.state === 'closed') throw new ConvexError('Room not found or expired. Check the invite code.');
  const slot = room.players.findIndex(p => p.token === a.token);
  if (slot >= 0) return { slot };
  if (room.state !== 'lobby' || room.players.length !== 1) throw new ConvexError('This race already has two drivers.');
  await ctx.db.patch(room._id, { players: [...room.players, driver(a.token, a.name, 1)] });
  return { slot: 1 };
} });
export const view = query({ args: credentials, handler: async (ctx, a) => {
  const { room, slot } = await member(ctx, a.code, a.token);
  return { code: room.code, round: room.round, state: room.state, startAt: room.startAt, expiresAt: room.expiresAt,
    slot, players: room.players.map(({ token: _secret, ...p }) => p) };
} });
export const command = mutation({ args: { ...credentials, round: v.number(), action: v.union(v.literal('ready'), v.literal('loaded'), v.literal('ping'), v.literal('leave')) }, handler: async (ctx, a) => {
  const { room, slot } = await member(ctx, a.code, a.token), now = Date.now();
  if (a.round !== room.round) throw new ConvexError('The race has moved to another round.');
  expireDrivers(room, now);
  const p = room.players[slot];
  p.seen = now;
  if (a.action === 'leave') room.state = 'closed';
  if (a.action === 'ready' && (room.state === 'lobby' || room.state === 'finished')) {
    p.ready = !p.ready;
    if (room.players.length === 2 && room.players.every(p => p.ready && now - p.seen < 10_000)) {
      if (room.state === 'finished') room.round++;
      room.players = room.players.map((p, i) => ({ ...driver(p.token, p.name, i), ready: false }));
      room.state = 'loading'; room.startAt = 0;
    }
  }
  if (a.action === 'loaded' && room.state === 'loading') {
    room.players[slot].loaded = true;
    if (room.players.every(p => p.loaded)) { room.startAt = now + 4000; room.state = 'race'; }
  }
  await ctx.db.patch(room._id, { players: room.players, state: room.state, startAt: room.startAt, round: room.round });
  return { now };
} });
export const sample = mutation({ args: { ...credentials, round: v.number(), seq: v.number(), s: v.number(), x: v.number(), v: v.number() }, handler: async (ctx, a) => {
  const { room, slot } = await member(ctx, a.code, a.token), now = Date.now();
  expireDrivers(room, now);
  const p = room.players[slot];
  if (room.state !== 'race' || room.round !== a.round || p.dnf || p.finishAt !== null) return { accepted: false, now };
  if (!validFriendSample(p, a.s, a.x, a.v, a.seq, now, room.startAt)) return { accepted: false, now };
  Object.assign(p, { s: Math.max(p.s, a.s), x: a.x, v: a.v, seq: a.seq, sampleAt: now, seen: now });
  // Finish order uses receipt time, never a client-submitted time or place.
  if (a.s >= FRIEND_LENGTH) p.finishAt = now;
  if (room.players.every(p => p.dnf || p.finishAt !== null)) room.state = 'finished';
  await ctx.db.patch(room._id, { players: room.players, state: room.state });
  return { accepted: true, now };
} });
export const watchdog = internalMutation({ args: { id: v.id('friendRooms') }, handler: async (ctx, { id }) => {
  const room = await ctx.db.get(id);
  if (!room || room.state === 'closed' || room.expiresAt <= Date.now()) return;
  const before = JSON.stringify([room.state, room.players]);
  expireDrivers(room, Date.now());
  if ((room.state === 'lobby' || room.state === 'finished') && room.players.every(p => Date.now() - p.seen > 60_000)) room.state = 'closed';
  if (before !== JSON.stringify([room.state, room.players])) await ctx.db.patch(id, { state: room.state, players: room.players });
  if (room.state !== 'closed') await ctx.scheduler.runAfter(5000, internal.friends.watchdog, { id });
} });
export const prune = internalMutation({ args: {}, handler: async ctx => {
  const expired = await ctx.db.query('friendRooms').withIndex('by_expiry', q => q.lt('expiresAt', Date.now())).take(200);
  for (const room of expired) await ctx.db.delete(room._id);
} });
