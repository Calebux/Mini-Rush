# Customs workshop

Home now presents the selected car in a dedicated, warmly lit Three.js showroom. It uses the game's existing renderer; the map lighting and racing camera are separate. Drag the car, or focus its stage and use the arrow keys to rotate it.

## Player flow

1. Select **Build something yours** on Home, or **Customs workshop** in Garage.
2. Start with the free, original **RUSH ONE** chassis. Existing cars remain available; their meshes are unchanged.
3. Preview 20 compatible parts across body, wheels, wing, paint, tyres and power. The car updates immediately. Previewing costs nothing.
4. Buy a part with earned race coins. Parts unlock for all three build slots; duplicate purchases do not charge again.
5. Name the build and select **Save & equip**. All previewed parts must be owned. Closing without saving leaves the equipped build unchanged; changing preset slots discards the unsaved preview.
6. Race normally. The saved model, colour, wheels and performance tune are used by the player vehicle. The same performance calculation drives the garage and workshop statistics.

Bodywork, wheels, wings and paint are cosmetic. Tyres and power are explicit trade-offs; the on-screen performance indices use stock = 100. Workshop cars do not stack the legacy upgrade system.

## Performance parts

The existing Customs panel now has **Customize** and **Performance & Parts**
tabs. The second tab adds crafting, owned components and player trading beside
the same live car stage. It reuses the current game theme, part cards, stat bars
and controls. Choose VIPER GT or RUSH ONE to inspect that chassis and its installed
components. Switching tabs preserves the unsaved cosmetic preview.

Recipes and owned/traded parts share illustrated cards and a dedicated 3D
inspection stage. Select **Inspect part** to orbit a component or **View car**
to return to the current chassis. Tires, engines, gearboxes and nitro bottles
have display models; the three tire compounds have different tread patterns.
Driving notes explain every recipe's advantages and sacrifices beside its
actual stat changes. Cosmetic cards distinguish body kits, wheel designs,
wings and paint finishes without implying extra performance.

Browsing never buys or installs a component. Confirmed installation returns to
the car and plays the existing assembly reveal. Dragging or arrow keys stop
auto orbit; **Pause camera** and system reduced-motion settings are supported.
Run `npm run check:workshop-cinematic -- http://localhost:3000` for the isolated
inspection, mobile layout, session-refresh and motion checks. All POSTs are
blocked; screenshots are written to `/tmp/minirush-cinematic-workshop/`.

See [the NEAR economy notes](near-economy.md) for component ownership, reward
rules, testing and deployment status.

## Customize storage and economy

Builds and part ownership use `minirush.workshop.v1` in this browser's local storage. An interrupted coin purchase is completed from a journal before the game reads the bank on the next boot. Clearing browser/app storage removes these builds and local unlocks.

The Customize tab is a local earned-coin parts shop. Its purchases and saved builds are separate from the on-chain component inventory in Performance & Parts. Coins have no cash value. Server-verified entitlements, recovery across devices and anti-cheat are separate work before presenting this as a secure real-money marketplace.

## Car market

Home links directly to **Car Market**, which opens the Hypercars shelf. Every locked car is bought with coins, like parts; the buy button is disabled until the bank covers the price, and a purchase unlocks the car on this device.

## Repeatable checks

Start `npm run dev -- --host 127.0.0.1` and use the URL printed by Vite. Run browser tests sequentially so keyboard-focus checks do not compete:

```sh
npm run build
npm run check:workshop -- http://127.0.0.1:5174
npm run check:workshop-edge -- http://127.0.0.1:5174
npm run smoke -- /tmp/minirush-workshop http://127.0.0.1:5174
node scripts/visual-world.mjs lagos --url=http://127.0.0.1:5174 --q=1 --out=/tmp/minirush-workshop/world
```

Chrome must be installed. Screenshots from the workshop checks go to `/tmp/minirush-workshop`. Tests cover phone/desktop layouts, affordability, buying, three presets, persistence, custom-car racing, corrupt storage, interrupted writes, duplicate-charge protection, payment UI mocks and stable preview geometry counts. World checks verify all 15 car headings and the three Lagos districts. The existing large-bundle warning remains.

## RUSH ONE body and market preview

RUSH ONE now has wider shoulders, a tapered nose, a carbon canopy, blade lights,
side air channels, a louvred engine cover and a rear diffuser. The original
wheel, wing, body-kit and paint options still mount to the same chassis. The
model retains the race collision footprint and factory performance values.

Home → Car Market opens a separate photo set using the same renderer. Drag or
use arrow keys to inspect; front, profile and rear presets ease between views.
Auto orbit pauses on manual input and respects reduced-motion preferences.
Garage and Customs keep their workshop setting.

Run `npm run check:market -- http://127.0.0.1:5174` for the isolated browser
fixture (all backend writes and purchases are mocked). Screenshots go to
`/tmp/minirush-cinematic`. Live contract testing remains separate.

## From race results to a build

The race report now includes NEAR salvage status and a tracked upgrade with
confirmed material balances. Its workshop button opens Performance & Parts at
the chosen recipe; closing returns to the same report. Crafting selects the new
part in My Parts. Confirmed installations show the component assembly at the car
and the actual before/after build ratings. The illustration clears when changing
chassis or leaving the workshop, and reduced motion uses a static confirmation.


## Garage test drive

Garage → **Test drive / Compare builds** opens a private proving-ground run
for the selected owned car. The fixed Lagos loop is approximately 0.9 km (908 m
with the current track sampler), with dry grip, no rivals, traffic, pickups or
ramps. The one-second countdown can be repeated from the practice HUD or report.
Pause and return to Garage work during a run.

**Fitted build** uses the same saved build, local upgrades and confirmed component
multipliers shown in Garage. **Stock baseline** keeps the appearance but replaces
the four performance multipliers with that chassis's factory values for this run
only. It does not unequip, purchase or mutate parts. The handling label describes
the leading actual stat; it is not a separate invisible physics modifier.

The practice report measures lap time, 0–100 from the first throttle input, peak
speed, time braking and time off the tarmac. Speeds use the same arcade display
scale as the HUD. Nitro use is disclosed. Comparisons are against the previous
completed run for that car in this page session; driving line and boost timing
also affect results. Refreshing clears these practice comparisons.

Practice never opens a reward session, burns a NEAR nitro can, deposits coins,
stamps a map, updates streaks, writes ghosts or submits race records. Returning
restores the original map, mode and seed, including class/event restrictions.
Locked cars cannot enter practice. The normal race path remains separate.

Run `npm run check:test-drive -- http://127.0.0.1:5174` with Chrome installed.
All backend calls are intercepted. This check drives short real-physics samples
and uses accelerated finishes to exercise the report, comparison, pause,
restart and return paths. It verifies fitted versus factory multipliers,
mobile layout and reward/consumable isolation; it is not a full-lap balancing
benchmark. Screenshots are written to `/tmp/minirush-test-drive`.


## Handling and rival racecraft

Launch now uses bounded acceleration rather than exponential convergence to the
speed target. Acceleration upgrades shorten the launch without inheriting a free
boost from top-speed upgrades. Grip improves braking, steering recovery and
resistance to outward corner force; wet grip affects those same calculations.
The existing four performance multipliers, component recipes and nitro-duration
tradeoffs remain the source of build differences.

Controlled straight-line simulations with the game speedometer scale measured
0–100 at 1.82 s for stock, 1.69 s for the sprint engine (+8 launch, −4 speed), and
1.92 s for the top-speed engine (−5 launch, +4 speed). These are arcade-physics
measurements, not real-car specifications or proof of competitive balance.

Normal rivals check the space swept by a pass, including closing cars in the
adjacent lane. They hold their chosen passing lane, follow and brake when boxed
in, and make one committed defensive move before overlap. They wait for clearance
before merging back. Corner previews cover stopping distance at boost speed.
Their launch uses the same acceleration model and their extra catch-up speed is
capped at 8% of base pace. Combat-mode contact intent and police pursuit remain
explicitly separate; class-event aggression alone no longer enables ramming.

Local best ghosts use an `h2` namespace so old launch times do not become the
new handling target. Historical storage is retained. Live leaderboard seasons
and externally shared historical ghosts have not been migrated; a public
competitive rollout still needs a rules-version boundary for those services.

`npm run check:handling-rivals` runs controlled Player/RivalManager simulations
with mocked backend calls. It covers launch/top-speed tradeoffs, 30/120 Hz
agreement, braking and wet grip, steering recovery, boost duration, passing
clearance and completion, committed defence, corner entry, combat isolation,
and seven-car full laps on Lagos, Kaduna and Tokyo in dry and wet conditions.
The lightweight simulation bodies do not replace a full collision/visual
playtest. The garage integration is checked with `npm run check:test-drive`.
