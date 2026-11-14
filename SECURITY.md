# Security and trust boundaries

MiniRush is a **testnet prototype, not an independently audited system**.
This review hardens selected spending paths; it is not a penetration test or a
claim that no exploitable defects remain. Do not deposit mainnet assets.

## What is trusted

| Boundary | Enforcement and remaining trust |
| --- | --- |
| Local game state | Coins, skins, unlocks and physics are browser state. Players can modify them; they do not prove on-chain ownership or a competitive result. |
| Garage signing | A private key stays in browser storage. The backend stores its public key. Loss of storage loses access; XSS or a compromised browser can steal that key. |
| Sponsored actions | The tracked relay verifies the registered key's signature, receiver, allowed method, deposit, gas and expiry. NEAR checks the delegate authorization and nonce. The old untracked endpoint rejects all calls. |
| Race emissions | Signed telemetry, elapsed time, checkpoint counts, pace bounds and contract caps constrain payouts. The server does **not** simulate the race; a malicious owner can fabricate plausible telemetry and finishing place. |
| Ownership and markets | The contract checks ownership, quoted listing revisions, balances and inventory. Crafting burns inputs; dealer orders reserve existing funds. The contract owner remains trusted to mint and upgrade. |
| NPC decisions | Dealer keys have dealer permissions. Repricing is constrained; model output cannot sign transactions. Component orders use deterministic inventory and budget rules. |
| Multiplayer and boards | Private room tokens protect seats; progress receives plausibility checks. Multiplayer gives no economic rewards. Public arcade boards are client-reported and must not determine prizes automatically. |

## Hardening in this revision

**Source changes, not a claim of a new production deployment.** The dated release
record in [economy notes](docs/near-economy.md) identifies the live version.

- Account creation reserves a slot in one Convex mutation **before** funding.
  Limit: 20 new reservations per UTC hour and 100 per UTC day, per deployment.
  At the unchanged 0.01 test NEAR grant this bounds new-account principal to
  1 test NEAR/day, excluding gas. Failed/uncertain reservations still count.
- Account creation saves the signed transaction before broadcast. A lost response
  can be recovered from its hash; retries never create replacement transfers.
  A terminal failure or expired unknown transaction requires operator review.
- The old untracked relay is disabled. The current relay checks the signature
  before sponsorship and stores the exact transaction for safe recovery.
- Each sponsored broadcast attempt, including a failed call or retry, consumes
  an atomic budget: 12/minute per account and operation kind. Daily limits:
  relay 200/account and 5,000/global; reward 40/account and 3,000/global;
  creation retries 20/account and 200/global. These are attempt limits, not gas
  measurements. UTC windows can allow a burst across a window boundary.
- Starting a new reward session is bounded to 120/account/day and 6,000/global/day.
  The contract separately caps **successful rewards** at 20/account/day and
  2,000/global/day and enforces its 40-second gap and permanent replay records.
- Test-NEAR top-ups require a fresh garage signature bound to account and timestamp.
  The atomic one-time record prevents repeated grants. Configuration rejects
  invalid numeric values, caps each grant at 2 and the daily count at 20, and
  requires an available-balance check against a reserve of at least 3 test NEAR.
  The grant reservation subtracts pending transfers and grants reserved during
  that balance read, preventing concurrent grants from reusing the same snapshot.
- `NEAR_SPONSORSHIP_PAUSED=true` stops new funding, grant/reward/relay broadcasts,
  identity signing and dealer automation. Read-only checking of already tracked
  relay results and existing garage lookup remain possible. It is a backend
  pause, **not an on-chain contract pause**; direct player transactions continue.
- Vercel headers reject framing, plugin objects and inline executable scripts;
  MIME sniffing is disabled. Local development no longer accepts every hostname.
  CSP permits inline styles and HTTPS/WSS connections for the existing UI, RPC,
  authentication and radio services; it is not an exfiltration-proof sandbox.

Budgets are deployment-local. Do not let another public backend share the same
funding key without its own operational budget. Limits constrain loss, not Sybil
identity or denial of service: bots can still exhaust a public allowance.
Convex's [atomic mutations and concurrency control](https://docs.convex.dev/database/advanced/occ)
make reservation checks and writes one transaction. They do not make a NEAR RPC
call and a database mutation one distributed transaction.

Legacy Nimiq profile mutations (`sync`, `setName`, `addCar`) also reject writes.
They had no current game callers and accepted arbitrary addresses without proof
of ownership. Archived reads and internal operator corrections remain.

## Known gaps and release gates

1. **Authoritative results:** implement server simulation or independently verified
   replay before valuable competitive rewards. More client checkpoints alone
   cannot fix this trust boundary.
2. **Account security:** resolve hosted auth and implement reviewed, identity-bound
   recovery. A Google session alone must not grant control of an arbitrary garage.
3. **Contract review:** independently audit transfers, callbacks, migration,
   administrative privileges and storage growth before mainnet. Edition seller
   payments/refunds use detached NEAR promises; failed asynchronous payouts need
   an explicit reconciliation/recovery design before valuable trading.
4. **Funding operations:** concurrent chain spending and RPC snapshots can change
   available funds after a reserve check. Measure real gas/storage, monitor the
   funding account, and reconcile uncertain grants manually. Never clear grant
   reservations or resubmit a new transfer solely because an RPC timed out.
5. **Replay storage:** race records remain on chain indefinitely. Safe pruning
   requires an enforced claim window and a migration rehearsal; deleting records
   alone can re-enable old claims.
6. **Other public surfaces:** arcade boards still trust client data. These are not
   authoritative NEAR ownership or prize records; broader spam controls remain
   separate work. Archived legacy profiles may contain old unverified data.
7. **Availability:** complete multi-client load tests, physical-device tests and
   production monitoring. New budgets can intentionally reject legitimate users
   during heavy traffic. No claim of DDoS resistance is made.

## Dependency review

On 2026-11-13, `npm audit` initially reported 26 affected package entries:
1 critical, 8 high, 3 moderate and 14 low. Compatible lockfile updates reduced
this to **0 critical, 0 high, 4 moderate and 14 low**. Counts include dependent
packages, not necessarily distinct reachable exploits.

Remaining findings:

- `elliptic` and dependents in the optional NEAR Auth/legacy NEAR SDK graph:
  [risky cryptographic primitive implementation](https://github.com/advisories/GHSA-848j-6mx2-7j84).
  The active garage uses Ed25519; that does not remove the dependency advisory.
  Upgrade or replace the affected auth dependency graph before production auth.
- Asset tooling (`@gltf-transform/cli` → caporal → glob/minimatch):
  [cancellation bypass](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) and
  [glob amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249).
  These are development tooling dependencies; do not run asset import tooling
  over untrusted input. A compatible upstream fix is still needed.

No forced SDK downgrade or incompatible dependency override was applied merely
to make the audit count zero. Re-run the scan; this is a dated observation.

## Reproduce the checks

```sh
npm ci
npm run build
npm run check:economy-server
npm run check:security
npm run check:race-rules
npm run check:friend-rules
npm run check:garage-recovery
npm run check:identity-proof
cargo test --locked --manifest-path contracts/near/Cargo.toml
npm audit
# Chrome installed; serves dist locally with vercel.json headers:
node scripts/check-security-browser.mjs
```

Security handler tests use ephemeral keys and offline DB/RPC adapters, including
serialized mutation rollback. They cover forged/stale/wrong-account signatures,
concurrent grant requests, funding-response loss, replay recovery, budget exhaustion
and pause behavior. They do not reproduce the hosted Convex runtime or prove load
capacity. CI runs offline checks and rejects high/critical dependency advisories.

A tracked-file pattern scan found no matching embedded secret values in the text
files checked during this review. That is not a full Git-history secret audit.
Never put signing keys in `VITE_` variables, screenshots, logs or issue reports.

## Reporting an issue

Do not publish private keys, exploit instructions against live users, or account
recovery material in a public issue. Ask the maintainer for a private reporting
channel, or use GitHub's private vulnerability reporting if the repository has it
enabled. No dedicated security inbox or bug bounty is currently advertised.
