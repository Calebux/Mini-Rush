// The weekly bounty: a free-to-enter prize for the fastest WIN of the week's
// HARDCORE race. Everyone races the same circuit — seed, city and lap length
// all derive from the ISO week — in fast cars (no hypercars, no workshop
// builds) against the pro field, so the only thing that separates entries is
// driving. No backend for entries: an entry is a race receipt minted from the
// winner's own wallet, the organizer ranks entries after they close
// (scripts/bounty-entries.mjs) and pays by hand.
//
// Which weeks carry a prize is read at runtime from the organizer's Convex
// table (convex/bounty.ts), so a bounty is posted or pulled in the Convex
// dashboard with no redeploy. VITE_BOUNTY_WEEK / VITE_BOUNTY_PRIZE remain a
// build-time fallback for a deployment without Convex. See docs/bounty.md.
import { MODES } from './modes';
import { weekKey, weeklySeed } from './weekly';

const WEEK = (import.meta.env.VITE_BOUNTY_WEEK as string | undefined)?.trim();
const PRIZE = (import.meta.env.VITE_BOUNTY_PRIZE as string | undefined)?.trim() || '$20 in NIM';
const CONVEX_URL = (import.meta.env.VITE_CONVEX_URL as string | undefined)?.trim().replace(/\/+$/, '');

/** A bounty posted in Convex for one ISO week. */
interface Posted {
  week: string;
  prize: string;
  split: string[] | null; // prize per place, 1st first; null = winner takes all
  receiver: string | null;
}

let posted: Posted | null = null;
let pending: Promise<void> | null = null;
let latest = 0; // only the newest read may overwrite `posted`

/** The posted bounty, if it is for the week that's running now. */
const current = (): Posted | null => (posted && posted.week === weekKey() ? posted : null);

function parsePosted(value: unknown, week: string): Posted | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const prize = typeof row.prize === 'string' ? row.prize.trim().slice(0, 40) : '';
  if (!prize) return null;
  const split = Array.isArray(row.split)
    ? row.split.filter((p): p is string => typeof p === 'string')
      .map((p) => p.trim().slice(0, 24)).filter(Boolean).slice(0, 5)
    : [];
  return {
    week, prize,
    split: split.length > 1 ? split : null,
    receiver: typeof row.receiver === 'string' ? row.receiver.trim() : null
  };
}

/**
 * Read this week's bounty from Convex. Never rejects: without a Convex URL,
 * offline, or on an error the last answer (or the build-time settings) stand.
 * `fresh` reads again, so a bounty posted mid-session appears when the board
 * is opened.
 */
export function loadBounty(fresh = false): Promise<void> {
  if (!CONVEX_URL) return Promise.resolve();
  if (pending && !fresh) return pending;
  const week = weekKey();
  const request = ++latest;
  const abort = new AbortController();
  const timer = window.setTimeout(() => abort.abort(), 6000);
  pending = fetch(`${CONVEX_URL}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'bounty:forWeek', args: { week }, format: 'json' }),
    signal: abort.signal
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((body: unknown) => {
      const reply = body as { status?: unknown; value?: unknown } | null;
      // a null value is an answer too: no bounty, or it was pulled
      if (request === latest && reply?.status === 'success') posted = parsePosted(reply.value, week);
    })
    .catch(() => { /* offline or blocked */ })
    .finally(() => window.clearTimeout(timer));
  return pending;
}

/** Prize as shown to players, e.g. "$20 in NIM". */
export const bountyPrize = (): string => current()?.prize ?? PRIZE;

/** Prize per place when the posted bounty is shared by the fastest few wins; null = winner takes all. */
export const bountySplit = (): string[] | null => current()?.split ?? null;

/** Entry address named by the posted bounty, if any. */
export const bountyReceiver = (): string | null => current()?.receiver ?? null;

/** Entries always close at the end of the ISO week. */
export const BOUNTY_CLOSES = 'Sun 23:59 UTC';

/**
 * True when a prize is posted for this week — in Convex, or at build time via
 * VITE_BOUNTY_WEEK on a build without Convex. The board and the race run every
 * week regardless. On the dev server `?bounty=1` previews a prize on any week;
 * production builds ignore the flag so a crafted link can't advertise a bounty
 * that isn't running.
 */
export function bountyActive(): boolean {
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('bounty') === '1') return true;
  if (current()) return true;
  // with Convex configured it is the only source, so a leftover build-time week
  // can't advertise a prize that was never posted there
  return !CONVEX_URL && !!WEEK && WEEK === weekKey();
}

/** The race the bounty is decided on. */
export const BOUNTY_MODE = MODES.findIndex((m) => m.id === 'hardcore');

/** This week's bounty circuit. Mixed away from the Weekly Cup's, so the two events differ. */
export function bountySeed(): number {
  return (Math.imul(weeklySeed(), 2654435761) >>> 0) % 1e9 || 17;
}

/** This week's bounty city. */
export function bountyMapIndex(mapCount: number): number {
  if (!Number.isFinite(mapCount) || mapCount <= 0) return 0;
  return (Math.imul(bountySeed(), 40503) >>> 0) % Math.floor(mapCount);
}

/** Only a win on the bounty race counts, and the fastest winning time takes it. */
export const bountyQualifies = (place: number, busted: boolean): boolean =>
  place === 1 && !busted;
