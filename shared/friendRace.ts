/** Friendly, non-staked racing. Position checks are plausibility checks, not authoritative physics. */
export const FRIEND_LENGTH = 1800;
export const FRIEND_SEED = 731906;
export const FRIEND_TIMEOUT = 20_000;
export const FRIEND_DURATION = 240_000;
// A waiting guest must not block an active host for the full invite lifetime.
export const FRIEND_LOBBY_TIMEOUT = 60_000;
export interface FriendDriver {
  name: string; ready: boolean; loaded: boolean; seen: number;
  s: number; x: number; v: number; seq: number; sampleAt: number;
  finishAt: number | null; dnf: boolean;
}
export interface FriendRoom {
  code: string; round: number; state: 'lobby' | 'loading' | 'race' | 'finished' | 'closed';
  startAt: number; expiresAt: number; players: FriendDriver[];
}
export function validFriendSample(p: FriendDriver, s: number, x: number, v: number, seq: number, now: number, start: number): boolean {
  return [s, x, v, seq].every(Number.isFinite) && Number.isSafeInteger(seq) && seq > p.seq
    && s >= p.s - 2 && s >= 0 && s <= FRIEND_LENGTH && Math.abs(x) <= 10 && v >= 0 && v <= 100
    && now >= start && now - p.sampleAt >= 100
    && s <= (now - start) / 1000 * 100 + 3
    && s - p.s <= (now - Math.max(p.sampleAt, start)) / 1000 * 100 + 3;
}
