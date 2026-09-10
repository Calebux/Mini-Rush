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

## Storage and economy

Builds and part ownership use `minirush.workshop.v1` in this browser's local storage. An interrupted coin purchase is completed from a journal before the game reads the bank on the next boot. Clearing browser/app storage removes these builds and local unlocks.

This is a local earned-coin parts shop, not player-to-player trading, an on-chain inventory or a cash-out economy. Coins have no cash value. Server-verified entitlements, recovery across devices and anti-cheat are separate work before presenting this as a secure real-money marketplace.

## Nimiq Pay

Home links directly to **NIM Market**, which opens the existing Hypercars shelf. Account access is requested after a user action, not at startup. NIM purchase buttons require both the host provider and payment configuration. A pending payment prevents a second submission; changing the selected car during approval does not change the purchased car.

Browser tests stub the wallet for rejection, concurrency and fulfilment tests. They do not prove a native transaction or on-chain confirmation. Before competition submission, test on a physical phone inside Nimiq Pay using testnet and correctly configured recipient addresses: account approval/refusal, payment approval/refusal, insufficient funds, returning from the native dialog, and reopening the app. Also check touch scrolling and the on-screen keyboard on that device. Do not use `npm run stress` for UI testing; it is a separate financial workflow.

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
