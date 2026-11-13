// Car skins: alternate paint jobs purchased with coins. Each car can have
// multiple color variants. Active skin swaps the car's color (underglow +
// toon material). Same spend/own pattern as economy.ts.
import { bank, owned } from './economy';
import { CARS } from './cars';
import { checkLocalPurchase } from './shopSession';

export interface Skin {
  name: string;
  color: number;
  price: number;
}
export interface SkinDesign { color: number; accent: number; pattern: 'solid' | 'stripes'; finish: 'gloss' | 'satin' }
/** Legacy junkyard shells use one baked atlas for body, glass and lamps. */
export const supportsSkinDesign = (car: { model: number }): boolean => car.model === -1 || car.model >= 100;

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
  ],
  r8: [
    { name: 'Stock', color: 0x4dd8ff, price: 0 },
    { name: 'Nardo', color: 0x7d858c, price: 140 },
    { name: 'Signal Green', color: 0x66ff33, price: 160 },
    { name: 'Carbon Red', color: 0xb8142a, price: 180 }
  ],
  sesto: [
    { name: 'Stock', color: 0xd8ff2f, price: 0 },
    { name: 'Graphite', color: 0x3a3a42, price: 160 },
    { name: 'Lime Punch', color: 0xb9ff27, price: 180 },
    { name: 'White Line', color: 0xf2f2e8, price: 180 }
  ],
  aventador: [
    { name: 'Stock', color: 0xff4a1f, price: 0 },
    { name: 'Arancio', color: 0xff8f1f, price: 160 },
    { name: 'Blu Nethuns', color: 0x1f5fff, price: 180 },
    { name: 'Blackout', color: 0x101016, price: 180 }
  ],
  divo: [
    { name: 'Stock', color: 0x2fd8ff, price: 0 },
    { name: 'French Blue', color: 0x245cff, price: 160 },
    { name: 'Aero Silver', color: 0xc7d1d8, price: 180 },
    { name: 'Track Red', color: 0xda1f2a, price: 180 }
  ],
  tourbillon: [
    { name: 'Stock', color: 0x6f7cff, price: 0 },
    { name: 'Royal Blue', color: 0x223dff, price: 180 },
    { name: 'Pearl', color: 0xf1edf7, price: 180 },
    { name: 'Solar Gold', color: 0xffc437, price: 200 }
  ]
};

const ACTIVE_KEY = 'minirush.skins';
const JOURNAL = `${ACTIVE_KEY}.purchase`;
// Keep existing indices stable: earlier purchases retain their identities.
for (const car of CARS) if (!CAR_SKINS[car.id]) CAR_SKINS[car.id] = [
  { name: 'Stock', color: car.color, price: 0 },
  { name: 'Midnight', color: 0x242b3d, price: 80 },
  { name: 'Pearl', color: 0xe5e8df, price: 100 },
  { name: 'Lagos Gold', color: 0xdfad4c, price: 140 }
];

interface SkinStore {
  active: Record<string, number>;  // carId → skinIndex
  owned: Record<string, number[]>; // carId → owned indices
  designs?: Record<string, Record<number, SkinDesign>>;
}

function load(): SkinStore {
  try {
    const raw = JSON.parse(localStorage.getItem(ACTIVE_KEY) ?? '{}') as SkinStore;
    if (!raw || typeof raw !== 'object') return { active: {}, owned: {} };
    return {
      active: raw.active && typeof raw.active === 'object' ? raw.active : {},
      owned: raw.owned && typeof raw.owned === 'object' ? raw.owned : {},
      designs: raw.designs && typeof raw.designs === 'object' ? raw.designs : {}
    };
  } catch {
    return { active: {}, owned: {} };
  }
}

function save(store: SkinStore): void {
  localStorage.setItem(ACTIVE_KEY, JSON.stringify(store));
}

/** Index of the currently active skin for a car. */
export function activeSkinIndex(carId: string): number {
  const skins = CAR_SKINS[carId];
  const index = Math.floor(load().active[carId] ?? 0);
  return skins && index >= 0 && index < skins.length && skinOwned(carId, index) ? index : 0;
}

/** Whether a specific skin is owned. Index 0 (stock) is always owned. */
export function skinOwned(carId: string, index: number): boolean {
  if (!Number.isSafeInteger(index) || !CAR_SKINS[carId]?.[index]) return false;
  if (index === 0) return true;
  const entries = load().owned[carId];
  return Array.isArray(entries) && entries.includes(index);
}

export function skinDesign(carId: string, index: number, fallback?: number): SkinDesign {
  const preset = CAR_SKINS[carId]?.[index];
  const base: SkinDesign = { color: index === 0 && fallback !== undefined ? fallback : preset?.color ?? 0xffffff,
    accent: 0xf0eee3, pattern: 'solid', finish: 'gloss' };
  const saved = index > 0 ? load().designs?.[carId]?.[index] : undefined;
  return validDesign(saved) ? { ...saved } : base;
}
function validDesign(d: unknown): d is SkinDesign {
  if (!d || typeof d !== 'object') return false;
  const p = d as SkinDesign;
  return [p.color, p.accent].every(c => Number.isSafeInteger(c) && c >= 0 && c <= 0xffffff)
    && ['solid','stripes'].includes(p.pattern) && ['gloss','satin'].includes(p.finish);
}
export function recoverSkinPurchase(): void {
  const raw = localStorage.getItem(JOURNAL); if (!raw) return;
  const tx = JSON.parse(raw);
  if (!Number.isSafeInteger(tx.balance) || tx.balance < 0 || typeof tx.store !== 'string') throw new Error('Invalid skin purchase journal');
  localStorage.setItem(ACTIVE_KEY, tx.store);
  localStorage.setItem('minirush.bank', String(tx.balance));
  localStorage.removeItem(JOURNAL);
}
/** A purchased skin is an editable design slot for this chassis, saved locally. */
export function saveSkinDesign(carId: string, index: number, design: SkinDesign): string | null {
  try {
    recoverSkinPurchase();
    const car = CARS.find(c => c.id === carId), skin = CAR_SKINS[carId]?.[index];
    if (!car || !skin || !Number.isSafeInteger(index) || !validDesign(design)) return 'Choose a valid skin.';
    if (!supportsSkinDesign(car)) return 'Custom skins are not available for this car yet.';
    if (car.price > 0 && !owned().has(carId)) return 'Own this car before buying its skins.';
    const have = skinOwned(carId, index);
    if (!have && !checkLocalPurchase()) return 'Sign in to buy this skin.';
    const cost = have ? 0 : skin.price, balance = bank();
    if (balance < cost) return `Earn ${cost - balance} more coins by racing.`;
    const store = load();
    const previous = Array.isArray(store.owned[carId]) ? store.owned[carId] : [];
    store.owned[carId] = [...new Set([...previous, index])]; store.active[carId] = index;
    if (index > 0) { store.designs ??= {}; store.designs[carId] ??= {}; store.designs[carId][index] = { ...design }; }
    localStorage.setItem(JOURNAL, JSON.stringify({ balance: balance - cost, store: JSON.stringify(store) }));
    recoverSkinPurchase(); return null;
  } catch { return 'Could not save. Reopen the game to recover any interrupted purchase.'; }
}

/** Buy and equip a skin. Returns false if can't afford or already owned. */
export function buySkin(carId: string, index: number): boolean {
  if (skinOwned(carId, index)) return false;
  return saveSkinDesign(carId, index, skinDesign(carId, index)) === null;
}

/** Set the active skin (must be owned). */
export function equipSkin(carId: string, index: number): void {
  if (!skinOwned(carId, index)) return;
  const store = load();
  store.active[carId] = index;
  save(store);
}

/**
 * Get the active skin's color for a car (falls back to stock). A car with no
 * skins wears `fallback` — pass its own garage color, or a procedural body
 * with no texture of its own renders white.
 */
export function activeColor(carId: string, fallback = 0xffffff): number {
  const skins = CAR_SKINS[carId];
  if (!skins) return fallback;
  const idx = activeSkinIndex(carId);
  return skinDesign(carId, idx, fallback).color;
}
