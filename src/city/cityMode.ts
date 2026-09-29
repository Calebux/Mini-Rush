import * as THREE from 'three';
import type { AssetLibrary } from '../assets';
import { disposeCarInstance } from '../assets';
import type { AudioManager } from '../audio';
import type { CarSpec } from '../cars';
import { buildHorizon, buildReflectionSky, disposeHorizon, environmentTheme } from '../environment';
import type { InputManager } from '../input';
import { MAPS } from '../maps';
import { glow } from '../neonCity';
import { createPostFX, PostFX, savedLook } from '../postfx';
import type { QualityTier } from '../quality';
import { Rain } from '../rain';
import { SmokePool } from '../smoke';
import { CityDrive } from './drive';
import { CITY_BLOCKS, districtAt, EDGE, HALF, SHORE, SPAWN, STREET } from './layout';
import { CityWorld } from './world';
import './city.css';

export interface CityDeps {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  assets: AssetLibrary;
  audio: AudioManager;
  input: InputManager;
  spec: CarSpec;
  tier: QualityTier;
  onExit: () => void;
}

const MAP_RANGE = EDGE + 30;        // metres from the centre the map image covers
const MAP_PX = 640;

/**
 * Free roam: drive anywhere in a neon city. Owns its own scene, so entering
 * and leaving never disturbs the race world waiting behind the menu.
 */
export class CityMode {
  private scene = new THREE.Scene();
  private world = new CityWorld();
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
  private sprayFlip = false;
  private lastSkid = -10;
  private hud: HTMLElement;
  private mini: CanvasRenderingContext2D;
  private mapImage: HTMLCanvasElement;
  private bigMap: HTMLElement;
  private district = '';
  private districtTimer = 0;

  constructor(private deps: CityDeps) {
    const theme = environmentTheme(MAPS.find((m) => m.id === 'neon')!);
    this.scene.background = skyGradient();
    this.scene.fog = new THREE.Fog(0x2a1c48, 40, 430);
    this.scene.environment = buildReflectionSky(theme);
    this.scene.environmentIntensity = 1.1;
    this.scene.add(new THREE.HemisphereLight(0x9a8ce6, 0x2a1f48, 1.35));
    const moon = new THREE.DirectionalLight(0xa9b9ff, 1.1);
    moon.position.set(-60, 90, -40);
    this.scene.add(moon);
    this.scene.add(this.world.group);
    this.horizon = buildHorizon(theme);
    this.sky.add(this.horizon);
    this.scene.add(this.sky);

    this.drive = CityDrive.forSpec(deps.spec);
    this.drive.x = SPAWN.x;
    this.drive.z = SPAWN.z;
    this.drive.yaw = SPAWN.yaw;
    this.car = deps.assets.cloneCar(deps.spec);
    this.scene.add(this.car);
    this.addCarLights();

    this.rain = new Rain(deps.tier === 0 ? 1200 : 2600);
    this.scene.add(this.rain.object);
    this.smoke = new SmokePool(this.scene, 40);

    this.postfx = createPostFX(deps.renderer, this.scene, deps.camera, deps.tier);
    this.postfx?.setMood(true);
    this.postfx?.setLook(savedLook(), true);
    this.resize();

    this.mapImage = drawCityMap();
    this.hud = buildHud();
    document.body.appendChild(this.hud);
    this.mini = (this.hud.querySelector('#city-mini') as HTMLCanvasElement).getContext('2d')!;
    this.bigMap = this.hud.querySelector('#city-bigmap') as HTMLElement;
    this.hud.querySelector('#city-exit')!.addEventListener('click', () => deps.onExit());
    this.hud.querySelector('#city-nitro')!.addEventListener('click', () => this.nitro());
    const toggleMap = () => this.toggleMap();
    this.hud.querySelector('#city-mini')!.addEventListener('click', toggleMap);
    this.hud.querySelector('#city-map-btn')!.addEventListener('click', toggleMap);
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

  toggleMap(): void {
    const open = this.bigMap.classList.toggle('open');
    if (open) this.drawBigMap();
  }

  /** Headlight pools on the road ahead and the tail lights' glow behind. */
  private addCarLights(): void {
    const material = new THREE.MeshBasicMaterial({ map: glow(), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false, color: new THREE.Color(0xdfe8ff).multiplyScalar(0.55) });
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(7, 16), material);
    beam.rotation.x = -Math.PI / 2;
    beam.position.set(0, 0.06, 9.5);
    const tail = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.8),
      new THREE.MeshBasicMaterial({ map: glow(), transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: false, color: new THREE.Color(0xff2a3a).multiplyScalar(0.28) }));
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(0, 0.07, -2.6);
    for (const mesh of [beam, tail]) {
      mesh.renderOrder = 2;
      this.car.add(mesh);
      this.carFx.push(mesh);
    }
  }

  resize(): void {
    const r = this.deps.renderer;
    this.postfx?.setSize(window.innerWidth, window.innerHeight, r.getPixelRatio());
  }

  /** One frame: drive, dress, film. `real` is the frame time in seconds. */
  frame(real: number, elapsed: number): void {
    const dt = Math.min(real, 0.05);
    const input = this.deps.input;
    const steer = THREE.MathUtils.clamp(input.keySteer + input.touchSteer, -1, 1);
    this.drive.update(dt, { steer, gas: input.gas, brake: input.braking });
    const d = this.drive;

    // the car
    const speed = d.speed;
    this.car.position.set(d.x, 0, d.z);
    this.car.rotation.set(0, d.yaw, THREE.MathUtils.clamp(-d.slip * 0.012, -0.12, 0.12));
    this.car.position.y = Math.sin(elapsed * 22) * 0.01;

    if (d.impact > 3) {
      this.deps.audio.play(d.impact > 11 ? 'crash' : 'bump', Math.min(1, d.impact / 14));
      this.shake = Math.max(this.shake, Math.min(1.4, d.impact / 10));
      if (d.impact > 11 && navigator.vibrate) navigator.vibrate(60);
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
    this.world.update(d.x, d.z);
    this.sky.position.set(this.deps.camera.position.x, 0, this.deps.camera.position.z);
    this.rain.update(this.deps.camera, elapsed);
    this.updateHud(dt, speed);

    if (this.postfx) this.postfx.composer.render();
    else this.deps.renderer.render(this.scene, this.deps.camera);
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
    const travel = d.vel.lengthSq() > 16 ? d.vel.clone().normalize() : d.forward;
    const dir = d.forward.clone().lerp(travel, 0.45).normalize();
    const back = 8.2 + Math.max(0, speed) * 0.05;
    const want = new THREE.Vector3(d.x - dir.x * back, 3.9 + Math.max(0, speed) * 0.018, d.z - dir.y * back);
    const k = 1 - Math.exp(-dt * 6);
    this.camPos.lerp(want, k);
    this.camLook.lerp(new THREE.Vector3(d.x + dir.x * 6, 1.3, d.z + dir.y * 6), 1 - Math.exp(-dt * 10));
    cam.position.copy(this.camPos);
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.3;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.3;
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    cam.lookAt(this.camLook);
    const fov = 66 + Math.max(0, speed) * 0.22 + (d.boosting ? 9 : 0);
    if (Math.abs(cam.fov - fov) > 0.1) {
      cam.fov = THREE.MathUtils.damp(cam.fov, fov, 4, dt);
      cam.updateProjectionMatrix();
    }
  }

  private updateHud(dt: number, speed: number): void {
    const kmh = Math.round(Math.abs(speed) * 3.6);
    const speedEl = document.getElementById('hud-speed-v');
    if (speedEl) speedEl.textContent = String(kmh);
    const fill = document.getElementById('speed-fill');
    if (fill) fill.style.width = `${Math.min(100, (Math.abs(speed) / 40) * 100)}%`;
    const nitro = this.hud.querySelector('#city-nitro') as HTMLElement;
    nitro.style.setProperty('--fill', `${Math.round(this.drive.nitro * 100)}%`);
    nitro.classList.toggle('ready', this.drive.nitro >= 0.999 && !this.drive.boosting);
    nitro.classList.toggle('on', this.drive.boosting);

    const here = districtAt(this.drive.x, this.drive.z);
    if (here !== this.district) {
      this.district = here;
      const tag = this.hud.querySelector('#city-district') as HTMLElement;
      tag.textContent = here;
      tag.classList.remove('flash');
      void tag.offsetWidth;
      tag.classList.add('flash');
    }
    this.districtTimer += dt;
    this.drawMinimap();
    if (this.bigMap.classList.contains('open') && this.districtTimer > 0.25) {
      this.districtTimer = 0;
      this.drawBigMap();
    }
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
    ctx.restore();
    arrow(ctx, size / 2, size / 2, -Math.PI / 2, 9);
  }

  private drawBigMap(): void {
    const canvas = this.bigMap.querySelector('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.mapImage, 0, 0, canvas.width, canvas.height);
    const s = canvas.width / (MAP_RANGE * 2);
    const f = this.drive.forward;
    arrow(ctx, (this.drive.x + MAP_RANGE) * s, (this.drive.z + MAP_RANGE) * s, Math.atan2(f.y, f.x), 11);
  }

  dispose(): void {
    this.deps.audio.stopEngine();
    this.hud.remove();
    this.scene.remove(this.car);
    for (const mesh of this.carFx) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    disposeCarInstance(this.car);
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

/** Night sky: near-black overhead, the city's magenta glow at the horizon. */
function skyGradient(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#05040d');
  g.addColorStop(0.55, '#1b1236');
  g.addColorStop(1, '#4a2466');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The whole city, top down, once: minimap and full map both crop from it. */
function drawCityMap(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = MAP_PX;
  const ctx = c.getContext('2d')!;
  const s = MAP_PX / (MAP_RANGE * 2);
  const X = (x: number) => (x + MAP_RANGE) * s;
  ctx.fillStyle = '#0a0d16';
  ctx.fillRect(0, 0, MAP_PX, MAP_PX);
  ctx.fillStyle = '#12314a';                          // harbour water
  ctx.fillRect(0, X(SHORE), MAP_PX, MAP_PX);
  ctx.fillStyle = '#39415a';                          // every street and the ring
  ctx.fillRect(X(-EDGE), X(-EDGE), (EDGE * 2) * s, (EDGE * 2) * s);
  const tint: Record<string, string> = {
    downtown: '#241a3a', midtown: '#1a2030', market: '#2c1f24', harbour: '#1b2626', plaza: '#18322c'
  };
  for (const b of CITY_BLOCKS) {
    ctx.fillStyle = tint[b.district];
    ctx.fillRect(X(b.x0), X(b.z0), (b.x1 - b.x0) * s, (b.z1 - b.z0) * s);
  }
  ctx.strokeStyle = '#22e6ff';                        // the expressway's rail
  ctx.lineWidth = 2;
  ctx.strokeRect(X(-EDGE), X(-EDGE), EDGE * 2 * s, EDGE * 2 * s);
  ctx.strokeStyle = 'rgba(255,46,154,0.55)';          // expressway centre
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

function buildHud(): HTMLElement {
  const hud = document.createElement('div');
  hud.id = 'city-hud';
  hud.innerHTML = `
    <div class="city-top">
      <div class="city-panel city-where">
        <small>FREE ROAM · NEON CITY</small>
        <strong id="city-district">DOWNTOWN</strong>
      </div>
      <div class="city-actions">
        <button class="city-btn" id="city-map-btn" type="button">MAP</button>
        <button class="city-btn" id="city-exit" type="button">EXIT</button>
      </div>
    </div>
    <canvas id="city-mini" width="150" height="150" aria-label="Minimap. Tap for the full map."></canvas>
    <button id="city-nitro" type="button" aria-label="Nitro"><span>NITRO</span></button>
    <div id="city-bigmap" role="dialog" aria-label="City map">
      <div class="city-bigmap-card">
        <div class="city-bigmap-head"><span>NEON CITY</span><small>TAP TO CLOSE</small></div>
        <canvas width="${MAP_PX}" height="${MAP_PX}"></canvas>
      </div>
    </div>`;
  return hud;
}
