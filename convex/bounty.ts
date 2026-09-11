import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';

/**
 * The bounty posted for an ISO week, or null. Public and read-only: the only
 * write is the internal `post` below, so nobody can post a bounty from a browser.
 */
export const forWeek = query({
  args: { week: v.string() },
  handler: async (ctx, { week }) => {
    const row = await ctx.db
      .query('bountyWeeks')
      .withIndex('by_week', (q) => q.eq('week', week))
      .first();
    if (!row || !row.active) return null;
    return { prize: row.prize, split: row.split ?? null, receiver: row.receiver ?? null };
  }
});

/**
 * Post or replace a week's bounty. Internal — callable from the dashboard or a
 * terminal with deploy access, never from the game:
 *   npx convex run --prod bounty:post '{"week":"2026-W38","prize":"12,000 NIM","split":["7,000 NIM","3,500 NIM","1,500 NIM"]}'
 */
export const post = internalMutation({
  args: {
    week: v.string(),
    prize: v.string(),
    split: v.optional(v.array(v.string())),
    receiver: v.optional(v.string()),
    active: v.optional(v.boolean())
  },
  handler: async (ctx, { week, prize, split, receiver, active }) => {
    if (!/^\d{4}-W\d{2}$/.test(week)) throw new Error(`week must look like 2026-W38, got "${week}"`);
    const row = { week, prize, split, receiver, active: active ?? true };
    const existing = await ctx.db
      .query('bountyWeeks')
      .withIndex('by_week', (q) => q.eq('week', week))
      .first();
    if (existing) {
      await ctx.db.replace(existing._id, row);
      return existing._id;
    }
    return await ctx.db.insert('bountyWeeks', row);
  }
});
