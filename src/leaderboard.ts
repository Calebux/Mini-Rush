// Local arcade leaderboard — top N runs in localStorage under the player's
// driver name. A shared on-chain/global board would need a backend; this keeps
// the loop ("beat the couch") working fully offline.
import { driverName, USERNAME_MAX } from './driver';

export interface BoardEntry {
  tag: string;   // driver name the run was set under (older runs carry 3-letter tags)
  score: number;
  place: number; // finishing position
  time: number;  // race time in seconds
  laps: number;
  car: string;   // car display name
  at: number;    // Date.now() of the run
}

type Run = Omit<BoardEntry, 'tag' | 'at'>;
type Order = (a: BoardEntry, b: BoardEntry) => number;

const BOARD_KEY = 'minirush.board';
const DAILY_PREFIX = 'minirush.board.daily.';
const WEEKLY_PREFIX = 'minirush.board.weekly.';
const BOUNTY_PREFIX = 'minirush.board.bounty.';
export const BOARD_SIZE = 10;

// score boards rank the score; the bounty board ranks winning times
const byScore: Order = (a, b) => b.score - a.score || a.time - b.time;
const byTime: Order = (a, b) => a.time - b.time || b.score - a.score;

const sanitizeName = (t: string): string =>
  t.toUpperCase().replace(/[^A-Z0-9 _-]/g, '').replace(/\s+/g, ' ').trim().slice(0, USERNAME_MAX);

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export class Leaderboard {
  entries(): BoardEntry[] {
    return this.read(BOARD_KEY, byScore);
  }

  /** Record a run. Returns its 1-based rank, or 0 if it missed the board. */
  submit(run: Run): number {
    return this.submitTo(BOARD_KEY, run, byScore);
  }

  /** Daily challenge runs land on their own per-day board. */
  submitDaily(day: string, run: Run): number {
    this.prune(DAILY_PREFIX, day);
    return this.submitTo(DAILY_PREFIX + day, run, byScore);
  }

  dailyEntries(day: string): BoardEntry[] {
    return this.read(DAILY_PREFIX + day, byScore);
  }

  /** Weekly Cup runs land on their own per-week board. */
  submitWeekly(week: string, run: Run): number {
    this.prune(WEEKLY_PREFIX, week);
    return this.submitTo(WEEKLY_PREFIX + week, run, byScore);
  }

  weeklyEntries(week: string): BoardEntry[] {
    return this.read(WEEKLY_PREFIX + week, byScore);
  }

  /** Bounty race wins, fastest first. Only a win belongs on this board. */
  submitBounty(week: string, run: Run): number {
    this.prune(BOUNTY_PREFIX, week);
    return this.submitTo(BOUNTY_PREFIX + week, run, byTime);
  }

  bountyEntries(week: string): BoardEntry[] {
    return this.read(BOUNTY_PREFIX + week, byTime);
  }

  private submitTo(key: string, run: Run, order: Order): number {
    const entry: BoardEntry = { ...run, tag: driverName(), at: Date.now() };
    const all = [...this.read(key, order), entry].sort(order).slice(0, BOARD_SIZE);
    localStorage.setItem(key, JSON.stringify(all));
    const rank = all.indexOf(entry);
    return rank < 0 ? 0 : rank + 1;
  }

  private read(key: string, order: Order): BoardEntry[] {
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? '[]') as BoardEntry[];
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
          tag: sanitizeName(String(entry.tag ?? '')) || 'DRIVER',
          score: Math.max(0, Math.floor(toFiniteNumber(entry.score))),
          place: Math.max(1, Math.floor(toFiniteNumber(entry.place, 4))),
          time: Math.max(0, toFiniteNumber(entry.time)),
          laps: Math.max(1, Math.floor(toFiniteNumber(entry.laps, 1))),
          car: String(entry.car ?? 'Unknown'),
          at: Math.max(0, Math.floor(toFiniteNumber(entry.at)))
        }))
        .sort(order)
        .slice(0, BOARD_SIZE);
    } catch {
      return [];
    }
  }

  /** Boards from past days or weeks are dead weight — drop all but the current one. */
  private prune(prefix: string, current: string): void {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix) && k !== prefix + current) localStorage.removeItem(k);
    }
  }
}
