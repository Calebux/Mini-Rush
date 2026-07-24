// Local arcade leaderboard — top N runs in localStorage, tagged with a
// 3-letter arcade tag. A shared on-chain/global board would need a backend;
// this keeps the loop ("beat the couch") working fully offline.
export interface BoardEntry {
  tag: string;
  score: number;
  place: number; // finishing position 1..4
  time: number;  // race time in seconds
  laps: number;
  car: string;   // car display name
  at: number;    // Date.now() of the run
}

const BOARD_KEY = 'minirush.board';
const DAILY_PREFIX = 'minirush.board.daily.';
const WEEKLY_PREFIX = 'minirush.board.weekly.';
const TAG_KEY = 'minirush.tag';
export const BOARD_SIZE = 10;

const sanitizeTag = (t: string): string =>
  t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export class Leaderboard {
  get tag(): string {
    return sanitizeTag(localStorage.getItem(TAG_KEY) || '') || 'ACE';
  }

  set tag(t: string) {
    localStorage.setItem(TAG_KEY, sanitizeTag(t) || 'ACE');
  }

  entries(): BoardEntry[] {
    return this.read(BOARD_KEY);
  }

  /** Record a run. Returns its 1-based rank, or 0 if it missed the board. */
  submit(run: Omit<BoardEntry, 'tag' | 'at'>): number {
    return this.submitTo(BOARD_KEY, run);
  }

  /** Daily challenge runs land on their own per-day board. */
  submitDaily(day: string, run: Omit<BoardEntry, 'tag' | 'at'>): number {
    this.pruneDaily(day);
    return this.submitTo(DAILY_PREFIX + day, run);
  }

  dailyEntries(day: string): BoardEntry[] {
    return this.read(DAILY_PREFIX + day);
  }

  /** Weekly Cup runs land on their own per-week board. */
  submitWeekly(week: string, run: Omit<BoardEntry, 'tag' | 'at'>): number {
    this.pruneWeekly(week);
    return this.submitTo(WEEKLY_PREFIX + week, run);
  }

  weeklyEntries(week: string): BoardEntry[] {
    return this.read(WEEKLY_PREFIX + week);
  }

  private submitTo(key: string, run: Omit<BoardEntry, 'tag' | 'at'>): number {
    const entry: BoardEntry = { ...run, tag: this.tag, at: Date.now() };
    const all = [...this.read(key), entry]
      .sort((a, b) => b.score - a.score || a.time - b.time)
      .slice(0, BOARD_SIZE);
    localStorage.setItem(key, JSON.stringify(all));
    const rank = all.indexOf(entry);
    return rank < 0 ? 0 : rank + 1;
  }

  private read(key: string): BoardEntry[] {
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? '[]') as BoardEntry[];
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
          tag: sanitizeTag(entry.tag ?? '') || 'ACE',
          score: Math.max(0, Math.floor(toFiniteNumber(entry.score))),
          place: Math.max(1, Math.floor(toFiniteNumber(entry.place, 4))),
          time: Math.max(0, toFiniteNumber(entry.time)),
          laps: Math.max(1, Math.floor(toFiniteNumber(entry.laps, 1))),
          car: String(entry.car ?? 'Unknown'),
          at: Math.max(0, Math.floor(toFiniteNumber(entry.at)))
        }))
        .sort((a, b) => b.score - a.score || a.time - b.time)
        .slice(0, BOARD_SIZE);
    } catch {
      return [];
    }
  }

  /** Yesterday's daily boards are dead weight — drop any that aren't today's. */
  private pruneDaily(today: string): void {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(DAILY_PREFIX) && k !== DAILY_PREFIX + today) {
        localStorage.removeItem(k);
      }
    }
  }

  /** Last week's cup boards are dead weight — drop any that aren't this week's. */
  private pruneWeekly(week: string): void {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(WEEKLY_PREFIX) && k !== WEEKLY_PREFIX + week) {
        localStorage.removeItem(k);
      }
    }
  }
}
