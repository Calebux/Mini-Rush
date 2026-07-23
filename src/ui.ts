import { AudioManager } from './audio';
import { CARS } from './cars';
import { dailyMapIndex, dayKey } from './daily';
import { weekKey, weeklyMapIndex, weeklyModeIndex, WEEKLY_PRIZES } from './weekly';
import { bank, owned, unlock } from './economy';
import { Leaderboard } from './leaderboard';
import { MAPS } from './maps';
import { MODES } from './modes';
import { mapUnlocked, stamps } from './passport';
import { playerId, remoteEnabled, submitDaily, topDaily } from './remoteBoard';
import { shareUrl } from './referral';
import { RunCard, shareRun } from './share';
import { activeSkinIndex, buySkin, CAR_SKINS, equipSkin, skinOwned } from './skins';
import { favoriteMode, getStats, winRate } from './stats';
import { currentStreak, weekProgress } from './streak';
import {
  applyUpgrades, buyTier, MAX_TIER, TIER_COST, tier, UPGRADE_LABEL, UpgradeStat
} from './upgrades';
import { BADGES, Wallet } from './wallet';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const BEST_KEY = 'minirush.best';
const PLACE_SUFFIX = ['st', 'nd', 'rd', 'th'];
const suffix = (place: number) => PLACE_SUFFIX[Math.min(place, 4) - 1];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
// mouse + hover ⇒ a physical keyboard is almost certainly attached
const hasKeyboard = () => matchMedia('(any-hover: hover) and (any-pointer: fine)').matches;
const MODE_RISK: Record<string, string> = {
  gp: 'RACE',
  burnout: 'WILD',
  outbreak: 'HORDE',
  hijack: 'CLING',
  copchase: 'HEAT',
  gunrun: 'ARMED',
  timeattack: 'GHOST',
  eliminator: 'KNOCKOUT',
  trafficjam: 'DENSE',
  heist: 'HEIST',
  infected: 'VIRUS',
  voltage: 'SURGE'
};

export class UI {
  onPlay: () => void = () => {};
  onRetrySame: () => void = () => {};
  onBrake: (down: boolean) => void = () => {};
  onGas: (down: boolean) => void = () => {};
  onCamera: () => void = () => {};
  onLaps: (n: number) => void = () => {};
  onCar: (index: number) => void = () => {};
  onMap: (index: number) => void = () => {};
  onMode: (index: number) => void = () => {};
  onPage: (page: 'menu' | 'garage' | 'tour') => void = () => {};
  onNitroPress: () => void = () => {}; // the pill itself — needed when tap = shoot
  onDaily: () => void = () => {};      // daily challenge picked from the menu
  onDailyExit: () => void = () => {};  // backed out of / done with the daily
  onWeekly: () => void = () => {};     // Weekly Cup picked from the menu
  onWeeklyExit: () => void = () => {}; // backed out of / done with the Weekly Cup

  private menu = $('menu');
  private results = $('results');
  private hud = $('hud');
  private hudPos = $('hud-pos');
  private hudTime = $('hud-time');
  private hudCoins = $('hud-coins');
  private hudZombies = $('hud-zombies');
  private nitroUi = $('nitro-ui');
  private speedlines = $('speedlines');
  private hudSpeed = $('hud-speed-v');
  private hudLap = $('hud-lap');
  private combo = $('combo');
  private countdownEl = $('countdown');
  private progress = $('progress');
  private driftUi = $('drift-ui');
  private driftTime = $('drift-time');
  private modeButtons: HTMLElement[] = [];
  private modeCards: HTMLElement[] = [];
  private dots: HTMLElement[] = [];
  private board = new Leaderboard();
  private carIndex = 0;
  private mapIndex = 0;
  private pickedLaps = 2; // the user's own choice, restored when a lock lifts
  private dailyUi = false; // garage reached via DAILY RUN, not the tour flow
  private weeklyUi = false; // garage reached via WEEKLY CUP, not the tour flow
  private tutTimers: number[] = [];
  private keyHintTimer = 0;
  private modeIndex = 0;
  private lastRun: RunCard | null = null;

  constructor(private wallet: Wallet, private audio: AudioManager) {
    // blur so Space/Enter (nitro key) can't re-trigger the focused button
    const on = (id: string, fn: () => void) =>
      $(id).addEventListener('click', (e) => {
        (e.currentTarget as HTMLElement).blur();
        fn();
      });
    on('btn-retry', () => this.onPlay());
    on('btn-retry-same', () => this.onRetrySame());
    on('btn-share', () => {
      if (this.lastRun) void shareRun(this.lastRun, shareUrl(this.wallet.address));
    });
    on('btn-menu', () => {
      this.audio.play('back');
      this.results.classList.add('hidden');
      this.menu.classList.remove('hidden');
      this.exitDaily();
      this.exitWeekly();
      this.refreshDaily();
      this.refreshWeekly();
      this.refreshBank();
    });
    void this.autoConnect(); // MiniPay connects silently; other wallets get a CONNECT chip

    // wallet chip → driver card (connecting first if needed)
    on('wallet-chip', () => void this.onWalletChip());
    on('btn-profile-close', () => {
      this.audio.play('back');
      $('profile').classList.add('hidden');
      this.menu.classList.remove('hidden');
    });

    // race setup flow: RACE → city (tour flyby) → car (garage turntable)
    // + laps → START. The game camera follows each step via onPage.
    const goto = (
      from: 'menu' | 'tour' | 'garage', to: 'menu' | 'tour' | 'garage',
      sound: 'click' | 'back' = 'click'
    ) => {
      this.audio.play(sound);
      (from === 'menu' ? this.menu : $(from)).classList.add('hidden');
      (to === 'menu' ? this.menu : $(to)).classList.remove('hidden');
      this.onPage(to);
    };
    on('btn-play', () => {
      this.audio.unlock();
      this.exitDaily();
      goto('menu', 'tour');
    });
    // driver card → back to the lobby menu, ready to hit RACE
    on('btn-profile-race', () => {
      this.audio.play('click');
      $('profile').classList.add('hidden');
      this.menu.classList.remove('hidden');
    });
    on('pill-city', () => {
      this.audio.unlock();
      this.exitDaily();
      goto('menu', 'tour');
    });
    on('pill-car', () => {
      this.audio.unlock();
      this.exitDaily();
      goto('menu', 'garage');
    });
    on('pill-laps', () => {
      this.audio.unlock();
      this.exitDaily();
      goto('menu', 'garage');
    });
    on('mode-left', () => {
      this.audio.play('click');
      $('mode-select').scrollBy({ left: -220, behavior: 'smooth' });
    });
    on('mode-right', () => {
      this.audio.play('click');
      $('mode-select').scrollBy({ left: 220, behavior: 'smooth' });
    });
    on('tour-back', () => goto('tour', 'menu', 'back'));
    on('btn-tour-done', () => goto('tour', 'garage'));
    on('garage-back', () => {
      // the daily / weekly skip the tour, so backing out returns to the menu
      if (this.dailyUi || this.weeklyUi) {
        this.exitDaily();
        this.exitWeekly();
        goto('garage', 'menu', 'back');
      } else {
        goto('garage', 'tour', 'back');
      }
    });
    on('btn-garage-done', () => {
      const c = CARS[this.carIndex];
      if (c.price > 0 && !owned().has(c.id)) return; // still locked
      $('garage').classList.add('hidden');
      this.onPage('menu'); // release the turntable camera before the grid cut
      this.onPlay();
    });

    // daily challenge: same circuit for everyone today — straight to the garage
    on('btn-daily', () => {
      this.audio.unlock();
      this.dailyUi = true;
      this.onDaily();
      this.selectLapChip(2, false);
      $('lap-select').classList.add('locked');
      goto('menu', 'garage');
    });

    // weekly cup: one shared circuit + mode all week, coin prizes — to the garage
    on('btn-weekly', () => {
      this.audio.unlock();
      this.weeklyUi = true;
      this.onWeekly();
      $('lap-select').classList.add('locked');
      goto('menu', 'garage');
    });

    on('btn-unlock', () => {
      const c = CARS[this.carIndex];
      if (unlock(c.id, c.price)) {
        this.audio.play('buy');
        this.renderCar();
        this.refreshBank();
      }
    });

    // workshop: coins buy stat tiers on the displayed (owned) car
    const upgrades: [string, UpgradeStat][] = [
      ['upg-speed', 'speed'], ['upg-grip', 'grip'], ['upg-nitro', 'nitro']
    ];
    for (const [id, stat] of upgrades) {
      on(id, () => {
        if (buyTier(CARS[this.carIndex].id, stat)) {
          this.audio.play('buy');
          this.renderCar();
          this.refreshBank();
          this.onCar(this.carIndex); // rebuild the player with the new spec
        }
      });
    }

    // garage carousel
    on('car-prev', () => this.stepCar(-1));
    on('car-next', () => this.stepCar(1));

    // world tour stop
    on('map-prev', () => this.stepMap(-1));
    on('map-next', () => this.stepMap(1));

    // leaderboard panel
    on('btn-board', () => {
      this.audio.play('open');
      this.renderBoard();
      this.menu.classList.add('hidden');
      $('board').classList.remove('hidden');
    });
    on('btn-board-close', () => {
      this.audio.play('back');
      $('board').classList.add('hidden');
      this.menu.classList.remove('hidden');
    });
    on('btn-modes-close', () => {
      this.audio.play('back');
      $('modes').classList.add('hidden');
      this.menu.classList.remove('hidden');
    });
    const tag = $<HTMLInputElement>('tag-input');
    tag.value = this.board.tag;
    tag.addEventListener('pointerdown', (e) => e.stopPropagation());
    tag.addEventListener('input', () => {
      tag.value = tag.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
      this.board.tag = tag.value;
    });

    // pedals: hold, don't click. stopPropagation (down AND move) keeps the
    // pedal finger from reaching the body listener that does drag steering
    // and tap nitro.
    const pedal = (id: string, cb: (down: boolean) => void) => {
      const el = $(id);
      const down = (e: Event) => {
        e.stopPropagation();
        el.classList.add('held');
        cb(true);
      };
      const up = () => {
        el.classList.remove('held');
        cb(false);
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointermove', (e) => e.stopPropagation());
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
    };
    pedal('btn-brake', (d) => this.onBrake(d));
    pedal('btn-gas', (d) => this.onGas(d));

    const cam = $('btn-cam');
    cam.addEventListener('pointerdown', (e) => e.stopPropagation());
    cam.addEventListener('click', () => this.onCamera());

    // mute lives in two places (menu chip + race HUD) but is one setting
    const MUTE_KEY = 'minirush.muted';
    let muted = localStorage.getItem(MUTE_KEY) === '1';
    const applyMute = () => {
      this.audio.setMuted(muted);
      $('btn-mute').textContent = muted ? '🔇' : '🔊';
      $('btn-mute-race').textContent = muted ? '🔇' : '🔊';
    };
    applyMute();
    for (const id of ['btn-mute', 'btn-mute-race']) {
      const el = $(id);
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('click', () => {
        muted = !muted;
        localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
        applyMute();
        this.audio.play('click'); // audible confirmation only when unmuting
      });
    }

    // master volume slider (menu) — reflects and drives audio.level
    const vol = $<HTMLInputElement>('vol-slider');
    vol.value = String(Math.round(this.audio.level * 100));
    vol.addEventListener('pointerdown', (e) => e.stopPropagation());
    vol.addEventListener('input', () => this.audio.setVolume(Number(vol.value) / 100));

    // the nitro pill doubles as a button (gun modes claim the tap for shooting)
    this.nitroUi.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.onNitroPress();
    });

    // lap count chips
    document.querySelectorAll<HTMLElement>('.lap-chip').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        (e.currentTarget as HTMLElement).blur();
        this.audio.play('select');
        this.selectLapChip(Number(chip.dataset.laps));
      });
    });

    // featured mode cards on the menu + full mode browser page
    const modeRow = $('mode-select');
    const makeModeButton = (i: number, className: string) => {
      const m = MODES[i];
      const b = document.createElement('button');
      b.className = className;
      b.innerHTML =
        `<span class="mi">${m.icon}</span>` +
        `<span class="mn">${m.name}</span>` +
        `<span class="mr">${MODE_RISK[m.id] ?? 'MODE'}</span>`;
      b.addEventListener('click', () => {
        b.blur();
        this.audio.play('select');
        this.setMode(i);
        this.onMode(i);
      });
      return b;
    };
    MODES.forEach((m, i) => {
      const card = document.createElement('button');
      card.className = 'mode-card';
      const laps = m.lapsLocked ? `${m.lapsLocked} LAP${m.lapsLocked === 1 ? '' : 'S'}` : 'OPEN LAPS';
      card.innerHTML =
        `<div class="mode-card-top">` +
          `<span class="mode-card-icon">${m.icon}</span>` +
          `<div><div class="mode-card-name">${m.name}</div>` +
          `<div class="mode-card-meta">${MODE_RISK[m.id] ?? 'MODE'}</div></div>` +
        `</div>` +
        `<div class="mode-card-copy">${m.tagline}</div>` +
        `<div class="mode-card-stats">` +
          `<span>${m.rivals + 1} CAR${m.rivals === 0 ? '' : 'S'}</span>` +
          `<span>${laps}</span>` +
          `<span>${m.guns ? 'GUNS' : 'NITRO'}</span>` +
        `</div>`;
      card.addEventListener('click', () => {
        card.blur();
        this.audio.play('select');
        this.setMode(i);
        this.onMode(i);
        $('modes').classList.add('hidden');
        this.menu.classList.remove('hidden');
      });
      $('mode-grid').appendChild(card);
      this.modeCards.push(card);
    });
    MODES.forEach((m, i) => {
      if (!m.featured) return;
      const b = makeModeButton(i, 'mode-chip');
      modeRow.appendChild(b);
      this.modeButtons[i] = b;
    });
    const more = document.createElement('button');
    more.className = 'mode-chip more';
    more.innerHTML = '<span class="mi">▦</span><span class="mn">ALL MODES</span><span class="mr">MORE</span>';
    more.addEventListener('click', () => {
      more.blur();
      this.audio.play('open');
      this.menu.classList.add('hidden');
      $('modes').classList.remove('hidden');
    });
    modeRow.appendChild(more);

    this.setRacers(4);
    this.refreshBest();
    this.refreshBank();
    this.refreshDaily();
    this.refreshWeekly();
  }

  /** Leaving the daily flow: unlock the lap picker and tell the game. */
  private exitDaily(): void {
    if (!this.dailyUi) return;
    this.dailyUi = false;
    $('lap-select').classList.remove('locked');
    this.selectLapChip(this.pickedLaps, false);
    this.onDailyExit();
  }

  /** Leaving the Weekly Cup flow: unlock the lap picker and tell the game. */
  private exitWeekly(): void {
    if (!this.weeklyUi) return;
    this.weeklyUi = false;
    $('lap-select').classList.remove('locked');
    this.selectLapChip(this.pickedLaps, false);
    this.onWeeklyExit();
  }

  private refreshBank(): void {
    const line = `⬤ ${bank()} coins`;
    $('bank-line').textContent = line;
    $('garage-bank').textContent = line;
  }

  /** The daily button always says which city today's circuit visits. */
  private refreshDaily(): void {
    const m = MAPS[dailyMapIndex(MAPS.length)];
    const best = this.board.dailyEntries(dayKey())[0];
    $('btn-daily').innerHTML =
      `⚡ DAILY RUN — ${m.flag} ${m.name}` +
      (best ? `<small>today's top: ${best.score} (${best.tag})</small>` : '');
    this.refreshStreak();
  }

  /** The Weekly Cup button shows this week's city + mode and top prize. */
  private refreshWeekly(): void {
    const m = MAPS[weeklyMapIndex(MAPS.length)];
    const mode = MODES[weeklyModeIndex(MODES.length)];
    const best = this.board.weeklyEntries(weekKey())[0];
    $('btn-weekly').innerHTML =
      `🏆 WEEKLY CUP — ${m.flag} ${m.name} · ${mode.icon} ${mode.name}` +
      (best
        ? `<small>this week's top: ${best.score} (${best.tag}) · win ⬤ ${WEEKLY_PRIZES[1]}</small>`
        : `<small>place top 3 to win up to ⬤ ${WEEKLY_PRIZES[1]} coins</small>`);
  }

  /** Flame + day count next to the daily; hidden until a streak exists. */
  private refreshStreak(): void {
    const streak = currentStreak();
    const line = $('streak-line');
    if (streak <= 0) {
      line.classList.add('hidden');
      return;
    }
    const week = weekProgress();
    const dots = week.map((done) => (done ? '●' : '○')).join('');
    line.textContent = `🔥 ${streak}-day streak ${dots}`;
    line.classList.remove('hidden');
  }

  /** Progress-bar dots for player + rivals; grid size varies per mode. */
  setRacers(n: number): void {
    this.progress.innerHTML = '';
    this.dots = [];
    for (let i = 0; i < n; i++) {
      const d = document.createElement('div');
      d.className = i === 0 ? 'dot player' : 'dot';
      this.progress.appendChild(d);
      this.dots.push(d);
    }
  }

  /** Reflect the mode: highlight the card, swap tagline, lock laps if fixed. */
  setMode(i: number): void {
    this.modeIndex = i;
    const m = MODES[i];
    this.modeButtons.forEach((c, ci) => {
      if (c) c.classList.toggle('sel', ci === i);
    });
    this.modeCards.forEach((c, ci) => {
      c.classList.toggle('sel', ci === i);
    });
    $('mode-tag').textContent = m.tagline;
    $('mode-name-line').textContent = `${m.icon} ${m.name} · ${MODE_RISK[m.id] ?? 'MODE'}`;
    $('lap-select').classList.toggle('locked', m.lapsLocked !== undefined);
    // dimmed chips still tell the truth about how many laps you'll race;
    // the user's own pick comes back when the lock lifts
    this.selectLapChip(m.lapsLocked ?? this.pickedLaps, false);
  }

  get best(): number {
    return Number(localStorage.getItem(BEST_KEY) ?? '0');
  }

  /** Reflect an externally-set lap count (e.g. ?laps= query param). */
  setLaps(n: number): void {
    this.pickedLaps = n;
    this.selectLapChip(n, false);
  }

  /** Reflect an externally-set car (saved pick / ?car= query param). */
  setCar(i: number): void {
    this.carIndex = i;
    this.renderCar();
  }

  /** Reflect an externally-set map (saved pick / ?map= query param). */
  setMap(i: number): void {
    this.mapIndex = i;
    this.renderMap();
  }

  private stepMap(dir: number): void {
    this.audio.play('select');
    this.mapIndex = (this.mapIndex + dir + MAPS.length) % MAPS.length;
    this.renderMap();
    this.onMap(this.mapIndex);
  }

  private renderMap(): void {
    const m = MAPS[this.mapIndex];
    const open = mapUnlocked(this.mapIndex);
    $('map-name-t').textContent = `${open ? m.flag : '🔒'} ${m.name}`;
    $('menu-city').textContent = `${m.flag} ${m.name}`;
    $('map-route').textContent = m.districts.map((d) => d.label).join(' → ');
    $('map-blurb').textContent = open
      ? m.blurb
      : `🛂 Finish a race in ${MAPS[this.mapIndex - 1].name} to stamp your passport.`;
    $('btn-tour-done').classList.toggle('locked', !open);
  }

  /** Circuit minimap on the tour page — the actual spline, one color per district. */
  drawTrackMap(pts: { x: number; z: number }[], districtColors: number[]): void {
    const canvases = [
      $<HTMLCanvasElement>('map-canvas'),
      $<HTMLCanvasElement>('menu-map-canvas')
    ];
    if (pts.length < 2) return;
    for (const canvas of canvases) this.drawOneTrackMap(canvas, pts, districtColors);
  }

  private drawOneTrackMap(
    canvas: HTMLCanvasElement, pts: { x: number; z: number }[], districtColors: number[]
  ): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const pad = 16;
    const sc = Math.min((W - 2 * pad) / (maxX - minX), (H - 2 * pad) / (maxZ - minZ));
    const ox = (W - (maxX - minX) * sc) / 2 - minX * sc;
    const oz = (H - (maxZ - minZ) * sc) / 2 - minZ * sc;
    const X = (i: number) => pts[i % pts.length].x * sc + ox;
    const Y = (i: number) => pts[i % pts.length].z * sc + oz;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // dark casing under the colored line
    ctx.strokeStyle = 'rgba(6,8,20,.9)';
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    for (let i = 1; i <= pts.length; i++) ctx.lineTo(X(i), Y(i));
    ctx.stroke();

    // one stroke per district third
    const n = pts.length;
    for (let d = 0; d < 3; d++) {
      const i0 = Math.floor((n * d) / 3), i1 = Math.floor((n * (d + 1)) / 3);
      ctx.strokeStyle = `#${(districtColors[d] ?? 0xffffff).toString(16).padStart(6, '0')}`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(X(i0), Y(i0));
      for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(X(i), Y(i));
      ctx.stroke();
    }

    // start/finish
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(X(0), Y(0), 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0b1020';
    ctx.beginPath();
    ctx.arc(X(0), Y(0), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  private stepCar(dir: number): void {
    this.audio.play('select');
    this.carIndex = (this.carIndex + dir + CARS.length) % CARS.length;
    this.renderCar();
    this.onCar(this.carIndex);
  }

  private renderCar(): void {
    const c = CARS[this.carIndex];
    const up = applyUpgrades(c); // the bars show what you'd actually race
    $('car-name-t').textContent = c.name;
    $('menu-car').textContent = c.name;
    $('car-blurb').textContent = c.blurb;
    const hex = `#${c.color.toString(16).padStart(6, '0')}`;
    const chip = $('car-chip');
    chip.style.background = hex;
    chip.style.color = hex; // drives the currentColor glow
    // multipliers hover around 1.0 — stretch them onto readable 0..100% bars
    const pct = (v: number) =>
      `${Math.round(clamp((v - 0.65) / 0.55, 0.12, 1) * 100)}%`;
    $('st-spd').style.width = pct(up.speed);
    $('st-acc').style.width = pct(up.accel);
    $('st-grp').style.width = pct(up.grip);
    $('st-nos').style.width = pct(up.nitro);

    // locked cars preview fine but can't race — coins open the padlock
    const isOwned = c.price === 0 || owned().has(c.id);
    $('car-lock').classList.toggle('hidden', isOwned);
    $('btn-garage-done').classList.toggle('locked', !isOwned);
    if (!isOwned) {
      $('car-price').textContent = `🔒 ⬤ ${c.price}`;
      $<HTMLButtonElement>('btn-unlock').disabled = bank() < c.price;
    }

    // workshop row — hidden until the car is yours
    $('upgrade-row').classList.toggle('hidden', !isOwned);
    if (isOwned) {
      const rows: [string, UpgradeStat][] = [
        ['upg-speed', 'speed'], ['upg-grip', 'grip'], ['upg-nitro', 'nitro']
      ];
      for (const [id, stat] of rows) {
        const t = tier(c.id, stat);
        const btn = $<HTMLButtonElement>(id);
        const pips = '●'.repeat(t) + '○'.repeat(MAX_TIER - t);
        const maxed = t >= MAX_TIER;
        btn.innerHTML =
          `<span>${UPGRADE_LABEL[stat]}</span>` +
          `<span class="pips">${pips}</span>` +
          `<span class="cost">${maxed ? 'MAX' : `⬤ ${TIER_COST[t]}`}</span>`;
        btn.classList.toggle('maxed', maxed);
        btn.disabled = maxed || bank() < TIER_COST[t];
      }
    }

    this.renderSkins(isOwned);
  }

  /** Paint-job dots under the car. Tap an owned skin to equip, a locked one to buy. */
  private renderSkins(carOwned: boolean): void {
    const row = $('skin-row');
    row.innerHTML = '';
    const car = CARS[this.carIndex];
    const skins = CAR_SKINS[car.id];
    // skins only make sense once the car itself is owned
    if (!carOwned || !skins || skins.length <= 1) return;

    const label = document.createElement('span');
    label.className = 'skin-label';
    label.textContent = 'SKIN';
    row.appendChild(label);

    const active = activeSkinIndex(car.id);
    skins.forEach((skin, i) => {
      const dot = document.createElement('button');
      const owned = skinOwned(car.id, i);
      dot.className = 'skin-dot' + (i === active ? ' sel' : '') + (owned ? '' : ' locked');
      const hex = `#${skin.color.toString(16).padStart(6, '0')}`;
      dot.style.background = hex;
      dot.style.color = hex; // drives the currentColor glow
      dot.title = owned ? skin.name : `${skin.name} · ⬤ ${skin.price}`;
      dot.addEventListener('click', () => {
        dot.blur();
        if (owned) {
          equipSkin(car.id, i);
          this.audio.play('select');
        } else if (buySkin(car.id, i)) {
          this.audio.play('buy');
          this.refreshBank();
        } else {
          return; // can't afford
        }
        this.renderCar();
        this.onCar(this.carIndex); // rebuild the preview with the new paint
      });
      row.appendChild(dot);
    });
  }

  private renderBoard(): void {
    const list = $('board-list');
    list.innerHTML = '';
    const section = (title: string, entries: ReturnType<Leaderboard['entries']>) => {
      const head = document.createElement('div');
      head.className = 'board-head';
      head.textContent = title;
      list.appendChild(head);
      entries.forEach((e, i) => {
        const row = document.createElement('div');
        row.className = i === 0 ? 'board-row top' : 'board-row';
        const cell = (cls: string, text: string) => {
          const s = document.createElement('span');
          s.className = cls;
          s.textContent = text;
          row.appendChild(s);
        };
        cell('rk', String(i + 1));
        cell('tg', e.tag);
        cell('meta', `${e.place}${suffix(e.place)} · ${e.time.toFixed(1)}s · ${e.laps} lap${e.laps > 1 ? 's' : ''} · ${e.car}`);
        cell('sc', String(e.score));
        list.appendChild(row);
      });
    };
    const daily = this.board.dailyEntries(dayKey());
    const allTime = this.board.entries();

    // global daily first — it's the board that matters
    if (remoteEnabled()) {
      const head = document.createElement('div');
      head.className = 'board-head';
      head.textContent = '🌍 GLOBAL DAILY';
      list.appendChild(head);
      const slot = document.createElement('div');
      slot.className = 'board-empty';
      slot.textContent = 'Loading…';
      list.appendChild(slot);
      const me = playerId(this.wallet.address);
      void topDaily(dayKey()).then((rows) => {
        if (!slot.isConnected) return; // panel was rebuilt meanwhile
        if (rows.length === 0) {
          slot.textContent = 'No global runs yet — set the first one!';
          return;
        }
        const built = rows.map((e, i) => {
          const row = document.createElement('div');
          row.className = i === 0 ? 'board-row top' : 'board-row';
          if (e.player_id === me) row.style.outline = '1px solid rgba(252,255,82,.6)';
          const cell = (cls: string, text: string) => {
            const s = document.createElement('span');
            s.className = cls;
            s.textContent = text;
            row.appendChild(s);
          };
          cell('rk', String(i + 1));
          cell('tg', e.tag);
          cell('meta', `${e.place}${suffix(e.place)} · ${e.time_s.toFixed(1)}s · ${e.laps} lap${e.laps > 1 ? 's' : ''} · ${e.car}`);
          cell('sc', String(e.score));
          return row;
        });
        slot.remove();
        head.after(...built);
      });
    }

    if (daily.length > 0) section("⚡ TODAY'S DAILY (THIS PHONE)", daily.slice(0, 5));
    if (allTime.length > 0) section('ALL TIME', allTime);
    if (daily.length === 0 && allTime.length === 0 && !remoteEnabled()) {
      const empty = document.createElement('div');
      empty.className = 'board-empty';
      empty.textContent = 'No runs yet — go set a score!';
      list.appendChild(empty);
    }
  }

  private selectLapChip(n: number, notify = true): void {
    document.querySelectorAll<HTMLElement>('.lap-chip').forEach((c) => {
      c.classList.toggle('sel', Number(c.dataset.laps) === n);
    });
    $('menu-laps').textContent = `${n} LAP${n === 1 ? '' : 'S'}`;
    if (notify) {
      this.pickedLaps = n;
      this.onLaps(n);
    }
  }

  /**
   * MiniPay hands over the account without a dialog, so the chip quietly
   * fills in with the address and cUSD balance. Any other injected wallet
   * gets an explicit CONNECT chip instead — connecting is never required
   * to play. In a plain browser with no wallet nothing shows at all.
   */
  private async autoConnect(): Promise<void> {
    if (this.wallet.isMiniPay) {
      try {
        await this.wallet.connect();
        await this.refreshChip();
        // Register the player on-chain (idempotent, fire-and-forget).
        void this.wallet.signUp();
      } catch { /* stay hidden */ }
    } else if (this.wallet.available) {
      const chip = $('wallet-chip');
      chip.classList.add('connectable');
      chip.textContent = '🔗 CONNECT & COMPETE';
    }
  }

  private async refreshChip(): Promise<void> {
    const chip = $('wallet-chip');
    chip.classList.remove('connectable');
    chip.textContent = this.wallet.shortAddress();
    try {
      chip.textContent = `${this.wallet.shortAddress()} · ${await this.wallet.celoBalance()} CELO`;
    } catch { /* balance is best-effort */ }
  }

  /** Chip tap: connect first if needed, then open the driver card. */
  private async onWalletChip(): Promise<void> {
    if (!this.wallet.address) {
      if (!this.wallet.available) return;
      try {
        await this.wallet.connect();
      } catch {
        return; // dialog dismissed — stay on the menu, chip keeps offering
      }
      void this.wallet.signUp();
      void this.refreshChip();
    }
    this.audio.play('open');
    this.renderProfile();
    this.menu.classList.add('hidden');
    $('profile').classList.remove('hidden');
  }

  /** The driver card: identity + local progress; on-chain stats fill in async. */
  private renderProfile(): void {
    $('profile-tag').textContent = this.board.tag;
    $('profile-addr').textContent = this.wallet.shortAddress();
    $('profile-balance').textContent = '';
    void this.wallet.celoBalance()
      .then((b) => { $('profile-balance').textContent = `${b} CELO`; })
      .catch(() => { /* balance is best-effort */ });

    $('p-best').textContent = String(this.best);
    $('p-coins').textContent = String(bank());
    const cars = CARS.filter((c) => c.price === 0 || owned().has(c.id)).length;
    $('p-cars').textContent = `${cars}/${CARS.length}`;
    const got = stamps();
    $('p-stamps').textContent = `${got.size}/${MAPS.length}`;

    const strip = $('profile-stamps');
    strip.innerHTML = '';
    for (const m of MAPS) {
      const s = document.createElement('span');
      s.className = got.has(m.id) ? 'pstamp got' : 'pstamp';
      s.textContent = m.flag;
      s.title = m.name;
      strip.appendChild(s);
    }

    // career stats (local, lifetime)
    const ls = getStats();
    $('p-lraces').textContent = String(ls.totalRaces);
    $('p-winrate').textContent = winRate();
    const favMode = MODES.find((m) => m.id === favoriteMode());
    $('p-favmode').textContent = ls.totalRaces > 0 && favMode ? favMode.icon : '—';
    $('p-zombies').textContent = String(ls.zombiesTotal);
    $('p-drift').textContent = ls.driftBest > 0 ? `${ls.driftBest.toFixed(1)}s` : '—';
    $('p-boss').textContent = String(ls.bossKills);

    // badges — all shown dim, earned ones lit once V2 reports the bitfield
    const badgeRow = $('profile-badges');
    badgeRow.innerHTML = '';
    const badgeEls = BADGES.map((b) => {
      const el = document.createElement('span');
      el.className = 'badge locked';
      el.textContent = b.icon;
      el.title = b.label;
      badgeRow.appendChild(el);
      return el;
    });
    void this.wallet.badges().then((bits) => {
      if (bits === null) return; // V2 off or unavailable — leave all dim
      BADGES.forEach((b, i) => {
        if (bits & (1 << b.bit)) badgeEls[i].classList.remove('locked');
      });
    });

    const note = $('profile-chain-note');
    $('p-races').textContent = '…';
    $('p-chain-best').textContent = '…';
    note.textContent = '';
    void this.wallet.stats().then((s) => {
      if (!s) {
        $('p-races').textContent = '—';
        $('p-chain-best').textContent = '—';
        note.textContent = 'On-chain stats unavailable right now.';
        return;
      }
      $('p-races').textContent = String(s.races);
      $('p-chain-best').textContent = String(s.bestScore);
      note.textContent = s.registered
        ? 'Synced to MiniRushTracker on Celo mainnet — your record follows this wallet everywhere.'
        : 'Finish a race to write your first stats to Celo.';
    });
  }

  showRace(): void {
    this.menu.classList.add('hidden');
    this.results.classList.add('hidden');
    this.hud.classList.add('visible');
    this.showKeyHints();
  }

  /** Keyboard players get the controls flashed for the first 5s of each race. */
  private showKeyHints(): void {
    if (!hasKeyboard()) return;
    const el = $('key-hints');
    el.classList.remove('hidden');
    window.clearTimeout(this.keyHintTimer);
    this.keyHintTimer = window.setTimeout(() => el.classList.add('hidden'), 5000);
  }

  /** First race ever: three timed control tips. Marked seen once all ran. */
  startTutorial(): void {
    if (hasKeyboard()) return; // desktop gets the key cheatsheet instead
    if (localStorage.getItem('minirush.tutorial')) return;
    const el = $('tutorial');
    const tips = [
      '◀ DRAG THE ROAD TO STEER ▶',
      'HOLD THE YELLOW PEDAL TO GAS ⚡',
      'TAP THE NITRO PILL TO BOOST 💨'
    ];
    tips.forEach((tip, i) => {
      this.tutTimers.push(window.setTimeout(() => {
        el.textContent = tip;
        el.classList.remove('hidden');
      }, i * 3400));
    });
    this.tutTimers.push(window.setTimeout(() => {
      el.classList.add('hidden');
      localStorage.setItem('minirush.tutorial', '1');
    }, tips.length * 3400));
  }

  /** Race over before the tips finished — hide them, keep unseen for next run. */
  endTutorial(): void {
    for (const t of this.tutTimers) clearTimeout(t);
    this.tutTimers = [];
    $('tutorial').classList.add('hidden');
  }

  countdown(text: string): void {
    this.countdownEl.textContent = text;
    this.countdownEl.classList.add('show');
  }

  hideCountdown(): void {
    this.countdownEl.classList.remove('show');
  }

  updateHud(
    place: number, racers: number, time: number, coins: number, zombies: number,
    nitroTanks: number, nitroActive: boolean, speed: number,
    lap: number, laps: number,
    progress: number[], // 0..1 overall race progress for [player, ...rivals]
    styleMult = 1, styleGauge = 0
  ): void {
    const styleUi = $('style-ui');
    styleUi.classList.toggle('on', styleMult > 1 || styleGauge > 0.02);
    styleUi.classList.toggle('hot', styleMult >= 4);
    $('style-mult').textContent = `×${styleMult}`;
    $('style-fill').style.width = `${Math.min(1, styleGauge) * 100}%`;
    this.hudPos.innerHTML = `P${place}<small>/${racers}</small>`;
    this.hudLap.textContent = `LAP ${lap}/${laps}`;
    this.hudTime.textContent = time.toFixed(2);
    this.hudSpeed.textContent = String(Math.round(speed * 3.6));
    this.hudCoins.textContent = `⬤ ${coins}`;
    this.hudZombies.textContent = `☠ ${zombies}`;

    this.nitroUi.classList.toggle('none', nitroTanks === 0 && !nitroActive);
    this.nitroUi.classList.toggle('burning', nitroActive);
    this.speedlines.classList.toggle('on', nitroActive);
    this.nitroUi.textContent = nitroActive ? 'NITRO!!' : `NITRO ×${nitroTanks} — TAP`;

    progress.forEach((p, i) => {
      this.dots[i].style.left = `${Math.min(100, p * 100)}%`;
    });
  }

  /** Live drift-chain readout on the HUD. Pass null (or ≤0) to hide it. */
  showDrift(seconds: number | null): void {
    if (!seconds || seconds < 0.35) {
      this.driftUi.classList.remove('on');
      return;
    }
    this.driftTime.textContent = `${seconds.toFixed(1)}s`;
    this.driftUi.classList.add('on');
  }

  popText(text: string, color = '#fcff52'): void {
    this.combo.textContent = text;
    this.combo.style.color = color;
    this.combo.classList.remove('pop');
    void this.combo.offsetWidth;
    this.combo.classList.add('pop');
  }

  showResults(
    place: number, time: number, zombies: number, coins: number, score: number,
    laps: number, car: string, busted = false, style = 0, daily = false, weekly = false
  ): void {
    window.clearTimeout(this.keyHintTimer);
    $('key-hints').classList.add('hidden');
    const best = Math.max(this.best, score);
    localStorage.setItem(BEST_KEY, String(best));
    // daily / weekly runs rank on their own shared-circuit boards, not all-time
    let rank: number;
    if (weekly) {
      rank = this.board.submitWeekly(weekKey(), { score, place, time, laps, car });
    } else if (daily) {
      rank = this.board.submitDaily(dayKey(), { score, place, time, laps, car });
    } else {
      rank = this.board.submit({ score, place, time, laps, car });
    }
    $('r-rank').textContent = rank > 0
      ? weekly ? `#${rank} IN THE WEEKLY CUP`
        : daily ? `#${rank} ON TODAY'S DAILY`
        : `#${rank} ON THE LEADERBOARD`
      : '';
    // …and race the world when the global board is configured
    if (daily && !busted) {
      void submitDaily(
        dayKey(), { tag: this.board.tag, score, time, place, laps, car },
        this.wallet.address
      ).then((globalRank) => {
        if (globalRank > 0) $('r-rank').textContent = `🌍 #${globalRank} WORLDWIDE TODAY`;
      });
    }
    $('r-style').textContent = String(Math.round(style));
    const placeEl = $('result-place');
    if (busted) {
      placeEl.textContent = 'BUSTED';
      placeEl.style.fontSize = '46px';
      placeEl.style.color = '#ff5252';
    } else {
      placeEl.innerHTML = `${place}<em>${suffix(place)}</em>`;
      placeEl.style.fontSize = '';
      placeEl.style.color = place === 1 ? '#fcff52' : '#fff';
    }
    $('r-time').textContent = time.toFixed(1);
    $('r-zombies').textContent = String(zombies);
    $('r-coins').textContent = String(coins);
    $('r-score').textContent = String(score);
    const map = MAPS[this.mapIndex];
    const mode = MODES[this.modeIndex];
    this.lastRun = {
      place, time, zombies, coins, score, style: Math.round(style), laps, car,
      map: `${map.flag} ${map.name}`, mode: mode.name, daily, busted
    };
    this.hud.classList.remove('visible');
    this.speedlines.classList.remove('on');
    this.results.classList.remove('hidden');
    this.refreshBest();
    this.refreshBank();
    this.refreshDaily();
    this.refreshWeekly();
  }

  private refreshBest(): void {
    $('best-line').textContent = `Best score: ${this.best}`;
  }
}
