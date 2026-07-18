// Persistent local stats. Every finished race records aggregated totals
// for the profile / stats dashboard. Lightweight — one JSON blob in localStorage.

const KEY = 'minirush.stats';

export interface LocalStats {
  totalRaces: number;
  wins: number;          // 1st place finishes
  zombiesTotal: number;  // lifetime zombies squashed
  coinsTotal: number;    // lifetime coins collected
  bestScore: number;
  modeRaces: Record<string, number>;  // modeId → count
  mapRaces: Record<string, number>;   // mapId → count
  driftBest: number;     // longest single drift chain (seconds)
  bossKills: number;     // lifetime boss zombies killed
}

function defaultStats(): LocalStats {
  return {
    totalRaces: 0, wins: 0, zombiesTotal: 0, coinsTotal: 0, bestScore: 0,
    modeRaces: {}, mapRaces: {}, driftBest: 0, bossKills: 0
  };
}

function load(): LocalStats {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as LocalStats | null;
    return raw && typeof raw === 'object' && typeof raw.totalRaces === 'number'
      ? { ...defaultStats(), ...raw }
      : defaultStats();
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
  zombies: number;
  coins: number;
  modeId: string;
  mapId: string;
  driftBest?: number;
  bossKills?: number;
}): void {
  const s = load();
  s.totalRaces++;
  if (data.place === 1) s.wins++;
  s.zombiesTotal += data.zombies;
  s.coinsTotal += data.coins;
  if (data.score > s.bestScore) s.bestScore = data.score;
  s.modeRaces[data.modeId] = (s.modeRaces[data.modeId] ?? 0) + 1;
  s.mapRaces[data.mapId] = (s.mapRaces[data.mapId] ?? 0) + 1;
  if (data.driftBest && data.driftBest > s.driftBest) s.driftBest = data.driftBest;
  s.bossKills += data.bossKills ?? 0;
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
