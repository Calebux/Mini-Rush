/**
 * The Weekend GP board, over Convex (convex/weekend.ts) — the same backend the
 * bounty weeks and the player counter use, read and written with plain fetch
 * so the game carries no client library.
 *
 * Everything here fails silently: without a Convex URL, offline, or on an
 * error the event still runs against the AI field and your own ghost. A race
 * must never wait on a board.
 */
import { deviceId } from './usage';

const CONVEX_URL = (import.meta.env.VITE_CONVEX_URL as string | undefined)?.trim().replace(/\/+$/, '');
const TIMEOUT_MS = 6000;

export interface WeekendRun {
  pid: string;
  tag: string;
  timeS: number;
  score: number;
  car: string;
  ghost: string;
}

export const weekendBoardEnabled = (): boolean => !!CONVEX_URL;

async function call(kind: 'query' | 'mutation', path: string, args: unknown): Promise<unknown> {
  if (!CONVEX_URL) return null;
  const abort = new AbortController();
  const timer = window.setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${CONVEX_URL}/api/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, args, format: 'json' }),
      signal: abort.signal
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { status?: string; value?: unknown };
    return body?.status === 'success' ? body.value : null;
  } catch {
    return null; // offline, blocked, or slow — the race goes on
  } finally {
    window.clearTimeout(timer);
  }
}

/** This weekend's fastest runs, best first. [] on any failure. */
export async function topWeekendRuns(week: string, limit = 5): Promise<WeekendRun[]> {
  const value = await call('query', 'weekend:top', { week, limit });
  if (!Array.isArray(value)) return [];
  return value.filter((r): r is WeekendRun =>
    !!r && typeof r === 'object'
    && typeof (r as WeekendRun).ghost === 'string'
    && typeof (r as WeekendRun).tag === 'string'
    && Number.isFinite((r as WeekendRun).timeS));
}

/** Post a finished weekend run. Resolves to its rank, or 0 if it didn't count. */
export async function postWeekendRun(
  week: string, run: { tag: string; timeS: number; score: number; place: number; car: string; ghost: string }
): Promise<number> {
  const pid = deviceId();
  if (!pid || !run.ghost) return 0;
  const rank = await call('mutation', 'weekend:post', { week, pid, ...run });
  return typeof rank === 'number' && rank > 0 ? rank : 0;
}

/** The device this phone posts under, so its own run isn't raced as a ghost. */
export const weekendPlayerId = (): string | null => deviceId();
