# Game screenshots

Captured on **13 November 2026** from the actual MiniRush interface. These are
not mockups. Prices, inventory, balances and supply are historical snapshots.

| Files | Source |
| --- | --- |
| `home.jpg`, `car-market.jpg`, `garage.jpg`, `customs.jpg`, `performance-parts.jpg`, `economy.jpg` | The live site at https://minirush.site, at 1600 × 1000, using a dedicated test browser profile |
| `live-race.png`, `race-results.png` | A real two-browser Race Friends integration run against the development backend, at 1280 × 850 |
| `race-friends-mobile.png` | Live-domain multiplayer verification, at 390 × 844 |
| `first-build-choice.png` | Local frontend, real testnet craft of component #2 during the [economy demo](../hackathon-demo.md), at 1440 × 900 |
| `workshop-inspection.png`, `workshop-customize.png` | Local cinematic workshop at 1600 × 1000, captured by `check-workshop-cinematic.mjs`; all POSTs blocked, so account balances are unavailable |
| `skin-studio.png` | Local Skin Studio at 1600 × 1000, captured by `check-skin-studio.mjs` with isolated fixture coins and all POSTs blocked; a saved cosmetic design, not an on-chain purchase |

The six live-site captures use public reads and the existing test garage. The
capture script blocks HTTP actions, mutations and transaction broadcasts; it
does not buy cars, craft parts or create accounts. The driver display name is
set locally to MINIRUSH. No balances, prices or ownership records are fabricated.
Browser profiles and their private keys are not included in this directory.

The multiplayer captures show actual room state and driving results. The checks
created temporary rooms, without NEAR transactions; the live verification room
was closed afterward. The mobile image demonstrates layout, not physical-phone
performance.

## Refresh the six showroom and economy images

From the repository root, with dependencies and Google Chrome installed:

```sh
node scripts/capture-readme.mjs
# Or use a running local frontend with connected public data:
node scripts/capture-readme.mjs http://localhost:3000
```

The script defaults to a fresh guest browser. To show an existing test garage,
pass a dedicated test profile, with its browser closed:

```sh
node scripts/capture-readme.mjs https://minirush.site --profile=/tmp/minirush-docs-browser
```

Use an existing, initialized test profile for connected inventory; a new profile
may show unavailable account data because account creation is blocked. Keep
profiles outside the repository and never commit credentials. The script changes
local welcome/tutorial flags and the display name in the selected profile.

The script refreshes the six JPEGs only. To regenerate multiplayer race captures,
run `npm run check:friends -- http://localhost:3000` against the development
backend and inspect its images under `/tmp/minirush-friends/` before copying the
desired race/results captures here. That check creates temporary development
rooms and blocks NEAR transactions. The mobile lobby image came from a separate
production verification run.

To check the cinematic workshop and capture its desktop/phone layouts, run
`npm run check:workshop-cinematic -- http://localhost:3000`. It writes images to
`/tmp/minirush-cinematic-workshop/` and blocks all POST requests. The README's
new workshop images come from `street-slick-desktop.png` and
`customize-desktop.png`; they show the local implementation, not a deployed update.

Screenshots retain the licences of their underlying artwork; see
[asset credits](../../CREDITS.md). They are not a blanket MIT licence grant for
third-party models or textures.
