import * as THREE from 'three';
import './presentation.css';
import { AssetLibrary, disposeCarInstance } from './assets';
import { AudioManager } from './audio';
import { BOUNTY_MODE, bountyMapIndex, bountySeed } from './bounty';
import { CARS } from './cars';
import { districtIndexAt, TRACK_LENGTH_DEFAULT } from './constants';
import { dailyMapIndex, dailySeed } from './daily';
import { driverName } from './driver';
import { deposit, owned, racePayout } from './economy';
import { Entities } from './entities';
import { buildHorizon, buildReflectionSky, disposeHorizon, environmentTheme } from './environment';
import {
  GhostData, GhostRecorder, ghostKey, ghostMesh, ghostPos, loadGhost, saveGhost
} from './ghost';
import { GunHud } from './gun';
import { StyleMeter } from './style';
import { MAPS } from './maps';
import { CUP_MODES, MODES } from './modes';
import { mapUnlocked, stamp } from './passport';
import { captureReferrer, creditReferral } from './referral';
import { activeColor } from './skins';
import { applyUpgrades } from './upgrades';
import { Rival } from './rivals';
import { InputManager } from './input';
import { setUnderglow } from './meshes';
import { Player } from './player';
import { createPostFX, PostFX } from './postfx';
import { detectTier, QUALITY, QualityTier } from './quality';
import { RivalManager } from './rivals';
import { Scenery } from './scenery';
import { SmokePool } from './smoke';
import { recordLocalRace } from './stats';
import { checkReward, recordDay } from './streak';
import { TrafficManager } from './traffic';
import { Track } from './track';
import { bakedPath, loadTrackPaths } from './trackPaths';
import { Standing, UI } from './ui';
import { Wallet } from './wallet';
import { Build, workshopSpec } from './workshop';
import { Showroom } from './showroom';
import { rollWeather, WeatherSpec } from './weather';
import { claimWeeklyPrize, weeklyMapIndex, weeklyModeIndex, weeklySeed } from './weekly';

type State = 'boot' | 'menu' | 'countdown' | 'racing' | 'finished';

// P1 gets 400, last gets 0, linear in between — works for any grid size
const placeBonus = (place: number, total: number): number =>
  Math.round(400 * Math.max(0, 1 - (Math.max(1, place) - 1) / Math.max(1, total - 1)));

// chase / low bumper / high TV — cycled with the 📷 button or C key
const CAMS = [
  { back: 8.5, h: 6.1, ahead: 13, fov: 66 },
  { back: 5.2, h: 2.9, ahead: 11, fov: 75 },
  { back: 14.0, h: 11.0, ahead: 19, fov: 57 }
];

const numberParam = (qp: URLSearchParams, key: string, fallback: number): number => {
  // an absent param is null, and Number(null) is 0 — which silently made every
  // default lap 600 m, one lap, on seed 0
  const raw = qp.get(key);
  if (raw === null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  // Adaptive render resolution — holds ~60fps on weak GPUs by trading pixels
  // under load (draw-call spikes) and reclaiming them when there's slack.
  private dprCap = Math.min(window.devicePixelRatio, 2);
  private curDpr = Math.min(window.devicePixelRatio, 2);
  private frameEma = 1 / 60; // smoothed frame time (s)
  private dprCooldown = 1.5; // seconds to settle before a resolution change
  private quality: QualityTier;
  private postfx: PostFX | null = null;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private sunOffset = new THREE.Vector3(-35, 50, -30);
  private ground: THREE.Mesh;
  private groundMat: THREE.MeshStandardMaterial;
  private sky!: THREE.Group;
  private skyMat!: THREE.ShaderMaterial;
  private skyline: THREE.Group | null = null;
  private sunDisc!: THREE.Mesh;
  private sunGlow!: THREE.Mesh;

  private traffic!: TrafficManager;
  private assets = new AssetLibrary();
  private audio = new AudioManager();
  private wallet = new Wallet();
  private ui: UI;
  private input: InputManager;

  private track!: Track;
  private scenery!: Scenery;
  private entities!: Entities;
  private player!: Player;
  private rivals!: RivalManager;

  private state: State = 'boot';
  private countdownT = 0;
  private lastCount = -1;
  private raceTime = 0;
  private finishT = 0;
  private playerTime = 0;
  private playerPlace = 1;
  private coins = 0;
  // points that aren't coins, takedowns or style: drift payouts, heist loot
  private bonusScore = 0;
  private shake = 0;
  private seedCounter: number;
  private trackLength: number;
  private laps = 2;
  private raceLaps = 2; // laps actually raced (mode may lock the pick)
  private carIndex = 0;
  private mapIndex = 0;
  private modeIndex = 0;
  private takedowns = 0;
  private trafficHits = 0;
  // Impact cinematic: Burnout's insight was that the crash should be the best
  // thing in the game, not the penalty box. Time dilates, the camera drops to
  // the wreck, the frame whites out, then control comes straight back.
  private cine = { t: 0, s: 0, flash: 0 };
  private boostFx = 0;
  private busted = false;
  private lastDistrict = -1;
  private gun!: GunHud;
  private ammo = 0;
  private gunCooldown = 0;
  private ammoWarnAt = -10;
  // menu-family camera: which page is up, turntable angle, flyby distance
  private uiScene: 'menu' | 'garage' | 'tour' | 'workshop' = 'menu';
  private showroom: Showroom | null = null;
  private workshopPreview: Build | null = null;
  private garageLiftPx = 0;
  private garageLiftAt = 0;   // viewport height garageLiftPx was measured for
  private viewOffset = 0;     // lens shift currently applied to the camera
  private orbitT = 0;
  private tourS = 0;
  private camLook = new THREE.Vector3();
  private lapsDone = -1; // grid sits behind the line, so we start at lap -1
  private smoke!: SmokePool;
  private smokeT = 0;
  private lastSkidAt = -10;
  private lastWallGrindAt = -10;
  private camMode = 0;
  private cam = { ...CAMS[0] };
  private paused = false;

  private style = new StyleMeter();
  private prevGap: number[] = []; // rival s-gaps last frame — sign flip = a pass
  private lastPassedAt = -10; // last "rival gets by" callout, so a scrum doesn't spam it
  private lastBumpAt = -10;       // trades paint ≠ a near miss
  private daily = false;
  private preDaily = { seed: 0, map: 0, mode: 0, laps: 2 }; // restored afterwards
  private weekly = false;
  private preWeekly = { seed: 0, map: 0, mode: 0, laps: 2, len: TRACK_LENGTH_DEFAULT }; // restored afterwards
  private bounty = false;
  private preBounty = { seed: 0, map: 0, mode: 0, laps: 2 }; // restored afterwards
  private standings: Standing[] = []; // finishing order, snapshotted as the player crosses the line
  private raceSeed = 0;           // seed this race was actually built from
  private ghostRec: GhostRecorder | null = null;
  private ghostData: GhostData | null = null;
  private ghostObj: THREE.Group | null = null;

  // --- new features ---
  private driftChain = 0;           // seconds of continuous drift
  private driftBestThisRace = 0;    // longest single chain this race
  private weather: WeatherSpec | null = null;
  private rainOverlay: HTMLElement | null = null;
  private weatherLabel: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    // debug/test handle (crashcheck.mjs pokes at physics through this)
    (window as unknown as { __game: Game }).__game = this;
    captureReferrer();
    const qp = new URLSearchParams(location.search);
    this.trackLength = THREE.MathUtils.clamp(Math.floor(numberParam(qp, 'len', TRACK_LENGTH_DEFAULT)), 600, 5000);
    this.seedCounter = Math.floor(numberParam(qp, 'seed', Math.floor(Math.random() * 1e9)));
    this.laps = THREE.MathUtils.clamp(Math.floor(numberParam(qp, 'laps', 2)), 1, 6);
    const car = Number(qp.get('car') ?? localStorage.getItem('minirush.car'));
    this.carIndex = THREE.MathUtils.clamp(Math.floor(car) || 0, 0, CARS.length - 1);
    // ?map= takes a city id ("beijing") or an index; falls back to the saved pick
    const mapQ = qp.get('map') ?? localStorage.getItem('minirush.map') ?? '0';
    const byId = MAPS.findIndex((m) => m.id === mapQ.toLowerCase());
    this.mapIndex = byId >= 0
      ? byId
      : THREE.MathUtils.clamp(Math.floor(Number(mapQ)) || 0, 0, MAPS.length - 1);
    // a saved pick can't skip the passport (an explicit ?map= may — dev tool)
    if (!qp.get('map') && !mapUnlocked(this.mapIndex)) this.mapIndex = 0;
    // ?mode= works the same way ("burnout" or an index)
    const modeQ = qp.get('mode') ?? localStorage.getItem('minirush.mode') ?? '0';
    const modeById = MODES.findIndex((m) => m.id === modeQ.toLowerCase());
    this.modeIndex = modeById >= 0
      ? modeById
      : THREE.MathUtils.clamp(Math.floor(Number(modeQ)) || 0, 0, MODES.length - 1);
    // A restored class mode has to agree with the restored car, or the player
    // boots onto a grid they can't start: move them onto an owned car of that
    // class, and give the mode up entirely if that shelf is still empty.
    const needClass = MODES[this.modeIndex].requiresClass;
    if (needClass && CARS[this.carIndex].class !== needClass) {
      const have = owned();
      const fit = CARS.findIndex((c) => c.class === needClass
        && (c.price === 0 || have.has(c.id)));
      if (fit >= 0) this.carIndex = fit;
      else this.modeIndex = 0; // nothing on the shelf — back to Grand Prix
    }

    this.quality = detectTier(qp);
    const q = QUALITY[this.quality];
    this.renderer = new THREE.WebGLRenderer({ antialias: q.antialias, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    const map = MAPS[this.mapIndex];
    // The map's own palette seats the world before the first race dresses it.
    const theme = environmentTheme(map);
    this.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 300);
    this.scene.background = new THREE.Color(theme.sky);
    this.scene.fog = new THREE.Fog(theme.fog, map.fogNear, map.fogFar);
    this.sky = this.buildSky();
    this.scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0xe9f3f5, 0x30364a, 1.15);
    this.scene.add(this.hemi);
    this.groundMat = new THREE.MeshStandardMaterial({ color: theme.ground, roughness: 1 });
    this.sun = new THREE.DirectionalLight(0xfff4e0, 1.65);
    this.sun.position.set(-30, 45, -25);
    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.setScalar(q.shadowMapSize || 1024);
    this.sun.shadow.radius = 3.5;
    Object.assign(this.sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 145 });
    this.sun.shadow.normalBias = 0.08;
    this.sun.shadow.bias = -0.00015;
    this.scene.add(this.sun, this.sun.target);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), this.groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.24;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.smoke = new SmokePool(this.scene);
    this.postfx = createPostFX(this.renderer, this.scene, this.camera, this.quality);

    this.ui = new UI(this.wallet, this.audio);
    this.ui.setLaps(this.laps);
    this.ui.setCar(this.carIndex);
    this.ui.setMap(this.mapIndex);
    this.ui.setMode(this.modeIndex);
    this.ui.onPlay = () => this.startRace();
    this.ui.onRetrySame = () => this.retrySameTrack();
    this.ui.onLaps = (n) => (this.laps = n);
    this.ui.onCar = (i) => this.setCar(i);
    this.ui.onWorkshopPreview = build => { this.workshopPreview = build; };
    this.ui.onMap = (i) => this.setMap(i);
    this.ui.onMode = (i) => this.setMode(i);
    this.ui.onPage = (p) => {
      this.uiScene = p;
      if (p === 'tour') this.tourS = -20; // flyby crosses the start arch first
      // the turntable is a one-car show — clear the grid while it spins
      for (const r of this.rivals.rivals) r.mesh.visible = p !== 'garage';
    };
    this.ui.onDaily = () => this.startDaily();
    this.ui.onDailyExit = () => this.exitDaily();
    this.ui.onWeekly = () => this.startWeekly();
    this.ui.onWeeklyExit = () => this.exitWeekly();
    this.ui.onBounty = () => this.startBounty();
    this.ui.onBountyExit = () => this.exitBounty();

    this.gun = new GunHud(document.getElementById('hud')!);

    this.input = new InputManager(document.body);
    this.input.onTap = () => this.onTap();
    this.input.onCamera = () => this.cycleCamera();
    this.input.onNitroKey = () => this.boostNitro();
    this.input.onPause = () => this.togglePause();
    this.ui.onBrake = (down) => (this.input.uiBrake = down);
    this.ui.onGas = (down) => (this.input.uiGas = down);
    this.ui.onCamera = () => this.cycleCamera();
    this.ui.onNitroPress = () => this.boostNitro();
    this.ui.onPause = () => this.togglePause();
    this.ui.onResume = () => this.togglePause();
    this.ui.onRestart = () => {
      this.paused = false;
      this.retrySameTrack();
    };

    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !this.paused && (this.state === 'countdown' || this.state === 'racing')) {
        this.togglePause();
      }
    });

    // audio needs a user gesture; catch the very first one no matter where
    // it lands (touch, click, or keyboard) rather than relying on one button
    const unlockAudio = () => {
      this.audio.unlock();
      if (this.state !== 'countdown' && this.state !== 'racing') {
        void this.audio.playMusic('menu');
      }
    };
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });

    const circuits = MAPS.map((m) => m.circuit?.path).filter((p): p is string => !!p);
    void Promise.all([this.assets.load(), loadTrackPaths(circuits)]).then(() => {
      this.buildRace();
      this.state = 'menu';
      this.renderer.setAnimationLoop(() => this.tick());
    });
  }

  /** Gradient sky dome + retro sun disc; follows the camera on x/z. */
  private buildSky(): THREE.Group {
    const g = new THREE.Group();
    const theme = environmentTheme(MAPS[this.mapIndex]);
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color(theme.sky) },
        bottom: { value: new THREE.Color(theme.horizon) }
      },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 bottom; varying vec3 vPos;
        void main() {
          float h = clamp(normalize(vPos).y * 1.6 + 0.12, 0.0, 1.0);
          vec3 c = mix(bottom, top, pow(h, 0.75));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(250, 24, 12), this.skyMat);
    dome.renderOrder = -3;
    dome.frustumCulled = false;
    g.add(dome);

    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(13, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffdab1, transparent: true, opacity: 0.12, depthWrite: false, fog: false
      })
    );
    glow.position.set(-120, 105, -150).multiplyScalar(1.01);
    glow.lookAt(0, 5, 0);
    glow.renderOrder = -2;
    g.add(glow);
    this.sunGlow = glow;

    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(7, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe9a3, depthWrite: false, fog: false })
    );
    sun.position.set(-120, 105, -150);
    sun.lookAt(0, 5, 0);
    sun.renderOrder = -1;
    g.add(sun);
    this.sunDisc = sun;
    return g;
  }

  // A fixed compass direction makes sunlight, shadows and skyline agree in turns.
  private syncSky(cx: number, cz: number): void {
    this.sky.position.set(cx, 0, cz);
    const focus = this.track.frame(this.state === 'menu' && this.uiScene === 'tour'
      ? this.tourS + 15 : this.player.s + 14);
    // Snap the shadow camera to texels to avoid shimmering as the car moves.
    const x = Math.round(focus.x * 12) / 12, z = Math.round(focus.z * 12) / 12;
    this.sun.position.set(x + this.sunOffset.x, this.sunOffset.y, z + this.sunOffset.z);
    this.sun.target.position.set(x, 0, z);
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.postfx?.setSize(window.innerWidth, window.innerHeight, this.curDpr);
    this.garageLiftAt = 0; // re-measure the garage's clear band at the new size
  }

  /**
   * Pixels to lift the garage turntable by so the car lands in the gap between
   * the title and the car selector instead of behind it. Measured from the live
   * layout — the card grows and shrinks with the car's state (locked, market,
   * upgrades), so a hardcoded fraction would drift out of date.
   */
  private garageLift(): number {
    const h = window.innerHeight;
    if (this.garageLiftAt === h) return this.garageLiftPx;
    const box = (sel: string): DOMRect | null => {
      const el = document.querySelector(sel) as HTMLElement | null;
      return el && el.offsetParent !== null ? el.getBoundingClientRect() : null;
    };
    const top = box('#garage .stage-head')?.bottom ?? 0;
    const bottom = (box('#garage .car-roster-shell') ?? box('#garage .stage-card'))?.top ?? h;
    this.garageLiftPx = bottom > top ? h / 2 - (top + bottom) / 2 : 0;
    this.garageLiftAt = h;
    return this.garageLiftPx;
  }

  // ---------- race lifecycle ----------

  /**
   * Builds the world for `seedCounter` WITHOUT consuming the seed, so the
   * circuit shown on the menu / tour minimap is the exact circuit raced.
   * The seed advances when a race finishes.
   */
  /** Daily challenge: everyone's circuit — fixed seed/map/mode/laps for today. */
  private startDaily(): void {
    if (this.daily) return;
    this.daily = true;
    this.preDaily = {
      seed: this.seedCounter, map: this.mapIndex, mode: this.modeIndex, laps: this.laps
    };
    this.seedCounter = dailySeed();
    this.mapIndex = dailyMapIndex(MAPS.length);
    this.modeIndex = 0; // Grand Prix — the shared board has to compare like runs
    this.laps = 2;
    this.disposeRace();
    this.buildRace();
    this.ui.setMap(this.mapIndex);
  }

  /** Restore whatever the player had picked before the daily detour. */
  private exitDaily(): void {
    if (!this.daily) return;
    this.daily = false;
    this.seedCounter = this.preDaily.seed;
    this.mapIndex = this.preDaily.map;
    this.modeIndex = this.preDaily.mode;
    this.laps = this.preDaily.laps;
    this.ui.setMap(this.mapIndex);
    this.ui.setMode(this.modeIndex);
    if (this.state === 'menu') {
      this.disposeRace();
      this.buildRace();
    }
  }

  /** Weekly Cup: one shared circuit per ISO week — fixed seed/map/mode/laps. */
  private startWeekly(): void {
    if (this.weekly) return;
    this.weekly = true;
    this.preWeekly = {
      seed: this.seedCounter, map: this.mapIndex, mode: this.modeIndex, laps: this.laps,
      len: this.trackLength
    };
    this.seedCounter = weeklySeed();
    // everyone races the same circuit: a ?len= link must not shorten the cup
    this.trackLength = TRACK_LENGTH_DEFAULT;
    this.mapIndex = weeklyMapIndex(MAPS.length);
    this.modeIndex = CUP_MODES[weeklyModeIndex(CUP_MODES.length)];
    this.laps = MODES[this.modeIndex].lapsLocked ?? 2;
    this.disposeRace();
    this.buildRace();
    this.ui.setMap(this.mapIndex);
    this.ui.setMode(this.modeIndex);
  }

  /** Restore whatever the player had picked before the Weekly Cup detour. */
  private exitWeekly(): void {
    if (!this.weekly) return;
    this.weekly = false;
    this.seedCounter = this.preWeekly.seed;
    this.mapIndex = this.preWeekly.map;
    this.modeIndex = this.preWeekly.mode;
    this.laps = this.preWeekly.laps;
    this.trackLength = this.preWeekly.len;
    this.ui.setMap(this.mapIndex);
    this.ui.setMode(this.modeIndex);
    if (this.state === 'menu') {
      this.disposeRace();
      this.buildRace();
    }
  }

  /**
   * Bounty race: this week's HARDCORE circuit — seed, city and laps fixed for
   * every entrant. The lap length comes from the mode, so a ?len= link can't
   * shorten it either.
   */
  private startBounty(): void {
    if (this.bounty) return;
    this.bounty = true;
    this.preBounty = {
      seed: this.seedCounter, map: this.mapIndex, mode: this.modeIndex, laps: this.laps
    };
    this.seedCounter = bountySeed();
    this.mapIndex = bountyMapIndex(MAPS.length);
    this.modeIndex = BOUNTY_MODE;
    this.laps = MODES[BOUNTY_MODE].lapsLocked ?? 2;
    this.disposeRace();
    this.buildRace();
    this.ui.setMap(this.mapIndex);
    this.ui.setMode(this.modeIndex);
  }

  /** Restore whatever the player had picked before the bounty race. */
  private exitBounty(): void {
    if (!this.bounty) return;
    this.bounty = false;
    this.seedCounter = this.preBounty.seed;
    this.mapIndex = this.preBounty.map;
    this.modeIndex = this.preBounty.mode;
    this.laps = this.preBounty.laps;
    this.ui.setMap(this.mapIndex);
    this.ui.setMode(this.modeIndex);
    if (this.state === 'menu') {
      this.disposeRace();
      this.buildRace();
    }
  }

  /** Lap length to build: a mode with its own (HARDCORE's long circuit) overrides the pick. */
  private lapLength(): number {
    return MODES[this.modeIndex].trackLength ?? this.trackLength;
  }

  private buildRace(): void {
    const seed = this.seedCounter;
    this.raceSeed = seed;
    const map = MAPS[this.mapIndex];
    const mode = MODES[this.modeIndex];
    this.track = new Track(seed, this.lapLength(), {
      ...map, baked: bakedPath(map.circuit?.path)
    });

    // weather
    this.weather = rollWeather(map.id, seed);
    const fogNear = map.fogNear * this.weather.fogMul;
    const fogFar = map.fogFar * this.weather.fogMul;
    (this.scene.fog as THREE.Fog).near = fogNear;
    (this.scene.fog as THREE.Fog).far = fogFar;

    // rain overlay — the CSS streaks only fall while racing; the menu-backdrop
    // world keeps the weather's fog mood but stays clean of screen-wide lines
    if (!this.rainOverlay) {
      this.rainOverlay = document.getElementById('rain-overlay');
    }
    if (this.rainOverlay) {
      this.rainOverlay.style.opacity = '0';
    }
    // weather label
    if (!this.weatherLabel) {
      this.weatherLabel = document.getElementById('weather-label');
    }
    if (this.weatherLabel) {
      if (this.weather.type !== 'clear') {
        this.weatherLabel.textContent = `${this.weather.icon} ${this.weather.label}`;
        this.weatherLabel.classList.remove('hidden');
      } else {
        this.weatherLabel.classList.add('hidden');
      }
    }

    // horizon panorama ring (rides in the sky group so it follows the camera)
    if (this.skyline) {
      this.sky.remove(this.skyline);
      disposeHorizon(this.skyline);
      this.skyline = null;
    }
    const theme = environmentTheme(map);
    this.scene.environment?.dispose();
    this.scene.environment = buildReflectionSky(theme);
    this.scene.environmentIntensity = theme.night ? 1.0 : 0.85;
    this.skyline = buildHorizon(theme);
    this.sky.add(this.skyline);
    (this.skyMat.uniforms.top.value as THREE.Color).setHex(theme.sky);
    (this.skyMat.uniforms.bottom.value as THREE.Color).setHex(theme.horizon);
    (this.scene.background as THREE.Color).setHex(theme.sky);
    (this.scene.fog as THREE.Fog).color.setHex(theme.fog);
    this.groundMat.color.setHex(theme.ground);
    this.hemi.color.setHex(theme.night ? 0xa6c6df : 0xe9f3f5);
    this.hemi.groundColor.setHex(theme.night ? 0x394253 : 0x6d6e62);
    this.hemi.intensity = 1.65;
    this.sun.color.setHex(theme.night ? 0xaacbea : 0xffe2b5);
    this.sun.intensity = theme.night ? 1.5 : 2.7;
    if (map.id === 'lagos') {
      this.hemi.intensity = 1.45;
      this.hemi.groundColor.setHex(0x687365);
      this.sun.color.setHex(0xffefd3);
      this.sun.intensity = 2.35;
    }
    this.sunDisc.scale.setScalar(theme.night ? 0.65 : 1);
    (this.sunDisc.material as THREE.MeshBasicMaterial).color.setHex(theme.night ? 0xdceaff : 0xffecc8);
    this.sunGlow.visible = !theme.night;
    this.postfx?.setMood(theme.night);
    setUnderglow(theme.night ? 1 : 0.2);
    this.scenery = new Scenery(this.scene, this.track, seed, map);
    this.sunOffset.set(-35, 50, -30);
    if (theme.coast) {
      const f = this.track.frame(65), side = this.scenery.group.userData.shoreSide as number;
      this.sunOffset.set(f.nx * side * 50 + Math.sin(f.theta) * 25, 48,
        f.nz * side * 50 - Math.cos(f.theta) * 25);
    }
    this.sunDisc.position.copy(this.sunOffset).normalize().multiplyScalar(215);
    this.sunDisc.lookAt(0, 0, 0);
    this.sunGlow.position.copy(this.sunDisc.position).multiplyScalar(1.01);
    this.sunGlow.lookAt(0, 0, 0);
    this.entities = new Entities(this.scene, this.track, seed);
    this.player = new Player(this.scene, this.assets, this.track, this.carSpec(this.carIndex));
    // Civilian traffic: the substrate near-misses and takedowns need, and the
    // thing that makes speed legible. A no-traffic mode (HARDCORE) leaves the
    // road to the racers.
    this.traffic = new TrafficManager(
      this.scene, this.assets, this.track, seed, mode.noTraffic ? 0 : 10,
      CARS[this.carIndex].model, map.id
    );
    // A class mode fields the rest of that shelf; everything else races the
    // civilian traffic shells.
    const rivalPool = mode.requiresClass
      ? CARS.filter((c) => c.class === mode.requiresClass && c.id !== CARS[this.carIndex].id)
      : [];
    this.rivals = new RivalManager(
      this.scene, this.assets, this.track, CARS[this.carIndex].model,
      mode.rivals, mode.pursuit, rivalPool, mode.pro
    );
    this.rivals.paceMul = this.player.speedMul;
    // an AI boost you can hear coming, loudest when it's on your bumper
    this.rivals.onNitro = (r) => {
      const d = Math.abs(r.s - this.player.s);
      if (this.state === 'racing' && d < 60) this.audio.play('nitro', 0.8 * (1 - d / 60));
    };
    // weather grip modifier applies to the whole field, so bad weather slows
    // the player and the AI alike (no rubber-band advantage in the rain)
    if (this.weather && this.weather.gripMul !== 1) {
      this.player.gripMul = this.weather.gripMul;
      this.rivals.gripMul = this.weather.gripMul;
    }
    this.resetGrid();
    this.ui.setRacers(mode.rivals + 1);
    this.ui.drawTrackMap(this.track.outline(), map.districts.map((d) => d.accent));
    if (this.state === 'boot') {
      // seat the menu camera immediately so boot doesn't swoop in from origin
      const b = this.track.frame(-6 - CAMS[0].back);
      const a = this.track.frame(-6 + CAMS[0].ahead);
      this.camera.position.set(b.x, CAMS[0].h, b.z);
      this.camLook.set(a.x, 1.1, a.z);
    }
  }

  /** The car spec to race/park: upgrades applied, active paint-job color swapped in. */
  private carSpec(i: number) {
    if (CARS[i].model === 300) return workshopSpec(CARS[i]);
    return { ...applyUpgrades(CARS[i]), color: activeColor(CARS[i].id) };
  }

  /** Garage pick: persist, and swap the parked car live while in the menu. */
  private setCar(i: number): void {
    if (!Number.isSafeInteger(i) || i < 0 || i >= CARS.length) return;
    this.carIndex = i;
    localStorage.setItem('minirush.car', String(i));
    if (this.state === 'menu') {
      this.scene.remove(this.player.mesh);
      disposeCarInstance(this.player.mesh);
      this.player = new Player(this.scene, this.assets, this.track, this.carSpec(i));
      this.player.reset({ s: -6, x: -2 });
    }
  }

  /** Tour stop pick: persist, and rebuild the menu backdrop in the new city. */
  private setMap(i: number): void {
    if (!Number.isSafeInteger(i) || i < 0 || i >= MAPS.length) return;
    this.mapIndex = i;
    localStorage.setItem('minirush.map', MAPS[i].id);
    if (this.state === 'menu') {
      this.disposeRace();
      this.buildRace();
    }
  }

  /** Mode pick: persist, and rebuild so the menu grid shows the new field. */
  private setMode(i: number): void {
    if (!Number.isSafeInteger(i) || i < 0 || i >= MODES.length) return;
    this.modeIndex = i;
    localStorage.setItem('minirush.mode', MODES[i].id);
    if (this.state === 'menu') {
      this.disposeRace();
      this.buildRace();
    }
  }

  private disposeRace(): void {
    this.scenery.dispose(this.scene);
    this.entities.dispose(this.scene);
    this.traffic?.dispose(this.scene);
    this.scene.remove(this.player.mesh);
    disposeCarInstance(this.player.mesh);
    for (const r of this.rivals.rivals) {
      this.scene.remove(r.mesh);
      disposeCarInstance(r.mesh);
    }
    this.rivals.dispose();
    if (this.ghostObj) {
      this.scene.remove(this.ghostObj);
      this.ghostObj = null;
    }
  }

  private resetGrid(): void {
    this.traffic?.reset(0);
    // Police Chase: you get a head start. The first units line up in your
    // mirrors, staggered back across both lanes; the rest lie in wait down
    // the road and attack as you arrive.
    if (MODES[this.modeIndex].pursuit) {
      const chasers = 3;
      this.player.reset({ s: 0, x: -2 });
      this.rivals.reset(this.rivals.rivals.map((_, i) => i < chasers
        ? { s: -10 - i * 6, x: i % 2 === 0 ? 2 : -2 }
        : { s: 90 + (i - chasers) * 110, x: i % 2 === 0 ? -1.5 : 1.5 }
      ));
      return;
    }
    // rows of two, player in the last slot so overtaking feels earned
    const total = this.rivals.rivals.length + 1;
    const slot = (i: number) => ({ s: -6 * Math.floor(i / 2), x: i % 2 === 0 ? 2 : -2 });
    this.player.reset(slot(total - 1));
    this.rivals.reset(this.rivals.rivals.map((_, i) => slot(i)));
  }

  private startRace(): void {
    if (!localStorage.getItem('minirush.controls-guide')) {
      this.ui.showFirstRunGuide();
      return;
    }
    this.paused = false;
    this.ui.hidePause();
    this.audio.play('start'); // race-start fanfare on the START RACE launch
    this.disposeRace();
    this.buildRace();
    this.raceLaps = MODES[this.modeIndex].lapsLocked ?? this.laps;
    this.player.raceLength = this.raceLaps * this.track.length;
    this.rivals.raceLength = this.raceLaps * this.track.length;
    this.lapsDone = -1;
    this.state = 'countdown';
    this.countdownT = 3.0;
    this.lastCount = -1;
    this.audio.play('ignition');
    this.audio.startEngine();
    if (MODES[this.modeIndex].pursuit) this.audio.startSiren();
    void this.audio.playMusic(MAPS[this.mapIndex].music ?? 'race');
    this.raceTime = 0;
    this.frameEma = 1 / 60;
    this.dprCooldown = 1.5;
    this.playerTime = 0;
    this.coins = 0;
    this.bonusScore = 0;
    this.takedowns = 0;
    this.trafficHits = 0;
    this.busted = false;
    this.shake = 0;
    this.lastDistrict = -1;
    this.driftChain = 0;
    this.driftBestThisRace = 0;
    this.ui.showDrift(null);
    const mode = MODES[this.modeIndex];
    this.ammo = mode.guns ? 8 : 0;
    this.gunCooldown = 0;
    this.ammoWarnAt = -10;
    this.gun.setVisible(!!mode.guns);
    this.player.setShooter(!!mode.guns);
    this.gun.setAmmo(this.ammo);
    this.player.voltageMode = !!mode.voltage;
    this.player.voltageLevel = 100;

    this.style.reset();
    this.lastBumpAt = -10;
    this.lastPassedAt = -10;
    this.prevGap = this.rivals.rivals.map((r) => r.s - this.player.s);

    // ghost of your best run on this exact circuit (no cop-chase hauntings —
    // a spectral cruiser reads as a second cop)
    this.ghostRec = new GhostRecorder();
    this.ghostData = mode.pursuit ? null : loadGhost(this.currentGhostKey());
    if (this.ghostObj) {
      this.scene.remove(this.ghostObj);
      this.ghostObj = null;
    }
    if (this.ghostData) {
      this.ghostObj = ghostMesh(this.assets.cloneCar(CARS[this.ghostData.car] ?? CARS[0]));
      this.scene.add(this.ghostObj);
      const p0 = ghostPos(this.ghostData, 0);
      if (p0) {
        this.track.place(this.ghostObj, p0.s, p0.x); // on its grid slot for the countdown
        this.ghostObj.rotation.y += Math.PI;
      }
      this.ui.popText(`GHOST: ${this.ghostData.time.toFixed(1)}s — BEAT IT`, '#9adfff');
    }

    // now that we're really racing, let the weather's rain streaks fall
    if (this.rainOverlay && this.weather) {
      this.rainOverlay.style.opacity = String(this.weather.rainIntensity);
    }

    this.ui.showRace();
  }

  private currentGhostKey(): string {
    return ghostKey(
      this.raceSeed, MAPS[this.mapIndex].id, MODES[this.modeIndex].id,
      this.raceLaps, this.lapLength()
    );
  }

  /** Tap = shoot in gun modes; otherwise tap = nitro, as ever. */
  private onTap(): void {
    if (this.state !== 'racing' || this.paused) return;
    if (MODES[this.modeIndex].guns) {
      this.shoot();
      return;
    }
    this.boostNitro();
  }

  private boostNitro(): void {
    if (this.state !== 'racing' || this.paused) return;
    if (this.player.fireNitro()) {
      this.audio.play('nitro');
      this.ui.popText('NITRO!', '#7fd4ff');
    }
  }

  private togglePause(): void {
    if (!this.paused && this.state !== 'countdown' && this.state !== 'racing') return;
    this.paused = !this.paused;
    if (this.paused) {
      this.audio.stopEngine();
      this.audio.stopSiren();
      this.ui.showPause();
    } else {
      this.ui.hidePause();
      this.audio.startEngine();
      if (MODES[this.modeIndex].pursuit) this.audio.startSiren();
    }
  }

  /**
   * Hitscan straight up the current lane — the first rival inside the
   * corridor eats the bullet and takes a tire shot. A pursuit mode with guns
   * fires rearward and knocks the cruiser off your bumper instead.
   */
  private shoot(): void {
    const p = this.player;
    if (this.gunCooldown > 0 || p.tumbleT > 0) return;
    if (this.ammo < 1) {
      this.audio.play('empty');
      if (this.raceTime - this.ammoWarnAt > 2.5) {
        this.ammoWarnAt = this.raceTime;
        this.ui.popText(
          MODES[this.modeIndex].pursuit ? 'RELOADING…' : 'OUT OF AMMO — GRAB CRATES',
          '#ff8a3d'
        );
      }
      return;
    }
    this.ammo--;
    this.gunCooldown = 0.24;
    this.gun.recoil();
    this.player.shooterRecoil();
    this.gun.setAmmo(this.ammo);
    this.audio.play('shot');
    if (navigator.vibrate) navigator.vibrate(15);

    const RANGE = 48;
    // Cop Chase fires out the REAR window — that's where the law lives
    const rear = !!MODES[this.modeIndex].pursuit;
    const dirS = rear ? -1 : 1;
    let hitS = p.s + dirS * RANGE;
    let targetRival: Rival | null = null;
    for (const r of this.rivals.rivals) {
      if (r.tumbleT > 0) continue;
      const along = (r.s - p.s) * dirS; // distance in the firing direction
      if (along > 2 && along < Math.abs(hitS - p.s) && Math.abs(r.x - p.x) < 1.8) {
        hitS = r.s;
        targetRival = r;
      }
    }

    if (targetRival) {
      const f = this.track.frame(targetRival.s);
      this.smoke.spawn(f.x + f.nx * targetRival.x, 0.5, f.z + f.nz * targetRival.x, 0xffb84a, 0.5);
      if (MODES[this.modeIndex].pursuit) {
        if (targetRival.bumpCooldown <= 0) {
          targetRival.bumpCooldown = 1.2; // brief immunity — no stunlocking the law
          targetRival.v *= 0.45;
          this.ui.popText('HOLD THEM OFF!', '#7fd4ff');
          this.audio.play('blowout', 0.7);
        }
      } else {
        this.rivals.wreck(targetRival);
        this.takedowns++;
        this.ui.popText(`TIRE SHOT! ${targetRival.name} +150`, '#ff8a3d');
        this.audio.play('blowout');
        this.shake = 0.5;
      }
      return;
    }

    // clean miss — kick up dust where the round lands
    const f = this.track.frame(p.s + dirS * RANGE);
    this.smoke.spawn(f.x + f.nx * p.x, 0.15, f.z + f.nz * p.x, 0x9a8f78, 0.4);
  }

  private cycleCamera(): void {
    this.camMode = (this.camMode + 1) % CAMS.length;
    this.audio.play('click');
  }

  private checkLap(): void {
    const done = Math.floor(this.player.s / this.track.length);
    if (done <= this.lapsDone) return;
    this.lapsDone = done;
    if (done > 0 && done < this.raceLaps) {
      this.ui.popText(done === this.raceLaps - 1 ? 'FINAL LAP' : `LAP ${done + 1}/${this.raceLaps}`, '#fcff52');
      this.audio.play('go');
      this.entities.beginLap(); // fresh pickups every lap
    }
  }

  private finishRace(): void {
    if (this.state === 'finished') return;
    this.state = 'finished';
    this.finishT = 0;
    this.playerTime = this.raceTime;
    // Cop Chase isn't a footrace against the cop — you escaped or you didn't
    this.playerPlace = MODES[this.modeIndex].pursuit
      ? (this.busted ? 2 : 1)
      : 1 + this.rivals.rivals.filter(
          (r) => r.finishTime >= 0 && r.finishTime < this.raceTime
        ).length;
    this.standings = this.classify();
    this.audio.play('finish');
    if (navigator.vibrate) navigator.vibrate([40, 60, 120]);
    this.ui.endTutorial();
    this.audio.stopEngine();
    this.audio.stopSiren();
    if (!this.busted) {
      this.cine.t = 0;
      this.cine.flash = 0;
      this.ui.showFinishMoment(this.playerPlace, this.playerTime);
    }
    void this.audio.playMusic('menu');

    // pay out any remaining drift chain
    if (this.driftChain > 0.5) {
      const driftPts = Math.floor(this.driftChain * 40);
      this.bonusScore += driftPts;
      this.ui.popText(`DRIFT ${this.driftChain.toFixed(1)}s +${driftPts}`, '#ffb84a');
    }
    this.driftChain = 0;
    this.ui.showDrift(null);

    // passport: finishing (not fleeing busted) stamps the city
    if (!this.busted && stamp(MAPS[this.mapIndex].id)) {
      const next = MAPS[this.mapIndex + 1];
      if (next) this.ui.popText(`🛂 ${next.flag} ${next.name} UNLOCKED!`, '#9adfff');
    }

    // Guaranteed finish payout on top of coins grabbed on track — keeps the
    // garage curve moving even on a pickup-light run (economy floor).
    const payout = racePayout({
      place: this.playerPlace,
      field: this.rivals.rivals.length + 1,
      laps: this.raceLaps
    });
    this.coins += payout;
    if (payout > 0) setTimeout(() => this.ui.popText(`+${payout} COINS`, '#fcff52'), 1600);
    deposit(this.coins); // race coins bank for the garage

    // Record local stats
    recordLocalRace({
      place: this.playerPlace,
      score: this.score(),
      coins: this.coins,
      modeId: MODES[this.modeIndex].id,
      mapId: MAPS[this.mapIndex].id,
      driftBest: this.driftBestThisRace
    });

    // Daily streak
    if (this.daily) {
      recordDay();
      const reward = checkReward();
      if (reward) {
        setTimeout(() => {
          this.ui.popText(`🔥 ${reward.milestone}-DAY STREAK! +${reward.coins} COINS`, '#00ffcc');
        }, 2200);
      }
    }

    // Weekly Cup prize (non-staked — coins, paid once per week for top-3)
    if (this.weekly && !this.busted) {
      const prize = claimWeeklyPrize(this.playerPlace);
      if (prize > 0) {
        setTimeout(() => {
          this.ui.popText(`🏆 WEEKLY CUP PRIZE +${prize} COINS!`, '#fcff52');
        }, 2200);
      }
    }

    // Referral: credit local coins on the first race.
    if (creditReferral()) {
      setTimeout(() => {
        this.ui.popText('🎉 REFERRAL BONUS +50 COINS!', '#fcff52');
      }, 3000);
    }

    // The run itself is banked locally and pushed to the daily board by the UI.
    // Writing it on-chain costs the player a native Nimiq Pay confirmation, so
    // it stays opt-in behind the results screen's mint button — never automatic.

    if (!this.busted && this.ghostRec) {
      const beat = saveGhost(
        this.currentGhostKey(),
        this.ghostRec.data(this.carIndex, this.playerTime, this.score())
      );
      if (beat && this.ghostData) this.ui.popText('GHOST BEATEN!', '#9adfff');
    }
    // the shared circuits (daily, cup, bounty) stay put for "race again"; normal
    // play moves to a fresh one
    if (!this.daily && !this.weekly && !this.bounty) this.seedCounter++;
  }

  /**
   * Finishing order as it stands when the player crosses the line. Rivals
   * already home keep their real times. The rest are placed by distance still
   * to run, turned into a time gap at the player's average pace, so estimated
   * rows always read in track order.
   */
  private classify(): Standing[] {
    if (MODES[this.modeIndex].pursuit) return [];
    const t = this.raceTime;
    const total = this.raceLaps * this.track.length;
    const pace = total / Math.max(t, 1);
    const rows: Standing[] = [{
      name: driverName(), car: CARS[this.carIndex].name, time: t, estimated: false, you: true
    }];
    for (const r of this.rivals.rivals) {
      const home = r.finishTime >= 0 && r.finishTime <= t;
      rows.push({
        name: r.name,
        car: r.car,
        time: home ? r.finishTime : t + Math.max(0, total - r.s) / pace,
        estimated: !home,
        you: false
      });
    }
    // a rival that crossed in the same frame as the player is placed behind them
    return rows.sort((a, b) => a.time - b.time || Number(b.you) - Number(a.you));
  }

  /** Retry the exact same track (same seed). */
  private retrySameTrack(): void {
    this.seedCounter = this.raceSeed;
    this.startRace();
  }

  private score(): number {
    return Math.round(
      this.bonusScore + this.coins * 10 + this.takedowns * 150 + this.style.score +
      placeBonus(this.playerPlace, this.rivals.rivals.length + 1) +
      Math.max(0, ((this.raceLaps * this.track.length) / 18 - this.playerTime) * 4)
    );
  }

  // ---------- per-frame ----------

  /**
   * Nudge render resolution toward a 60fps budget. Only while racing (menus are
   * cheap): steps down to 0.75x when frames run long, climbs back to the device
   * cap when there's headroom. A cooldown guards against resolution oscillation.
   */
  private adaptResolution(dt: number): void {
    if (this.state !== 'racing' || this.paused) return;
    this.frameEma += (dt - this.frameEma) * (1 - Math.exp(-6 * dt));
    this.dprCooldown = Math.max(0, this.dprCooldown - dt);
    if (this.dprCooldown > 0) return;
    const fps = 1 / this.frameEma;
    const MIN = 0.75, STEP = 0.25;
    // Out of resolution to give back: drop a quality tier instead. One-way — a
    // device that could not hold the budget will not be asked to prove it twice.
    if (fps < 45 && this.curDpr <= MIN && this.quality > 0) {
      this.demoteQuality();
      this.dprCooldown = 4;
      return;
    }
    let next = this.curDpr;
    if (fps < 50 && this.curDpr > MIN) next = Math.max(MIN, this.curDpr - STEP);
    else if (fps > 58 && this.curDpr < this.dprCap) next = Math.min(this.dprCap, this.curDpr + STEP);
    if (next !== this.curDpr) {
      this.curDpr = next;
      this.renderer.setPixelRatio(next);
      this.postfx?.setSize(window.innerWidth, window.innerHeight, next);
      this.dprCooldown = 1.5;
    }
  }

  /**
   * Step down one tier: a smaller shadow map, then no shadows at all. Toggling
   * `shadowMap.enabled` changes how every lit material compiles, so the scene's
   * materials are marked for a rebuild — a one-frame hitch, at most twice a session.
   */
  private demoteQuality(): void {
    this.quality = (this.quality - 1) as QualityTier;
    const q = QUALITY[this.quality];
    // Rebuild rather than keep a composer built for a tier we no longer are —
    // demoting off the desktop tier has to actually drop the bloom passes.
    this.postfx?.dispose();
    this.postfx = createPostFX(this.renderer, this.scene, this.camera, this.quality);
    this.postfx?.setSize(window.innerWidth, window.innerHeight, this.curDpr);
    this.postfx?.setMood(environmentTheme(MAPS[this.mapIndex]).night);
    this.sun.castShadow = q.shadows;
    this.renderer.shadowMap.enabled = q.shadows;
    // A resized map has to be thrown away before three will allocate the new one.
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    if (q.shadows) this.sun.shadow.mapSize.setScalar(q.shadowMapSize);
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        m.needsUpdate = true;
      }
    });
  }

  /**
   * Every frame goes through here. On tiers 1-2 that means the composer (ACES +
   * grade + vignette, plus bloom on desktop); tier 0 renders straight to the
   * canvas, where the renderer's own tone mapping still applies.
   */
  renderFrame(forceWorld = false): void {
    if (!forceWorld && this.state === 'menu' && this.uiScene !== 'tour') {
      this.showroom ??= new Showroom(this.assets);
      const spec = this.workshopPreview ? workshopSpec(CARS.find(c => c.model === 300)!, this.workshopPreview) : this.carSpec(this.carIndex);
      this.showroom.setCar(spec);
      this.showroom.render(this.renderer, this.uiScene === 'workshop', this.uiScene === 'garage');
      return;
    }
    if (this.postfx) this.postfx.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Kick off an impact cinematic centred on a point of the lap. */
  private cinematic(s: number, label: string): void {
    this.cine.t = 0.85;
    this.cine.s = s;
    this.cine.flash = 1;
    this.shake = Math.max(this.shake, 1.6);
    this.ui.popText(label, '#ff8a3d');
    this.audio.play('crash');
    if (navigator.vibrate) navigator.vibrate([50, 40, 110]);
  }

  private tick(): void {
    const frameTime = this.clock.getDelta();
    const real = Math.min(frameTime, 0.05);
    const elapsed = this.clock.elapsedTime;
    const dragPx = this.input.consumeDrag();
    if (this.paused) {
      this.renderFrame();
      return;
    }
    // The showroom renders its own scene. Do not simulate the hidden race
    // while browsing the home screen or customs workshop.
    if (this.state === 'menu' && this.uiScene !== 'tour') {
      this.renderFrame();
      return;
    }
    // Bullet time: the world slows, the clock the cinematic runs on does not.
    if (this.cine.t > 0) this.cine.t -= real;
    const dilation = this.state === 'finished' && !this.busted ? 0.35 : this.cine.t > 0 ? 0.3 : 1;
    const dt = real * dilation;
    let trafficUpdated = false;
    this.cine.flash = Math.max(0, this.cine.flash - real * 5.5);
    // Boost drama ramps in fast and falls away slowly, so the release breathes.
    const wanted = this.player.nitroActive ? 1 : 0;
    this.boostFx += (wanted - this.boostFx) * Math.min(1, real * (wanted ? 9 : 3.5));
    this.postfx?.setDrama(this.boostFx, this.cine.flash);
    this.adaptResolution(Math.min(frameTime, 0.25));

    switch (this.state) {
      case 'menu':
        this.player.update(dt, elapsed, 0, 0, false);
        this.rivals.update(dt, elapsed, 0, this.player.s, false);
        break;

      case 'countdown': {
        this.countdownT -= dt;
        const n = Math.ceil(this.countdownT);
        if (n !== this.lastCount) {
          this.lastCount = n;
          if (n > 0) {
            this.ui.countdown(String(n));
            this.audio.play('count');
            this.audio.play('rev'); // blip the throttle on each beat at the line
          }
        }
        this.audio.engine(0.55, 0.12); // idling on the grid
        if (this.countdownT <= 0) {
          this.state = 'racing';
          this.ui.countdown('GO!');
          this.audio.play('go');
          this.ui.startTutorial();
          setTimeout(() => this.ui.hideCountdown(), 600);
        }
        this.player.update(dt, elapsed, 0, 0, false);
        this.rivals.update(dt, elapsed, 0, this.player.s, false);
        break;
      }

      case 'racing': {
        this.raceTime += dt;
        this.player.update(
          dt, elapsed, dragPx, this.input.keySteer, true,
          this.input.braking, this.input.gas
        );
        // engine pitch rides the speedo; nitro shoves it into the red
        this.audio.engine(
          0.55 + (this.player.v / 55) * (this.player.nitroActive ? 1.15 : 0.95),
          0.1 + Math.min(0.16, this.player.v / 300)
        );
        // siren rides the nearest unit's distance — the chase you can hear
        // before you can see it
        if (MODES[this.modeIndex].pursuit) {
          let nearest = Infinity;
          for (const r of this.rivals.rivals) {
            nearest = Math.min(nearest, Math.abs(r.s - this.player.s));
          }
          this.audio.siren(Number.isFinite(nearest) ? 1 - Math.min(1, nearest / 60) : 0);
        }
        this.handleWall(elapsed);
        this.rivals.update(
          dt, elapsed, this.raceTime, this.player.s, true,
          this.player.x, MODES[this.modeIndex].aggression, this.player.v,
          this.player.nitroActive
        );

        // Slipstream drafting: check if player is directly behind a rival inside draft cone
        let drafting = false;
        for (const r of this.rivals.rivals) {
          const sGap = this.track.wrap(r.s) - this.track.wrap(this.player.s);
          if (sGap > 3 && sGap < 24 && Math.abs(r.x - this.player.x) < 1.45 && this.player.v > 18) {
            drafting = true;
            break;
          }
        }
        this.player.draftingActive = drafting;
        if (drafting) {
          this.player.draftGauge = Math.min(1, this.player.draftGauge + dt * 0.55);
          if (this.player.draftGauge >= 1) {
            if (this.player.triggerDraftBoost()) {
              this.audio.play('draft');
              this.audio.play('combo');
              this.ui.popText('SLIPSTREAM SLINGSHOT!', '#00ffcc');
            }
          }
        } else {
          this.player.draftGauge = Math.max(0, this.player.draftGauge - dt * 0.18);
        }

        // Launch ramps: crossing one near the centre of the lane at speed sends
        // the car airborne (physics in Player); touchdown thumps the camera.
        if (!this.player.airborne && Math.abs(this.player.x) < 2.1) {
          const ws = this.track.wrap(this.player.s);
          for (const rs of this.scenery.rampS) {
            if (Math.abs(ws - rs) < 2.4 && this.player.launch()) {
              this.audio.play('go');
              this.ui.popText('RAMP JUMP! 🚀', '#ffcc00');
              this.shake = Math.max(this.shake, 0.5);
              break;
            }
          }
        }
        if (this.player.landed) {
          this.shake = Math.max(this.shake, 0.7);
          this.audio.play('land');
          if (navigator.vibrate) navigator.vibrate(40);
        }

        this.simulateContacts(dt, elapsed);
        this.traffic.update(dt, this.player.s, this.track.length, this.player.v);
        trafficUpdated = true;
        this.updateStyle(dt, elapsed);
        this.updateGhost(dt);
        this.emitSmoke(dt, elapsed);
        this.checkLap();
        const gunMode = MODES[this.modeIndex];
        if (gunMode.guns) {
          this.gunCooldown = Math.max(0, this.gunCooldown - dt);
          if (gunMode.guns && gunMode.pursuit && this.ammo < 8) {
            // the chase reloads for you — slowly; Gun Run lives off crates
            const before = Math.floor(this.ammo);
            this.ammo = Math.min(8, this.ammo + dt * 0.4);
            if (Math.floor(this.ammo) !== before) this.gun.setAmmo(Math.floor(this.ammo));
          }
          this.gun.update(dt, this.player.lean, this.player.v);
        }
        if (this.player.s >= this.raceLaps * this.track.length) this.finishRace();
        this.updateHud();
        break;
      }

      case 'finished': {
        this.finishT += real;
        this.player.update(dt, elapsed, 0, 0, false);
        this.rivals.update(dt, elapsed, this.raceTime, this.player.s, true);
        if (this.finishT > (this.busted ? 2 : 3.2)) {
          this.state = 'menu';
          this.ui.showResults(
            this.playerPlace, this.playerTime, this.coins,
            this.score(), this.raceLaps, CARS[this.carIndex].name, this.busted,
            this.style.score, this.daily, this.weekly, this.takedowns,
            this.bounty, this.standings
          );
          // rebuild behind the results overlay so the menu previews the next circuit
          this.disposeRace();
          this.buildRace();
        }
        break;
      }
    }

    if (this.state !== 'boot') {
      // the world streams in around the camera's subject: the tour flyby
      // point while the World Tour page is up, the player otherwise
      const distance = this.state === 'menu' && this.uiScene === 'tour'
        ? this.tourS : this.player.s;
      const focus = this.track.wrap(distance);
      this.smoke.update(dt);
      this.entities.update(dt, elapsed, focus);
      if (!trafficUpdated) this.traffic.update(dt, distance, this.track.length);
      this.scenery.update(focus);
      this.announceDistrict(focus);
      this.updateCamera(dt);
      this.renderFrame();
    }
  }

  /** Drift smoke / offroad dust at the rear wheels, exhaust puffs under nitro. */
  private emitSmoke(dt: number, elapsed: number): void {
    const p = this.player;
    const drifting = p.drifting;
    const dusting = p.dusting;
    const boosting = p.nitroActive;
    if (!drifting && !dusting && !boosting) {
      this.smokeT = 0;
      return;
    }

    if (drifting && elapsed - this.lastSkidAt > 0.9) {
      this.lastSkidAt = elapsed;
      this.audio.play('skid', 0.6);
    }

    this.smokeT += dt;
    const interval = 0.03;
    while (this.smokeT > interval) {
      this.smokeT -= interval;
      const rear = this.track.frame(p.s - 1.3);
      if (drifting || dusting) {
        const d = MAPS[this.mapIndex].districts[
          districtIndexAt(this.track.wrap(p.s), this.track.length)
        ];
        const color = dusting ? d.dust : 0xe8ecf2;
        for (const side of [-0.85, 0.85]) {
          const lat = p.x + side;
          this.smoke.spawn(rear.x + rear.nx * lat, 0.3, rear.z + rear.nz * lat, color, 0.55);
        }
      }
      if (boosting) {
        this.smoke.spawn(rear.x + rear.nx * p.x, 0.45, rear.z + rear.nz * p.x, 0x7fd4ff, 0.4);
      }
    }
  }

  /**
   * Road-edge contact. A graze (steered into it, or slow) grinds speed off
   * with a skid; getting thrown into it by corner force at speed is a wreck —
   * the punishment for not braking into the bend.
   */
  private handleWall(elapsed: number): void {
    const p = this.player;
    if (p.wallHit === 2) {
      p.wreck();
      this.style.crash();
      this.cinematic(p.s, 'SLAMMED');
    } else if (p.wallHit === 1 && p.v > 14) {
      p.v *= 0.93; // scraping the wall bleeds speed — get off it
      if (elapsed - this.lastWallGrindAt > 0.8) {
        this.lastWallGrindAt = elapsed;
        this.audio.play('wall_grind', 0.5);
        this.shake = Math.max(this.shake, 0.25);
        if (navigator.vibrate) navigator.vibrate(20);
      }
    }
  }

  /**
   * Style chain: drifting feeds the gauge continuously; swapping places with
   * a rival at arm's length (no paint traded) is a NEAR MISS. A full gauge
   * raises the multiplier, and every style point rides it into the score.
   */
  private updateStyle(dt: number, elapsed: number): void {
    const p = this.player;
    if (p.drifting) {
      this.style.driftTick(dt);
      this.driftChain += dt;
      if (this.driftChain > this.driftBestThisRace) this.driftBestThisRace = this.driftChain;
      this.ui.showDrift(this.driftChain);
    } else if (this.driftChain > 0.5) {
      // drift ended — pay out the chain
      const driftPts = Math.floor(this.driftChain * 40);
      this.bonusScore += driftPts;
      this.ui.popText(`DRIFT ${this.driftChain.toFixed(1)}s +${driftPts}`, '#ffb84a');
      if (navigator.vibrate) navigator.vibrate(25);
      this.driftChain = 0;
      this.ui.showDrift(null);
    } else {
      this.driftChain = 0;
      this.ui.showDrift(null);
    }
    // A full style gauge pays out in speed, not just points — this is the loop.
    const styled = this.style.update(dt);
    if (styled.tanks) {
      p.nitroTanks += styled.tanks;
      this.ui.popText(styled.levelled
        ? `STYLE ×${this.style.mult} · +NITRO` : '+NITRO', '#ffb84a');
      this.audio.play('combo');
      if (navigator.vibrate) navigator.vibrate(30);
    }
    // Threading civilian traffic is the main way the gauge fills now: a clean
    // pass inside the near-miss band pays, clipping one costs you the chain.
    for (const car of this.traffic.cars) {
      if (!car.mesh.visible || car.wrecked > 0) continue;
      const gap = car.s - p.s;
      const dx = Math.abs(car.x - p.x);
      const overlapping = Math.abs(gap) < car.contactLength;
      if (overlapping) {
        car.closestPass = Math.min(car.closestPass, dx);
        // Contact during cooldown and airborne passes cannot earn a clean pass.
        if (dx < 1.55 || p.airborne || p.tumbleT > 0) car.nearMissed = true;
      }
      if (dx < 1.55 && overlapping && p.tumbleT <= 0 && !p.airborne && p.canBump) {
        // Clipping traffic costs speed and the chain — it does not total the
        // car. Only a genuinely fast closing hit does damage, or ploughing
        // through a busy lane wrecks you before you can ever build a run.
        const closing = p.v - car.v;
        this.traffic.hit(car, closing > 24 ? 1 : 0.4);
        this.trafficHits++;
        const hardHit = closing > 24;
        p.bump(Math.sign(p.x - car.x) || 1, hardHit ? 4 : 2.5, hardHit ? 0.72 : 0.88);
        this.style.crash();
        this.audio.play('bump');
        this.shake = Math.max(this.shake, closing > 24 ? 1 : 0.55);
        if (navigator.vibrate) navigator.vibrate(closing > 24 ? 60 : 25);
        if (closing > 24) {
          p.damage++;
          p.lastHitAt = elapsed;
          if (p.damage >= 3) {
            p.wreck();
            this.cinematic(p.s, 'WRECKED');
          }
        }
        continue;
      }
      if (
        !car.nearMissed && gap < -car.contactLength &&
        Number.isFinite(car.closestPass)
      ) {
        car.nearMissed = true;
        if (car.closestPass >= TrafficManager.NEAR_MISS_BAND.min && car.closestPass <= TrafficManager.NEAR_MISS_BAND.max &&
          p.v > 24 && p.v > car.v && p.tumbleT <= 0 && !p.airborne) {
          this.style.nearMiss();
          this.ui.popText('NEAR MISS!', '#ffb84a');
          if (navigator.vibrate) navigator.vibrate(12);
        }
      }
    }

    const pursuit = !!MODES[this.modeIndex].pursuit;
    this.rivals.rivals.forEach((r, i) => {
      const gap = r.s - p.s;
      const prev = this.prevGap[i];
      const crossed = Math.sign(gap) !== Math.sign(prev) && Math.abs(gap) < 8;
      this.prevGap[i] = gap;
      if (!crossed || pursuit) return; // dodging the cop is just Tuesday
      // clean pass — rival was ahead, now behind, at speed = OVERTAKE
      if (prev > 0 && gap < 0 && p.v > 20 && p.tumbleT <= 0) this.audio.play('overtake');
      const dx = Math.abs(r.x - p.x);
      if (
        dx > 1.6 && dx < 3.4 && p.v > 20 &&
        p.tumbleT <= 0 && r.tumbleT <= 0 && elapsed - this.lastBumpAt > 1
      ) {
        this.style.nearMiss();
        this.ui.popText('NEAR MISS!', '#ffb84a');
        if (navigator.vibrate) navigator.vibrate(15);
      } else if (
        prev < 0 && gap > 0 && r.tumbleT <= 0 && this.raceTime > 4 &&
        elapsed - this.lastPassedAt > 2.5
      ) {
        // a rival got by — put a name on it so the fight has someone to hate
        this.lastPassedAt = elapsed;
        this.ui.popText(`${r.name} GETS BY!`, '#ff5a5a');
      }
    });
  }

  /** Record this run; replay the circuit's best as a see-through pace car. */
  private updateGhost(dt: number): void {
    this.ghostRec?.sample(dt, this.player.s, this.player.x);
    if (!this.ghostObj || !this.ghostData) return;
    const pos = ghostPos(this.ghostData, this.raceTime);
    if (!pos) {
      this.ghostObj.visible = false; // its race is over
      return;
    }
    this.ghostObj.visible = true;
    this.track.place(this.ghostObj, pos.s, pos.x);
    this.ghostObj.rotation.y += Math.PI; // cars face +z; flip down-track
  }

  private simulateContacts(dt: number, elapsed: number): void {
    const p = this.player;
    const ws = this.track.wrap(p.s);
    const mode = MODES[this.modeIndex];

    // rival-to-rival jostling: when two AI cars overlap, the slower one
    // gets shoved sideways. This makes the pack fight for position instead
    // of ghosting through each other.
    const rivals = this.rivals.rivals;
    for (let a = 0; a < rivals.length; a++) {
      for (let b = a + 1; b < rivals.length; b++) {
        const ra = rivals[a], rb = rivals[b];
        if (ra.tumbleT > 0 || rb.tumbleT > 0) continue;
        if (Math.abs(ra.s - rb.s) < 3.5 && Math.abs(ra.x - rb.x) < 1.6) {
          const dir = Math.sign(ra.x - rb.x) || 1;
          const faster = ra.v >= rb.v ? ra : rb;
          const slower = faster === ra ? rb : ra;
          // shove the slower one aside
          slower.x += dir * (slower === rb ? -1 : 1) * 0.8 * dt * 10;
          slower.v *= 0.97;
          // the faster one nudges slightly the other way
          faster.x -= dir * (faster === ra ? -1 : 1) * 0.3 * dt * 10;
        }
      }
    }

    // car-to-car contact. Grand Prix: trade paint. Burnout: the faster car
    // deals damage — three hits inside the decay window rolls the victim.
    // Cop Chase: every cop touch is heat; heat 3 = BUSTED, race over.
    const burnout = mode.tumble;
    for (const r of this.rivals.rivals) {
      if (Math.abs(r.s - p.s) < 3.8 && Math.abs(r.x - p.x) < 1.8 && p.canBump) {
        if ((burnout || mode.pursuit) && (p.tumbleT > 0 || r.tumbleT > 0)) continue;
        if (mode.pursuit) {
          const dir = Math.sign(p.x - r.x) || 1;
          p.bump(dir, 2.4); // PIT tap: scrubs speed but keeps you on the road
          p.v *= 0.85;
          this.style.crash();
          this.lastBumpAt = elapsed;
          p.damage++;
          p.lastHitAt = elapsed;
          if (p.damage >= 3) {
            p.wreck();
            this.busted = true;
            this.cinematic(p.s, 'BUSTED');
            this.finishRace();
          } else {
            this.ui.popText(`HEAT ${p.damage}/3 — SHAKE THEM!`, '#ff8a3d');
            this.audio.play('bump');
            this.shake = 0.9;
            if (navigator.vibrate) navigator.vibrate(80);
          }
          continue;
        }
        const dir = Math.sign(p.x - r.x) || 1;
        // Racing contact is directional: whoever drives into the back of the
        // other car pays, and door to door both get shoved apart. A flat 28%
        // loss for every touch turned a fierce field into a penalty box.
        const ds = r.s - p.s;
        const rammedByRival = !burnout && ds < -1.6;
        const rammedRival = !burnout && ds > 1.6;
        if (burnout) p.bump(dir);
        else p.bump(dir, rammedRival ? 4 : 5, rammedRival ? 0.8 : rammedByRival ? 0.97 : 0.93);
        r.v *= burnout ? 0.8 : rammedByRival ? 0.82 : rammedRival ? 0.98 : 0.93;
        r.x -= dir * (burnout ? 2.0 : 1.2);
        this.lastBumpAt = elapsed;
        if (mode.heist && r === this.rivals.rivals[0]) {
          this.bonusScore += 50;
          this.coins += 5;
          this.ui.popText('HEIST LOOT +$50!', '#00ffcc');
          this.audio.play('coin');
        }
        // Grand Prix wants clean racing — trading paint drops the style chain,
        // unless a rival ran into you. In Burnout contact IS the game; only
        // TAKING a hit breaks it (below).
        if (!burnout && !rammedByRival) this.style.crash();
        this.audio.play('bump');
        this.shake = 0.7;
        if (navigator.vibrate) navigator.vibrate(60);

        if (burnout) {
          if (p.v >= r.v) {
            // nitro contact is an instant takedown — save the tank, slam the pack
            r.damage += p.nitroActive ? 3 : 1;
            r.lastHitAt = elapsed;
            if (r.damage >= 3) {
              this.rivals.wreck(r);
              this.takedowns++;
              this.style.stoke(0.5);
              if (mode.heist && r === this.rivals.rivals[0]) {
                this.bonusScore += 1000;
                p.nitroTanks += 2;
                this.ui.popText('HEIST BOSS TAKEDOWN! +1000 & 2x NITRO!', '#ffe93b');
              } else {
                this.ui.popText(`TAKEDOWN! ${r.name} +150`, '#ff8a3d');
              }
              this.audio.play('combo');
              this.cinematic(r.s, `TAKEDOWN · ${r.name}`);
            }
          } else {
            p.damage++;
            p.lastHitAt = elapsed;
            this.style.crash();
            if (p.damage >= 3) {
              p.wreck();
              this.cinematic(p.s, 'WRECKED');
            }
          }
        }
      }
    }

    // pickups
    const got = this.entities.tryCollect(ws, p.x);
    if (got.coins > 0) {
      this.coins += got.coins;
      this.audio.play('coin');
    }
    if (got.nitro > 0) {
      // Gun Run reads those canisters as ammo crates; everyone else as nitro
      if (mode.guns && !mode.pursuit) {
        this.ammo += 4 * got.nitro;
        this.gun.setAmmo(Math.floor(this.ammo));
        this.audio.play('combo');
        this.ui.popText('AMMO +4', '#ff8a3d');
      } else {
        p.nitroTanks += got.nitro;
        if (mode.voltage) {
          p.voltageLevel = Math.min(100, p.voltageLevel + 35);
        }
        this.audio.play('combo');
        this.ui.popText('NITRO TANK +1', '#7fd4ff');
      }
    }
  }

  private updateHud(): void {
    const ahead = this.rivals.rivals.filter((r) => r.s > this.player.s).length;
    const total = this.raceLaps * this.track.length;
    this.ui.updateHud(
      1 + ahead,
      this.rivals.rivals.length + 1,
      this.raceTime,
      this.coins,
      this.player.nitroTanks,
      this.player.nitroActive,
      this.player.v,
      Math.min(this.raceLaps, Math.max(1, this.lapsDone + 1)),
      this.raceLaps,
      [
        Math.max(0, this.player.s / total),
        ...this.rivals.rivals.map((r) => Math.max(0, r.s / total))
      ],
      this.style.mult,
      this.style.gauge
    );
  }

  /**
   * District identity lives in local geometry now, so crossing a boundary only
   * announces itself. Recoloring the whole world here made asphalt, shadows and
   * the horizon change mid-turn.
   */
  private announceDistrict(s: number): void {
    const di = districtIndexAt(s, this.track.length);
    if (this.state !== 'racing' || di === this.lastDistrict) return;
    const b = MAPS[this.mapIndex].districts[di];
    // 0 coincides with the lap pop, so it stays silent
    if (di > 0 && this.lastDistrict >= 0) this.ui.popText(b.label.toUpperCase(), '#fff');
    this.lastDistrict = di;
  }

  private updateCamera(dt: number): void {
    if (this.state === 'menu') {
      this.menuCamera(dt);
      return;
    }
    this.setViewLift(0); // racing frames the road centred, never lens-shifted
    const p = this.player;

    if (this.state === 'finished' && !this.busted) {
      // A trackside camera follows the real car just after the final crossing.
      // The race result is already fixed; intermediate laps keep the chase view.
      const progress = Math.min(1, this.finishT / 3.2);
      const line = this.raceLaps * this.track.length;
      const f = this.track.frame(line + 20 - progress * 8);
      const car = this.track.frame(p.s);
      this.camera.position.set(f.x + f.nx * (18 - progress * 7), 4.8, f.z + f.nz * (18 - progress * 7));
      this.camera.lookAt(car.x + car.nx * p.x * 0.8, 1.8, car.z + car.nz * p.x * 0.8);
      this.camera.fov = 58;
      this.camera.updateProjectionMatrix();
      this.ground.position.set(this.camera.position.x, this.ground.position.y, this.camera.position.z);
      this.syncSky(this.camera.position.x, this.camera.position.z);
      return;
    }

    if (this.cine.t > 0) {
      // Low and close, off to the side, looking back into the impact.
      const f = this.track.frame(this.cine.s);
      const k = 1 - this.cine.t / 0.85; // pushes in over the shot
      this.camera.position.set(
        f.x + f.nx * 7.5 - Math.sin(f.theta) * (9 - k * 4),
        1.5 + k * 0.8,
        f.z + f.nz * 7.5 - Math.cos(f.theta) * (9 - k * 4)
      );
      this.camera.lookAt(f.x, 0.8, f.z);
      this.camera.fov = THREE.MathUtils.lerp(48, 40, k);
      this.camera.updateProjectionMatrix();
      this.ground.position.set(this.camera.position.x, this.ground.position.y, this.camera.position.z);
      this.syncSky(this.camera.position.x, this.camera.position.z);
      return;
    }

    // glide between camera modes rather than snapping
    const m = MAPS[this.mapIndex].id === 'lagos' && this.camMode === 0
      ? { back: 7.2, h: 3.7, ahead: 15, fov: 63 }
      : CAMS[this.camMode];
    this.cam.back = THREE.MathUtils.damp(this.cam.back, m.back, 4, dt);
    this.cam.h = THREE.MathUtils.damp(this.cam.h, m.h, 4, dt);
    this.cam.ahead = THREE.MathUtils.damp(this.cam.ahead, m.ahead, 4, dt);
    this.cam.fov = THREE.MathUtils.damp(this.cam.fov, m.fov, 4, dt);

    const back = this.track.frame(p.s - this.cam.back);
    const ahead = this.track.frame(p.s + this.cam.ahead);
    const lat = p.x * 0.55;
    const speedZoom = this.player.nitroActive ? 0.9 : 0;

    let cx = back.x + back.nx * lat;
    let cz = back.z + back.nz * lat;
    let cy = this.cam.h + speedZoom * 0.4;
    if (this.shake > 0.002) {
      this.shake *= Math.exp(-6 * dt);
      cx += (Math.random() - 0.5) * this.shake;
      cy += (Math.random() - 0.5) * this.shake * 0.5;
    }
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(ahead.x + ahead.nx * p.x * 0.3, 1.1, ahead.z + ahead.nz * p.x * 0.3);

    // keep the ground carpet and sky dome under/around the action
    this.ground.position.x = back.x;
    this.ground.position.z = back.z;
    this.syncSky(cx, cz);

    // FOV: camera-mode base + speed stretch + nitro punch
    const targetFov = this.cam.fov + p.v * 0.12 + (p.nitroActive ? 9 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 6, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  /** Off-axis projection shift, in screen pixels; 0 restores a centred view. */
  private setViewLift(px: number): void {
    if (Math.abs(px - this.viewOffset) < 0.5) return;
    this.viewOffset = px;
    const w = window.innerWidth, h = window.innerHeight;
    if (px === 0) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, 0, px, w, h);
  }

  /**
   * Menu-family cameras, all gliding through the same damped mover so page
   * changes feel like one continuous shot: parked chase view on the menu,
   * a slow turntable around the car in the garage, a low cinematic flyby
   * along the circuit on the World Tour page.
   */
  private menuCamera(dt: number): void {
    this.orbitT += dt;
    const p = this.player;
    let pos: THREE.Vector3;
    let look: THREE.Vector3;
    let fov: number;

    if (this.uiScene === 'garage') {
      const f = this.track.frame(p.s);
      const cx = f.x + f.nx * p.x, cz = f.z + f.nz * p.x;
      const a = this.orbitT * 0.45;
      // portrait crops the sides hard, so orbit wide to keep the car in frame
      pos = new THREE.Vector3(
        cx + Math.sin(a) * 11.5,
        3.0 + Math.sin(this.orbitT * 0.31) * 0.6,
        cz + Math.cos(a) * 11.5
      );
      look = new THREE.Vector3(cx, 0.0, cz);
      fov = 52;
    } else if (this.uiScene === 'tour') {
      this.tourS += dt * 30;
      const b = this.track.frame(this.tourS - 9);
      const a = this.track.frame(this.tourS + 15);
      pos = new THREE.Vector3(b.x, 5.2, b.z);
      look = new THREE.Vector3(a.x, 1.2, a.z);
      fov = 60;
    } else {
      // mirrors the race chase cam so the countdown handoff is seamless
      const lat = p.x * 0.55;
      const back = this.track.frame(p.s - this.cam.back);
      const ahead = this.track.frame(p.s + this.cam.ahead);
      pos = new THREE.Vector3(back.x + back.nx * lat, this.cam.h, back.z + back.nz * lat);
      look = new THREE.Vector3(ahead.x + ahead.nx * p.x * 0.3, 1.1, ahead.z + ahead.nz * p.x * 0.3);
      fov = this.cam.fov;
    }

    // Lens-shift the garage turntable up into the clear band. Offsetting the
    // projection keeps the camera pointed at the car, so the hero angle is
    // unchanged — only where it lands on screen moves.
    this.setViewLift(this.uiScene === 'garage' ? this.garageLift() : 0);

    const k = 1 - Math.exp(-3.2 * dt);
    this.camera.position.lerp(pos, k);
    this.camLook.lerp(look, k);
    this.camera.lookAt(this.camLook);
    if (Math.abs(this.camera.fov - fov) > 0.1) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, fov, 3.2, dt);
      this.camera.updateProjectionMatrix();
    }
    this.ground.position.x = this.camera.position.x;
    this.ground.position.z = this.camera.position.z;
    this.syncSky(this.camera.position.x, this.camera.position.z);
  }
}
