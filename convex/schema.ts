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
  // (src/usage.ts) and `name` the driver name it races under; no wallet
  // addresses or Nimiq device ids.
  players: defineTable({
    pid: v.string(),
    name: v.optional(v.string()),          // cleaned like src/driver.ts; absent until the first named ping
    hidden: v.optional(v.boolean()),       // true keeps the name off /stats (usage:hide)
    platform: v.union(v.literal('nimiq'), v.literal('web')), // where it was last seen
    firstSeen: v.number(),
    lastSeen: v.number(),
    lastDay: v.string(),                   // UTC date of the latest event, "2026-09-14"
    days: v.number(),                      // distinct UTC days seen
    races: v.number(),
    lastRaceAt: v.number(),                // spaces race counts out (RACE_GAP_MS)
    wallet: v.boolean()                    // has connected a Nimiq wallet
  })
    .index('by_pid', ['pid'])
    .index('by_lastSeen', ['lastSeen'])
    .index('by_name', ['name']),

  // The worldwide boards: one row per device per board, best kept. `board` is
  // "daily-2026-09-19" or "bounty-2026-W38"; the daily ranks on score, the
  // bounty on time. Written by the game (convex/boards.ts).
  boardRuns: defineTable({
    board: v.string(),
    pid: v.string(),                       // the same device id as `players`
    tag: v.string(),
    score: v.number(),
    timeS: v.number(),
    place: v.number(),
    laps: v.number(),
    car: v.string(),
    at: v.number()
  })
    .index('by_board_score', ['board', 'score'])
    .index('by_board_time', ['board', 'timeS'])
    .index('by_board_pid', ['board', 'pid']),

  // Weekend GP: one run per device per ISO week, with the packed lap line other
  // players race as a ghost. Written by the game (convex/weekend.ts).
  weekendRuns: defineTable({
    week: v.string(),                      // ISO week, "2026-W38"
    pid: v.string(),                       // the same device id as `players`
    tag: v.string(),                       // driver name shown on the grid
    timeS: v.number(),                     // finish time, seconds
    score: v.number(),
    place: v.number(),
    car: v.string(),
    ghost: v.string(),                     // packed lap line (src/ghostShare.ts)
    at: v.number()
  })
    .index('by_week_time', ['week', 'timeS'])
    .index('by_week_pid', ['week', 'pid']),

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
