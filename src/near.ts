/**
 * The player's NEAR side (testnet), kept invisible: on first launch the phone
 * makes a key, the game's backend creates `p….minirush-garage.testnet` for it
 * and eligible race sessions earn salvage plus RUSH from a fixed table by finishing place.
 * Ordinary trading uses sponsored meta-transactions; numbered editions are
 * paid directly from the garage's test NEAR. Keys stay in browser storage and
 * can be backed up to a password-encrypted recovery file.
 *
 * near-api-js is loaded on first use so it never weighs on the race bundle.
 * Everything fails soft: offline or without Convex the game plays as before.
 */
import { syncChainCars, syncEditionModels } from './economy';
import { setComponentInventory, type Component } from './components';
import { rewardPlace } from '../shared/raceRules';
import { ACTIONS_KEY, ActionJournal, type SavedAction, type ActionResult } from '../shared/garageRecovery';
import { identityStartMessage, identityMessage, identityPayload, IDENTITY_TTL, type IdentityChallenge } from '../shared/identityProof';
import { requiresShopSignIn } from '../shared/shopPolicy';
import { PAID_CALL_TGAS, spendableNear, type Edition, type EditionCar } from '../shared/editions';
import { openShopSignIn, SIGN_IN_REQUIRED } from './shopSession';
import { CREDENTIALS_KEY, LEGACY_KEY, LEGACY_ACCOUNT, readCredentials, credentialSnapshot, commitCredentials } from '../shared/garageCredentials';
import type { GarageBackup } from '../shared/garageBackup';

export const GARAGE = (import.meta.env.VITE_NEAR_GARAGE as string | undefined) ?? 'minirush-garage.testnet';
const RPC = (import.meta.env.VITE_NEAR_RPC as string | undefined) ?? 'https://test.rpc.fastnear.com';
const CONVEX_URL = (import.meta.env.VITE_CONVEX_URL as string | undefined)?.trim().replace(/\/+$/, '');
const KEY_STORE = LEGACY_KEY;
const ACCOUNT_STORE = LEGACY_ACCOUNT;
const TGAS = 1_000_000_000_000n;

export const explorerTx = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;
export const explorerAccount = (id: string) => `https://testnet.nearblocks.io/address/${id}`;

export interface Listing {
  token_id: string; kind: string; name: string; dealer: string;
  price: string; stock: number; sold: number; reason: string; updated_ms: number;
}
export interface Holding { token_id: string; balance: string }
export interface DealerMove { dealer: string; token: string; oldPrice: number; price: number; reason: string; by: string; tx?: string; at: number }

type Near = typeof import('near-api-js');
let lib: Promise<Near> | null = null;
const near = () => {
  // a few of near-api-js's dependencies read Node's `process`; give them a stub
  const g = globalThis as unknown as { process?: unknown };
  g.process ??= { env: {}, nextTick: (f: (...a: unknown[]) => void, ...a: unknown[]) => queueMicrotask(() => f(...a)) };
  return (lib ??= import('near-api-js'));
};

const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export const nearEnabled = (): boolean => !!CONVEX_URL;
export const nearAccount = (): string | null => {
  try { return readCredentials(localStorage).account; } catch { return null; }
};
const actionScope = () => `${RPC}|${GARAGE}|${nearAccount() ?? ''}`;
const actionJournal = new ActionJournal({ getItem: k => localStorage.getItem(k), setItem: (k,v) => localStorage.setItem(k,v) });
export const garageActivity = (): SavedAction[] => actionJournal.list(actionScope()).slice().reverse();
export function hasPendingAction(): boolean {
  try { return !!actionJournal.pending(actionScope()); } catch { return true; }
}
const actionFlights = new Map<string, Promise<SavedAction>>();
const actionChanged = (action: SavedAction) => window.dispatchEvent(new CustomEvent('minirush:garage-action', { detail: action }));
async function resumeAction(action: SavedAction, loginCredential?: string): Promise<SavedAction> {
  const flight = actionFlights.get(action.id); if (flight) return flight;
  const task = (async () => {
    let result: ActionResult;
    try {
      const credential = loginCredential ?? (requiresShopSignIn(action.method, SIGN_IN_REQUIRED) ? await (await import('./nearAuth')).loginToken().catch(() => null) : null);
      result = await convex<ActionResult>('action', 'near:relayTracked', { signedDelegate: action.signedDelegate }, 45_000, credential ?? undefined);
    }
    catch { return action; } // A transport failure says nothing about whether payment completed.
    const updated = actionJournal.settle(action, result);
    if (updated.scope === actionScope()) actionChanged(updated);
    return updated;
  })().finally(() => actionFlights.delete(action.id));
  actionFlights.set(action.id, task); return task;
}
export async function recoverGarageAction(): Promise<void> {
  const pending = actionJournal.pending(actionScope());
  if (!pending) return;
  const result = await resumeAction(pending);
  if (result.result.state === 'confirmed' && result.scope === actionScope()) {
    await Promise.allSettled([holdings().then(syncCars), refreshComponents(false)]);
    window.dispatchEvent(new Event('minirush:garage-updated'));
  }
}

export async function convex<T>(kind: 'query' | 'action', path: string, args: unknown, timeoutMs = 30_000, loginCredential?: string): Promise<T> {
  if (!CONVEX_URL) throw new Error('offline');
  const res = await fetch(`${CONVEX_URL}/api/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(loginCredential ? { Authorization: `Bearer ${loginCredential}` } : {}) },
    body: JSON.stringify({ path, args, format: 'json' }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const body = (await res.json()) as { status?: string; value?: T; errorMessage?: string };
  if (body.status !== 'success') {
    const msg = (body.errorMessage ?? 'failed').replace(/^.*Uncaught Error: /s, '').split('\n')[0];
    throw new Error(msg);
  }
  return body.value as T;
}

async function keyPair() {
  const { KeyPair } = await near();
  const stored = readCredentials(localStorage);
  let k = stored.secretKey;
  if (!k && stored.account) throw new Error('This browser no longer has access to your saved garage. Use Restore garage with a recovery file you saved earlier.');
  if (!k) { k = KeyPair.fromRandom('ed25519').toString(); localStorage.setItem(KEY_STORE, k); }
  return KeyPair.fromString(k as `ed25519:${string}`);
}

let ensuring: Promise<string | null> | null = null;

/** The player's account, creating it on first call. Null when the backend is unreachable. */
export function ensureAccount(): Promise<string | null> {
  const have = nearAccount();
  if (have) return Promise.resolve(have);
  if (!nearEnabled()) return Promise.resolve(null);
  ensuring ??= (async () => {
    try {
      const kp = await keyPair();
      const expected = credentialSnapshot(localStorage);
      const { account } = await convex<{ account: string }>('action', 'near:createPlayer', { publicKey: kp.getPublicKey().toString() }, 45_000);
      // A restore or another tab may have completed while account creation ran.
      if (credentialSnapshot(localStorage) !== expected) return nearAccount();
      write(ACCOUNT_STORE, account);
      return account;
    } catch {
      return null;
    } finally {
      ensuring = null;
    }
  })();
  return ensuring;
}

export async function viewCall<T>(method: string, args: Record<string, unknown>): Promise<T> {
  const encoded = new TextEncoder().encode(JSON.stringify(args));
  let raw = '';
  for (const byte of encoded) raw += String.fromCharCode(byte);
  const response = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000), body: JSON.stringify({ jsonrpc: '2.0', id: 'minirush-view', method: 'query',
      params: { request_type: 'call_function', finality: 'final', account_id: GARAGE, method_name: method, args_base64: btoa(raw) } }) });
  if (!response.ok) throw new Error('NEAR connection unavailable');
  const body = await response.json() as { result?: { result: number[] }; error?: { message: string } };
  if (body.error || !body.result) throw new Error(body.error?.message ?? 'NEAR view failed');
  return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result))) as T;
}

export const listings = () => viewCall<Listing[]>('listings', {});
export async function holdings(): Promise<Holding[]> {
  const acc = nearAccount();
  return acc ? viewCall<Holding[]>('mt_tokens_for_owner', { account_id: acc }) : [];
}
export const dealerLog = (limit = 40) => convex<DealerMove[]>('query', 'nearDb:dealerLog', { limit }, 8000);

/** Cars held on chain become drivable in the garage. */
export function syncCars(h: Holding[]): void {
  syncChainCars(h.filter(x => x.token_id.startsWith('car:') && BigInt(x.balance) > 0n).map(x => x.token_id.slice(4)));
}

/** Sign a garage call and have the game relay it (the game pays gas). */
let signingAction = false;
let garageWrite = false;
async function withGarageWrite<T>(work: () => Promise<T>): Promise<T> {
  if (garageWrite) throw new Error('A garage action is completing. Please wait before trying again.');
  garageWrite = true;
  try {
    if (navigator.locks) return await navigator.locks.request('minirush-garage-write', { ifAvailable:true }, lock => {
      if (!lock) throw new Error('A garage action is completing in another tab.');
      return work();
    });
    return await work();
  } finally { garageWrite = false; }
}
export async function relayed(method: string, args: Record<string, unknown>, deposit = 0n): Promise<{ tx: string; value: unknown }> {
  const credential = requiresShopSignIn(method, SIGN_IN_REQUIRED) ? await (await import('./nearAuth')).loginToken().catch(() => null) : null;
  if (requiresShopSignIn(method, SIGN_IN_REQUIRED) && !credential) { openShopSignIn(); throw new Error('Sign in to buy cars and parts. Guest racing is always available.'); }
  if (signingAction || hasPendingAction()) throw new Error('Your previous action is still completing. Check Activity for its progress.');
  const run = async (): Promise<{ tx: string; value: unknown }> => {
    signingAction = true;
    try {
      const account = await ensureAccount();
      if (!account) throw new Error('Your garage is unavailable right now. Please reconnect.');
      if (hasPendingAction()) throw new Error('Your previous action is still completing. Check Activity for its progress.');
      const n = await near();
      const kp = await keyPair();
      const me = new n.Account(account, RPC, kp.toString() as `ed25519:${string}`);
      const { signedDelegate } = await me.createSignedMetaTransaction({
        receiverId: GARAGE,
        actions: [n.actions.functionCall(method, args, 70n * TGAS, deposit)]
      });
      const bytes = n.encodeSignedDelegate(signedDelegate);
      let b64 = '';
      for (const byte of bytes) b64 += String.fromCharCode(byte);
      const action: SavedAction = { id: crypto.randomUUID(), scope: actionScope(), method, args,
        signedDelegate: btoa(b64), createdAt: Date.now(), result: { state: 'pending' } };
      try { actionJournal.begin(action); }
      catch (err) { throw new Error(err instanceof Error && /previous|history/.test(err.message) ? err.message : 'Allow browser storage before making a purchase. Nothing was sent.'); }
      actionChanged(action);
      const saved = await resumeAction(action, credential ?? undefined);
      if (saved.result.state === 'confirmed' && saved.result.tx) return { tx: saved.result.tx, value: saved.result.value };
      if (saved.result.state === 'failed') throw new Error(saved.result.message ?? 'This action could not be completed.');
      throw new Error('Your action is still completing. You can keep browsing; check Activity for its progress.');
    } finally { signingAction = false; }
  };
  return withGarageWrite(run);
}

// ── Limited editions: numbered cars bought and resold for NEAR ──

export interface EditionDesk { editions: Edition[]; asks: EditionCar[]; mine: EditionCar[] }
/** Every edition, the cars players are selling, and this garage's own. Empty on a contract without editions. */
export async function editionDesk(): Promise<EditionDesk> {
  const acc = nearAccount();
  const [editions, asks, mine] = await Promise.all([
    viewCall<Edition[]>('editions', {}),
    viewCall<EditionCar[]>('edition_asks', { limit: 100 }),
    acc ? viewCall<EditionCar[]>('edition_garage', { account_id: acc }) : Promise.resolve([])
  ]);
  syncEditionModels([...new Set(mine.flatMap(c => editions.find(e => e.id === c.edition_id)?.model ?? []))]);
  return { editions, asks, mine };
}
/** NEAR this garage can put towards a price, in yoctoNEAR, after its storage and the network-fee reserve. */
export async function nearSpendable(): Promise<bigint> {
  const acc = nearAccount();
  if (!acc) return 0n;
  const response = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000), body: JSON.stringify({ jsonrpc: '2.0', id: 'minirush-account', method: 'query',
      params: { request_type: 'view_account', finality: 'final', account_id: acc } }) });
  const body = await response.json() as { result?: { amount: string; storage_usage: number } };
  if (!response.ok || !body.result) throw new Error('Balance unavailable');
  return spendableNear(body.result.amount, body.result.storage_usage);
}
/**
 * A garage call that carries NEAR, sent by the garage itself. It is never relayed:
 * a relayer is charged the deposit of a call it forwards, so the game would be
 * paying. The garage pays the price and a network fee of well under 0.01 NEAR,
 * and must hold FEE_RESERVE_YOCTO spare while the call runs.
 */
async function paid<T>(method: string, args: Record<string, unknown>, deposit: bigint): Promise<T> {
  return withGarageWrite(() => sendPaid<T>(method, args, deposit));
}
async function sendPaid<T>(method: string, args: Record<string, unknown>, deposit: bigint): Promise<T> {
  if (signingAction || hasPendingAction()) throw new Error('Your previous action is still completing. Check Activity for its progress.');
  signingAction = true;
  try {
    const account = await ensureAccount();
    if (!account) throw new Error('Your garage is unavailable right now. Please reconnect.');
    const n = await near();
    const me = new n.Account(account, RPC, (await keyPair()).toString() as `ed25519:${string}`);
    // Inventory and balance reads use final blocks. Wait for the purchase's
    // receipts to finalize before refreshing, or the view can still show no car.
    const sent = await me.signAndSendTransaction({ receiverId: GARAGE, waitUntil: 'FINAL', actions: [n.actions.functionCall(method, args, PAID_CALL_TGAS * TGAS, deposit)] });
    const failure = sent.receipts_outcome.map(r => (r.outcome.status as { Failure?: unknown }).Failure).find(Boolean);
    if (failure) throw new Error(JSON.stringify(failure));
    const raw = [...sent.receipts_outcome].reverse().map(r => (r.outcome.status as { SuccessValue?: string }).SuccessValue).find(Boolean);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(raw ?? ''), c => c.charCodeAt(0)))) as T;
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    const panic = /Smart contract panicked: ([^"\\]+)/.exec(text)?.[1];
    if (panic) throw new Error(/sold out/.test(panic) ? 'That car has just sold out.' : /listing changed|not listed|price went up/.test(panic) ? 'That price has changed. Refresh and try again.' : `The purchase was not completed: ${panic}.`);
    if (/balance/i.test(text)) throw new Error('Your garage needs a little more NEAR to cover the price and the network fee.');
    if (/previous action|garage is unavailable/.test(text)) throw err;
    throw new Error('The purchase could not be confirmed. Refresh to see whether the car arrived before trying again.');
  } finally { signingAction = false; }
}
/** Buy the next numbered car of an edition from the game, paying `price` yoctoNEAR from this garage. */
export const buyEdition = (editionId: string, price: string) =>
  paid<EditionCar>('buy_edition', { edition_id: editionId, max_price: price }, BigInt(price));
/** Buy a car another player is selling. The seller is paid in the same transaction. */
export async function buyEditionCar(car: EditionCar): Promise<EditionCar> {
  if (!car.price) throw new Error('This car is no longer for sale.');
  return paid<EditionCar>('buy_edition_car', { car_id: car.id, offer: car.offer, max_price: car.price }, BigInt(car.price));
}
export const listEditionCar = (carId: string, price: bigint) => relayed('list_edition_car', { car_id: carId, price: price.toString() });
export const cancelEditionListing = (carId: string) => relayed('cancel_edition_listing', { car_id: carId });
/** Testnet only: a one-time top-up so a new garage can try a NEAR purchase. */
export async function requestTestNear(): Promise<{ state: 'sent' | 'already' | 'unavailable'; message: string; tx?: string }> {
  return withGarageWrite(sendTestNear);
}
async function sendTestNear(): Promise<{ state: 'sent' | 'already' | 'unavailable'; message: string; tx?: string }> {
  const account = await ensureAccount();
  if (!account) return { state: 'unavailable', message: 'Your garage is unavailable right now. Please reconnect.' };
  const at = Date.now();
  const { grantMessage } = await import('../shared/sponsorPolicy');
  const signature = await signMessage(grantMessage(account, at));
  return convex('action', 'near:testNear', { account, at, signature }, 45_000);
}
export const onTestnet = GARAGE.endsWith('.testnet');

export async function currentGarageBackup(): Promise<GarageBackup> {
  const { KeyPair } = await near();
  const stored = readCredentials(localStorage);
  if (!stored.account || !stored.secretKey) throw new Error('Your garage key is not available. Reconnect, or restore a file saved earlier.');
  let publicKey: string;
  try { publicKey = KeyPair.fromString(stored.secretKey as `ed25519:${string}`).getPublicKey().toString(); }
  catch { throw new Error('This browser cannot read your garage key. Restore a file saved earlier.'); }
  return { account:stored.account, secretKey:stored.secretKey, publicKey, network:'testnet', garage:GARAGE, createdAt:new Date().toISOString() };
}

/** Recovery only checks the configured RPC. No transaction or secret is sent. */
export async function verifyRecoveryAccess(saved: GarageBackup): Promise<void> {
  if (!onTestnet || saved.network !== 'testnet' || saved.garage !== GARAGE || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(saved.account) || saved.account.length > 64) throw new Error('This recovery file belongs to another game or network.');
  const { KeyPair } = await near();
  let publicKey: string;
  try {
    const key = KeyPair.fromString(saved.secretKey as `ed25519:${string}`);
    publicKey = key.getPublicKey().toString();
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    if (publicKey !== saved.publicKey || !key.verify(challenge, key.sign(challenge).signature)) throw new Error();
  } catch { throw new Error('The recovery file contains an invalid garage key.'); }
  let body: { result?: { permission?: unknown }; error?: unknown };
  try {
    const response = await fetch(RPC, { method:'POST', headers:{'Content-Type':'application/json'}, signal:AbortSignal.timeout(12_000),
      body:JSON.stringify({ jsonrpc:'2.0', id:'minirush-recovery-check', method:'query', params:{ request_type:'view_access_key', finality:'final', account_id:saved.account, public_key:publicKey } }) });
    if (!response.ok) throw new Error();
    body = await response.json();
  } catch { throw new Error('Could not check garage ownership. Reconnect and try again; nothing was switched.'); }
  if (body.error || body.result?.permission !== 'FullAccess') throw new Error('This key no longer has full access to that garage, or the account is unavailable. Nothing was switched.');
}

/** Wait for automatic onboarding before capturing the account being replaced. */
export async function waitForGarageCreation(): Promise<void> { if (ensuring) await ensuring; }

export async function restoreSavedGarage(saved: GarageBackup, expected: string): Promise<void> {
  // Web Locks serialize this final check and commit with purchases across tabs.
  // Fail closed on older browsers rather than risk switching during a payment.
  if (!navigator.locks) throw new Error('Restore needs a browser with Web Locks support. Use a current Chrome, Safari or Firefox browser.');
  await withGarageWrite(async () => {
    await waitForGarageCreation();
    const idle = () => {
      const state = (window as unknown as { __game?: { state:string } }).__game?.state;
      if (state && state !== 'menu') throw new Error('Return to the home screen before restoring your garage.');
      const switching = nearAccount() !== saved.account;
      if (signingAction || actionFlights.size || rewardFlights.size || (switching && (hasPendingAction() || hasPendingReward()))) throw new Error('Let your current purchases and race rewards finish before switching garages. Check Activity.');
      if (credentialSnapshot(localStorage) !== expected) throw new Error('Your active garage changed. Check the recovery file again.');
    };
    idle();
    await verifyRecoveryAccess(saved); // Key may have been revoked since preview.
    idle();
    try { commitCredentials(localStorage, expected, { account:saved.account, secretKey:saved.secretKey }); }
    catch { throw new Error('Browser storage could not save the restored garage. Your current garage is unchanged. Allow storage and check the file again.'); }
    // A reload is required so all in-memory cars, parts and UI belong to this account.
  });
}

export async function buy(tokenId: string, maxPrice: string): Promise<string> {
  const { tx } = await relayed('buy', { token_id: tokenId, max_price: maxPrice });
  // A balance-read outage cannot turn an already confirmed purchase into a failure.
  if (tokenId.startsWith('car:')) { try { syncCars(await holdings()); } catch { /* Refresh will restore the confirmed car. */ } }
  return tx;
}

export async function sellBack(tokenId: string, minPayout: string): Promise<string> {
  return (await relayed('sell_back', { token_id: tokenId, min_payout: minPayout })).tx;
}

/** Burn one nitro can as a race starts. Resolves false when there is none to burn. */
export async function useNitroCan(): Promise<boolean> {
  try {
    const h = await holdings();
    if (!h.some((x) => x.token_id === 'part:nitro-can' && Number(x.balance) > 0)) return false;
    await relayed('consume', { token_id: 'part:nitro-can' });
    return true;
  } catch {
    return false;
  }
}


export async function refreshComponents(createAccount = true): Promise<Component[]> {
  const account = createAccount ? await ensureAccount() : nearAccount();
  if (!account) { setComponentInventory(null, []); return []; }
  try {
    const parts = await viewCall<Component[]>('component_inventory', { account_id: account });
    setComponentInventory(account, parts);
    return parts;
  } catch (err) { setComponentInventory(null, []); throw err; }
}

async function signMessage(message: string): Promise<string> {
  const signature = (await keyPair()).sign(new TextEncoder().encode(message)).signature;
  let raw = '';
  for (const byte of signature) raw += String.fromCharCode(byte);
  return btoa(raw);
}

export async function beginGarageIdentity(identityKey: string): Promise<IdentityChallenge> {
  const account = nearAccount();
  if (!account) throw new Error('Open your garage before verifying ownership.');
  const recipient = location.origin, request = crypto.randomUUID(), at = Date.now();
  const signature = await signMessage(identityStartMessage(account, identityKey, recipient, request, at));
  return convex('action', 'near:beginIdentityProof', { account, identityKey, recipient, request, at, signature });
}
export async function signGarageIdentity(challenge: IdentityChallenge): Promise<string> {
  const key = await keyPair();
  if (challenge.account !== nearAccount() || challenge.garageKey !== key.getPublicKey().toString() || challenge.recipient !== location.origin ||
    challenge.expiresAt <= Date.now() || challenge.expiresAt > Date.now() + IDENTITY_TTL + 5000 ||
    challenge.message !== identityMessage(challenge.account, challenge.garageKey, challenge.identityKey, GARAGE, challenge.expiresAt)) throw new Error('Ownership check does not match this garage.');
  const nonce = Uint8Array.from(atob(challenge.nonce), c => c.charCodeAt(0));
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(identityPayload(challenge.message, challenge.recipient, nonce)));
  const signature = key.sign(new Uint8Array(digest)).signature;
  return btoa(Array.from(signature, b => String.fromCharCode(b)).join(''));
}
export interface Reward { minted: number; alloy: number; circuit: number; tx: string; place?: number; race?: string }
interface Claim { account: string; race: string; progress: number; elapsed: number; place?: number }
const PENDING = 'minirush.near.pending-races.v2';
function pendingClaims(): Claim[] {
  try { const raw = JSON.parse(read(PENDING) ?? '[]'); return Array.isArray(raw) ? raw : []; } catch { return []; }
}
export function hasPendingReward(): boolean { return pendingClaims().some(c => c.account === nearAccount()); }
async function progressCall(claim: Claim, finish: boolean): Promise<Reward | null> {
  const { account, race, progress, elapsed } = claim;
  // Checkpoints never carry a place; the finish signs the podium tier it claims.
  const place = finish ? rewardPlace(claim.place) : undefined;
  const signature = await signMessage(`minirush:race:progress:${account}:${race}:${progress}:${elapsed}:${finish}${place === undefined ? '' : `:${place}`}`);
  return convex('action', 'near:raceProgress', { account, race, progress, elapsed, finish, signature, ...(place === undefined ? {} : { place }) });
}
function removeClaim(race: string): void { write(PENDING, JSON.stringify(pendingClaims().filter(c => c.race !== race))); }
export class RewardPendingError extends Error {
  readonly code = 'reward_pending';
  constructor(public race: string) { super('Your rewards are still arriving. We’ll check again automatically.'); }
}
const rewardFlights = new Map<string, Promise<Reward>>();
const recoveredRewards = new Map<string, Reward>();
function settleClaim(claim: Claim): Promise<Reward> {
  const key = `${claim.account}:${claim.race}`;
  const received = recoveredRewards.get(key); if (received) { removeClaim(claim.race); return Promise.resolve(received); }
  const flight = rewardFlights.get(key); if (flight) return flight;
  const task = (async () => {
    try {
      const reward = await progressCall(claim, true);
      if (!reward?.tx) throw new Error('Reward not confirmed');
      const result = { ...reward, race: claim.race };
      recoveredRewards.set(key, result);
      if (recoveredRewards.size > 50) recoveredRewards.delete(recoveredRewards.keys().next().value!);
      removeClaim(claim.race);
      if (claim.account === nearAccount()) window.dispatchEvent(new CustomEvent('minirush:reward-settled', { detail: result }));
      return result;
    } catch { throw new RewardPendingError(claim.race); }
  })().finally(() => rewardFlights.delete(key));
  rewardFlights.set(key, task); return task;
}
export async function retryRaceReward(): Promise<Reward | null> {
  let result: Reward | null = null;
  let failure: unknown;
  for (const claim of pendingClaims().filter(c => c.account === nearAccount()).slice(0, 5)) {
    if (claim.account !== nearAccount()) continue;
    try {
      result = await settleClaim(claim);
    }
    catch (err) { failure = err; }
  }
  if (!result && failure) throw failure;
  return result;
}

/** Per-race state isolates delayed network responses from retries/new races. */
export class RewardRace {
  private ready: Promise<{ account: string; race: string } | null>;
  private busy: Promise<unknown> = Promise.resolve();
  private sending = false;
  private lastSample = 0;
  private completed = false;
  constructor(distance: number) {
    this.ready = (async () => {
      const account = await ensureAccount();
      if (!account) return null;
      const run = crypto.randomUUID();
      const signature = await signMessage(`minirush:race:begin:${account}:${run}:${distance}`);
      const race = await convex<string>('action', 'near:beginRace', { account, run, distance, signature });
      return { account, race };
    })().catch(() => null);
  }
  sample(progress: number, elapsed: number): void {
    if (this.completed || this.sending || elapsed - this.lastSample < 4) return;
    this.lastSample = elapsed;
    this.sending = true;
    this.busy = this.ready.then(async r => {
      if (r) await progressCall({ ...r, progress: Math.max(0, Math.floor(progress)), elapsed: Math.floor(elapsed) }, false);
    }).catch(() => {}).finally(() => { this.sending = false; });
  }
  async finish(progress: number, elapsed: number, place = 0): Promise<Reward | null> {
    this.completed = true;
    await this.busy;
    const r = await this.ready;
    if (!r || elapsed < 40) return null;
    const claim: Claim = { ...r, progress: Math.max(0, Math.floor(progress)), elapsed: Math.floor(elapsed), place: rewardPlace(place) };
    const claims = pendingClaims();
    if (!claims.some(c => c.race === claim.race)) claims.push(claim);
    try { localStorage.setItem(PENDING, JSON.stringify(claims)); }
    catch { throw Object.assign(new Error('Keep this race open and allow browser storage, then collect your rewards.'), { code: 'reward_storage' }); }
    return settleClaim(claim);
  }
}

/** Recovery never signs a fresh purchase. It resumes saved actions and idempotent rewards. */
let recoveryStarted = false, recovering = false, nextRecovery = 0, recoveryDelay = 15_000;
export async function recoverGarage(): Promise<void> {
  if (recovering || !nearAccount() || !navigator.onLine) return;
  recovering = true;
  try {
    await Promise.allSettled([recoverGarageAction(), retryRaceReward()]);
    recoveryDelay = hasPendingAction() || hasPendingReward() ? Math.min(300_000, recoveryDelay * 2) : 15_000;
  } finally { recovering = false; nextRecovery = Date.now() + recoveryDelay; }
}
export function startGarageRecovery(): void {
  if (recoveryStarted) return;
  recoveryStarted = true;
  void recoverGarage();
  window.setInterval(() => { if (!document.hidden && Date.now() >= nextRecovery) void recoverGarage(); }, 15_000);
  window.addEventListener('online', () => { nextRecovery = 0; void recoverGarage(); });
  window.addEventListener('storage', e => {
    if (e.key === CREDENTIALS_KEY && e.newValue !== e.oldValue) { location.reload(); return; }
    if (e.key !== ACTIONS_KEY) return;
    window.dispatchEvent(new Event('minirush:garage-action'));
    if (nearAccount()) void Promise.allSettled([holdings().then(syncCars), refreshComponents(false)])
      .then(() => window.dispatchEvent(new Event('minirush:garage-updated')));
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() >= nextRecovery) void recoverGarage(); });
}
