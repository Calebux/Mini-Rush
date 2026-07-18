// Referral system: share links include ?ref=<address>, first race by the
// referred player credits 50 coins to the referrer. One-time attribution,
// purely local (on-chain referral tracking is in MiniRushTrackerV2).
import { deposit } from './economy';

const REF_KEY = 'minirush.referrer';
const REF_CREDITED_KEY = 'minirush.ref.credited';
const REWARD_COINS = 50;

/** Called on game load — captures the referrer from the URL. */
export function captureReferrer(): void {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  if (ref && ref.startsWith('0x') && ref.length === 42) {
    // only store if we don't already have one (first-touch attribution)
    if (!localStorage.getItem(REF_KEY)) {
      localStorage.setItem(REF_KEY, ref);
    }
  }
}

/** Get the stored referrer address, or null. */
export function getReferrer(): string | null {
  return localStorage.getItem(REF_KEY);
}

/**
 * Credit the referral reward on the referred player's first race finish.
 * Returns true if coins were just credited (show a popup).
 */
export function creditReferral(): boolean {
  if (localStorage.getItem(REF_CREDITED_KEY)) return false;
  const ref = getReferrer();
  if (!ref) return false;
  // Credit the coins to this device's bank (the referrer gets tracked on-chain)
  deposit(REWARD_COINS);
  localStorage.setItem(REF_CREDITED_KEY, '1');
  return true;
}

/** Build a share URL with the referral code appended. */
export function shareUrl(walletAddress: string | null): string {
  const base = window.location.origin + window.location.pathname;
  if (walletAddress) {
    return `${base}?ref=${walletAddress}`;
  }
  return base;
}

/** The reward amount (exported for UI display). */
export const REFERRAL_COINS = REWARD_COINS;
