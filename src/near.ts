/**
 * The player's NEAR side (testnet), kept invisible: on first launch the phone
 * makes a key, the game's backend creates `p….minirush-garage.testnet` for it
 * and drops in a welcome purse of RUSH. Race coins are minted as RUSH, and
 * every purchase is a meta-transaction the player signs and the game pays
 * gas for — no wallet, no seed phrase, no NEAR needed.
 *
 * near-api-js is loaded on first use so it never weighs on the race bundle.
 * Everything fails soft: offline or without Convex the game plays as before.
 */
import { grantCar } from './economy';

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

async function convex<T>(kind: 'query' | 'action', path: string, args: unknown, timeoutMs = 30_000): Promise<T> {
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

async function viewCall<T>(method: string, args: Record<string, unknown>): Promise<T> {
  const { JsonRpcProvider } = await near();
  return new JsonRpcProvider({ url: RPC }).callFunction({ contractId: GARAGE, method, args }) as Promise<T>;
}

export const listings = () => viewCall<Listing[]>('listings', {});
export async function holdings(): Promise<Holding[]> {
  const acc = nearAccount();
  return acc ? viewCall<Holding[]>('mt_tokens_for_owner', { account_id: acc }) : [];
}
export const dealerLog = (limit = 40) => convex<DealerMove[]>('query', 'nearDb:dealerLog', { limit }, 8000);

/** Cars held on chain become drivable in the garage. */
export function syncCars(h: Holding[]): void {
  for (const x of h) if (x.token_id.startsWith('car:') && Number(x.balance) > 0) grantCar(x.token_id.slice(4));
}

/** Mint this race's coins as RUSH. Fire and forget: a race never waits on the chain. */
export async function payRace(coins: number): Promise<{ minted: number; tx: string } | null> {
  if (!nearEnabled() || coins <= 0) return null;
  try {
    const account = await ensureAccount();
    if (!account) return null;
    const kp = await keyPair();
    const nonce = Date.now();
    const amount = Math.floor(coins);
    const sig = kp.sign(new TextEncoder().encode(`minirush:pay:${account}:${amount}:${nonce}`));
    let b64 = '';
    for (const byte of sig.signature) b64 += String.fromCharCode(byte);
    return await convex('action', 'near:payRace', { account, coins: amount, nonce, signature: btoa(b64) });
  } catch {
    return null;
  }
}

/** Sign a garage call and have the game relay it (the game pays gas). */
async function relayed(method: string, args: object, deposit = 0n): Promise<{ tx: string; value: unknown }> {
  const account = await ensureAccount();
  if (!account) throw new Error('No connection to NEAR right now');
  const n = await near();
  const kp = await keyPair();
  const me = new n.Account(account, RPC, kp.toString() as `ed25519:${string}`);
  const { signedDelegate } = await me.createSignedMetaTransaction({
    receiverId: GARAGE,
    actions: [n.actions.functionCall(method, args, 30n * TGAS, deposit)]
  });
  const bytes = n.encodeSignedDelegate(signedDelegate);
  let b64 = '';
  for (const byte of bytes) b64 += String.fromCharCode(byte);
  return convex('action', 'near:relay', { signedDelegate: btoa(b64) }, 45_000);
}

export async function buy(tokenId: string, maxPrice: string): Promise<string> {
  const { tx } = await relayed('buy', { token_id: tokenId, max_price: maxPrice });
  if (tokenId.startsWith('car:')) grantCar(tokenId.slice(4));
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
