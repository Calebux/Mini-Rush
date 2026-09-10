// Weekly Cup bounty. No backend: entries are MR2 race receipts minted from the
// player's own wallet to the receipt address, and the organizer ranks them from
// the chain after entries close (scripts/bounty-entries.mjs) and pays the
// winner by hand. See docs/bounty.md.
import { weekKey } from './weekly';

const WEEK = (import.meta.env.VITE_BOUNTY_WEEK as string | undefined)?.trim();
const PRIZE = (import.meta.env.VITE_BOUNTY_PRIZE as string | undefined)?.trim() || '$20 in NIM';

/** Prize as shown to players, e.g. "$20 in NIM". */
export const bountyPrize = (): string => PRIZE;

/** Entries always close at the end of the ISO week. */
export const BOUNTY_CLOSES = 'Sun 23:59 UTC';

/**
 * True during the ISO week named by VITE_BOUNTY_WEEK. On the dev server,
 * `?bounty=1` previews it on any week; production builds ignore the flag so a
 * crafted link can't advertise a bounty that isn't running.
 */
export function bountyActive(): boolean {
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('bounty') === '1') return true;
  return !!WEEK && WEEK === weekKey();
}
