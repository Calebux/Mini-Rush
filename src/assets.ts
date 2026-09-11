import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CarSpec } from './cars';
import { buildCar, CAR_COLORS, carGroundFx, polishCar } from './meshes';
import { finishVehicle, toonify } from './toon';
import { buildWorkshopCar } from './workshopCar';

/** Release instance-owned resources, never the cached GLB or shared contact texture. */
export function disposeCarInstance(root: THREE.Group): void {
  const ownedRoot = root.userData.workshopCar ? root : root.getObjectByName('car-ground-fx');
  if (!ownedRoot) return;
  const geometry = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  ownedRoot.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    geometry.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
  });
  geometry.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
}

/**
 * Loads real kit models from /assets/models when present, falling back to
 * procedural stand-ins. Every slot below is optional: a filename that isn't
 * there resolves to null and the car/prop is built procedurally instead, so
 * the repo only ever ships models we hold a license for (see CREDITS.txt).
 * Drop-in filenames (see assets/README.md):
 *
 *   car_player.glb            — your hero car   (PSX-style cars / RCP4)
 *   car_traffic_1..6.glb      — traffic cars    (PSX-style cars / RCP4)
 *   car_super_1..5.glb        — premium garage cars
 *   city_building_1..8.glb    — city blocks     (Downtown City MegaKit)
 *   desert_building_1..8.glb  — desert blocks   (Voxel Desert Town)
 *   prop_streetlight.glb, prop_cactus_1..3.glb, plane_bonus.glb (Voxel Plane)
 */
export class AssetLibrary {
  playerCar: THREE.Group | null = null;
  // fixed slots (not push) so CarSpec.model indexes stay stable across
  // whichever async load order the GLBs resolve in
  trafficCars: (THREE.Group | null)[] = [null, null, null, null, null, null];
  superCars: (THREE.Group | null)[] = [null, null, null, null, null];
  // cars converted from downloaded models by scripts/import-track.mjs
  importedCars: (THREE.Group | null)[] = [null];
  cityBuildings: THREE.Group[] = [];
  desertBuildings: THREE.Group[] = [];
  medievalBuildings: THREE.Group[] = [];
  cacti: THREE.Group[] = [];
  streetlight: THREE.Group | null = null;
  bonusPlane: THREE.Group | null = null;
  wheel: THREE.Group | null = null;

  private loader = new GLTFLoader();
  private base = `${import.meta.env.BASE_URL}assets/models/`;

  async load(): Promise<void> {
    // wheel first: car bodies from kits like GGBot's PSX pack ship wheel-less
    this.wheel = await this.tryLoad('car_wheel.glb', 0.58);

    const jobs: Promise<void>[] = [
      this.tryLoad('car_player.glb', 3.9, 'max', false, CAR_COLORS[0]).then((m) => {
        this.playerCar = m && this.addWheels(m);
      }),
      this.tryLoad('prop_streetlight.glb', 5.0).then((m) => void (this.streetlight = m)),
      this.tryLoad('plane_bonus.glb', 8.0).then((m) => void (this.bonusPlane = m))
    ];
    for (let i = 1; i <= 6; i++) {
      jobs.push(this.tryLoad(`car_traffic_${i}.glb`, 3.8).then((m) => {
        if (m) this.trafficCars[i - 1] = this.addWheels(m);
      }));
    }
    for (let i = 1; i <= 5; i++) {
      const paint = [0x4dd8ff, 0xd8ff2f, 0xff4a1f, 0x2fd8ff, 0x6f7cff][i - 1];
      jobs.push(this.tryLoad(`car_super_${i}.glb`, 4.0, 'max', false, paint).then((m) => {
        if (m) this.superCars[i - 1] = this.addWheels(m);
      }));
    }
    // importedCars[0] (STOCK 88) has no licensed model, so it renders
    // procedurally. The file once loaded here was car_nascar.glb renamed —
    // an unlicensed download wearing real sponsor logos (see CREDITS.md).
    for (let i = 1; i <= 8; i++) {
      jobs.push(this.tryLoad(`city_building_${i}.glb`, 18, 'y').then((m) => {
        if (m) this.cityBuildings.push(m);
      }));
      jobs.push(this.tryLoad(`desert_building_${i}.glb`, 6, 'y').then((m) => {
        if (m) this.desertBuildings.push(m);
      }));
      jobs.push(this.tryLoad(`medieval_building_${i}.glb`, 6, 'y').then((m) => {
        if (m) this.medievalBuildings.push(m);
      }));
    }
    for (let i = 1; i <= 3; i++) {
      jobs.push(this.tryLoad(`prop_cactus_${i}.glb`, 2.4, 'y').then((m) => {
        if (m) this.cacti.push(m);
      }));
    }
    await Promise.all(jobs);
  }

  /** Mount 4 wheels on a wheel-less car body, placed off its bounding box. */
  private addWheels(car: THREE.Group): THREE.Group {
    if (!this.wheel) return car;
    // models that already ship wheels (mesh/material named tire/wheel) skip this
    let hasWheels = false;
    car.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const matName = mesh.isMesh && !Array.isArray(mesh.material) ? mesh.material.name : '';
      if (/wheel|tire|tyre/i.test(`${o.name} ${matName}`)) hasWheels = true;
    });
    if (hasWheels) return car;
    const size = new THREE.Box3().setFromObject(car).getSize(new THREE.Vector3());
    const xOff = size.x / 2 - 0.22;
    const zOff = size.z * 0.3;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const w = this.wheel.clone(true);
      w.position.set(sx * xOff, 0, sz * zOff);
      if (sx > 0) w.rotation.y = Math.PI; // hub face outward on both sides
      car.add(w);
    }
    return car;
  }

  /**
   * Clone a car for rival use; returns null if no kit models were found.
   * avoidModel: traffic slot the player is driving — rivals skip it.
   */
  cloneTraffic(index: number, avoidModel = -1): THREE.Group | null {
    const pool = this.trafficCars
      .map((m, i) => ({ m, i }))
      .filter((e): e is { m: THREE.Group; i: number } => !!e.m && e.i !== avoidModel);
    if (pool.length === 0) return null;
    const pick = pool[index % pool.length];
    const g = pick.m.clone(true);
    g.add(carGroundFx(CAR_COLORS[(pick.i + 1) % CAR_COLORS.length]));
    polishCar(g);
    return g;
  }

  /** Clone the police car for Cop Chase (found by node name, slot 2 fallback). */
  clonePolice(): THREE.Group | null {
    let src = this.trafficCars[2] ?? null;
    for (const car of this.trafficCars) {
      if (!car) continue;
      let hit = false;
      car.traverse((o) => {
        if (/police|cop/i.test(o.name)) hit = true;
      });
      if (hit) { src = car; break; }
    }
    if (!src) return null;
    const g = src.clone(true);
    g.add(carGroundFx(0xff3333));
    polishCar(g);
    return g;
  }

  /** Clone the garage pick for the player; procedural fallback if missing. */
  cloneCar(spec: CarSpec): THREE.Group {
    if (spec.model === 300) {
      const g = buildWorkshopCar(spec);
      g.add(carGroundFx(spec.color));
      return g;
    }
    const model = Number.isSafeInteger(spec.model) ? spec.model : -1;
    const src = model < 0
      ? this.playerCar
      : model >= 200
        ? this.importedCars[model - 200] ?? null
        : model >= 100
          ? this.superCars[model - 100] ?? null
          : this.trafficCars[model] ?? null;
    if (!src) return buildCar(0, spec.color);
    const g = src.clone(true);
    g.add(carGroundFx(spec.color));
    polishCar(g);
    return g;
  }

  /**
   * Load one GLB and normalize it: sit on y=0, centered on x/z, scaled so its
   * largest ('max') or vertical ('y') dimension equals targetSize.
   * All shipped cars face +Z; racers AND traffic use π - track heading.
   * flip is available for future models authored front-at-minus-Z.
   */
  private tryLoad(
    file: string,
    targetSize: number,
    axis: 'max' | 'y' = 'max',
    flip = false,
    paint?: number,
    adjust?: { rotateX?: number; stretchY?: number }
  ): Promise<THREE.Group | null> {
    return new Promise((resolve) => {
      this.loader.load(
        this.base + file,
        (gltf) => {
          if (/(^|\/)car_/.test(file)) finishVehicle(gltf.scene, paint);
          resolve(this.normalizeModel(gltf.scene, targetSize, axis, flip, paint, adjust));
        },
        undefined,
        () => resolve(null) // missing file → procedural fallback, not an error
      );
    });
  }

  private normalizeModel(
    g: THREE.Group,
    targetSize: number,
    axis: 'max' | 'y' = 'max',
    flip = false,
    paint?: number,
    adjust?: { rotateX?: number; stretchY?: number }
  ): THREE.Group {
    if (!g.userData.vehicleFinish) toonify(g, paint);
    if (adjust?.rotateX) g.rotation.x = adjust.rotateX;
    if (flip) g.rotation.y = Math.PI; // applied before box math below
    const box = new THREE.Box3().setFromObject(g);
    const size = box.getSize(new THREE.Vector3());
    const dim = axis === 'y' ? size.y : Math.max(size.x, size.y, size.z);
    const s = dim > 0 ? targetSize / dim : 1;
    g.scale.setScalar(s);
    if (adjust?.stretchY) g.scale.y *= adjust.stretchY;
    box.setFromObject(g);
    const center = box.getCenter(new THREE.Vector3());
    g.position.set(-center.x, -box.min.y, -center.z);
    const wrapper = new THREE.Group();
    wrapper.add(g);
    return wrapper;
  }
}

