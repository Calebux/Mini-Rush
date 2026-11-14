'use node';
// The NEAR side of MiniRush (testnet). Everything that needs a key runs here:
//   createPlayer — makes the player's account from a key the phone generated
//   beginRace / raceProgress — rewards from timed, signed race sessions; the place picks a fixed tier
//   relay        — submits a player's signed meta-transaction, game pays gas
//   dealerTick   — the three dealer agents reprice their stalls (cron)
//
// Keys come from Convex env: NEAR_GAME_KEY (owner of the garage contract) and
// NEAR_DEALER_KEYS (JSON {account: key}). The dealers think with an
// OpenAI-compatible model when DEALER_LLM_URL / DEALER_LLM_KEY / DEALER_LLM_MODEL
// are set (NEAR AI Cloud, OpenRouter, …) and with plain rules otherwise; every
// decision records which one made it.
import { createHash, randomBytes } from 'node:crypto';
import * as borsh from 'borsh';
import { Account, actions, PublicKey, SCHEMA, SignedTransaction, baseEncode, encodeDelegateAction, type KeyPairString } from 'near-api-js';
import { v } from 'convex/values';
import { action, internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { RACE_PAYOUT, raceRush, rewardPlace } from '../shared/raceRules';
import { dealerOrderPlan, type ComponentOrder, type DealerPart, type OrderRecipe } from '../shared/dealerOrders';
import { settledOutcome, type ActionResult } from '../shared/garageRecovery';
import { AUTH_GUARD, identityStartMessage, type IdentityChallenge, type IdentityProofResult } from '../shared/identityProof';
import { inspectSigningToken, mpcSignature, proofBytes, strictBase64, verifyIdentitySignature } from './identityProofCrypto';
import type { ActionCtx } from './_generated/server';
import { requiresShopSignIn, signInRequired } from '../shared/shopPolicy';
import { YOCTO } from '../shared/editions';
import { boundedSetting, grantMessage } from '../shared/sponsorPolicy';

const GARAGE = process.env.NEAR_GARAGE ?? 'minirush-garage.testnet';
const RPC = process.env.NEAR_RPC ?? 'https://test.rpc.fastnear.com';
const TGAS = 1_000_000_000_000n;
// Off by default: the key made on the player's device is their access. See shared/shopPolicy.ts.
const SIGN_IN_REQUIRED = signInRequired(process.env.SHOP_SIGN_IN);
const WELCOME_RUSH = 0; // No transferable signup grant: extra accounts must not print spending money.
const PLAYER_NEAR = 10_000_000_000_000_000_000_000n; // 0.01 NEAR: account storage only — the game pays gas

function assertSponsorship() {
  if (!GARAGE.endsWith('.testnet')) throw new Error('Sponsorship is restricted to testnet');
  if (process.env.NEAR_SPONSORSHIP_PAUSED === 'true') throw new Error('Garage sponsorship is paused. Please try again later.');
}

function gameAccount(): Account {
  const key = process.env.NEAR_GAME_KEY;
  if (!key) throw new Error('NEAR_GAME_KEY not set');
  return new Account(GARAGE, RPC, key as KeyPairString);
}

function dealerKeys(): Record<string, string> {
  try { return JSON.parse(process.env.NEAR_DEALER_KEYS ?? '{}'); } catch { return {}; }
}

const view = <T>(method: string, args: Record<string, unknown> = {}) =>
  new Account(GARAGE, RPC).provider.callFunction({ contractId: GARAGE, method, args }) as Promise<T>;

function panicText(err: unknown): string {
  const t = err instanceof Error ? err.message : String(err);
  const m = t.match(/Smart contract panicked: ([^"\n]+)/);
  return m ? m[1] : t.slice(0, 200);
}

// ───────────────────────── players ─────────────────────────

const KEY = /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/;

function identityDeposit(): bigint {
  assertSponsorship();
  if (process.env.NEAR_AUTH_PROOFS_ENABLED !== 'true' || !GARAGE.endsWith('.testnet')) throw new Error('Ownership verification is not enabled on this server yet');
  const value = process.env.NEAR_AUTH_SIGN_DEPOSIT_YOCTO;
  if (!value || !/^\d{1,23}$/.test(value) || BigInt(value) > 10_000_000_000_000_000_000_000n) throw new Error('Ownership signing budget is not configured');
  return BigInt(value); // Explicit operator configuration, at most 0.01 testnet NEAR per attempt.
}
async function garageOwner(ctx: ActionCtx, account: string): Promise<string> {
  const player = await ctx.runQuery(internal.nearDb.playerByAccount, { account });
  if (!player) throw new Error('Unknown garage');
  const key = await gameAccount().provider.viewAccessKey({ accountId: account, publicKey: player.publicKey, finalityQuery: { finality: 'final' } });
  if (key.permission !== 'FullAccess') throw new Error('Garage ownership key is no longer active');
  return player.publicKey;
}

export const beginIdentityProof = action({
  args: { account: v.string(), identityKey: v.string(), recipient: v.string(), request: v.string(), at: v.number(), signature: v.string() },
  handler: async (ctx, args): Promise<IdentityChallenge> => {
    identityDeposit();
    const allowed = (process.env.NEAR_AUTH_ALLOWED_ORIGINS ?? 'https://minirush.site,http://localhost:3000,http://127.0.0.1:5174,http://localhost:5174').split(',').map(s => s.trim());
    if (!KEY.test(args.identityKey) || !/^[a-zA-Z0-9-]{16,64}$/.test(args.request) || !Number.isSafeInteger(args.at) || Math.abs(Date.now() - args.at) > 60_000 || !allowed.includes(args.recipient)) throw new Error('Invalid ownership check');
    const garageKey = await garageOwner(ctx, args.account);
    const message = identityStartMessage(args.account, args.identityKey, args.recipient, args.request, args.at);
    if (!PublicKey.from(garageKey).verify(new TextEncoder().encode(message), strictBase64(args.signature, 64))) throw new Error('Garage ownership signature did not match');
    const row = await ctx.runMutation(internal.nearDb.issueIdentityProof, { account: args.account, identityKey: args.identityKey,
      recipient: args.recipient, request: args.request, garageKey, nonce: randomBytes(32).toString('base64'), garage: GARAGE });
    return { id: row._id, account: row.account, garageKey: row.garageKey, identityKey: row.identityKey, recipient: row.recipient,
      nonce: row.nonce, message: row.message, expiresAt: row.expiresAt };
  }
});

export const completeIdentityProof = action({
  args: { id: v.id('identityProofs'), garageSignature: v.string(), signingToken: v.optional(v.string()) },
  handler: async (ctx, { id, garageSignature, signingToken }): Promise<IdentityProofResult> => {
    let saved = await ctx.runQuery(internal.nearDb.identityProof, { id });
    if (!saved) return { state: 'failed', message: 'This ownership check is no longer available. Start a new check to verify your link again.' };
    const garageKey = await garageOwner(ctx, saved.account);
    if (garageKey !== saved.garageKey) throw new Error('The garage key has changed');
    const payload = proofBytes(saved);
    verifyIdentitySignature(garageKey, payload, garageSignature);
    const result = (row: typeof saved): IdentityProofResult => ({ state: row!.state === 'verified' ? 'verified' : row!.state === 'failed' ? 'failed' : 'pending',
      message: row!.result ?? 'Checking the original ownership request. Your garage is unchanged.', ...(row!.tx ? { tx: row!.tx } : {}) });
    if (saved.state === 'verified' || saved.state === 'failed') return result(saved);
    const game = gameAccount();
    if (saved.state === 'issued') {
      const deposit = identityDeposit();
      if (saved.expiresAt <= Date.now()) return { state: 'failed', message: 'Ownership check expired. Start a new check.' };
      if (!signingToken) return { state: 'needs_approval', message: 'Approve the ownership message to continue.' };
      let claims: ReturnType<typeof inspectSigningToken>;
      try { claims = inspectSigningToken(signingToken, payload); } catch { throw new Error('The signing request did not match this ownership check'); }
      const derived = await game.provider.callFunction({ contractId: 'v1.signer-prod.testnet', method: 'derived_public_key',
        args: { path: `${AUTH_GUARD}#${claims.subject}`, predecessor: 'fast-auth.testnet', domain_id: 1 } });
      if (derived !== saved.identityKey) throw new Error('The signed-in identity changed. Start a new ownership check.');
      const signed = await game.createSignedTransaction({ receiverId: 'fast-auth.testnet', actions: [actions.functionCall('sign', {
        guard_id: AUTH_GUARD, verify_payload: signingToken, sign_payload: Array.from(payload), algorithm: 'eddsa'
      }, 300n * TGAS, deposit)] });
      saved = await ctx.runMutation(internal.nearDb.prepareIdentityProof, { id,
        tx: baseEncode(createHash('sha256').update(signed.transaction.encode()).digest()),
        signedTransaction: Buffer.from(signed.encode()).toString('base64'), identityHash: claims.identityHash });
    }
    if (saved.state !== 'pending') return result(saved);
    const pending = result(saved);
    const finish = async (response: Awaited<ReturnType<typeof game.provider.viewTransactionStatus>>): Promise<IdentityProofResult> => {
      const outcome = settledOutcome(response, saved!.tx!);
      if (!outcome) return pending;
      let verified = false;
      if (outcome.state === 'confirmed') {
        try {
          verifyIdentitySignature(saved!.identityKey, payload, mpcSignature(response));
          verified = (await garageOwner(ctx, saved!.account)) === saved!.garageKey;
        } catch { /* A failed/absent/mismatched MPC signature never establishes ownership. */ }
      }
      return result(await ctx.runMutation(internal.nearDb.finishIdentityProof, { id, verified,
        message: 'Ownership could not be verified. Your existing garage is unchanged.' }));
    };
    try {
      const response = await game.provider.viewTransactionStatus({ txHash: saved.tx!, accountId: GARAGE, waitUntil: 'NONE' });
      const settled = await finish(response);
      if (settled.state !== 'pending') return settled;
    } catch { /* Query outages say nothing about whether the original call completed. */ }
    // Operator pause and expiry stop broadcasts; already finalized results can still be checked.
    if (saved.expiresAt <= Date.now()) return result(await ctx.runMutation(internal.nearDb.finishIdentityProof, { id, verified: false, message: 'Ownership check expired. Start a new check.' }));
    if (process.env.NEAR_AUTH_PROOFS_ENABLED !== 'true' || process.env.NEAR_SPONSORSHIP_PAUSED === 'true') return pending;
    try {
      return await finish(await game.provider.sendTransactionUntil(SignedTransaction.decode(Buffer.from(saved.signedTransaction!, 'base64')), 'FINAL'));
    } catch { return pending; }
  }
});

export const createPlayer = action({
  args: { publicKey: v.string() },
  handler: async (ctx, { publicKey }): Promise<{ account: string; welcome: number; created: boolean }> => {
    if (!KEY.test(publicKey)) throw new Error('bad key');
    const had = await ctx.runQuery(internal.nearDb.playerByKey, { publicKey });
    if (had) return { account: had.account, welcome: 0, created: false };
    assertSponsorship();
    // Decode before reserving funds, not just a regex check on a key-shaped string.
    const key = PublicKey.from(publicKey);
    const prefix = 'p' + createHash('sha256').update(publicKey).digest('hex').slice(0, 12);
    const account = `${prefix}.${GARAGE}`;
    const game = gameAccount();
    let saved = await ctx.runQuery(internal.nearDb.creationByKey, { publicKey });
    if (!saved) {
      const signed = await game.createSignedTransaction({ receiverId: account,
        actions: [actions.createAccount(), actions.transfer(PLAYER_NEAR), actions.addFullAccessKey(key)] });
      saved = await ctx.runMutation(internal.nearDb.prepareCreation, { account, publicKey,
        tx: baseEncode(createHash('sha256').update(signed.transaction.encode()).digest()),
        signedTransaction: Buffer.from(signed.encode()).toString('base64') });
    }
    let outcome: ActionResult | null = null;
    try { outcome = settledOutcome(await game.provider.viewTransactionStatus({ txHash: saved.tx, accountId: GARAGE, waitUntil: 'NONE' }), saved.tx); }
    catch { /* Only the same saved transaction may be retried after an outage. */ }
    if (!outcome) {
      await ctx.runMutation(internal.nearDb.reserveBroadcast, { account, kind: 'creation' });
      try { outcome = settledOutcome(await game.provider.sendTransactionUntil(SignedTransaction.decode(Buffer.from(saved.signedTransaction, 'base64')), 'FINAL'), saved.tx); }
      catch { throw new Error('Garage creation is still being checked. Keep this browser data and retry shortly.'); }
    }
    if (outcome?.state !== 'confirmed') throw new Error('Garage creation could not be confirmed. Keep this browser data and contact support.');
    await ctx.runMutation(internal.nearDb.insertPlayer, { account, publicKey });
    return { account, welcome: WELCOME_RUSH, created: true };
  }
});

/**
 * Testnet only: a one-time top-up of test NEAR so a new garage can try a NEAR
 * purchase. One per garage, a daily budget for the whole game, and never from
 * the balance that covers the contract's own storage.
 */
export const testNear = action({
  args: { account: v.string(), at: v.number(), signature: v.string() },
  handler: async (ctx, { account, at, signature }): Promise<{ state: 'sent' | 'already' | 'unavailable'; message: string; tx?: string }> => {
    assertSponsorship();
    const amount = BigInt(Math.round(boundedSetting(process.env.NEAR_TEST_GRANT, 2, 0, 2) * 1000)) * (YOCTO / 1000n);
    if (!GARAGE.endsWith('.testnet') || amount <= 0n) return { state: 'unavailable', message: 'Test NEAR is only offered on testnet.' };
    const player = await ctx.runQuery(internal.nearDb.playerByAccount, { account });
    if (!player) return { state: 'unavailable', message: 'Open your garage first, then try again.' };
    if (!Number.isSafeInteger(at) || Math.abs(Date.now() - at) > 60_000 ||
      !PublicKey.from(player.publicKey).verify(new TextEncoder().encode(grantMessage(account, at)), strictBase64(signature, 64))) throw new Error('Invalid top-up authorization');
    const game = gameAccount();
    const balanceReadStartedAt = Date.now();
    const state = await game.getState();
    const reserve = BigInt(Math.round(boundedSetting(process.env.NEAR_TEST_GRANT_RESERVE, 3, 3, 100) * 1000)) * (YOCTO / 1000n);
    if (BigInt(state.balance.available) < amount + reserve) {
      return { state: 'unavailable', message: 'The test NEAR pool is empty right now. You can send test NEAR to your garage address instead.' };
    }
    const cap = boundedSetting(process.env.NEAR_TEST_GRANT_DAILY, 20, 0, 20);
    if (!Number.isInteger(cap)) throw new Error('Invalid sponsorship configuration');
    const reserved = await ctx.runMutation(internal.nearDb.reserveGrant, { account, amount: amount.toString(), cap,
      availableForGrants: (BigInt(state.balance.available) - reserve).toString(), balanceReadStartedAt });
    if (reserved === 'already') return { state: 'already', message: 'This garage has already received its test NEAR.' };
    if (reserved === 'budget') return { state: 'unavailable', message: 'Today\u2019s test NEAR has all been handed out. Try again tomorrow, or send test NEAR to your garage address.' };
    if (reserved === 'pool') return { state: 'unavailable', message: 'Other top-ups are using the available pool. Check again shortly.' };
    // A grant stays recorded even if the outcome is unclear, so one garage can never be paid twice.
    try {
      const res = await game.signAndSendTransaction({ receiverId: account, waitUntil: 'FINAL', actions: [actions.transfer(amount)] });
      if (settledOutcome(res, res.transaction.hash)?.state !== 'confirmed') throw new Error('Top-up not finalized');
      await ctx.runMutation(internal.nearDb.settleGrant, { account, tx: res.transaction.hash });
      return { state: 'sent', message: 'Test NEAR added to your garage.', tx: res.transaction.hash };
    } catch {
      return { state: 'unavailable', message: 'The top-up may not have arrived. Check your balance in a moment.' };
    }
  }
});

// Retained as an explicit rejection for old clients: browser-selected payouts are disabled.
export const payRace = action({
  args: { account: v.string(), coins: v.number(), nonce: v.number(), signature: v.string() },
  handler: async (): Promise<never> => { throw new Error('Update the game to use race sessions'); }
});

export const beginRace = action({
  args: { account: v.string(), run: v.string(), distance: v.number(), signature: v.string() },
  handler: async (ctx, { account, run, distance, signature }): Promise<string> => {
    const p = await ctx.runQuery(internal.nearDb.playerByAccount, { account });
    const message = `minirush:race:begin:${account}:${run}:${distance}`;
    if (!p || !PublicKey.from(p.publicKey).verify(new TextEncoder().encode(message), Buffer.from(signature, 'base64'))) throw new Error('bad signature');
    return ctx.runMutation(internal.nearDb.beginRace, { account, run, distance });
  }
});
export const raceProgress = action({
  args: { account: v.string(), race: v.id('nearRaces'), progress: v.number(), elapsed: v.number(), finish: v.boolean(),
    place: v.optional(v.number()), signature: v.string() },
  handler: async (ctx, { account, race, progress, elapsed, finish, place, signature }): Promise<{ minted: number; alloy: number; circuit: number; place: number; tx: string } | null> => {
    const p = await ctx.runQuery(internal.nearDb.playerByAccount, { account });
    // The finishing place is part of the signed message, so it cannot be altered in transit.
    const message = `minirush:race:progress:${account}:${race}:${progress}:${elapsed}:${finish}${place === undefined ? '' : `:${place}`}`;
    if (!p || !PublicKey.from(p.publicKey).verify(new TextEncoder().encode(message), Buffer.from(signature, 'base64'))) throw new Error('bad signature');
    const r = await ctx.runMutation(internal.nearDb.raceProgress, { account, race, progress, elapsed, finish, place });
    if (!finish) return null;
    const tier = rewardPlace(r.place);
    let tx = r.tx;
    if (!tx) {
      assertSponsorship();
      await ctx.runMutation(internal.nearDb.reserveBroadcast, { account, kind: 'race' });
      const result = await gameAccount().signAndSendTransaction({ receiverId: GARAGE,
        actions: [actions.functionCall('reward_race', { receiver_id: account, race_id: race, place: tier || null }, 60n * TGAS, 0n)] });
      for (const receipt of result.receipts_outcome) {
        if ('Failure' in (receipt.outcome.status as object)) throw new Error('Race payout failed; retry this claim');
      }
      tx = result.transaction.hash;
      await ctx.runMutation(internal.nearDb.completeRace, { race, tx });
    }
    return { minted: raceRush(tier), alloy: RACE_PAYOUT.alloy, circuit: RACE_PAYOUT.circuit, place: tier, tx };
  }
});

/** What a player may ask the game to pay gas for: these garage calls, nothing else. */
const RELAYABLE: Record<string, bigint> = { buy: 0n, sell_back: 0n, consume: 0n, mt_transfer: 1n,
  craft_component: 0n, install_component: 0n, list_component: 0n, cancel_component: 0n, buy_component: 0n, recycle_component: 0n, fill_component_order: 0n, nft_transfer: 1n,
  // Listing an edition car is free. Buying one carries NEAR and is deliberately absent: a relayed
  // deposit is charged to the relayer, so the player's garage sends those calls itself.
  list_edition_car: 0n, cancel_edition_listing: 0n };

export const relay = action({
  args: { signedDelegate: v.string() },
  // Retired: it had no durable replay journal or off-chain signature checks.
  handler: async (): Promise<never> => { throw new Error('Update the game to use tracked garage actions'); }
});

/** Durable relay for new clients. A timeout never becomes permission to spend again. */
export const relayTracked = action({
  args: { signedDelegate: v.string() },
  handler: async (ctx, { signedDelegate }): Promise<ActionResult> => {
    if (signedDelegate.length > 2732) return { state: 'failed', message: 'This action is too large.' };
    const bytes = Buffer.from(signedDelegate, 'base64');
    if (bytes.length > 2048) return { state: 'failed', message: 'This action is too large.' };
    // Borsh yields the plain schema representation used by the existing relay.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sd: any;
    try { sd = borsh.deserialize(SCHEMA.SignedDelegate, bytes); }
    catch { return { state: 'failed', message: 'This action could not be read.' }; }
    const da = sd.delegateAction;
    const player = await ctx.runQuery(internal.nearDb.playerByAccount, { account: da.senderId });
    const publicKey = PublicKey.from(da.publicKey);
    const signature = sd.signature.ed25519Signature?.data;
    if (!player || publicKey.toString() !== player.publicKey || !signature ||
      !publicKey.verify(createHash('sha256').update(encodeDelegateAction(da)).digest(), Uint8Array.from(signature))) {
      return { state: 'failed', message: 'Please reopen your saved garage before trying again.' };
    }
    if (da.receiverId !== GARAGE || da.actions.length !== 1 || da.actions.some((a: { functionCall?: { methodName: string; deposit: bigint; gas: bigint } }) => {
      const fc = a.functionCall;
      return !fc || !Object.hasOwn(RELAYABLE, fc.methodName) || BigInt(fc.deposit) !== RELAYABLE[fc.methodName] || BigInt(fc.gas) > 80n * TGAS;
    })) return { state: 'failed', message: 'This garage action is not supported.' };
    const digest = createHash('sha256').update(bytes).digest('hex');
    let saved = await ctx.runQuery(internal.nearDb.garageAction, { digest });
    const game = gameAccount();
    if (!saved) {
      assertSponsorship();
      if (requiresShopSignIn(da.actions[0].functionCall.methodName, SIGN_IN_REQUIRED) && !(await ctx.auth.getUserIdentity())) {
        return { state: 'failed', message: 'Sign in to buy cars and parts. Nothing was purchased.' };
      }
      // If the record was pruned, an expired delegate must never be broadcast again.
      const block = await game.provider.viewBlock({ finality: 'final' });
      if (BigInt(da.maxBlockHeight) <= BigInt(block.header.height)) return { state: 'pending', message: 'This older request needs a history check. Keep your browser data and contact support.' };
      if (BigInt(da.maxBlockHeight) > BigInt(block.header.height) + 1200n) return { state: 'failed', message: 'This request has an unsupported expiry. Reopen the game and try again.' };
      const signed = await game.createSignedTransaction({ receiverId: da.senderId,
        actions: [actions.signedDelegate({ delegateAction: da, signature: sd.signature })] });
      const tx = baseEncode(createHash('sha256').update(signed.transaction.encode()).digest());
      saved = await ctx.runMutation(internal.nearDb.prepareGarageAction, { digest, account: da.senderId, tx,
        signedTransaction: Buffer.from(signed.encode()).toString('base64') });
    }
    if (saved.result && saved.state !== 'pending') return JSON.parse(saved.result) as ActionResult;
    const pending: ActionResult = { state: 'pending', tx: saved.tx };
    const finish = async (response: Awaited<ReturnType<typeof game.provider.viewTransactionStatus>>): Promise<ActionResult> => {
      const result = settledOutcome(response, saved!.tx);
      if (!result) return pending;
      if (result.state === 'confirmed') {
        const raw = [...response.receipts_outcome].reverse().map(r => (r.outcome.status as { SuccessValue?: string }).SuccessValue).find(Boolean);
        try { result.value = raw ? JSON.parse(Buffer.from(raw, 'base64').toString()) : null; } catch { result.value = null; }
      }
      await ctx.runMutation(internal.nearDb.finishGarageAction, { digest, state: result.state as 'confirmed' | 'failed', result: JSON.stringify(result) });
      return result;
    };
    try {
      const status = await game.provider.viewTransactionStatus({ txHash: saved.tx, accountId: GARAGE, waitUntil: 'NONE' });
      const result = await finish(status);
      if (result.state !== 'pending') return result;
    } catch { /* Unknown or unavailable: only the exact saved transaction may be resent. */ }
    assertSponsorship();
    await ctx.runMutation(internal.nearDb.reserveBroadcast, { account: da.senderId, kind: 'relay' });
    try {
      return await finish(await game.provider.sendTransactionUntil(SignedTransaction.decode(Buffer.from(saved.signedTransaction, 'base64')), 'FINAL'));
    } catch {
      // Invalid nonce can mean the first broadcast succeeded. Preserve the original hash.
      return pending;
    }
  }
});

// ───────────────────────── dealer agents ─────────────────────────

interface ListingView {
  token_id: string; kind: string; name: string; dealer: string;
  price: string; stock: number; sold: number; reason: string; updated_ms: number;
}

/** List prices from the game's original coin economy: the anchor every dealer prices around. */
const BASE: Record<string, number> = {
  'car:sunburst': 300, 'car:gecko': 250, 'car:phantom': 400, 'car:volt': 350, 'car:juggernaut': 500,
  'car:sidewinder': 450, 'car:glasscannon': 600, 'car:r8': 2000, 'car:sesto': 2200, 'car:aventador': 2500,
  'car:divo': 2600, 'car:tourbillon': 3000, 'car:stockcar': 1200, 'part:nitro-can': 40
};

const PERSONA: Record<string, string> = {
  'mama-t': 'Mama T runs the Ladipo scrapyard stall in Lagos. Warm, shrewd, loves a quick sale; she would rather move metal than sit on it, and she cuts prices when a car has been gathering dust.',
  'oga-motors': 'Oga Motors sells hypercars from a glass showroom on the Island. Proud, prestige-minded; scarcity is his whole business. He raises prices the moment something sells and almost never discounts below list.',
  'tuner-ade': 'Tuner Ade runs a tuning bay. A numbers person: he prices nitro cans off how many people are racing right now, and keeps the stock car fair for regulars.'
};

interface Decision { token: string; price: number; reason: string; restock?: number }

function bounds(token: string, old: number, dealer: string): [number, number] {
  const base = BASE[token] ?? old;
  const floor = dealer === 'oga-motors' ? base * 0.9 : base * 0.6;
  const lo = Math.max(floor, old * 0.75), hi = Math.min(base * 2, old * 1.25);
  return [Math.ceil(lo), Math.floor(Math.max(lo, hi))];
}

function ruleDecisions(dealer: string, stalls: (ListingView & { soldSince: number; idleTicks: number })[], racers: number): Decision[] {
  return stalls.map((l) => {
    const old = Number(l.price), base = BASE[l.token_id] ?? old;
    let price = old, reason = '';
    if (l.stock === 0) {
      price = old * 1.08; reason = `Sold out — restocking 3 at a premium.`;
      return { token: l.token_id, price: Math.round(price), reason, restock: 3 };
    }
    if (l.token_id === 'part:nitro-can') {
      price = base * (1 + Math.min(racers, 20) * 0.03);
      reason = `${racers} driver${racers === 1 ? '' : 's'} raced in the last hour; nitro priced to the traffic.`;
    } else if (l.soldSince >= 2) {
      price = old * 1.12; reason = `${l.soldSince} sold since my last look — demand is up.`;
    } else if (l.soldSince === 1) {
      price = old * 1.05; reason = `One went this round; nudging it up.`;
    } else if (dealer === 'mama-t' && l.idleTicks >= 3) {
      price = old * 0.9; reason = `Nobody has bitten for a while — making it sweet.`;
    } else if (old > base) {
      price = old * 0.96; reason = `Quiet stall; easing back toward list.`;
    } else {
      return { token: l.token_id, price: old, reason: l.reason };
    }
    return { token: l.token_id, price: Math.round(price), reason };
  });
}

async function llmDecisions(dealer: string, stalls: (ListingView & { soldSince: number; idleTicks: number })[], racers: number): Promise<Decision[] | null> {
  const url = process.env.DEALER_LLM_URL, key = process.env.DEALER_LLM_KEY, model = process.env.DEALER_LLM_MODEL;
  if (!url || !key || !model) return null;
  const facts = stalls.map((l) => ({
    token: l.token_id, name: l.name, price: Number(l.price), list_price: BASE[l.token_id],
    stock: l.stock, sold_total: l.sold, sold_since_last_look: l.soldSince, idle_looks: l.idleTicks
  }));
  const prompt = `${PERSONA[dealer]}\n\nYou reprice your stall every 15 minutes in the MiniRush racing game. ` +
    `Players pay in RUSH coins they earn racing. Drivers active in the last hour: ${racers}.\n` +
    `Your stall:\n${JSON.stringify(facts)}\n\n` +
    `Return JSON only: {"decisions":[{"token":"…","price":integer,"reason":"…","restock":integer|0}]}. ` +
    `One entry per stall. Move each price at most 25% from its current price. Restock (1-5) only when stock is 0. ` +
    `The reason is shown to players next to the price: one sentence, under 140 characters, in your own voice, citing the numbers you used.`;
  try {
    const res = await fetch(url.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.6, response_format: { type: 'json_object' } }),
      signal: AbortSignal.timeout(25_000)
    });
    if (!res.ok) return null;
    const body = await res.json() as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { decisions?: Decision[] };
    const known = new Set(stalls.map((s) => s.token_id));
    const out = (parsed.decisions ?? []).filter((d) => known.has(d.token) && Number.isFinite(d.price) && typeof d.reason === 'string');
    return out.length ? out : null;
  } catch {
    return null;
  }
}

export const dealerTick = internalAction({
  args: {},
  handler: async (ctx): Promise<string> => {
    if (process.env.NEAR_SPONSORSHIP_PAUSED === 'true') return 'Economy automation paused';
    if (process.env.NEAR_DEALER_AGENTS_ENABLED === 'false') return 'Dealer agents disabled on this deployment';
    const listings = await view<ListingView[]>('listings');
    const racers: number = await ctx.runQuery(internal.nearDb.recentRacers, {});
    const keys = dealerKeys();
    const report: string[] = [];
    for (const [account, key] of Object.entries(keys)) {
      const dealer = account.split('.')[0];
      const mine = listings.filter((l) => l.dealer === account);
      if (!mine.length) continue;
      const stalls = [];
      for (const l of mine) {
        const prev = await ctx.runQuery(internal.nearDb.lastMove, { token: l.token_id });
        const soldSince = prev ? Math.max(0, l.sold - prev.sold) : 0;
        const idleTicks = soldSince > 0 ? 0 : (prev && prev.soldSince === 0 ? 2 : 0) + 1;
        stalls.push({ ...l, soldSince, idleTicks });
      }
      const llm = await llmDecisions(dealer, stalls, racers);
      const decisions = llm ?? ruleDecisions(dealer, stalls, racers);
      const by = llm ? (process.env.DEALER_LLM_MODEL ?? 'llm') : 'rules';

      const acts = [];
      const moves = [];
      for (const d of decisions) {
        const l = stalls.find((s) => s.token_id === d.token)!;
        const old = Number(l.price);
        const [lo, hi] = bounds(d.token, old, dealer);
        const price = Math.min(hi, Math.max(lo, Math.round(d.price)));
        const reason = d.reason.replace(/\s+/g, ' ').trim().slice(0, 200);
        if (l.stock === 0 && d.restock) {
          acts.push(actions.functionCall('dealer_restock', { token_id: d.token, add: Math.min(5, Math.max(1, Math.floor(d.restock))) }, 20n * TGAS, 0n));
        }
        if (price !== old || reason !== l.reason) {
          acts.push(actions.functionCall('dealer_set_price', { token_id: d.token, price: String(price), reason }, 20n * TGAS, 0n));
        }
        moves.push({ dealer: account, token: d.token, oldPrice: old, price, sold: l.sold, soldSince: l.soldSince, reason, by });
      }
      let tx: string | undefined;
      if (acts.length) {
        const res = await new Account(account, RPC, key as KeyPairString).signAndSendTransaction({ receiverId: GARAGE, actions: acts });
        tx = res.transaction.hash;
      }
      await ctx.runMutation(internal.nearDb.recordMoves, { moves: moves.map((m) => ({ ...m, tx })) });
      report.push(`${dealer}: ${acts.length} changes by ${by}`);
    }
    // These actions use the same dealer keys. Run them after repricing so the
    // scheduled jobs do not race one another for account access-key nonces.
    try { report.push(await ctx.runAction(internal.near.componentDealerTick, {})); }
    catch (err) { report.push(`component buyers: ${panicText(err)}`); }
    return report.join('; ');
  }
});

// Separate from legacy car restocks: components are sourced only from players.
// A live order keeps its quoted terms until filled or expired; ticks never withdraw it early.
export const componentDealerTick = internalAction({
  args: {},
  handler: async (): Promise<string> => {
    if (process.env.NEAR_SPONSORSHIP_PAUSED === 'true') return 'Economy automation paused';
    if (process.env.NEAR_DEALER_AGENTS_ENABLED === 'false') return 'Dealer agents disabled on this deployment';
    const [recipes, dealers] = await Promise.all([view<OrderRecipe[]>('component_recipes'), view<string[]>('dealers')]);
    const report: string[] = [];
    for (const [account, key] of Object.entries(dealerKeys())) {
      if (!dealers.includes(account)) continue;
      try {
        const signer = new Account(account, RPC, key as KeyPairString);
        const send = async (method: string, args: Record<string, unknown>) => {
          const result = await signer.signAndSendTransaction({ receiverId: GARAGE,
            actions: [actions.functionCall(method, args, 60n * TGAS, 0n)] });
          for (const receipt of result.receipts_outcome) {
            if ((receipt.outcome.status as { Failure?: unknown }).Failure) throw new Error('Dealer transaction failed');
          }
        };
        const [inventory, initialFunds, orders] = await Promise.all([
          view<DealerPart[]>('component_inventory', { account_id: account }),
          view<{ available: string; reserved: string }>('dealer_order_funds', { account_id: account }),
          view<ComponentOrder[]>('component_orders')
        ]);
        let funds = initialFunds;
        const liveReserved = orders.filter(o => o.dealer === account).reduce((sum,o) => sum + BigInt(o.price) * BigInt(o.remaining), 0n);
        if (BigInt(funds.reserved) > liveReserved) {
          await send('expire_component_orders', {});
          funds = await view<typeof funds>('dealer_order_funds', { account_id: account });
        }
        const plan = dealerOrderPlan(account, recipes, inventory, Number(funds.available));
        // Separate transactions prevent one concurrently sold listing blocking other stock.
        for (const listing of plan.listings.slice(0, 12)) {
          try { await send('list_component', listing); } catch { report.push(`${account}: listing changed; retry next tick`); }
        }
        if (plan.order && !orders.some(o => o.dealer === account)) {
          await send('place_component_order', { ...plan.order, expires_ms: Date.now() + 60 * 60 * 1000, replace_revision: null });
          report.push(`${account}: buying ${plan.order.quantity} ${plan.order.recipe_id}`);
        } else report.push(`${account}: existing order, sufficient stock or insufficient budget`);
      } catch (err) { report.push(`${account}: ${panicText(err)}`); }
    }
    return report.join('; ');
  }
});
