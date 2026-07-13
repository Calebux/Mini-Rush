// Global daily leaderboard over Supabase REST (PostgREST). Optional: without
// VITE_LB_URL/VITE_LB_KEY in .env.local everything silently stays local —
// the game must never break because a backend is missing or down.
//
// Identity is soft: the MiniPay wallet address when connected, otherwise a
// per-device random id. One row per player per day, best score wins.
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

const LB_URL = (import.meta.env.VITE_LB_URL as string | undefined)?.replace(/\/$/, '');
const LB_KEY = import.meta.env.VITE_LB_KEY as string | undefined;
const PID_KEY = 'minirush.pid';
const TABLE = 'daily_scores';

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

/** Today's global top runs, best first. [] on any failure. */
export async function topDaily(day: string, limit = 10): Promise<RemoteEntry[]> {
  if (!remoteEnabled()) return [];
  try {
    const res = await fetch(
      `${LB_URL}/rest/v1/${TABLE}?day=eq.${encodeURIComponent(day)}` +
        `&order=score.desc,time_s.asc&limit=${limit}`,
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
 * Publish a daily run — upserts the player's row, keeping their best.
 * Fire-and-forget: resolves to the achieved rank (1-based) or 0 on failure.
 */
export async function submitDaily(
  day: string,
  run: { tag: string; score: number; time: number; place: number; laps: number; car: string },
  wallet?: string | null
): Promise<number> {
  if (!remoteEnabled()) return 0;
  const id = playerId(wallet);
  try {
    // only overwrite our own row for a better score
    const mine = await fetch(
      `${LB_URL}/rest/v1/${TABLE}?day=eq.${encodeURIComponent(day)}` +
        `&player_id=eq.${encodeURIComponent(id)}&select=score`,
      { headers: headers() }
    );
    const existing = mine.ok ? ((await mine.json()) as { score: number }[]) : [];
    if (existing[0] && existing[0].score >= run.score) {
      return rankOf(day, id);
    }
    const res = await fetch(`${LB_URL}/rest/v1/${TABLE}?on_conflict=day,player_id`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify([{
        day, player_id: id, tag: run.tag, score: run.score,
        time_s: run.time, place: run.place, laps: run.laps, car: run.car
      }])
    });
    if (!res.ok) return 0;
    return rankOf(day, id);
  } catch {
    return 0;
  }
}

async function rankOf(day: string, id: string): Promise<number> {
  const top = await topDaily(day, 100);
  const i = top.findIndex((e) => e.player_id === id);
  return i < 0 ? 0 : i + 1;
}
