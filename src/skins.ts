// Car skins: alternate paint jobs purchased with coins. Each car can have
// multiple color variants. Active skin swaps the car's color (underglow +
// toon material). Same spend/own pattern as economy.ts.
import { spend } from './economy';

export interface Skin {
  name: string;
  color: number;
  price: number;
}

// Skins per car id — the first entry is always the stock color (free, already owned).
export const CAR_SKINS: Record<string, Skin[]> = {
  viper: [
    { name: 'Stock', color: 0xff2e8a, price: 0 },
    { name: 'Midnight', color: 0x1a1a3a, price: 80 },
    { name: 'Arctic', color: 0xd0e8ff, price: 80 },
    { name: 'Toxic', color: 0x3dff6e, price: 120 }
  ],
  sunburst: [
    { name: 'Stock', color: 0xff9a1f, price: 0 },
    { name: 'Cherry', color: 0xcc1133, price: 80 },
    { name: 'Solar', color: 0xffdd00, price: 80 },
    { name: 'Stealth', color: 0x2a2a32, price: 120 }
  ],
  gecko: [
    { name: 'Stock', color: 0xa3ff2e, price: 0 },
    { name: 'Ocean', color: 0x1f8aff, price: 80 },
    { name: 'Coral', color: 0xff6b5e, price: 80 },
    { name: 'Phantom', color: 0x4a2a6f, price: 120 }
  ],
  phantom: [
    { name: 'Stock', color: 0x8b5cf6, price: 0 },
    { name: 'Blaze', color: 0xff4422, price: 100 },
    { name: 'Gold', color: 0xffc846, price: 100 },
    { name: 'Ghost', color: 0xe8ecff, price: 140 }
  ],
  volt: [
    { name: 'Stock', color: 0x00d9ff, price: 0 },
    { name: 'Lava', color: 0xff3b1f, price: 100 },
    { name: 'Neon Pink', color: 0xff2eaa, price: 100 },
    { name: 'Carbon', color: 0x222228, price: 140 }
  ],
  // New cars get skins too
  juggernaut: [
    { name: 'Stock', color: 0x556b2f, price: 0 },
    { name: 'Urban Camo', color: 0x5a5a5a, price: 100 },
    { name: 'Rust', color: 0x8b4513, price: 100 },
    { name: 'White Out', color: 0xe8e8e0, price: 140 }
  ],
  sidewinder: [
    { name: 'Stock', color: 0xff6ec7, price: 0 },
    { name: 'Drift King', color: 0x00ffcc, price: 100 },
    { name: 'Sunset', color: 0xff8844, price: 100 },
    { name: 'Void', color: 0x0a0a1a, price: 140 }
  ],
  glasscannon: [
    { name: 'Stock', color: 0xffd700, price: 0 },
    { name: 'Chrome', color: 0xc0c0c8, price: 120 },
    { name: 'Inferno', color: 0xff2200, price: 120 },
    { name: 'Ice', color: 0xaaddff, price: 160 }
  ]
};

const ACTIVE_KEY = 'minirush.skins';

interface SkinStore {
  active: Record<string, number>;  // carId → skinIndex
  owned: Record<string, number[]>; // carId → owned indices
}

function load(): SkinStore {
  try {
    const raw = JSON.parse(localStorage.getItem(ACTIVE_KEY) ?? '{}') as SkinStore;
    return raw && typeof raw === 'object' && raw.active ? raw : { active: {}, owned: {} };
  } catch {
    return { active: {}, owned: {} };
  }
}

function save(store: SkinStore): void {
  localStorage.setItem(ACTIVE_KEY, JSON.stringify(store));
}

/** Index of the currently active skin for a car. */
export function activeSkinIndex(carId: string): number {
  return load().active[carId] ?? 0;
}

/** Whether a specific skin is owned. Index 0 (stock) is always owned. */
export function skinOwned(carId: string, index: number): boolean {
  if (index === 0) return true;
  return (load().owned[carId] ?? []).includes(index);
}

/** Buy and equip a skin. Returns false if can't afford or already owned. */
export function buySkin(carId: string, index: number): boolean {
  const skins = CAR_SKINS[carId];
  if (!skins || index < 0 || index >= skins.length) return false;
  if (skinOwned(carId, index)) return false;
  if (!spend(skins[index].price)) return false;
  const store = load();
  if (!store.owned[carId]) store.owned[carId] = [];
  store.owned[carId].push(index);
  store.active[carId] = index;
  save(store);
  return true;
}

/** Set the active skin (must be owned). */
export function equipSkin(carId: string, index: number): void {
  if (!skinOwned(carId, index) && index !== 0) return;
  const store = load();
  store.active[carId] = index;
  save(store);
}

/** Get the active skin's color for a car (falls back to stock). */
export function activeColor(carId: string): number {
  const skins = CAR_SKINS[carId];
  if (!skins) return 0xffffff;
  const idx = activeSkinIndex(carId);
  return skins[idx]?.color ?? skins[0].color;
}
