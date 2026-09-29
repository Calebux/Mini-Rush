import * as T from 'three';
import { AssetLibrary, disposeCarInstance } from './assets';
import type { CarSpec } from './cars';
import { buildGarage } from './garageSet';
import { toonMat } from './toon';
import { lightCars } from './lighting';

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
  private envReady = false;
  private carEnv: T.Texture | null = null;
  constructor(private assets: AssetLibrary) {
    // The garage is modelled in the game's own cel-shaded style
    // (src/garageSet.ts), so the menu looks like the same game as the races.
    // Only the car is realistic: its paint reflects a photograph of a real
    // auto shop (Poly Haven, CC0), which is never shown itself.
    this.scene.background = new T.Color(0x0c0e16);
    buildGarage(this.scene);
    // a display turntable: a dark disc with a thin cyan edge
    const plinth = new T.Mesh(new T.CylinderGeometry(3.25, 3.32, .07, 96), toonMat(0x22262f));
    plinth.position.y = -.03; plinth.receiveShadow = true; this.scene.add(plinth);
    const ring = new T.Mesh(new T.RingGeometry(3.12, 3.18, 96),
      new T.MeshBasicMaterial({ color: new T.Color(0x22e6ff).multiplyScalar(1.1), side: T.DoubleSide, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .012; this.scene.add(ring);
    new T.TextureLoader().load(`${import.meta.env.BASE_URL}assets/env/garage_2k.jpg`, (photo) => {
      photo.mapping = T.EquirectangularReflectionMapping;
      photo.colorSpace = T.SRGBColorSpace;
      this.carEnv = photo;
      this.envReady = true;
      this.lit = ''; // re-light the car now its reflections are in
    });
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
    // A small stage wants the car small. Backing the camera out would leave the
    // garage, so past 11 m it stays put and the lens widens by the same factor:
    // same framing of the car, more of the garage round it.
    const wanted = Math.max(8.5, h / r.height * 5.1, h / r.width * 7.1);
    const radius = Math.min(wanted, 11);
    this.camera.fov = T.MathUtils.radToDeg(2 * Math.atan(Math.tan(T.MathUtils.degToRad(18)) * wanted / radius));
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
    // the car on the turntable reflects studio softboxes: the photo-shoot look
    if (this.car && this.lit !== this.key && this.envReady) {
      // the car reflects the garage around it, once the photo is in
      if (this.carEnv) lightCars(this.car, this.carEnv, 1);
      this.lit = this.key;
    }
    renderer.render(this.scene, this.camera);
  }
}
