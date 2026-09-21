# Weekend GP

Saturday and Sunday (UTC) one long circuit is open to everyone: **8 laps**, a
pro AI field, and the **ghosts of the fastest players who already ran it that
weekend**. You are driving against their real lines, not an AI imitation of
them — so it reads as racing other people without a realtime server.

Midweek the card counts down to the next weekend and the race still runs as
**practice**: the ghosts are there, but the run stays off the board.

## How it works

- The circuit — seed, city, 8 laps, 3.2 km lap — derives from the ISO week
  (`src/weekend.ts`), like the bounty race. Nothing decides it server-side.
- Finishing an open-weekend run posts your time **and a packed copy of your lap
  line** to the weekend board — the `weekendRuns` table in Convex, alongside the
  bounty weeks and the player counter.
- Opening the event fetches the three fastest players' lines, decodes them and
  puts them on track with you, in amber. Your own best run is the blue ghost.
- A top-3 finish pays the usual non-staked coin prize, once a week.

## The shared ghost

A ghost is recorded at 10 Hz. Eight laps is around 6,000 samples, far too much
JSON for a leaderboard row, so `src/ghostShare.ts` resamples to 5 Hz, quantises
(0.25 m along the track, 5 cm across), delta-codes and base64s it. A full
8-lap run packs to roughly **8.5 kB**.

Anything decoded came from a table anyone can write to, so it is treated as
untrusted: malformed, oversized or absurd data yields `null` and the race simply
runs without that ghost.

## Setup

The board lives in Convex, alongside the bounty weeks and the player counter
(`convex/weekend.ts`, table `weekendRuns`). Deploy it once:

```bash
npx convex deploy       # push the schema and functions to production
```

Nothing else to configure: the game already has `VITE_CONVEX_URL`. Without it —
a build with no Convex at all — the event still runs against the AI field and
your own ghost, and nothing breaks.

Unlike bounty weeks, this table has a **public write path**: the game posts a
run straight from the phone. That is deliberate, and the reason prizes stay on
the on-chain bounty entries. The mutation still refuses what it can check —
the week format, the device id shape, a time under two minutes or over an hour,
a ghost over 24 kB or one that isn't a packed lap line.

## Related

Shared lap lines also power [challenge links](challenges.md) — the same packing,
the same ghost on track, but sent to one person instead of posted to a board.

## Limits worth being honest about

- A ghost is a replay, not a live opponent: it cannot react to you, and you
  cannot collide with it.
- Times come from the player's phone, exactly like the bounty. The weekend
  board is an arcade board, not a prize ledger — keep real prizes on the
  on-chain bounty entries.
