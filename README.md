# MiniRush — Outbreak GP 🧟🏁

🔗 **Play now:** [minirush.site](https://minirush.site/) · [mini-rush.vercel.app](https://mini-rush.vercel.app/)

A mobile-first 3D racing game for the web.
Race three AI rivals point-to-point through zombie-infested streets: drag to
steer, tap to fire nitro, splat everything green for combo points, and grab
coins along the way.

Built with Three.js + Vite + TypeScript. No frameworks, targets 60 fps on a
phone browser.

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

Power drift: hold brake while steering at racing speed. The HUD shows charge
and prompts a release after half a second; release brake on the road for a
0.65-second speed boost. Holding for 1.75 seconds earns the perfect-drift
callout. Leaving the road, jumping, wrecking or firing nitro cancels the release
reward. Drifting still feeds the style gauge to earn nitro.

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
- **Closed race circuits** — civilian traffic and danfo buses no longer spawn
  in circuit races. Opponents use the performance-car roster; class events keep
  their eligibility rules, and Police Chase keeps its police units. Near-misses,
  drafting and takedowns still work against racers. City free roam and passenger
  driving retain their separate traffic system.
- **Cinematic car market** — the existing renderer presents the actual cars in
  a lit photo studio with automatic orbit, manual rotation and three camera
  angles. The collection opens offline; dealer availability and RUSH purchases
  require fresh NEAR testnet data. Previewing never equips or unlocks a car.
- **Neon City** — two modes open from the menu. **Passenger**: accept a fare
  and the passenger is waiting on the pavement; stop beside them and they walk
  over and climb in (Mixamo clips on a rigged character, `src/city/passenger.ts`),
  then the GPS routes you along the roads to the drop-off against the clock
  (`src/city/fares.ts`, `src/city/roads.ts`). **Free roam**: hidden tokens
  unlock garage cars and street races start from the map
  (`src/city/activities.ts`). Civilian traffic loops the grid, and the east
  freeway crosses a bridge to a second island. Races elsewhere carry a round,
  heading-up minimap (`src/raceMap.ts`).
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

## Game economy

**Garage → Customs workshop → Performance & Parts** adds a NEAR testnet component economy:
12 recipes across engine, gearbox, tires and nitro; two compatible chassis;
unique component NFTs with maker provenance; crafting, installation, recycling
and player-to-player sales. Each component changes handling through an explicit
benefit and tradeoff. Read [the economy design and rollout notes](docs/near-economy.md).

Eligible connected race sessions earn 2 alloy, 1 circuit and RUSH by finishing
place (45 for a win, 36, 30, or 24 for any other finish), subject to contract
budgets. The contract keeps a season ledger of everything minted, burned, crafted
and traded; the public `/economy` page reads it live (`src/economyPage.ts`). These are separate from local coins, which still
buy ordinary garage cars, upgrades, paint and cosmetic workshop parts. Both are
test/game currencies with no cash value. The new contract and backend require
coordinated deployment; race checks currently validate plausible client telemetry,
not authoritative physics replay.

## Legacy Celo contracts

[`contracts/`](contracts/) still holds the Foundry project for **MiniRushTracker**,
the Celo tracker the game used earlier. Nothing in `src/`
references it any more; it is kept for history and is not part of the build.

## Art & sound

Cel-shaded PS2-era arcade style with real 3D models (CC0/free asset packs,
credits in `public/assets/models/CREDITS.txt`), procedural fallback art where
kits aren't loaded, and hot-swappable models/sounds by filename — see
**`public/assets/README.md`** for the full asset list and credits.

The home, garage, route select and results screens share a restrained studio
presentation (`src/consolePresentation.css`). The garage uses physical
materials and generated softbox reflections; car paint and metallic rims have
separate material roles. These changes reuse the existing models and add no
downloaded art. Desktop and responsive browser checks do not establish console
parity or performance on a physical Android device.

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
