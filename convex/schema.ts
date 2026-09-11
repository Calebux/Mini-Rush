// Bounty weeks are organizer-edited: rows are added and switched on or off in
// the Convex dashboard (or with `bounty:post` from a terminal) and the game only
// reads them. Player counts are written by the game through convex/usage.ts.
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  // One row per bounty week, keyed by the ISO week the game uses ("2026-W38").
  bountyWeeks: defineTable({
    week: v.string(),
    prize: v.string(),                     // shown to players, e.g. "12,000 NIM"
    active: v.boolean(),                   // false pulls the bounty but keeps the row
    split: v.optional(v.array(v.string())), // prize per place, 1st first; absent = winner takes all
    receiver: v.optional(v.string())       // NQ address entries go to; the build's receipt address otherwise
  }).index('by_week', ['week']),

  // One row per device that has played. `pid` is a random id the game makes
  // (src/usage.ts), never a name, wallet address or Nimiq device id.
  players: defineTable({
    pid: v.string(),
    platform: v.union(v.literal('nimiq'), v.literal('web')), // where it was last seen
    firstSeen: v.number(),
    lastSeen: v.number(),
    lastDay: v.string(),                   // UTC date of the latest event, "2026-09-14"
    days: v.number(),                      // distinct UTC days seen
    races: v.number(),
    lastRaceAt: v.number(),                // spaces race counts out (RACE_GAP_MS)
    wallet: v.boolean()                    // has connected a Nimiq wallet
  }).index('by_pid', ['pid']),

  // Counts per UTC day for /stats; all-time totals are sums of these rows.
  usageDays: defineTable({
    day: v.string(),
    players: v.number(),                   // distinct players active that day
    newPlayers: v.number(),
    returned: v.number(),                  // players back for their second day
    nimiq: v.number(),                     // players active inside Nimiq Pay
    newNimiq: v.number(),
    opens: v.number(),
    races: v.number(),
    wallets: v.number(),                   // first wallet connections
    receipts: v.number(),                  // race receipts sent on-chain
    bountyEntries: v.number(),
    purchases: v.number()                  // garage cars bought with NIM
  }).index('by_day', ['day'])
});
