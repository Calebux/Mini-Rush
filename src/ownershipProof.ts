import { beginGarageIdentity, signGarageIdentity, nearAccount, convex } from './near';
import type { IdentityChallenge, IdentityProofResult } from '../shared/identityProof';

const STORE = 'minirush.identity-proof.v1';
export interface SavedOwnershipProof { challenge: IdentityChallenge; garageSignature: string; result: IdentityProofResult }
export function savedOwnershipProof(identityKey: string): SavedOwnershipProof | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null') as SavedOwnershipProof | null;
    if (!saved || saved.challenge.account !== nearAccount() || saved.challenge.identityKey !== identityKey || saved.challenge.recipient !== location.origin) return null;
    return saved;
  } catch { return null; }
}
function save(saved: SavedOwnershipProof): void { localStorage.setItem(STORE, JSON.stringify(saved)); }
export async function prepareOwnershipProof(identityKey: string): Promise<SavedOwnershipProof> {
  const old = savedOwnershipProof(identityKey);
  if (old && old.challenge.expiresAt > Date.now() && (old.result.state === 'needs_approval' || old.result.state === 'pending')) return old;
  const challenge = await beginGarageIdentity(identityKey);
  const saved: SavedOwnershipProof = { challenge, garageSignature: await signGarageIdentity(challenge),
    result: { state: 'needs_approval', message: 'Ready to verify. Approve the ownership message on the secure screen.' } };
  save(saved); // Storage must work before an approval can cause any sponsored signing.
  return saved;
}
export async function submitOwnershipProof(saved: SavedOwnershipProof, signingToken?: string): Promise<SavedOwnershipProof> {
  if (saved.challenge.account !== nearAccount() || saved.challenge.recipient !== location.origin) throw new Error('This ownership check belongs to another garage.');
  const pending: SavedOwnershipProof = { ...saved, result: { state: 'pending', message: 'Checking the original ownership request…' } };
  save(pending);
  try {
    const result = await convex<IdentityProofResult>('action', 'near:completeIdentityProof', {
      id: saved.challenge.id, garageSignature: saved.garageSignature, ...(signingToken ? { signingToken } : {})
    }, 45_000);
    if (!['pending', 'needs_approval', 'verified', 'failed'].includes(result.state) || result.state === 'verified' && !result.tx) throw new Error('Incomplete proof response');
    const next = { ...saved, result };
    if (saved.challenge.account === nearAccount()) save(next);
    return next;
  } catch {
    return pending; // An ambiguous response is recovered by checking the same challenge ID.
  }
}
