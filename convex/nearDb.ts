// Database side of the NEAR layer (convex/near.ts holds the actions that sign).
import { v } from 'convex/values';
import { internalMutation, internalQuery, query } from './_generated/server';

export const RACE_CAP = 400;          // RUSH per race payout
export const DAY_CAP = 4000;          // RUSH per account per UTC day
export const RACE_GAP_MS = 40_000;    // no two payouts closer than a short race
export const CREATIONS_PER_HOUR = 120;

const today = () => new Date().toISOString().slice(0, 10);

export const playerByKey = internalQuery({
  args: { publicKey: v.string() },
  handler: (ctx, { publicKey }) =>
    ctx.db.query('nearPlayers').withIndex('by_key', (q) => q.eq('publicKey', publicKey)).first()
});

export const playerByAccount = internalQuery({
  args: { account: v.string() },
  handler: (ctx, { account }) =>
    ctx.db.query('nearPlayers').withIndex('by_account', (q) => q.eq('account', account)).first()
});

export const recentCreations = internalQuery({
  args: {},
  handler: async (ctx) => {
    const since = Date.now() - 3_600_000;
    const rows = await ctx.db.query('nearPlayers').withIndex('by_created', (q) => q.gt('createdAt', since)).collect();
    return rows.length;
  }
});

/** Players paid in the last hour: how busy the streets are, for the dealers. */
export const recentRacers = internalQuery({
  args: {},
  handler: async (ctx) => {
    const since = Date.now() - 3_600_000;
    const rows = await ctx.db.query('nearPlayers').withIndex('by_paid', (q) => q.gt('lastPaidAt', since)).collect();
    return rows.length;
  }
});

export const insertPlayer = internalMutation({
  args: { account: v.string(), publicKey: v.string() },
  handler: async (ctx, { account, publicKey }) => {
    const had = await ctx.db.query('nearPlayers').withIndex('by_account', (q) => q.eq('account', account)).first();
    if (had) return;
    await ctx.db.insert('nearPlayers', {
      account, publicKey, createdAt: Date.now(), paidToday: 0, payDay: today(), lastPaidAt: 0, lastNonce: 0
    });
  }
});

/**
 * Reserve a race payout before minting. Throws when the request breaks a
 * limit; the caps live here, inside one transaction, so two racing requests
 * can't both slip under them.
 */
export const reservePayout = internalMutation({
  args: { account: v.string(), coins: v.number(), nonce: v.number() },
  handler: async (ctx, { account, coins, nonce }) => {
    const p = await ctx.db.query('nearPlayers').withIndex('by_account', (q) => q.eq('account', account)).first();
    if (!p) throw new Error('unknown player');
    const now = Date.now();
    if (nonce <= p.lastNonce) throw new Error('replayed');
    if (Math.abs(nonce - now) > 10 * 60_000) throw new Error('stale');
    if (now - p.lastPaidAt < RACE_GAP_MS) throw new Error('too soon');
    const paidToday = p.payDay === today() ? p.paidToday : 0;
    const amount = Math.max(0, Math.min(Math.floor(coins), RACE_CAP, DAY_CAP - paidToday));
    if (amount <= 0) throw new Error('daily cap reached');
    await ctx.db.patch(p._id, { paidToday: paidToday + amount, payDay: today(), lastPaidAt: now, lastNonce: nonce });
    return amount;
  }
});

/** Give back a reservation whose mint failed, so the player isn't short-changed by the cap. */
export const releasePayout = internalMutation({
  args: { account: v.string(), amount: v.number() },
  handler: async (ctx, { account, amount }) => {
    const p = await ctx.db.query('nearPlayers').withIndex('by_account', (q) => q.eq('account', account)).first();
    if (p) await ctx.db.patch(p._id, { paidToday: Math.max(0, p.paidToday - amount), lastPaidAt: 0 });
  }
});

export const lastMove = internalQuery({
  args: { token: v.string() },
  handler: (ctx, { token }) =>
    ctx.db.query('dealerMoves').withIndex('by_token', (q) => q.eq('token', token)).order('desc').first()
});

export const recordMoves = internalMutation({
  args: {
    moves: v.array(v.object({
      dealer: v.string(), token: v.string(), oldPrice: v.number(), price: v.number(),
      sold: v.number(), soldSince: v.number(), reason: v.string(), by: v.string(), tx: v.optional(v.string())
    }))
  },
  handler: async (ctx, { moves }) => {
    const at = Date.now();
    for (const m of moves) await ctx.db.insert('dealerMoves', { ...m, at });
  }
});

/** The market's price history, newest first, for the in-game dealer log. */
export const dealerLog = query({
  args: { token: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { token, limit }) => {
    const n = Math.min(50, Math.max(1, limit ?? 20));
    const rows = token
      ? await ctx.db.query('dealerMoves').withIndex('by_token', (q) => q.eq('token', token)).order('desc').take(n)
      : await ctx.db.query('dealerMoves').withIndex('by_at').order('desc').take(n);
    return rows.map(({ dealer, token, oldPrice, price, reason, by, tx, at }) => ({ dealer, token, oldPrice, price, reason, by, tx, at }));
  }
});
