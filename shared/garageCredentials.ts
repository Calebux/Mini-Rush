/** A restored account/key is committed together in one atomic storage write. */
export const CREDENTIALS_KEY = 'minirush.near.credentials.v1';
export const LEGACY_KEY = 'minirush.near.key';
export const LEGACY_ACCOUNT = 'minirush.near.account';
export interface Credentials { account: string | null; secretKey: string | null }
export interface CredentialStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export function readCredentials(storage: CredentialStorage): Credentials {
  const raw = storage.getItem(CREDENTIALS_KEY);
  if (raw !== null) {
    let value;
    try { value = JSON.parse(raw); } catch { throw new Error('Saved garage access is damaged. Restore your recovery file.'); }
    if (!value || value.version !== 1 || typeof value.account !== 'string' || typeof value.secretKey !== 'string') throw new Error('Saved garage access is damaged. Restore your recovery file.');
    return { account:value.account, secretKey:value.secretKey };
  }
  return { account:storage.getItem(LEGACY_ACCOUNT), secretKey:storage.getItem(LEGACY_KEY) };
}
export function credentialSnapshot(storage: CredentialStorage): string {
  return JSON.stringify([CREDENTIALS_KEY, LEGACY_ACCOUNT, LEGACY_KEY].map(k => storage.getItem(k)));
}
export function commitCredentials(storage: CredentialStorage, expected: string, next: { account: string; secretKey: string }): void {
  if (credentialSnapshot(storage) !== expected) throw new Error('Your active garage changed. Close this window and check the recovery file again.');
  // If quota/privacy settings reject this write, the previous account remains active.
  storage.setItem(CREDENTIALS_KEY, JSON.stringify({ version:1, ...next }));
  // Cleanup is optional AFTER commit. These older slots are no longer authoritative.
  try { storage.removeItem(LEGACY_ACCOUNT); storage.removeItem(LEGACY_KEY); } catch { /* Atomic record is already committed. */ }
}
