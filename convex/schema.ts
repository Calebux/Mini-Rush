// Organizer-edited data. Rows are added and switched on or off in the Convex
// dashboard (or with `bounty:post` from a terminal); the game only reads them.
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
  }).index('by_week', ['week'])
});
