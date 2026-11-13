import * as T from 'three';
import { AssetLibrary, disposeCarInstance } from './assets';
import type { CarSpec } from './cars';
import { buildGarage } from './garageSet';
import { buildMarketStudio } from './marketStudio';
import { ComponentReveal } from './componentReveal';
import type { Recipe } from './components';
import { lightCars, studioEnvironment } from './lighting';

/** One renderer, a separate scene in the garage: menu lighting never changes a race. */
export class Showroom {
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(36, 1, .1, 100);
  private car: T.Group | null = null;
  private key = '';
  private angle = .65;
  private dragX: number | null = null;
  private stage: HTMLElement | null = null;
  private bounds = new T.Box3();
  private lit = '';
  private carEnv: T.Texture | null = null;
  private garageSet = new T.Group();
  private marketSet = buildMarketStudio();
  private marketFog = new T.FogExp2(0x060c15, .035);
  private boundStages = new WeakSet<HTMLElement>();
  private lastFrame = 0;
  private shot = '';
  private targetAngle: number | null = null;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private installation: ComponentReveal | null = null;
  constructor(private assets: AssetLibrary) {
    // A physical studio set with broad softbox reflections across the paint.
    this.scene.background = new T.Color(0x0c0e16);
    buildGarage(this.scene);
    this.garageSet.add(...[...this.scene.children]);
    this.marketSet.visible = false;
    this.scene.add(this.garageSet, this.marketSet);
    // a display turntable: a dark disc with a thin cyan edge
    const plinth = new T.Mesh(new T.CylinderGeometry(3.25, 3.32, .07, 96),
      new T.MeshStandardMaterial({ color: 0x141a23, roughness: .38, metalness: .55 }));
    plinth.position.y = -.03; plinth.receiveShadow = true; this.scene.add(plinth);
    const ring = new T.Mesh(new T.RingGeometry(3.14, 3.16, 96),
      new T.MeshBasicMaterial({ color: 0x8bdaee, side: T.DoubleSide, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .012; this.scene.add(ring);
  }
  private bindStage(el: HTMLElement): void {
    if (this.boundStages.has(el)) return;
    this.boundStages.add(el);
    const manual = () => {
      this.targetAngle = null;
      if (el.id === 'home-car-stage') el.dataset.orbit = 'false';
      if (el.id === 'market-car-stage') {
        el.dataset.orbit = 'false';
        document.querySelector('.mk-motion')?.setAttribute('aria-pressed', 'false');
        document.querySelectorAll('.mk-camera [data-shot]').forEach(b => b.setAttribute('aria-pressed', 'false'));
      }
    };
    el.addEventListener('pointerdown', e => {
      if ((e.target as HTMLElement).closest('button')) return;
      manual(); this.dragX = e.clientX; el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', e => { if (this.dragX !== null) { this.angle += (e.clientX - this.dragX) * .008; this.dragX = e.clientX; } });
    const stop = () => { this.dragX = null; };
    el.addEventListener('pointerup', stop); el.addEventListener('pointercancel', stop); el.addEventListener('lostpointercapture', stop);
    el.addEventListener('keydown', e => {
      if ((e.target as HTMLElement).closest('button')) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); manual(); this.angle += e.key === 'ArrowLeft' ? -.2 : .2; }
    });
    const motion = el.querySelector<HTMLButtonElement>('[data-home-motion]');
    if (motion) {
      const sync = () => {
        motion.disabled = this.reducedMotion.matches;
        const moving = el.dataset.orbit === 'true' && !this.reducedMotion.matches;
        motion.setAttribute('aria-pressed', String(moving));
        motion.textContent = this.reducedMotion.matches ? 'MOTION OFF' : moving ? 'Ⅱ PAUSE CAMERA' : '↻ RESUME CAMERA';
      };
      motion.addEventListener('click', () => {
        el.dataset.orbit = String(el.dataset.orbit !== 'true');
        this.targetAngle = null;
        sync();
      });
      el.addEventListener('pointerdown', sync);
      el.addEventListener('keydown', sync);
      this.reducedMotion.addEventListener('change', sync);
      sync();
    }
  }
  setCar(spec: CarSpec): void {
    const key = JSON.stringify(spec); if (key === this.key) return; this.key = key;
    if (this.car) {
      this.scene.remove(this.car);
      disposeCarInstance(this.car);
    }
    this.car = this.assets.cloneCar(spec); this.scene.add(this.car);
    this.bounds.makeEmpty();
    for (const child of this.car.children) {
      if (child.name !== 'car-ground-fx') this.bounds.expandByObject(child);
    }
  }
  installComponent(recipe: Recipe): void {
    this.installation?.dispose();
    this.installation = new ComponentReveal(recipe, this.reducedMotion.matches);
    this.scene.add(this.installation.root);
  }
  clearInstallation(): void { this.installation?.dispose(); this.installation = null; }
  render(renderer: T.WebGLRenderer, workshop: boolean, garage = false, market = false): void {
    this.garageSet.visible = !market; this.marketSet.visible = market;
    (this.scene.background as T.Color).setHex(market ? 0x060c15 : 0x0c0e16);
    this.scene.fog = market ? this.marketFog : null;
    if (!this.carEnv) {
      this.carEnv = studioEnvironment(renderer);
      this.scene.environment = this.carEnv;
      this.scene.environmentIntensity = .35;
    }
    this.stage = document.getElementById(market ? 'market-car-stage' : garage ? 'garage-car-stage' : workshop ? 'workshop-car-stage' : 'home-car-stage');
    if (!this.stage) return;
    this.bindStage(this.stage);
    const now = performance.now(), dt = Math.min(.05, (now - this.lastFrame) / 1000); this.lastFrame = now;
    if (this.installation && (!workshop || !this.installation.update(dt))) {
      this.installation.dispose(); this.installation = null;
    }
    if (market || this.stage.id === 'home-car-stage') {
      const shot = `${this.stage.id}/${this.stage.dataset.shot}/${this.stage.dataset.take ?? ''}`;
      if (shot !== this.shot) {
        this.shot = shot;
        const wanted = this.stage.dataset.shot === 'side' ? Math.PI / 2 : this.stage.dataset.shot === 'rear' ? 2.55 : .65;
        this.targetAngle = this.angle + Math.atan2(Math.sin(wanted - this.angle), Math.cos(wanted - this.angle));
      }
      if (this.targetAngle !== null) {
        this.angle = this.reducedMotion.matches ? this.targetAngle : T.MathUtils.damp(this.angle, this.targetAngle, 5, dt);
        if (Math.abs(this.angle - this.targetAngle) < .002) this.targetAngle = null;
      } else if (this.dragX === null && this.stage.dataset.orbit === 'true' && !this.reducedMotion.matches) this.angle += dt * .10;
    } else { this.shot = ''; this.targetAngle = null; }
    const r = this.stage!.getBoundingClientRect();
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    if (!w || !h || !r.width || !r.height) return;
    // A small stage wants the car small. Backing the camera out would leave the
    // garage, so past 11 m it stays put and the lens widens by the same factor:
    // same framing of the car, more of the garage round it.
    const wanted = Math.max(8.5, h / r.height * 5.1, h / r.width * 7.1);
    const radius = Math.min(wanted, 11);
    this.camera.fov = T.MathUtils.radToDeg(2 * Math.atan(Math.tan(T.MathUtils.degToRad(18)) * wanted / radius));
    this.camera.aspect = w / h;
    this.camera.setViewOffset(w, h, w / 2 - (r.left + r.width / 2), h / 2 - (r.top + r.height / 2), w, h);
    this.camera.position.set(Math.sin(this.angle) * radius, radius * .25, Math.cos(this.angle) * radius);
    this.camera.lookAt(0, .65, 0); this.camera.updateProjectionMatrix();
    if (garage || market) {
      // Fit the actual car into the clear UI rectangle at every rotation.
      // Contact-shadow planes must not make a small car look far away.
      const center = this.bounds.getCenter(new T.Vector3());
      const direction = new T.Vector3(Math.sin(this.angle), market ? .17 : .24, Math.cos(this.angle)).normalize();
      this.camera.position.copy(center).add(direction);
      this.camera.lookAt(center);
      const inverse = this.camera.quaternion.clone().invert();
      const tan = Math.tan(T.MathUtils.degToRad(this.camera.fov / 2));
      const horizontal = tan * r.width / h * .88;
      const vertical = tan * Math.max(60, r.height - (market ? 55 : 110)) / h * .9;
      let distance = 5;
      for (const x of [this.bounds.min.x, this.bounds.max.x])
        for (const y of [this.bounds.min.y, this.bounds.max.y])
          for (const z of [this.bounds.min.z, this.bounds.max.z]) {
            const corner = new T.Vector3(x, y, z).sub(center).applyQuaternion(inverse);
            distance = Math.max(distance, corner.z + Math.abs(corner.x) / horizontal,
              corner.z + Math.abs(corner.y) / vertical);
          }
      // Short phone layouts need a wider lens, not a camera behind the
      // workshop walls. Keep the same projected car size inside the room.
      if (garage && distance > 11) {
        this.camera.fov = T.MathUtils.radToDeg(2 * Math.atan(tan * distance / 11));
        this.camera.updateProjectionMatrix();
        distance = 11;
      }
      this.camera.position.copy(center).addScaledVector(direction, distance);
      this.camera.lookAt(center);
    }
    // the car on the turntable reflects studio softboxes: the photo-shoot look
    if (this.car && this.lit !== this.key) {
      lightCars(this.car, this.carEnv, .85);
      this.lit = this.key;
    }
    renderer.render(this.scene, this.camera);
  }
}
