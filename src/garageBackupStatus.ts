// A player-confirmed download reminder, never evidence of ownership or authorization.
const KEY = 'minirush.garage.backup-confirmation.v1';
export function confirmedBackup(account: string, publicKey: string): string | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return value?.account === account && value?.publicKey === publicKey &&
      typeof value.at === 'string' && Number.isFinite(Date.parse(value.at)) ? value.at : null;
  } catch { return null; }
}
export function confirmBackup(account: string, publicKey: string): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify({ account, publicKey, at: new Date().toISOString() }));
    window.dispatchEvent(new Event('minirush:backup-confirmed'));
    return true;
  } catch { return false; }
}
