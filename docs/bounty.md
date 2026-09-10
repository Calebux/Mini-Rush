# Weekly Cup bounty

A free-to-enter, skill-based prize (e.g. $20 in NIM) for the best **Weekly Cup**
run of one ISO week. There is no backend: entries are race receipts written to
the Nimiq blockchain from each player's own wallet, and the organizer ranks
them after entries close and pays the winner by hand.

The competition rules allow this — *"Skill-based games with clearly defined
rules and prizes are permitted"* — as long as it stays **free to enter**. Never
add an entry fee or pool player money: that turns it into wagering.

## How it works

1. Every player races the same Weekly Cup: circuit, city, mode and lap count all
   derive from the ISO week, and the track length is pinned for the cup.
2. On a Weekly Cup result, inside Nimiq Pay, the player taps **Enter the bounty**.
   Nimiq Pay asks them to confirm a 1 Luna transaction to the receipt address
   whose data field carries an `MR2` entry: week, score, finish time, place.
3. The sender of that transaction is the entrant's wallet — where a prize goes.
4. After Sunday 23:59 UTC the organizer ranks the entries and pays the winner.

The app **cannot pay anyone**: every transaction the Mini App SDK makes is signed
by the player's wallet. Prizes are sent manually from the organizer's own wallet.
Never put a private key in the app or the repo.

## Setup (per bounty week)

On Vercel (Project → Settings → Environment Variables), then redeploy:

| Variable | Example | Why |
|---|---|---|
| `VITE_RECEIPT_RECEIVER` | `NQ12 3456 …` | Your Nimiq address that receives entries. Falls back to `VITE_MARKET_RECEIVER`. **Must be an `NQ…` address** or entering is disabled. |
| `VITE_BOUNTY_WEEK` | `2026-W38` | The ISO week the bounty runs. The banner and entry button only appear during that week. |
| `VITE_BOUNTY_PRIZE` | `$20 in NIM` | Prize text shown to players. |

Preview on the dev server with `?bounty=1` (ignored in production builds).

## Picking the winner

1. Open a Nimiq block explorer on the receipt address and list incoming
   transactions for the week, **oldest first**.
2. Put one per line in a text file: `<sender address> <data field>` — the data
   field may be the text (`MR2…`) or its hex.
3. Run:

   ```bash
   node scripts/bounty-entries.mjs --week 2026-W38 entries.txt
   ```

   It keeps each wallet's best entry, ranks by score → time → earliest, and
   rejects malformed receipts, other weeks, busted chases and finish times
   faster than the car could physically go.
4. **Verify the top entry before paying.** A receipt proves what a wallet
   claimed, not that the run was real — a modified client can write any number.
   Ask the winner to reproduce a comparable run (e.g. a screen recording of a
   Weekly Cup run in Nimiq Pay). If it doesn't hold up, move to the next entry.
5. Send the prize in NIM from Nimiq Pay to the winning sender address and
   announce the result.

`node scripts/bounty-entries.mjs --selftest` checks the decoder.

## Limits worth being honest about

- Scores are computed on the player's phone. Receipts plus a manual check are
  proportionate for a small prize; they are not cheat-proof.
- There is no live global leaderboard — the ranked list comes from the script.
- One person can hold several wallets. The rules say one prize per person;
  enforcement is the organizer's judgement call.
