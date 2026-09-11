import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import type { Doc } from './_generated/dataModel';

/**
 * Player counts and the driver list behind the /stats page. The game sends a
 * random per-device id (src/usage.ts), the driver name it races under and one
 * event at a time. No wallet addresses or Nimiq device ids are stored.
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

// the username rules the game applies (src/driver.ts)
const NAME_MIN = 3;
const NAME_MAX = 16;

// how many drivers /stats lists, most recently seen first
const DRIVER_LIST = 100;

/** A driver name as the game would store it, or undefined when it isn't one. */
function cleanName(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const name = raw.toUpperCase().replace(/[^A-Z0-9 _-]/g, '').replace(/\s+/g, ' ')
    .trim().slice(0, NAME_MAX).trim();
  return name.length >= NAME_MIN ? name : undefined;
}

export const ping = mutation({
  args: {
    pid: v.string(),
    platform: v.union(v.literal('nimiq'), v.literal('web')),
    event: v.union(
      v.literal('open'), v.literal('race'), v.literal('wallet'),
      v.literal('receipt'), v.literal('bounty'), v.literal('purchase'),
      v.literal('name')
    ),
    name: v.optional(v.string())
  },
  handler: async (ctx, { pid, platform, event, name: rawName }) => {
    if (!PLAYER_ID.test(pid)) return null;
    const name = cleanName(rawName);
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
      case 'name':
        break; // a new username: only the name below changes
    }

    const row = {
      pid, platform, lastSeen: now, lastDay: today, days, races, lastRaceAt, wallet,
      ...(name ? { name } : {})
    };
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

/**
 * Take a driver name off /stats, or put it back with "hidden": false. Their
 * counts stay in the totals. Internal — run it from a terminal with deploy access:
 *   npx convex run --prod usage:hide '{"name":"SOME NAME"}'
 */
export const hide = internalMutation({
  args: { name: v.string(), hidden: v.optional(v.boolean()) },
  handler: async (ctx, { name, hidden }) => {
    const target = cleanName(name);
    if (!target) throw new Error(`"${name}" is not a driver name`);
    const rows = await ctx.db
      .query('players')
      .withIndex('by_name', (q) => q.eq('name', target))
      .collect();
    for (const row of rows) await ctx.db.patch(row._id, { hidden: hidden ?? true });
    return rows.length;
  }
});

/** Daily counts, all-time totals and the latest drivers. Public: nothing beyond /stats. */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('usageDays').withIndex('by_day').order('desc').collect();
    const recent = await ctx.db.query('players').withIndex('by_lastSeen').order('desc').take(DRIVER_LIST);
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
      days: rows.slice(0, 30).map((row) => ({ day: row.day, ...counts(row) })),
      drivers: recent.filter((p) => !p.hidden).map((p) => ({
        name: p.name ?? null,
        platform: p.platform,
        races: p.races,
        days: p.days,
        lastDay: p.lastDay
      }))
    };
  }
});

/** A day row without its document fields. */
function counts(row: DayCounts): DayCounts {
  const out: DayCounts = { ...ZERO };
  for (const key of Object.keys(ZERO) as (keyof DayCounts)[]) out[key] = row[key];
  return out;
}
