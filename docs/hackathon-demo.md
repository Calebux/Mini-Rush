# MiniRush economy demonstration

The story: **a race creates a resource; a player makes a useful part; a funded
dealer or another driver becomes the customer.** The part can change a car's
handling, and its maker credit survives resale.

## A short presentation

### 90-second cinematic cut

The November 14 edit combines current game footage with the recorded November 13
testnet settlement sequence. It includes slow push-ins, orbit views, Skin Studio
previews, custom bodywork, three performance-part inspections, the limited-edition
market and four race cameras. Captions, captured game effects and the credited
Race Heat music accompany the edit; there is no voice-over.

Local exports (generated media is excluded from git):

- `output/cinematic-demo/minirush-demo-1080p.mp4` — 1920×1080 master.
- `output/cinematic-demo/minirush-demo-share.mp4` — smaller 1280×720 copy.
- `output/cinematic-demo/README.txt` — chapters, public receipts and music credit
  to include in the upload description.
- `output/cinematic-demo/edit-notes.json` — source timestamps and editing details.

Reproduce after the testnet rehearsal below has populated the dedicated demo
browser and preserved the raw economy recording:

```sh
node scripts/record-cinematic-demo.mjs http://localhost:3000
node scripts/edit-cinematic-demo.mjs
```

The capture reads public data and blocks HTTP writes. Cosmetic shots are previews.
Driving uses normal input and physics with automated gas/steering. Gameplay is
shown at normal speed; short holds make craft and sale receipts readable. The
economy excerpts are labelled with their original date. No purchase, result or
settlement is simulated. The editor needs Chrome, Playwright and ffmpeg.

### Current-design walkthrough with cursor

The revised 5:16 guided cut uses short captions, music and game sounds, with
**no voice-over**. It opens with a 1:35 account and purchase guide: find the
browser-created garage account, click **Get test NEAR**, buy ISLAND NIGHT for
0.75 test NEAR, confirm ownership and check the remaining balance. It explains
the difference between test NEAR, RUSH and local coins, and the current lack of
cross-device account recovery at recording time. The recovery-file feature was
added afterward, so this video predates the home-screen Protect/Restore controls.
The Customs Shop section is 1:58 and also exports separately. It retains the visible cursor and PlayStation controller guide and
expands the current Customs Shop into a full sequence: body kits, wheels, wings,
paint, power tunes, rotating the build, Street slicks, Slide compound, Low-drag,
engine upgrades and dealer orders. Older workshop transaction footage is excluded
from this edit. The separate 90-second cinematic trailer remains available.

Generated local exports:

- `output/walkthrough-demo-v3/minirush-walkthrough-1080p.mp4` — revised master.
- `output/walkthrough-demo-v3/minirush-walkthrough-share.mp4` — 720p sharing copy.
- `output/walkthrough-demo-v3/minirush-account-guide.mp4` — account and purchase guide.
- `output/walkthrough-demo-v3/minirush-customs-shop.mp4` — Customs Shop excerpt.
- `output/walkthrough-demo-v3/purchase-evidence.json` — public ownership and receipt data.
- `output/walkthrough-demo-v3/captions.txt` — timestamped captions.
- `output/walkthrough-demo-v3/README.txt` — chapters, recording notes and music credit.

```sh
node scripts/record-walkthrough-demo.mjs http://localhost:3000
node scripts/record-customs-demo.mjs http://localhost:3000
# Sends one testnet grant request and buys one edition (maximum 0.75 test NEAR):
node scripts/record-account-demo.mjs --send http://localhost:3000
node scripts/edit-walkthrough-demo.mjs
node scripts/edit-walkthrough-demo.mjs --verify-only
```

Racing and Customs Shop capture use the dedicated testnet demo profile from the rehearsal.
The account recorder uses a separate profile at `/tmp/minirush-account-demo-browser`
and saves raw footage and public evidence to `/tmp/minirush-account-demo`.
Keep both browser profiles private. Reuse completed captures for edits; do not
repeat a successful purchase. The recorder refuses a garage that already owns an edition.
The editor
requires Chrome, Playwright and ffmpeg; it does not use speech generation. Use
`--prepare-only` for graphics, `--render-only` to reuse them, or `--finish-only`
to reassemble rendered chapters. The chapter plan is in
`scripts/walkthrough-plan.mjs`.

Cursor movements and press rings are captured with the real UI. The Customs
Shop recorder scrolls options into view and checks that selections took effect.
Customs changes are previews: that recorder does not buy, save, craft or simulate
settlement, and blocks HTTP transaction writes. The account guide performs a real
purchase, verifies the owner against contract state and cuts network waiting time
between pending and confirmed steps. Later scenes use the separate racing demo
garage. Driving footage
uses assisted normal inputs with unchanged physics and results. The controller
guide reflects the game's mappings; a physical pad was not tested during capture.
PlayStation pads need a compatible browser/device, a USB or Bluetooth connection,
and an initial button press to become visible to the game.

The November 14 account recording used `p5463eb15fe9b.minirush-garage.testnet`:

- [Test NEAR top-up](https://testnet.nearblocks.io/txns/CsSX1UC23Kzzubu4vmeRd7spsriYYXeMskN6QSLHeKec).
- [ISLAND NIGHT #1 purchase, 0.75 test NEAR](https://testnet.nearblocks.io/txns/6odu99fnT1oX75gkz1oK9dPQwT1acj2FKtZruRB8ZHYg).

The displayed spendable balance moved from 1.95 to 1.20 test NEAR. The game keeps
a fee reserve aside; the purchase also incurs a network fee. This recording used
the local frontend and development backend. The development backend was updated
to accept the current signed top-up request before recording; this is not evidence
of a production deployment.

### Longer walkthrough

Aim for a two-to-three-minute edit, keeping the uncut recording and public
transaction receipts available. Label sped-up racing or time cuts. Start from
the game UI, with the chain details available when someone asks to inspect them.

| Time | Show | Explain |
| --- | --- | --- |
| 0:00–0:20 | Homepage and **Your next build** | “You start with a car. Race to earn the resources for your next part. No wallet extension or sign-up.” |
| 0:20–0:40 | A funded order and its recipe | “This dealer wants stock and has already reserved the money. I can build what the market needs.” |
| 0:40–1:10 | Actual racing, then confirmed salvage | “Racing supplies RUSH, alloy and circuits. The target shows what is still missing.” |
| 1:10–1:35 | Craft and inspect the numbered part | “Crafting consumes resources and creates this particular part. I made it; I choose where it goes.” |
| 1:35–2:05 | Fit it **or** deliver to a dealer | “Keeping it changes my driving tradeoffs. Selling it moves the same serial to the dealer and pays me from their funds.” |
| 2:05–2:30 | Updated inventory, payment and maker credit | “Dealers respond to inventory and available funds. They can resell player-made stock; they do not conjure parts or unlimited money.” |
| Optional | Race Friends lobby or a separate real race clip | “Two people can race live in private rooms. Multiplayer currently awards no economy rewards.” |

Do not promise a one-race craft. From an empty garage, the default Street slicks
need two eligible finishes for their four alloy, even when the first race is a
win. Other recipes can need more. Daily limits and connection failures still
apply. Use the confirmed balances shown in the interface.

## Manual rehearsal

1. Run the current frontend with a configured testnet backend. Use a dedicated
   test browser profile and keep it between rehearsals; it contains the garage
   key. Do not clear it or copy its contents into a submission.
2. Open **Your next build → Trade → Dealer orders**. Choose an active, affordable
   order and **View recipe & track materials**. The offer may fill or expire.
   If no dealer needs stock, demonstrate the install path honestly.
3. Choose **Race for materials**, then **Start race**. This prepares a standard
   two-lap Grand Prix with VIPER GT. Finish normally, allow at least 40 seconds,
   and wait for confirmed salvage. Repeat only as needed.
4. From results, open the tracked recipe. Craft once the confirmed resources
   cover the cost. Inspect the serial, maker and performance tradeoff.
5. Choose a path: install and compare fitted/stock handling, or open the funded
   offer and deliver. Show the confirmed outcome. Never retry a purchase just
   because it is slow; check **Activity** first.
6. For a sale, show the dealer's reduced outstanding order and updated player
   balance. A subsequent scheduled dealer review can list that part for resale;
   reviews are not instantaneous. Preserve its serial to demonstrate provenance.

## Repeatable real testnet capture

```sh
npm run dev:auth
# In another terminal, after reviewing the script:
node scripts/record-economy-demo.mjs --send http://localhost:3000
```

This is an integration demonstration, **not a mocked test**. It uses a dedicated
profile at `/tmp/minirush-demo-browser`, creates a garage if needed, drives up to
three races through normal input/physics, crafts one part and delivers it to an
available dealer or installs it. It spends testnet resources. No mainnet use is
supported. Do not edit frontend files while it runs: hot reload interrupts races.

The script records to `/tmp/minirush-economy-demo/economy-demo-raw.webm` and writes
timestamps plus public transaction links to `evidence.json`. The recording uses
automated steering; it never sets position, race time, finishing place or wallet
balances. Describe it as automated driving when sharing it. Keep profiles private;
only recordings, screenshots and public receipts belong in a submission.

For isolated UI regression tests that send no NEAR transactions, run
`npm run check:dealer-orders -- http://localhost:3000` and
`npm run check:race-workshop -- http://localhost:3000`. Their fixtures are not
evidence of live settlement.

## Honest answers for judges

- The deployed economy targets NEAR **testnet**. Local coins, RUSH/materials and
  test NEAR are separate resources.
- NPC component demand uses inventory and budget rules; it is not a claim that
  unconstrained AI controls the economy. Recipes remain code-defined.
- Browser-held garage keys make the first session unobtrusive. Encrypted recovery
  files support another device if a backup was saved beforehand. Protected signing,
  passkey recovery and hosted Google authentication remain unfinished.
- Race telemetry has checks, but competitive results are not yet authoritative.
  Live multiplayer has no prize or salvage payout.
- NEAR Intents is not implemented. Show the actual multi-token, component
  ownership, sponsored actions and funded market flows instead.

## Verified recording: 13 November 2026

The local frontend completed two normal-physics races against the development
backend with real NEAR testnet settlement. The dedicated garage earned 81 RUSH,
4 alloy and 2 circuits, then consumed 40 RUSH, 4 alloy and 1 circuit to craft
**Low-drag compound #2**. Mama T bought that serial for **85 RUSH after fees**.
The final public read confirmed Mama T as owner, the demo garage as original
maker, and 126 RUSH plus 1 circuit remaining in the demo garage.

| Action | Public receipt |
| --- | --- |
| First race reward | [NEAR testnet transaction](https://testnet.nearblocks.io/txns/2jdpcfZRd2d4Q3bzGZbkY4xAUebtnHScgWavmnN1ne9G) |
| Second race reward | [NEAR testnet transaction](https://testnet.nearblocks.io/txns/8mUoaypATSJa3afKQC4wg7pcVJboKKcy3tbq1YmSBTaA) |
| Craft component #2 | [NEAR testnet transaction](https://testnet.nearblocks.io/txns/D9mf1fYhHo1Gjwif4jBXG6fEU31eCNJ5m5iQGk9UhWbp) |
| Deliver to Mama T | [NEAR testnet transaction](https://testnet.nearblocks.io/txns/AbnxoJgkXK8hjS9qTWJnAkr3dWgQzAB2x5uuD6hNDWZY) |

[Recorded steps and final public state](demo-evidence.json) accompany the
receipts. The uncut capture is about 3 minutes 50 seconds. The presentation edit
is about 2 minutes 25 seconds, with race segments at 2× speed and an explicit
automation/speed label. Both are local artifacts under
`/tmp/minirush-economy-demo/`; videos and private browser profiles are not committed.

![A real crafted part with the choice to fit it or supply Mama T](screenshots/first-build-choice.png)
