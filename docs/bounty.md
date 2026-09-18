# Weekly bounty

A free-to-enter, skill-based prize (e.g. $20 in NIM) for the **fastest win** of
the week's **HARDCORE** bounty race. There is no backend: entries are race
receipts written to the Nimiq blockchain from each winner's own wallet, and the
organizer ranks them after entries close and pays the winner by hand.

The competition rules allow this — *"Skill-based games with clearly defined
rules and prizes are permitted"* — as long as it stays **free to enter**. Never
add an entry fee or pool player money: that turns it into wagering. For the
same reason the bounty race is **free cars only**: every locked car is sold for
NIM, and a car you can buy must not be a faster way to a cash prize. Workshop
builds (RUSH ONE) are out too, so every entrant drives the same car.

## The race

- **HARDCORE**: 8 cars, no traffic, seven pro AI drivers, 2 laps of a 3 km lap.
- The free **VIPER GT** only. Every other car costs NIM, and RUSH ONE is a
  workshop build, so neither can enter — though the AI field still drives the
  fast shelf. Coin upgrades apply: they are earned by racing, not bought.
- The circuit seed and city derive from the ISO week (`src/bounty.ts`), so every
  entrant races the same track all week. It is a different circuit from the
  Weekly Cup.

## How it works

1. The menu's **Bounty Board** card opens the board: this week's race, the prize
   when one is posted, the fastest wins, and the rules. **Race for the bounty**
   goes straight to the garage in the free car.
2. **Only a win counts.** On a bounty race win, inside Nimiq Pay, the player
   taps **Enter the bounty**. Nimiq Pay asks them to confirm a 1 Luna
   transaction to the receipt address whose data field carries an `MR3` entry:
   week, score, finish time, place.
3. The sender of that transaction is the entrant's wallet — where a prize goes.
4. After Sunday 23:59 UTC the organizer ranks the entries: fastest winning time
   first, ties to the earlier entry. The prize goes to the fastest win, or is
   shared by the fastest few when the week sets a `split` — one prize per person.

The board runs every week. Without a posted prize it still ranks wins — on the
player's phone, and worldwide when the Supabase board is configured — and the
entry button stays hidden.

The app **cannot pay anyone**: every transaction the Mini App SDK makes is signed
by the player's wallet. Prizes are sent manually from the organizer's own wallet.
Never put a private key in the app or the repo.

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
| `prize` | `"$20 in NIM"` | Prize text players see. |
| `active` | `true` | Set to `false` to pull the bounty without deleting the row. |
| `split` | `["7,000 NIM", "3,500 NIM", "1,500 NIM"]` | Optional. Prize per place, 1st first; the board and rules list it. Leave it out for winner takes all. |
| `receiver` | `"NQ12 3456 …"` | Optional. Where entries go; defaults to `VITE_RECEIPT_RECEIVER`, then `VITE_MARKET_RECEIVER`. **Must be an `NQ…` address** or entering is disabled. |

Or from a terminal in this repo:

```bash
npx convex run --prod bounty:post '{"week":"2026-W38","prize":"12,000 NIM","split":["7,000 NIM","3,500 NIM","1,500 NIM"]}'
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

1. Open a Nimiq block explorer on the receipt address and list incoming
   transactions for the week, **oldest first**.
2. Put one per line in a text file: `<sender address> <data field>` — the data
   field may be the text (`MR3…`) or its hex.
3. Run:

   ```bash
   node scripts/bounty-entries.mjs --week 2026-W38 --split 7000,3500,1500 entries.txt
   ```

   `--split` is the week's prize per place in NIM (drop it for winner takes
   all) and prints what to pay each place. It keeps each wallet's fastest win,
   ranks by time → earliest, and rejects
   malformed receipts, old `MR2` Weekly Cup receipts, other weeks, anything
   that isn't a win, and finish times faster than the car could physically go.
4. **Verify the top entry before paying.** A receipt proves what a wallet
   claimed, not that the run was real — a modified client can write any number.
   Ask the winner to reproduce a comparable run (e.g. a screen recording of a
   bounty race win in Nimiq Pay). If it doesn't hold up, move to the next entry.
5. Send the prize in NIM from Nimiq Pay to the winning sender address and
   announce the result.

`node scripts/bounty-entries.mjs --selftest` checks the decoder and ranking.

## Limits worth being honest about

- Times are computed on the player's phone. Receipts plus a manual check are
  proportionate for a small prize; they are not cheat-proof.
- The live board on the bounty page is a view, not the ranking: anyone can
  write the Supabase table. The list you pay from comes from the script.
- One person can hold several wallets. The rules say one prize per person;
  enforcement is the organizer's judgement call.
