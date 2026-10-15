# Weekly bounty

A free-to-enter, skill-based prize for the **fastest win** of the week's bounty
race, the **CITY GP**. A win posts itself to the worldwide bounty board on
Convex; the organizer ranks the board after entries close and hands out the
prize by hand.

Keep it **free to enter**: never add an entry fee or pool player money. For the
same reason the bounty race is **free cars only**: every locked car is sold for
coins, and a car you can buy must not be a faster way to a prize. Workshop
builds (RUSH ONE) are out too, so every entrant drives the same car.

## The race

- **CITY GP** (`src/city/cityRace.ts`), from 2026-W40: raced in the open
  free-roam Neon City itself, its full-width streets and expressway. One fixed
  loop (Downtown → Midtown → the expressway → the harbour → back), 11 neon
  gates to pass in order, 2 laps, 8 cars, seven pro AI drivers, no traffic, no
  police. The loop never changes, so times compare week to week.
- The free **VIPER GT** only. Every other car costs coins, and RUSH ONE is a
  workshop build, so neither can enter; the AI field drives the VIPER GT too.
  Coin upgrades apply: they are earned by racing, not bought.
- Earlier weeks (to 2026-W39) were a HARDCORE circuit whose seed changed
  weekly. W40 switched mid-week; the one entry already on the W40 board, from
  the old circuit, was removed so the week's board holds City GP times only.

## How it works

1. The menu's **Bounty Board** card opens the board: this week's race, the prize
   when one is posted, the fastest wins, and the rules. **Race for the bounty**
   drops the player on the City GP grid in the free car.
2. **Only a win counts.** A bounty race win posts the driver name and finish
   time to the bounty board. Win faster and the faster time replaces it.
3. After Sunday 23:59 UTC the organizer ranks the board: fastest winning time
   first, ties to the earlier entry. The prize goes to the fastest win, or is
   shared by the fastest few when the week sets a `split` — one prize per person.

The board runs every week. Without a posted prize it still ranks wins — on the
player's phone, and worldwide when Convex is configured.

## Setup

### Once

1. Link this repo to the MiniRush Convex project and deploy the bounty table
   and its read-only query (`convex/`):

   ```bash
   npx convex dev --once   # choose the existing MiniRush project; writes .env.local
   npx convex deploy       # push to the production deployment
   ```

2. On Vercel (Project → Settings → Environment Variables) set
   `VITE_CONVEX_URL` to the **production** deployment URL — Convex dashboard →
   Settings → URL & Deploy Key, e.g. `https://…convex.cloud` — and redeploy.
   It is public, not a secret.

### Each bounty week — Convex dashboard, no redeploy

Convex dashboard → production deployment → Data → `bountyWeeks` → Add:

| Field | Example | |
|---|---|---|
| `week` | `"2026-W38"` | ISO week (Monday–Sunday, UTC). The bounty board shows the current key when no prize is posted. |
| `prize` | `"5,000 COINS"` | Prize text players see. |
| `active` | `true` | Set to `false` to pull the bounty without deleting the row. |
| `split` | `["3,000 COINS", "1,500 COINS", "500 COINS"]` | Optional. Prize per place, 1st first; the board and rules list it. Leave it out for winner takes all. |

Or from a terminal in this repo:

```bash
npx convex run --prod bounty:post '{"week":"2026-W42","prize":"5,000 COINS","split":["3,000 COINS","1,500 COINS","500 COINS"]}'
```

`bounty:post` creates the week or replaces it. Players see it the next time
they open the game or the bounty board. There is no public write path: the
only mutation is internal, so only someone with deploy access can post a bounty.

Without Convex, `VITE_BOUNTY_WEEK` and `VITE_BOUNTY_PRIZE` do the same job at
build time, at the cost of a redeploy per bounty. They are ignored once
`VITE_CONVEX_URL` is set, so a leftover week can't advertise a prize that was
never posted in Convex.

Preview a posted prize on the dev server with `?bounty=1` (ignored in
production builds).

## Picking the winner

1. After entries close, read the week's bounty board (Convex dashboard →
   production deployment → Data → the bounty board table, or the board in the
   game).
2. Rank by time, then by the earlier entry.
3. **Verify the top entry before awarding it.** The time is computed on the
   player's phone, so a modified client can post any number. Ask the winner to
   reproduce a comparable run (e.g. a screen recording of a bounty race win).
   If it doesn't hold up, move to the next entry.
4. Announce the result.

## Limits worth being honest about

- Times are computed on the player's phone. The board plus a manual check is
  proportionate for a small prize; it is not cheat-proof.
- Driver names are not accounts: one person can race under several names. The
  rules say one prize per person; enforcement is the organizer's judgement call.
