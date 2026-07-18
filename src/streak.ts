// Weekly streak: tracks which UTC days the player completed a daily race.
// 3-day streak → 25 coins, 5-day → 50, 7-day → 100. Each milestone pays once.
import { deposit } from './economy';

const KEY = 'minirush.streak';
const CLAIMED_KEY = 'minirush.streak.claimed';

interface StreakData {
  days: string[]; // ISO date strings (UTC), sorted ascending
}

const MILESTONES: [number, number][] = [[3, 25], [5, 50], [7, 100]];

function load(): StreakData {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{"days":[]}') as StreakData;
    return raw && Array.isArray(raw.days) ? raw : { days: [] };
  } catch {
    return { days: [] };
  }
}

function save(data: StreakData): void {
  localStorage.setItem(KEY, JSON.stringify(data));
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function claimedSet(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(CLAIMED_KEY) ?? '[]') as string[];
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function saveClaimed(set: Set<string>): void {
  localStorage.setItem(CLAIMED_KEY, JSON.stringify([...set]));
}

/** Mark today as a completed daily race. */
export function recordDay(): void {
  const d = load();
  const t = today();
  if (d.days.includes(t)) return;
  d.days.push(t);
  // keep only the last 14 days to prevent unbounded growth
  if (d.days.length > 14) d.days = d.days.slice(-14);
  save(d);
}

/** Consecutive days played including today. */
export function currentStreak(): number {
  const d = load();
  if (d.days.length === 0) return 0;
  const t = today();
  // walk backwards from today counting consecutive days
  let streak = 0;
  const check = new Date(t + 'T00:00:00Z');
  for (let i = 0; i < 14; i++) {
    const dayStr = check.toISOString().slice(0, 10);
    if (d.days.includes(dayStr)) {
      streak++;
    } else if (i > 0) {
      // gap found after the first day — streak broken
      break;
    }
    // if today itself isn't in the list, streak is 0
    if (i === 0 && !d.days.includes(dayStr)) return 0;
    check.setUTCDate(check.getUTCDate() - 1);
  }
  return streak;
}

/** How many of the last 7 days (including today) were played. */
export function weekProgress(): boolean[] {
  const d = load();
  const result: boolean[] = [];
  const check = new Date(today() + 'T00:00:00Z');
  // go back 6 days, then forward to today = 7 entries
  check.setUTCDate(check.getUTCDate() - 6);
  for (let i = 0; i < 7; i++) {
    result.push(d.days.includes(check.toISOString().slice(0, 10)));
    check.setUTCDate(check.getUTCDate() + 1);
  }
  return result;
}

/**
 * Check if a milestone was reached and pay the reward.
 * Returns { milestone, coins } if a reward was just paid, null otherwise.
 */
export function checkReward(): { milestone: number; coins: number } | null {
  const streak = currentStreak();
  const claimed = claimedSet();
  // find the highest unclaimed milestone the player qualifies for
  for (let i = MILESTONES.length - 1; i >= 0; i--) {
    const [days, coins] = MILESTONES[i];
    const key = `${today()}-${days}`;
    if (streak >= days && !claimed.has(key)) {
      deposit(coins);
      claimed.add(key);
      saveClaimed(claimed);
      return { milestone: days, coins };
    }
  }
  return null;
}
