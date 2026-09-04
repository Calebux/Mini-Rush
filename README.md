# MiniRush — Outbreak GP 🧟🏁

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

## Global daily leaderboard (optional)

The daily challenge can rank players worldwide, not just on-device. It's
off by default — without a backend configured, the game stays fully local.

To turn it on, spin up a free Supabase project and run
[`supabase/schema.sql`](supabase/schema.sql) in its SQL editor (the file has
step-by-step setup at the top), then create `.env.local` from `.env.example`:

```bash
VITE_LB_URL=https://your-project.supabase.co
VITE_LB_KEY=your-anon-public-key
```

Restart `npm run dev`. Daily results then post to a shared board (best score
per player per day) and the 🏆 panel gains a **🌍 GLOBAL DAILY** section, with
your own row highlighted. Identity is the Nimiq address when connected,
otherwise a sticky per-device id. Every network call fails soft —
a missing or down backend never breaks the game. See `src/remoteBoard.ts`.

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

The visual style is cel-shaded PS2-era arcade — inspired by
[Highway Warriors Remastered](https://jreo.itch.io/highway-warriors-remastered):
toon-stepped lighting on everything, neon wedge sports cars with black cel
outlines and underglow, a gradient sky dome with a retro sun, and anime speed
lines during nitro. Loaded GLB kits are automatically re-skinned with toon
materials so they match.

**Cars are real 3D models**: [PSX Style Cars by GGBotNet](https://ggbot.itch.io/psx-style-cars)
(CC0 public domain, credits bundled in `public/assets/models/CREDITS.txt`) —
hand-drawn PS1-style photo textures, rendered with NearestFilter for crisp
texels. The player drives a murdered-out Audi R8 (user-supplied cgtrader OBJ,
decimated + cel-restyled via `scripts/bake-car-colors.cjs`); traffic includes
a hot hatch, police car, taxi, rusty beater, van and wagon. City-district
buildings are from Quaternius' free Downtown City MegaKit (stripped to
base-color textures for the webview). Car bodies without wheels get the PSX
pack's wheel model auto-mounted by `AssetLibrary.addWheels`. Drifting hard, running offroad and firing nitro
all spawn billboard smoke/dust/exhaust puffs (`src/smoke.ts`) plus a tire-skid
chirp.

Everything else still has procedural fallback art. To swap in more kits, see
**`public/assets/README.md`** — models and sounds are hot-swapped by filename:

- [Downtown City MegaKit](https://quaternius.itch.io/downtown-city-megakit) — city district
- [Voxel Desert Town](https://maxparata.itch.io/voxel-desert-town) — desert district
- [Universal UI Soundpack](https://cyrex-studios.itch.io/universal-ui-soundpack) — UI + pickup SFX (shipped)
- [Guns Asset Pack v1](https://arcadeisland.itch.io/guns-asset-pack-v1) — Doom-style gun overlay (shipped)
- [Cyberpunk Street Environment](https://ansimuz.itch.io/cyberpunk-street-environment) — NEON CITY skyline (shipped)
- [Free Futuristic City Backgrounds](https://free-game-assets.itch.io/free-futuristic-city-pixel-art-backgrounds) — spare skyline sprite (shipped)
- [Free Zombie Sprite Sheet Pack](https://free-game-assets.itch.io/free-zombie-sprite-sheet-pack-pixel-art) — billboard zombies (shipped)

## Structure

```
index.html          portrait UI shell (menu / HUD / countdown / results)
src/game.ts         state machine, scoring, contacts, camera, biome blending
src/track.ts        seeded closed-circuit spline (lap wrap, frames, curvature)
src/scenery.ts      buildings/props per district, road tinting
src/entities.ts     zombies, coins, nitro pickups — squash & collect
src/player.ts       steering physics, nitro, bumping, off-road
src/rivals.ts       3 AI racers with rubber-banding
src/input.ts        drag steering + tap nitro (keys on desktop)
src/ui.ts           HUD, race progress bar, pop text, results
src/smoke.ts        pooled drift smoke / dust / nitro exhaust puffs
src/assets.ts       GLB loader with per-file procedural fallback
src/meshes.ts       procedural placeholder art (cel-shaded cars, buildings, zombies)
src/toon.ts         toon materials, cel outlines, GLB re-skinning
src/audio.ts        file SFX with WebAudio synth fallback
src/wallet.ts       Nimiq Pay Mini App provider — NIM payments, race receipts
```

## Licence

Source code is **MIT** — see [`LICENSE`](LICENSE).

The art and audio under `public/assets/` are third-party and keep their own
licences; every bundled file, its pack and its terms are listed in
[`CREDITS.md`](CREDITS.md). Nothing ships unless its licence is recorded there,
and every asset slot has a procedural fallback, so the game runs complete
without any of them.
