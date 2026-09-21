/**
 * The worldwide boards, over Convex (convex/boards.ts, convex/weekend.ts) — the
 * same backend the bounty weeks and the player counter use, read and written
 * with plain fetch so the game carries no client library.
 *
 * Everything here fails silently: without a Convex URL, offline, or on an
 * error the game falls back to the boards held on the phone. A race must never
 * wait on a board.
 */
import { deviceId } from './usage';

const CONVEX_URL = (import.meta.env.VITE_CONVEX_URL as string | undefined)?.trim().replace(/\/+$/, '');
const TIMEOUT_MS = 6000;

/** A row on the daily or bounty board. */
export interface BoardRun {
  pid: string;
  tag: string;
  score: number;
  timeS: number;
  place: number;
  laps: number;
  car: string;
}

export interface WeekendRun {
  pid: string;
  tag: string;
  timeS: number;
  score: number;
  car: string;
  ghost: string;
}

export const boardsEnabled = (): boolean => !!CONVEX_URL;

/** One Convex call, JSON in and out. Resolves to null on any failure. */
export async function convexCall(
  kind: 'query' | 'mutation', path: string, args: unknown
): Promise<unknown> {
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
  const value = await convexCall('query', 'weekend:top', { week, limit });
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
  const rank = await convexCall('mutation', 'weekend:post', { week, pid, ...run });
  return typeof rank === 'number' && rank > 0 ? rank : 0;
}

/** The device this phone posts under — its own rows are marked on the boards. */
export const boardPlayerId = (): string | null => deviceId();

const boardRows = (value: unknown): BoardRun[] => Array.isArray(value)
  ? value.filter((r): r is BoardRun =>
    !!r && typeof r === 'object'
    && typeof (r as BoardRun).tag === 'string'
    && Number.isFinite((r as BoardRun).score)
    && Number.isFinite((r as BoardRun).timeS))
  : [];

/** Today's best runs worldwide, highest score first. */
export const topDaily = async (day: string, limit = 10): Promise<BoardRun[]> =>
  boardRows(await convexCall('query', 'boards:topDaily', { day, limit }));

/** This week's fastest bounty wins worldwide. */
export const topBounty = async (week: string, limit = 10): Promise<BoardRun[]> =>
  boardRows(await convexCall('query', 'boards:topBounty', { week, limit }));

type Posted = { tag: string; score: number; timeS: number; place: number; laps: number; car: string };

async function postRun(path: string, key: Record<string, string>, run: Posted): Promise<number> {
  const pid = deviceId();
  if (!pid) return 0;
  const rank = await convexCall('mutation', path, { ...key, pid, ...run });
  return typeof rank === 'number' && rank > 0 ? rank : 0;
}

/** Post today's run; only a better score replaces this device's row. */
export const postDaily = (day: string, run: Posted): Promise<number> =>
  postRun('boards:postDaily', { day }, run);

/** Post a bounty race win; only a faster time replaces this device's row. */
export const postBounty = (week: string, run: Posted): Promise<number> =>
  postRun('boards:postBounty', { week }, run);
