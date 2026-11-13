import { CARS } from './cars';
import { workshopSpec } from './workshop';
import { applyUpgrades } from './upgrades';
import { applyComponents, COMPONENT_SLOTS, RECIPES, componentRecipe, componentStats, type Component, type ComponentInstallation } from './components';
import { craftingTarget, trackRecipe } from './craftingTarget';
import { orderPayout, type ComponentOrder } from '../shared/dealerOrders';
import { ensureAccount, explorerTx, holdings, nearAccount, refreshComponents, relayed, viewCall, hasPendingReward, retryRaceReward, hasPendingAction, type Holding } from './near';
import { shopOpen, requireShopSession } from './shopSession';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const short = (s: string) => s.split('.')[0];

export class PartsWorkshop {
  private parts: Component[] = [];
  private offers: Component[] = [];
  private orders: ComponentOrder[] | null = null;
  private marketPage: 'listings' | 'orders' = 'listings';
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
    window.addEventListener('minirush:session', () => { if (this.root.getClientRects().length) this.render(); });
    window.addEventListener('minirush:garage-action', () => {
      if (!this.root.getClientRects().length || this.busy) return;
      if (hasPendingAction()) this.render(); else void this.refresh();
    });
    window.addEventListener('minirush:reward-settled', () => { if (this.root.getClientRects().length && !this.busy) void this.refresh(); });
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
      const [parts, held, offers, orders] = await Promise.all([
        refreshComponents(), holdings(), viewCall<Component[]>('component_offers', { from_index: this.offset, limit: 24 }),
        viewCall<ComponentOrder[]>('component_orders', {}).catch(() => null)
      ]);
      if (version !== this.refreshVersion) return false;
      this.parts = parts; this.held = held; this.offers = offers; this.orders = orders; this.connected = true;
      return true;
    } catch {
      if (version !== this.refreshVersion) return false;
      this.connected = false; this.orders = null;
      this.message = 'Workshop connection unavailable. Explore the recipes below, then reconnect to craft or trade.';
      return false;
    } finally { if (version === this.refreshVersion) { this.loading = false; this.render(); } }
  }
  private buildSpec() {
    const base = CARS.find(c => c.id === this.chassis)!;
    return applyComponents(this.chassis === 'rush-one' ? workshopSpec(base) : applyUpgrades(base));
  }
  private button(action: string, label: string, id = '', disabled = false): string {
    if (['buy', 'craft'].includes(action) && !shopOpen()) { label = action === 'craft' ? 'SIGN IN TO CRAFT' : 'SIGN IN TO BUY'; disabled = false; }
    const pending = !['claim','previous','next','order-recipe'].includes(action) && hasPendingAction();
    return `<button type="button" class="pw-action" data-action="${action}" data-id="${esc(id)}" ${disabled || pending || this.busy || this.loading || !this.connected ? 'disabled' : ''}>${label}</button>`;
  }
  private render(): void {
    const tab = (id: string, label: string) => `<button type="button" data-page="${id}" aria-pressed="${this.page === id}" ${this.busy ? 'disabled' : ''}>${label}</button>`;
    const focused = document.activeElement as HTMLElement | null;
    const focusKey = focused && this.root.contains(focused) ? ['action', 'id', 'page', 'market', 'slot', 'recipe', 'select-part'].filter(k => focused.getAttribute(`data-${k}`)).map(k => `[data-${k}="${CSS.escape(focused.getAttribute(`data-${k}`)!)}"]`).join('') : '';
    const spec = this.buildSpec();
    this.root.innerHTML = `
      <div class="pw-loadout"><label for="parts-chassis">CHASSIS</label><select id="parts-chassis" ${this.busy ? 'disabled' : ''}><option value="viper" ${this.chassis === 'viper' ? 'selected' : ''}>VIPER GT</option><option value="rush-one" ${this.chassis === 'rush-one' ? 'selected' : ''}>RUSH ONE</option></select></div>
      <div class="pw-wallet" aria-label="Workshop resources"><span><b>${this.connected ? this.balance('rush') : '—'}</b> RUSH</span><span><b>${this.connected ? this.balance('material:alloy') : '—'}</b> ALLOY</span><span><b>${this.connected ? this.balance('material:circuit') : '—'}</b> CIRCUITS</span></div>
      <div class="pw-build-stats" aria-label="Current build performance, stock equals 100">${(['speed','accel','grip','nitro'] as const).map((key, i) => `<div><span>${['Speed','Launch','Grip','Nitro'][i]}</span><strong>${Math.round(spec[key] * 100)}</strong><i style="--stat:${Math.min(100, spec[key] / 1.2 * 100)}%"></i></div>`).join('')}</div>
      <div class="pw-nav" aria-label="Performance workshop pages">${tab('craft', 'CRAFT')}${tab('garage', `MY PARTS · ${this.parts.length}`)}${tab('exchange', 'TRADE')}</div>
      ${this.page === 'craft' ? this.craftView() : this.page === 'garage' ? this.garageView() : this.exchangeView()}
      <p class="pw-status" role="status" aria-live="polite">${this.busy ? 'Completing your request…' : this.loading ? 'Refreshing garage…' : esc(this.message)}</p>
      ${this.tx ? `<details class="pw-payment-details"><summary>Action details</summary><p>NEAR testnet · <a href="${explorerTx(encodeURIComponent(this.tx))}" target="_blank" rel="noopener">View record ↗</a></p></details>` : ''}
      ${hasPendingAction() && !this.busy ? '<p class="pw-pending">Your previous action is still completing. Check Activity for progress.</p>' : ''}
      ${hasPendingReward() ? `<div class="pw-pending">Race rewards are on their way. We’ll check again automatically. ${this.button('claim', 'COLLECT REWARDS')}</div>` : ''}
      <footer class="pw-foot"><span>TEST BUILD</span><button type="button" data-garage-activity>ACTIVITY</button><button type="button" data-action="refresh" ${this.busy || this.loading ? 'disabled' : ''}>REFRESH</button></footer>`;
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
    }).join('')}</div>${this.parts.some(p => this.deliveryOrder(p)) ? '<button type="button" class="pw-track" data-action="show-orders">A DEALER WANTS A PART ON YOUR BENCH ↗</button>' : ''}${this.partShelf(this.parts, false)}`;
  }
  private deliveryOrder(p: Component): ComponentOrder | undefined {
    return p.installed_on === null && p.price === null ? this.orders?.find(o => o.recipe_id === p.recipe_id && o.dealer !== nearAccount() && o.expires_ms > Date.now()) : undefined;
  }
  private exchangeView(): string {
    return `<div class="pw-market-nav" aria-label="Parts market"><button type="button" data-market="listings" aria-pressed="${this.marketPage === 'listings'}">SHOP PARTS</button><button type="button" data-market="orders" aria-pressed="${this.marketPage === 'orders'}">DEALER ORDERS${this.orders ? ` · ${this.orders.length}` : ''}</button></div>${this.marketPage === 'orders' ? this.ordersView() : `<p class="workshop-note">Player-made parts, sold by drivers and dealers. Listing uninstalls a part. Sales burn 2% of the price, with a 1 RUSH minimum fee.</p>${this.partShelf(this.offers, true)}
      <div class="pw-pagination">${this.button('previous', '‹ PREVIOUS', '', this.offset === 0)}<span>${this.offset / 24 + 1}</span>${this.button('next', 'NEXT ›', '', this.offers.length < 24)}</div>`}`;
  }
  private ordersView(): string {
    if (!this.orders) return '<p class="pw-empty">Dealer orders unavailable. Refresh to check the market. Crafting and player listings are available separately.</p>';
    const orders = this.orders.filter(o => o.expires_ms > Date.now());
    return `<div class="pw-order-intro"><small>BUILD FOR THE MARKET</small><strong>Your next customer is waiting.</strong><p>Deliver a requested part for RUSH, or keep it for your own build. Dealers buy with their own funds and resell your original part.</p></div>${orders.length ? orders.map(o => {
      const r = componentRecipe(o.recipe_id); if (!r) return '';
      const part = this.parts.find(p => p.recipe_id === o.recipe_id && p.price === null && p.installed_on === null);
      const held = this.parts.some(p => p.recipe_id === o.recipe_id);
      const names: Record<string, string> = { 'mama-t': 'Mama T', 'oga-motors': 'Oga Motors', 'tuner-ade': 'Tuner Ade' };
      const dealer = names[short(o.dealer)] ?? short(o.dealer);
      return `<article class="pw-order" data-order="${o.revision}"><header><span>${esc(dealer)}</span><small>FUNDS RESERVED</small></header><div class="pw-order-title"><strong>${r.name}</strong><span><b>${orderPayout(o.price)}</b> RUSH / PART</span></div><p class="pw-order-reason">“${esc(o.reason)}”</p><dl><div><dt>Still buying</dt><dd>${o.remaining} ${o.remaining === 1 ? 'part' : 'parts'}</dd></div><div><dt>Closes</dt><dd>${new Date(o.expires_ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</dd></div></dl><p class="pw-order-cost">Craft: ${r.rush} RUSH · ${r.alloy} alloy · ${r.circuit} circuits</p><p class="pw-order-hint">${part ? `Deliver #${esc(part.id.split(':')[1])} from your bench. Payment shown includes the market fee.` : held ? 'Uninstall or cancel your listing in My parts before delivery.' : 'Craft this recipe or source it from another player. Orders can fill before you return.'}</p><div class="workshop-actions pw-actions">${part ? this.button('deliver', `DELIVER #${esc(part.id.split(':')[1])} · RECEIVE ${orderPayout(o.price)} RUSH`, String(o.revision), o.dealer === nearAccount()) : this.button('order-recipe', 'VIEW RECIPE & TRACK MATERIALS', o.recipe_id)}</div></article>`;
    }).join('') : '<p class="pw-empty">No funded orders right now. Dealers return when they need stock and have RUSH to spend. You can still list a part for other players.</p>'}`;
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
    if (button.dataset.market) { this.marketPage = button.dataset.market as typeof this.marketPage; this.render(); return; }
    if (button.dataset.page) { this.page = button.dataset.page as typeof this.page; this.render(); return; }
    if (button.dataset.slot) { this.slot = button.dataset.slot; this.render(); return; }
    if (button.dataset.recipe) { this.selectedRecipe = button.dataset.recipe; this.render(); return; }
    if (button.dataset.selectPart) { this.selectedPart = button.dataset.selectPart; this.render(); return; }
    const action = button.dataset.action;
    if (!action) return;
    if (['buy', 'craft'].includes(action)) {
      this.busy = true; this.render();
      const permitted = await requireShopSession();
      this.busy = false;
      if (!permitted) { this.render(); return; }
    }
    if (action === 'show-orders') { this.page = 'exchange'; this.marketPage = 'orders'; this.message = 'Choose which order to supply. Your part stays yours until delivery confirms.'; this.render(); return; }
    if (action === 'order-recipe') { this.selectRecipe(button.dataset.id!); trackRecipe(button.dataset.id!); this.message = 'Materials tracked on race results. The dealer order stays open to other drivers.'; this.render(); return; }
    if (action === 'track') { trackRecipe(button.dataset.id!); this.message = 'Upgrade tracked. Your next race report will show material progress.'; this.render(); return; }
    if (action === 'refresh') { this.message = ''; await this.refresh(); return; }
    if (action === 'next' || action === 'previous') { this.offset = Math.max(0, this.offset + (action === 'next' ? 24 : -24)); await this.refresh(); return; }
    const id = button.dataset.id!;
    const order = action === 'deliver' ? this.orders?.find(o => String(o.revision) === id) : undefined;
    const delivery = order && this.parts.find(p => p.recipe_id === order.recipe_id && p.price === null && p.installed_on === null);
    if (action === 'deliver' && (!order || !delivery || order.expires_ms <= Date.now())) {
      this.message = 'This order or part is no longer available. Refresh the market.'; this.render(); return;
    }
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
      } else if (action === 'deliver' && order && delivery) {
        const result = await relayed('fill_component_order', { part_id: delivery.id, dealer: order.dealer, revision: order.revision, min_payout: String(orderPayout(order.price)) });
        this.tx = result.tx;
        this.message = `Delivered #${delivery.id.split(':')[1]}. ${orderPayout(order.price)} RUSH received; the dealer now owns this part.`;
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
