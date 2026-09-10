# Credits & asset licences

MiniRush's **source code** is MIT (see `LICENSE`). The MIT licence does not
cover the art and audio under `public/assets/`: those are third-party and keep
their own licences, listed below. If you fork this repository, check those
terms for your own use.

Every asset slot in the game is optional — `AssetLibrary` (`src/assets.ts`)
falls back to a procedural stand-in for any file that isn't on disk.

## Models — `public/assets/models/`

| File(s) | Pack | Author | Licence |
|---|---|---|---|
| `car_traffic_1..6.glb`, `car_wheel.glb` | [PSX Style Cars](https://ggbot.itch.io/psx-style-cars) | GGBotNet | CC0 1.0 |
| `city_building_1..3.glb` | [Downtown City MegaKit](https://quaternius.itch.io/downtown-city-megakit) (Standard/free) | Quaternius | CC0 1.0 |

`car_player.glb` and `car_super_1..5.glb` are **empty drop-in slots**. The hero
car and the five premium garage cars render procedurally (`buildCar`, each in
its own garage colour) until licensed models are added under those names.

## Sprites — `public/assets/sprites/`

| File(s) | Pack | Author | Licence |
|---|---|---|---|
| `gun.png` | [Guns Asset Pack v1](https://arcadeisland.itch.io/guns-asset-pack-v1) | ArcadeIsland | Free for commercial use |
| `zombie_1..3.png` | [Free Zombie Sprite Sheet Pack](https://free-game-assets.itch.io) | CraftPix | CraftPix free licence |
| `skyline_neon.png` | [Cyberpunk Street Environment](https://ansimuz.itch.io/cyberpunk-street-environment) | ansimuz | CC0 1.0 |
| `skyline_future.png` | [Free Futuristic City Pixel Art Backgrounds](https://free-game-assets.itch.io) | CraftPix | CraftPix free licence |
| `skyline_mountain_dusk.png` | [Mountain Dusk Parallax Background](https://ansimuz.itch.io/mountain-dusk-parallax-background) | ansimuz | CC0 1.0 |
| `skyline_glacial_mountains.png` | [Glacial Mountains: Parallax Background](https://vnitti.itch.io/glacial-mountains-parallax-background) | vnitti | CC-BY 4.0 |
| `skyline_tall_forest.png` | [SunnyLand Tall Forest](https://ansimuz.itch.io/sunnyland-tall-forest) | ansimuz | CC0 1.0 |
| `skyline_nature_landscapes.png` | [Nature Landscapes Free Pixel Art](https://free-game-assets.itch.io/nature-landscapes-free-pixel-art) | CraftPix | CraftPix free licence |
| `skyline_stringstar_fields.png` | [stringstar fields](https://trixelized.itch.io/starstring-fields) | Trixie | CC-BY 4.0 |
| `skyline_cairo.png`, `skyline_cairo_v2.png`, `skyline_rio.png`, `skyline_tokyo.png` | ⚠️ **provenance not recorded** | — | **unverified — see below** |

## Audio — `public/assets/sfx/`, `public/assets/music/`

| File(s) | Pack | Author | Licence |
|---|---|---|---|
| UI/game `.ogg` sounds | [Universal UI Soundpack](https://cyrex-studios.itch.io/universal-ui-soundpack) | Cyrex Studios | CC0 1.0 |
| `music/offroad.ogg` | [25 Fantasy RPG Game Tracks Vol. 2](https://alkakrab.itch.io/free-25-fantasy-rpg-game-tracks-no-copyright-vol-2) | alkakrab | Free, no copyright |
| `music/race.mp3` | [Race Heat](https://uppbeat.io/t/abbynoise/race-heat) | Abbynoise | Uppbeat, user-supplied licence code below |
| `music/menu.mp3` | [Dirty Games](https://uppbeat.io/t/hybridas/dirty-games) | Hybridas | Uppbeat, user-supplied licence code below |
| `sfx/police_siren.wav` | [Police siren US](https://mixkit.co/free-sound-effects/police/) (1643) | Mixkit | [Mixkit Sound Effects Free License](https://mixkit.co/license/#sfxFree) |
| `bump.mp3`, `crash.mp3`, `engine.mp3`, `engine_start.mp3`, `squish.mp3` | ⚠️ **provenance not recorded** | — | **unverified — see below** |

### Music attribution supplied with the downloads

Music from #Uppbeat (free for Creators!):
https://uppbeat.io/t/abbynoise/race-heat
License code: PDZF0JMP0K6LPGBE

Music from #Uppbeat (free for Creators!):
https://uppbeat.io/t/hybridas/dirty-games
License code: O9NQURMF529SXEWN

Original downloads: `race-heat-abbynoise-main-version-46669-02-19.mp3`,
`dirty-games-hybridas-main-version-24505-01-17.mp3`, and
`mixkit-police-siren-us-1643.wav`. Imported without audio edits. Music credits
are also available in the in-game Driver Card and `public/assets/music/CREDITS.txt`.

## Unverified assets

The rows marked ⚠️ above are bundled files whose source was never written down.
They are the only assets in the repository still lacking a recorded licence.
If they are original work, add the author and licence to the table above; if
they came from a pack, record it; if neither can be established, delete them —
each has a working fallback, so the game is complete without them:

- the four skyline PNGs fall back to generated pixel horizons (`src/skyline.ts`)
- the five `.mp3` sounds fall back to synthesised WebAudio (`src/audio.ts`)

## Removed

These files were bundled previously and have been taken out because their
licence could not be established (models downloaded from cgtrader and
unattributed "supercar template" packs, several of them models of trademarked
production vehicles):

**Cars** — `car_player.glb`, `car_super_1.glb`, `car_super_2..5.fbx`,
`imported/car_nascar.glb`. Downloaded from cgtrader and unattributed
"supercar template" packs; several were models of trademarked production
vehicles. The garage renders these slots procedurally instead.

**Circuits** — `imported/track_cartoon_oval.glb`, `imported/track_cota.glb`
and the centrelines baked from them (`tracks/cartoon-oval.json`,
`tracks/cota.json`). Downloaded circuit models with no recorded source; the
second was the real Circuit of the Americas, a trademarked venue. Both maps
survive as ordinary generated circuits — the `circuit` field is simply gone
from their entries in `src/maps.ts`, and the import pipeline
(`scripts/import-track.mjs`, `scripts/bake-track-path.mjs`, `src/trackPaths.ts`)
is intact for licensed circuits later.

60 MB in total.

They remain in this repository's **git history**; a history rewrite is needed
to remove them from clones.
