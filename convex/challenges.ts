// "Beat my time": a run someone shared as a link. The row holds the circuit it
// was set on and the packed lap line (src/ghostShare.ts), so opening the link
// drops you on the same track with their car as a ghost.
//
// Written from the phone like the boards, and read by anyone holding the code,
// so it is validated the same way and carries nothing a prize depends on.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

const CODE = /^[a-z0-9]{8}$/;
const MAX_GHOST = 24000;
const KEEP_DAYS = 30;

/** A challenge by its code, or null once it is gone. */
export const get = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    if (!CODE.test(code)) return null;
    const row = await ctx.db
      .query('challenges')
      .withIndex('by_code', (q) => q.eq('code', code))
      .first();
    if (!row) return null;
    if (Date.now() - row.at > KEEP_DAYS * 86400000) return null; // stale link
    return {
      tag: row.tag, mapId: row.mapId, modeId: row.modeId, seed: row.seed,
      laps: row.laps, len: row.len, timeS: row.timeS, score: row.score,
      car: row.car, ghost: row.ghost
    };
  }
});

/** Publish a run to challenge with. Answers with its code, or null. */
export const create = mutation({
  args: {
    code: v.string(),
    tag: v.string(),
    mapId: v.string(),
    modeId: v.string(),
    seed: v.number(),
    laps: v.number(),
    len: v.number(),
    timeS: v.number(),
    score: v.number(),
    car: v.string(),
    ghost: v.string()
  },
  handler: async (ctx, args) => {
    const { code, seed, laps, len, timeS, ghost } = args;
    // all of it comes from a phone
    if (!CODE.test(code)) return null;
    if (!Number.isInteger(seed) || seed < 0 || seed > 1e9) return null;
    if (!Number.isInteger(laps) || laps < 1 || laps > 12) return null;
    if (!Number.isFinite(len) || len < 300 || len > 6000) return null;
    if (!Number.isFinite(timeS) || timeS <= 0 || timeS > 3600) return null;
    if (!Number.isFinite(args.score) || args.score < 0 || args.score > 1e7) return null;
    if (!/^[a-z0-9_-]{1,24}$/i.test(args.mapId) || !/^[a-z0-9_-]{1,24}$/i.test(args.modeId)) return null;
    if (ghost.length > MAX_GHOST || !ghost.startsWith('g1.')) return null;
    // a taken code means the caller should roll another one
    const clash = await ctx.db
      .query('challenges')
      .withIndex('by_code', (q) => q.eq('code', code))
      .first();
    if (clash) return null;
    await ctx.db.insert('challenges', {
      code, tag: args.tag.slice(0, 24), mapId: args.mapId, modeId: args.modeId,
      seed, laps, len, timeS, score: args.score, car: args.car.slice(0, 24), ghost, at: Date.now()
    });
    return code;
  }
});
