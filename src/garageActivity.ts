import { garageActivity, recoverGarage, explorerTx, explorerAccount, nearAccount, hasPendingReward } from './near';
import { componentRecipe } from './components';
import { CARS } from './cars';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
const names: Record<string,string> = { buy:'Purchase', buy_component:'Part purchase', craft_component:'Craft part',
  install_component:'Update build', list_component:'List part', cancel_component:'Cancel listing', recycle_component:'Recycle part',
  fill_component_order:'Deliver to dealer', sell_back:'Sell to dealer', consume:'Race supply', mt_transfer:'Transfer', nft_transfer:'Transfer part',
  buy_edition:'Limited edition purchase', buy_edition_car:'Limited edition purchase', list_edition_car:'List car for NEAR', cancel_edition_listing:'Cancel car listing' };

export function installGarageActivity(): void {
  const dialog = document.createElement('dialog');
  dialog.id = 'garage-activity'; dialog.setAttribute('aria-labelledby','garage-activity-title');
  document.body.appendChild(dialog);
  let checking = false;
  const render = () => {
    const opened = new Set([...dialog.querySelectorAll<HTMLDetailsElement>('details[open]')].map(d => d.parentElement?.dataset.actionId ?? 'about'));
    const focused = dialog.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const focusAction = focused?.hasAttribute('data-activity-check') ? '[data-activity-check]' : focused?.hasAttribute('data-activity-close') ? '[data-activity-close]' : null;
    const account = nearAccount();
    let rows = '', failed = false;
    try {
      rows = garageActivity().map(a => {
        const label = names[a.method] ?? 'Garage action';
        const item = typeof a.args?.recipe_id === 'string' ? componentRecipe(a.args.recipe_id)?.name
          : typeof a.args?.token_id === 'string' ? CARS.find(c=>`car:${c.id}`===a.args.token_id)?.name
          : typeof a.args?.part_id === 'string' ? `Part #${a.args.part_id.split(':')[1]}` : '';
        const state = a.result.state;
        return `<li data-state="${state}" data-action-id="${esc(a.id)}"><div><strong>${esc(label)}${item ? ` · ${esc(item)}` : ''}</strong><time>${new Date(a.createdAt).toLocaleString()}</time></div><b>${state === 'confirmed' ? 'COMPLETED' : state === 'failed' ? 'NOT COMPLETED' : 'PROCESSING'}</b>${state === 'pending' ? `<p>${esc(a.result.message ?? 'Checking your original request. No second purchase will be sent.')}</p>` : state === 'failed' ? `<p>${esc(a.result.message ?? 'Please refresh your garage before trying again.')}</p>` : ''}${a.result.tx ? `<details><summary>Action details</summary><p>NEAR testnet request. <a href="${explorerTx(encodeURIComponent(a.result.tx))}" target="_blank" rel="noopener">View record ↗</a></p></details>` : ''}</li>`;
      }).join('');
    } catch { failed = true; }
    dialog.innerHTML = `<header><div><small>YOUR GARAGE</small><h2 id="garage-activity-title">Activity</h2></div><button type="button" data-activity-close aria-label="Close activity">✕</button></header>
      <p class="ga-note">Purchases and deliveries appear here. You can keep browsing while an action completes.</p>
      ${hasPendingReward() ? '<p class="ga-note">Race rewards are still arriving. We’ll check them automatically.</p>' : ''}
      <ol>${rows || `<li>${failed ? 'Saved activity could not be read. Keep this browser data and contact support.' : 'Your next purchase, crafted part or delivery will appear here.'}</li>`}</ol>
      <footer><button type="button" data-activity-check ${checking ? 'disabled' : ''}>${checking ? 'CHECKING…' : 'CHECK PROGRESS'}</button><span>TEST BUILD · ITEMS HAVE NO CASH VALUE</span></footer>
      <details class="ga-about"><summary>About your saved garage</summary><p>Your garage access is saved in this browser. The driver card offers a sign-in and ownership verification preview. Account recovery is not available yet, so keep your browser data to retain access.</p><p>This build uses NEAR testnet; the game pays network fees.${account ? ` <a href="${explorerAccount(encodeURIComponent(account))}" target="_blank" rel="noopener">Ownership details ↗</a>` : ''}</p></details>`;
    dialog.querySelectorAll<HTMLDetailsElement>('details').forEach(d => { d.open = opened.has(d.parentElement?.dataset.actionId ?? 'about'); });
    if (focusAction) dialog.querySelector<HTMLElement>(focusAction)?.focus({ preventScroll: true });
  };
  document.addEventListener('click', e => {
    if ((e.target as HTMLElement).closest('[data-garage-activity]')) { render(); dialog.showModal(); }
  });
  dialog.addEventListener('keydown', e => e.stopPropagation());
  dialog.addEventListener('click', async e => {
    const target = e.target as HTMLElement;
    if (target === dialog || target.closest('[data-activity-close]')) { dialog.close(); return; }
    if (target.closest('[data-activity-check]') && !checking) {
      checking = true; render();
      try { await recoverGarage(); } finally { checking = false; render(); }
    }
  });
  for (const event of ['minirush:garage-action','minirush:reward-settled']) window.addEventListener(event, () => { if (dialog.open) render(); });
}
