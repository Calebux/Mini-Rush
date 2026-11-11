import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkProgress, RACE_PAYOUT, raceRush, rewardPlace } from '../shared/raceRules.ts';
const start = 1_000_000;
let race = { startedAt: start, sampledAt: start, progress: 0, elapsed: 0, distance: 1800, samples: 0 };
for (let elapsed = 4; elapsed <= 56; elapsed += 4) {
  const progress = elapsed * 30;
  checkProgress(race, progress, elapsed, start + elapsed * 1000, false);
  race = { ...race, sampledAt: start + elapsed * 1000, progress, elapsed, samples: race.samples + 1 };
}
checkProgress(race, 1800, 60, start + 60_000, true);
assert.throws(() => checkProgress(race, NaN, 60, start + 60_000, true), /invalid telemetry/);
assert.throws(() => checkProgress(race, 1800, 60, start + 56_100, true), /impossible pace/);
assert.throws(() => checkProgress(race, 1000, 60, start + 60_000, true), /invalid progress/);
assert.throws(() => checkProgress(race, 1800, 60, start + 31 * 60_000, true), /expired/);
assert.throws(() => checkProgress({ ...race, samples: 0 }, 1800, 60, start + 60_000, true), /full race/);
assert.throws(() => checkProgress({ ...race, distance: 2400 }, 1800, 60, start + 60_000, true), /full race/);
assert.throws(() => checkProgress(race, 1681, 57, start + 56_500, false), /too soon/);
assert.throws(() => checkProgress({ ...race, elapsed: 20, progress: 400, distance: 500 }, 500, 25, start + 60_000, true), /full race/);
// Only a whole-number podium picks a bonus tier; anything else a client sends is a plain finish.
assert.deepEqual([1, 2, 3, 4, 0, -1, 1.5, '1', null, undefined, NaN, 255].map(rewardPlace), [1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
assert.deepEqual([1, 2, 3, 4, undefined].map(raceRush), [45, 36, 30, 24, 24]);
// The server reports what the contract mints, so the two payout tables must be the same numbers.
const rust = await readFile(new URL('../contracts/near/src/components.rs', import.meta.url), 'utf8');
const tiers = rust.match(/match place \{ Some\(1\) => (\d+), Some\(2\) => (\d+), Some\(3\) => (\d+), _ => (\d+) \}/);
assert.ok(tiers, 'race_rush tiers not found in the contract');
assert.deepEqual(tiers.slice(1).map(Number), [RACE_PAYOUT.first, RACE_PAYOUT.second, RACE_PAYOUT.third, RACE_PAYOUT.finish]);
assert.ok(rust.includes(`[(RUSH,rush), (ALLOY,${RACE_PAYOUT.alloy}), (CIRCUIT,${RACE_PAYOUT.circuit})]`), 'salvage amounts differ from the contract');
console.log('PASS: plausible complete race, teleports, non-finite values, reverse progress, expiry, checkpoints, short/incomplete races, podium tiers match the contract.');
