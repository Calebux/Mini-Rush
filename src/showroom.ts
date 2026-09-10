import * as T from 'three';
import { AssetLibrary, disposeCarInstance } from './assets';
import type { CarSpec } from './cars';
import { buildReflectionSky, environmentTheme } from './environment';
import { MAPS } from './maps';

/** One renderer, a separate warmly lit scene: menu lighting never changes a race. */
export class Showroom {
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(36, 1, .1, 100);
  private car: T.Group | null = null;
  private key = '';
  private angle = .65;
  private dragX: number | null = null;
  private stage: HTMLElement | null = null;
  private bounds = new T.Box3();
  constructor(private assets: AssetLibrary) {
    // Racing green & gold: a dark, warm showroom, so the car is the brightest
    // thing on screen instead of competing with pale walls.
    this.scene.background = new T.Color(0x0b1410);
    this.scene.environment = buildReflectionSky({ ...environmentTheme(MAPS[0]), sky: 0x3e4843, horizon: 0x6e6448 });
    this.scene.environmentIntensity = .85;
    this.scene.add(new T.HemisphereLight(0xdfe8df, 0x0e1511, 1.4));
    const sun = new T.DirectionalLight(0xfff0d6, 3.8); sun.position.set(-5, 9, 5); sun.castShadow = true;
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: .5, far: 30 });
    sun.shadow.mapSize.set(1024, 1024); sun.shadow.normalBias = .03; sun.shadow.bias = -.0002; this.scene.add(sun);
    const fill = new T.DirectionalLight(0xa8ccb8, 1.2); fill.position.set(6, 4, -3); this.scene.add(fill);
    const mat = (color: number, metalness = 0) => new T.MeshStandardMaterial({ color, roughness: .66, metalness });
    const floor = mat(0x171b19), wall = mat(0x131816), racing = mat(0x0f3d2e), steel = mat(0x3b423e, .6);
    const gold = new T.MeshStandardMaterial({ color: 0xd4af37, roughness: .35, metalness: .85 });
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, material: T.Material) => {
      const m = new T.Mesh(new T.BoxGeometry(w, h, d), material); m.position.set(x, y, z); m.receiveShadow = m.castShadow = true; this.scene.add(m); return m;
    };
    box(70, .2, 70, 0, -.14, 0, floor);
    box(28, 7, .25, 0, 3.4, -6, wall);
    box(28, 1.2, .30, 0, .55, -5.97, racing);
    for (const x of [-9, -3, 3, 9]) {
      box(.17, 7, .5, x, 3.4, -5.7, steel);
      box(4.7, 2.2, .1, x + 2.9, 4.75, -5.8, new T.MeshStandardMaterial({ color: 0x16241d, emissive: 0x2a4636, emissiveIntensity: .35 }));
      for (const dx of [1.4, 2.9, 4.4]) box(.055, 2.2, .17, x + dx, 4.75, -5.69, steel);
      box(4.7, .055, .17, x + 2.9, 4.75, -5.68, steel);
    }
    box(3.8, 2.8, .16, -5, 1.7, -5.7, racing);
    for (let i = 0; i < 12; i++) box(3.75, .025, .05, -5, .4 + i * .22, -5.59, steel);
    box(3.2, 1, .72, 4, .5, -4.9, racing); box(3.5, .12, .90, 4, 1.06, -4.9, gold);
    for (const x of [2.95, 4, 5.05]) for (const y of [.28, .56, .84]) box(.48, .025, .035, x, y, -4.52, steel);
    const plinth = new T.Mesh(new T.CylinderGeometry(3.25, 3.32, .08, 80), mat(0x1d2320, .3)); plinth.position.y = -.025; plinth.receiveShadow = true; this.scene.add(plinth);
    const ring = new T.Mesh(new T.RingGeometry(3.10, 3.13, 80), new T.MeshBasicMaterial({ color: 0xd4af37, side: T.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = .018; this.scene.add(ring);
    for (const x of [-3.8, 3.8]) for (let z = -3; z < 4; z++) box(.12, .012, .4, x, -.025, z, gold);
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#0f3d2e'; ctx.fillRect(0, 0, 1024, 256);
    ctx.fillStyle = '#d4af37'; ctx.textAlign = 'center'; ctx.font = '900 105px sans-serif'; ctx.fillText('MINIRUSH', 512, 120);
    ctx.font = '600 32px sans-serif'; ctx.fillText('C U S T O M S   /   L A G O S', 512, 188);
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
    const sign = new T.Mesh(new T.PlaneGeometry(3.9, .975), new T.MeshBasicMaterial({ map: texture })); sign.position.set(.05, 2.5, -5.73); this.scene.add(sign);
    for (const id of ['home-car-stage', 'workshop-car-stage', 'garage-car-stage']) {
      const el = document.getElementById(id)!;
      el.addEventListener('pointerdown', e => { this.dragX = e.clientX; el.setPointerCapture(e.pointerId); });
      el.addEventListener('pointermove', e => { if (this.dragX !== null) { this.angle += (e.clientX - this.dragX) * .008; this.dragX = e.clientX; } });
      const stop = () => { this.dragX = null; }; el.addEventListener('pointerup', stop); el.addEventListener('pointercancel', stop);
      el.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); this.angle += e.key === 'ArrowLeft' ? -.2 : .2; } });
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
  render(renderer: T.WebGLRenderer, workshop: boolean, garage = false): void {
    this.stage = document.getElementById(garage ? 'garage-car-stage' : workshop ? 'workshop-car-stage' : 'home-car-stage');
    const r = this.stage!.getBoundingClientRect();
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    if (!w || !h || !r.width || !r.height) return;
    const radius = Math.max(8.5, h / r.height * 5.1, h / r.width * 7.1);
    this.camera.aspect = w / h;
    this.camera.setViewOffset(w, h, w / 2 - (r.left + r.width / 2), h / 2 - (r.top + r.height / 2), w, h);
    this.camera.position.set(Math.sin(this.angle) * radius, radius * .39, Math.cos(this.angle) * radius);
    this.camera.lookAt(0, .65, 0); this.camera.updateProjectionMatrix();
    if (garage) {
      // Fit the actual car into the clear UI rectangle at every rotation.
      // Contact-shadow planes must not make a small car look far away.
      const center = this.bounds.getCenter(new T.Vector3());
      const direction = new T.Vector3(Math.sin(this.angle), .32, Math.cos(this.angle)).normalize();
      this.camera.position.copy(center).add(direction);
      this.camera.lookAt(center);
      const inverse = this.camera.quaternion.clone().invert();
      const tan = Math.tan(T.MathUtils.degToRad(this.camera.fov / 2));
      const horizontal = tan * r.width / h * .88;
      const vertical = tan * Math.max(60, r.height - 110) / h * .9;
      let distance = 5;
      for (const x of [this.bounds.min.x, this.bounds.max.x])
        for (const y of [this.bounds.min.y, this.bounds.max.y])
          for (const z of [this.bounds.min.z, this.bounds.max.z]) {
            const corner = new T.Vector3(x, y, z).sub(center).applyQuaternion(inverse);
            distance = Math.max(distance, corner.z + Math.abs(corner.x) / horizontal,
              corner.z + Math.abs(corner.y) / vertical);
          }
      this.camera.position.copy(center).addScaledVector(direction, distance);
      this.camera.lookAt(center);
    }
    renderer.render(this.scene, this.camera);
  }
}
