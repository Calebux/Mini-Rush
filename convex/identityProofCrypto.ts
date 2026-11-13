'use node';
import { createHash } from 'node:crypto';
import { PublicKey } from 'near-api-js';
import { AUTH_AUDIENCE, AUTH_ISSUER, identityPayload } from '../shared/identityProof';

export function strictBase64(value: string, size: number): Buffer {
  if (value.length > size * 2) throw new Error('Invalid signature encoding');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== size || bytes.toString('base64') !== value) throw new Error('Invalid signature encoding');
  return bytes;
}
export function proofBytes(challenge: { message: string; recipient: string; nonce: string }): Uint8Array {
  return identityPayload(challenge.message, challenge.recipient, strictBase64(challenge.nonce, 32));
}
export function verifyIdentitySignature(key: string, payload: Uint8Array, signature: string): void {
  if (!PublicKey.from(key).verify(createHash('sha256').update(payload).digest(), strictBase64(signature, 64))) throw new Error('Ownership signature did not match');
}

/** Early cost/shape checks only. The on-chain Auth0 guard MUST verify this JWT cryptographically. */
export function inspectSigningToken(token: string, payload: Uint8Array, now = Date.now()): { subject: string; identityHash: string } {
  if (token.length > 16000) throw new Error('Invalid signing request');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid signing request');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (header.alg !== 'RS256' || claims.iss !== AUTH_ISSUER || typeof claims.sub !== 'string' || !claims.sub.length || claims.sub.length > 300 ||
    typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp * 1000 <= now ||
    (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf) || claims.nbf * 1000 > now)) ||
    !(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(AUTH_AUDIENCE)) throw new Error('Invalid signing request');
  if (!Array.isArray(claims.fatxn) || claims.fatxn.length !== payload.length || claims.fatxn.some((v: unknown, i: number) => v !== payload[i])) throw new Error('Signing request does not match the garage challenge');
  return { subject: claims.sub, identityHash: createHash('sha256').update(`${AUTH_ISSUER}\0${claims.sub}`).digest('hex') };
}

/** Decode only an actual Ed25519 MPC signature, never a JWT or a signature request. */
export function mpcSignature(response: { status: unknown }): string {
  const status = response.status as { SuccessValue?: string };
  if (typeof status?.SuccessValue !== 'string' || status.SuccessValue.length > 2048) throw new Error('No completed identity signature');
  const value = JSON.parse(Buffer.from(status.SuccessValue, 'base64').toString());
  if (!value || !Array.isArray(value.signature) || value.signature.length !== 64 ||
    value.signature.some((v: unknown) => typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 255)) throw new Error('No completed identity signature');
  return Buffer.from(value.signature).toString('base64');
}
