import { listings, viewCall } from './near';
import { formatNear, type Edition, type EditionCar } from '../shared/editions';

/** Public market reads only. Hidden menus and background tabs do not poll. */
export function installHomePriceWire(): void {
  const menu = document.getElementById('menu')!;
  const root = document.getElementById('home-price-wire')!;
  const track = root.querySelector<HTMLElement>('.hpw-track')!;
  const status = root.querySelector<HTMLElement>('[data-wire-status]')!;
  const pause = root.querySelector<HTMLButtonElement>('.hpw-pause')!;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let rows: [string, string][] = [], key = '', lastSuccess = 0, lastAttempt = 0, loading = false;
  let paused = false;
  const visible = () => !document.hidden && !menu.classList.contains('hidden');

  function render(): void {
    const strip = document.createElement('span');
    strip.className = 'hpw-strip';
    for (const [name, price] of rows) {
      const item = document.createElement('span'), label = document.createElement('b'), value = document.createElement('span');
      item.className = 'hpw-item'; label.textContent = name; value.textContent = price;
      item.append(label, value); strip.append(item);
    }
    const copy = strip.cloneNode(true) as HTMLElement;
    copy.setAttribute('aria-hidden', 'true');
    track.replaceChildren(strip, ...(reduced.matches ? [] : [copy]));
    root.style.setProperty('--wire-duration', `${Math.max(30, rows.length * 5)}s`);
  }
  function motion(): void {
    root.dataset.paused = String(paused || reduced.matches || !visible());
    pause.hidden = reduced.matches;
    pause.setAttribute('aria-pressed', String(paused));
    pause.setAttribute('aria-label', paused ? 'Resume price wire' : 'Pause price wire');
    pause.textContent = paused ? '▶' : 'Ⅱ';
  }
  async function refresh(force = false): Promise<void> {
    if (!visible() || loading || (!force && Date.now() - lastAttempt < 30_000)) return;
    loading = true; lastAttempt = Date.now();
    try {
      const [stalls, editions, asks] = await Promise.all([
        listings(), viewCall<Edition[]>('editions', {}), viewCall<EditionCar[]>('edition_asks', { limit: 100 })
      ]);
      const offers = asks.filter(car => car.price !== null);
      const next: [string, string][] = [
        ['OWNER LISTINGS', offers.length ? `${offers.length}${offers.length >= 100 ? '+' : ''} FOR SALE` : 'NONE YET'],
        ...editions.map((e): [string, string] => [e.name, e.minted < e.size ? `${formatNear(e.price)} NEAR · ${e.size - e.minted} LEFT` : 'SOLD OUT']),
        ...stalls.filter(s => s.stock > 0).map((s): [string, string] => [s.name, `${Number(s.price).toLocaleString('en-US')} RUSH`])
      ];
      const nextKey = JSON.stringify(next);
      if (nextKey !== key) { rows = next; key = nextKey; render(); }
      lastSuccess = Date.now(); root.dataset.state = 'live'; status.textContent = 'LIVE';
      root.title = `NEAR testnet prices checked at ${new Date(lastSuccess).toLocaleTimeString()}. Open the market to confirm a purchase price.`;
    } catch {
      root.dataset.state = lastSuccess ? 'stale' : 'offline';
      status.textContent = lastSuccess ? 'LAST SEEN' : 'OFFLINE';
      if (!lastSuccess) track.textContent = 'Prices unavailable · You can still race';
      root.title = lastSuccess ? `Last checked ${new Date(lastSuccess).toLocaleTimeString()}. Prices may have changed.` : 'The market could not be reached. Retrying while you are on the homepage.';
    } finally { loading = false; }
  }
  pause.addEventListener('click', () => { paused = !paused; motion(); });
  reduced.addEventListener('change', () => { if (rows.length) render(); motion(); });
  const resume = () => { motion(); void refresh(); };
  new MutationObserver(resume).observe(menu, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', () => { void refresh(true); });
  window.setInterval(() => { void refresh(); }, 60_000);
  motion(); void refresh();
}
