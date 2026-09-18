import { AudioManager } from './audio';
import {
  BOUNTY_CLOSES, BOUNTY_MODE, bountyActive, bountyMapIndex, bountyPrize, bountyQualifies,
  bountyReceiver, bountySplit, loadBounty
} from './bounty';
import { CarClass, CARS } from './cars';
import { dailyMapIndex, dayKey } from './daily';
import { driverName, hasUsername, keepDriverName, setUsername, USERNAME_MAX } from './driver';
import { weekKey, weeklyMapIndex, weeklyModeIndex, WEEKLY_PRIZES } from './weekly';
import { bank, grantCar, owned, racePayout } from './economy';
import { Leaderboard } from './leaderboard';
import { MAPS } from './maps';
import { carFits, CUP_MODES, MODES, ModeSpec } from './modes';
import { mapUnlocked, stamps } from './passport';
import {
  playerId, remoteEnabled, submitBounty, submitDaily, topBounty, topDaily
} from './remoteBoard';
import { shareUrl } from './referral';
import { RunCard, shareRun } from './share';
import { activeSkinIndex, buySkin, CAR_SKINS, equipSkin, skinOwned } from './skins';
import { favoriteMode, getStats, winRate } from './stats';
import { currentStreak, weekProgress } from './streak';
import {
  applyUpgrades, buyTier, MAX_TIER, TIER_COST, tier, UPGRADE_LABEL, UpgradeStat
} from './upgrades';
import { track } from './usage';
import { BADGES, earnedBadges, mintedReceipts, Wallet } from './wallet';
import { Build, workshopSpec } from './workshop';
import { WorkshopUI } from './workshopUI';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

// The race HUD runs every frame. Leave unchanged DOM nodes alone so a steady
// speed/position does not rebuild text and trigger layout on a phone.
const hudText = (el: HTMLElement, text: string): void => {
  if (el.textContent !== text) el.textContent = text;
};
const hudClass = (el: HTMLElement, name: string, on: boolean): void => {
  if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
};
const hudWidth = (el: HTMLElement, percent: number): void => {
  const rounded = Number(percent.toFixed(1));
  if (parseFloat(el.style.width) !== rounded) el.style.width = `${rounded}%`;
};

const BEST_KEY = 'minirush.best';
const PLACE_SUFFIX = ['st', 'nd', 'rd', 'th'];
const suffix = (place: number) => PLACE_SUFFIX[Math.min(place, 4) - 1];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Race clock, m:ss.cc. */
const raceClock = (t: number): string =>
  `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
/** A text-only element: driver names come from other players, so never innerHTML. */
const textEl = (tag: string, className: string, text: string): HTMLElement => {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
};

/** One car in the finishing order on the results screen. */
export interface Standing {
  name: string;
  car: string;        // '' when the rival drives a street shell
  time: number;       // finish time (s) — estimated for cars still on track
  estimated: boolean;
  you: boolean;
}
const activateOnEnter = (el: HTMLElement, fn: () => void): void => {
  el.addEventListener('click', fn);
  if (el.tagName === 'BUTTON') return;
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    fn();
  });
};
// mouse + hover ⇒ a physical keyboard is almost certainly attached
const hasKeyboard = () => matchMedia('(any-hover: hover) and (any-pointer: fine)').matches;
const MODE_RISK: Record<string, string> = {
  gp: 'RACE',
  burnout: 'WILD',
  copchase: 'HEAT',
  gunrun: 'ARMED',
  timeattack: 'GHOST',
  eliminator: 'KNOCKOUT',
  trafficjam: 'DENSE',
  heist: 'HEIST',
  voltage: 'SURGE',
  hypercup: 'HYPER',
  hardcore: 'PRO'
};
// Each mode owns a colour on the select deck: card edge, glow, CTA and the
// overlay grade all take it, so flicking between modes reads as a scene change.
const MODE_ACCENT: Record<string, string> = {
  gp: '#fcff52',
  burnout: '#ff6a1f',
  copchase: '#3d8bff',
  gunrun: '#ff3b4a',
  timeattack: '#7fd4ff',
  eliminator: '#c14dff',
  trafficjam: '#ffb020',
  heist: '#00e0a4',
  hypercup: '#4dd8ff',
  voltage: '#b6ff2e',
  hardcore: '#ff4d6d'
};
const hexAlpha = (hex: string, a: number): string => {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
};
/** 0..1 "how hot is this mode" for the deck's intensity meter. */
const intensity = (m: ModeSpec): number => Math.min(1,
  0.18 + m.aggression * 0.42 + (m.rivals / 7) * 0.2 +
  (m.tumble ? 0.12 : 0) + (m.guns ? 0.08 : 0) + (m.pursuit ? 0.1 : 0));
/** Every locked car is a NIM buy; prices read the same everywhere, e.g. "2,600 NIM". */
const nimPrice = (nim: number): string => `${nim.toLocaleString('en-US')}\u00a0NIM`;

// Garage shelves, in the order the tabs read left to right.
const CAR_TABS: CarClass[] = ['hyper', 'fast', 'junk'];
const TAB_LABEL: Record<CarClass, string> = {
  hyper: 'HYPERCARS', fast: 'FAST', junk: 'THE JUNKYARD'
};
const KIND_LABEL: Record<CarClass, string> = {
  hyper: 'HYPER', fast: 'STREET', junk: 'SCRAP'
};
// Cheapest first inside a shelf, so a tab reads as its own little ladder.
const tabOrder = (): number[] => CARS
  .map((car, index) => index)
  .sort((a, b) => CAR_TABS.indexOf(CARS[a].class) - CAR_TABS.indexOf(CARS[b].class)
    || CARS[a].nim - CARS[b].nim);

// Owned cars a class-restricted mode will let on the grid — its shelf, less
// workshop builds where the mode bars them. Cheapest first.
const eligibleCars = (m: ModeSpec): number[] => {
  const have = owned();
  return tabOrder().filter((i) => carFits(m, CARS[i])
    && (CARS[i].nim === 0 || have.has(CARS[i].id)));
};

/** A class mode with an empty shelf behind it: visible, but not enterable. */
const modeLocked = (m: ModeSpec): boolean =>
  !!m.requiresClass && eligibleCars(m).length === 0;

export class UI {
  onPlay: () => void = () => {};
  onRetrySame: () => void = () => {};
  onBrake: (down: boolean) => void = () => {};
  onGas: (down: boolean) => void = () => {};
  onCamera: () => void = () => {};
  onPause: () => void = () => {};
  onResume: () => void = () => {};
  onRestart: () => void = () => {};
  onLaps: (n: number) => void = () => {};
  onCar: (index: number) => void = () => {};
  onMap: (index: number) => void = () => {};
  onMode: (index: number) => void = () => {};
  onPage: (page: 'menu' | 'garage' | 'tour' | 'workshop') => void = () => {};
  onWorkshopPreview: (build: Build | null) => void = () => {};
  onNitroPress: () => void = () => {}; // the pill itself — needed when tap = shoot
  onDaily: () => void = () => {};      // daily challenge picked from the menu
  onDailyExit: () => void = () => {};  // backed out of / done with the daily
  onWeekly: () => void = () => {};     // Weekly Cup picked from the menu
  onWeeklyExit: () => void = () => {}; // backed out of / done with the Weekly Cup
  onBounty: () => void = () => {};     // bounty race picked from the bounty board
  onBountyExit: () => void = () => {}; // backed out of / done with the bounty race

  private menu = $('menu');
  private results = $('results');
  private hud = $('hud');
  private hudPos = $('hud-pos');
  private hudTime = $('hud-time');
  private hudCoins = $('hud-coins');
  private nitroUi = $('nitro-ui');
  private nitroPips = -1;
  private speedlines = $('speedlines');
  private hudSpeed = $('hud-speed-v');
  private hudLap = $('hud-lap');
  private styleUi = $('style-ui');
  private styleMult = $('style-mult');
  private styleFill = $('style-fill');
  private speedFill = $('speed-fill');
  private speedUi = $('hud-speed');
  private nitroLabel = $('nitro-label');
  private hudPlaceKey = '';
  private combo = $('combo');
  private countdownEl = $('countdown');
  private progress = $('progress');
  private driftUi = $('drift-ui');
  private driftTime = $('drift-time');
  private modeButtons: HTMLElement[] = [];
  private modeCards: HTMLElement[] = [];
  private deckIndex = 0;       // mode the select deck is focused on
  private deckDragged = false; // the click that ends a swipe isn't a tap
  private carButtons: HTMLButtonElement[] = [];
  private tallyTimers: number[] = [];
  private carTab: CarClass = 'fast';
  private dots: HTMLElement[] = [];
  private board = new Leaderboard();
  private carIndex = 0;
  private mapIndex = 0;
  private pickedLaps = 2; // the user's own choice, restored when a lock lifts
  private dailyUi = false; // garage reached via DAILY RUN, not the tour flow
  private weeklyUi = false; // garage reached via WEEKLY CUP, not the tour flow
  private bountyUi = false; // garage reached via the bounty board
  private tutTimers: number[] = [];
  private keyHintTimer = 0;
  private modeIndex = 0;
  private lastRun: RunCard | null = null;
  private lastBounty = false;                // the results on screen are a bounty race
  private bountyReturn: HTMLElement | null = null; // page the bounty board was opened from
  private afterUsername: () => void = () => {};    // where the username prompt returns to
  private guideMode: 'paused' | 'first-run' | 'menu' = 'paused';
  private marketPending = false;

  constructor(private wallet: Wallet, private audio: AudioManager) {
    // blur so Space/Enter (nitro key) can't re-trigger the focused button
    const on = (id: string, fn: () => void) =>
      $(id).addEventListener('click', (e) => {
        (e.currentTarget as HTMLElement).blur();
        fn();
      });
    on('btn-retry', () => this.onPlay());
    on('btn-retry-same', () => this.onRetrySame());
    on('btn-pause', () => this.onPause());
    on('btn-how', () => {
      this.menu.classList.add('hidden');
      this.showGuide('menu');
    });
    on('btn-resume', () => {
      const mode = this.guideMode;
      this.audio.play(mode === 'paused' ? 'click' : 'start');
      this.hidePause();
      if (mode === 'paused') this.onResume();
      else if (mode === 'first-run') {
        localStorage.setItem('minirush.controls-guide', '1');
        localStorage.setItem('minirush.tutorial', '1');
        this.onPlay();
      } else {
        this.menu.classList.remove('hidden');
      }
    });
    on('btn-pause-restart', () => {
      this.audio.play('start');
      this.hidePause();
      this.onRestart();
    });
    on('btn-share', () => {
      if (this.lastRun) void shareRun(this.lastRun, shareUrl(this.wallet.address));
    });
    on('btn-mint', () => void this.mintReceipt());
    on('btn-bounty', () => this.openBounty(this.menu));
    on('btn-bounty-results', () => this.openBounty($('results')));
    on('btn-bounty-race', () => this.raceBounty());
    on('btn-bounty-close', () => {
      this.audio.play('back');
      $('bounty').classList.add('hidden');
      this.bountyReturn?.classList.remove('hidden');
    });
    on('btn-menu', () => {
      this.audio.play('back');
      this.results.classList.add('hidden');
      this.menu.classList.remove('hidden');
      this.exitDaily();
      this.exitWeekly();
      this.exitBounty();
      this.refreshDaily();
      this.refreshWeekly();
      this.refreshBounty();
      this.refreshBank();
    });
    this.prepareWalletChip(); // Account permission is requested only after an explicit tap.

    // wallet chip → driver card (connecting first if needed)
    on('wallet-chip', () => void this.onWalletChip());
    // the customs workshop lives in the garage, beside the cars it builds
    const workshop = new WorkshopUI(
      build => this.onWorkshopPreview(build),
      () => { $('garage').classList.remove('hidden'); this.onPage('garage'); this.refreshBank(); this.renderCar(); },
      () => { const index = CARS.findIndex(c => c.model === 300); this.setCar(index); this.onCar(index); }
    );
    on('btn-workshop-garage', () => { $('garage').classList.add('hidden'); this.onPage('workshop'); workshop.open(); });
    on('btn-profile-close', () => {
      this.audio.play('back');
      $('profile').classList.add('hidden');
      this.menu.classList.remove('hidden');
    });

    // username: picked after a Nimiq sign-in, editable from the driver card and board
    const nameInput = $<HTMLInputElement>('username-input');
    nameInput.maxLength = USERNAME_MAX;
    nameInput.addEventListener('pointerdown', (e) => e.stopPropagation());
    nameInput.addEventListener('input', () => { $('username-error').textContent = ''; });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      this.saveUsername();
    });
    on('btn-username-save', () => this.saveUsername());
    on('btn-username-skip', () => {
      this.audio.play('back');
      if (!hasUsername()) keepDriverName();
      this.closeUsername();
    });
    on('btn-profile-name', () => this.askUsername($('profile'), () => this.openProfile()));
    on('btn-board-name', () => void this.boardNameAction());

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

    /**
     * Pick a mode, honouring class locks. A mode whose shelf you can't field
     * yet drops you on that shelf in the garage instead of onto a grid you
     * aren't allowed on; one you can field quietly moves you onto a legal car
     * rather than refusing the tap.
     */
    const chooseMode = (i: number, from: 'menu' | 'modes'): void => {
      const m = MODES[i];
      const shelf = m.requiresClass ? eligibleCars(m) : [];
      if (from === 'modes') {
        $('modes').classList.add('hidden');
        this.menu.classList.remove('hidden');
      }
      if (m.requiresClass && shelf.length === 0) {
        this.audio.play('empty');
        this.selectCar(CARS.findIndex((c) => carFits(m, c)));
        // set after selectCar: renderCar rewrites this line
        $('market-status').textContent =
          `${m.name} is ${KIND_LABEL[m.requiresClass]}-only — unlock one to enter.`;
        goto('menu', 'garage');
        return;
      }
      this.audio.play('select');
      if (m.requiresClass && !carFits(m, CARS[this.carIndex])) {
        this.selectCar(shelf[0]);
      }
      this.setMode(i);
      this.onMode(i);
    };
    on('btn-play', () => {
      this.audio.unlock();
      this.exitDaily();
      goto('menu', 'tour');
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
    on('btn-garage-menu', () => {
      this.audio.unlock();
      this.exitDaily();
      goto('menu', 'garage');
    });
    on('btn-market-home', () => {
      this.exitDaily(); this.exitWeekly(); this.exitBounty();
      this.selectCar(CARS.findIndex(c => c.class === 'hyper'));
      goto('menu', 'garage');
    });
    on('pill-laps', () => {
      this.audio.unlock();
      this.exitDaily();
      openModes(); // the lap chips live on the mode screen now
    });
    on('tour-back', () => goto('tour', 'menu', 'back'));
    on('btn-tour-done', () => goto('tour', 'garage'));
    on('garage-back', () => {
      // the daily / weekly / bounty skip the tour, so backing out returns to the menu
      if (this.dailyUi || this.weeklyUi || this.bountyUi) {
        this.exitDaily();
        this.exitWeekly();
        this.exitBounty();
        goto('garage', 'menu', 'back');
      } else {
        goto('garage', 'tour', 'back');
      }
    });
    on('btn-garage-done', () => {
      const c = CARS[this.carIndex];
      if (c.nim > 0 && !owned().has(c.id)) return; // still locked
      if (!carFits(MODES[this.modeIndex], c)) return; // wrong shelf for a class mode
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

    on('btn-market-nim', () => void this.buyMarketCar());

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
    for (const cls of CAR_TABS) {
      on(`tab-${cls}`, () => {
        if (this.carTab === cls) return;
        // land on the cheapest car of the shelf you just opened
        const first = tabOrder().find((i) => CARS[i].class === cls);
        if (first !== undefined) this.selectCar(first);
      });
    }
    this.buildCarRoster();

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
    activateOnEnter(cam, () => this.onCamera());

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
      activateOnEnter(el, () => {
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
      b.type = 'button';
      b.setAttribute('aria-label', `Select ${m.name} mode`);
      b.innerHTML =
        `<span class="mi">${m.icon}</span>` +
        `<span class="mn">${m.name}</span>` +
        `<span class="mr">${MODE_RISK[m.id] ?? 'MODE'}</span>`;
      b.addEventListener('click', () => {
        b.blur();
        chooseMode(i, 'menu');
      });
      return b;
    };
    // Mode select deck: one full card per mode on a 3D carousel. Swipe, the
    // arrows or the keyboard move focus; tapping the focused card or the CTA
    // races it. Slides keep the mode-card class so setMode / refreshModeLocks
    // drive them exactly as they drove the old grid.
    const deck = $('mode-deck');
    const dots = $('mode-dots');
    MODES.forEach((m, i) => {
      const card = document.createElement('button');
      card.className = 'mode-card mode-slide';
      card.type = 'button';
      card.dataset.mode = m.id;
      card.setAttribute('aria-label', `${m.name}: ${m.tagline}`);
      card.style.setProperty('--accent', MODE_ACCENT[m.id] ?? '#fcff52');
      const laps = m.lapsLocked ? `${m.lapsLocked} LAP${m.lapsLocked === 1 ? '' : 'S'}` : 'OPEN LAPS';
      const pills = [`${m.rivals + 1} CAR${m.rivals === 0 ? '' : 'S'}`, laps, m.guns ? 'GUNS' : 'NITRO']
        .map((t, k) => `<span style="--i:${k}">${t}</span>`).join('') +
        (m.requiresClass ? '<span class="mode-card-req" style="--i:3"></span>' : '');
      card.innerHTML =
        `<span class="slide-glow"></span>` +
        `<span class="slide-num">${String(i + 1).padStart(2, '0')}</span>` +
        `<span class="slide-icon">${m.icon}</span>` +
        `<span class="slide-risk">${MODE_RISK[m.id] ?? 'MODE'}</span>` +
        `<span class="slide-name">${m.name}</span>` +
        `<span class="slide-copy">${m.tagline}</span>` +
        `<span class="mode-card-stats">${pills}</span>` +
        `<span class="slide-meter"><span>INTENSITY</span>` +
          `<b><i style="--w:${Math.round(intensity(m) * 100)}%"></i></b></span>`;
      card.addEventListener('click', () => {
        card.blur();
        if (this.deckDragged) return;
        if (i === this.deckIndex) {
          chooseMode(i, 'modes');
        } else {
          this.deckIndex = i;
          this.audio.play('select');
          this.layoutDeck();
        }
      });
      deck.appendChild(card);
      this.modeCards.push(card);
      dots.appendChild(document.createElement('i'));
    });

    // swipe: cards track the finger, then settle one step either way
    let downX = 0;
    let dragging = false;
    deck.addEventListener('pointerdown', (e) => {
      downX = e.clientX;
      dragging = true;
      this.deckDragged = false;
      deck.classList.add('dragging');
    });
    deck.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - downX;
      if (Math.abs(dx) > 8) this.deckDragged = true;
      const step = (this.modeCards[0]?.offsetWidth ?? 300) * 0.78;
      this.layoutDeck(dx / step);
    });
    const release = (e: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      deck.classList.remove('dragging');
      const dx = e.clientX - downX;
      if (Math.abs(dx) > 40) this.stepDeck(dx < 0 ? 1 : -1);
      else this.layoutDeck();
    };
    deck.addEventListener('pointerup', release);
    deck.addEventListener('pointercancel', release);
    deck.addEventListener('pointerleave', release);
    on('mode-prev', () => this.stepDeck(-1));
    on('mode-next', () => this.stepDeck(1));
    on('mode-go', () => chooseMode(this.deckIndex, 'modes'));
    window.addEventListener('keydown', (e) => {
      if ($('modes').classList.contains('hidden')) return;
      if (e.key === 'ArrowRight') this.stepDeck(1);
      else if (e.key === 'ArrowLeft') this.stepDeck(-1);
      else if (e.key === 'Enter') chooseMode(this.deckIndex, 'modes');
      else if (e.key === 'Escape') $('btn-modes-close').click();
      else return;
      e.preventDefault();
    });
    MODES.forEach((m, i) => {
      if (!m.featured) return;
      const b = makeModeButton(i, 'mode-chip');
      modeRow.appendChild(b);
      this.modeButtons[i] = b;
    });
    const openModes = (): void => {
      this.audio.play('open');
      this.deckIndex = this.modeIndex; // open on the mode you're already on
      this.refreshModeLocks();
      this.menu.classList.add('hidden');
      const page = $('modes');
      page.classList.remove('hidden', 'intro');
      void page.offsetWidth; // restart the intro animation on every open
      page.classList.add('intro');
    };
    on('mode-all', openModes);

    $('home-mode-count').textContent = String(MODES.length);
    this.setRacers(4);
    this.refreshBest();
    this.refreshBank();
    this.refreshDaily();
    this.refreshWeekly();
    this.refreshBounty();
    // a bounty posted in Convex lights the card up once it answers
    void loadBounty().then(() => this.refreshBounty());
    this.refreshModeLocks();
  }

  /**
   * Class locks depend on what's in the garage, so the mode UI is refreshed
   * whenever ownership can have changed rather than baked in at build time.
   */
  private refreshModeLocks(): void {
    MODES.forEach((m, i) => {
      if (!m.requiresClass) return;
      const locked = modeLocked(m);
      const label = `${KIND_LABEL[m.requiresClass]} ONLY`;
      const card = this.modeCards[i];
      if (card) {
        card.classList.toggle('locked', locked);
        const req = card.querySelector('.mode-card-req');
        if (req) req.textContent = locked ? `🔒 ${label}` : label;
      }
      const chip = this.modeButtons[i];
      if (chip) {
        chip.classList.toggle('locked', locked);
        const risk = chip.querySelector('.mr');
        if (risk) risk.textContent = locked ? '🔒 LOCKED' : (MODE_RISK[m.id] ?? 'MODE');
      }
    });
    this.layoutDeck(); // the CTA carries the lock state of the focused mode
  }

  /**
   * Place every deck slide relative to the focused one. `frac` shifts the
   * whole carousel mid-swipe (in slide steps); at rest it is 0 and the focused
   * mode's accent, counter, dots and CTA are refreshed.
   */
  private layoutDeck(frac = 0): void {
    this.modeCards.forEach((card, i) => {
      const d = i - this.deckIndex + frac;
      const ad = Math.abs(d);
      card.style.transform =
        `translate(-50%, -50%) translateX(${d * 78}%) rotateY(${-d * 24}deg) ` +
        `scale(${1 - Math.min(ad, 2) * 0.17})`;
      card.style.opacity = String(ad > 2.4 ? 0 : 1 - Math.min(ad, 2) * 0.42);
      card.style.zIndex = String(100 - Math.round(ad * 10));
      card.style.pointerEvents = ad > 1.5 ? 'none' : 'auto';
      card.classList.toggle('is-active', i === this.deckIndex);
      card.tabIndex = i === this.deckIndex ? 0 : -1;
    });
    if (frac !== 0) return;
    const m = MODES[this.deckIndex];
    if (!m) return;
    const accent = MODE_ACCENT[m.id] ?? '#fcff52';
    const page = $('modes');
    page.style.setProperty('--accent', accent);
    page.style.setProperty('--accent-soft', hexAlpha(accent, 0.3));
    $('mode-count-now').textContent = String(this.deckIndex + 1).padStart(2, '0');
    $('mode-count-total').textContent = String(MODES.length).padStart(2, '0');
    $('mode-dots').querySelectorAll('i').forEach((dot, i) => {
      dot.classList.toggle('on', i === this.deckIndex);
    });
    $<HTMLButtonElement>('mode-prev').disabled = this.deckIndex === 0;
    $<HTMLButtonElement>('mode-next').disabled = this.deckIndex === MODES.length - 1;
    const locked = modeLocked(m);
    const go = $('mode-go');
    go.textContent = locked && m.requiresClass
      ? `🔒 NEEDS A ${KIND_LABEL[m.requiresClass]} CAR`
      : `RACE ${m.name}`;
    go.classList.toggle('locked', locked);
    // the lap chips sit under the deck, so they follow the card being browsed:
    // a mode that fixes its own lap count shows it, dimmed
    $('lap-select').classList.toggle('locked', m.lapsLocked !== undefined);
    this.selectLapChip(m.lapsLocked ?? this.pickedLaps, false);
  }

  /** Move deck focus one step; the ends hold rather than wrap. */
  private stepDeck(dir: number): void {
    const next = Math.max(0, Math.min(MODES.length - 1, this.deckIndex + dir));
    if (next === this.deckIndex) {
      this.layoutDeck();
      return;
    }
    this.deckIndex = next;
    this.audio.play('select');
    this.layoutDeck();
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
      `<span class="ev-label">DAILY RUN</span>` +
      `<strong class="ev-title">${m.flag} ${m.name}</strong>` +
      `<small class="ev-meta">${best
        ? `Today's top ${best.score} · ${best.tag}` : 'One circuit. Everyone. Today.'}</small>`;
    this.refreshStreak();
  }

  /** The Weekly Cup button shows this week's city + mode and top prize. */
  private refreshWeekly(): void {
    const m = MAPS[weeklyMapIndex(MAPS.length)];
    const mode = MODES[CUP_MODES[weeklyModeIndex(CUP_MODES.length)]];
    const best = this.board.weeklyEntries(weekKey())[0];
    $('btn-weekly').innerHTML =
      `<span class="ev-label">WEEKLY CUP</span>` +
      `<strong class="ev-title">${m.flag} ${m.name} · ${mode.name}</strong>` +
      `<small class="ev-meta">${best
        ? `Top ${best.score} · ${best.tag} · win ⬤ ${WEEKLY_PRIZES[1]}`
        : `Top 3 wins up to ⬤ ${WEEKLY_PRIZES[1]}`}</small>`;
  }

  /**
   * The bounty card on the menu. Always there: the bounty race and its board
   * run every week, and a posted prize lights the card up.
   */
  private refreshBounty(): void {
    const m = MAPS[bountyMapIndex(MAPS.length)];
    const best = this.board.bountyEntries(weekKey())[0];
    const live = bountyActive();
    const card = $('btn-bounty');
    card.classList.toggle('live', live);
    card.replaceChildren(
      textEl('span', 'ev-label', live ? '💰 BOUNTY BOARD · PRIZE POSTED' : '💰 BOUNTY BOARD'),
      textEl('strong', 'ev-title', live
        ? `${bountyPrize()} · ${bountySplit() ? `top ${bountySplit()!.length} HARDCORE wins` : 'fastest HARDCORE win'}`
        : 'Fastest HARDCORE win tops the board'),
      textEl('small', 'ev-meta', `${m.flag} ${m.name} · ${best
        ? `your fastest win ${raceClock(best.time)}`
        : 'free car · 7 pro drivers · no traffic'}`)
    );
  }

  /** The bounty board: this week's race, the prize, the fastest wins and the rules. */
  private openBounty(from: HTMLElement): void {
    this.bountyReturn = from;
    this.audio.play('open');
    this.renderBountyHead();
    // opened from a result it's the rules they came for
    $<HTMLDetailsElement>('bounty-how').open = from === this.results;
    this.renderBountyBoard();
    from.classList.add('hidden');
    $('bounty').classList.remove('hidden');
    // read Convex again, so a bounty posted since the game opened shows up here
    void loadBounty(true).then(() => {
      this.renderBountyHead();
      this.refreshBounty();
    });
  }

  /** Prize, race and status lines at the top of the bounty board. */
  private renderBountyHead(): void {
    const m = MAPS[bountyMapIndex(MAPS.length)];
    const mode = MODES[BOUNTY_MODE];
    const live = bountyActive();
    $('bounty-prize').textContent = live ? bountyPrize() : 'NO PRIZE THIS WEEK';
    // a shared prize names each place, on the board and in the rules
    const split = live ? bountySplit() : null;
    const places = split?.map((p, i) => `${i + 1}${suffix(i + 1)} ${p}`) ?? [];
    $('bounty-split').textContent = places.join(' · ');
    $('bounty-rule-prize').replaceChildren(
      textEl('strong', '', split
        ? `The ${split.length} fastest winning times share the prize: ${places.join(', ')}.`
        : 'The fastest winning time takes the prize.'),
      document.createTextNode(split
        ? ' One prize per person; ties go to the earlier entry.'
        : ' Ties go to the earlier entry.')
    );
    $('bounty-sub').textContent = `${m.flag} ${m.name} · ${mode.name} · ${mode.lapsLocked ?? 2} laps` +
      ` · ${((mode.trackLength ?? 0) / 1000).toFixed(1)} km lap`;
    $('bounty-status').textContent = live
      ? `Prize posted. Win the race, then enter from the results screen in Nimiq Pay. Closes ${BOUNTY_CLOSES}.`
      : `Wins still rank on the board. No prize is posted for ${weekKey()} yet — when one is, this card lights up.`;
  }

  /** Fastest bounty wins this week: worldwide when the global board is set up, then this phone's. */
  private renderBountyBoard(): void {
    const list = $('bounty-list');
    list.replaceChildren();
    const week = weekKey();
    if (remoteEnabled()) {
      const title = textEl('div', 'board-head', '🌍 FASTEST WINS · WORLDWIDE');
      const slot = textEl('div', 'board-empty', 'Loading…');
      list.append(title, slot);
      const me = playerId(this.wallet.address);
      void topBounty(week).then((rows) => {
        if (!slot.isConnected) return; // board was rebuilt meanwhile
        if (rows.length === 0) {
          slot.textContent = 'No wins posted yet. The first one tops the board.';
          return;
        }
        slot.remove();
        title.after(...rows.map((e, i) =>
          this.boardRow(i + 1, e.tag, e.car, raceClock(e.time_s), e.player_id === me)));
      });
    }
    list.appendChild(textEl('div', 'board-head', '📱 YOUR WINS · THIS PHONE'));
    const mine = this.board.bountyEntries(week);
    if (mine.length === 0) {
      list.appendChild(textEl('div', 'board-empty', 'No wins yet. Finish 1st in the bounty race to post a time.'));
    }
    mine.forEach((e, i) => list.appendChild(this.boardRow(i + 1, e.tag, e.car, raceClock(e.time))));
  }

  /** Bounty board → this week's bounty race, straight to the garage like the Weekly Cup. */
  private raceBounty(): void {
    this.audio.unlock();
    this.audio.play('click');
    this.exitDaily();
    this.exitWeekly();
    this.bountyUi = true;
    this.onBounty();
    // free cars only: seat the player in one rather than in front of a locked START
    const mode = MODES[BOUNTY_MODE];
    if (!carFits(mode, CARS[this.carIndex])) {
      const fit = eligibleCars(mode)[0];
      if (fit !== undefined) this.selectCar(fit);
    }
    $('lap-select').classList.add('locked');
    $('bounty').classList.add('hidden');
    $('garage').classList.remove('hidden');
    this.onPage('garage');
  }

  /** Leaving the bounty race flow: unlock the lap picker and tell the game. */
  private exitBounty(): void {
    if (!this.bountyUi) return;
    this.bountyUi = false;
    $('lap-select').classList.remove('locked');
    this.selectLapChip(this.pickedLaps, false);
    this.onBountyExit();
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
      if (c) {
        c.classList.toggle('sel', ci === i);
        c.setAttribute('aria-pressed', String(ci === i));
      }
    });
    this.modeCards.forEach((c, ci) => {
      c.classList.toggle('sel', ci === i);
      c.setAttribute('aria-pressed', String(ci === i));
    });
    $('mode-tag').textContent = m.tagline;
    $('mode-name-line').textContent = `${m.icon} ${m.name} · ${MODE_RISK[m.id] ?? 'MODE'}`;
    $('home-mode-name').textContent = m.name;
    $('home-mode-icon').textContent = m.icon;
    $('home-mode-tag').textContent = m.tagline;
    $('mode-all').style.setProperty('--accent', MODE_ACCENT[m.id] ?? '#fcff52');
    $('lap-select').classList.toggle('locked', m.lapsLocked !== undefined);
    // dimmed chips still tell the truth about how many laps you'll race;
    // the user's own pick comes back when the lock lifts
    this.selectLapChip(m.lapsLocked ?? this.pickedLaps, false);
    // the start button carries the class requirement, so it has to follow the
    // mode even when the garage isn't the visible page
    this.renderCar();
  }

  get best(): number {
    const n = Number(localStorage.getItem(BEST_KEY) ?? '0');
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  /** Reflect an externally-set lap count (e.g. ?laps= query param). */
  setLaps(n: number): void {
    this.pickedLaps = n;
    this.selectLapChip(n, false);
  }

  /** Reflect an externally-set car (saved pick / ?car= query param). */
  setCar(i: number): void {
    this.carIndex = i;
    this.carTab = CARS[i]?.class ?? 'fast';
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
    $<HTMLButtonElement>('btn-tour-done').disabled = !open;
    $('btn-tour-done').setAttribute('aria-disabled', String(!open));
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
    if (!Number.isFinite(minX + maxX + minZ + maxZ) || maxX === minX || maxZ === minZ) return;
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

  /** Prev/next stay inside the open shelf — the tabs are how you change class. */
  private stepCar(dir: number): void {
    const shelf = tabOrder().filter((i) => CARS[i].class === this.carTab);
    if (!shelf.length) return;
    const at = shelf.indexOf(this.carIndex);
    this.selectCar(shelf[(at + dir + shelf.length) % shelf.length]);
  }

  private selectCar(index: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index >= CARS.length) return;
    this.audio.play('select');
    this.carIndex = index;
    this.carTab = CARS[index].class; // a saved pick opens its own shelf
    this.renderCar();
    this.onCar(this.carIndex);
  }

  private buildCarRoster(): void {
    const roster = $('car-roster');
    // Built in shelf order but indexed by car id, so carButtons[i] still means CARS[i].
    for (const index of tabOrder()) {
      const car = CARS[index];
      const button = document.createElement('button');
      const hex = `#${car.color.toString(16).padStart(6, '0')}`;
      button.type = 'button';
      button.className = `car-roster-item ${car.class}`;
      button.style.setProperty('--car-color', hex);
      button.setAttribute('aria-label', `Select ${car.name}`);
      button.innerHTML =
        `<span class="car-roster-kind">${KIND_LABEL[car.class]}</span>` +
        `<strong><i></i>${car.name}</strong>` +
        `<small></small>`;
      button.addEventListener('click', () => this.selectCar(index));
      roster.appendChild(button);
      this.carButtons[index] = button;
    }
  }

  private renderCar(): void {
    const c = CARS[this.carIndex];
    const up = c.model === 300 ? workshopSpec(c) : applyUpgrades(c);
    $('home-car-name').textContent = c.model === 300 ? up.build!.name : c.name;
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

    // Locked cars preview fine but can't race. Every locked car is bought with
    // NIM, and the purchase sits in the footer so it is in view without
    // scrolling the specs card.
    const ownedCars = owned();
    const isOwned = c.nim === 0 || ownedCars.has(c.id);
    $('home-car-eyebrow').textContent = isOwned ? 'YOUR GARAGE / READY TO ROLL' : 'PREVIEW / BUY WITH NIM';
    // a class mode (Hyper Cup) needs the right shelf as well as ownership
    const activeMode = MODES[this.modeIndex];
    const classOk = carFits(activeMode, c);
    const canRace = isOwned && classOk;
    const start = $<HTMLButtonElement>('btn-garage-done');
    const pay = $<HTMLButtonElement>('btn-market-nim');
    start.classList.toggle('hidden', !isOwned);
    pay.classList.toggle('hidden', isOwned);
    start.classList.toggle('locked', !canRace);
    start.disabled = !canRace;
    start.setAttribute('aria-disabled', String(!canRace));
    start.textContent = classOk
      ? 'START\u00a0RACE'
      : activeMode.requiresClass && c.class !== activeMode.requiresClass
        ? `${activeMode.name}\u00a0· ${KIND_LABEL[activeMode.requiresClass]}\u00a0ONLY`
        : activeMode.freeCarsOnly && c.nim > 0
          ? `${activeMode.name}\u00a0· FREE\u00a0CARS\u00a0ONLY`
          : `${activeMode.name}\u00a0· NO\u00a0BUILDS`;
    if (!isOwned) {
      pay.disabled = this.marketPending || !this.wallet.marketReady || !this.wallet.available;
      pay.textContent = this.wallet.marketReady
        ? `BUY\u00a0· ${nimPrice(c.nim)}` : 'NIM\u00a0PAYMENTS\u00a0OFF';
      $('market-status').textContent = this.marketPending ? 'Payment awaiting approval. Check Nimiq Pay.' : !this.wallet.available
        ? `Open MiniRush in Nimiq Pay to buy ${c.name} for ${nimPrice(c.nim)}.` : this.wallet.marketReady
        ? `Unlocks instantly. One payment of ${nimPrice(c.nim)}.`
        : 'NIM payments are not configured yet.';
    } else {
      $('market-status').textContent = '';
    }

    for (const cls of CAR_TABS) {
      const count = CARS.filter((car) => car.class === cls).length;
      const tab = $(`tab-${cls}`);
      tab.setAttribute('aria-selected', String(cls === this.carTab));
      tab.textContent = `${cls === 'junk' ? 'JUNKYARD' : cls.toUpperCase()} ${count}`;
    }
    const shelfOwned = CARS.filter((car) => car.class === this.carTab
      && (car.nim === 0 || ownedCars.has(car.id))).length;
    const shelfSize = CARS.filter((car) => car.class === this.carTab).length;
    $('car-roster-count').textContent = `${TAB_LABEL[this.carTab]} · ${shelfOwned}/${shelfSize} OWNED`;

    this.carButtons.forEach((button, index) => {
      const car = CARS[index];
      const carOwned = car.nim === 0 || ownedCars.has(car.id);
      button.hidden = car.class !== this.carTab;
      button.classList.toggle('selected', index === this.carIndex);
      button.classList.toggle('locked', !carOwned);
      button.setAttribute('aria-pressed', String(index === this.carIndex));
      const status = button.querySelector('small');
      if (status) status.textContent = carOwned ? 'OWNED' : nimPrice(car.nim);
    });
    const selectedButton = this.carButtons[this.carIndex];
    if (selectedButton && !$('garage').classList.contains('hidden')) {
      selectedButton.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }

    // workshop row — hidden until the car is yours
    $('upgrade-row').classList.toggle('hidden', !isOwned || c.model === 300);
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

  private async buyMarketCar(): Promise<void> {
    const c = CARS[this.carIndex];
    if (this.marketPending || !this.wallet.available || c.nim === 0 || owned().has(c.id)) return;
    const button = $<HTMLButtonElement>('btn-market-nim');
    const status = $('market-status');
    if (!this.wallet.marketReady) {
      status.textContent = 'NIM payments are not configured yet.';
      return;
    }
    button.disabled = true;
    this.marketPending = true;
    status.textContent = 'Confirm the payment in Nimiq Pay.';
    let tx: string | null = null;
    try {
      tx = await this.wallet.buyMarketCar(c.nim);
    } catch {
      tx = null;
    } finally {
      this.marketPending = false;
    }
    if (!tx) {
      status.textContent = 'Payment was not completed.';
      button.disabled = false;
      return;
    }
    track('purchase');
    try { grantCar(c.id); } catch {
      status.textContent = `Payment returned reference ${tx}, but this device could not save the unlock. Keep the reference; do not pay again.`;
      return;
    }
    this.audio.play('buy');
    status.textContent = 'Unlocked. Market perks active.';
    this.refreshBank();
    this.renderCar();
    this.refreshModeLocks();
    this.onCar(this.carIndex);
  }

  /**
   * Opt-in: write the finished run to Nimiq as a transaction whose data field
   * carries the result. Costs the player one native confirmation, which is why
   * it's a button and never fires on its own.
   */
  private async mintReceipt(): Promise<void> {
    const run = this.lastRun;
    if (!run || run.busted) return;
    const button = $<HTMLButtonElement>('btn-mint');
    const status = $('mint-status');
    button.disabled = true;
    status.textContent = 'Confirm in Nimiq Pay…';
    // a bounty race win while a prize is posted is written as an MR3 entry
    const bountyRun = this.lastBounty && bountyActive() && bountyQualifies(run.place, run.busted);
    const tx = await (bountyRun
      ? this.wallet.mintBountyReceipt({
        week: weekKey(), score: run.score, time: run.time, place: run.place
      }, bountyReceiver())
      : this.wallet.mintRaceReceipt({
        score: run.score, place: run.place, mapId: this.mapIndex, modeId: this.modeIndex
      })
    ).catch(() => null);
    if (!tx) {
      status.textContent = bountyRun ? 'Entry not written. Try again.' : 'Receipt not written.';
      button.disabled = false;
      return;
    }
    this.audio.play('buy');
    track(bountyRun ? 'bounty' : 'receipt');
    button.classList.add('hidden');
    status.textContent = bountyRun
      ? '✅ Entered. Win faster and enter again: your fastest win counts.'
      : '⛓ Run written to Nimiq.';
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
      dot.type = 'button';
      dot.setAttribute('aria-label', owned ? `Equip ${skin.name} paint` : `Buy ${skin.name} paint for ${skin.price} coins`);
      dot.setAttribute('aria-pressed', String(i === active));
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

  /** One board line: rank, driver, detail, and the figure it is ranked on. */
  private boardRow(rank: number, name: string, meta: string, value: string, mine = false): HTMLElement {
    const row = document.createElement('div');
    row.className = rank === 1 ? 'board-row top' : 'board-row';
    if (mine) row.classList.add('mine');
    row.append(
      textEl('span', 'rk', String(rank)), textEl('span', 'tg', name),
      textEl('span', 'meta', meta), textEl('span', 'sc', value)
    );
    return row;
  }

  private renderBoard(): void {
    this.renderNameRow();
    const list = $('board-list');
    list.replaceChildren();
    const runMeta = (place: number, time: number, laps: number, car: string): string =>
      `${place}${suffix(place)} · ${time.toFixed(1)}s · ${laps} lap${laps > 1 ? 's' : ''} · ${car}`;
    const section = (title: string, entries: ReturnType<Leaderboard['entries']>) => {
      list.appendChild(textEl('div', 'board-head', title));
      entries.forEach((e, i) => list.appendChild(
        this.boardRow(i + 1, e.tag, runMeta(e.place, e.time, e.laps, e.car), String(e.score))));
    };
    const daily = this.board.dailyEntries(dayKey());
    const weekly = this.board.weeklyEntries(weekKey());
    const allTime = this.board.entries();

    // global daily first — it's the board that matters
    if (remoteEnabled()) {
      const head = textEl('div', 'board-head', '🌍 GLOBAL DAILY');
      const slot = textEl('div', 'board-empty', 'Loading…');
      list.append(head, slot);
      const me = playerId(this.wallet.address);
      void topDaily(dayKey()).then((rows) => {
        if (!slot.isConnected) return; // panel was rebuilt meanwhile
        if (rows.length === 0) {
          slot.textContent = 'No global runs yet — set the first one!';
          return;
        }
        slot.remove();
        head.after(...rows.map((e, i) => this.boardRow(
          i + 1, e.tag, runMeta(e.place, e.time_s, e.laps, e.car), String(e.score), e.player_id === me)));
      });
    }

    if (daily.length > 0) section("⚡ TODAY'S DAILY (THIS PHONE)", daily.slice(0, 5));
    if (weekly.length > 0) section("🏆 THIS WEEK'S CUP (THIS PHONE)", weekly.slice(0, 5));
    if (allTime.length > 0) section('ALL TIME', allTime);
    if (daily.length === 0 && weekly.length === 0 && allTime.length === 0 && !remoteEnabled()) {
      const empty = document.createElement('div');
      empty.className = 'board-empty';
      empty.textContent = 'No runs yet — go set a score!';
      list.appendChild(empty);
    }
  }

  private selectLapChip(n: number, notify = true): void {
    document.querySelectorAll<HTMLElement>('.lap-chip').forEach((c) => {
      const selected = Number(c.dataset.laps) === n;
      c.classList.toggle('sel', selected);
      c.setAttribute('aria-pressed', String(selected));
    });
    $('menu-laps').textContent = `${n} LAP${n === 1 ? '' : 'S'}`;
    if (notify) {
      this.pickedLaps = n;
      this.onLaps(n);
    }
  }

  /**
   * Offer explicit account permission in Nimiq Pay. Outside it there is no
   * sign-in, so the chip wears the generated driver name and opens the card.
   */
  private prepareWalletChip(): void {
    const chip = $('wallet-chip');
    chip.classList.add('connectable');
    chip.textContent = this.wallet.available ? 'CONNECT NIMIQ' : driverName();
  }

  private async refreshChip(): Promise<void> {
    const chip = $('wallet-chip');
    chip.classList.remove('connectable');
    chip.textContent = driverName();
    // Balance needs an RPC endpoint the Mini App provider doesn't supply;
    // without one the chip just shows the name.
    const nim = await this.wallet.balance().catch(() => null);
    if (nim) chip.textContent = `${driverName()} · ${nim} NIM`;
  }

  /** Chip tap: connect first if needed, then open the driver card. */
  private async onWalletChip(): Promise<void> {
    if (!this.wallet.address && this.wallet.available) {
      try {
        await this.wallet.connect();
      } catch {
        return; // dialog dismissed — stay on the menu, chip keeps offering
      }
      void this.refreshChip();
      // a fresh Nimiq sign-in picks the username the boards will show
      if (!hasUsername()) {
        this.audio.play('open');
        this.askUsername(this.menu, () => this.openProfile());
        return;
      }
    }
    this.audio.play('open');
    this.openProfile();
  }

  private openProfile(): void {
    this.renderProfile();
    this.menu.classList.add('hidden');
    $('profile').classList.remove('hidden');
  }

  /**
   * Username prompt: right after a Nimiq sign-in, and from the driver card or
   * board. `from` is hidden while it's up; `then` runs once it closes.
   */
  private askUsername(from: HTMLElement, then: () => void): void {
    this.afterUsername = then;
    from.classList.add('hidden');
    const input = $<HTMLInputElement>('username-input');
    input.value = hasUsername() ? driverName() : '';
    input.placeholder = driverName();
    $('username-error').textContent = '';
    // the generated name is the placeholder, so "keep it" needs no repeating
    $('btn-username-skip').textContent = hasUsername() ? 'CANCEL' : 'KEEP IT';
    $('username').classList.remove('hidden');
    input.focus();
  }

  private saveUsername(): void {
    const error = setUsername($<HTMLInputElement>('username-input').value);
    if (error) {
      $('username-error').textContent = error;
      this.audio.play('empty');
      return;
    }
    this.audio.play('select');
    track('name');
    this.closeUsername();
  }

  private closeUsername(): void {
    $<HTMLInputElement>('username-input').blur();
    $('username').classList.add('hidden');
    if (this.wallet.address) void this.refreshChip();
    else this.prepareWalletChip();
    this.afterUsername();
  }

  /** Who the boards credit, and how to change it. */
  private renderNameRow(): void {
    $('board-name').textContent = driverName();
    const button = $('btn-board-name');
    button.textContent = this.wallet.address ? 'EDIT' : 'SIGN IN';
    button.classList.toggle('hidden', !this.wallet.available);
    $('board-name-note').textContent = this.wallet.address ? ''
      : this.wallet.available ? 'Sign in with Nimiq to pick your username.'
      : 'Your driver name. Open MiniRush in Nimiq Pay to pick your own.';
  }

  private async boardNameAction(): Promise<void> {
    if (!this.wallet.address) {
      if (!this.wallet.available) return;
      try {
        await this.wallet.connect();
      } catch {
        return;
      }
      void this.refreshChip();
    }
    this.askUsername($('board'), () => {
      this.renderBoard();
      $('board').classList.remove('hidden');
    });
  }

  /** The driver card: identity + local progress; on-chain stats fill in async. */
  private renderProfile(): void {
    const name = driverName();
    $('profile-tag').textContent = name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('');
    $('profile-name').textContent = name;
    $('btn-profile-name').classList.toggle('hidden', !this.wallet.address);
    $('profile-addr').textContent = this.wallet.address
      ? this.wallet.shortAddress()
      : this.wallet.available ? 'Not signed in with Nimiq' : 'Open MiniRush in Nimiq Pay to pick a username';
    $('profile-balance').textContent = '';
    void this.wallet.balance()
      .then((b) => { if (b) $('profile-balance').textContent = `${b} NIM`; })
      .catch(() => { /* balance is best-effort */ });

    $('p-best').textContent = String(this.best);
    $('p-coins').textContent = String(bank());
    const cars = CARS.filter((c) => c.nim === 0 || owned().has(c.id)).length;
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
    $('p-drift').textContent = ls.driftBest > 0 ? `${ls.driftBest.toFixed(1)}s` : '—';

    // badges — earned from this player's own career, lit immediately
    const badgeRow = $('profile-badges');
    badgeRow.innerHTML = '';
    const bits = earnedBadges({ races: ls.totalRaces, bestScore: this.best });
    for (const b of BADGES) {
      const el = document.createElement('span');
      el.className = bits & (1 << b.bit) ? 'badge' : 'badge locked';
      el.textContent = b.icon;
      el.title = b.label;
      badgeRow.appendChild(el);
    }

    // on-chain panel — receipts this device has minted, plus live chain head
    const note = $('profile-chain-note');
    const receipts = mintedReceipts();
    $('p-receipts').textContent = String(receipts.length);
    $('p-block').textContent = '…';
    note.textContent = '';
    void this.wallet.chainInfo().then((info) => {
      if (!info) {
        $('p-block').textContent = '—';
        note.textContent = this.wallet.available
          ? 'Nimiq node unreachable right now.'
          : 'Open MiniRush inside Nimiq Pay to mint runs on-chain.';
        return;
      }
      $('p-block').textContent = info.blockNumber.toLocaleString();
      note.textContent = receipts.length > 0
        ? `Consensus ${info.consensus ? 'established' : 'syncing'} · your last receipt: ${receipts[receipts.length - 1].slice(0, 16)}…`
        : 'Finish a race, then tap “Mint receipt” to write it to Nimiq.';
    });
  }

  showRace(): void {
    this.hideFinishMoment();
    this.menu.classList.add('hidden');
    this.results.classList.add('hidden');
    this.hud.classList.add('visible');
    this.showKeyHints();
  }

  showFinishMoment(place: number, time: number): void {
    document.body.classList.add('finish-view');
    this.hideCountdown();
    this.hud.classList.remove('visible');
    $('key-hints').classList.add('hidden');
    $('speedlines').classList.remove('on');
    $('finish-moment-result').textContent = `P${place}  ·  ${time.toFixed(2)}s`;
    $('finish-moment').classList.remove('hidden');
  }

  hideFinishMoment(): void {
    document.body.classList.remove('finish-view');
    $('finish-moment').classList.add('hidden');
  }

  showPause(): void {
    this.showGuide('paused');
  }

  showFirstRunGuide(): void {
    this.showGuide('first-run');
  }

  hidePause(): void {
    $('pause').classList.add('hidden');
  }

  private showGuide(mode: 'paused' | 'first-run' | 'menu'): void {
    this.guideMode = mode;
    const paused = mode === 'paused';
    $('pause-kicker').textContent = paused ? 'RACE STOPPED' : 'DRIVER BRIEFING';
    $('pause-title').textContent = paused ? 'PAUSED' : mode === 'first-run' ? 'READY TO RACE?' : 'HOW TO PLAY';
    $('btn-resume').textContent = paused ? 'RESUME' : mode === 'first-run' ? 'START RACE' : 'BACK';
    $('btn-pause-restart').classList.toggle('hidden', !paused);
    $('pause').classList.remove('hidden');
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
    place: number, racers: number, time: number, coins: number,
    nitroTanks: number, nitroActive: boolean, speed: number,
    lap: number, laps: number,
    progress: number[], // 0..1 overall race progress for [player, ...rivals]
    styleMult = 1, styleGauge = 0
  ): void {
    hudClass(this.styleUi, 'on', styleMult > 1 || styleGauge > 0.02);
    hudClass(this.styleUi, 'hot', styleMult >= 4);
    hudText(this.styleMult, `×${styleMult}`);
    hudWidth(this.styleFill, Math.min(1, styleGauge) * 100);
    const placeKey = `${place}/${racers}`;
    if (this.hudPlaceKey !== placeKey) {
      this.hudPlaceKey = placeKey;
      this.hudPos.innerHTML = `P${place}<small>/${racers}</small>`;
    }
    hudText(this.hudLap, `LAP ${lap}/${laps}`);
    hudText(this.hudTime, time.toFixed(2));
    const kmh = Math.round(speed * 3.6);
    hudText(this.hudSpeed, String(kmh));
    // 230 km/h is roughly nitro top speed, so the bar reads full only on boost
    const strain = Math.min(1, kmh / 230);
    hudWidth(this.speedFill, strain * 100);
    hudClass(this.speedUi, 'redline', strain > 0.82);
    hudText(this.hudCoins, `⬤ ${coins}`);

    hudClass(this.nitroUi, 'none', nitroTanks === 0 && !nitroActive);
    hudClass(this.nitroUi, 'burning', nitroActive);
    hudClass(this.nitroUi, 'ready', nitroTanks > 0 && !nitroActive);
    hudClass(this.speedlines, 'on', nitroActive);
    hudText(this.nitroLabel, nitroActive ? 'BURNING' : 'NITRO');
    // Charge pips instead of a sentence: how much you are holding, at a glance.
    if (this.nitroPips !== nitroTanks) {
      this.nitroPips = nitroTanks;
      $('nitro-pips').innerHTML =
        Array.from({ length: Math.max(3, nitroTanks) },
          (_, i) => `<i class="${i < nitroTanks ? 'lit' : ''}"></i>`).join('');
    }

    progress.forEach((p, i) => {
      if (!this.dots[i]) return;
      const pct = Number.isFinite(p) ? Math.min(100, Math.max(0, p * 100)) : 0;
      const rounded = Number(pct.toFixed(1));
      if (parseFloat(this.dots[i].style.left) !== rounded) this.dots[i].style.left = `${rounded}%`;
    });
  }

  /** Live drift-chain readout on the HUD. Pass null (or ≤0) to hide it. */
  showDrift(seconds: number | null): void {
    if (!seconds || seconds < 0.35) {
      hudClass(this.driftUi, 'on', false);
      return;
    }
    hudText(this.driftTime, `${seconds.toFixed(1)}s`);
    hudClass(this.driftUi, 'on', true);
  }

  popText(text: string, color = '#fcff52'): void {
    this.combo.textContent = text;
    this.combo.style.color = color;
    this.combo.classList.remove('pop');
    void this.combo.offsetWidth;
    this.combo.classList.add('pop');
  }

  /**
   * Roll a number up to its value. In an arcade racer the tally is the reward —
   * showing the final figures instantly gives away the best moment of the loop
   * for free, so each row counts and clicks its way there.
   */
  private countUp(el: HTMLElement, to: number, decimals = 0): void {
    const start = performance.now(), dur = 520;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = (to * eased).toFixed(decimals);
      if (k < 1) requestAnimationFrame(step);
      else el.textContent = to.toFixed(decimals);
    };
    requestAnimationFrame(step);
  }

  /** Reveal the tally row by row, each with a rising click. */
  private runTally(rows: [string, number, number][]): void {
    for (const timer of this.tallyTimers) window.clearTimeout(timer);
    this.tallyTimers = [];
    document.querySelectorAll('.tally-row').forEach((r) => r.classList.remove('in'));
    rows.forEach(([id, value, decimals], i) => {
      this.tallyTimers.push(window.setTimeout(() => {
        const row = document.querySelector(`.tally-row[data-row="${id}"]`);
        row?.classList.add('in');
        this.countUp($(`r-${id}`), value, decimals);
        this.audio.play(i === rows.length - 1 ? 'combo' : 'select');
      }, 140 + i * 190));
    });
  }

  /**
   * Finishing order under the verdict: every car in the race, the winner's
   * time and everyone else's gap to it. Cars still on track when you crossed
   * the line carry an estimate (~).
   */
  private renderStandings(rows: Standing[]): void {
    const box = $('r-standings');
    box.replaceChildren();
    box.classList.toggle('hidden', rows.length < 2);
    if (rows.length < 2) return;
    const lead = rows[0].time;
    rows.forEach((row, i) => {
      const line = document.createElement('div');
      line.className = 'standing';
      line.classList.toggle('first', i === 0);
      line.classList.toggle('you', row.you);
      line.style.setProperty('--i', String(i));
      const who = document.createElement('span');
      who.className = 'st-who';
      who.append(textEl('strong', '', row.name));
      if (row.you) who.append(textEl('i', '', 'YOU'));
      if (row.car) who.append(textEl('small', '', row.car));
      line.append(
        textEl('span', 'st-pos', String(i + 1)),
        who,
        textEl('span', 'st-gap', i === 0
          ? raceClock(row.time)
          : `${row.estimated ? '~' : ''}+${(row.time - lead).toFixed(2)}s`)
      );
      box.appendChild(line);
    });
  }

  showResults(
    place: number, time: number, coins: number, score: number,
    laps: number, car: string, busted = false, style = 0, daily = false, weekly = false,
    takedowns = 0, bounty = false, standings: Standing[] = []
  ): void {
    this.hideFinishMoment();
    window.clearTimeout(this.keyHintTimer);
    $('key-hints').classList.add('hidden');
    const best = Math.max(this.best, score);
    localStorage.setItem(BEST_KEY, String(best));
    const won = bountyQualifies(place, busted);
    // daily / weekly runs rank on their own shared-circuit boards, not all-time;
    // the bounty board takes wins only, fastest first
    let rank: number;
    if (bounty) {
      rank = won ? this.board.submitBounty(weekKey(), { score, place, time, laps, car }) : 0;
    } else if (weekly) {
      rank = this.board.submitWeekly(weekKey(), { score, place, time, laps, car });
    } else if (daily) {
      rank = this.board.submitDaily(dayKey(), { score, place, time, laps, car });
    } else {
      rank = this.board.submit({ score, place, time, laps, car });
    }
    // Kept clearly subordinate to the placing: a personal-best badge sitting at
    // the same weight as the result read as a contradiction when you came last.
    $('r-rank').textContent = bounty
      ? won
        ? rank > 0 ? `💰 BOUNTY BOARD · #${rank} FASTEST WIN ON THIS PHONE` : '💰 WIN POSTED'
        : '💰 ONLY A WIN MAKES THE BOUNTY BOARD'
      : rank > 0
        ? weekly ? `PERSONAL BEST · #${rank} IN THE WEEKLY CUP`
          : daily ? `PERSONAL BEST · #${rank} ON TODAY'S DAILY`
          : `PERSONAL BEST · #${rank} ON YOUR BOARD`
        : '';
    // …and race the world when the global board is configured
    const remoteRun = { tag: driverName(), score, time, place, laps, car };
    if (daily && !busted) {
      void submitDaily(dayKey(), remoteRun, this.wallet.address).then((globalRank) => {
        if (globalRank > 0) $('r-rank').textContent = `🌍 #${globalRank} WORLDWIDE TODAY`;
      });
    }
    if (bounty && won) {
      void submitBounty(weekKey(), remoteRun, this.wallet.address).then((globalRank) => {
        if (globalRank > 0) $('r-rank').textContent = `🌍 #${globalRank} FASTEST WIN WORLDWIDE`;
      });
    }
    this.renderStandings(standings);
    // The screen takes a side: winning, scraping a podium and being beaten
    // should not look identical, which is exactly what they did before.
    const results = $('results');
    results.classList.remove('won', 'podium', 'lost');
    const placeEl = $('result-place');
    const wordEl = $('result-word');
    if (busted) {
      results.classList.add('lost');
      placeEl.textContent = 'BUSTED';
      placeEl.style.fontSize = '46px';
      wordEl.textContent = 'THE LAW WON';
    } else {
      placeEl.innerHTML = `${place}<em>${suffix(place)}</em>`;
      placeEl.style.fontSize = '';
      results.classList.add(place === 1 ? 'won' : place <= 3 ? 'podium' : 'lost');
      wordEl.textContent = place === 1 ? 'WIN'
        : place === 2 ? 'SO CLOSE'
        : place === 3 ? 'PODIUM'
        : 'BEATEN';
    }
    this.runTally([
      ['time', time, 1], ['style', Math.round(style), 0], ['takedowns', takedowns, 0],
      ['coins', coins, 0], ['score', score, 0]
    ]);
    const finishReward = racePayout({ place, field: 1, laps });
    const pickups = Math.max(0, coins - finishReward);
    $('r-coin-note').textContent =
      `${pickups} picked up · ${finishReward} for finishing · banked`;
    const map = MAPS[this.mapIndex];
    const mode = MODES[this.modeIndex];
    this.lastRun = {
      place, time, coins, score, style: Math.round(style), laps, car,
      map: `${map.flag} ${map.name}`, mode: mode.name, daily, busted
    };
    // minting is only offered on a finished run, inside Nimiq Pay, with a
    // receipt anchor configured
    const bountyRun = bounty && won && bountyActive();
    // a posted bounty may name its own entry address
    const receiptsReady = bountyRun
      ? this.wallet.bountyEntriesReady(bountyReceiver())
      : this.wallet.receiptsReady;
    const canMint = !busted && this.wallet.available && receiptsReady;
    this.lastBounty = bounty;
    const mint = $<HTMLButtonElement>('btn-mint');
    mint.classList.toggle('hidden', !canMint);
    mint.classList.toggle('bounty', bountyRun);
    mint.textContent = bountyRun ? '💰 ENTER THE BOUNTY' : 'MINT RECEIPT';
    mint.disabled = false;
    // entering publishes a time and a wallet address, so say so before the tap
    $('mint-status').textContent = !bountyRun ? ''
      : !this.wallet.available ? `You won the bounty race. Open MiniRush in Nimiq Pay to enter it for ${bountyPrize()}.`
      : !receiptsReady ? 'Bounty entries are not open yet.'
      : 'Publishes your winning time and wallet address on the Nimiq blockchain. Your fastest win counts.';
    $('btn-bounty-results').classList.toggle('hidden', !bounty);

    this.hud.classList.remove('visible');
    this.speedlines.classList.remove('on');
    this.results.classList.remove('hidden');
    this.refreshBest();
    this.refreshBank();
    this.refreshDaily();
    this.refreshWeekly();
    this.refreshBounty();
  }

  private refreshBest(): void {
    $('best-line').textContent = `Best score: ${this.best}`;
  }
}
