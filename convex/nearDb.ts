// Database side of the NEAR layer (convex/near.ts holds the actions that sign).
import { v } from 'convex/values';
import { checkProgress, rewardPlace } from '../shared/raceRules';
import { identityMessage, IDENTITY_TTL } from '../shared/identityProof';
import { internalMutation, internalQuery, query } from './_generated/server';

export const RACE_CAP = 400;          // RUSH per race payout
export const DAY_CAP = 4000;          // RUSH per account per UTC day
export const RACE_GAP_MS = 40_000;    // no two payouts closer than a short race
export const CREATIONS_PER_HOUR = 120;

const today = () => new Date().toISOString().slice(0, 10);

export const identityProof = internalQuery({
  args: { id: v.id('identityProofs') }, handler: (ctx, { id }) => ctx.db.get(id)
});
export const issueIdentityProof = internalMutation({
  args: { account: v.string(), garageKey: v.string(), identityKey: v.string(), recipient: v.string(), request: v.string(), nonce: v.string(), garage: v.string() },
  handler: async (ctx, args) => {
    const old = await ctx.db.query('identityProofs').withIndex('by_account_request', q => q.eq('account', args.account).eq('request', args.request)).first();
    if (old) {
      if (old.identityKey !== args.identityKey || old.garageKey !== args.garageKey || old.recipient !== args.recipient) throw new Error('Challenge request changed');
      return old;
    }
    const recent = await ctx.db.query('identityProofs').withIndex('by_account_created', q => q.eq('account', args.account).gt('createdAt', Date.now() - 86400_000)).take(10);
    if (recent.length >= 10 || recent.some(p => p.createdAt > Date.now() - 30_000)) throw new Error('Please wait before starting another ownership check');
    if (recent.some(p => p.expiresAt > Date.now() && (p.state === 'issued' || p.state === 'pending'))) throw new Error('Finish the current ownership check first');
    const expiresAt = Date.now() + IDENTITY_TTL;
    const { garage, ...row } = args;
    const id = await ctx.db.insert('identityProofs', { ...row, expiresAt, createdAt: Date.now(), state: 'issued',
      message: identityMessage(args.account, args.garageKey, args.identityKey, garage, expiresAt) });
    return (await ctx.db.get(id))!;
  }
});
export const prepareIdentityProof = internalMutation({
  args: { id: v.id('identityProofs'), tx: v.string(), signedTransaction: v.string(), identityHash: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error('Unknown ownership check');
    if (row.state !== 'issued') return row;
    if (row.expiresAt <= Date.now()) throw new Error('Ownership check expired');
    const current = await ctx.db.query('garageIdentities').withIndex('by_account', q => q.eq('account', row.account)).first();
    const identity = await ctx.db.query('garageIdentities').withIndex('by_identity', q => q.eq('identityHash', args.identityHash)).first();
    if (current && (current.identityHash !== args.identityHash || current.identityKey !== row.identityKey) || identity && identity.account !== row.account) throw new Error('This identity or garage is already linked');
    const day = today();
    const budget = await ctx.db.query('identityBudgets').withIndex('by_day', q => q.eq('day', day)).first();
    if ((budget?.signatures ?? 0) >= 100) throw new Error('Ownership checks are at today’s limit');
    if (budget) await ctx.db.patch(budget._id, { signatures: budget.signatures + 1 });
    else await ctx.db.insert('identityBudgets', { day, signatures: 1 });
    await ctx.db.patch(row._id, { state: 'pending', tx: args.tx, signedTransaction: args.signedTransaction, identityHash: args.identityHash });
    return (await ctx.db.get(row._id))!;
  }
});
export const finishIdentityProof = internalMutation({
  args: { id: v.id('identityProofs'), verified: v.boolean(), message: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.state !== 'pending') return row;
    let verified = args.verified && row.expiresAt > Date.now() && !!row.identityHash && !!row.tx;
    const player = await ctx.db.query('nearPlayers').withIndex('by_account', q => q.eq('account', row.account)).first();
    if (player?.publicKey !== row.garageKey) verified = false;
    const current = await ctx.db.query('garageIdentities').withIndex('by_account', q => q.eq('account', row.account)).first();
    const identity = row.identityHash ? await ctx.db.query('garageIdentities').withIndex('by_identity', q => q.eq('identityHash', row.identityHash!)).first() : null;
    if (current && (current.identityHash !== row.identityHash || current.identityKey !== row.identityKey) || identity && identity.account !== row.account) verified = false;
    if (verified && !current) await ctx.db.insert('garageIdentities', { account: row.account, garageKey: row.garageKey, identityKey: row.identityKey,
      identityHash: row.identityHash!, proofTx: row.tx!, verifiedAt: Date.now() });
    const message = verified ? 'Ownership link verified. Account recovery is not enabled yet.' : args.verified ? 'The ownership check expired or the garage changed. Start a new check.' : args.message;
    await ctx.db.patch(row._id, { state: verified ? 'verified' : 'failed', result: message, signedTransaction: undefined });
    return (await ctx.db.get(row._id))!;
  }
});
export const pruneIdentityProofs = internalMutation({
  args: {}, handler: async ctx => {
    const expired = await ctx.db.query('identityProofs').withIndex('by_expiry', q => q.lt('expiresAt', Date.now() - 86400_000)).take(200);
    for (const row of expired) await ctx.db.delete(row._id);
    const budgets = await ctx.db.query('identityBudgets').withIndex('by_day', q => q.lt('day', new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10))).take(30);
    for (const row of budgets) await ctx.db.delete(row._id);
  }
});

export const garageAction = internalQuery({
  args: { digest: v.string() },
  handler: (ctx, { digest }) => ctx.db.query('garageActions').withIndex('by_digest', q => q.eq('digest', digest)).first()
});
export const prepareGarageAction = internalMutation({
  args: { digest: v.string(), account: v.string(), tx: v.string(), signedTransaction: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('garageActions').withIndex('by_digest', q => q.eq('digest', args.digest)).first();
    if (existing) return existing;
    const pending = await ctx.db.query('garageActions').withIndex('by_account_state', q => q.eq('account', args.account).eq('state', 'pending')).first();
    if (pending) throw new Error('Another action for this garage is still completing.');
    const id = await ctx.db.insert('garageActions', { ...args, state: 'pending', createdAt: Date.now() });
    return (await ctx.db.get(id))!;
  }
});
export const finishGarageAction = internalMutation({
  args: { digest: v.string(), state: v.union(v.literal('confirmed'), v.literal('failed')), result: v.string() },
  handler: async (ctx, { digest, state, result }) => {
    const row = await ctx.db.query('garageActions').withIndex('by_digest', q => q.eq('digest', digest)).first();
    if (row?.state === 'pending') await ctx.db.patch(row._id, { state, result });
  }
});
export const pruneGarageActions = internalMutation({
  args: {},
  handler: async ctx => {
    for (const state of ['confirmed', 'failed'] as const) {
      const rows = await ctx.db.query('garageActions').withIndex('by_state_created', q => q.eq('state', state).lt('createdAt', Date.now() - 30 * 86400_000)).take(100);
      for (const row of rows) await ctx.db.delete(row._id);
    }
  }
});

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

/** Records a test NEAR top-up before it is sent: one per garage, `cap` per UTC day. */
export const reserveGrant = internalMutation({
  args: { account: v.string(), amount: v.string(), cap: v.number() },
  handler: async (ctx, { account, amount, cap }): Promise<'ok' | 'already' | 'budget'> => {
    if (await ctx.db.query('nearGrants').withIndex('by_account', (q) => q.eq('account', account)).first()) return 'already';
    const day = today();
    const sent = await ctx.db.query('nearGrants').withIndex('by_day', (q) => q.eq('day', day)).collect();
    if (sent.length >= cap) return 'budget';
    await ctx.db.insert('nearGrants', { account, day, amount, at: Date.now() });
    return 'ok';
  }
});

export const settleGrant = internalMutation({
  args: { account: v.string(), tx: v.string() },
  handler: async (ctx, { account, tx }) => {
    const row = await ctx.db.query('nearGrants').withIndex('by_account', (q) => q.eq('account', account)).first();
    if (row) await ctx.db.patch(row._id, { tx });
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


export const beginRace = internalMutation({
  args: { account: v.string(), run: v.string(), distance: v.number() },
  handler: async (ctx, { account, run, distance }) => {
    if (!/^[a-zA-Z0-9-]{16,64}$/.test(run) || !Number.isSafeInteger(distance) || distance < 500 || distance > 16000) throw new Error('invalid race');
    const existing = await ctx.db.query('nearRaces').withIndex('by_account_run', q => q.eq('account', account).eq('run', run)).first();
    if (existing) return existing._id;
    const previous = await ctx.db.query('nearRaces').withIndex('by_account_started', q => q.eq('account', account)).order('desc').first();
    const now = Date.now();
    if (previous && now - previous.startedAt < 5000) throw new Error('wait before restarting');
    if (previous?.status === 'active') await ctx.db.patch(previous._id, { status: 'abandoned' });
    return ctx.db.insert('nearRaces', { account, run, distance, startedAt: now, sampledAt: now,
      progress: 0, elapsed: 0, samples: 0, status: 'active' });
  }
});
export const raceProgress = internalMutation({
  args: { account: v.string(), race: v.id('nearRaces'), progress: v.number(), elapsed: v.number(), finish: v.boolean(), place: v.optional(v.number()) },
  handler: async (ctx, { account, race: id, progress, elapsed, finish, place }) => {
    const race = await ctx.db.get(id);
    if (!race || race.account !== account) throw new Error('unknown race');
    if (finish && (race.status === 'pending' || race.status === 'paid')) return race;
    if (race.status !== 'active') throw new Error('race is no longer active');
    const now = Date.now();
    checkProgress(race, progress, elapsed, now, finish);
    // The first accepted finish fixes the tier; a later retry cannot claim a better one.
    const tier = finish ? rewardPlace(place) : undefined;
    await ctx.db.patch(id, { sampledAt: now, progress, elapsed, samples: race.samples + 1, status: finish ? 'pending' : 'active',
      ...(finish ? { place: tier } : {}) });
    return { ...race, place: tier };
  }
});
export const completeRace = internalMutation({
  args: { race: v.id('nearRaces'), tx: v.string() },
  handler: async (ctx, { race, tx }) => {
    const r = await ctx.db.get(race);
    if (!r || r.status === 'paid') return;
    if (r.status !== 'pending') throw new Error('race not reserved');
    await ctx.db.patch(race, { status: 'paid', tx });
    const p = await ctx.db.query('nearPlayers').withIndex('by_account', q => q.eq('account', r.account)).first();
    if (p) await ctx.db.patch(p._id, { lastPaidAt: Date.now() });
  }
});
