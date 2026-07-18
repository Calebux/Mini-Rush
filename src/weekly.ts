// Weekly Cup: a non-staked tournament. One shared circuit per ISO week — seed,
// city and mode derive from the week number alone, so every player races the
// same track with no backend. Placing on your own board pays a coin prize once
// per week (top-3), so there are no funds at stake and nothing to exploit.
import { deposit } from './economy';

/** ISO-week stamp, e.g. "2026-W29" — keys the weekly board and prize claim. */
export function weekKey(): string {
  const d = new Date();
  // ISO week: Thursday-anchored. Copy to avoid mutating a shared Date.
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; // Mon=1..Sun=7
  t.setUTCDate(t.getUTCDate() + 4 - day); // move to Thursday of this week
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 864e5 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Deterministic hash of the current week key. */
function weekHash(): number {
  const k = weekKey();
  let h = 2166136261;
  for (let i = 0; i < k.length; i++) {
    h = Math.imul(h ^ k.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

/** Deterministic seed for this week's circuit (same for every player). */
export function weeklySeed(): number {
  return weekHash() % 1e9 || 13;
}

/** This week's city, rotating through the map list by week. */
export function weeklyMapIndex(mapCount: number): number {
  return weekHash() % mapCount;
}

/** This week's mode, rotating through the mode list by week. */
export function weeklyModeIndex(modeCount: number): number {
  // a different mixing constant so the mode doesn't track the map lockstep
  return (Math.imul(weekHash(), 40503) >>> 0) % modeCount;
}

// Coin prize for finishing position on the weekly circuit. Paid once per week,
// and only when you beat your previously-claimed placement (so replaying to a
// worse finish never pays again).
const PRIZE: Record<number, number> = { 1: 300, 2: 150, 3: 75 };
const CLAIM_KEY = 'minirush.weekly.claim';

export function prizeFor(place: number): number {
  return PRIZE[place] ?? 0;
}

/** The full prize table, for UI display. */
export const WEEKLY_PRIZES = PRIZE;

interface ClaimData {
  week: string;
  bestPlace: number; // best (lowest) place already paid for this week
}

function loadClaim(): ClaimData {
  try {
    const raw = JSON.parse(localStorage.getItem(CLAIM_KEY) ?? 'null') as ClaimData | null;
    if (raw && raw.week === weekKey()) return raw;
  } catch { /* fall through */ }
  return { week: weekKey(), bestPlace: 99 };
}

/**
 * Claim the weekly prize for a finishing place. Pays only the *incremental*
 * reward when you improve on an already-claimed placement this week, so you
 * can't farm it by re-racing. Returns coins credited (0 if nothing new).
 */
export function claimWeeklyPrize(place: number): number {
  const prize = prizeFor(place);
  if (prize <= 0) return 0;
  const claim = loadClaim();
  if (place >= claim.bestPlace) return 0; // not an improvement — already paid as much or more
  const alreadyPaid = prizeFor(claim.bestPlace <= 3 ? claim.bestPlace : 0);
  const delta = prize - alreadyPaid;
  claim.bestPlace = place;
  localStorage.setItem(CLAIM_KEY, JSON.stringify(claim));
  if (delta <= 0) return 0;
  deposit(delta);
  return delta;
}
