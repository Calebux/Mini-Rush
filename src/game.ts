import * as THREE from 'three';
import { AssetLibrary } from './assets';
import { AudioManager } from './audio';
import { CARS } from './cars';
import { districtIndexAt, TRACK_LENGTH_DEFAULT } from './constants';
import { dailyMapIndex, dailySeed } from './daily';
import { deposit, racePayout } from './economy';
import { Entities } from './entities';
import {
  GhostData, GhostRecorder, ghostKey, ghostMesh, ghostPos, loadGhost, saveGhost
} from './ghost';
import { GunHud } from './gun';
import { StyleMeter } from './style';
import { MAPS } from './maps';
import { MODES } from './modes';
import { mapUnlocked, stamp } from './passport';
import { captureReferrer, creditReferral, getReferrer } from './referral';
import { activeColor } from './skins';
import { applyUpgrades } from './upgrades';
import { Rival } from './rivals';
import { InputManager } from './input';
import { Player } from './player';
import { RivalManager } from './rivals';
import { Scenery } from './scenery';
import { buildSkyline } from './skyline';
import { SmokePool } from './smoke';
import { recordLocalRace } from './stats';
import { checkReward, recordDay } from './streak';
import { toonMat } from './toon';
import { Track } from './track';
import { UI } from './ui';
import { Wallet } from './wallet';
import { rollWeather, WeatherSpec } from './weather';
import { claimWeeklyPrize, weeklyMapIndex, weeklyModeIndex, weeklySeed } from './weekly';

type State = 'boot' | 'menu' | 'countdown' | 'racing' | 'finished';

// P1 gets 400, last gets 0, linear in between — works for any grid size
const placeBonus = (place: number, total: number): number =>
  Math.round(400 * Math.max(0, 1 - (place - 1) / Math.max(1, total - 1)));

// chase / low bumper / high TV — cycled with the 📷 button or C key
const CAMS = [
  { back: 8.5, h: 6.1, ahead: 13, fov: 66 },
  { back: 5.2, h: 2.9, ahead: 11, fov: 75 },
  { back: 14.0, h: 11.0, ahead: 19, fov: 57 }
];

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  // Adaptive render resolution — holds ~60fps on weak GPUs by trading pixels
  // under load (horde draw-call spikes) and reclaiming them when there's slack.
  private dprCap = Math.min(window.devicePixelRatio, 2);
  private curDpr = Math.min(window.devicePixelRatio, 2);
  private frameEma = 1 / 60; // smoothed frame time (s)
  private dprCooldown = 0;    // frames to wait between resolution changes
  private hemi: THREE.HemisphereLight;
  private ground: THREE.Mesh;
  private groundMat: THREE.MeshToonMaterial;
  private sky!: THREE.Group;
  private skyMat!: THREE.ShaderMaterial;
  private skyline: THREE.Mesh | null = null;

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
  private zombiesSquashed = 0;
  private zombieCombo = 0;
  private zombieScore = 0;
  private lastSquashAt = -10;
  private shake = 0;
  private seedCounter: number;
  private trackLength: number;
  private laps = 2;
  private raceLaps = 2; // laps actually raced (mode may lock the pick)
  private carIndex = 0;
  private mapIndex = 0;
  private modeIndex = 0;
  private takedowns = 0;
  private busted = false;
  private lastDistrict = -1;
  private gun!: GunHud;
  private ammo = 0;
  private gunCooldown = 0;
  private ammoWarnAt = -10;
  private latchedZombies = 0;
  private latchMeshes: THREE.Object3D[] = [];
  // menu-family camera: which page is up, turntable angle, flyby distance
  private uiScene: 'menu' | 'garage' | 'tour' = 'menu';
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

  private style = new StyleMeter();
  private prevGap: number[] = []; // rival s-gaps last frame — sign flip = a pass
  private lastBumpAt = -10;       // trades paint ≠ a near miss
  private daily = false;
  private preDaily = { seed: 0, map: 0, mode: 0, laps: 2 }; // restored afterwards
  private weekly = false;
  private preWeekly = { seed: 0, map: 0, mode: 0, laps: 2 }; // restored afterwards
  private raceSeed = 0;           // seed this race was actually built from
  private ghostRec: GhostRecorder | null = null;
  private ghostData: GhostData | null = null;
  private ghostObj: THREE.Group | null = null;

  // --- new features ---
  private driftChain = 0;           // seconds of continuous drift
  private driftBestThisRace = 0;    // longest single chain this race
  private bossKillsThisRace = 0;
  private weather: WeatherSpec | null = null;
  private rainOverlay: HTMLElement | null = null;
  private weatherLabel: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    // debug/test handle (crashcheck.mjs pokes at physics through this)
    (window as unknown as { __game: Game }).__game = this;
    captureReferrer();
    const qp = new URLSearchParams(location.search);
    this.trackLength = Number(qp.get('len')) || TRACK_LENGTH_DEFAULT;
    this.seedCounter = Number(qp.get('seed')) || Math.floor(Math.random() * 1e9);
    this.laps = Number(qp.get('laps')) || 2;
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

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    const map = MAPS[this.mapIndex];
    const d0 = map.districts[0];
    this.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 300);
    this.scene.background = new THREE.Color(d0.skyTop);
    this.scene.fog = new THREE.Fog(d0.fog, map.fogNear, map.fogFar);
    this.sky = this.buildSky();
    this.scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(d0.hemi, 0x30364a, 1.15);
    this.scene.add(this.hemi);
    this.groundMat = toonMat(d0.ground);
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.5);
    sun.position.set(8, 18, 6);
    this.scene.add(sun);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), this.groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.05;
    this.scene.add(this.ground);

    this.smoke = new SmokePool(this.scene);

    this.ui = new UI(this.wallet, this.audio);
    this.ui.setLaps(this.laps);
    this.ui.setCar(this.carIndex);
    this.ui.setMap(this.mapIndex);
    this.ui.setMode(this.modeIndex);
    this.ui.onPlay = () => this.startRace();
    this.ui.onRetrySame = () => this.retrySameTrack();
    this.ui.onLaps = (n) => (this.laps = n);
    this.ui.onCar = (i) => this.setCar(i);
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

    this.gun = new GunHud(document.getElementById('hud')!);

    this.input = new InputManager(document.body);
    this.input.onTap = () => this.onTap();
    this.input.onCamera = () => this.cycleCamera();
    this.input.onNitroKey = () => this.boostNitro();
    this.ui.onBrake = (down) => (this.input.uiBrake = down);
    this.ui.onGas = (down) => (this.input.uiGas = down);
    this.ui.onCamera = () => this.cycleCamera();
    this.ui.onNitroPress = () => this.boostNitro();

    window.addEventListener('resize', () => this.onResize());

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

    void this.assets.load().then(() => {
      this.buildRace();
      this.state = 'menu';
      this.renderer.setAnimationLoop(() => this.tick());
    });
  }

  /** Gradient sky dome + retro sun disc; follows the camera on x/z. */
  private buildSky(): THREE.Group {
    const g = new THREE.Group();
    const d0 = MAPS[this.mapIndex].districts[0];
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color(d0.skyTop) },
        bottom: { value: new THREE.Color(d0.skyBottom) }
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
          // uniforms arrive linear; renderer expects sRGB from raw shaders
          gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
        }`,
      side: THREE.BackSide,
      depthWrite: false
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(250, 24, 12), this.skyMat);
    dome.renderOrder = -3;
    dome.frustumCulled = false;
    g.add(dome);

    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(32, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffc46a, transparent: true, opacity: 0.35, depthWrite: false, fog: false
      })
    );
    glow.position.set(55, 80, -180).multiplyScalar(1.05);
    glow.lookAt(0, 5, 0);
    glow.renderOrder = -2;
    g.add(glow);

    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(24, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe9a3, depthWrite: false, fog: false })
    );
    sun.position.set(55, 80, -180);
    sun.lookAt(0, 5, 0);
    sun.renderOrder = -1;
    g.add(sun);
    return g;
  }

  // keep the sun hanging over the road ahead, outrun-style
  private syncSky(cx: number, cz: number, theta: number, dt: number): void {
    this.sky.position.set(cx, 0, cz);
    let d = -theta - this.sky.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d)); // shortest way around
    this.sky.rotation.y += d * Math.min(1, dt * 1.5);
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
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
      seed: this.seedCounter, map: this.mapIndex, mode: this.modeIndex, laps: this.laps
    };
    this.seedCounter = weeklySeed();
    this.mapIndex = weeklyMapIndex(MAPS.length);
    this.modeIndex = weeklyModeIndex(MODES.length);
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
    this.ui.setMap(this.mapIndex);
    this.ui.setMode(this.modeIndex);
    if (this.state === 'menu') {
      this.disposeRace();
      this.buildRace();
    }
  }

  private buildRace(): void {
    const seed = this.seedCounter;
    this.raceSeed = seed;
    const map = MAPS[this.mapIndex];
    const mode = MODES[this.modeIndex];
    this.track = new Track(seed, this.trackLength, map);

    // weather
    this.weather = rollWeather(map.id, seed);
    const fogNear = map.fogNear * this.weather.fogMul;
    const fogFar = map.fogFar * this.weather.fogMul;
    (this.scene.fog as THREE.Fog).near = fogNear;
    (this.scene.fog as THREE.Fog).far = fogFar;

    // rain overlay
    if (!this.rainOverlay) {
      this.rainOverlay = document.getElementById('rain-overlay');
    }
    if (this.rainOverlay) {
      this.rainOverlay.style.opacity = String(this.weather.rainIntensity);
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
      this.skyline = null;
    }
    if (map.skyline) {
      this.skyline = buildSkyline(map.skyline, map.districts.map((d) => d.skyBottom));
      this.sky.add(this.skyline);
    }
    this.scenery = new Scenery(this.scene, this.track, this.assets, seed, map);
    this.entities = new Entities(
      this.scene, this.track, this.assets, seed, map, mode.zombieMul, !!mode.latchers
    );
    this.player = new Player(this.scene, this.assets, this.track, this.carSpec(this.carIndex));
    this.rivals = new RivalManager(
      this.scene, this.assets, this.track, CARS[this.carIndex].model,
      mode.rivals, mode.pursuit
    );
    // weather grip modifier applies to the whole field, so bad weather slows
    // the player and the AI alike (no rubber-band advantage in the rain)
    if (this.weather && this.weather.gripMul !== 1) {
      this.player.gripMul = this.weather.gripMul;
      this.rivals.gripMul = this.weather.gripMul;
    }
    this.resetGrid();
    this.ui.setRacers(mode.rivals + 1);
    this.ui.drawTrackMap(this.track.outline(), map.districts.map((d) => d.skyBottom));
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
    return { ...applyUpgrades(CARS[i]), color: activeColor(CARS[i].id) };
  }

  /** Garage pick: persist, and swap the parked car live while in the menu. */
  private setCar(i: number): void {
    this.carIndex = i;
    localStorage.setItem('minirush.car', String(i));
    if (this.state === 'menu') {
      this.scene.remove(this.player.mesh);
      this.player = new Player(this.scene, this.assets, this.track, this.carSpec(i));
      this.player.reset({ s: -6, x: -2 });
    }
  }

  /** Tour stop pick: persist, and rebuild the menu backdrop in the new city. */
  private setMap(i: number): void {
    this.mapIndex = i;
    localStorage.setItem('minirush.map', MAPS[i].id);
    if (this.state === 'menu') {
      this.disposeRace();
      this.buildRace();
    }
  }

  /** Mode pick: persist, and rebuild so the menu grid shows the new field. */
  private setMode(i: number): void {
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
    this.scene.remove(this.player.mesh);
    for (const r of this.rivals.rivals) this.scene.remove(r.mesh);
    if (this.ghostObj) {
      this.scene.remove(this.ghostObj);
      this.ghostObj = null;
    }
  }

  private resetGrid(): void {
    // Cop Chase: you get a head start, the law lines up in your mirrors
    if (MODES[this.modeIndex].pursuit) {
      this.player.reset({ s: 0, x: -2 });
      this.rivals.reset([{ s: -10, x: 2 }]);
      return;
    }
    // rows of two, player in the last slot so overtaking feels earned
    const total = this.rivals.rivals.length + 1;
    const slot = (i: number) => ({ s: -6 * Math.floor(i / 2), x: i % 2 === 0 ? 2 : -2 });
    this.player.reset(slot(total - 1));
    this.rivals.reset(this.rivals.rivals.map((_, i) => slot(i)));
  }

  private startRace(): void {
    this.audio.play('click');
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
    void this.audio.playMusic('race');
    this.raceTime = 0;
    this.playerTime = 0;
    this.coins = 0;
    this.zombiesSquashed = 0;
    this.zombieCombo = 0;
    this.zombieScore = 0;
    this.takedowns = 0;
    this.busted = false;
    this.lastSquashAt = -10;
    this.shake = 0;
    this.lastDistrict = -1;
    this.driftChain = 0;
    this.driftBestThisRace = 0;
    this.bossKillsThisRace = 0;
    this.ui.showDrift(null);
    const mode = MODES[this.modeIndex];
    this.ammo = mode.guns ? 8 : 0;
    this.gunCooldown = 0;
    this.ammoWarnAt = -10;
    this.clearLatchedZombies();
    this.gun.setVisible(!!mode.guns);
    this.gun.setAmmo(this.ammo);
    this.player.infected = false;
    this.player.voltageMode = !!mode.voltage;
    this.player.voltageLevel = 100;

    this.style.reset();
    this.lastBumpAt = -10;
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

    this.ui.showRace();
  }

  private currentGhostKey(): string {
    return ghostKey(
      this.raceSeed, MAPS[this.mapIndex].id, MODES[this.modeIndex].id,
      this.raceLaps, this.trackLength
    );
  }

  /** Tap = shoot in gun modes; otherwise tap = nitro, as ever. */
  private onTap(): void {
    if (this.state !== 'racing') return;
    if (MODES[this.modeIndex].guns) {
      this.shoot();
      return;
    }
    this.boostNitro();
  }

  private boostNitro(): void {
    if (this.state !== 'racing') return;
    if (this.player.fireNitro()) {
      this.audio.play('nitro');
      this.ui.popText('NITRO!', '#7fd4ff');
    }
  }

  /**
   * Hitscan straight up the current lane — the first thing inside the
   * corridor eats the bullet. Zombies splat into the combo chain; in Gun Run
   * a rival takes a tire shot and rolls; in Cop Chase the cruiser is
   * indestructible but gets knocked off your bumper.
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
    this.gun.setAmmo(this.ammo);
    this.audio.play('shot');
    if (navigator.vibrate) navigator.vibrate(15);

    if (MODES[this.modeIndex].latchers && this.latchedZombies > 0) {
      this.knockOffLatched(1);
      this.ui.popText('SHAKEN OFF!', '#a3ff2e');
      this.style.stoke(0.18);
      return;
    }

    const elapsed = this.clock.elapsedTime;
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

    // anything shambling in front of the car soaks it up first (forward fire)
    const ws = this.track.wrap(p.s);
    const zHit = rear
      ? null
      : this.entities.tryShoot(ws + 2, ws + (hitS - p.s), p.x, elapsed);
    if (zHit) {
      if (elapsed - this.lastSquashAt > 4) this.zombieCombo = 0;
      this.lastSquashAt = elapsed;
      this.zombieCombo++;
      this.zombieScore += 15 * this.zombieCombo;
      this.zombiesSquashed++;
      this.audio.play('squish');
      this.ui.popText(`SPLAT x${this.zombieCombo}`, '#7fae5a');
      const f = this.track.frame(zHit.s);
      this.smoke.spawn(f.x + f.nx * zHit.x, 0.7, f.z + f.nz * zHit.x, 0x7fae5a, 0.6);
      return;
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
      this.ui.popText(`LAP ${done + 1}/${this.raceLaps}`, '#fcff52');
      this.audio.play('go');
      this.entities.beginLap(); // fresh zombies and pickups every lap
    }
  }

  private finishRace(): void {
    this.state = 'finished';
    this.finishT = 0;
    this.playerTime = this.raceTime;
    // Cop Chase isn't a footrace against the cop — you escaped or you didn't
    this.playerPlace = MODES[this.modeIndex].pursuit
      ? (this.busted ? 2 : 1)
      : 1 + this.rivals.rivals.filter(
          (r) => r.finishTime >= 0 && r.finishTime < this.raceTime
        ).length;
    this.audio.play('finish');
    if (navigator.vibrate) navigator.vibrate([40, 60, 120]);
    this.ui.endTutorial();
    this.audio.stopEngine();
    void this.audio.playMusic('menu');

    // pay out any remaining drift chain
    if (this.driftChain > 0.5) {
      const driftPts = Math.floor(this.driftChain * 40);
      this.zombieScore += driftPts;
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
      zombies: this.zombiesSquashed,
      laps: this.raceLaps
    });
    this.coins += payout;
    if (payout > 0) setTimeout(() => this.ui.popText(`+${payout} COINS`, '#fcff52'), 1600);
    deposit(this.coins); // race coins bank for the garage

    // Record local stats
    recordLocalRace({
      place: this.playerPlace,
      score: this.score(),
      zombies: this.zombiesSquashed,
      coins: this.coins,
      modeId: MODES[this.modeIndex].id,
      mapId: MAPS[this.mapIndex].id,
      driftBest: this.driftBestThisRace,
      bossKills: this.bossKillsThisRace
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

    // Referral: credit local coins on first race, and record the referrer
    // on-chain once (V2 only; fails soft otherwise).
    if (creditReferral()) {
      const referrer = getReferrer();
      if (referrer) void this.wallet.recordReferral(referrer);
      setTimeout(() => {
        this.ui.popText('🎉 REFERRAL BONUS +50 COINS!', '#fcff52');
      }, 3000);
    }

    // Count the race on-chain (Celo). Fire-and-forget, fails soft in plain
    // browsers or when no tracker contract is configured.
    void this.wallet.recordRace({
      score: this.score(),
      place: this.playerPlace,
      mapId: this.mapIndex,
      modeId: this.modeIndex
    });

    if (!this.busted && this.ghostRec) {
      const beat = saveGhost(
        this.currentGhostKey(),
        this.ghostRec.data(this.carIndex, this.playerTime, this.score())
      );
      if (beat && this.ghostData) this.ui.popText('GHOST BEATEN!', '#9adfff');
    }
    // the daily circuit stays put all day; normal play moves to a fresh one
    if (!this.daily) this.seedCounter++;
  }

  /** Retry the exact same track (same seed). */
  private retrySameTrack(): void {
    this.seedCounter = this.raceSeed;
    this.startRace();
  }

  private score(): number {
    return Math.round(
      this.zombieScore + this.coins * 10 + this.takedowns * 150 + this.style.score +
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
    if (this.state !== 'racing') return;
    this.frameEma += (dt - this.frameEma) * 0.1;
    if (this.dprCooldown > 0) { this.dprCooldown--; return; }
    const fps = 1 / this.frameEma;
    const MIN = 0.75, STEP = 0.25;
    let next = this.curDpr;
    if (fps < 50 && this.curDpr > MIN) next = Math.max(MIN, this.curDpr - STEP);
    else if (fps > 58 && this.curDpr < this.dprCap) next = Math.min(this.dprCap, this.curDpr + STEP);
    if (next !== this.curDpr) {
      this.curDpr = next;
      this.renderer.setPixelRatio(next);
      this.dprCooldown = 90; // ~1.5s before the next change
    }
  }

  private tick(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;
    this.adaptResolution(dt);
    const dragPx = this.input.consumeDrag();

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
        if (this.latchedZombies > 0) {
          this.player.v *= Math.exp(-this.latchedZombies * 0.16 * dt);
        }
        // engine pitch rides the speedo; nitro shoves it into the red
        this.audio.engine(
          0.55 + (this.player.v / 55) * (this.player.nitroActive ? 1.15 : 0.95),
          0.1 + Math.min(0.16, this.player.v / 300)
        );
        this.handleWall(elapsed);
        this.rivals.update(
          dt, elapsed, this.raceTime, this.player.s, true,
          this.player.x, MODES[this.modeIndex].aggression, this.player.v,
          this.entities
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
        this.updateStyle(dt, elapsed);
        this.updateGhost(dt);
        this.emitSmoke(dt, elapsed);
        this.checkLap();
        const gunMode = MODES[this.modeIndex];
        if (gunMode.guns) {
          this.gunCooldown = Math.max(0, this.gunCooldown - dt);
          if (gunMode.pursuit && this.ammo < 8) {
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
        this.raceTime += dt;
        this.finishT += dt;
        this.player.update(dt, elapsed, 0, 0, false);
        this.rivals.update(dt, elapsed, this.raceTime, this.player.s, true);
        if (this.finishT > 2.0) {
          this.state = 'menu';
          this.ui.showResults(
            this.playerPlace, this.playerTime, this.zombiesSquashed, this.coins,
            this.score(), this.raceLaps, CARS[this.carIndex].name, this.busted,
            this.style.score, this.daily, this.weekly
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
      const focus = this.state === 'menu' && this.uiScene === 'tour'
        ? this.track.wrap(this.tourS)
        : this.track.wrap(this.player.s);
      this.smoke.update(dt);
      this.entities.update(dt, elapsed, focus);
      this.scenery.update(focus);
      this.blendBiome(focus);
      this.updateCamera(dt);
      this.renderer.render(this.scene, this.camera);
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
      this.knockOffLatched(this.latchedZombies);
      p.wreck();
      this.style.crash();
      this.ui.popText('SLAMMED!', '#ff5252');
      this.audio.play('crash');
      this.shake = 1.7;
      if (navigator.vibrate) navigator.vibrate(220);
    } else if (p.wallHit === 1 && p.v > 14) {
      this.knockOffLatched(1);
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
      this.zombieScore += driftPts;
      this.ui.popText(`DRIFT ${this.driftChain.toFixed(1)}s +${driftPts}`, '#ffb84a');
      if (navigator.vibrate) navigator.vibrate(25);
      this.driftChain = 0;
      this.ui.showDrift(null);
    } else {
      this.driftChain = 0;
      this.ui.showDrift(null);
    }
    if (this.style.update(dt)) {
      this.ui.popText(`STYLE ×${this.style.mult}`, '#ffb84a');
      this.audio.play('combo');
      if (navigator.vibrate) navigator.vibrate(30);
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

    // zombies under the wheels
    const squashed = this.entities.trySquash(ws, p.x, elapsed);
    if (squashed > 0) {
      if (mode.latchers) {
        this.addLatchedZombies(squashed);
        p.v = Math.max(8, p.v - 2.2 * squashed);
        this.audio.play('squish');
        this.audio.play('bump', 0.55);
        this.ui.popText(`CLINGERS +${squashed}`, '#a3ff2e');
        if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
      } else {
        if (elapsed - this.lastSquashAt > 4) this.zombieCombo = 0;
        this.lastSquashAt = elapsed;
        for (let i = 0; i < squashed; i++) {
          this.zombieCombo++;
          this.zombieScore += 15 * this.zombieCombo;
        }
        this.zombiesSquashed += squashed;
        this.style.stoke(0.12 * squashed);
        p.v = Math.max(10, p.v - 1.4 * squashed); // gore is not aerodynamic
        this.audio.play(squashed >= 3 ? 'zombie_splat_multi' : 'squish');
        this.ui.popText(`SPLAT x${this.zombieCombo}`, '#7fae5a');
        if (navigator.vibrate) navigator.vibrate(squashed >= 3 ? [20, 15, 20] : 30);

        if (mode.infected && p.infected && this.zombiesSquashed % 10 < squashed) {
          p.infected = false;
          this.ui.popText('VIRUS CURED! EMP SHOCKWAVE!', '#00ffcc');
          this.audio.play('virus_cure');
          for (const r of this.rivals.rivals) {
            if (Math.abs(this.track.wrap(r.s) - this.track.wrap(p.s)) < 24) {
              this.rivals.wreck(r);
            }
          }
        }
      }
    }

    // boss zombie: nitro drive-over is an instant kill, otherwise 3 hits
    const boss = this.entities.trySquashBoss(ws, p.x, elapsed, p.nitroActive);
    if (boss) {
      if (boss.killed) {
        this.zombieScore += 500;
        this.coins += boss.coins;
        this.bossKillsThisRace++;
        this.zombiesSquashed++;
        this.style.stoke(0.4);
        this.shake = Math.max(this.shake, 1.6);
        this.audio.play('crash');
        this.audio.play('combo');
        this.ui.popText('BOSS KILLED! +500', '#ff4a4a');
        if (navigator.vibrate) navigator.vibrate([60, 40, 120]);
      } else {
        p.v = Math.max(9, p.v - 4); // brute shrugs you off
        this.shake = Math.max(this.shake, 0.7);
        this.audio.play('boss_roar');
        this.ui.popText('BOSS HIT!', '#ff8a3d');
        if (navigator.vibrate) navigator.vibrate(45);
      }
    }

    const obstacles = this.entities.tryHitObstacle(ws, p.x);
    if (obstacles > 0) {
      const knocked = this.latchedZombies;
      this.knockOffLatched(Math.max(1, knocked));
      p.v *= knocked > 0 ? 0.72 : 0.58;
      this.style.crash();
      this.audio.play('crash');
      this.audio.play('swoosh', 0.7);
      this.shake = Math.max(this.shake, 1.0);
      this.ui.popText(knocked > 0 ? 'SCRAPED CLEAN!' : 'BARRICADE!', knocked > 0 ? '#a3ff2e' : '#ff8a3d');
      if (navigator.vibrate) navigator.vibrate(knocked > 0 ? [30, 30, 60] : 100);
    }

    // rivals plow through zombies too (no points for robots)
    for (const r of this.rivals.rivals) {
      this.entities.trySquash(this.track.wrap(r.s), r.x, elapsed);
    }

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
            this.ui.popText('BUSTED!', '#ff5252');
            this.audio.play('squish');
            this.shake = 1.7;
            if (navigator.vibrate) navigator.vibrate(240);
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
        p.bump(dir);
        this.knockOffLatched(1);
        r.v *= burnout ? 0.8 : 0.86;
        r.x -= dir * (burnout ? 2.0 : 1.2);
        this.lastBumpAt = elapsed;
        if (mode.heist && r === this.rivals.rivals[0]) {
          this.zombieScore += 50;
          this.coins += 5;
          this.ui.popText('HEIST LOOT +$50!', '#00ffcc');
          this.audio.play('coin');
        }
        if (mode.infected && !p.infected) {
          p.infected = true;
          this.ui.popText('VIRUS INFECTED! SPLAT 10 TO CURE', '#ff5252');
          this.audio.play('squish');
        }
        // Grand Prix wants clean racing — trading paint drops the style chain.
        // In Burnout contact IS the game; only TAKING a hit breaks it (below).
        if (!burnout) this.style.crash();
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
                this.zombieScore += 1000;
                p.nitroTanks += 2;
                this.ui.popText('HEIST BOSS TAKEDOWN! +1000 & 2x NITRO!', '#ffe93b');
              } else {
                this.ui.popText(`TAKEDOWN! ${r.name} +150`, '#ff8a3d');
              }
              this.audio.play('combo');
              this.shake = 1.1;
              if (navigator.vibrate) navigator.vibrate([40, 40, 80]);
            }
          } else {
            p.damage++;
            p.lastHitAt = elapsed;
            this.style.crash();
            if (p.damage >= 3) {
              p.wreck();
              this.ui.popText('WRECKED!', '#ff5252');
              this.audio.play('squish');
              this.shake = 1.7;
              if (navigator.vibrate) navigator.vibrate(220);
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

  private addLatchedZombies(count: number): void {
    for (let i = 0; i < count && this.latchedZombies < 5; i++) {
      const marker = this.buildLatchMarker(this.latchedZombies);
      this.player.mesh.add(marker);
      this.latchMeshes.push(marker);
      this.latchedZombies++;
    }
  }

  private knockOffLatched(count: number): void {
    for (let i = 0; i < count && this.latchMeshes.length > 0; i++) {
      const obj = this.latchMeshes.pop()!;
      obj.removeFromParent();
      this.latchedZombies = Math.max(0, this.latchedZombies - 1);
      const f = this.track.frame(this.player.s - 1);
      this.smoke.spawn(
        f.x + f.nx * (this.player.x + (Math.random() * 2 - 1) * 1.4),
        0.8,
        f.z + f.nz * this.player.x,
        0x7fae5a,
        0.55
      );
    }
  }

  private clearLatchedZombies(): void {
    while (this.latchMeshes.length > 0) this.latchMeshes.pop()!.removeFromParent();
    this.latchedZombies = 0;
  }

  private buildLatchMarker(slot: number): THREE.Group {
    const g = new THREE.Group();
    const zombie = this.assets.zombies[slot % this.assets.zombies.length];
    if (zombie) {
      const z = zombie.clone(true);
      z.visible = true;
      z.scale.multiplyScalar(0.52);
      z.rotation.y = Math.PI;
      g.add(z);
    } else {
      const green = toonMat(0x6fbf4a);
      const dark = toonMat(0x23301f);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.52, 0.32), green);
      body.position.y = 0.28;
      g.add(body);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.3), green);
      head.position.y = 0.78;
      g.add(head);
      for (const x of [-0.32, 0.32]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.42, 0.12), dark);
        arm.position.set(x, 0.38, 0);
        arm.rotation.z = x > 0 ? -0.45 : 0.45;
        g.add(arm);
      }
    }
    const spots = [
      [-0.45, 1.16, -0.35],
      [0.46, 1.12, -0.12],
      [-0.2, 1.24, 0.32],
      [0.22, 1.2, 0.48],
      [0, 1.32, 0]
    ];
    const p = spots[slot % spots.length];
    g.position.set(p[0], p[1], p[2]);
    g.rotation.set(-0.28, slot * 0.9, (slot % 2 ? 1 : -1) * 0.18);
    g.scale.setScalar(0.95);
    return g;
  }

  private updateHud(): void {
    const ahead = this.rivals.rivals.filter((r) => r.s > this.player.s).length;
    const total = this.raceLaps * this.track.length;
    this.ui.updateHud(
      1 + ahead,
      this.rivals.rivals.length + 1,
      this.raceTime,
      this.coins,
      this.zombiesSquashed,
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

  private blendBiome(s: number): void {
    const di = districtIndexAt(s, this.track.length);
    const b = MAPS[this.mapIndex].districts[di];
    // announce mid-lap district crossings (0 coincides with the lap pop)
    if (this.state === 'racing' && di !== this.lastDistrict) {
      if (di > 0 && this.lastDistrict >= 0) this.ui.popText(b.label.toUpperCase(), '#fff');
      this.lastDistrict = di;
    }
    const k = 0.02;
    (this.skyMat.uniforms.top.value as THREE.Color).lerp(new THREE.Color(b.skyTop), k);
    (this.skyMat.uniforms.bottom.value as THREE.Color).lerp(new THREE.Color(b.skyBottom), k);
    (this.scene.background as THREE.Color).lerp(new THREE.Color(b.skyTop), k);
    (this.scene.fog as THREE.Fog).color.lerp(new THREE.Color(b.fog), k);
    this.groundMat.color.lerp(new THREE.Color(b.ground), k);
    this.hemi.color.lerp(new THREE.Color(b.hemi), k);
    this.scenery.tintRoad(new THREE.Color(b.road), k);
  }

  private updateCamera(dt: number): void {
    if (this.state === 'menu') {
      this.menuCamera(dt);
      return;
    }
    const p = this.player;

    // glide between camera modes rather than snapping
    const m = CAMS[this.camMode];
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
    this.syncSky(cx, cz, back.theta, dt);

    // FOV: camera-mode base + speed stretch + nitro punch
    const targetFov = this.cam.fov + p.v * 0.12 + (p.nitroActive ? 9 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 6, dt);
      this.camera.updateProjectionMatrix();
    }
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
    let skyTheta: number;

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
      skyTheta = f.theta;
    } else if (this.uiScene === 'tour') {
      this.tourS += dt * 30;
      const b = this.track.frame(this.tourS - 9);
      const a = this.track.frame(this.tourS + 15);
      pos = new THREE.Vector3(b.x, 5.2, b.z);
      look = new THREE.Vector3(a.x, 1.2, a.z);
      fov = 60;
      skyTheta = this.track.frame(this.tourS).theta;
    } else {
      // mirrors the race chase cam so the countdown handoff is seamless
      const lat = p.x * 0.55;
      const back = this.track.frame(p.s - this.cam.back);
      const ahead = this.track.frame(p.s + this.cam.ahead);
      pos = new THREE.Vector3(back.x + back.nx * lat, this.cam.h, back.z + back.nz * lat);
      look = new THREE.Vector3(ahead.x + ahead.nx * p.x * 0.3, 1.1, ahead.z + ahead.nz * p.x * 0.3);
      fov = this.cam.fov;
      skyTheta = back.theta;
    }

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
    this.syncSky(this.camera.position.x, this.camera.position.z, skyTheta, dt);
  }
}
