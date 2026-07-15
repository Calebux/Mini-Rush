# MiniRush — Outbreak GP 🧟🏁

✅ **MiniPay ready** — auto-connects inside the MiniPay webview, no setup required.

A mobile-first 3D racing game built for **MiniPay** (Celo).
Race three AI rivals point-to-point through zombie-infested streets: drag to
steer, tap to fire nitro, splat everything green for combo points, and grab
coins along the way.

Built with Three.js + Vite + TypeScript. No frameworks, targets 60 fps inside
the MiniPay webview.

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
- **Bumping** — trade paint with rivals to shove them off line
- **World Outbreak Tour** — pick a city on the menu: Lagos, Beijing, Mumbai,
  Neon City or London (`src/maps.ts`). Each city has its own cel palette, fog mood, track
  shape (flowing vs technical) and three districts along the lap — e.g.
  Hutongs → Temple Gardens → CBD — with sky/fog/ground colors blending as
  you cross
- **Score** = zombie points + coins + place bonus (400/250/120/0) + time bonus

## Smoke test

```bash
npm run build && npm run preview   # serve dist on :4173
node scripts/smoke.mjs [shotsDir]  # Playwright: full race → results → retry
```

Exits non-zero on console errors or if the results screen never appears.
Screenshots (menu, countdown, mid-race, results) land in `shotsDir`.

## MiniPay integration

- Detects the MiniPay provider (`window.ethereum.isMiniPay`) and
  auto-connects on load — no Connect button; the menu quietly shows the
  address + cUSD balance (viem, Celo mainnet). Plain browsers show nothing.
- **On-chain signups + races** — `src/wallet.ts` writes to the
  **MiniRushTracker** contract on Celo mainnet: the player is registered on
  connect (`signUp`, idempotent) and every finished race is counted
  (`recordRace`). Writes are legacy transactions with the network fee paid in
  USDm (`feeCurrency`), carry an [ERC-8021 attribution suffix](https://github.com/celo-org/attribution-tags),
  and are fire-and-forget: a plain browser, an unconfigured contract, or a
  rejected transaction never blocks play. See [`contracts/`](contracts/).

To test inside MiniPay: run `npm run dev`, expose it with a tunnel
(e.g. `ngrok http 5173`), then open MiniPay → compass icon → "Test page" and
enter the tunnel URL.

## On-chain contract

[`contracts/MiniRushTracker.sol`](contracts/src/MiniRushTracker.sol) is a tiny,
owner-less Foundry project that counts signups and races on Celo. It holds no
funds and has two writes — `signUp()` and
`recordRace(score, place, mapId, modeId)` — plus `totalPlayers` / `totalRaces`
counters and per-wallet `statsOf`.

```bash
cd contracts
forge install        # vendors forge-std into lib/ (gitignored)
forge test           # unit tests
# deploy (needs a funded DEPLOYER_PRIVATE_KEY in ../.env.local):
forge script script/Deploy.s.sol:Deploy --rpc-url celo --broadcast
```

**Deployed (Celo mainnet, 42220):**
[`0x51F572dF0C722DA24cFf02B5FddC949AEe6F293d`](https://celoscan.io/address/0x51F572dF0C722DA24cFf02B5FddC949AEe6F293d)
— the game reads this address from `VITE_TRACKER_ADDRESS` (falling back to the
baked-in default in `src/wallet.ts`).

## Art & sound

Cel-shaded PS2-era arcade style with real 3D models (CC0/free asset packs,
credits in `public/assets/models/CREDITS.txt`), procedural fallback art where
kits aren't loaded, and hot-swappable models/sounds by filename — see
**`public/assets/README.md`** for the full asset list and credits.
