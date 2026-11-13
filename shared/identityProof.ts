/** NEP-413 payload, deliberately without callbackUrl. No transaction can decode this tag. */
export function identityPayload(message: string, recipient: string, nonce: Uint8Array): Uint8Array {
  if (nonce.length !== 32) throw new Error('Invalid challenge nonce');
  const m = new TextEncoder().encode(message), r = new TextEncoder().encode(recipient);
  if (m.length > 2048 || r.length > 256) throw new Error('Challenge too large');
  const bytes = new Uint8Array(4 + 4 + m.length + 32 + 4 + r.length + 1);
  const view = new DataView(bytes.buffer);
  let at = 0;
  const u32 = (n: number) => { view.setUint32(at, n, true); at += 4; };
  u32(2 ** 31 + 413); u32(m.length); bytes.set(m, at); at += m.length;
  bytes.set(nonce, at); at += 32; u32(r.length); bytes.set(r, at);
  // Last byte is Borsh Option::None. There is no signed callback URL.
  return bytes;
}

export const IDENTITY_TTL = 5 * 60_000;
export const AUTH_GUARD = 'jwt#https://login.testnet.fast-auth.com/';
export const AUTH_ISSUER = 'https://login.testnet.fast-auth.com/';
export const AUTH_AUDIENCE = 'auth0.jwt.fast-auth.testnet';
export interface IdentityChallenge {
  id: string; account: string; garageKey: string; identityKey: string;
  recipient: string; message: string; nonce: string; expiresAt: number;
}
export type IdentityProofResult = { state: 'needs_approval' | 'pending' | 'verified' | 'failed'; message: string; tx?: string };
export function identityStartMessage(account: string, key: string, recipient: string, request: string, at: number): string {
  return JSON.stringify(['minirush:identity-proof:v1', 'testnet', account, key, recipient, request, at]);
}
export function identityMessage(account: string, garageKey: string, identityKey: string, garage: string, expiresAt: number): string {
  return `Verify a MiniRush garage identity on NEAR testnet.\nGarage contract: ${garage}\nGarage: ${account}\nCurrent key: ${garageKey}\nIdentity key: ${identityKey}\nExpires: ${expiresAt}\nThis records an ownership link only. It does not transfer assets, add access keys, or enable account recovery.`;
}
