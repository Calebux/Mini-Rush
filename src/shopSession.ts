import { signInRequired } from '../shared/shopPolicy';

/**
 * Off by default: the garage made on this device is the player's access, and
 * the sign-in entry is not shown. Set VITE_SHOP_SIGN_IN=required (and
 * SHOP_SIGN_IN=required on Convex) to put a login in front of buying.
 */
export const SIGN_IN_REQUIRED = signInRequired(import.meta.env.VITE_SHOP_SIGN_IN as string | undefined);

// UI state only. Convex independently authenticates sponsored purchases.
let expiresAt = 0;
export const shopSignedIn = (): boolean => expiresAt > Date.now();
/** Whether this driver may buy right now: always, unless a login is required and missing. */
export const shopOpen = (): boolean => !SIGN_IN_REQUIRED || shopSignedIn();
export function updateShopSession(expiry: number): void {
  expiresAt = Number.isFinite(expiry) ? expiry : 0;
  window.dispatchEvent(new Event('minirush:session'));
}
export function openShopSignIn(): void {
  window.dispatchEvent(new CustomEvent('minirush:sign-in', { detail: 'shop' }));
}
export function checkLocalPurchase(): boolean {
  if (shopOpen()) return true;
  openShopSignIn(); return false;
}
export async function requireShopSession(): Promise<boolean> {
  if (!SIGN_IN_REQUIRED) return true;
  try {
    if (await (await import('./nearAuth')).loginToken()) return true;
  } catch { updateShopSession(0); }
  openShopSignIn(); return false;
}
