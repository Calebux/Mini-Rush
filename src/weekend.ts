// The Weekend GP. Saturday and Sunday (UTC) the same long circuit is open to
// everyone: 8 laps, a pro field, and the ghosts of the fastest players who have
// already run it that weekend, so you are racing their lines rather than an AI
// alone. Outside the window the card counts down to the next one.
//
// Everything about the circuit derives from the ISO week, exactly like the
// bounty race, so there is no backend deciding what people race. The only
// thing that travels over the network is a finished lap line (src/ghostShare.ts).
import { weekKey } from './weekly';

export const WEEKEND_LAPS = 8;
/** How many other players' ghosts share the track with you. */
export const WEEKEND_GHOSTS = 3;

/** ISO week the weekend belongs to — the board key, e.g. "2026-W38". */
export const weekendKey = (): string => weekKey();

function hash(): number {
  const k = `weekend-${weekKey()}`;
  let h = 2166136261;
  for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** This weekend's circuit seed — its own, not the Weekly Cup's or the bounty's. */
export const weekendSeed = (): number => hash() % 1e9 || 29;

/** This weekend's city. */
export function weekendMapIndex(mapCount: number): number {
  if (!Number.isFinite(mapCount) || mapCount <= 0) return 0;
  return (Math.imul(hash(), 2654435761) >>> 0) % Math.floor(mapCount);
}

/**
 * Saturday 00:00 UTC to Sunday 23:59:59 UTC. `now` is injectable so the window
 * can be tested without waiting for a weekend.
 */
export function weekendOpen(now = new Date()): boolean {
  const day = now.getUTCDay();
  return day === 6 || day === 0;
}

/** Milliseconds until the gates open, or 0 while they are open. */
export function msToWeekend(now = new Date()): number {
  if (weekendOpen(now)) return 0;
  const days = (6 - now.getUTCDay() + 7) % 7; // next Saturday
  const open = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days);
  return Math.max(0, open - now.getTime());
}

/** Milliseconds until the gates close, or 0 while they are shut. */
export function msToClose(now = new Date()): number {
  if (!weekendOpen(now)) return 0;
  const days = now.getUTCDay() === 6 ? 2 : 1; // Sat → Mon, Sun → Mon
  const close = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days);
  return Math.max(0, close - now.getTime());
}

/** "2d 4h" / "6h 20m" / "14m" — a countdown people can read at a glance. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400), h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}
