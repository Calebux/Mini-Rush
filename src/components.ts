import catalogue from '../shared/components.json';
import type { CarSpec } from './cars';

export const COMPONENT_SLOTS = ['engine', 'gearbox', 'tires', 'nitro'] as const;
export type ComponentSlot = typeof COMPONENT_SLOTS[number];
export interface Recipe {
  id: string; name: string; slot: string; rush: number; alloy: number; circuit: number;
  speed: number; accel: number; grip: number; nitro: number; detail: string;
}
export interface Component {
  id: string; recipe_id: string; owner: string; maker: string; created_ms: number;
  installed_on: string | null; price: string | null; offer: number;
}
export interface ComponentInstallation { recipe: Recipe; chassis: string; before: CarSpec; after: CarSpec }
export const RECIPES: Recipe[] = catalogue;
export const componentRecipe = (id: string) => RECIPES.find(r => r.id === id);
let inventory: Component[] = [];
let account: string | null = null;
// Only a fresh chain read populates driving entitlements; no persistent local unlocks.
export function setComponentInventory(who: string | null, parts: Component[]): void {
  account = who;
  inventory = parts.filter(p => p.owner === who);
}
export function fittedComponents(chassis: string): Component[] {
  return inventory.filter(p => p.owner === account && p.installed_on === chassis && p.price === null);
}
export function applyComponents(spec: CarSpec): CarSpec {
  if (spec.id !== 'viper' && spec.id !== 'rush-one') return spec;
  const fitted = fittedComponents(spec.id);
  if (!fitted.length) return spec;
  // Component builds use chassis baseline, replacing legacy performance upgrades.
  // Cosmetic workshop builds/paint remain intact. Percentages add, never compound.
  const delta = { speed: 0, accel: 0, grip: 0, nitro: 0 };
  const slots = new Set<string>();
  for (const p of fitted) {
    const r = componentRecipe(p.recipe_id);
    if (!r || slots.has(r.slot)) continue;
    slots.add(r.slot);
    for (const k of ['speed', 'accel', 'grip', 'nitro'] as const) delta[k] += r[k];
  }
  return { ...spec, speed: 1 + delta.speed / 100, accel: 1 + delta.accel / 100,
    grip: 1 + delta.grip / 100, nitro: 1 + delta.nitro / 100 };
}
export function componentStats(r: Recipe): string {
  return (['speed', 'accel', 'grip', 'nitro'] as const).filter(k => r[k] !== 0)
    .map(k => `${r[k] > 0 ? '+' : '−'}${Math.abs(r[k])}% ${k === 'nitro' ? 'boost duration' : k === 'accel' ? 'acceleration' : k}`).join(' · ');
}
