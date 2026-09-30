import * as THREE from 'three';
import type { AssetLibrary } from '../assets';
import { disposeCarInstance } from '../assets';
import type { AudioManager } from '../audio';
import type { CarSpec } from '../cars';
import { buildHorizon, buildReflectionSky, disposeHorizon, environmentTheme } from '../environment';
import type { InputManager } from '../input';
import { MAPS } from '../maps';
import { carReflection, lightCars, mapEnvironment } from '../lighting';
import { glow } from '../neonCity';
import { createPostFX, PostFX, savedLook } from '../postfx';
import type { QualityTier } from '../quality';
import { Rain } from '../rain';
import { SmokePool } from '../smoke';
import { CityActivities, cityActivityPoints } from './activities';
import { FareDispatch } from './fares';
import { nextTurn, P, route, routeLength } from './roads';
import { CityDrive } from './drive';
import { PassengerSequence } from './passenger';
import {
  BRIDGE_HALF, BRIDGE_Z, CITY_BLOCKS, CITY_EXTENT, districtAt, EDGE,
  EAST_ISLAND_X0, EAST_ISLAND_X1, EAST_ISLAND_Z0, EAST_ISLAND_Z1,
  HALF, SPAWN, STREET
} from './layout';
import { CityTraffic } from './traffic';
import { CityPolice } from './police';
import { spend } from '../economy';
import { CityWorld } from './world';
import { KadunaWorld } from './kadunaWorld';

export type OpenCity = 'kaduna' | 'neon';

/** How each open city looks and what its places are called. */
const CITY_STYLE = {
  neon: {
    name: 'NEON CITY', night: true, rain: true, themeMap: 'neon',
    sky: ['#05040d', '#1b1236', '#4a2466'], fog: [0x2a1c48, 40, 430] as const,
    hemi: [0x9a8ce6, 0x2a1f48, 1.35] as const, sun: [0xa9b9ff, 1.1] as const,
    districts: { downtown: 'DOWNTOWN', midtown: 'MIDTOWN', market: 'NIGHT MARKET', harbour: 'HARBOUR', plaza: 'PLAZA',
      ring: 'EXPRESSWAY', island: 'EAST ISLAND', bridge: 'EAST FREEWAY' },
    map: { ground: '#0a0d16', water: '#12314a', roads: '#39415a', island: '#263849', rail: '#22e6ff', centre: 'rgba(255,46,154,0.55)',
      blocks: { downtown: '#241a3a', midtown: '#1a2030', market: '#2c1f24', harbour: '#1b2626', plaza: '#18322c' } }
  },
  kaduna: {
    name: 'KADUNA', night: false, rain: false, themeMap: 'lagos',
    sky: ['#7fa9c9', '#c9d4d6', '#e6d3b0'], fog: [0xd8c7a6, 90, 620] as const,
    hemi: [0xf1ecdf, 0x8a6a4a, 1.25] as const, sun: [0xfff1d6, 2.6] as const,
    districts: { downtown: 'AHMADU BELLO WAY', midtown: 'UNGWAN RIMI', market: 'KASUWA', harbour: 'RIVER BANK', plaza: 'MURTALA SQUARE',
      ring: 'EASTERN BYPASS', island: 'SABON TASHA', bridge: 'KADUNA BRIDGE' },
    map: { ground: '#caa77a', water: '#5f7a5c', roads: '#6b6b6b', island: '#b88457', rail: '#d6342b', centre: 'rgba(240,234,217,0.6)',
      blocks: { downtown: '#e2d6bd', midtown: '#d8c9a8', market: '#d6a86a', harbour: '#9fb07f', plaza: '#8fa25a' } }
  }
} as const;
type CityStyle = typeof CITY_STYLE[OpenCity];
import './city.css';

export interface CityDeps {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  assets: AssetLibrary;
  audio: AudioManager;
  input: InputManager;
  spec: CarSpec;
  tier: QualityTier;
  /** free roam (collectibles, street races) or passenger fares */
  mode: 'free' | 'taxi';
  onExit: () => void;
  /** which open city; Kaduna unless told otherwise */
  city?: OpenCity;
}

/**
 * Camera angles, cycled with □ / C / the CAM button. `back` is metres behind
 * the car (negative: in front of its centre), `h` the height; the attached
 * ones ride on the car with no lag.
 */
const CITY_CAMS = [
  // pull: metres the camera backs off per m/s of speed; zoom: degrees of fov per m/s
  { name: 'CHASE', back: 8.2, h: 3.9, ahead: 6, lookH: 1.3, fov: 66, lag: 6, attached: false, pull: 0.035, zoom: 0.18 },
  { name: 'FAR CHASE', back: 13.5, h: 6.4, ahead: 8, lookH: 1.2, fov: 60, lag: 5, attached: false, pull: 0.035, zoom: 0.14 },
  { name: 'LOW', back: 5.2, h: 1.55, ahead: 10, lookH: 1.1, fov: 70, lag: 10, attached: false, pull: 0, zoom: 0.08 },
  { name: 'HOOD', back: -1.1, h: 1.45, ahead: 20, lookH: 1.05, fov: 72, lag: 0, attached: true, pull: 0, zoom: 0.16 },
  { name: 'BUMPER', back: -2.3, h: 0.62, ahead: 20, lookH: 0.6, fov: 76, lag: 0, attached: true, pull: 0, zoom: 0.16 },
  { name: 'TOP DOWN', back: 3, h: 34, ahead: 4, lookH: 0, fov: 55, lag: 4, attached: false, pull: 0, zoom: 0 }
] as const;

const MAP_RANGE = CITY_EXTENT + 34; // metres from the centre the map image covers
const MAP_PX = 640;

/**
 * Free roam: drive anywhere in a neon city. Owns its own scene, so entering
 * and leaving never disturbs the race world waiting behind the menu.
 */
export class CityMode {
  private scene = new THREE.Scene();
  private world: CityWorld | KadunaWorld;
  private style: CityStyle;
  private sun: THREE.DirectionalLight;
  private activities: CityActivities | null;
  private fares: FareDispatch | null;
  private route: P[] = [];
  private routeFor = '';
  private routeTimer = 0;
  private chevrons: THREE.Mesh[] = [];
  private traffic: CityTraffic;
  private police: CityPolice;
  private passenger: PassengerSequence;
  private drive: CityDrive;
  private car: THREE.Group;
  private carFx: THREE.Mesh[] = [];
  private rain: Rain;
  private smoke: SmokePool;
  private postfx: PostFX | null;
  private horizon: THREE.Group;
  private sky = new THREE.Group();
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private shake = 0;
  private camMode = 0;
  // the camera and its target, kept as offsets from the car so speed never adds lag
  private camOffset = new THREE.Vector3(0, 4.5, -9);
  private lookOffset = new THREE.Vector3(0, 1.2, 6);
  private brakeLamp: THREE.Mesh | null = null;
  private reverseLamp: THREE.Mesh | null = null;
  private tailPool: THREE.Mesh | null = null;
  private sprayFlip = false;
  private lastSkid = -10;
  private hud: HTMLElement;
  private mini: CanvasRenderingContext2D;
  private mapImage: HTMLCanvasElement;
  private bigMap: HTMLElement;
  private district = '';
  private districtTimer = 0;

  constructor(private deps: CityDeps) {
    const style = this.style = CITY_STYLE[deps.city ?? 'kaduna'];
    this.world = deps.city === 'neon' ? new CityWorld() : new KadunaWorld(deps.assets);
    const theme = environmentTheme(MAPS.find((m) => m.id === style.themeMap)!);
    this.scene.background = skyGradient(style.sky);
    this.scene.fog = new THREE.Fog(style.fog[0], style.fog[1], style.fog[2]);
    this.scene.environment = buildReflectionSky(theme);
    this.scene.environmentIntensity = style.night ? 1.1 : 0.8;
    this.scene.add(new THREE.HemisphereLight(style.hemi[0], style.hemi[1], style.hemi[2]));
    this.sun = new THREE.DirectionalLight(style.sun[0], style.sun[1]);
    this.sun.position.set(-60, 90, -40);
    if (!style.night) {
      // daylight: a real sun that throws shadows, its shadow box following the car
      this.sun.castShadow = deps.tier > 0;
      this.sun.shadow.mapSize.set(deps.tier > 1 ? 2048 : 1024, deps.tier > 1 ? 2048 : 1024);
      Object.assign(this.sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 260 });
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.05;
    }
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.world.group);
    this.activities = deps.mode === 'free' ? new CityActivities(this.scene) : null;
    this.fares = deps.mode === 'taxi' ? new FareDispatch({ x: SPAWN.x, z: SPAWN.z }, deps.city ?? 'kaduna') : null;
    this.buildChevrons();
    this.traffic = new CityTraffic(this.scene, deps.assets);
    this.police = new CityPolice(this.scene, deps.assets, deps.audio);
    this.horizon = buildHorizon(theme);
    this.sky.add(this.horizon);
    this.scene.add(this.sky);

    this.drive = CityDrive.forSpec(deps.spec);
    this.drive.x = SPAWN.x;
    this.drive.z = SPAWN.z;
    this.drive.yaw = SPAWN.yaw;
    this.car = deps.assets.cloneCar(deps.spec);
    this.scene.add(this.car);
    this.passenger = new PassengerSequence(this.scene, this.car, deps.spec.color, deps.assets.clonePassenger());
    this.addCarLights();
    // the player's car and the traffic reflect the city's neon, not a gradient
    lightCars(this.scene, mapEnvironment(deps.renderer, theme), carReflection(theme));

    this.rain = new Rain(deps.tier === 0 ? 1200 : 2600);
    if (style.rain) this.scene.add(this.rain.object);
    this.smoke = new SmokePool(this.scene, 40);

    this.postfx = createPostFX(deps.renderer, this.scene, deps.camera, deps.tier);
    this.postfx?.setMood(style.night);
    this.postfx?.setLook(savedLook(), style.night);
    this.resize();

    this.mapImage = drawCityMap(style);
    this.hud = buildHud(deps.mode, style.name);
    document.body.appendChild(this.hud);
    this.mini = (this.hud.querySelector('#city-mini') as HTMLCanvasElement).getContext('2d')!;
    this.bigMap = this.hud.querySelector('#city-bigmap') as HTMLElement;
    this.hud.querySelector('#city-exit')!.addEventListener('click', () => deps.onExit());
    this.hud.querySelector('#city-pause-btn')!.addEventListener('click', () => this.togglePause());
    this.hud.querySelector('#city-resume')!.addEventListener('click', () => this.togglePause(false));
    this.hud.querySelector('#city-nitro')!.addEventListener('click', () => this.nitro());
    this.hud.querySelector('#city-gps')!.addEventListener('click', () => this.panelAction());
    this.hud.querySelector('#city-skip')!.addEventListener('click', () => {
      this.fares?.skip({ x: this.drive.x, z: this.drive.z });
      this.deps.audio.play('select');
    });
    const toggleMap = () => this.toggleMap();
    this.hud.querySelector('#city-mini')!.addEventListener('click', toggleMap);
    this.hud.querySelector('#city-map-btn')!.addEventListener('click', toggleMap);
    this.hud.querySelector('#city-cam-btn')!.addEventListener('click', () => this.cycleCamera());
    // the card folds down to one line, and remembers it
    const card = this.hud.querySelector('.city-activity') as HTMLElement;
    const fold = (on: boolean) => {
      card.classList.toggle('collapsed', on);
      this.hud.querySelector('#city-activity-toggle')!.setAttribute('aria-expanded', String(!on));
      try { localStorage.setItem('minirush.city.card', on ? 'folded' : 'open'); } catch { /* this session only */ }
    };
    let folded = false;
    try { folded = localStorage.getItem('minirush.city.card') === 'folded'; } catch { /* default open */ }
    fold(folded);
    this.hud.querySelector('#city-activity-toggle')!.addEventListener('click', () => fold(!card.classList.contains('collapsed')));
    this.foldCard = fold;
    // the drift button is held, like a handbrake lever
    const drift = this.hud.querySelector('#city-drift') as HTMLElement;
    const hold = (on: boolean) => (e: Event) => { e.preventDefault(); deps.input.uiHandbrake = on; drift.classList.toggle('on', on); };
    drift.addEventListener('pointerdown', hold(true));
    for (const end of ['pointerup', 'pointercancel', 'pointerleave']) drift.addEventListener(end, hold(false));
    this.bigMap.addEventListener('click', toggleMap);

    const f = this.drive.forward;
    this.camPos.set(this.drive.x - f.x * 9, 4.5, this.drive.z - f.y * 9);
    this.camLook.set(this.drive.x, 1.2, this.drive.z);
    deps.camera.fov = 66;
    deps.camera.far = 900;
    deps.camera.updateProjectionMatrix();
    deps.audio.startEngine();
  }

  nitro(): void {
    if (this.drive.fireNitro()) {
      this.deps.audio.play('nitro');
      this.shake = Math.max(this.shake, 0.5);
    }
  }

  /** Next camera angle; says its name. */
  cycleCamera(): void {
    this.camMode = (this.camMode + 1) % CITY_CAMS.length;
    this.deps.audio.play('click');
    this.showToast(`CAMERA · ${CITY_CAMS[this.camMode].name}`, '#22e6ff');
  }

  get mapOpen(): boolean {
    return this.bigMap.classList.contains('open');
  }

  toggleMap(): void {
    const open = this.bigMap.classList.toggle('open');
    if (open) this.drawBigMap();
  }

  /** Headlight pools on the road ahead and the tail lights' glow behind. */
  private addCarLights(): void {
    const material = new THREE.MeshBasicMaterial({ map: glow(), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false, color: new THREE.Color(0xdfe8ff).multiplyScalar(0.55) });
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(7, 16), material);
    beam.visible = this.style.night; // a pool of headlight on the road only reads after dark
    beam.rotation.x = -Math.PI / 2;
    beam.position.set(0, 0.06, 9.5);
    const tail = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.8),
      new THREE.MeshBasicMaterial({ map: glow(), transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: false, color: new THREE.Color(0xff2a3a).multiplyScalar(0.28) }));
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(0, 0.07, -2.6);
    this.tailPool = tail;
    // Brake and reversing lamps: a glow on the car's own tail, measured from
    // the model so it sits on whichever car this is.
    const box = localBounds(this.car);
    const size = box.getSize(new THREE.Vector3());
    const lamp = (color: number, w: number) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, size.y * 0.34),
        new THREE.MeshBasicMaterial({ map: glow(), transparent: true, depthWrite: false,
          blending: THREE.AdditiveBlending, fog: false, color }));
      mesh.position.set(0, box.min.y + size.y * 0.55, box.min.z - 0.04);
      mesh.rotation.y = Math.PI; // facing back, the way the lamps shine
      return mesh;
    };
    this.brakeLamp = lamp(0xff1f2e, size.x * 1.25);
    this.reverseLamp = lamp(0xdfe8ff, size.x * 0.7);
    this.reverseLamp.position.z -= 0.02;
    for (const mesh of [beam, tail, this.brakeLamp, this.reverseLamp]) {
      mesh.renderOrder = 2;
      this.car.add(mesh);
      this.carFx.push(mesh);
    }
    this.updateLamps();
  }

  /** Brake lights flare when slowing, white lamps when backing up. */
  private updateLamps(): void {
    const d = this.drive;
    const brake = d.braking ? 1 : 0;
    (this.brakeLamp!.material as THREE.MeshBasicMaterial).color.setHex(0xff1f2e).multiplyScalar(0.28 + brake * 1.6);
    (this.reverseLamp!.material as THREE.MeshBasicMaterial).color.setHex(0xdfe8ff).multiplyScalar(d.reversing ? 1.1 : 0);
    this.reverseLamp!.visible = d.reversing;
    (this.tailPool!.material as THREE.MeshBasicMaterial).color.setHex(0xff2a3a).multiplyScalar(0.28 + brake * 0.55);
    this.tailPool!.scale.setScalar(1 + brake * 0.5);
  }

  resize(): void {
    const r = this.deps.renderer;
    this.postfx?.setSize(window.innerWidth, window.innerHeight, r.getPixelRatio());
  }

  paused = false;
  private foldCard: (on: boolean) => void = () => {};

  /** Fold or open the dispatch / radar card (the pad's D-pad up while stopped does it too). */
  toggleCard(): void {
    const card = this.hud.querySelector('.city-activity') as HTMLElement;
    this.foldCard(!card.classList.contains('collapsed'));
  }

  /** Pause or resume: the world stops, the menu shows. The ride is kept. */
  togglePause(on = !this.paused): void {
    if (on === this.paused) return;
    this.paused = on;
    this.hud.querySelector('#city-pause')!.classList.toggle('hidden', !on);
    if (on) { this.deps.audio.stopEngine(); this.deps.audio.stopSiren(); this.deps.audio.play('back'); }
    else { this.deps.audio.startEngine(); this.deps.audio.play('select'); }
  }

  /** One frame: drive, dress, film. `real` is the frame time in seconds. */
  frame(real: number, elapsed: number): void {
    if (this.paused) {
      if (this.postfx) this.postfx.composer.render();
      else this.deps.renderer.render(this.scene, this.deps.camera);
      return;
    }
    const dt = Math.min(real, 0.05);
    const input = this.deps.input;
    const steer = THREE.MathUtils.clamp(input.keySteer + input.touchSteer, -1, 1);
    const passengerSequenceActive = this.passenger.isPlaying();
    if (!passengerSequenceActive && !this.police.arresting) {
      this.drive.update(dt, { steer, gas: input.gas, brake: input.braking, handbrake: input.handbrake });
    }
    this.updateLamps();
    const d = this.drive;
    // reckless driving: ramming traffic, and hitting walls hard, draws the police
    const rammed = this.traffic.update(dt, d);
    if (rammed > 12) this.police.crime(0.34);
    else if (rammed > 6) this.police.crime(0.15);
    if (d.impact > 13) this.police.crime(0.22);
    this.police.update(dt, d);
    for (let ev = this.police.consumeEvent(); ev; ev = this.police.consumeEvent()) this.policeEvent(ev);
    if (this.activities) {
      this.activities.update(dt, elapsed, d.x, d.z);
      for (let event = this.activities.consumeEvent(); event; event = this.activities.consumeEvent()) {
        this.deps.audio.play(event.type.includes('finish') ? 'finish' : event.type === 'collect' ? 'combo' : 'go');
        this.showToast(event.text, event.color);
      }
    }
    if (this.fares) this.updateFares(dt);
    const passengerSequence = this.passenger.update(dt);
    if (passengerSequence === 'pickup' && this.fares) {
      this.fares.boarded();
      this.deps.audio.play('go');
      this.showToast(`${this.fares.name} ON BOARD · ${this.fares.dropoff.name}`, '#8b5cf6');
    }
    if (passengerSequence === 'dropoff' && this.fares) {
      const paid = this.fares.alighted();
      this.deps.audio.play('finish');
      this.showToast(`FARE PAID · +${paid} COINS`, '#fcff52');
    }
    this.updateRoute(dt);

    // the car
    const speed = d.speed;
    this.car.position.set(d.x, 0, d.z);
    this.car.rotation.set(0, d.yaw, THREE.MathUtils.clamp(-d.slip * 0.012, -0.12, 0.12));
    this.car.position.y = Math.sin(elapsed * 22) * 0.01;

    if (d.impact > 3) {
      this.deps.audio.play(d.impact > 11 ? 'crash' : 'bump', Math.min(1, d.impact / 14));
      this.shake = Math.max(this.shake, Math.min(1.4, d.impact / 10));
      if (d.impact > 11 && navigator.vibrate) navigator.vibrate(60);
      this.deps.input.rumble(Math.min(1, d.impact / 14), d.impact > 11 ? 260 : 120);
    }
    const drifting = Math.abs(d.slip) > 4 && Math.abs(speed) > 10;
    if (drifting && elapsed - this.lastSkid > 0.9) {
      this.lastSkid = elapsed;
      this.deps.audio.play('skid', 0.5);
    }
    this.emitSmoke(drifting, speed);
    this.smoke.update(dt);

    const top = 40;
    this.deps.audio.engine(0.5 + Math.min(1.3, Math.abs(speed) / top) * 0.95, 0.16 + Math.min(1, Math.abs(speed) / top) * 0.14);
    const flatOut = THREE.MathUtils.clamp((Math.abs(speed) / top - 0.7) / 0.3, 0, 1) * 0.42;
    this.postfx?.setDrama(d.boosting ? 1 : flatOut, 0);
    this.postfx?.tick(elapsed);

    this.updateCamera(dt, speed);
    this.world.update(d.x, d.z, dt);
    if (this.sun.castShadow) {
      this.sun.position.set(d.x - 60, 90, d.z - 40);
      this.sun.target.position.set(d.x, 0, d.z);
    }
    this.sky.position.set(this.deps.camera.position.x, 0, this.deps.camera.position.z);
    this.rain.update(this.deps.camera, elapsed);
    this.updateHud(dt, speed);

    if (this.postfx) this.postfx.composer.render();
    else this.deps.renderer.render(this.scene, this.deps.camera);
  }

  /** ○ on a pad: the card's button. */
  padAction(): void {
    const button = this.hud.querySelector('#city-gps') as HTMLButtonElement;
    if (!button.hidden && !button.disabled) this.panelAction();
  }

  /** L3 / R3 on a pad: skip the fare on offer. */
  padSkip(): void {
    const skip = this.hud.querySelector('#city-skip') as HTMLButtonElement;
    if (!skip.hidden) skip.click();
  }

  /** The panel's button: accept a fare, take the next one, or the free-roam radar's action. */
  private panelAction(): void {
    const d = this.drive;
    if (this.fares) {
      const status = this.fares.status();
      if (status.stage === 'offer') {
        this.fares.accept();
        const { stand, x, z } = this.fares.pickup;
        this.passenger.waitAt(stand.x, stand.z, x, z);
        this.deps.audio.play('select');
        this.showToast(`RIDE ACCEPTED · ${this.fares.name} IS WAITING`, '#8b5cf6');
      } else if (status.stage === 'paid') {
        this.fares.offer({ x: d.x, z: d.z });
        this.deps.audio.play('open');
      }
      return;
    }
    if (!this.activities) return;
    const status = this.activities.status(d.x, d.z);
    if (status.action === 'SET GPS') this.activities.setNearestGps(d.x, d.z);
    else this.activities.activateNearby(d.x, d.z);
  }

  /** Pull up beside the waiting passenger, or at the destination, and stop. */
  private updateFares(dt: number): void {
    const fares = this.fares!, d = this.drive;
    fares.tick(dt);
    if (this.passenger.isPlaying()) return;
    const what = fares.arrive(d.x, d.z, Math.abs(d.speed) < 1.5);
    // the passenger walks in the car's frame: put the car where the drive is
    // before they measure it, not where it was drawn last frame
    if (what) {
      this.car.position.set(d.x, 0, d.z);
      this.car.rotation.set(0, d.yaw, 0);
      this.car.updateMatrixWorld(true);
    }
    if (what === 'board') {
      d.vel.set(0, 0);
      this.passenger.startPickup();
    } else if (what === 'alight') {
      d.vel.set(0, 0);
      this.passenger.startDropoff(fares.dropoff.stand);
    }
  }

  /** Where the GPS is pointing, whichever mode is running. */
  private navTarget(): (P & { label: string; color: number }) | null {
    if (this.fares) return this.fares.status().target;
    return this.activities?.status(this.drive.x, this.drive.z).target ?? null;
  }

  /**
   * Re-plan the route a few times a second (the car moves, the target
   * changes), then lay chevrons on the road along the next stretch of it.
   */
  private updateRoute(dt: number): void {
    this.routeTimer -= dt;
    const target = this.navTarget();
    const id = target ? `${Math.round(target.x)},${Math.round(target.z)}` : '';
    if (this.routeTimer > 0 && id === this.routeFor) return;
    this.routeTimer = 0.4;
    this.routeFor = id;
    const f = this.drive.forward;
    this.route = target ? route({ x: this.drive.x, z: this.drive.z }, target, { x: f.x, z: f.y }) : [];
    const color = new THREE.Color(target?.color ?? 0x22e6ff);
    // chevrons every 9 m from 12 m ahead, following the polyline
    let k = 0, walked = 0, next = 12;
    for (let i = 1; i < this.route.length && k < this.chevrons.length; i++) {
      const a = this.route[i - 1], b = this.route[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      while (next <= walked + len && k < this.chevrons.length) {
        const t = (next - walked) / len;
        const mesh = this.chevrons[k++];
        mesh.position.set(a.x + (b.x - a.x) * t, 0.09, a.z + (b.z - a.z) * t);
        mesh.rotation.y = Math.atan2(-(b.x - a.x), -(b.z - a.z));
        (mesh.material as THREE.MeshBasicMaterial).color.copy(color).multiplyScalar(0.9 * (1 - k / (this.chevrons.length + 4)));
        mesh.visible = true;
        next += 9;
      }
      walked += len;
    }
    for (; k < this.chevrons.length; k++) this.chevrons[k].visible = false;
  }

  /** A pool of glowing road arrows the route lays down ahead of the car. */
  private buildChevrons(): void {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(14, 44);
    ctx.lineTo(32, 20);
    ctx.lineTo(50, 44);
    ctx.stroke();
    const texture = new THREE.CanvasTexture(c);
    const geometry = new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2);
    for (let i = 0; i < 16; i++) {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture, transparent: true,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      mesh.renderOrder = 2;
      mesh.visible = false;
      this.scene.add(mesh);
      this.chevrons.push(mesh);
    }
  }

  private policeEvent(ev: { type: 'wanted' | 'evaded' | 'busted'; stars: number }): void {
    if (ev.type === 'wanted') {
      this.deps.audio.play('crash', 0.4);
      this.showToast(`${'★'.repeat(ev.stars)} WANTED · POLICE ARE COMING`, '#ff3b4a');
    } else if (ev.type === 'evaded') {
      this.deps.audio.play('finish');
      this.showToast('YOU LOST THEM', '#22e6ff');
    } else {
      const fine = 40 * ev.stars;
      const paid = spend(fine);
      this.drive.vel.set(0, 0);
      const lostFare = this.fares?.cancel({ x: this.drive.x, z: this.drive.z }) ?? false;
      if (lostFare) this.passenger.stopWaiting();
      this.deps.audio.play('crash');
      this.showToast(`BUSTED${paid ? ` · FINE ⬤ ${fine}` : ''}${lostFare ? ' · FARE LOST' : ''}`, '#ff3b4a');
    }
  }

  /** The district to announce, in this city's own names. */
  private districtName(x: number, z: number): string {
    const generic = districtAt(x, z);
    const d = this.style.districts;
    const table: Record<string, string> = {
      DOWNTOWN: d.downtown, MIDTOWN: d.midtown, 'NIGHT MARKET': d.market, HARBOUR: d.harbour, PLAZA: d.plaza,
      EXPRESSWAY: d.ring, 'EAST ISLAND': d.island, 'EAST FREEWAY': d.bridge
    };
    return table[generic] ?? generic;
  }

  /** The wanted stars, and the bust / evade meter under them. */
  private updateWanted(): void {
    const el = this.hud.querySelector('#city-wanted') as HTMLElement;
    const stars = this.police.stars;
    el.hidden = stars === 0;
    if (!stars) return;
    (el.querySelector('b') as HTMLElement).textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);
    const bust = this.police.bustProgress, evade = this.police.evadeProgress;
    const bar = el.querySelector('i') as HTMLElement;
    bar.style.width = `${Math.round((bust > 0.02 ? bust : evade) * 100)}%`;
    bar.classList.toggle('bust', bust > 0.02);
    (el.querySelector('small') as HTMLElement).textContent = bust > 0.02 ? 'STOPPED · BUSTED IN…' : evade > 0 ? 'OUT OF SIGHT · LOSING THEM' : 'EVADE THE POLICE';
  }

  private emitSmoke(drifting: boolean, speed: number): void {
    const d = this.drive;
    const f = d.forward;
    const back = { x: d.x - f.x * 2.1, z: d.z - f.y * 2.1 };
    const side = { x: f.y, z: -f.x };
    if (drifting) {
      for (const s of [-0.85, 0.85]) {
        this.smoke.spawn(back.x + side.x * s, 0.3, back.z + side.z * s, 0xd8dde8, 0.55);
      }
    } else if (Math.abs(speed) > 14 && (this.sprayFlip = !this.sprayFlip)) {
      for (const s of [-0.8, 0.8]) {
        this.smoke.spawn(back.x + side.x * s, 0.16, back.z + side.z * s, 0x6f7a90, 0.2);
      }
    }
  }

  private updateCamera(dt: number, speed: number): void {
    const cam = this.deps.camera;
    const d = this.drive;
    // Hang behind the direction of travel rather than the nose, so a drift
    // swings the car across the frame instead of dragging the camera round.
    const mode = CITY_CAMS[this.camMode];
    // reversing, travel points backwards: keep the camera behind the nose
    const travel = d.vel.lengthSq() > 16 && d.speed > 0 ? d.vel.clone().normalize() : d.forward;
    // on the car the view is the nose's; behind it, a blend toward travel
    const dir = mode.attached ? d.forward : d.forward.clone().lerp(travel, 0.45).normalize();
    const back = mode.back + Math.max(0, speed) * mode.pull;
    let want = new THREE.Vector3(d.x - dir.x * back, mode.h + Math.max(0, speed) * mode.pull * 0.4, d.z - dir.y * back);
    let look = new THREE.Vector3(d.x + dir.x * mode.ahead, mode.lookH, d.z + dir.y * mode.ahead);
    // a passenger getting in or out: swing round to watch the door
    const shot = this.passenger.cameraShot() ?? this.police.arrestShot(d);
    if (shot) {
      want = shot.position;
      look = shot.look;
    }
    const rigid = mode.attached && !shot;
    const k = rigid ? 1 : 1 - Math.exp(-dt * (shot ? 2.2 : mode.lag));
    // Smooth the camera's offset from the car, not its place in the world:
    // smoothing a world position trails further behind the faster you go.
    const car = new THREE.Vector3(d.x, 0, d.z);
    this.camOffset.lerp(want.clone().sub(car), k);
    this.camPos.copy(car).add(this.camOffset);
    this.lookOffset.lerp(look.clone().sub(car), rigid ? 1 : 1 - Math.exp(-dt * (shot ? 3 : 10)));
    this.camLook.copy(car).add(this.lookOffset);
    cam.position.copy(this.camPos);
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.3;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.3;
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    cam.lookAt(this.camLook);
    const fov = mode.fov + Math.max(0, speed) * mode.zoom + (d.boosting ? 7 : 0);
    if (Math.abs(cam.fov - fov) > 0.1) {
      cam.fov = THREE.MathUtils.damp(cam.fov, fov, 4, dt);
      cam.updateProjectionMatrix();
    }
  }

  private updateHud(dt: number, speed: number): void {
    this.updateWanted();
    this.hud.classList.toggle('has-pad', !!this.deps.input.padName);
    const kmh = Math.round(Math.abs(speed) * 3.6);
    const speedEl = document.getElementById('hud-speed-v');
    if (speedEl) speedEl.textContent = String(kmh);
    const fill = document.getElementById('speed-fill');
    if (fill) fill.style.width = `${Math.min(100, (Math.abs(speed) / 40) * 100)}%`;
    const nitro = this.hud.querySelector('#city-nitro') as HTMLElement;
    nitro.style.setProperty('--fill', `${Math.round(this.drive.nitro * 100)}%`);
    nitro.classList.toggle('ready', this.drive.nitro >= 0.999 && !this.drive.boosting);
    nitro.classList.toggle('on', this.drive.boosting);

    const here = this.districtName(this.drive.x, this.drive.z);
    if (here !== this.district) {
      this.district = here;
      const tag = this.hud.querySelector('#city-district') as HTMLElement;
      tag.textContent = here;
      tag.classList.remove('flash');
      void tag.offsetWidth;
      tag.classList.add('flash');
    }
    const activityTitle = this.hud.querySelector('#city-activity-title') as HTMLElement;
    const activityDetail = this.hud.querySelector('#city-activity-detail') as HTMLElement;
    const activityButton = this.hud.querySelector('#city-gps') as HTMLButtonElement;
    const skip = this.hud.querySelector('#city-skip') as HTMLButtonElement;
    const timer = this.hud.querySelector('#city-activity-time') as HTMLElement;
    if (this.fares) {
      const fare = this.fares.status();
      activityTitle.textContent = fare.title;
      activityDetail.textContent = fare.detail;
      activityButton.textContent = fare.action ?? 'DRIVE';
      activityButton.hidden = !fare.action;
      skip.hidden = fare.stage !== 'offer';
      timer.textContent = fare.stage === 'ride' ? `${fare.timer.toFixed(1)}s` : '';
      timer.classList.toggle('late', fare.stage === 'ride' && fare.timer <= 0);
    } else if (this.activities) {
      const activity = this.activities.status(this.drive.x, this.drive.z);
      activityTitle.textContent = activity.title;
      activityDetail.textContent = activity.detail;
      activityButton.textContent = activity.action === 'SET GPS' && !activity.target ? 'FIND NEXT' : activity.action;
      activityButton.disabled = activity.action === 'RACING';
      activityButton.classList.toggle('is-route', !!activity.target);
      skip.hidden = true;
      timer.textContent = activity.timer > 0 ? `${Math.max(0, activity.timer).toFixed(1)}s` : '';
    }
    this.updateNav();
    this.districtTimer += dt;
    this.drawMinimap();
    if (this.bigMap.classList.contains('open') && this.districtTimer > 0.25) {
      this.districtTimer = 0;
      this.drawBigMap();
    }
  }

  /** The turn banner: the next turn and how far, or the distance to arrive. */
  private updateNav(): void {
    const nav = this.hud.querySelector('#city-nav') as HTMLElement;
    const target = this.navTarget();
    if (!target || this.route.length < 2 || this.passenger.isPlaying()) {
      nav.hidden = true;
      return;
    }
    let turn: { turn: 'left' | 'right' | 'arrive' | 'around'; metres: number } = nextTurn(this.route);
    const left = routeLength(this.route);
    // the route's first stretch runs back past the car: say so first
    const [a, b] = this.route, f = this.drive.forward;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len > 8 && ((b.x - a.x) * f.x + (b.z - a.z) * f.y) / len < -0.5) turn = { turn: 'around', metres: 0 };
    const round = (m: number) => (m > 1000 ? `${(m / 1000).toFixed(1)} KM` : `${Math.max(10, Math.round(m / 10) * 10)} M`);
    nav.hidden = false;
    nav.dataset.turn = turn.turn;
    (nav.querySelector('b') as HTMLElement).textContent = turn.turn === 'arrive' ? `ARRIVE · ${round(left)}`
      : turn.turn === 'around' ? 'TURN AROUND' : `TURN ${turn.turn.toUpperCase()} · ${round(turn.metres)}`;
    (nav.querySelector('small') as HTMLElement).textContent = `${target.label} · ${round(left)}`;
  }

  /** Heading-up minimap: the car at the centre pointing up, the city turning under it. */
  private drawMinimap(): void {
    const ctx = this.mini, size = ctx.canvas.width;
    const scale = MAP_PX / (MAP_RANGE * 2);        // image px per metre
    const zoom = size / (240 * scale);              // show ~240 m across
    const px = (this.drive.x + MAP_RANGE) * scale, pz = (this.drive.z + MAP_RANGE) * scale;
    const f = this.drive.forward;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#070912';
    ctx.fillRect(0, 0, size, size);
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-Math.PI / 2 - Math.atan2(f.y, f.x));
    ctx.scale(zoom, zoom);
    ctx.drawImage(this.mapImage, -px, -pz);
    this.drawMapMarkers(ctx, scale, -px, -pz, zoom);
    ctx.restore();
    arrow(ctx, size / 2, size / 2, -Math.PI / 2, 9);
  }

  private drawBigMap(): void {
    const canvas = this.bigMap.querySelector('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.mapImage, 0, 0, canvas.width, canvas.height);
    const s = canvas.width / (MAP_RANGE * 2);
    this.drawMapMarkers(ctx, s, 0, 0, 1);
    const f = this.drive.forward;
    arrow(ctx, (this.drive.x + MAP_RANGE) * s, (this.drive.z + MAP_RANGE) * s, Math.atan2(f.y, f.x), 11);
  }

  private drawMapMarkers(ctx: CanvasRenderingContext2D, scale: number, offsetX: number, offsetZ: number, zoom: number): void {
    const draw = (x: number, z: number, color: number, size: number, alpha = 1) => {
      const px = (x + MAP_RANGE) * scale + offsetX;
      const pz = (z + MAP_RANGE) * scale + offsetZ;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 7 * zoom;
      ctx.beginPath();
      ctx.arc(px, pz, size * Math.max(0.6, zoom), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    if (this.activities) {
      for (const point of cityActivityPoints()) {
        if (!this.activities.isAvailable(point.id)) continue;
        draw(point.x, point.z, point.color, point.kind === 'collectible' ? 3 : 4, 0.95);
      }
    }
    if (this.fares?.stage === 'offer') {
      // preview the fare: where they are and where they are going
      draw(this.fares.pickup.x, this.fares.pickup.z, 0x8b5cf6, 5, 0.9);
      draw(this.fares.dropoff.x, this.fares.dropoff.z, 0xfcff52, 5, 0.9);
    }
    const target = this.navTarget();
    if (target && this.route.length > 1) {
      // the route itself, along the roads, glowing
      ctx.save();
      ctx.strokeStyle = `#${target.color.toString(16).padStart(6, '0')}`;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 6 * zoom;
      ctx.lineWidth = 3.2 / Math.max(0.35, zoom) * Math.min(1, zoom * 1.4);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      this.route.forEach((p, i) => {
        const px = (p.x + MAP_RANGE) * scale + offsetX, pz = (p.z + MAP_RANGE) * scale + offsetZ;
        if (i) ctx.lineTo(px, pz); else ctx.moveTo(px, pz);
      });
      ctx.stroke();
      ctx.restore();
      draw(target.x, target.z, target.color, 6, 1);
    }
  }

  private showToast(text: string, color: string): void {
    const toast = this.hud.querySelector('#city-toast') as HTMLElement;
    toast.textContent = text;
    toast.style.setProperty('--toast-color', color);
    toast.classList.remove('show');
    void toast.offsetWidth;
    toast.classList.add('show');
  }

  dispose(): void {
    this.deps.audio.stopEngine();
    this.deps.input.uiHandbrake = false;
    this.hud.remove();
    this.scene.remove(this.car);
    for (const mesh of this.carFx) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.passenger.dispose();
    disposeCarInstance(this.car);
    this.activities?.dispose();
    for (const mesh of this.chevrons) {
      this.scene.remove(mesh);
      (mesh.material as THREE.MeshBasicMaterial).map?.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.chevrons[0]?.geometry.dispose();
    this.traffic.dispose();
    this.police.dispose();
    this.world.dispose();
    this.rain.dispose();
    disposeHorizon(this.horizon);
    this.scene.environment?.dispose();
    (this.scene.background as THREE.Texture | null)?.dispose();
    this.postfx?.dispose();
    this.deps.camera.far = 300;
    this.deps.camera.updateProjectionMatrix();
  }
}

/** A car's extent in its own frame, leaving out glows and the ground shadow. */
function localBounds(car: THREE.Group): THREE.Box3 {
  const box = new THREE.Box3();
  car.updateMatrixWorld(true);
  const inverse = car.matrixWorld.clone().invert();
  car.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || o.name === 'car-ground-fx' || o.parent?.name === 'car-ground-fx') return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.some((m) => m.transparent)) return;
    mesh.geometry.computeBoundingBox();
    box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(inverse.clone().multiply(mesh.matrixWorld)));
  });
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.9, 0, -2.2), new THREE.Vector3(0.9, 1.2, 2.2));
  return box;
}

/** Night sky: near-black overhead, the city's magenta glow at the horizon. */
function skyGradient(stops: readonly string[]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, stops[0]);
  g.addColorStop(0.55, stops[1]);
  g.addColorStop(1, stops[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The whole city, top down, once: minimap and full map both crop from it. */
function drawCityMap(style: CityStyle): HTMLCanvasElement {
  const m = style.map;
  const c = document.createElement('canvas');
  c.width = c.height = MAP_PX;
  const ctx = c.getContext('2d')!;
  const s = MAP_PX / (MAP_RANGE * 2);
  const X = (x: number) => (x + MAP_RANGE) * s;
  ctx.fillStyle = m.ground;
  ctx.fillRect(0, 0, MAP_PX, MAP_PX);
  ctx.fillStyle = m.water;                            // water around both shores
  ctx.fillRect(0, 0, MAP_PX, MAP_PX);
  ctx.fillStyle = m.roads;                            // every street and the ring
  ctx.fillRect(X(-EDGE), X(-EDGE), (EDGE * 2) * s, (EDGE * 2) * s);
  ctx.fillStyle = m.island;                           // east island
  ctx.fillRect(X(EAST_ISLAND_X0), X(EAST_ISLAND_Z0),
    (EAST_ISLAND_X1 - EAST_ISLAND_X0) * s, (EAST_ISLAND_Z1 - EAST_ISLAND_Z0) * s);
  ctx.fillStyle = '#41495e';                          // bridge + long freeway
  ctx.fillRect(X(EDGE), X(BRIDGE_Z - BRIDGE_HALF),
    (EAST_ISLAND_X0 - EDGE) * s, BRIDGE_HALF * 2 * s);
  ctx.fillRect(X(EAST_ISLAND_X0), X(BRIDGE_Z - 11),
    (EAST_ISLAND_X1 - EAST_ISLAND_X0) * s, 22 * s);
  const tint: Record<string, string> = m.blocks;
  for (const b of CITY_BLOCKS) {
    ctx.fillStyle = tint[b.district];
    ctx.fillRect(X(b.x0), X(b.z0), (b.x1 - b.x0) * s, (b.z1 - b.z0) * s);
  }
  ctx.strokeStyle = m.rail;                           // the expressway's rail
  ctx.lineWidth = 2;
  ctx.strokeRect(X(-EDGE), X(-EDGE), EDGE * 2 * s, EDGE * 2 * s);
  ctx.strokeStyle = m.centre;                         // expressway centre
  ctx.lineWidth = 1;
  const ring = HALF + STREET / 2 + (EDGE - HALF - STREET / 2) / 2;
  ctx.strokeRect(X(-ring), X(-ring), ring * 2 * s, ring * 2 * s);
  return c;
}

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + Math.PI / 2);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.7, size * 0.8);
  ctx.lineTo(0, size * 0.35);
  ctx.lineTo(-size * 0.7, size * 0.8);
  ctx.closePath();
  ctx.fillStyle = '#ff2e9a';
  ctx.shadowColor = '#ff2e9a';
  ctx.shadowBlur = 8;
  ctx.fill();
  ctx.restore();
}

function buildHud(mode: 'free' | 'taxi', city: string): HTMLElement {
  const hud = document.createElement('div');
  hud.id = 'city-hud';
  hud.innerHTML = `
    <div class="city-top">
      <div class="city-panel city-where">
        <small>${mode === 'taxi' ? 'PASSENGER' : 'FREE ROAM'} · ${city}</small>
        <strong id="city-district">DOWNTOWN</strong>
      </div>
      <div class="city-actions">
        <button class="city-btn" id="city-radio" data-compact="1" type="button" aria-label="NEON FM radio">📻</button>
        <button class="city-btn radio-next-hud" id="city-radio-next" type="button" aria-label="Radio: next station">⏭</button>
        <button class="city-btn" id="city-cam-btn" type="button" aria-label="Change camera">CAM</button>
        <button class="city-btn" id="city-map-btn" type="button">MAP</button>
        <button class="city-btn" id="city-pause-btn" type="button" aria-label="Pause">⏸</button>
      </div>
    </div>
    <div class="city-panel city-activity">
      <button class="city-activity-kicker" id="city-activity-toggle" type="button" aria-expanded="true" aria-label="Show or hide the card">
        <span>${mode === 'taxi' ? 'DISPATCH' : 'ACTIVITY RADAR'}</span><b id="city-activity-time"></b><i aria-hidden="true">▾</i>
      </button>
      <strong id="city-activity-title">ACTIVITY RADAR</strong>
      <small id="city-activity-detail">Set a waypoint to find collectibles, races and rides.</small>
      <div class="city-activity-buttons">
        <button class="city-btn" id="city-gps" data-pad="○" type="button">FIND NEXT</button>
        <button class="city-btn ghost" id="city-skip" data-pad="R3" type="button" hidden>SKIP</button>
      </div>
      <div id="city-nav" hidden><i aria-hidden="true"></i><span><b></b><small></small></span></div>
    </div>
    <canvas id="city-mini" width="150" height="150" aria-label="Minimap. Tap for the full map."></canvas>
    <button id="city-nitro" type="button" aria-label="Nitro"><span>NITRO</span></button>
    <button id="city-drift" type="button" aria-label="Handbrake: hold to drift">DRIFT</button>
    <div id="city-toast" role="status" aria-live="polite"></div>
    <div id="city-pause" class="overlay hidden" role="dialog" aria-label="Paused">
      <div class="city-pause-card">
        <small>${city}</small>
        <strong>PAUSED</strong>
        <button class="city-btn big" id="city-resume" type="button">RESUME</button>
        <button class="city-btn" id="city-pause-radio" type="button">📻 RADIO</button>
        <button class="city-btn" id="city-exit" type="button">EXIT TO MENU</button>
        <em>🎮 Options resumes · keyboard P / Esc</em>
      </div>
    </div>
    <div id="city-wanted" hidden><b></b><small></small><span><i></i></span></div>
    <div id="city-bigmap" role="dialog" aria-label="City map">
      <div class="city-bigmap-card">
        <div class="city-bigmap-head"><span>${city}</span><small>TAP TO CLOSE</small></div>
        <canvas width="${MAP_PX}" height="${MAP_PX}"></canvas>
      </div>
    </div>`;
  return hud;
}
