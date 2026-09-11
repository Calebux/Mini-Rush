import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Doc } from './_generated/dataModel';

/**
 * Anonymous player counts behind the /stats page. The game sends a random
 * per-device id (src/usage.ts) and one event at a time; nothing stored here can
 * name a player, and the only public read is the daily totals.
 */

type DayCounts = Omit<Doc<'usageDays'>, '_id' | '_creationTime' | 'day'>;

const ZERO: DayCounts = {
  players: 0, newPlayers: 0, returned: 0, nimiq: 0, newNimiq: 0,
  opens: 0, races: 0, wallets: 0, receipts: 0, bountyEntries: 0, purchases: 0
};

// src/usage.ts makes 24 hex chars; anything else isn't the game talking
const PLAYER_ID = /^[a-f0-9]{24}$/;

// no race ends this soon after the last one, so a quicker "finish" is a repeat
const RACE_GAP_MS = 10_000;

export const ping = mutation({
  args: {
    pid: v.string(),
    platform: v.union(v.literal('nimiq'), v.literal('web')),
    event: v.union(
      v.literal('open'), v.literal('race'), v.literal('wallet'),
      v.literal('receipt'), v.literal('bounty'), v.literal('purchase')
    )
  },
  handler: async (ctx, { pid, platform, event }) => {
    if (!PLAYER_ID.test(pid)) return null;
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const add: Partial<DayCounts> = {};
    const bump = (key: keyof DayCounts): void => {
      add[key] = (add[key] ?? 0) + 1;
    };

    const player = await ctx.db
      .query('players')
      .withIndex('by_pid', (q) => q.eq('pid', pid))
      .first();
    let days = player?.days ?? 1;
    let races = player?.races ?? 0;
    let lastRaceAt = player?.lastRaceAt ?? 0;
    let wallet = player?.wallet ?? false;

    // a player's first event of the UTC day, whatever it is, makes them active today
    if (!player) {
      bump('players');
      bump('newPlayers');
      if (platform === 'nimiq') {
        bump('nimiq');
        bump('newNimiq');
      }
    } else if (player.lastDay !== today) {
      bump('players');
      if (platform === 'nimiq') bump('nimiq');
      days += 1;
      if (days === 2) bump('returned');
    }

    switch (event) {
      case 'open':
        bump('opens');
        break;
      case 'race':
        if (now - lastRaceAt >= RACE_GAP_MS) {
          bump('races');
          races += 1;
          lastRaceAt = now;
        }
        break;
      case 'wallet':
        if (!wallet) bump('wallets');
        wallet = true;
        break;
      case 'receipt':
        bump('receipts');
        break;
      case 'bounty':
        bump('bountyEntries');
        break;
      case 'purchase':
        bump('purchases');
        break;
    }

    const row = { pid, platform, lastSeen: now, lastDay: today, days, races, lastRaceAt, wallet };
    if (player) await ctx.db.patch(player._id, row);
    else await ctx.db.insert('players', { ...row, firstSeen: now });

    const keys = Object.keys(add) as (keyof DayCounts)[];
    if (keys.length === 0) return null;
    const day = await ctx.db
      .query('usageDays')
      .withIndex('by_day', (q) => q.eq('day', today))
      .first();
    if (day) {
      const patch: Partial<DayCounts> = {};
      for (const key of keys) patch[key] = day[key] + (add[key] ?? 0);
      await ctx.db.patch(day._id, patch);
    } else {
      const fresh: DayCounts = { ...ZERO };
      for (const key of keys) fresh[key] = add[key] ?? 0;
      await ctx.db.insert('usageDays', { day: today, ...fresh });
    }
    return null;
  }
});

/** Daily counts, newest first, and all-time totals. Public: aggregates only. */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('usageDays').withIndex('by_day').order('desc').collect();
    const sum = (key: keyof DayCounts): number => rows.reduce((n, row) => n + row[key], 0);
    return {
      since: rows.length ? rows[rows.length - 1].day : null,
      totals: {
        players: sum('newPlayers'),
        nimiqPlayers: sum('newNimiq'),
        returned: sum('returned'),
        opens: sum('opens'),
        races: sum('races'),
        wallets: sum('wallets'),
        receipts: sum('receipts'),
        bountyEntries: sum('bountyEntries'),
        purchases: sum('purchases')
      },
      days: rows.slice(0, 30).map((row) => ({ day: row.day, ...counts(row) }))
    };
  }
});

/** A day row without its document fields. */
function counts(row: DayCounts): DayCounts {
  const out: DayCounts = { ...ZERO };
  for (const key of Object.keys(ZERO) as (keyof DayCounts)[]) out[key] = row[key];
  return out;
}
