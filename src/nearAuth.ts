/** Testnet authentication only. Never changes the active garage or its signing key. */
import { Buffer } from 'buffer';
import { updateShopSession } from './shopSession';
import { AUTH_AUDIENCE, AUTH_GUARD, identityPayload, type IdentityChallenge } from '../shared/identityProof';

export const AUTH_CLIENT_ID = (import.meta.env.VITE_NEAR_AUTH_CLIENT_ID as string | undefined)?.trim()
  || 'np8paqIpMWmNbzT4xAvOOapZBjsOpptl';
export const AUTH_CALLBACK_KEY = 'minirush.auth.callback.v1';
const RPC = 'https://rpc.testnet.near.org';
const CALLBACK_TTL = 10 * 60_000;
export interface AuthIdentity { publicKey: string; google: boolean }

async function createAuth() {
  // The published SDK expects Node's Buffer, and uses the NEAR v5 connection.
  // Keep that compatibility layer lazy and separate from the game's v7 signer.
  const runtime = globalThis as unknown as { Buffer?: typeof Buffer; process?: unknown; global?: typeof globalThis };
  runtime.global ??= globalThis;
  runtime.Buffer ??= Buffer;
  runtime.process ??= { env: {}, nextTick: (fn: () => void) => queueMicrotask(fn) };
  const [{ JavascriptProvider }, { FastAuthClient }, { connect }] = await Promise.all([
    import('@fast-auth-near/javascript-provider'), import('@fast-auth-near/browser-sdk'), import('near-auth-api')
  ]);
  const provider = new JavascriptProvider({ network: 'testnet', clientId: AUTH_CLIENT_ID });
  const { connection } = await connect({ networkId: 'testnet', nodeUrl: RPC });
  const client = new FastAuthClient(provider, connection, {
    fastAuthContractId: 'fast-auth.testnet', mpcContractId: 'v1.signer-prod.testnet'
  });
  return { provider, client };
}
let loading: ReturnType<typeof createAuth> | undefined;
export function loadNearAuth() {
  if (!loading) loading = createAuth().catch(error => { loading = undefined; throw error; });
  return loading;
}

export async function authIdentity(): Promise<AuthIdentity | null> {
  const { provider, client } = await loadNearAuth();
  if (!(await loginToken())) return null;
  const path = await provider.getPath();
  const signer = await client.getSigner();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let publicKey: string;
  try {
    publicKey = String(await Promise.race([
      signer.getPublicKey(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('identity_lookup_timeout')), 15_000); })
    ]));
  } finally { clearTimeout(timer); }
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(publicKey)) throw new Error('invalid_auth_key');
  return { publicKey, google: path.includes('/#google-oauth2|') };
}

/** Called only by a user gesture after the SDK has loaded. */
export function loginWithPopup(auth: Awaited<ReturnType<typeof loadNearAuth>>) {
  return auth.client.login();
}

export async function loginWithRedirect(auth: Awaited<ReturnType<typeof loadNearAuth>>): Promise<void> {
  // A fixed, same-origin return URL; never trust return URLs from query strings.
  const returnUrl = new URL(location.href);
  for (const name of ['code', 'state', 'error', 'error_description']) returnUrl.searchParams.delete(name);
  sessionStorage.setItem(AUTH_CALLBACK_KEY, JSON.stringify({ at: Date.now(), returnUrl: returnUrl.href }));
  await auth.client.login({ redirectUri: new URL(location.pathname, location.origin).href });
}

export async function finishAuthCallback(): Promise<AuthIdentity> {
  const saved = sessionStorage.getItem(AUTH_CALLBACK_KEY);
  let returnUrl = new URL(location.pathname, location.origin).href;
  try {
    const intent = JSON.parse(saved ?? 'null') as { at?: number; returnUrl?: string } | null;
    if (!intent || typeof intent.at !== 'number' || Date.now() - intent.at > CALLBACK_TTL || intent.at > Date.now() || !intent.returnUrl) throw new Error('expired_login');
    const target = new URL(intent.returnUrl);
    if (target.origin !== location.origin) throw new Error('invalid_callback');
    returnUrl = target.href;
    if (new URLSearchParams(location.search).has('error')) throw new Error('login_cancelled');
    const identity = await authIdentity();
    if (!identity) throw new Error('login_incomplete');
    return identity;
  } finally {
    sessionStorage.removeItem(AUTH_CALLBACK_KEY);
    history.replaceState(history.state, '', returnUrl);
  }
}

export async function logoutAuth(): Promise<void> {
  updateShopSession(0);
  const { provider } = await loadNearAuth();
  // browser-sdk 1.4.2 client.logout forwards an array instead of the options object.
  await provider.logout({ openUrl: false });
}

/** Normal login credential, kept in memory and sent only to our backend. */
export async function loginToken(): Promise<string | null> {
  try {
    const { provider } = await loadNearAuth();
    if (!(await provider.isLoggedIn())) { updateShopSession(0); return null; }
    // The pinned provider does not expose its verified ID token publicly.
    const source = provider as unknown as { client: { getIdTokenClaims(): Promise<{ __raw?: string; exp?: number } | undefined> } };
    const claims = await source.client.getIdTokenClaims();
    if (!claims?.__raw || !claims.exp || claims.exp * 1000 <= Date.now()) { updateShopSession(0); return null; }
    updateShopSession(claims.exp * 1000);
    return claims.__raw;
  } catch (error) { updateShopSession(0); throw error; }
}

/** Refill the SDK's memory cache from an existing Auth0 session, without a popup. */
export async function restoreLoginSession(): Promise<string | null> {
  const { provider } = await loadNearAuth();
  const source = provider as unknown as { client: { checkSession(options: { timeoutInSeconds: number }): Promise<void> } };
  try { await source.client.checkSession({ timeoutInSeconds: 8 }); }
  catch { /* Cookie restrictions or an expired hosted session leave guest play available. */ }
  return loginToken();
}

/**
 * Temporary backport of the official NEP-413 method at Peersyst/fast-auth
 * 31f80825587ae2e5f43c21c2f23f29fc05ec7cc1, packages/providers/javascript/src/provider.ts.
 * 1.4.1 has the same Auth0 client but predates this public method. Keep access to
 * its internals confined here; remove this bridge when a compatible release ships.
 */
export async function requestIdentitySignature(auth: Awaited<ReturnType<typeof loadNearAuth>>, challenge: IdentityChallenge): Promise<string> {
  if (challenge.expiresAt <= Date.now() || challenge.recipient !== location.origin) throw new Error('Ownership check expired or belongs to another site.');
  const payload = identityPayload(challenge.message, challenge.recipient, Uint8Array.from(atob(challenge.nonce), c => c.charCodeAt(0)));
  const provider = auth.provider as unknown as {
    options: { network: string; domain: string; signingAudience: string };
    client: { loginWithPopup(options: { authorizationParams: { audience: string; scope: string; nep413: number[] } }): Promise<void> };
  };
  if (provider.options.network !== 'testnet' || provider.options.domain !== 'login.testnet.fast-auth.com' || provider.options.signingAudience !== AUTH_AUDIENCE || typeof provider.client?.loginWithPopup !== 'function') throw new Error('Unsupported identity provider');
  const path = await auth.provider.getPath();
  await provider.client.loginWithPopup({ authorizationParams: { audience: AUTH_AUDIENCE, scope: 'transaction:sign', nep413: Array.from(payload) } });
  if (await auth.provider.getPath() !== path) throw new Error('The signed-in identity changed. Start a new ownership check.');
  const response = await auth.provider.getSignatureRequest() as { signatureRequest?: { guardId?: string; verifyPayload?: string; signPayload?: unknown } };
  const request = response.signatureRequest;
  if (!request || request.guardId !== AUTH_GUARD || typeof request.verifyPayload !== 'string' || request.verifyPayload.length > 16000 ||
    !Array.isArray(request.signPayload) || request.signPayload.length !== payload.length || request.signPayload.some((v, i) => v !== payload[i])) throw new Error('The signing request did not match the ownership check.');
  return request.verifyPayload; // Remains in memory; the server/guard verifies it before signing.
}
