import type { AudioManager } from './audio';

/**
 * NEON FM: internet radio in the game, from the Radio Browser directory
 * (radio-browser.info, a free, open API). Pick a band (a genre); the band is
 * filled with the most-played stations that stream over HTTPS in MP3 or AAC,
 * and it moves on by itself if one will not play.
 *
 * The streams belong to their stations: the station's name is always on
 * screen while it plays, and the directory is told about each play, as it
 * asks. While the radio is on, the game's own music stands down.
 */

interface Station { uuid: string; name: string; url: string; country: string; homepage: string }

export const BANDS = [
  { id: 'night', label: 'NIGHT DRIVE', tag: 'synthwave' },
  { id: 'lagos', label: 'LAGOS', tag: 'afrobeats' },
  { id: 'street', label: 'STREET', tag: 'hip hop' },
  { id: 'phonk', label: 'PHONK', tag: 'phonk' },
  { id: 'club', label: 'CLUB', tag: 'electronic' },
  { id: 'dnb', label: 'DRUM & BASS', tag: 'drum and bass' },
  { id: 'chill', label: 'CHILL', tag: 'lofi' }
] as const;
export type BandId = typeof BANDS[number]['id'];

// Radio Browser runs several equal mirrors; try them in turn.
const MIRRORS = ['de1', 'nl1', 'at1', 'de2'].map((m) => `https://${m}.api.radio-browser.info`);
const STORE = 'minirush.radio';
const STALL_MS = 9000;       // no sound by then: try the next station

export class Radio {
  private el = new Audio();
  private lists = new Map<BandId, Station[]>();
  private band: BandId | null = null;
  private index = 0;
  private stallTimer: number | null = null;
  private tries = 0;
  /** Changes to what is playing, for the panel and HUD tags. */
  onChange: () => void = () => {};
  state: 'off' | 'tuning' | 'playing' | 'failed' = 'off';

  constructor(private audio: AudioManager) {
    this.el.preload = 'none';
    this.el.crossOrigin = null;
    this.el.addEventListener('playing', () => {
      this.clearStall();
      this.tries = 0;
      this.state = 'playing';
      this.onChange();
    });
    for (const ev of ['error', 'stalled'] as const) {
      this.el.addEventListener(ev, () => { if (this.band) this.skip(); });
    }
    audio.onLevel = (volume, muted) => { this.el.volume = volume * 0.85; this.el.muted = muted; };
    this.el.volume = audio.level * 0.85;
    this.el.muted = audio.isMuted;
  }

  get current(): { band: string; station: string; country: string; homepage: string } | null {
    if (!this.band) return null;
    const s = this.lists.get(this.band)?.[this.index];
    const band = BANDS.find((b) => b.id === this.band)!.label;
    return { band, station: s?.name.trim() ?? '', country: s?.country ?? '', homepage: s?.homepage ?? '' };
  }

  get bandId(): BandId | null {
    return this.band;
  }

  /** The band the player last listened to, to offer again. */
  static saved(): BandId | null {
    try {
      const id = localStorage.getItem(STORE);
      return BANDS.some((b) => b.id === id) ? id as BandId : null;
    } catch { return null; }
  }

  /** Tune to a band (from a tap: browsers only allow sound after a gesture). */
  async tune(band: BandId): Promise<void> {
    this.band = band;
    this.index = 0;
    this.tries = 0;
    this.state = 'tuning';
    this.audio.setRadio(true);
    try { localStorage.setItem(STORE, band); } catch { /* remembered this session only */ }
    this.onChange();
    const list = await this.stations(band);
    if (this.band !== band) return;
    if (!list.length) { this.fail(); return; }
    this.play();
  }

  /** From the wheel: tune in if off (the last band, or Night Drive), else next station. */
  next(): void {
    if (this.state === 'off' || this.state === 'failed' || !this.band) void this.tune(Radio.saved() ?? 'night');
    else this.skip();
  }

  /** Next station in the band. */
  skip(): void {
    const list = this.band ? this.lists.get(this.band) : null;
    if (!list?.length) return;
    this.tries++;
    if (this.tries > Math.min(list.length, 6)) { this.fail(); return; }
    this.index = (this.index + 1) % list.length;
    this.state = 'tuning';
    this.onChange();
    this.play();
  }

  off(): void {
    this.band = null;
    this.state = 'off';
    this.clearStall();
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    this.audio.setRadio(false);
    this.onChange();
  }

  private play(): void {
    const station = this.band ? this.lists.get(this.band)?.[this.index] : null;
    if (!station) return;
    this.clearStall();
    this.el.src = station.url;
    void this.el.play().catch(() => { /* 'error' moves on */ });
    this.stallTimer = window.setTimeout(() => this.skip(), STALL_MS);
    // the directory counts plays to rank stations; it asks clients to report them
    void this.api(`/json/url/${station.uuid}`).catch(() => {});
  }

  private fail(): void {
    this.clearStall();
    this.el.pause();
    this.state = 'failed';
    this.audio.setRadio(false);
    this.onChange();
  }

  private clearStall(): void {
    if (this.stallTimer !== null) window.clearTimeout(this.stallTimer);
    this.stallTimer = null;
  }

  /** The band's stations: the most-played ones that stream over HTTPS in MP3/AAC. */
  private async stations(band: BandId): Promise<Station[]> {
    const cached = this.lists.get(band);
    if (cached) return cached;
    const tag = BANDS.find((b) => b.id === band)!.tag;
    try {
      const rows = await this.api(`/json/stations/search?tag=${encodeURIComponent(tag)}` +
        '&hidebroken=true&order=clickcount&reverse=true&limit=60') as Record<string, unknown>[];
      const list = rows
        .filter((r) => typeof r.url_resolved === 'string' && (r.url_resolved as string).startsWith('https://')
          && ['MP3', 'AAC', 'AAC+'].includes(String(r.codec)) && r.lastcheckok === 1)
        .slice(0, 12)
        .map((r) => ({ uuid: String(r.stationuuid), name: String(r.name), url: String(r.url_resolved),
          country: String(r.countrycode ?? ''), homepage: String(r.homepage ?? '') }));
      this.lists.set(band, list);
      return list;
    } catch {
      return [];
    }
  }

  private async api(path: string): Promise<unknown> {
    for (const base of MIRRORS) {
      try {
        const res = await fetch(base + path, { signal: AbortSignal.timeout(6000) });
        if (res.ok) return await res.json();
      } catch { /* next mirror */ }
    }
    throw new Error('radio directory unreachable');
  }
}

/**
 * The NEON FM panel: band chips, what is playing, next and off. One panel,
 * opened from any radio button in the menu, the pause card or the city HUD.
 */
export class RadioPanel {
  private el: HTMLElement;
  private tags = new Set<HTMLElement>();

  constructor(private radio: Radio) {
    this.el = document.createElement('div');
    this.el.id = 'radio-panel';
    this.el.dataset.padLayer = '';   // a controller works this panel while it is open
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="radio-card" role="dialog" aria-label="NEON FM radio">
        <div class="radio-head"><strong>📻 NEON FM</strong><button type="button" class="radio-x" aria-label="Close">✕</button></div>
        <div class="radio-now"><small id="radio-band">RADIO OFF</small><b id="radio-station">Pick a band to tune in</b><em id="radio-meta"></em></div>
        <div class="radio-bands">${BANDS.map((b) => `<button type="button" data-band="${b.id}">${b.label}</button>`).join('')}</div>
        <div class="radio-actions">
          <button type="button" class="radio-next">NEXT STATION ›</button>
          <button type="button" class="radio-off">OFF</button>
        </div>
        <p class="radio-note">Live internet radio via radio-browser.info. Streams and music belong to their stations.</p>
      </div>`;
    document.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
    this.el.querySelector('.radio-x')!.addEventListener('click', () => this.close());
    this.el.querySelector('.radio-next')!.addEventListener('click', () => radio.skip());
    this.el.querySelector('.radio-off')!.addEventListener('click', () => radio.off());
    this.el.querySelectorAll<HTMLButtonElement>('[data-band]').forEach((b) =>
      b.addEventListener('click', () => void radio.tune(b.dataset.band as BandId)));
    radio.onChange = () => this.render();
    this.render();
  }

  open(): void {
    this.el.hidden = false;
    this.render();
  }

  close(): void {
    this.el.hidden = true;
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** A button elsewhere that opens the panel and shows what is on. */
  attach(button: HTMLElement): void {
    this.tags.add(button);
    button.addEventListener('click', (e) => { e.stopPropagation(); this.open(); });
    this.render();
  }

  private render(): void {
    const now = this.radio.current;
    const s = this.radio.state;
    const $ = (id: string) => this.el.querySelector(`#${id}`) as HTMLElement;
    $('radio-band').textContent = now ? `${now.band} · ${s === 'tuning' ? 'TUNING…' : s === 'failed' ? 'NO SIGNAL' : 'LIVE'}` : 'RADIO OFF';
    $('radio-station').textContent = s === 'failed' ? 'No station would play. Try another band.'
      : now?.station || (s === 'tuning' ? 'Finding a station…' : 'Pick a band to tune in');
    $('radio-meta').textContent = now?.country ? now.country : '';
    this.el.querySelectorAll<HTMLButtonElement>('[data-band]').forEach((b) =>
      b.classList.toggle('on', b.dataset.band === this.radio.bandId));
    for (const btn of document.querySelectorAll<HTMLElement>('.radio-next-hud')) {
      btn.classList.toggle('on', s === 'playing' || s === 'tuning');
      btn.title = now?.station ? `NEON FM · ${now.station} — tap for the next station` : 'Radio: tap to tune in';
    }
    for (const tag of this.tags) {
      tag.classList.toggle('on', s === 'playing' || s === 'tuning');
      // Compact tags (the menu's volume row) only say whether it is on; the
      // station's name is in the panel and in the tag's tooltip.
      const compact = tag.dataset.compact === '1';
      tag.textContent = compact ? (s === 'playing' ? '📻 LIVE' : s === 'tuning' ? '📻 …' : '📻')
        : s === 'playing' && now ? `📻 ${now.station.slice(0, 22)}` : s === 'tuning' ? '📻 TUNING…' : '📻 RADIO';
      tag.title = now?.station ? `NEON FM · ${now.station}` : 'NEON FM radio';
    }
  }
}
