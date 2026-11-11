import { CARS } from './cars';
import { workshopSpec } from './workshop';
import { applyUpgrades } from './upgrades';
import { applyComponents, COMPONENT_SLOTS, RECIPES, componentRecipe, componentStats, type Component, type ComponentInstallation } from './components';
import { craftingTarget, trackRecipe } from './craftingTarget';
import { ensureAccount, explorerTx, holdings, nearAccount, refreshComponents, relayed, viewCall, hasPendingReward, retryRaceReward, type Holding } from './near';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const short = (s: string) => s.split('.')[0];

export class PartsWorkshop {
  private parts: Component[] = [];
  private offers: Component[] = [];
  private held: Holding[] = [];
  private page: 'craft' | 'garage' | 'exchange' = 'craft';
  private slot: string = 'engine';
  private chassis = 'viper';
  private selectedRecipe = 'street-turbo';
  private selectedPart = '';
  private busy = false;
  private connected = false;
  private loading = true;
  private message = '';
  private tx = '';
  private offset = 0;
  private refreshVersion = 0;
  constructor(private root: HTMLElement, private previewChassis: (chassis: string) => void, private installed: (report: ComponentInstallation) => void = () => {}) {
    this.root.addEventListener('click', e => { void this.click(e); });
    this.root.addEventListener('change', e => {
      const target = e.target as HTMLSelectElement;
      if (target.id === 'parts-chassis') { this.chassis = target.value; this.previewChassis(this.chassis); this.render(); }
    });
  }
  setChassis(chassis: string): void { this.chassis = chassis; }
  selectRecipe(id: string): void {
    const recipe = componentRecipe(id);
    if (!recipe) return;
    this.selectedRecipe = id; this.slot = recipe.slot; this.page = 'craft';
  }
  async open(): Promise<void> { this.previewChassis(this.chassis); this.render(); await this.refresh(); }
  private balance(id: string): number { return Number(this.held.find(h => h.token_id === id)?.balance ?? 0); }
  private async refresh(): Promise<boolean> {
    const version = ++this.refreshVersion;
    this.loading = true; this.render();
    try {
      if (!(await ensureAccount())) throw new Error('No connection');
      const [parts, held, offers] = await Promise.all([
        refreshComponents(), holdings(), viewCall<Component[]>('component_offers', { from_index: this.offset, limit: 24 })
      ]);
      if (version !== this.refreshVersion) return false;
      this.parts = parts; this.held = held; this.offers = offers; this.connected = true;
      return true;
    } catch {
      if (version !== this.refreshVersion) return false;
      this.connected = false;
      this.message = 'Workshop connection unavailable. Explore the recipes below, then reconnect to craft or trade.';
      return false;
    } finally { if (version === this.refreshVersion) { this.loading = false; this.render(); } }
  }
  private buildSpec() {
    const base = CARS.find(c => c.id === this.chassis)!;
    return applyComponents(this.chassis === 'rush-one' ? workshopSpec(base) : applyUpgrades(base));
  }
  private button(action: string, label: string, id = '', disabled = false): string {
    return `<button type="button" class="pw-action" data-action="${action}" data-id="${esc(id)}" ${disabled || this.busy || this.loading || !this.connected ? 'disabled' : ''}>${label}</button>`;
  }
  private render(): void {
    const tab = (id: string, label: string) => `<button type="button" data-page="${id}" aria-pressed="${this.page === id}" ${this.busy ? 'disabled' : ''}>${label}</button>`;
    const focused = document.activeElement as HTMLElement | null;
    const focusKey = focused && this.root.contains(focused) ? ['action', 'id', 'page', 'slot', 'recipe', 'select-part'].filter(k => focused.getAttribute(`data-${k}`)).map(k => `[data-${k}="${CSS.escape(focused.getAttribute(`data-${k}`)!)}"]`).join('') : '';
    const spec = this.buildSpec();
    this.root.innerHTML = `
      <div class="pw-loadout"><label for="parts-chassis">CHASSIS</label><select id="parts-chassis" ${this.busy ? 'disabled' : ''}><option value="viper" ${this.chassis === 'viper' ? 'selected' : ''}>VIPER GT</option><option value="rush-one" ${this.chassis === 'rush-one' ? 'selected' : ''}>RUSH ONE</option></select></div>
      <div class="pw-wallet" aria-label="Workshop resources"><span><b>${this.connected ? this.balance('rush') : '—'}</b> RUSH</span><span><b>${this.connected ? this.balance('material:alloy') : '—'}</b> ALLOY</span><span><b>${this.connected ? this.balance('material:circuit') : '—'}</b> CIRCUITS</span></div>
      <div class="pw-build-stats" aria-label="Current build performance, stock equals 100">${(['speed','accel','grip','nitro'] as const).map((key, i) => `<div><span>${['Speed','Launch','Grip','Nitro'][i]}</span><strong>${Math.round(spec[key] * 100)}</strong><i style="--stat:${Math.min(100, spec[key] / 1.2 * 100)}%"></i></div>`).join('')}</div>
      <div class="pw-nav" aria-label="Performance workshop pages">${tab('craft', 'CRAFT')}${tab('garage', `MY PARTS · ${this.parts.length}`)}${tab('exchange', 'TRADE')}</div>
      ${this.page === 'craft' ? this.craftView() : this.page === 'garage' ? this.garageView() : this.exchangeView()}
      <p class="pw-status" role="status" aria-live="polite">${this.busy ? 'Confirming your transaction…' : this.loading ? 'Refreshing garage…' : esc(this.message)}${this.tx ? ` <a href="${explorerTx(this.tx)}" target="_blank" rel="noopener">View receipt ↗</a>` : ''}</p>
      ${hasPendingReward() ? `<div class="pw-pending">Race salvage awaiting confirmation. ${this.button('claim', 'RETRY REWARD CLAIM')}</div>` : ''}
      <footer class="pw-foot"><span>NEAR TESTNET · GAME PAYS GAS</span><button type="button" data-action="refresh" ${this.busy || this.loading ? 'disabled' : ''}>REFRESH</button></footer>`;
    if (focusKey) this.root.querySelector<HTMLElement>(focusKey)?.focus({ preventScroll: true });
  }
  private symbol(slot: string): string { return ({ engine: 'ϟ', gearbox: '⚙', tires: '◎', nitro: '↯' } as Record<string, string>)[slot] ?? 'ϟ'; }
  private craftView(): string {
    const recipes = RECIPES.filter(r => r.slot === this.slot);
    const selected = recipes.find(r => r.id === this.selectedRecipe) ?? recipes[0];
    this.selectedRecipe = selected.id;
    const enough = this.balance('rush') >= selected.rush && this.balance('material:alloy') >= selected.alloy && this.balance('material:circuit') >= selected.circuit;
    return `<div class="pw-slot-nav" aria-label="Component slots">${COMPONENT_SLOTS.map(s => `<button type="button" data-slot="${s}" aria-pressed="${s === this.slot}">${s}</button>`).join('')}</div>
      <div class="pw-grid" aria-label="Component recipes">${recipes.map(r => `<button type="button" class="part-card pw-card" data-recipe="${r.id}" aria-pressed="${r.id === selected.id}"><span class="part-symbol">${this.symbol(r.slot)}</span><strong>${r.name}</strong><small>${r.rush} RUSH</small></button>`).join('')}</div>
      <section class="pw-detail" aria-label="Selected recipe"><strong>${selected.name}</strong><p>${selected.detail}</p><p class="pw-stats">${componentStats(selected)}</p>
      <p class="pw-cost">${selected.rush} RUSH · ${selected.alloy} ALLOY · ${selected.circuit} CIRCUITS</p>
      <button type="button" class="pw-track" data-action="track" data-id="${selected.id}" aria-pressed="${craftingTarget().id === selected.id}">${craftingTarget().id === selected.id ? '✓ TRACKED ON RACE RESULTS' : 'TRACK THIS UPGRADE'}</button>
      <div class="workshop-actions pw-actions">${this.button('craft', enough ? 'CRAFT PART' : 'RACE FOR MATERIALS', selected.id, !enough || this.parts.length >= 64)}</div></section>
      <details class="pw-guide"><summary>Salvage & crafting</summary><p>Each eligible connected race earns 2 alloy, 1 circuit and RUSH by finishing place: 45 for a win, 36 for second, 30 for third, 24 for any other finish. Finish a race lasting at least 40 seconds; up to 20 rewards a day within the season budget.</p><p>Crafting consumes its inputs. This part recycles into ${Math.floor(selected.alloy / 2)} alloy and ${Math.floor(selected.circuit / 2)} circuits, with no RUSH refund. Installed components replace the local performance tune.</p></details>`;
  }
  private garageView(): string {
    return `<div class="pw-build">${COMPONENT_SLOTS.map(slot => {
      const part = this.parts.find(p => p.installed_on === this.chassis && componentRecipe(p.recipe_id)?.slot === slot);
      return `<div><small>${slot}</small><strong>${part ? esc(componentRecipe(part.recipe_id)!.name) : 'Stock'}</strong></div>`;
    }).join('')}</div>${this.partShelf(this.parts, false)}`;
  }
  private exchangeView(): string {
    return `<p class="workshop-note">Player-made parts. Listing uninstalls a part. Sales burn 2% of the price, with a 1 RUSH minimum fee.</p>${this.partShelf(this.offers, true)}
      <div class="pw-pagination">${this.button('previous', '‹ PREVIOUS', '', this.offset === 0)}<span>${this.offset / 24 + 1}</span>${this.button('next', 'NEXT ›', '', this.offers.length < 24)}</div>`;
  }
  private partShelf(parts: Component[], market: boolean): string {
    if (!parts.length) return `<p class="pw-empty">${market ? 'No player listings yet. List a crafted part from My parts.' : 'Your bench is empty. Race for salvage, then craft your first part.'}</p>`;
    const selected = parts.find(p => p.id === this.selectedPart) ?? parts[0];
    this.selectedPart = selected.id;
    return `<div class="pw-grid" aria-label="${market ? 'Player listings' : 'Owned components'}">${parts.map(p => {
      const r = componentRecipe(p.recipe_id);
      return r ? `<button type="button" class="part-card pw-card" data-select-part="${esc(p.id)}" aria-pressed="${p.id === selected.id}"><span class="part-symbol">${this.symbol(r.slot)}</span><strong>${r.name}</strong><small>${p.price !== null ? `${Number(p.price)} RUSH` : p.installed_on ? 'INSTALLED' : 'OWNED'} · #${esc(p.id.split(':')[1] ?? p.id)}</small></button>` : '';
    }).join('')}</div>${this.partCard(selected, market)}`;
  }
  private partCard(p: Component, market: boolean): string {
    const r = componentRecipe(p.recipe_id);
    if (!r) return '';
    const mine = p.owner === nearAccount();
    const listed = p.price !== null;
    const fee = Math.max(1, Math.floor(Number(p.price) * .02));
    const title = p.installed_on ? `Installed · ${p.installed_on === 'viper' ? 'VIPER GT' : 'RUSH ONE'}` : listed ? 'Listed for sale' : 'On your bench';
    return `<section class="pw-detail" data-part="${esc(p.id)}"><strong>${r.name} #${esc(p.id.split(':')[1] ?? p.id)}</strong>
      <p class="pw-stats">${componentStats(r)}</p><p class="pw-provenance">Made by ${esc(short(p.maker))} · Owned by ${esc(short(p.owner))}</p>
      ${listed ? `<p class="pw-price">${Number(p.price).toLocaleString()} RUSH <small>· Seller receives ${Number(p.price) - fee}</small></p>` : ''}
      ${market ? `<div class="workshop-actions pw-actions">${mine ? this.button('cancel', 'CANCEL YOUR LISTING', p.id) : this.button('buy', 'BUY PART', p.id, this.balance('rush') < Number(p.price))}</div>` : `
        <p class="pw-tag">${title}</p>
        ${listed ? `<div class="workshop-actions pw-actions">${this.button('cancel', 'CANCEL LISTING', p.id)}</div>` : `
          <div class="workshop-actions pw-actions">${this.button('install', p.installed_on === this.chassis ? 'UNINSTALL' : 'INSTALL PART', p.id)}</div>
          <div class="pw-sell"><label for="price-${esc(p.id)}">SALE PRICE / RUSH</label><input id="price-${esc(p.id)}" data-price-for="${esc(p.id)}" type="number" min="10" max="1000000" step="1" inputmode="numeric" placeholder="100" ${this.busy ? 'disabled' : ''}><div class="workshop-actions pw-actions">${this.button('list', 'LIST FOR SALE · UNINSTALLS', p.id)}</div></div>
          ${!p.installed_on ? `<div class="workshop-actions pw-actions">${this.button('recycle', `RECYCLE · ${Math.floor(r.alloy / 2)} ALLOY + ${Math.floor(r.circuit / 2)} CIRCUITS`, p.id)}</div>` : ''}`}`}</section>`;
  }
  private async click(e: Event): Promise<void> {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || button.disabled || this.busy) return;
    if (button.dataset.page) { this.page = button.dataset.page as typeof this.page; this.render(); return; }
    if (button.dataset.slot) { this.slot = button.dataset.slot; this.render(); return; }
    if (button.dataset.recipe) { this.selectedRecipe = button.dataset.recipe; this.render(); return; }
    if (button.dataset.selectPart) { this.selectedPart = button.dataset.selectPart; this.render(); return; }
    const action = button.dataset.action;
    if (!action) return;
    if (action === 'track') { trackRecipe(button.dataset.id!); this.message = 'Upgrade tracked. Your next race report will show material progress.'; this.render(); return; }
    if (action === 'refresh') { this.message = ''; await this.refresh(); return; }
    if (action === 'next' || action === 'previous') { this.offset = Math.max(0, this.offset + (action === 'next' ? 24 : -24)); await this.refresh(); return; }
    const id = button.dataset.id!;
    const p = [...this.parts, ...this.offers].find(p => p.id === id);
    const price = action === 'list' ? this.root.querySelector<HTMLInputElement>(`[data-price-for="${CSS.escape(id)}"]`)?.value : '';
    if (action === 'list' && (!price || !/^\d+$/.test(price) || Number(price) < 10 || Number(price) > 1_000_000)) {
      this.message = 'Enter a whole-number price from 10 to 1,000,000 RUSH.';
      this.render(); return;
    }
    const before = this.buildSpec(), chassis = this.chassis;
    const installing = action === 'install' && p?.installed_on !== chassis;
    const previousIds = new Set(this.parts.map(part => part.id));
    let succeeded = false;
    this.busy = true; this.tx = ''; this.render();
    try {
      if (action === 'claim') {
        const result = await retryRaceReward();
        this.tx = result?.tx ?? ''; this.message = result ? 'Race salvage received.' : 'No pending reward was settled. Refresh to check your balance.';
      } else {
        const args: Record<string, unknown> = action === 'craft' ? { recipe_id: id } : { part_id: id };
        if (action === 'install') args.chassis = p?.installed_on === this.chassis ? null : this.chassis;
        if (action === 'list') args.price = price;
        if (action === 'buy') { args.offer = p!.offer; args.max_price = p!.price; }
        const result = await relayed(`${action}_component`, args);
        succeeded = true;
        this.tx = result.tx;
        this.message = ({ craft: 'Component crafted. Find its serial number in My parts.', install: 'Build updated. Ready for your next race.', list: 'Part listed and removed from your build.', cancel: 'Listing cancelled. The part is on your bench.', buy: 'This component is now yours. Install it from My parts.', recycle: 'Component recycled. Recovered materials are on your bench.' } as Record<string, string>)[action];
      }
    } catch (err) { this.message = err instanceof Error ? err.message : 'Could not confirm the transaction. Refresh your inventory before trying again.'; }
    finally {
      const fresh = await this.refresh(); this.busy = false;
      if (succeeded && fresh && action === 'craft') {
        const crafted = this.parts.find(part => part.recipe_id === id && !previousIds.has(part.id));
        if (crafted) { this.page = 'garage'; this.selectedPart = crafted.id; this.message = 'Part crafted. Install it on your selected chassis below.'; }
      }
      if (succeeded && fresh && installing && chassis === this.chassis) {
        const fitted = this.parts.find(part => part.id === id && part.installed_on === chassis);
        const recipe = fitted && componentRecipe(fitted.recipe_id);
        if (recipe) this.installed({ recipe, chassis, before, after: this.buildSpec() });
      }
      this.render();
    }
  }
}
