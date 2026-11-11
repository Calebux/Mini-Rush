/** A live NEAR dealer desk around the game's shared 3D showroom. */
import { CARS, type CarSpec } from './cars';
import {
  buy, dealerLog, ensureAccount, explorerAccount, explorerTx, holdings, listings, nearAccount, syncCars,
  type DealerMove, type Holding, type Listing
} from './near';

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
  onClose: () => void = () => {};
  onPreview: (id: string) => void = () => {};

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'overlay hidden'; this.root.id = 'market';
    this.root.setAttribute('aria-label', 'Car market');
    this.root.innerHTML = `
      <header class="mk-head">
        <button class="mk-back" type="button" aria-label="Back to home">‹</button>
        <div class="mk-title"><small>MINIRUSH / MOTOR COLLECTION</small><strong>CAR MARKET</strong></div>
        <div class="mk-purse"><span class="mk-rush">— RUSH</span><a class="mk-who" target="_blank" rel="noopener">Connecting…</a><a class="mk-ledger" href="economy/">LIVE ECONOMY ↗</a></div>
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
      <div class="mk-toast" role="status" aria-live="polite"></div>`;
    document.body.appendChild(this.root);
    this.body = this.root.querySelector('.mk-body')!; this.rail = this.root.querySelector('.mk-rail')!;
    this.stage = this.root.querySelector('#market-car-stage')!; this.toast = this.root.querySelector('.mk-toast')!;
    this.root.addEventListener('click', e => { void this.onClick(e); });
    this.root.addEventListener('keydown', e => { if (e.key === 'Escape') this.close(); });
  }

  async open(): Promise<void> {
    this.root.classList.remove('hidden'); this.select(this.selected);
    this.root.querySelector<HTMLButtonElement>('.mk-back')!.focus({ preventScroll: true });
    await this.refresh();
  }
  close(): void {
    ++this.generation; this.loading = false; this.live = false;
    this.root.classList.add('hidden'); this.onClose();
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
      const [list, account, moves] = await Promise.all([listings(), ensureAccount(), dealerLog(60).catch(() => [])]);
      const held = account ? await holdings() : [];
      if (generation !== this.generation) return;
      this.data = { list, held, moves }; this.live = true; syncCars(held);
    } catch { if (generation !== this.generation) return; this.live = false; }
    this.loading = false; this.render();
  }
  private balance(token: string): number { return Number(this.data.held.find(h => h.token_id === token)?.balance ?? 0); }
  private select(token: string): void {
    this.selected = token;
    const car = CARS.find(c => `car:${c.id}` === token);
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
    const disabled = busy || !this.live || this.loading || !nearAccount() || l.stock === 0 || this.balance('rush') < price;
    const label = this.busy.has(l.token_id) ? 'SIGNING…' : !this.live || this.loading ? 'PRICE UNAVAILABLE' : !nearAccount() ? 'CONNECTION REQUIRED' : l.stock === 0 ? 'SOLD OUT' : this.balance('rush') < price ? `NEED ${(price - this.balance('rush')).toLocaleString()} RUSH` : 'ACQUIRE CAR ↗';
    const move = this.data.moves.find(m => m.token === l.token_id);
    // The dealer's own words sit beside the price: an agent setting prices on chain is the point of this desk.
    const list = l.kind === 'car' ? CARS.find(c => `car:${c.id}` === l.token_id)?.price : undefined;
    const pct = list ? Math.round((price / list - 1) * 100) : 0;
    const trend = !this.live || !list ? '' : `<span class="mk-trend" data-dir="${pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'}">${pct === 0 ? 'AT LIST' : `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% ${pct > 0 ? 'OVER' : 'UNDER'} LIST`}</span>`;
    const by = !move ? '' : move.by === 'rules' ? ' · rule-based pricing' : ` · priced by ${esc(move.by)}`;
    return `<article class="mk-item"><div class="mk-dealer">${esc(DEALERS[l.dealer.split('.')[0]] ?? l.dealer)}</div>
      <div class="mk-price"><b>${this.live ? price.toLocaleString() : '—'}</b><small>RUSH</small>${trend}</div>
      <blockquote class="mk-reason"><p>${esc(l.reason)}</p><small>Set on NEAR testnet${by}${move?.tx ? ` · <a href="${explorerTx(encodeURIComponent(move.tx))}" target="_blank" rel="noopener">Receipt ↗</a>` : ''}</small></blockquote>
      <div class="mk-meta">${l.stock} available · ${l.sold} sold${own ? ` · Owned ×${own}` : ''}</div>
      <button class="mk-buy" type="button" data-token="${esc(l.token_id)}" data-price="${esc(l.price)}" ${disabled ? 'disabled' : ''}>${l.kind === 'part' && label === 'ACQUIRE CAR ↗' ? 'BUY SUPPLY ↗' : label}</button></article>`;
  }
  private render(): void {
    const account = nearAccount(), who = this.root.querySelector<HTMLAnchorElement>('.mk-who')!;
    who.textContent = this.loading ? 'Connecting…' : this.live ? 'NEAR TESTNET' : 'OFFLINE PREVIEW';
    if (account) who.href = explorerAccount(account); else who.removeAttribute('href');
    this.root.querySelector('.mk-rush')!.textContent = this.live ? `${this.balance('rush').toLocaleString()} RUSH` : '— RUSH';
    this.root.querySelector('.mk-status')!.textContent = this.loading ? 'Checking dealer prices…' : this.live ? 'Dealer prices · NEAR testnet' : 'Preview open · dealers unavailable';
    this.root.querySelector<HTMLButtonElement>('.mk-refresh')!.disabled = this.loading || this.busy.size > 0;
    const car = CARS.find(c => `car:${c.id}` === this.selected), offer = this.data.list.find(l => l.token_id === this.selected);
    this.body.innerHTML = `<span class="mk-kicker">${car ? 'PERFORMANCE PROFILE' : 'RACE SUPPLIES'}</span>${car ? this.stats(car) : `<h2>${esc(offer?.name ?? 'Supplies')}</h2>`}${offer ? this.offer(offer) : `<div class="mk-preview-note"><strong>${car?.id === 'rush-one' ? 'BUILT BY YOU.' : 'COLLECTION PREVIEW'}</strong><p>${car?.id === 'rush-one' ? 'Your free custom chassis. Shape it in Garage → Customs workshop.' : this.loading ? 'Checking this car’s dealer listing…' : this.live ? 'No dealer listing for this car right now.' : 'Explore the car. Connect to dealers to check availability.'}</p></div>`}`;
    const tokens = [...collection.map(c => ({ token: `car:${c.id}`, name: c.name, sub: c.id === 'rush-one' ? 'YOUR CUSTOM CHASSIS' : c.class.toUpperCase(), color: c.color })),
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
    const btn = t.closest<HTMLButtonElement>('.mk-buy');
    if (!btn || btn.disabled || this.busy.size || !this.live) return;
    const token = btn.dataset.token!, price = btn.dataset.price!;
    this.busy.add(token); this.render();
    try {
      const tx = await buy(token, price);
      this.say(`<b>${esc(this.data.list.find(l => l.token_id === token)?.name ?? token)}</b> is yours. <a href="${explorerTx(encodeURIComponent(tx))}" target="_blank" rel="noopener">View receipt ↗</a>`);
    } catch (err) { this.say(`Couldn't buy: ${esc(err instanceof Error ? err.message : 'Please try again.')}`); }
    finally {
      this.busy.delete(token);
      if (!this.root.classList.contains('hidden')) await this.refresh();
    }
  }
}
