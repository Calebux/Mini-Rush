import { componentRecipe, type Recipe } from './components';

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
