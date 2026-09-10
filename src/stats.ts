// Persistent local stats. Every finished race records aggregated totals
// for the profile / stats dashboard. Lightweight — one JSON blob in localStorage.

const KEY = 'minirush.stats';

export interface LocalStats {
  totalRaces: number;
  wins: number;          // 1st place finishes
  coinsTotal: number;    // lifetime coins collected
  bestScore: number;
  modeRaces: Record<string, number>;  // modeId → count
  mapRaces: Record<string, number>;   // mapId → count
  driftBest: number;     // longest single drift chain (seconds)
}

function defaultStats(): LocalStats {
  return {
    totalRaces: 0, wins: 0, coinsTotal: 0, bestScore: 0,
    modeRaces: {}, mapRaces: {}, driftBest: 0
  };
}

function whole(n: unknown): number {
  return Number.isFinite(Number(n)) ? Math.max(0, Math.floor(Number(n))) : 0;
}

function countMap(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const n = whole(value);
    if (key && n > 0) out[key] = n;
  }
  return out;
}

function load(): LocalStats {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as LocalStats | null;
    if (!raw || typeof raw !== 'object') return defaultStats();
    return {
      totalRaces: whole(raw.totalRaces),
      wins: whole(raw.wins),
      coinsTotal: whole(raw.coinsTotal),
      bestScore: whole(raw.bestScore),
      modeRaces: countMap(raw.modeRaces),
      mapRaces: countMap(raw.mapRaces),
      driftBest: Number.isFinite(Number(raw.driftBest)) ? Math.max(0, Number(raw.driftBest)) : 0
    };
  } catch {
    return defaultStats();
  }
}

function save(s: LocalStats): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

/** Record a finished race. */
export function recordLocalRace(data: {
  place: number;
  score: number;
  coins: number;
  modeId: string;
  mapId: string;
  driftBest?: number;
}): void {
  const s = load();
  s.totalRaces++;
  if (data.place === 1) s.wins++;
  s.coinsTotal += whole(data.coins);
  if (data.score > s.bestScore) s.bestScore = whole(data.score);
  s.modeRaces[data.modeId] = (s.modeRaces[data.modeId] ?? 0) + 1;
  s.mapRaces[data.mapId] = (s.mapRaces[data.mapId] ?? 0) + 1;
  if (data.driftBest && data.driftBest > s.driftBest) s.driftBest = data.driftBest;
  save(s);
}

/** Get aggregated stats for display. */
export function getStats(): LocalStats {
  return load();
}

/** Most-played mode id, or 'gp' if no data. */
export function favoriteMode(): string {
  const s = load();
  let best = 'gp', max = 0;
  for (const [id, count] of Object.entries(s.modeRaces)) {
    if (count > max) { max = count; best = id; }
  }
  return best;
}

/** Win rate as a percentage string. */
export function winRate(): string {
  const s = load();
  if (s.totalRaces === 0) return '—';
  return `${Math.round((s.wins / s.totalRaces) * 100)}%`;
}
