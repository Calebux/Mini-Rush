# NEAR parts economy — first playable slice

MiniRush's NEAR workshop turns race salvage into individually numbered component
NFTs, installs them on a chassis, and lets another player buy and drive with that
same component. Open **Garage → Customs workshop → Performance & Parts**.
The economy uses the existing Customs screen: the live rotating chassis, part
cards, performance bars and current game theme. Customize retains the original
local build editor; Performance & Parts contains Craft, My parts and Trade.
Changing the performance chassis updates the showroom preview without changing
the selected race car or discarding an unfinished cosmetic build.

## Player loop

1. Finish an eligible connected race lasting at least 40 seconds.
2. Claim 2 alloy, 1 circuit and RUSH by finishing place: 45 for a win, 36 for
   second, 30 for third, 24 for any other finish. A podium only counts against a
   grid of at least three rivals; solo runs and police chases pay the finish rate.
   Local coin pickups are separate and do not determine the on-chain payout.
3. Craft a component: its RUSH and material costs are burned together.
4. Install it on VIPER GT or RUSH ONE. Four slots accept one component each:
   engine, gearbox, tires and nitro. Each slot has three alternatives.
5. List the component at a chosen price. Listing automatically uninstalls it.
6. Another player buys it. The contract transfers ownership and RUSH in the same
   call. A fee of 2%, rounded down with a 1 RUSH minimum, is burned; the seller
   receives the remainder. A listing revision protects against stale offers.
7. Alternatively, uninstall and recycle it for half its crafting materials,
   rounded down. Recycling burns the NFT and returns no RUSH.

The catalogue lives in `shared/components.json`; both Rust and TypeScript read
that same file. Every recipe has positive and negative stat changes. Changes add
relative to the stock chassis, never multiply. Any installed on-chain component
activates a component build and replaces local performance tuning; cosmetic
workshop choices remain. Removing the last component restores the local tune.

VIPER GT and RUSH ONE both start with normalized performance at 100. Their four
component slots are independent; an instance can be fitted to only one chassis.
The cheapest component takes two eligible races; every recipe can be afforded
after three. A full four-slot set takes ten eligible races if the player spends
only on those four components.
These are starting balance targets, not evidence of long-term economic stability.

## Race report and workshop handoff

Circuit results keep a dedicated salvage card beside the local coin tally.
It distinguishes confirming, received, pending, unavailable and ineligible
outcomes. Only a returned settlement receipt displays earned RUSH and materials;
recipe progress is read separately from confirmed holdings. A failed balance read
shows unavailable balances, even if the payout itself was confirmed. Pending
claims can be retried in results or recovered from Performance & Parts later.
A missing settlement receipt never clears a pending claim. City GP currently
pays local coins and explicitly does not claim circuit salvage.

Players can choose any recipe as their next upgrade in results, or track a recipe
in the workshop. That preference survives reloads on this device. The estimated
races remaining uses the largest material shortfall at the plain finish rate,
so a podium can only shorten it; it is not a promise of rewards or an exemption from daily limits.
**Craft this part** opens the matching chassis, slot and recipe in the existing
Customs panel. Crafting still requires an explicit action in that panel. A
successful craft selects the new serialized part in My Parts. Closing the
workshop returns to the same report and refreshes balances without claiming
another payout.

Installation confirmation waits for both transaction success and a fresh inventory
read showing the part fitted to the selected chassis. The workshop shows a short
component assembly illustration and actual before/after build ratings, including
any replaced part or local tune. These are temporary installation visuals, not
permanent body modifications. Reduced motion uses a static confirmation. Failed
transactions do not show an installation success, and changing chassis or leaving
the workshop clears the illustration.

## Ownership and settlement

`contracts/near/src/components.rs` extends the existing garage contract. RUSH and
materials use its existing multi-token balance ledger. Component NFTs use unique
`component:<serial>` IDs, an owner, an immutable maker, a crafting timestamp and a
recipe ID. They expose NEP-171 core transfer/token methods, NEP-177 metadata and
NEP-181 enumeration. Optional approval and royalty extensions are not implemented.

Transfers clear installed status. Listed parts cannot be transferred through the
NFT API until their listing is cancelled. `nft_transfer_call` reserves a slot in
the sender's inventory until its callback resolves, so a rejected receiver can
return the part without a full-inventory failure. Callback failures or malformed
responses request a refund; a part already passed to another owner is not seized.
Mint, transfer and burn events are emitted alongside game-specific events.
Third-party wallet and marketplace compatibility has not been tested live.

Each account holds at most 64 parts, including outgoing transfer-call reservations.
There are at most 2,000 open offers and 100,000 issued component serials in this
initial season. Recipes are read-only; changing them requires a contract/code
upgrade and affects existing parts, so production releases need explicit recipe
versioning before any balance changes.

Gameplay reads a fresh component inventory before each race. Failed reads remove
component bonuses for that race. A loadout is a snapshot for a race already in
progress; transferring a part elsewhere does not modify physics halfway through
that race. The next race reads ownership again. Browser manipulation is outside
this entitlement check's protection.

New on-chain car entitlements are held separately from permanent local car
purchases. Pre-existing local unlocks cannot be attributed retrospectively to
chain purchases and are retained. The component system never stores permanent
local part unlocks.

## Why the podium pays more

A flat payout left the loop open: parts changed how the car drove but not what a
race earned, so there was no economic reason to build. With place-based RUSH a
better build finishes higher and earns up to 45 instead of 24, which funds the
next part or a dealer car. Materials stay flat at 2 alloy and 1 circuit, and they
are the binding cost of every recipe, so the pacing above (two races for the
cheapest part, ten for a full set) holds at any finishing place. Winning speeds up
RUSH, not crafting, and surplus RUSH is what reaches the dealers and other players.

## Season ledger and the public economy page

The contract counts every faucet and sink as it happens: rewarded races and
podiums, RUSH and materials minted, RUSH burned by crafting and by the 2% trade
fee, materials burned, parts crafted and recycled, trades and their volume. The
`economy` view returns those totals with live supply, the RUSH sitting in dealer
tills, parts and open offers, today's rewarded races against the daily budget and
the payout table. A unit test reconciles the ledger against supply after a mixed
run of rewards, crafting, recycling and a trade.

`/economy` (`economy/index.html`, `src/economyPage.ts`) renders that view with the
dealer stalls and the dealers' latest price moves and reasons. It needs no wallet
and makes only view calls. Against a garage that predates this upgrade it falls
back to supply and dealer data and says the ledger is not recording yet. The
ledger starts at zero when the upgrade is deployed; it does not reconstruct
earlier activity.

## Reward trust and budgets

`beginRace` creates a signed, server-timed session. Only the latest active session
can progress. Signed checkpoints must be monotonic and physically plausible
under a generous speed ceiling. The server checks elapsed time, distance,
checkpoint count and session expiry. The finishing place is the one value taken
from the client: it is part of the signed finish message, the first accepted
finish fixes it for that session, and both server and contract reduce it to one
of four fixed amounts. A dishonest client can therefore claim a win it did not
drive, worth 21 RUSH over a plain finish, and nothing more; it cannot name an
amount. The old public `payRace` action explicitly rejects requests.

A finished session is reserved before submitting a transaction. `reward_race`
records its session ID on chain, making retries after ambiguous network failures
idempotent. Pending claims survive reloads in browser storage and can be retried
from the workshop. They are removed only after a successful response. Failed or
expired validation claims can remain pending; there is currently no discard UI.

Contract limits are 20 rewarded races per account per UTC day, at least 40 seconds
between first-time payouts, and 2,000 payouts across the whole game per UTC day.
That bounds this reward path to 90,000 RUSH (every race a win), 4,000 alloy and
2,000 circuits per day.
There is no transferable signup RUSH grant for new accounts. Existing balances
are preserved. Administrative RUSH minting still exists for the operator and is
outside these race budgets; the game key is therefore a trusted authority.

The server still receives client-reported telemetry. These checks do **not** prove
a real race occurred: a bot can fabricate plausible checkpoints, and multiple
accounts can evade per-account caps. Authoritative physics replay, account abuse
controls and sponsored gas budgets remain prerequisites for valuable rewards.
The whole feature remains testnet-only, with no cash value or redemption promise.
Player keys are still stored in browser storage; wallet recovery and stronger key
protection are separate work.

## Rollout

The implementation is local until all three layers are deployed. Do not publish
the frontend alone and expect new methods to exist on the current backend.

1. Build and test the contract. Its artifact is
   `contracts/near/target/wasm32-unknown-unknown/release/minirush_garage.wasm`.
2. For an existing **v1** garage, deploy the WASM and call
   `migrate_components {}` in one transaction signed by the contract account.
   The private migration reads the original layout and preserves its collections.
   Do not call `new` or run migration twice. A fresh account uses `new` normally.
3. Deploy Convex's schema and actions, using the same `NEAR_GARAGE`, `NEAR_RPC`
   and `NEAR_GAME_KEY` configuration. No dealer setup changes are needed.
4. Deploy the frontend with matching `VITE_NEAR_GARAGE`, `VITE_NEAR_RPC` and
   `VITE_CONVEX_URL`. Old clients can still race locally but cannot claim the
   removed client-selected payouts.
5. Run a real two-account testnet acceptance test: earn salvage, craft, install,
   list, buy, verify NFT ownership and balances, then race on the buyer's account.
   Check transaction receipts and test both successful and rejected NFT receivers.

No contracts, Convex functions or hosted frontend were deployed during this change.
The migration unit test checks preserved balances; a testnet migration rehearsal
and receipt-level integration test remain necessary before rollout. The NEAR
[upgrade documentation](https://docs.near.org/smart-contracts/release/upgrade)
explains why changing stored contract layout needs migration.

## Local verification

```sh
npm run build
npm run check:economy-server
npm run check:race-rules
cargo test --manifest-path contracts/near/Cargo.toml --locked --offline
cargo build --manifest-path contracts/near/Cargo.toml --target wasm32-unknown-unknown --release --locked --offline
npm run dev -- --host 127.0.0.1 --port 5174
# Separate terminal:
npm run check:parts -- http://127.0.0.1:5174
npm run check:race-workshop -- http://127.0.0.1:5174
```

The browser check mocks RPC and Convex writes and saves screenshots in
`/tmp/minirush-parts`. It verifies actual UI interactions, local meta-transaction
signing, component-driven stats, affordability and disconnected states. Rust
unit tests exercise the real contract accounting, ownership, replay protection,
NFT callbacks and v1 migration. Neither is a substitute for testnet execution.
`node scripts/near-e2e.mjs --testnet` is an opt-in, roughly three-minute settlement
test after deployment. It creates ephemeral testnet accounts, submits simulated
checkpoints, checks replay protection and trades a crafted component between two
players. It was not run against the live deployment in this change. It does not
prove genuine driving or replace the manual game acceptance flow above.

The race/workshop browser fixture accelerates the finish and mocks settlement.
It verifies pending/retry/confirmed results, targeted recipe navigation, actual
craft/install UI actions, rejection handling, reduced motion, stale-response
isolation, balance failures, preserved pending claims, and desktop/mobile layouts.
Screenshots are saved to `/tmp/minirush-race-workshop`. This test does not establish
that a race qualifies for rewards on the live backend.
