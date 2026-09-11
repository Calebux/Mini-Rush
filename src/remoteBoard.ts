// Global boards over Supabase REST (PostgREST). Optional: without
// VITE_LB_URL/VITE_LB_KEY in .env.local everything silently stays local —
// the game must never break because a backend is missing or down.
//
// Identity is soft: the Nimiq address when connected, otherwise a per-device
// random id. One row per player per board, their best run kept. The daily board
// is keyed by day; the bounty board reuses the same table under
// "bounty-<week>" and keeps winning times. Anyone can write this table, so the
// bounty board is a live view only — the prize is decided from on-chain entries.
// Schema + setup: supabase/schema.sql

export interface RemoteEntry {
  day: string;
  player_id: string;
  tag: string;
  score: number;
  time_s: number;
  place: number;
  laps: number;
  car: string;
}

interface Run {
  tag: string; score: number; time: number; place: number; laps: number; car: string;
}

interface Board {
  key: string;   // value of the `day` column
  order: string; // PostgREST order clause, best first
  better: (run: Run, prev: { score: number; time_s: number }) => boolean;
}

const LB_URL = (import.meta.env.VITE_LB_URL as string | undefined)?.replace(/\/$/, '');
const LB_KEY = import.meta.env.VITE_LB_KEY as string | undefined;
const PID_KEY = 'minirush.pid';
const TABLE = 'daily_scores';

const daily = (day: string): Board => ({
  key: day, order: 'score.desc,time_s.asc', better: (run, prev) => run.score > prev.score
});
const bounty = (week: string): Board => ({
  key: `bounty-${week}`, order: 'time_s.asc,created_at.asc', better: (run, prev) => run.time < prev.time_s
});

export const remoteEnabled = (): boolean => Boolean(LB_URL && LB_KEY);

/** Stable player identity: wallet if we have one, else a sticky device id. */
export function playerId(wallet?: string | null): string {
  if (wallet) return wallet.toLowerCase();
  let id = localStorage.getItem(PID_KEY);
  if (!id) {
    id = `dev-${crypto.randomUUID()}`;
    localStorage.setItem(PID_KEY, id);
  }
  return id;
}

const headers = (): Record<string, string> => ({
  apikey: LB_KEY!,
  Authorization: `Bearer ${LB_KEY}`,
  'Content-Type': 'application/json'
});

/** A board's top runs, best first. [] on any failure. */
async function top(board: Board, limit: number): Promise<RemoteEntry[]> {
  if (!remoteEnabled()) return [];
  try {
    const res = await fetch(
      `${LB_URL}/rest/v1/${TABLE}?day=eq.${encodeURIComponent(board.key)}` +
        `&order=${board.order}&limit=${limit}`,
      { headers: headers() }
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as RemoteEntry[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/**
 * Publish a run — upserts the player's row only when it beats their last one.
 * Fire-and-forget: resolves to the achieved rank (1-based) or 0 on failure.
 */
async function submit(board: Board, run: Run, wallet?: string | null): Promise<number> {
  if (!remoteEnabled()) return 0;
  const id = playerId(wallet);
  const rankOf = async (): Promise<number> => {
    const i = (await top(board, 100)).findIndex((e) => e.player_id === id);
    return i < 0 ? 0 : i + 1;
  };
  try {
    const mine = await fetch(
      `${LB_URL}/rest/v1/${TABLE}?day=eq.${encodeURIComponent(board.key)}` +
        `&player_id=eq.${encodeURIComponent(id)}&select=score,time_s`,
      { headers: headers() }
    );
    const existing = mine.ok ? ((await mine.json()) as { score: number; time_s: number }[]) : [];
    if (existing[0] && !board.better(run, existing[0])) return rankOf();
    const res = await fetch(`${LB_URL}/rest/v1/${TABLE}?on_conflict=day,player_id`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify([{
        day: board.key, player_id: id, tag: run.tag, score: run.score,
        time_s: run.time, place: run.place, laps: run.laps, car: run.car
      }])
    });
    if (!res.ok) return 0;
    return rankOf();
  } catch {
    return 0;
  }
}

/** Today's global top runs, best score first. */
export const topDaily = (day: string, limit = 10): Promise<RemoteEntry[]> => top(daily(day), limit);

export const submitDaily = (day: string, run: Run, wallet?: string | null): Promise<number> =>
  submit(daily(day), run, wallet);

/** This week's fastest bounty race wins, worldwide. */
export const topBounty = (week: string, limit = 10): Promise<RemoteEntry[]> => top(bounty(week), limit);

/** Post a bounty race win; only a faster time replaces the player's row. */
export const submitBounty = (week: string, run: Run, wallet?: string | null): Promise<number> =>
  submit(bounty(week), run, wallet);
