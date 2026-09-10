# MiniRush — Outbreak GP 🧟🏁

🔗 **Play now:** [minirush.site](https://minirush.site/) · [mini-rush.vercel.app](https://mini-rush.vercel.app/)

A mobile-first 3D racing game built as a **Nimiq Pay Mini App**.
Race three AI rivals point-to-point through zombie-infested streets: drag to
steer, tap to fire nitro, splat everything green for combo points, and grab
coins along the way.

Built with Three.js + Vite + TypeScript. No frameworks, targets 60 fps inside
the Nimiq Pay WebView.

## Play it

```bash
npm install
npm run dev        # → http://localhost:5173 (already --host for phone testing)
npm run build      # typecheck + static bundle in dist/ — deploy anywhere
```

Desktop testing: ↑ or W to accelerate, ← → or A/D to steer, ↓ or S to brake,
quick tap / Space for nitro, C to cycle camera (chase / low bumper / high TV —
also the 📷 button). Mobile: hold the gas pedal (bottom-right) to accelerate,
drag to steer, hold the brake pedal (bottom-left), tap for nitro. Release the
gas and the car coasts down to a roll.

Query params for testing: `?len=500` (lap length in metres, default 1800),
`?seed=7` (deterministic circuit), `?laps=4`, `?map=beijing` (city id or index),
`?mode=burnout` (mode id or index).

## Gameplay

- **Three modes** (`src/modes.ts`):
  - **Grand Prix** 🏁 — clean-ish racing against 3 rivals
  - **Burnout** 🔥 — 8-car grid, no rules. Rivals hunt your lane; three hard
    hits inside a few seconds barrel-rolls the victim (you included). Contact
    while your nitro burns is an **instant TAKEDOWN** (+150 each)
  - **Outbreak** 🧟 — solo lap through a triple-density horde; pure
    splat-combo score attack, laps locked to 1
  - **Cop Chase** 🚓 — outrun THE HEAT for 2 laps. The cop speed-matches
    onto your bumper; every touch is heat, and three quick hits = **BUSTED**
    (heat cools after ~3.5s clean). Full throttle stays just ahead of it —
    lift and it rams you every half second. You're armed: tap fires out the
    **rear window**, knocking the cruiser back (ammo slowly self-reloads)
  - **Gun Run** 🔫 — 6-car brawl, Doom-style pistol on the HUD. Tap to shoot
    up your lane: rivals take a **TIRE SHOT** and roll (+150), zombies splat
    at range into the combo chain. 8 rounds to start, canister pickups are
    ammo crates (+4); nitro fires from the pill button (or N key)
- **Closed street circuit** — a seeded Catmull-Rom loop (~1.8 km/lap) dressed
  with downtown blocks and red/white racing barriers; pick **1, 2 or 4 laps**
  on the menu (or `?laps=`). Zombies and pickups respawn every lap. The
  circuit previewed on the menu/tour page is the exact circuit you race.
- Race from a rows-of-two grid start (you start at the back — overtaking
  is earned)
- **Drag to steer** — corners throw the car outward; going off-road drops you
  to crawl speed
- **Zombies** — drive over them: 15 pts × a combo that grows with every splat
  (combo resets after 4 s without one)
- **Coins** +10 each; **nitro tank pickups** stock tap-to-fire boosts
  (46 m/s burst, FOV kick)
- **The style economy is the core loop** (`src/style.ts`) — near-misses, drifts
  and takedowns fill one gauge, and a full gauge pays out a **nitro tank** as
  well as stepping the score multiplier. Risk buys speed, speed makes everything
  riskier. Contact wipes the chain. Style and boost used to be separate
  currencies, which meant a player could ignore either one.
- **Ambient traffic** (`src/traffic.ts`) — a recycled pool of civilian cars fills
  the lap. It is what near-misses are measured against and what makes speed read
  as speed. Rows are spaced and never block adjacent lanes, so there is always a
  line through; clipping one costs speed and your chain, and only a fast closing
  hit does damage.
  Lagos mixes four yellow-and-black danfo minibuses into the ten-vehicle pool,
  with passenger windows and route boards. Their procedural model shares geometry
  and materials across the fleet (`src/danfo.ts`).
  Traffic keeps its distance across laps, waits in the spawn queue until it comes
  into view, and avoids starting lane changes beside an approaching player or
  into another vehicle. Danfos have a longer contact zone. Gentle clips retain
  88% of speed; hard impacts retain 72%. A near miss pays once the player has
  fully cleared the vehicle, and only if the pass stayed clear of contact.
- **Impact cinematics** — takedowns and wrecks dilate time to 0.3×, drop the
  camera into the impact and white out the frame, then hand control straight
  back. Boost drives radial streaks, a chromatic fringe and a warm push in the
  grade pass.
- **Bumping** — trade paint with rivals to shove them off line
- **World Outbreak Tour** — pick a city on the menu: Lagos, Beijing, Mumbai,
  Neon City or London (`src/maps.ts`). Each city has its own cel palette, fog mood, track
  shape (flowing vs technical) and three districts along the lap — e.g.
  Hutongs → Temple Gardens → CBD. A shared lighting/material palette stays
  consistent across the lap while the local architecture and vegetation change.
- **Score** = zombie points + coins + place bonus (400/250/120/0) + time bonus

## Smoke test

```bash
npm run build && npm run preview   # serve dist on :4173
node scripts/smoke.mjs [shotsDir]  # Playwright: full race → results → retry
```

Exits non-zero on console errors or if the results screen never appears.
Screenshots (menu, countdown, mid-race, results) land in `shotsDir`.

## Nimiq Pay integration

`src/wallet.ts` talks to the provider Nimiq Pay injects into the Mini App's
WebView, via [`@nimiq/mini-app-sdk`](https://www.npmjs.com/package/@nimiq/mini-app-sdk).

- **Auto-connect** — the provider is injected before the page script runs, so
  the menu chip quietly fills in with the player's address (and NIM balance,
  if `VITE_NIMIQ_RPC_URL` is set). Outside Nimiq Pay nothing shows and the
  game plays exactly the same.
- **Garage market** — hyper-class cars can be bought outright for NIM via
  `sendBasicTransaction`, instead of grinding coins. Off unless
  `VITE_MARKET_RECEIVER` is configured.
- **Race receipts** — the results screen offers a one-tap **⛓ Mint receipt**
  that writes the finished run into a transaction's data field
  (`sendBasicTransactionWithData`), making the run verifiable independently of
  this game's own leaderboard. The payload is `MR1` + score/place/map/mode as
  fixed-width hex — 19 bytes, inside Nimiq's 64-byte data field.

Nimiq Pay puts a native confirmation in front of every sensitive action, which
the Mini App can't bypass — so nothing is ever written on the player's behalf.
That's why scores, badges and the daily board live off-chain (local storage +
the Supabase board) and only payments and opt-in receipts touch the chain.

Every call fails soft: no provider, a declined dialog, or an unconfigured
receiver leaves the game fully playable.

**Testing inside Nimiq Pay:** run `npm run dev`, expose it with a tunnel
(e.g. `ngrok http 5173`), then open the tunnel URL as a Mini App —
`https://nimpay.app/miniapps/open/<your-host>` or the
`nimiqpay://miniapp?url=<your-host>` deeplink.

## Legacy Celo contracts

[`contracts/`](contracts/) still holds the Foundry project for **MiniRushTracker**,
the Celo tracker the game used before moving to Nimiq Pay. Nothing in `src/`
references it any more; it is kept for history and is not part of the build.

## Art & sound

Cel-shaded PS2-era arcade style with real 3D models (CC0/free asset packs,
credits in `public/assets/models/CREDITS.txt`), procedural fallback art where
kits aren't loaded, and hot-swappable models/sounds by filename — see
**`public/assets/README.md`** for the full asset list and credits.

Browser checks (with the dev server running): `scripts/check-presentation.mjs`,
`scripts/check-driving.mjs`, `scripts/check-danfo.mjs`, `scripts/visual-world.mjs`
and `scripts/visual-cars.mjs`. They save screenshots under `output/` and are not a
substitute for profiling on a physical phone.

## Licence

Source code is **MIT** — see [`LICENSE`](LICENSE).

The art and audio under `public/assets/` are third-party and keep their own
licences, recorded with their packs and terms in [`CREDITS.md`](CREDITS.md).
Every asset slot has a procedural fallback, so the game runs complete without
any of them.
