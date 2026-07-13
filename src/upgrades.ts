// The garage workshop. Coins buy per-car upgrade tiers that multiply the
// CarSpec stats — the coin sink that keeps racing for coins meaningful
// after the cars themselves are owned. Stored like economy.ts.
import { CarSpec } from './cars';
import { spend } from './economy';

export type UpgradeStat = 'speed' | 'grip' | 'nitro';

export const MAX_TIER = 3;
export const TIER_COST = [60, 120, 240]; // tier 1 / 2 / 3
export const UPGRADE_LABEL: Record<UpgradeStat, string> = {
  speed: 'ENGINE', grip: 'TIRES', nitro: 'TANK'
};

// per-tier multiplier bumps — small on speed (it compounds with everything),
// chunkier on grip/nitro which only shine in corners/bursts
const BONUS: Record<UpgradeStat, number> = { speed: 0.03, grip: 0.06, nitro: 0.1 };

const KEY = 'minirush.upgrades';

type Store = Record<string, Partial<Record<UpgradeStat, number>>>;

function load(): Store {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Store;
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export function tier(carId: string, stat: UpgradeStat): number {
  const t = load()[carId]?.[stat] ?? 0;
  return Math.min(MAX_TIER, Math.max(0, Math.floor(t)));
}

/** Buy the next tier from the coin bank. False = maxed or can't afford. */
export function buyTier(carId: string, stat: UpgradeStat): boolean {
  const t = tier(carId, stat);
  if (t >= MAX_TIER || !spend(TIER_COST[t])) return false;
  const store = load();
  store[carId] = { ...store[carId], [stat]: t + 1 };
  localStorage.setItem(KEY, JSON.stringify(store));
  return true;
}

/** The spec the race actually uses — base car plus its bought tiers. */
export function applyUpgrades(spec: CarSpec): CarSpec {
  return {
    ...spec,
    speed: spec.speed * (1 + BONUS.speed * tier(spec.id, 'speed')),
    grip: spec.grip * (1 + BONUS.grip * tier(spec.id, 'grip')),
    nitro: spec.nitro * (1 + BONUS.nitro * tier(spec.id, 'nitro'))
  };
}
