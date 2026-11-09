/**
 * The Car Market: three dealer stalls whose prices are set by AI agents on
 * NEAR. Every price carries the dealer's own reason (stored on chain with the
 * price); tapping ⓘ shows it with who decided, when, and the transaction.
 */
import {
  buy, dealerLog, ensureAccount, explorerAccount, explorerTx, holdings, listings, nearAccount, syncCars,
  type DealerMove, type Holding, type Listing
} from './near';

const DEALERS: Record<string, { name: string; place: string; blurb: string }> = {
  'mama-t': { name: 'MAMA T', place: 'Ladipo scrapyard · Lagos', blurb: 'Moves metal fast. Cuts the price when a car sits.' },
  'oga-motors': { name: 'OGA MOTORS', place: 'Island showroom', blurb: 'Scarcity is the business. Never cheap.' },
  'tuner-ade': { name: 'TUNER ADE', place: 'Tuning bay', blurb: 'Prices nitro off how many people are racing.' }
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const ago = (ms: number) => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};
const shortAcc = (a: string) => a.split('.')[0];

export class Market {
  private root: HTMLElement;
  private body: HTMLElement;
  private purse: HTMLElement;
  private who: HTMLAnchorElement;
  private toast: HTMLElement;
  private busy = new Set<string>();
  private data: { list: Listing[]; held: Holding[]; moves: DealerMove[] } = { list: [], held: [], moves: [] };
  onClose: () => void = () => {};

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'overlay hidden';
    this.root.id = 'market';
    this.root.setAttribute('aria-label', 'Car market');
    this.root.innerHTML = `
      <header class="mk-head">
        <button class="mk-back" type="button" aria-label="Back">‹</button>
        <div class="mk-title"><small>LIVE ON NEAR TESTNET</small><strong>CAR MARKET</strong></div>
        <div class="mk-purse"><span class="mk-rush">— RUSH</span><a class="mk-who" target="_blank" rel="noopener"></a></div>
      </header>
      <p class="mk-lede">Three dealers run by AI agents. They watch sales and race traffic, reprice every 15 minutes, and sign each price on chain with the reason. Tap <b>ⓘ</b> to read it.</p>
      <div class="mk-body"><div class="mk-empty">Opening the market…</div></div>
      <div class="mk-toast" role="status" aria-live="polite"></div>`;
    document.body.appendChild(this.root);
    this.body = this.root.querySelector('.mk-body')!;
    this.purse = this.root.querySelector('.mk-rush')!;
    this.who = this.root.querySelector('.mk-who')!;
    this.toast = this.root.querySelector('.mk-toast')!;
    this.root.querySelector('.mk-back')!.addEventListener('click', () => this.close());
    this.body.addEventListener('click', (e) => this.onClick(e));
  }

  async open(): Promise<void> {
    this.root.classList.remove('hidden');
    await this.refresh();
  }

  close(): void {
    this.root.classList.add('hidden');
    this.onClose();
  }

  private say(html: string, ms = 5200): void {
    this.toast.innerHTML = html;
    this.toast.classList.add('on');
    window.clearTimeout((this.toast as unknown as { t?: number }).t);
    (this.toast as unknown as { t?: number }).t = window.setTimeout(() => this.toast.classList.remove('on'), ms);
  }

  private async refresh(): Promise<void> {
    const account = await ensureAccount();
    if (account) {
      this.who.textContent = shortAcc(account);
      this.who.href = explorerAccount(account);
    } else {
      this.who.textContent = 'offline';
      this.who.removeAttribute('href');
    }
    try {
      const [list, held, moves] = await Promise.all([listings(), holdings(), dealerLog(60).catch(() => [])]);
      this.data = { list, held, moves };
      syncCars(held);
    } catch {
      if (!this.data.list.length) this.body.innerHTML = '<div class="mk-empty">Can\'t reach NEAR right now. Race on; the market will be here.</div>';
      return;
    }
    this.render();
  }

  private balance(token: string): number {
    return Number(this.data.held.find((h) => h.token_id === token)?.balance ?? 0);
  }

  private render(): void {
    this.purse.textContent = `${this.balance('rush').toLocaleString()} RUSH`;
    const byDealer = new Map<string, Listing[]>();
    for (const l of this.data.list) {
      const d = l.dealer.split('.')[0];
      byDealer.set(d, [...(byDealer.get(d) ?? []), l]);
    }
    const rush = this.balance('rush');
    let html = '';
    for (const [id, meta] of Object.entries(DEALERS)) {
      const items = (byDealer.get(id) ?? []).sort((a, b) => Number(a.price) - Number(b.price));
      if (!items.length) continue;
      html += `<section class="mk-stall" data-dealer="${id}">
        <div class="mk-stall-head"><strong>${meta.name}</strong><span>${meta.place}</span><em>${meta.blurb}</em></div>
        <div class="mk-items">`;
      for (const l of items) {
        const price = Number(l.price);
        const last = this.data.moves.find((m) => m.token === l.token_id && m.oldPrice !== m.price);
        const trend = last ? (last.price > last.oldPrice ? 'up' : 'down') : '';
        const delta = last ? Math.round(((last.price - last.oldPrice) / last.oldPrice) * 100) : 0;
        const own = this.balance(l.token_id);
        const busy = this.busy.has(l.token_id);
        const why = this.data.moves.find((m) => m.token === l.token_id);
        const label = busy ? 'SIGNING…' : l.stock === 0 ? 'SOLD OUT' : rush < price ? `NEED ${price - rush}` : 'BUY';
        html += `<article class="mk-item${own ? ' owned' : ''}">
          <div class="mk-item-top"><span class="mk-kind">${l.kind === 'part' ? 'PART' : 'CAR'}</span>${own ? `<span class="mk-own">OWNED ×${own}</span>` : ''}</div>
          <strong class="mk-name">${esc(l.name)}</strong>
          <div class="mk-price"><b>${price.toLocaleString()}</b><small>RUSH</small>${trend ? `<i class="mk-trend ${trend}">${trend === 'up' ? '▲' : '▼'} ${Math.abs(delta)}%</i>` : ''}
            <button class="mk-why" type="button" aria-expanded="false" aria-label="Why this price">ⓘ</button></div>
          <div class="mk-reason" hidden>
            <p>“${esc(l.reason)}”</p>
            <small>${meta.name} · ${why ? `${why.by === 'rules' ? 'pricing rules' : esc(why.by)} · ` : ''}${ago(l.updated_ms)}${why?.tx ? ` · <a href="${explorerTx(why.tx)}" target="_blank" rel="noopener">tx ↗</a>` : ''}</small>
          </div>
          <div class="mk-meta">${l.stock} in stock · ${l.sold} sold</div>
          <button class="mk-buy" type="button" data-token="${l.token_id}" data-price="${price}"
            ${busy || l.stock === 0 || rush < price ? 'disabled' : ''}>${label}</button>
        </article>`;
      }
      html += '</div></section>';
    }
    this.body.innerHTML = html || '<div class="mk-empty">No stalls open.</div>';
    if (!nearAccount()) this.say('Setting up your garage on NEAR…', 2500);
  }

  private async onClick(e: Event): Promise<void> {
    const t = e.target as HTMLElement;
    const why = t.closest('.mk-why') as HTMLButtonElement | null;
    if (why) {
      const box = why.closest('.mk-item')!.querySelector('.mk-reason') as HTMLElement;
      box.hidden = !box.hidden;
      why.setAttribute('aria-expanded', String(!box.hidden));
      return;
    }
    const btn = t.closest('.mk-buy') as HTMLButtonElement | null;
    if (!btn || btn.disabled) return;
    const token = btn.dataset.token!, price = btn.dataset.price!;
    this.busy.add(token);
    this.render();
    try {
      const tx = await buy(token, price);
      const name = this.data.list.find((l) => l.token_id === token)?.name ?? token;
      this.say(`<b>${esc(name)}</b> is yours — on NEAR, gas paid by the game. <a href="${explorerTx(tx)}" target="_blank" rel="noopener">View tx ↗</a>`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed';
      this.say(msg.includes('price went up') ? 'The dealer just raised that price. Check the new one.' : `Couldn't buy: ${esc(msg)}`);
    } finally {
      this.busy.delete(token);
      await this.refresh();
    }
  }
}
