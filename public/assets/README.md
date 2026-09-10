# Asset drop zone

Anything you drop here ships to players, so record its pack and licence in
`CREDITS.md` at the repo root before committing it. Models of real production
cars and other trademarked designs don't belong here regardless of licence.

The game runs fully without these files (procedural placeholders). Drop the
itch.io kit files here with the exact names below and they are picked up
automatically on next reload — no code changes needed.

Models must be **.glb** (glTF binary). Blender can batch-convert the kits'
`.gltf`/`.fbx`/`.vox` files: File → Import → then File → Export → glTF 2.0 (.glb).
Scale doesn't matter — the loader auto-normalizes size and grounds each model.

## `models/`

| Filename | Source pack | Suggestion |
|---|---|---|
| `car_player.glb` | PSX-style cars (ggbot) or RCP4 (jreo) | the hero car — **empty by default**, procedural fallback |
| `car_traffic_1.glb` … `car_traffic_6.glb` | PSX-style cars / RCP4 | any 6 different cars |
| `car_super_1.glb` … `car_super_5.glb` | any CC0 / commercial-use supercar pack | premium garage cars — **empty by default**, procedural fallback |
| `city_building_1.glb` … `city_building_8.glb` | Downtown City MegaKit (Quaternius) | varied building blocks |
| `desert_building_1.glb` … `desert_building_8.glb` | Voxel Desert Town (maxparata) | houses, market stalls |
| `prop_streetlight.glb` | Downtown City MegaKit | streetlight/lamp prop |
| `prop_cactus_1.glb` … `prop_cactus_3.glb` | Voxel Desert Town | cacti / desert props |
| `plane_bonus.glb` | Voxel Plane (maxparata) | reserved for flyover bonus event |

Any file may be omitted — each one falls back individually.

## `sfx/`

From the **Universal UI Soundpack** (Cyrex Studios). `.ogg`, `.mp3` or `.wav`
all work (checked in that order):

| Filename | Used for |
|---|---|
| `ui_click.ogg` | button presses |
| `start.ogg` | run start |
| `coin.ogg` | coin pickup |
| `swoosh.ogg` | lane change |
| `crash.ogg` | collision |
| `combo.ogg` | near-miss multiplier up |

Missing sounds fall back to synthesized WebAudio blips.

## Gun modes & new packs (drop-in filenames)

From the itch.io packs, extract and rename into these paths — the game
hot-swaps them in; procedural fallbacks cover anything missing:

| File | Source pack | Used for |
|------|-------------|----------|
| `sprites/gun.png` | Guns Asset Pack v1 (arcadeisland) | Not loaded any more: gun modes draw an aim reticle and show the weapon as a hand out of the car window. Kept on disk only. |
| `sfx/gun_shot.(ogg|mp3|wav)` | Universal UI Soundpack or any SFX pack | firing |
| `sfx/gun_empty.(ogg|mp3|wav)` | 〃 | dry trigger click |
| `sfx/tire_blowout.(ogg|mp3|wav)` | 〃 | tire shot / cop knockback |
| `sfx/ui_click, coin, squish, nitro, bump, count, go, finish, skid, combo, start` | Universal UI Soundpack (cyrex-studios) | all existing SFX (synth fallback otherwise) |

## `sprites/` — shipped

| File | Source pack | Used for |
|------|-------------|----------|
| `sprites/gun.png` | Guns Asset Pack v1 (arcadeisland) — Glock P80 | Doom-style overlay (CSS-rotated to aim up-forward) |
| `sprites/skyline_neon.png` | Cyberpunk Street Environment (ansimuz) — city skyline buildings layer | NEON CITY horizon ring |
| `sprites/skyline_future.png` | Free Futuristic City Pixel Art Backgrounds (craftpix) — city 1 towers layer | spare skyline for a future map (set `skyline: 'skyline_future'` in maps.ts) |
| `sprites/zombie_1..3.png` | Zombie Sprite Sheet Pack (craftpix) — Idle strips | crossed-plane billboard zombies (used when no `zombie_*.glb` models exist; square frames, frame 0 shown) |

## New country horizon packs

The country maps added in `src/maps.ts` look for one flattened/merged PNG per
pack. If the pack ships parallax layers, export the layer or combined backdrop
you want visible at the horizon and rename it exactly:

| File | Source pack | Used for |
|------|-------------|----------|
| `sprites/skyline_mountain_dusk.png` | Mountain Dusk Parallax Background (ansimuz) | NORWAY horizon |
| `sprites/skyline_glacial_mountains.png` | Glacial Mountains: Parallax Background (vnitti) | ICELAND horizon |
| `sprites/skyline_tall_forest.png` | SunnyLand Tall Forest Environment (ansimuz) | CANADA horizon |
| `sprites/skyline_nature_landscapes.png` | Nature Landscapes Free Pixel Art (Free Game Assets / CraftPix) | NEW ZEALAND horizon |
| `sprites/skyline_stringstar_fields.png` | stringstar fields (Trixie) | FINLAND horizon |

The skyline loader falls back to procedural pixel horizons if any file is
missing, so these maps are playable before the art is dropped in.

SFX shipped from the Universal UI Soundpack: `count, go, start,
coin, combo, finish, nitro, buy`.

From the **Ultimate UI SFX Pack (FREE)** (JDSherbert): `ui_click` (Cursor 1),
`select` (Cursor 2, carousels/chips), `back` (Cancel 1), `open` (Popup Open 1,
leaderboard), `swoosh` (Swipe 1, lane change).

From **Essentials Series** (Nox_Sound): `engine.mp3` (Car Engine 2000 RPM
loop — looping engine bed, pitch rides the speedo), `engine_start.mp3`
(countdown ignition), `crash.mp3` (trunk-close impact), `bump.mp3` (door slam,
car-to-car contact), `squish.mp3` (male pain grunt, zombie squash).

Still on the synth fallback: `skid, gun_shot, gun_empty, tire_blowout` —
neither pack has tire screech or gunshots; drop real files in to override.

## `music/`

Looping tracks, loaded lazily when present (`.ogg`/`.mp3`/`.wav`):

| Filename | Plays |
|---|---|
| `menu.mp3` | Dirty Games — Hybridas; menus, garage, results |
| `race.mp3` | Race Heat — Abbynoise; countdown + race, including Police Chase |
| `offroad.(ogg\|mp3)` | nature/country races (Norway, Iceland, Canada, New Zealand, Finland) |

The Uppbeat tracks and their supplied licence codes are recorded in
`music/CREDITS.txt`, the repository `CREDITS.md`, and the in-game Driver Card.
Missing music files retain the synthesized chiptune fallback.

`sfx/police_siren.wav` is Mixkit's **Police siren US** (item 1643). It loops in
Police Chase, gets louder as the nearest unit approaches, and stops on pause or
race completion. The synthesized siren remains the fallback while loading or
if the file is unavailable.

For `offroad`, use any loop from **Free 25 Fantasy RPG Game Tracks Vol. 2**
(alkakrab). Export/rename the chosen file to `public/assets/music/offroad.ogg`
or `.mp3`.
