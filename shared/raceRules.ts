// Plausibility checks for a testnet game server, not authoritative physics replay.
export interface Progress {
  startedAt: number; sampledAt: number; progress: number; elapsed: number;
  distance: number; samples: number;
}
export function checkProgress(race: Progress, progress: number, elapsed: number, now: number, finish: boolean): void {
  if (![progress, elapsed, now].every(Number.isFinite)) throw new Error('invalid telemetry');
  if (now - race.startedAt > 30 * 60_000) throw new Error('race session expired');
  if (elapsed < race.elapsed || progress < race.progress || progress > race.distance + 100) throw new Error('invalid progress');
  const wall = (now - race.startedAt) / 1000;
  const step = Math.min((now - race.sampledAt) / 1000, elapsed - race.elapsed);
  if (elapsed > wall + 3 || progress - race.progress > Math.max(0, step) * 80 + 20) throw new Error('impossible pace');
  if (!finish && now - race.sampledAt < 2000) throw new Error('checkpoint too soon');
  if (finish && (elapsed < 40 || wall < 40 || race.samples < 4 || progress < race.distance)) throw new Error('complete a full race to earn salvage');
}

/** RUSH and salvage for a finished race; mirrors `race_rush` in contracts/near/src/components.rs. */
export const RACE_PAYOUT = { first: 45, second: 36, third: 30, finish: 24, alloy: 2, circuit: 1 } as const;
/** Only a podium finish selects a bonus tier; every other value is a plain finish. */
export function rewardPlace(place: unknown): 0 | 1 | 2 | 3 { return place === 1 || place === 2 || place === 3 ? place : 0; }
export function raceRush(place: unknown): number {
  const tier = rewardPlace(place);
  return tier === 1 ? RACE_PAYOUT.first : tier === 2 ? RACE_PAYOUT.second : tier === 3 ? RACE_PAYOUT.third : RACE_PAYOUT.finish;
}
