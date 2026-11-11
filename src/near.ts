/**
 * The player's NEAR side (testnet), kept invisible: on first launch the phone
 * makes a key, the game's backend creates `p….minirush-garage.testnet` for it
 * and eligible race sessions earn salvage plus RUSH from a fixed table by finishing place.
 * every purchase is a meta-transaction the player signs and the game pays
 * gas for — no wallet, no seed phrase, no NEAR needed.
 *
 * near-api-js is loaded on first use so it never weighs on the race bundle.
 * Everything fails soft: offline or without Convex the game plays as before.
 */
import { syncChainCars } from './economy';
import { setComponentInventory, type Component } from './components';
import { rewardPlace } from '../shared/raceRules';

export const GARAGE = (import.meta.env.VITE_NEAR_GARAGE as string | undefined) ?? 'minirush-garage.testnet';
const RPC = (import.meta.env.VITE_NEAR_RPC as string | undefined) ?? 'https://test.rpc.fastnear.com';
const CONVEX_URL = (import.meta.env.VITE_CONVEX_URL as string | undefined)?.trim().replace(/\/+$/, '');
const KEY_STORE = 'minirush.near.key';
const ACCOUNT_STORE = 'minirush.near.account';
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
export const nearAccount = (): string | null => read(ACCOUNT_STORE);

export async function convex<T>(kind: 'query' | 'action', path: string, args: unknown, timeoutMs = 30_000): Promise<T> {
  if (!CONVEX_URL) throw new Error('offline');
  const res = await fetch(`${CONVEX_URL}/api/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  let k = read(KEY_STORE);
  if (!k) { k = KeyPair.fromRandom('ed25519').toString(); write(KEY_STORE, k); }
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
      const { account } = await convex<{ account: string }>('action', 'near:createPlayer', { publicKey: kp.getPublicKey().toString() }, 45_000);
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
export async function relayed(method: string, args: object, deposit = 0n): Promise<{ tx: string; value: unknown }> {
  const account = await ensureAccount();
  if (!account) throw new Error('No connection to NEAR right now');
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
  return convex('action', 'near:relay', { signedDelegate: btoa(b64) }, 45_000);
}

export async function buy(tokenId: string, maxPrice: string): Promise<string> {
  const { tx } = await relayed('buy', { token_id: tokenId, max_price: maxPrice });
  if (tokenId.startsWith('car:')) syncCars(await holdings());
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
export interface Reward { minted: number; alloy: number; circuit: number; tx: string; place?: number }
interface Claim { account: string; race: string; progress: number; elapsed: number; place?: number }
const PENDING = 'minirush.near.pending-races.v2';
function pendingClaims(): Claim[] {
  try { const raw = JSON.parse(read(PENDING) ?? '[]'); return Array.isArray(raw) ? raw : []; } catch { return []; }
}
export function hasPendingReward(): boolean { return pendingClaims().length > 0; }
async function progressCall(claim: Claim, finish: boolean): Promise<Reward | null> {
  const { account, race, progress, elapsed } = claim;
  // Checkpoints never carry a place; the finish signs the podium tier it claims.
  const place = finish ? rewardPlace(claim.place) : undefined;
  const signature = await signMessage(`minirush:race:progress:${account}:${race}:${progress}:${elapsed}:${finish}${place === undefined ? '' : `:${place}`}`);
  return convex('action', 'near:raceProgress', { account, race, progress, elapsed, finish, signature, ...(place === undefined ? {} : { place }) });
}
function removeClaim(race: string): void { write(PENDING, JSON.stringify(pendingClaims().filter(c => c.race !== race))); }
export async function retryRaceReward(): Promise<Reward | null> {
  let result: Reward | null = null;
  let failure: unknown;
  for (const claim of pendingClaims()) {
    if (claim.account !== nearAccount()) continue;
    try {
      const reward = await progressCall(claim, true);
      if (!reward) throw new Error('No reward receipt received. Retry this claim.');
      result = reward; removeClaim(claim.race);
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
    write(PENDING, JSON.stringify(claims));
    const result = await progressCall(claim, true);
    if (!result) throw new Error('No reward receipt received. Retry this claim.');
    removeClaim(claim.race);
    return result;
  }
}
