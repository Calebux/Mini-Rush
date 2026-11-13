# NEAR parts economy — first playable slice

## Testnet rollout status — 2026-11-13

The live `minirush-garage.testnet` contract has been upgraded. LAGOS GOLD
(50 cars at 1.5 test NEAR) and ISLAND NIGHT (25 cars at 0.75 test NEAR) are open.
The development Convex backend has been deployed and checked against the live
contract. A browser garage bought LAGOS GOLD #1, listed and cancelled its resale,
and retained ownership after reload. The two-player integration check also
passed race settlement, replay protection, salvage, crafting, installation,
component resale, NFT ownership, maker provenance and balances.

The live purchase exposed a finality mismatch: SDK defaults returned before the
final-block inventory query could see the new car. Edition purchases and test
NEAR grants now wait for `FINAL` receipts before the UI refreshes. The edition
browser check asserts this behavior. Recovery checks cover both guest shopping
and optional sign-in-required deployments.

Production Convex (`precious-dalmatian-332`) is configured for the same testnet
garage; its frontend artifact uses that production backend. Sign-in stays off
on both sides, because the hosted Auth0 callback is still rejected. Dealer
automation is enabled only on production; development sets
`NEAR_DEALER_AGENTS_ENABLED=false` to avoid competing submissions from the same
dealer keys. Backend and frontend production publication is the remaining step.

Older development notes below describe when individual features were first
implemented; this rollout status supersedes their "not deployed" statements.

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

## Limited editions: cars sold for NEAR

RUSH is earned and never sold, so it brings the game no income. Limited editions
are the paid side. An edition is a fixed run of numbered cars (`edition:<id>:<n>`,
NEP-171 tokens served by the same `nft_*` methods as parts) that drives as an
existing model in its own paint. Code: `contracts/near/src/editions.rs`,
`shared/editions.ts`, the Car Market (`src/market.ts`) and the "Where the game
earns" scene on `/economy`.

- **First sale.** `buy_edition` (payable) mints the next serial to the buyer. The
  price stays in the contract account, which is the game's own account. Any excess
  deposit is returned. A run can never exceed its size, and its size and model
  cannot be changed.
- **Resale.** An owner lists with `list_edition_car` at a price in NEAR; another
  player buys with `buy_edition_car` (payable). The seller is paid in the same
  call, less a 2% royalty that stays with the game. Listings carry an offer number
  so a stale price cannot be bought. If the seller's account no longer exists, the
  payout fails and the money stays with the game.
- **Ledger.** `economy().near` reports first-sale volume, resale volume, royalties
  and cars sold. `/economy` reads it directly; nothing there is typed by hand.
- **No wallet, and never relayed.** The player's garage is a real NEAR account, so
  it can hold NEAR, and its key signs silently as for every other garage action.
  The two paid calls are the exception to the relay: the garage sends
  `buy_edition` and `buy_edition_car` itself and pays the price plus a network
  fee (about 0.0004 NEAR in rehearsal). They must never be relayed. In a relayed
  (meta) transaction the attached deposit is charged to the relayer, so the game
  would be buying the car for the player; the relay therefore keeps its
  fixed-deposit rule and does not list these methods at all. The network holds
  the prepaid gas up front (about 0.03 NEAR for 30 Tgas), so the market shows the
  balance with 0.05 NEAR already set aside (`FEE_RESERVE_YOCTO`). Listing and
  cancelling carry no NEAR and stay relayed. A paid call is not written to the
  Activity journal; if its result is lost, a refresh shows whether the car arrived.
- **Test NEAR.** On testnet the balance card offers a one-time top-up
  (`near:testNear`): `NEAR_TEST_GRANT` NEAR (default 2) per garage, at most
  `NEAR_TEST_GRANT_DAILY` garages a day (default 20), and never dipping into the
  last `NEAR_TEST_GRANT_RESERVE` NEAR (default 3) of the game account's spendable
  balance. It refuses to run for a garage that is not on testnet.
- **Opening editions.** Owner-only `create_edition`; `node scripts/near-editions.mjs`
  lists the launch runs and `--send` opens them.

Checks: `cargo test editions` (10 contract tests), `npm run check:editions`
(market flow against an in-memory chain) and
`node scripts/near-upgrade-rehearsal.mjs <throwaway>.testnet --testnet`. The
rehearsal copies the live garage's code to a throwaway account, upgrades it with
the local build and `migrate_components` in one transaction, then runs a first
sale, a relayed listing and a resale. It passed on 2026-11-13 on
`garage-rehearsal-586941.testnet`: old balances survived, the buyer paid 0.2003
NEAR for a 0.2 NEAR car, the seller received 0.245 of a 0.25 resale and 0.005
stayed with the game. Not yet done: the real garage is not upgraded, and the
Convex side (`near:testNear`, the relay's two new free methods) is not deployed.

## Home sign-in and guest shopping (testnet)

**Sign-in is off by default (since 2026-11-13).** The garage key made on the
player's device is how they access the game: racing, buying, crafting and
trading all work with no wallet and no login, and the home card shows the
driver's garage account instead of a sign-in button. The login panel is not
loaded. The reason is that NEAR Auth's shared testnet client only returns to
`http://localhost:3000`, and there is no way yet to add a hosted domain.

To put a login in front of buying again, set both switches and redeploy:
`VITE_SHOP_SIGN_IN=required` for the frontend build and `SHOP_SIGN_IN=required`
on the Convex deployment. They must match: a frontend without the switch sends
no login token, so a backend that requires one rejects every purchase. The rest
of this section describes the game with the switch on.

Select **Sign in** directly on the homepage. This opens the driver account
panel, then **Continue with Google** opens NEAR Auth's hosted authentication
screen, where the player chooses Google. The pinned provider does not expose a
Google-only shortcut through its documented login options.

This slice authenticates the player, reads the identity's derived Ed25519 public
key, and supports cancellation, local preview logout and a full-page fallback.
Login itself does not create an account or send a transaction. The optional
ownership check described below can record an identity-to-garage association;
it does not replace the existing garage key or provide cross-device recovery.
No authentication token, email or identity path is copied into the game's local
storage. The existing guest garage key remains stored there as before. The public key
is displayed only in optional sign-in details. Authentication is checked through
the provider, not inferred from a local "logged in" flag. The provider's current
session cache is in memory. On page load the app calls Auth0's `checkSession`
to restore it silently when hosted-session cookies are available. Cookie
restrictions or session expiry can still require another login. The home card
shows guest/signed-in status from the provider; no local login flag grants access.

Guests can race, earn, browse the collection, preview parts and use owned items.
Buying cars, paint, upgrades, workshop parts or supplies, and paid component
crafting require sign-in. Guest purchase buttons open sign-in without spending;
after login, the player must return and explicitly confirm the purchase. Logout
locks new purchases again. Race fines and recovery of already submitted actions
remain available without a login.

Local coin purchases check the active session before spending. New sponsored
`buy`, `buy_component` and `craft_component` calls additionally require a
Convex-verified Auth0 identity on both relay endpoints. The normal login ID token
is sent only in the request's Authorization header, never stored in the action
journal or used as an MPC signing token. The original garage signature is still
required by the tracked relay. This is a shopping-session check, not proof that
the login identity owns that garage, and grants no recovery permissions.

Deploy `convex/auth.config.ts` with the updated relay handlers to enforce this
on the server. Set backend `NEAR_AUTH_CLIENT_ID` explicitly (Convex requires it
when evaluating the auth config); for the shared testnet app use
`np8paqIpMWmNbzT4xAvOOapZBjsOpptl`. It must match frontend
`VITE_NEAR_AUTH_CLIENT_ID` if either overrides the shared testnet client. Convex
validates issuer, audience, expiry and signature using the configured Auth0 OIDC
provider. An already persisted transaction can finish after logout without a
second approval or payment. Unsubmitted requests still need a valid session.
These restrictions cover MiniRush's app and sponsored relay; the public NEAR
contract itself remains callable outside the app by account owners paying gas.

On 2026-11-11 these backend changes and the auth configuration were deployed to
the existing development deployment `resilient-loris-654`. A read-only query
with an invalid bearer token returned HTTP 401. Browser fixtures verified guest
racing, blocked guest purchases, signed-in purchases and logout; no real Google
credentials were entered by the automated checks. A real signed-in market
purchase remains a manual test with the player's own session and balance.

`src/cardSystem.css` defines shared charcoal surfaces, warm text, muted gold
accents, card/control radii, button hierarchy and focus states across home,
garage, market, workshop, race reports, mode selection and account panels.
The 3D previews and race HUD retain their existing behavior.

The game uses NEAR API v7. NEAR Auth browser-sdk 1.4.2 and javascript-provider
1.4.1 use v5, so the preview pins a separate `near-auth-api` alias to v5.1.1.
Auth packages load asynchronously for session restoration. The
adapter supplies Buffer/global compatibility and calls `provider.logout`
directly because browser-sdk 1.4.2 incorrectly forwards logout options as an
array. The current published packages also lag some newer documentation
interfaces. For NEP-413 ownership approval, a narrow compatibility bridge uses
the pinned provider's Auth0 client to reproduce the official
[`requestMessageSignature` implementation at commit 31f8082](https://github.com/Peersyst/fast-auth/blob/31f80825587ae2e5f43c21c2f23f29fc05ec7cc1/packages/providers/javascript/src/provider.ts).
It supplies the `nep413` authorization parameter, then validates the resulting
request's guard and exact payload. Remove this bridge once a published provider
offers the method. NEP-413's optional `callbackUrl` is omitted; it is signed data,
not an OAuth callback, and cannot fix the Auth0 callback allowlist.

**Local callback solution verified on 2026-11-11:** the repository's
[SPA example](https://github.com/Peersyst/fast-auth/blob/main/examples/spa/vite.config.ts)
uses port 3000. Live authorization-page checks with the shared testnet client
accepted both `http://localhost:3000` and `http://localhost:3000/`, showing the
hosted login page with **Continue with Google**. No credentials were entered;
this verifies callback acceptance, not a completed Google login or signature.

Run `npm run dev:auth`, then open exactly `http://localhost:3000`. The command
uses a strict port so Vite cannot silently move to an unapproved port. At the
time of this check, YardCheck was already using port 3000; stop that development
server yourself before starting MiniRush there. It was left running.
Browser storage is scoped to the origin: the guest garage saved at port 5174
does not automatically appear at localhost:3000. Keep the original browser data.
If `NEAR_AUTH_ALLOWED_ORIGINS` is explicitly set in Convex, add
`http://localhost:3000` to it as well; the default now includes this origin.

The shared testnet client still rejects `http://127.0.0.1:5174` and
`http://127.0.0.1:3000/` with `Callback URL mismatch`. To use those URLs, its
Auth0 application owner must allow them or issue another compatible NEAR Auth
testnet client ID.
Follow-up live popup checks also rejected `http://localhost:5174` and
`http://localhost:5173`; switching to localhost or Vite's default port did not
resolve the callback restriction. No Google credentials were entered.
Full-page SDK login was also checked at all three origins. The actual
`redirect_uri` values included the trailing slash (`/`); each still returned
`Callback URL mismatch`. The restriction is not specific to popup login or a
missing trailing slash. These observations do not establish which other
callback URLs the shared application allows beyond localhost:3000 above.
If issued a replacement client ID, set it in `VITE_NEAR_AUTH_CLIENT_ID` and restart Vite. Do not put a
client secret in frontend environment variables.

To keep testing on port 5174, ask the NEAR Auth testnet application administrator to allow:

- Callback URLs: `http://127.0.0.1:5174` and `http://127.0.0.1:5174/`.
- Allowed Web Origins: `http://127.0.0.1:5174`.
- Add localhost equivalents only if testing at `http://localhost:5174`.

Before deploying this preview, similarly register the exact deployed origin and
callback, for example `https://minirush.site` and `https://minirush.site/`.
`npm run check:auth-origin -- https://minirush.site https://www.minirush.site`
asks the login server whether it will return players to each origin, for both
popup and full-page sign-in, without credentials. On 2026-11-11 it reported
`Callback URL mismatch` for both hostnames and accepted `http://localhost:3000`.
With sign-in required, do not deploy this frontend to a domain until that check
prints `READY`: purchases would need a login the domain cannot complete, which
leaves the shop closed there. With sign-in off (the default) the check does not
gate a deploy.
Full-page login uses the current origin and pathname as its callback. A
session-scoped, ten-minute intent restores the original local URL after return;
foreign return origins and expired intents are rejected. Auth0 handles OAuth
state/PKCE; the app removes callback parameters when handling finishes.

`npm run check:near-auth` uses the actual installed SDK with mocked Auth0 session
methods, RPC responses and backend ownership responses. It verifies cancellation,
key lookup, ownership approval, wrong-payload rejection, recovery after a lost
response without another approval, logout, callback cleanup/expiry, same-origin
return validation, mobile layout, and preservation of the existing garage
key/account/action journal. This is
not evidence of a completed real Google login. Callback acceptance at
localhost:3000 was checked separately. No real credentials, signing requests or chain transactions
were used in this check.

The next integration needs a recoverable signing setup, updated backend
authorization, and tests for returning on another device and account switching.
Do not grant account access using a browser-supplied email or public key alone. Also measure
the provider's approval behavior before claiming uninterrupted gameplay: its
default transaction-signing flow can open authentication UI.

References: [testnet configuration](https://docs.auth.near.org/resources/testnet),
[browser SDK](https://docs.auth.near.org/sdks/browser-sdk),
[JavaScript provider](https://docs.auth.near.org/sdks/javascript-provider).

### Garage ownership verification

After sign-in, **Verify garage ownership** prepares a server-issued challenge.
**Approve ownership check** opens Auth0 approval for that exact message. The
backend requires proof from both the garage's currently active full-access key
and the identity's derived Ed25519 key. A successful check records an association
in `garageIdentities`; it grants no new signing or recovery permissions and
does not move cars, parts or balances.

The challenge includes the garage account, both keys, contract and expiry, with
a random 32-byte nonce and the allowed app origin as recipient. It expires after
five minutes. JWT issuer/audience/payload checks on the server are preliminary
checks only: the on-chain Auth0 guard must validate the JWT, and the server must
verify the actual returned MPC signature before recording the association.

Deploy the updated Convex schema, actions and cleanup cron before testing this
flow. Sponsored ownership signing is **disabled by default**. Configure these
in the Convex backend, never as `VITE_` variables:

| Setting | Purpose |
| --- | --- |
| `NEAR_AUTH_PROOFS_ENABLED=true` | Enables the testnet-only ownership flow after setup and rehearsal. |
| `NEAR_AUTH_SIGN_DEPOSIT_YOCTO` | Explicit MPC deposit per request, in yoctoNEAR. No default is guessed. Measure the required testnet deposit; the implementation permits at most `10000000000000000000000` (0.01 testnet NEAR). |
| `NEAR_AUTH_ALLOWED_ORIGINS` | Comma-separated exact origins. Defaults to `https://minirush.site,http://localhost:3000,http://127.0.0.1:5174,http://localhost:5174`. This backend allowlist is separate from Auth0's callback configuration. |

The existing backend `NEAR_GAME_KEY` sponsors the fixed `fast-auth.testnet.sign`
call. Clients cannot choose its receiver, method, gas or deposit. There are at
most ten challenges per garage in 24 hours, a 30-second minimum spacing, one
active challenge per garage, and an atomic global limit of 100 new signing
requests per UTC day. These limits do not prevent a bot from exhausting the
daily allowance; live usage and gas measurements are still required.

Before broadcast, the backend saves the exact signed outer transaction and hash.
Retries query or resend those same bytes. The browser stores the challenge,
garage signature and progress, never the Auth0 JWT. The private backend journal
temporarily contains the JWT inside signed transaction bytes; terminal results
clear those bytes immediately. Hourly cleanup removes up to 200 challenges that
expired more than a day ago, so a cleanup backlog can extend retention. Durable
verified associations remain after challenge cleanup. Local success flags are
rechecked with the backend; an aged-out challenge can be verified again.

`npm run check:identity-proof` exercises the real backend handlers with real
Ed25519 signatures and simulated database/RPC responses. It checks encoding,
both proofs, altered tokens, wrong keys, nonce replay, expiry, revoked access,
budgets, idempotency, response-loss recovery and retention. Together with the
browser check, this validates the implementation locally. Live Google login,
the MPC deposit and returned signature format still need testnet verification;
no real signing transaction was sent during these tests. The decoder fails
closed if the live MPC response does not contain a 64-byte Ed25519 signature.

## Background recovery and player-facing activity

The market, workshop and race results now use game language: completing a
purchase, adding rewards, and collecting materials. **Activity** is available
from Garage, the car market and Performance & Parts. It shows recent purchases,
crafting, installation and deliveries with Processing, Completed or Not completed
states. Blockchain records remain accessible in collapsed action/reward/price
details. A test-build disclosure remains visible; Activity explains that items
have no cash value and that access still depends on this browser's saved key.
A separate Google sign-in preview is available on the driver card (see above).
Cross-device garage recovery is not implemented.

Before sending an economy action, the browser durably saves its exact signed
delegate, account/network scope, method and arguments. Storage failure blocks
submission. One pending action per garage prevents another spend until its result
is known; supported browsers also use a Web Lock to coordinate tabs. New clients
call `near:relayTracked`. The backend verifies the registered player's signature,
garage target, allowed method/deposit/gas, and expiry bound. An atomic Convex
mutation stores the signed outer transaction and hash **before** any broadcast.
Concurrent calls with the same delegate reuse the same stored transaction.

Recovery queries the original hash and may rebroadcast only the stored bytes.
It never signs another player purchase or infers success from a changed balance.
A result must reach `FINAL`, match the saved hash, and pass receipt failure checks
before the client unlocks its next action. A lost response, RPC outage or ambiguous
nonce error remains Processing. Some such cases need operator investigation;
there is deliberately no "forget pending purchase" button that could enable a
second spend. Older requests without a recoverable server record likewise remain
unresolved rather than being labelled unpaid. See NEAR's
[transaction status documentation](https://docs.near.org/api/rpc/transactions).

Startup, reconnection and visible-page checks resume saved actions and existing
idempotent race claims. Automatic checks back off from 15 seconds up to 5 minutes;
Activity also offers Check progress. Fresh inventory reads restore driving
entitlements after recovered purchases. Reward responses identify their race,
so a delayed old reward cannot overwrite a newer results screen. A confirmed
purchase remains confirmed if a subsequent inventory read fails. New account keys
and reward requests must be saved before their initial submission. Clearing browser
storage still loses the recovery journal and local account access.

The browser keeps 30 terminal actions plus all unresolved entries. Convex's
`garageActions` table retains unresolved rows; a scheduled bounded cleanup removes
terminal records older than 30 days. This is off-chain history, not additional
per-action smart-contract storage. Historical calls through the legacy `near:relay`
endpoint are not backfilled and do not acquire these recovery guarantees.
Deploy the Convex schema, actions and retention cron **before** this frontend;
new clients intentionally do not fall back to an untracked purchase endpoint.
No live services or contracts were deployed for this change.

`npm run check:garage-recovery` exercises the journal, receipt classification and
actual relay handler with in-memory DB/RPC adapters, including a response lost
after execution. `npm run check:garage-recovery-ui` verifies reload recovery,
one purchase effect, no replacement signed request, blocked storage, rejected
actions, automatic rewards and the mobile Activity panel using isolated fixtures.
Existing market, parts and race/workshop acceptance checks cover their normal
flows with the tracked API. Live finality, relayer nonce contention and gas still
need measurement on the deployed testnet stack.

## Ownership and settlement

### Funded dealer purchase orders

**Garage → Customs workshop → Performance & Parts → Trade → Dealer orders**
shows an NPC's requested recipe, remaining quantity, expiry, reason and the RUSH
the seller receives after the market fee. Players can track its crafting inputs
on race results, craft the part, and return from My parts through the dealer-order
shortcut. A delivery names the exact component serial. Installed or listed parts
must first be uninstalled or delisted; delivery never silently dismantles a build.
Orders are shared demand, not personal quests: another driver can fill one first.

`place_component_order` is dealer-only. It reserves existing RUSH without minting
or changing total supply. All RUSH debits (including purchases, transfers and
legacy buybacks) enforce the reservation. Each dealer/recipe has at most one
order; replacements require the current revision. `fill_component_order` checks
ownership, recipe, revision, expiry, net payout floor and recipient capacity, then
transfers that component and pays the seller synchronously. The existing 2% fee
(minimum 1 RUSH) is burned and recorded in the season ledger. Duplicate delivery
cannot pay twice because the seller no longer owns the component. Maker provenance
survives delivery and resale. `dealer_order_funds` separates total, reserved and
available dealer RUSH; `economy.dealer_rush_reserved` exposes the locked total.

Orders are capped at 96 globally, 5 units per order, and 24 hours per order. Filled
and cancelled orders are removed, and anyone can call `expire_component_orders`
to release expired/revoked-dealer orders. Expired funds remain locked until cleanup
or a successful order placement releases them. A monotonic revision counter
prevents a replacement from reviving an old quote. The versioned storage record
`minirush:component-orders:v1` is separate from `Garage`, so this addition does not
alter the current component/ledger state layout. An already compatible workshop
contract needs a code upgrade, not another `migrate_components` call. Original v1
garages still require the documented migration. Rehearse against the exact deployed
version before rollout. Do not roll back to a contract without reservation checks
while orders remain funded.

The `componentDealerTick` runs after car repricing in the existing 15-minute job,
so scheduled writes using the same dealer keys do not compete for nonces.
Mama T sources tires, Oga Motors engines, and Tuner Ade nitro components.
The deterministic policy buys the least-held recipe toward two of each, commits
at most half the currently available RUSH, and stops buying at 12 held components
or when funds are insufficient. Scarce recipes receive higher quotes. Acquired
components are listed through the same player market with a resale margin; price
depends on current recipe stock. Selling stock can reopen demand next tick.
Live quotes are left alone until filled or expired, and resale/listing transactions
check receipts. Quiet ticks avoid writes when neither listings nor orders change.
This purchasing policy uses rules, not the optional LLM used by legacy car dealers.
There are no free component restocks or automatic dealer grants: dealers need
existing RUSH, including proceeds from car or part sales. Component resale may
wait until the next tick. These bounded inventory rules are a first playable
market, not a claim of proven long-term economic balance.

Old contracts or failed order reads show **Dealer orders unavailable** without
disabling the existing crafting/listings flow. No funded demo orders are fabricated
in the production UI. This feature requires contract, backend/cron and frontend
deployment; no deployment or testnet transaction was performed during development.

Local acceptance: `npm run check:dealer-orders` uses isolated browser/backend
fixtures for the UI and checks budget/stock policy, failed delivery, delivery,
dealer resale, installation, expiry and unavailable-backend behavior at desktop
and 360/390 px widths. Rust unit tests exercise actual contract accounting,
replay/quote rejection, reservation locks, expiry, recipient reservations and
state serialization. These checks do not replace live testnet receipt validation.

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
