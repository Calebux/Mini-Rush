// The Weekend GP board: one row per device per ISO week, holding the run's
// time and the packed lap line other players race as a ghost (src/ghostShare.ts).
//
// Unlike bounty weeks, this one has a public write path — the game posts a run
// straight from the player's phone. That is deliberate and its limits are
// known: times come from the device, so anyone determined can post a fake one.
// It is an arcade board and a ghost feed, nothing more. Prizes stay on the
// on-chain bounty entries, which are verified separately.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

const WEEK = /^\d{4}-W\d{2}$/;
const MAX_GHOST = 24000; // a packed 8-lap run is ~8.5 kB
const MIN_TIME = 120;    // eight laps cannot be quicker than this, whatever the tune
const MAX_TIME = 3600;

/** The weekend's fastest runs, best first, with the line each one drove. */
export const top = query({
  args: { week: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { week, limit }) => {
    if (!WEEK.test(week)) return [];
    const count = Math.max(1, Math.min(10, Math.floor(limit ?? 5)));
    const rows = await ctx.db
      .query('weekendRuns')
      .withIndex('by_week_time', (q) => q.eq('week', week))
      .order('asc')
      .take(count);
    return rows.map((r) => ({
      pid: r.pid, tag: r.tag, timeS: r.timeS, score: r.score, car: r.car, ghost: r.ghost
    }));
  }
});

/**
 * Post a run. Keeps one row per device per week — the fastest — and answers
 * with the rank it earned, or 0 when it did not beat that device's own time.
 */
export const post = mutation({
  args: {
    week: v.string(),
    pid: v.string(),
    tag: v.string(),
    timeS: v.number(),
    score: v.number(),
    place: v.number(),
    car: v.string(),
    ghost: v.string()
  },
  handler: async (ctx, args) => {
    const { week, pid, timeS } = args;
    // every field is from a phone, so none of it is trusted
    if (!WEEK.test(week)) return 0;
    if (!/^[a-f0-9]{24}$/.test(pid)) return 0;
    if (!Number.isFinite(timeS) || timeS < MIN_TIME || timeS > MAX_TIME) return 0;
    if (!Number.isFinite(args.score) || args.score < 0 || args.score > 1e7) return 0;
    if (!Number.isInteger(args.place) || args.place < 1 || args.place > 16) return 0;
    if (args.ghost.length > MAX_GHOST || !args.ghost.startsWith('g1.')) return 0;

    const row = {
      week, pid,
      tag: args.tag.slice(0, 24),
      timeS, score: args.score, place: args.place,
      car: args.car.slice(0, 24),
      ghost: args.ghost,
      at: Date.now()
    };
    const mine = await ctx.db
      .query('weekendRuns')
      .withIndex('by_week_pid', (q) => q.eq('week', week).eq('pid', pid))
      .first();
    if (mine) {
      if (mine.timeS <= timeS) return 0; // their own quicker run stands
      await ctx.db.replace(mine._id, row);
    } else {
      await ctx.db.insert('weekendRuns', row);
    }
    const faster = await ctx.db
      .query('weekendRuns')
      .withIndex('by_week_time', (q) => q.eq('week', week))
      .order('asc')
      .take(100);
    const rank = faster.findIndex((r) => r.pid === pid) + 1;
    return rank;
  }
});
