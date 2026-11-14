import type { MutationCtx } from './_generated/server';

// Fixed UTC windows. These bound sponsored attempts, including failed calls;
// they are not proof of a unique human. All checks and writes share one mutation.
export async function spendBudget(ctx: MutationCtx, scope: string, limit: number, windowMs: number, now = Date.now()) {
  const window = Math.floor(now / windowMs);
  const row = await ctx.db.query('sponsorBudgets').withIndex('by_scope_window', q => q.eq('scope', scope).eq('window', window)).first();
  if ((row?.used ?? 0) >= limit) throw new Error('Sponsorship limit reached. Please try again later.');
  if (row) await ctx.db.patch(row._id, { used: row.used + 1 });
  else await ctx.db.insert('sponsorBudgets', { scope, window, used: 1, expiresAt: (window + 1) * windowMs });
}
