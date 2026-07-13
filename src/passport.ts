// World Tour passport. Finishing a race in a city stamps it; each stamp
// unlocks the next stop on the tour. All local, same pattern as economy.ts.
// The daily run ignores locks (same circuit for everyone) but still stamps.
import { MAPS } from './maps';

const KEY = 'minirush.stamps';

export function stamps(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[];
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

/** Stamp a city. Returns true only the first time. */
export function stamp(id: string): boolean {
  const s = stamps();
  if (s.has(id)) return false;
  s.add(id);
  localStorage.setItem(KEY, JSON.stringify([...s]));
  return true;
}

/** First city is always open; each later one needs the previous stamped. */
export function mapUnlocked(index: number): boolean {
  return index <= 0 || stamps().has(MAPS[index - 1].id);
}
