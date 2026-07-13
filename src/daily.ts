// Daily challenge: one shared circuit per UTC day. Seed and map derive from
// the date alone, so every player races the same track with no backend.

/** UTC day stamp, e.g. "2026-07-12" — keys the daily leaderboard + ghost. */
export const dayKey = (): string => new Date().toISOString().slice(0, 10);

/** Deterministic seed for today's circuit (same for every player). */
export function dailySeed(): number {
  const d = new Date();
  const n = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  return (Math.imul(n, 2654435761) >>> 0) % 1e9 || 7;
}

/** Today's tour stop rotates through the map list by day-of-year. */
export function dailyMapIndex(mapCount: number): number {
  const d = new Date();
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const doy = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 864e5);
  return doy % mapCount;
}
