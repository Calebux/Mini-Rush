/** A live NEAR dealer desk around the game's shared 3D showroom. */
import { CARS, type CarSpec } from './cars';
import { shopOpen, requireShopSession } from './shopSession';
import {
  buy, dealerLog, ensureAccount, explorerTx, explorerAccount, holdings, listings, nearAccount, syncCars, hasPendingAction,
  buyEdition, buyEditionCar, cancelEditionListing, editionDesk, listEditionCar, nearSpendable, onTestnet, requestTestNear,
  type DealerMove, type EditionDesk, type Holding, type Listing
} from './near';
import { formatNear, parseNear, sellerProceeds, type Edition } from '../shared/editions';

const DEALERS: Record<string, string> = { 'mama-t': 'MAMA T / LADIPO', 'oga-motors': 'OGA MOTORS / THE ISLAND', 'tuner-ade': 'TUNER ADE / TUNING BAY' };
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const collection = [...CARS.filter(c => c.id === 'rush-one'), ...CARS.filter(c => c.class === 'hyper'), ...CARS.filter(c => c.class === 'fast' && c.id !== 'rush-one'), ...CARS.filter(c => c.class === 'junk')];

export class Market {
  private root: HTMLElement;
  private body: HTMLElement;
  private rail: HTMLElement;
  private stage: HTMLElement;
  private toast: HTMLElement;
  private selected = 'car:rush-one';
  private busy = new Set<string>();
  private loading = false;
  private live = false;
  private generation = 0;
  private toastTimer = 0;
  private data: { list: Listing[]; held: Holding[]; moves: DealerMove[] } = { list: [], held: [], moves: [] };
  /** Limited editions: numbered cars bought and resold for NEAR. Empty where the contract has none. */
  private desk: EditionDesk = { editions: [], asks: [], mine: [] };
  /** NEAR this garage can spend, in yoctoNEAR; null while unknown. */
  private near: bigint | null = null;
  private wallet: HTMLElement;
  private walletNote = '';
  private drafts = new Map<string, string>();
  onClose: () => void = () => {};
  onPreview: (id: string, paint?: number) => void = () => {};

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'overlay hidden'; this.root.id = 'market';
    this.root.setAttribute('aria-label', 'Car market');
    this.root.innerHTML = `
      <header class="mk-head">
        <button class="mk-back" type="button" aria-label="Back to home">‹</button>
        <div class="mk-title"><small>MINIRUSH / MOTOR COLLECTION</small><strong>CAR MARKET</strong></div>
        <div class="mk-purse"><span class="mk-rush">— RUSH</span><button type="button" class="mk-near" data-near-wallet hidden>— NEAR</button><span class="mk-who">TEST BUILD</span><button type="button" class="mk-activity" data-garage-activity>ACTIVITY</button><a class="mk-ledger" href="economy/">LIVE ECONOMY ↗</a></div>
      </header>
      <div class="mk-exhibit">
        <div class="mk-heading"><span class="mk-edition">01 / ORIGINAL SERIES</span><h1>RUSH ONE</h1><p>Your chassis. Your signature.</p></div>
        <div id="market-car-stage" tabindex="0" role="img" aria-label="3D car preview. Drag or use arrow keys to rotate." data-shot="front" data-orbit="${!matchMedia('(prefers-reduced-motion: reduce)').matches}">
          <span class="mk-stage-caption">THE COLLECTION <i>01 / 15</i></span><span class="mk-drag">DRAG TO EXPLORE ↔</span>
        </div>
        <div class="mk-camera" aria-label="Showroom camera">
          <button type="button" data-shot="front" aria-pressed="true">FRONT ¾</button><button type="button" data-shot="side" aria-pressed="false">PROFILE</button><button type="button" data-shot="rear" aria-pressed="false">REAR ¾</button>
          <button type="button" class="mk-motion" aria-pressed="${!matchMedia('(prefers-reduced-motion: reduce)').matches}">AUTO ORBIT</button>
        </div>
        <aside class="mk-body" aria-label="Selected car details"></aside>
      </div>
      <footer class="mk-collection"><div class="mk-collection-head"><strong>CHOOSE YOUR MACHINE</strong><span class="mk-status" role="status">Connecting to dealers…</span><button class="mk-refresh" type="button">REFRESH ↻</button></div><div class="mk-rail" aria-label="Vehicle collection"></div></footer>
      <div class="mk-wallet" role="dialog" aria-label="Garage NEAR balance" hidden></div>
      <div class="mk-toast" role="status" aria-live="polite"></div>`;
    document.body.appendChild(this.root);
    this.body = this.root.querySelector('.mk-body')!; this.rail = this.root.querySelector('.mk-rail')!;
    this.stage = this.root.querySelector('#market-car-stage')!; this.toast = this.root.querySelector('.mk-toast')!;
    this.wallet = this.root.querySelector('.mk-wallet')!;
    this.root.addEventListener('click', e => { void this.onClick(e); });
    // A typed resale price must survive re-renders and must not reach the game's key handlers.
    this.root.addEventListener('input', e => {
      const field = (e.target as HTMLElement).closest<HTMLInputElement>('.mk-list-price');
      if (!field) return;
      this.drafts.set(field.dataset.for!, field.value);
      const price = parseNear(field.value), note = this.root.querySelector<HTMLElement>(`[data-proceeds="${CSS.escape(field.dataset.for!)}"]`);
      if (note) note.textContent = price ? `You receive ${formatNear(sellerProceeds(price), 4)} NEAR after the 2% royalty.` : 'Enter a price from 0.01 NEAR.';
    });
    this.root.addEventListener('keydown', e => { if ((e.target as HTMLElement).matches('input') && e.key !== 'Escape') e.stopPropagation(); });
    window.addEventListener('minirush:session', () => { if (!this.root.classList.contains('hidden')) this.render(); });
    this.root.addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (this.wallet.hidden) this.close(); else this.wallet.hidden = true; });
    window.addEventListener('minirush:garage-action', () => {
      if (this.root.classList.contains('hidden') || this.busy.size) return;
      if (hasPendingAction()) this.render(); else void this.refresh();
    });
  }

  async open(): Promise<void> {
    this.root.classList.remove('hidden'); this.select(this.selected);
    this.root.querySelector<HTMLButtonElement>('.mk-back')!.focus({ preventScroll: true });
    await this.refresh();
  }
  close(): void {
    ++this.generation; this.loading = false; this.live = false;
    this.root.classList.add('hidden'); this.wallet.hidden = true; this.onClose();
    document.getElementById('btn-market-home')?.focus({ preventScroll: true });
  }
  private say(html: string): void {
    this.toast.innerHTML = html; this.toast.classList.add('on');
    window.clearTimeout(this.toastTimer); this.toastTimer = window.setTimeout(() => this.toast.classList.remove('on'), 6000);
  }
  private async refresh(): Promise<void> {
    const generation = ++this.generation;
    this.loading = true; this.live = false; this.render();
    try {
      // Show the collection immediately, even while account creation is pending.
      const [list, account, moves, desk] = await Promise.all([listings(), ensureAccount(), dealerLog(60).catch(() => []), editionDesk().catch(() => null)]);
      const [held, near] = account ? await Promise.all([holdings(), nearSpendable().catch(() => null)]) : [[], null];
      if (generation !== this.generation) return;
      this.data = { list, held, moves }; this.live = true; syncCars(held);
      this.near = near;
      if (desk) { this.desk = desk; if (this.selected.startsWith('edition:')) this.heading(); }
    } catch { if (generation !== this.generation) return; this.live = false; }
    this.loading = false; this.render();
  }
  private balance(token: string): number { return Number(this.data.held.find(h => h.token_id === token)?.balance ?? 0); }
  private edition(token = this.selected): Edition | undefined { return this.desk.editions.find(e => `edition:${e.id}` === token); }
  /** The stage, title and counter for the selected limited edition. */
  private heading(): void {
    const e = this.edition(), model = e && CARS.find(c => c.id === e.model);
    if (!e || !model) return;
    this.onPreview(model.id, e.color); this.stage.dataset.car = model.id;
    this.stage.setAttribute('aria-label', `${e.name} 3D preview. Drag or use arrow keys to rotate.`);
    this.root.querySelector('.mk-heading')!.innerHTML = `<span class="mk-edition mk-limited">LIMITED EDITION · ${e.size} NUMBERED CARS</span><h1>${esc(e.name)}</h1><p>${esc(e.story)}</p>`;
    this.root.querySelector('.mk-stage-caption i')!.textContent = `${e.minted} / ${e.size} SOLD`;
  }
  private select(token: string): void {
    this.selected = token;
    const car = CARS.find(c => `car:${c.id}` === token);
    this.root.querySelector('.mk-stage-caption')!.firstChild!.textContent = this.edition() ? 'LIMITED EDITION ' : 'THE COLLECTION ';
    this.heading();
    if (car) {
      this.onPreview(car.id); this.stage.dataset.car = car.id;
      this.stage.setAttribute('aria-label', `${car.name} 3D preview. Drag or use arrow keys to rotate.`);
      const index = collection.indexOf(car) + 1;
      this.root.querySelector('.mk-heading')!.innerHTML = `<span class="mk-edition">${String(index).padStart(2, '0')} / ${car.id === 'rush-one' ? 'ORIGINAL SERIES' : `${car.class.toUpperCase()} COLLECTION`}</span><h1>${esc(car.name)}</h1><p>${esc(car.blurb)}</p>`;
      this.root.querySelector('.mk-stage-caption i')!.textContent = `${String(index).padStart(2, '0')} / ${collection.length}`;
    }
    this.render();
  }
  private stats(car: CarSpec): string {
    return `<div class="mk-stats">${(['speed', 'accel', 'grip', 'nitro'] as const).map((key, i) => `<div><span>${['TOP SPEED', 'LAUNCH', 'HANDLING', 'NITRO'][i]}</span><b>${Math.round(car[key] * 100)}</b><i><em style="width:${Math.min(100, car[key] / 1.5 * 100)}%"></em></i></div>`).join('')}</div><small class="mk-rating">Factory ratings · starter car = 100</small>`;
  }
  private offer(l: Listing): string {
    const price = Number(l.price), own = this.balance(l.token_id), busy = this.busy.size > 0;
    const pending = hasPendingAction();
    const disabled = busy || pending || !this.live || this.loading || l.stock === 0 || shopOpen() && (!nearAccount() || this.balance('rush') < price);
    const label = this.busy.has(l.token_id) ? 'COMPLETING PURCHASE…' : pending ? 'PURCHASE PROCESSING · CHECK ACTIVITY' : !this.live || this.loading ? 'PRICE UNAVAILABLE' : l.stock === 0 ? 'SOLD OUT' : !shopOpen() ? 'SIGN IN TO BUY' : !nearAccount() ? 'CONNECTION REQUIRED' : this.balance('rush') < price ? `NEED ${(price - this.balance('rush')).toLocaleString()} RUSH` : 'ACQUIRE CAR ↗';
    const move = this.data.moves.find(m => m.token === l.token_id);
    // The dealer's own words sit beside the price: an agent setting prices on chain is the point of this desk.
    const list = l.kind === 'car' ? CARS.find(c => `car:${c.id}` === l.token_id)?.price : undefined;
    const pct = list ? Math.round((price / list - 1) * 100) : 0;
    const trend = !this.live || !list ? '' : `<span class="mk-trend" data-dir="${pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'}">${pct === 0 ? 'AT LIST' : `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% ${pct > 0 ? 'OVER' : 'UNDER'} LIST`}</span>`;
    const by = !move ? '' : move.by === 'rules' ? ' · rule-based pricing' : ` · priced by ${esc(move.by)}`;
    return `<article class="mk-item"><div class="mk-dealer">${esc(DEALERS[l.dealer.split('.')[0]] ?? l.dealer)}</div>
      <div class="mk-price"><b>${this.live ? price.toLocaleString() : '—'}</b><small>RUSH</small>${trend}</div>
      <blockquote class="mk-reason"><p>${esc(l.reason)}</p><details><summary>Price details</summary><small>NEAR testnet${by}${move?.tx ? ` · <a href="${explorerTx(encodeURIComponent(move.tx))}" target="_blank" rel="noopener">View record ↗</a>` : ''}</small></details></blockquote>
      <div class="mk-meta">${l.stock} available · ${l.sold} sold${own ? ` · Owned ×${own}` : ''}</div>
      <button class="mk-buy" type="button" data-token="${esc(l.token_id)}" data-price="${esc(l.price)}" ${disabled ? 'disabled' : ''}>${l.kind === 'part' && label === 'ACQUIRE CAR ↗' ? 'BUY SUPPLY ↗' : label}</button></article>`;
  }
  /** Buy, resale and listing controls for one limited edition, all priced in NEAR. */
  private editionPanel(e: Edition): string {
    const idle = this.live && !this.loading && !this.busy.size && !hasPendingAction();
    const near = (yocto: string | bigint) => `${formatNear(yocto)} NEAR`;
    const can = (price: string) => this.near !== null && this.near >= BigInt(price);
    const label = (key: string, ready: string, price: string) => this.busy.has(key) ? 'COMPLETING PURCHASE…' : hasPendingAction() ? 'PURCHASE PROCESSING · CHECK ACTIVITY'
      : !this.live || this.loading ? 'PRICE UNAVAILABLE' : !shopOpen() ? 'SIGN IN TO BUY' : !nearAccount() ? 'CONNECTION REQUIRED' : can(price) ? ready : `ADD NEAR TO BUY · ${near(price)}`;
    const left = e.size - e.minted, model = CARS.find(c => c.id === e.model);
    const mine = this.desk.mine.filter(c => c.edition_id === e.id);
    const asks = this.desk.asks.filter(c => c.edition_id === e.id && c.owner !== nearAccount() && c.price).sort((a, b) => (BigInt(a.price!) < BigInt(b.price!) ? -1 : 1));
    const primary = `<article class="mk-item mk-ed"><div class="mk-dealer">NEW FROM MINIRUSH${left ? ` · NEXT CAR #${e.minted + 1} OF ${e.size}` : ''}</div>
      <div class="mk-price mk-nearprice"><b>${formatNear(e.price)}</b><small>NEAR</small><span class="mk-trend" data-dir="${left ? 'flat' : 'up'}">${left ? `${left} LEFT` : 'SOLD OUT'}</span></div>
      <div class="mk-run" role="img" aria-label="${e.minted} of ${e.size} sold"><i style="width:${Math.round(e.minted / e.size * 100)}%"></i></div>
      <div class="mk-meta">Numbered NFT on NEAR${onTestnet ? ' testnet' : ''} · drives as ${esc(model?.name ?? e.model)} · owners can resell for NEAR</div>
      <button class="mk-buy mk-buy-near" type="button" data-edition-buy="${esc(e.id)}" ${!idle || !left ? 'disabled' : ''}>${left ? label(`edition:${e.id}`, `ACQUIRE #${e.minted + 1} · ${near(e.price)} ↗`, e.price) : 'SOLD OUT · SEE OWNER LISTINGS'}</button></article>`;
    const owned = mine.map(c => {
      const draft = this.drafts.get(c.id) ?? '', price = parseNear(draft);
      return `<article class="mk-own"><div class="mk-own-head"><strong>YOU OWN #${c.serial} OF ${e.size}</strong><small>${c.sales ? `Last sold for ${near(c.last_price)}` : `Bought new for ${near(c.last_price)}`}</small></div>${c.price
        ? `<p>Listed for <b>${near(c.price)}</b>. You receive ${formatNear(sellerProceeds(BigInt(c.price)), 4)} NEAR when it sells.</p><button type="button" class="mk-ghost" data-edition-cancel="${esc(c.id)}" ${idle ? '' : 'disabled'}>${this.busy.has(c.id) ? 'UPDATING…' : 'CANCEL LISTING'}</button>`
        : `<label class="mk-list"><span>SELL TO ANOTHER PLAYER</span><input class="mk-list-price" data-for="${esc(c.id)}" inputmode="decimal" autocomplete="off" placeholder="Price in NEAR" value="${esc(draft)}" aria-label="Asking price in NEAR for car ${c.serial}"></label>
          <small data-proceeds="${esc(c.id)}">${price ? `You receive ${formatNear(sellerProceeds(price), 4)} NEAR after the 2% royalty.` : 'The game keeps a 2% royalty on resales.'}</small>
          <button type="button" class="mk-ghost" data-edition-list="${esc(c.id)}" ${idle ? '' : 'disabled'}>${this.busy.has(c.id) ? 'LISTING…' : 'LIST FOR SALE'}</button>`}</article>`;
    }).join('');
    const resale = !asks.length ? '' : `<section class="mk-asks" aria-label="Cars for sale by owners"><h3>FROM OWNERS</h3>${asks.map(c =>
      `<div class="mk-ask"><span><b>#${c.serial}</b><small>${esc(c.owner.split('.')[0])}</small></span><strong>${near(c.price!)}</strong><button type="button" class="mk-ghost" data-ask-buy="${esc(c.id)}" ${idle ? '' : 'disabled'}>${this.busy.has(c.id) ? 'BUYING…' : can(c.price!) ? 'BUY' : 'ADD NEAR'}</button></div>`).join('')}</section>`;
    return `<span class="mk-kicker">PERFORMANCE PROFILE</span>${model ? this.stats(model) : ''}${primary}${owned}${resale}`;
  }
  private renderWallet(): void {
    const account = nearAccount();
    this.wallet.innerHTML = `<header><small>GARAGE BALANCE</small><button type="button" data-wallet-close aria-label="Close balance">✕</button></header>
      <div class="mk-price mk-nearprice"><b>${this.near === null ? '—' : formatNear(this.near)}</b><small>NEAR</small></div>
      <p>Limited editions are paid in NEAR from your garage. You pay the price plus a network fee of under 0.01 NEAR, and nothing needs approving by hand. The balance shown already keeps 0.05 NEAR aside for that fee.</p>
      ${account ? `<label>YOUR GARAGE ADDRESS<code>${esc(account)}</code></label>
      <div class="mk-wallet-actions"><button type="button" class="mk-ghost" data-wallet-copy>COPY ADDRESS</button><a class="mk-ghost" href="${explorerAccount(encodeURIComponent(account))}" target="_blank" rel="noopener">VIEW ON CHAIN ↗</a></div>
      <small>Send NEAR to this address from any wallet or exchange to top up.</small>` : '<small>Your garage is still being set up. Try again in a moment.</small>'}
      ${onTestnet && account ? `<button type="button" class="mk-buy mk-buy-near" data-test-near ${this.busy.has('test-near') ? 'disabled' : ''}>${this.busy.has('test-near') ? 'SENDING TEST NEAR…' : 'GET TEST NEAR'}</button>` : ''}
      <p class="mk-wallet-note" role="status">${esc(this.walletNote)}</p>`;
  }
  private openWallet(note = ''): void { this.walletNote = note; this.wallet.hidden = false; this.renderWallet(); this.wallet.querySelector<HTMLElement>('[data-wallet-close]')!.focus({ preventScroll: true }); }
  private render(): void {
    const who = this.root.querySelector<HTMLElement>('.mk-who')!;
    who.textContent = this.live ? 'TEST BUILD' : this.loading ? 'Connecting…' : 'OFFLINE PREVIEW';
    this.root.querySelector('.mk-rush')!.textContent = this.live ? `${this.balance('rush').toLocaleString()} RUSH` : '— RUSH';
    this.root.querySelector('.mk-status')!.textContent = this.loading ? 'Checking dealer prices…' : this.live ? 'Live dealer prices' : 'Preview open · dealers unavailable';
    this.root.querySelector<HTMLButtonElement>('.mk-refresh')!.disabled = this.loading || this.busy.size > 0;
    const car = CARS.find(c => `car:${c.id}` === this.selected), offer = this.data.list.find(l => l.token_id === this.selected);
    const purse = this.root.querySelector<HTMLButtonElement>('.mk-near')!;
    purse.hidden = !this.desk.editions.length; purse.textContent = `${this.near === null ? '—' : formatNear(this.near)} NEAR ＋`;
    if (!this.wallet.hidden) this.renderWallet();
    const edition = this.edition();
    this.body.innerHTML = edition ? this.editionPanel(edition) : `<span class="mk-kicker">${car ? 'PERFORMANCE PROFILE' : 'RACE SUPPLIES'}</span>${car ? this.stats(car) : `<h2>${esc(offer?.name ?? 'Supplies')}</h2>`}${offer ? this.offer(offer) : `<div class="mk-preview-note"><strong>${car?.id === 'rush-one' ? 'BUILT BY YOU.' : 'COLLECTION PREVIEW'}</strong><p>${car?.id === 'rush-one' ? 'Your free custom chassis. Shape it in Garage → Customs workshop.' : this.loading ? 'Checking this car’s dealer listing…' : this.live ? 'No dealer listing for this car right now.' : 'Explore the car. Connect to dealers to check availability.'}</p></div>`}`;
    const tokens = [...this.desk.editions.map(e => ({ token: `edition:${e.id}`, name: e.name, sub: `LIMITED · ${e.minted}/${e.size}`, color: e.color })),
      ...collection.map(c => ({ token: `car:${c.id}`, name: c.name, sub: c.id === 'rush-one' ? 'YOUR CUSTOM CHASSIS' : c.class.toUpperCase(), color: c.color })),
      ...this.data.list.filter(l => !collection.some(c => `car:${c.id}` === l.token_id)).map(l => ({ token: l.token_id, name: l.name, sub: l.kind.toUpperCase(), color: 0x8b5cf6 }))];
    const scroll = this.rail.scrollLeft;
    this.rail.innerHTML = tokens.map((t, i) => `<button type="button" class="mk-select" data-select="${esc(t.token)}" aria-pressed="${t.token === this.selected}" style="--car-color:#${t.color.toString(16).padStart(6, '0')}"><span>${String(i + 1).padStart(2, '0')} <i>${t.sub}</i></span><strong>${esc(t.name)}</strong><small>${this.live && this.balance(t.token) ? 'OWNED' : this.live && this.data.list.some(l => l.token_id === t.token) ? 'DEALER LISTED' : 'EXPLORE'}</small></button>`).join('');
    this.rail.scrollLeft = scroll;
  }
  private async onClick(e: Event): Promise<void> {
    const t = e.target as HTMLElement;
    if (t.closest('.mk-back')) return this.close();
    if (t.closest('.mk-refresh')) { if (!this.loading && !this.busy.size) await this.refresh(); return; }
    const select = t.closest<HTMLButtonElement>('[data-select]');
    if (select) { this.select(select.dataset.select!); this.rail.querySelector<HTMLButtonElement>(`[data-select="${CSS.escape(this.selected)}"]`)?.focus({ preventScroll: true }); return; }
    const shot = t.closest<HTMLButtonElement>('button[data-shot]');
    if (shot) {
      this.stage.dataset.shot = shot.dataset.shot; this.stage.dataset.take = String(Date.now());
      this.root.querySelectorAll<HTMLButtonElement>('button[data-shot]').forEach(b => b.setAttribute('aria-pressed', String(b === shot))); return;
    }
    const motion = t.closest('.mk-motion');
    if (motion) { this.stage.dataset.orbit = String(this.stage.dataset.orbit !== 'true'); motion.setAttribute('aria-pressed', this.stage.dataset.orbit); return; }
    if (t.closest('[data-near-wallet]')) { if (this.wallet.hidden) this.openWallet(); else this.wallet.hidden = true; return; }
    if (t.closest('[data-wallet-close]')) { this.wallet.hidden = true; this.root.querySelector<HTMLElement>('.mk-near')?.focus({ preventScroll: true }); return; }
    if (t.closest('[data-wallet-copy]')) {
      try { await navigator.clipboard.writeText(nearAccount() ?? ''); this.walletNote = 'Address copied.'; } catch { this.walletNote = 'Copy is blocked here. Select the address above instead.'; }
      this.renderWallet(); return;
    }
    if (t.closest('[data-test-near]')) {
      if (this.busy.size) return;
      this.busy.add('test-near'); this.walletNote = ''; this.renderWallet();
      try {
        const result = await requestTestNear(); this.walletNote = result.message;
        if (result.state === 'sent') this.near = await nearSpendable().catch(() => this.near);
      } catch { this.walletNote = 'Test NEAR is unavailable right now. Try again in a moment.'; }
      this.busy.delete('test-near'); this.render(); return;
    }
    const act = t.closest<HTMLButtonElement>('[data-edition-buy],[data-ask-buy],[data-edition-list],[data-edition-cancel]');
    if (act) {
      if (act.disabled || this.busy.size || !this.live || hasPendingAction()) return;
      const d = act.dataset, e = this.edition();
      const ask = d.askBuy ? this.desk.asks.find(c => c.id === d.askBuy) : undefined;
      const cost = d.editionBuy ? e?.price : ask?.price;
      if (cost && (this.near === null || this.near < BigInt(cost))) {
        return this.openWallet(`This car costs ${formatNear(cost)} NEAR. Your garage has ${this.near === null ? 'an unknown balance' : `${formatNear(this.near)} NEAR`}.`);
      }
      const listPrice = d.editionList ? parseNear(this.drafts.get(d.editionList) ?? '') : null;
      if (d.editionList && !listPrice) return this.say('Enter an asking price from 0.01 NEAR, for example 1.5.');
      const key = d.editionBuy ? `edition:${d.editionBuy}` : (d.askBuy ?? d.editionList ?? d.editionCancel)!;
      this.busy.add(key); this.render();
      if ((d.editionBuy || d.askBuy) && !(await requireShopSession())) { this.busy.delete(key); this.render(); return; }
      try {
        if (d.editionBuy && e) { const car = await buyEdition(e.id, e.price); this.say(`<b>${esc(e.name)} #${car.serial} of ${e.size}</b> is yours. It is in your garage and on chain.`); }
        else if (ask) { const car = await buyEditionCar(ask); this.say(`<b>${esc(e?.name ?? 'Limited edition')} #${car.serial}</b> is yours. The seller has been paid.`); }
        else if (d.editionList && listPrice) { await listEditionCar(d.editionList, listPrice); this.drafts.delete(d.editionList); this.say(`Listed for <b>${formatNear(listPrice)} NEAR</b>. Other players can buy it now.`); }
        else if (d.editionCancel) { await cancelEditionListing(d.editionCancel); this.say('Listing cancelled. The car stays in your garage.'); }
      } catch (err) { this.say(esc(err instanceof Error ? err.message : 'Please check Activity before trying again.')); }
      finally { this.busy.delete(key); if (!this.root.classList.contains('hidden')) await this.refresh(); }
      return;
    }
    const btn = t.closest<HTMLButtonElement>('.mk-buy');
    if (!btn || btn.disabled || this.busy.size || !this.live || hasPendingAction()) return;
    const token = btn.dataset.token!, price = btn.dataset.price!;
    this.busy.add(token); this.render();
    if (!(await requireShopSession())) { this.busy.delete(token); this.render(); return; }
    try {
      await buy(token, price);
      this.say(`<b>${esc(this.data.list.find(l => l.token_id === token)?.name ?? token)}</b> is yours. Purchase saved in Activity.`);
    } catch (err) { this.say(esc(err instanceof Error ? err.message : 'Please check Activity before trying again.')); }
    finally {
      this.busy.delete(token);
      if (!this.root.classList.contains('hidden')) await this.refresh();
    }
  }
}
