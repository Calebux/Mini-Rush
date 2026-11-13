import { componentRecipe, type Recipe } from './components';
import { RACE_PAYOUT } from '../shared/raceRules';

/** Estimates use confirmed balances and the plain finish rate, never pending rewards. */
export function craftingProgress(recipe: Recipe, held: { token_id: string; balance: string }[]) {
  const resources = [
    { id: 'rush', label: 'RUSH', cost: recipe.rush, perRace: RACE_PAYOUT.finish },
    { id: 'material:alloy', label: 'alloy', cost: recipe.alloy, perRace: RACE_PAYOUT.alloy },
    { id: 'material:circuit', label: 'circuits', cost: recipe.circuit, perRace: RACE_PAYOUT.circuit }
  ].map(r => {
    const raw = Number(held.find(h => h.token_id === r.id)?.balance ?? 0);
    const balance = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    return { ...r, balance, missing: Math.max(0, r.cost - balance) };
  });
  return { resources, ready: resources.every(r => r.missing === 0),
    races: Math.max(...resources.map(r => Math.ceil(r.missing / r.perRace))) };
}

const KEY = 'minirush.crafting-target.v1';
export function craftingTarget(): Recipe {
  try { return componentRecipe(localStorage.getItem(KEY) ?? '') ?? componentRecipe('street-slick')!; }
  catch { return componentRecipe('street-slick')!; }
}
export function trackRecipe(id: string): void {
  if (!componentRecipe(id)) return;
  try { localStorage.setItem(KEY, id); } catch { /* Tracking remains optional in private browsing. */ }
  window.dispatchEvent(new CustomEvent('minirush:crafting-target', { detail: id }));
}
