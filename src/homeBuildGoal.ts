import { craftingProgress, craftingTarget } from './craftingTarget';
import { holdings, nearAccount } from './near';

/** Read-only guidance. Account creation remains in the existing startup flow. */
export function installHomeBuildGoal(open: () => void): void {
  const root = document.getElementById('home-build-goal')!;
  const menu = document.getElementById('menu')!;
  const title = root.querySelector<HTMLElement>('strong')!;
  const note = root.querySelector<HTMLElement>('[data-build-note]')!;
  const materials = root.querySelector<HTMLElement>('[data-build-materials]')!;
  let version = 0;
  const visible = () => !document.hidden && !menu.classList.contains('hidden');
  async function refresh() {
    const request = ++version, recipe = craftingTarget(), account = nearAccount();
    title.textContent = `${recipe.name} ↗`;
    materials.textContent = `${recipe.rush} RUSH · ${recipe.alloy} alloy · ${recipe.circuit} circuits`;
    root.dataset.state = 'unavailable';
    note.textContent = account ? 'Checking your materials…' : 'Race for salvage. Craft a part, then fit it or trade it.';
    if (!account || !visible()) return;
    try {
      const held = await holdings();
      if (request !== version || account !== nearAccount()) return;
      const progress = craftingProgress(recipe, held);
      materials.textContent = progress.resources.map(r => `${r.balance} / ${r.cost} ${r.label}`).join(' · ');
      root.dataset.state = progress.ready ? 'ready' : 'earning';
      note.textContent = progress.ready ? 'Materials ready. Open the workshop to craft.'
        : `About ${progress.races} eligible ${progress.races === 1 ? 'race' : 'races'} to craft. Fit it or sell it; daily limits apply.`;
    } catch {
      if (request === version) note.textContent = 'Materials unavailable. You can still race or explore the recipe.';
    }
  }
  root.addEventListener('click', open);
  new MutationObserver(() => { if (visible()) void refresh(); }).observe(menu, { attributes: true, attributeFilter: ['class'] });
  for (const event of ['minirush:crafting-target', 'minirush:garage-updated', 'minirush:reward-settled', 'online'])
    window.addEventListener(event, () => { if (visible()) void refresh(); });
  document.addEventListener('visibilitychange', () => { if (visible()) void refresh(); });
  void refresh();
}
