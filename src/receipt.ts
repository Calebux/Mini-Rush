// On-chain race receipts: how a run is written into a Nimiq transaction's data
// field. Pure and dependency-free, so organizer tooling and tests can check
// against the same format the game writes.

export interface RaceRecord {
  score: number;
  place: number;
  mapId: number;
  modeId: number;
}

/** A Weekly Cup run, as entered into the bounty. */
export interface CupRecord {
  week: string;  // ISO week key, e.g. "2026-W38"
  score: number;
  time: number;  // finish time in seconds
  place: number;
}

const hex = (n: number, max: number, width: number): string =>
  Math.max(0, Math.min(max, Math.round(Number.isFinite(n) ? n : 0)))
    .toString(16).padStart(width, '0');

/**
 * Pack a run into a receipt payload. `MR1` marks the format, then score,
 * place, map and mode as fixed-width hex — 19 bytes, well inside the 64-byte
 * data field a Nimiq extended transaction carries.
 */
export function encodeReceipt(run: RaceRecord): string {
  return `MR1${hex(run.score, 0xffffffff, 8)}${hex(run.place, 0xffff, 4)}` +
    `${hex(run.mapId, 0xff, 2)}${hex(run.modeId, 0xff, 2)}`;
}

/**
 * Weekly Cup bounty entry. `MR2`, the ISO week as YYWW, score (8 hex), finish
 * time in centiseconds (6 hex) and place (2 hex) — 23 bytes. The week names the
 * circuit, city and mode (all derived from it), so unlike MR1 an entry doesn't
 * depend on the order of the mode or map lists.
 */
export function encodeCupReceipt(run: CupRecord): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(run.week);
  const yyww = m ? `${m[1].slice(2)}${m[2]}` : '0000';
  return `MR2${yyww}${hex(run.score, 0xffffffff, 8)}` +
    `${hex(run.time * 100, 0xffffff, 6)}${hex(run.place, 0xff, 2)}`;
}
