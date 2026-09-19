// The worldwide daily and bounty boards. One row per device per board, the
// player's best kept: the daily ranks on score, the bounty on time and takes
// wins only. Same trust model as convex/weekend.ts — the game writes these
// from the phone, so they are arcade boards and a live view, never the thing a
// prize is decided from. The bounty prize comes from on-chain MR3 entries.
import { v } from 'convex/values';
import { mutation, MutationCtx, query } from './_generated/server';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const WEEK = /^\d{4}-W\d{2}$/;
const PID = /^[a-f0-9]{24}$/;

const run = {
  pid: v.string(),
  tag: v.string(),
  score: v.number(),
  timeS: v.number(),
  place: v.number(),
  laps: v.number(),
  car: v.string()
};

type Run = {
  pid: string; tag: string; score: number; timeS: number;
  place: number; laps: number; car: string;
};

/** Nothing here is trusted: it all arrives from a phone. */
function clean(board: string, r: Run): (Run & { board: string; at: number }) | null {
  if (!PID.test(r.pid)) return null;
  if (!Number.isFinite(r.score) || r.score < 0 || r.score > 1e7) return null;
  if (!Number.isFinite(r.timeS) || r.timeS <= 0 || r.timeS > 3600) return null;
  if (!Number.isInteger(r.place) || r.place < 1 || r.place > 16) return null;
  if (!Number.isInteger(r.laps) || r.laps < 1 || r.laps > 12) return null;
  return {
    board, pid: r.pid, tag: r.tag.slice(0, 24), score: r.score, timeS: r.timeS,
    place: r.place, laps: r.laps, car: r.car.slice(0, 24), at: Date.now()
  };
}

const rows = (limit?: number): number => Math.max(1, Math.min(20, Math.floor(limit ?? 10)));

export const topDaily = query({
  args: { day: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { day, limit }) => {
    if (!DAY.test(day)) return [];
    const list = await ctx.db
      .query('boardRuns')
      .withIndex('by_board_score', (q) => q.eq('board', `daily-${day}`))
      .order('desc') // best score first
      .take(rows(limit));
    return list.map(({ pid, tag, score, timeS, place, laps, car }) =>
      ({ pid, tag, score, timeS, place, laps, car }));
  }
});

export const topBounty = query({
  args: { week: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { week, limit }) => {
    if (!WEEK.test(week)) return [];
    const list = await ctx.db
      .query('boardRuns')
      .withIndex('by_board_time', (q) => q.eq('board', `bounty-${week}`))
      .order('asc') // fastest win first
      .take(rows(limit));
    return list.map(({ pid, tag, score, timeS, place, laps, car }) =>
      ({ pid, tag, score, timeS, place, laps, car }));
  }
});

/** Upsert the device's row when the run beats it, and answer with its rank. */
async function post(
  ctx: MutationCtx, board: string, r: Run,
  better: (fresh: Run, kept: { score: number; timeS: number }) => boolean,
  index: 'by_board_score' | 'by_board_time', order: 'asc' | 'desc'
): Promise<number> {
  const row = clean(board, r);
  if (!row) return 0;
  const mine = await ctx.db
    .query('boardRuns')
    .withIndex('by_board_pid', (q) => q.eq('board', board).eq('pid', r.pid))
    .first();
  if (mine) {
    if (!better(r, mine)) return 0;
    await ctx.db.replace(mine._id, row);
  } else {
    await ctx.db.insert('boardRuns', row);
  }
  const best = index === 'by_board_score'
    ? await ctx.db.query('boardRuns')
      .withIndex('by_board_score', (q) => q.eq('board', board)).order(order).take(100)
    : await ctx.db.query('boardRuns')
      .withIndex('by_board_time', (q) => q.eq('board', board)).order(order).take(100);
  return best.findIndex((e) => e.pid === r.pid) + 1;
}

export const postDaily = mutation({
  args: { day: v.string(), ...run },
  handler: async (ctx, { day, ...r }) => {
    if (!DAY.test(day)) return 0;
    return post(ctx, `daily-${day}`, r, (fresh, kept) => fresh.score > kept.score, 'by_board_score', 'desc');
  }
});

export const postBounty = mutation({
  args: { week: v.string(), ...run },
  handler: async (ctx, { week, ...r }) => {
    if (!WEEK.test(week)) return 0;
    if (r.place !== 1) return 0; // the bounty board takes wins only
    return post(ctx, `bounty-${week}`, r, (fresh, kept) => fresh.timeS < kept.timeS, 'by_board_time', 'asc');
  }
});
