import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CarSpec } from './cars';
import { buildCar, CAR_COLORS, carGroundFx } from './meshes';
import { toonify } from './toon';

/**
 * Loads real kit models from /assets/models when present, falling back to
 * procedural stand-ins. Drop-in filenames (see assets/README.md):
 *
 *   car_player.glb            — your hero car   (PSX-style cars / RCP4)
 *   car_traffic_1..6.glb      — traffic cars    (PSX-style cars / RCP4)
 *   city_building_1..8.glb    — city blocks     (Downtown City MegaKit)
 *   desert_building_1..8.glb  — desert blocks   (Voxel Desert Town)
 *   prop_streetlight.glb, prop_cactus_1..3.glb, plane_bonus.glb (Voxel Plane)
 */
export class AssetLibrary {
  playerCar: THREE.Group | null = null;
  // fixed slots (not push) so CarSpec.model indexes stay stable across
  // whichever async load order the GLBs resolve in
  trafficCars: (THREE.Group | null)[] = [null, null, null, null, null, null];
  cityBuildings: THREE.Group[] = [];
  desertBuildings: THREE.Group[] = [];
  medievalBuildings: THREE.Group[] = [];
  zombies: THREE.Group[] = [];
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
    for (let i = 1; i <= 4; i++) {
      jobs.push(this.tryLoad(`zombie_${i}.glb`, 1.7, 'y').then((m) => {
        if (m) this.zombies.push(m);
      }));
    }
    for (let i = 1; i <= 3; i++) {
      jobs.push(this.tryLoad(`prop_cactus_${i}.glb`, 2.4, 'y').then((m) => {
        if (m) this.cacti.push(m);
      }));
    }
    await Promise.all(jobs);

    // no zombie GLBs → try the sprite-sheet pack (Zombie Sprite Sheet Pack,
    // square frames in a horizontal strip) as crossed pixel billboards
    if (this.zombies.length === 0) {
      const sheets = await Promise.all(
        [1, 2, 3].map((i) => this.trySprite(`zombie_${i}.png`))
      );
      for (const tex of sheets) {
        if (tex) this.zombies.push(spriteBillboard(tex, 1.7));
      }
    }
  }

  /** Load a sprite sheet from /assets/sprites; null when the pack is absent. */
  private trySprite(file: string): Promise<THREE.Texture | null> {
    return new Promise((resolve) => {
      new THREE.TextureLoader().load(
        `${import.meta.env.BASE_URL}assets/sprites/${file}`,
        (t) => resolve(t),
        undefined,
        () => resolve(null)
      );
    });
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
    return g;
  }

  /** Clone the garage pick for the player; procedural fallback if missing. */
  cloneCar(spec: CarSpec): THREE.Group {
    const src = spec.model < 0 ? this.playerCar : this.trafficCars[spec.model];
    if (!src) return buildCar(Math.max(0, CAR_COLORS.indexOf(spec.color)));
    const g = src.clone(true);
    g.add(carGroundFx(spec.color));
    return g;
  }

  /**
   * Load one GLB and normalize it: sit on y=0, centered on x/z, scaled so its
   * largest ('max') or vertical ('y') dimension equals targetSize.
   * flip: rotate 180° for kits authored front-at-+z (the game wants -z inside
   * the wrapper; the drive code adds its own π).
   */
  private tryLoad(
    file: string, targetSize: number, axis: 'max' | 'y' = 'max', flip = false, paint?: number
  ): Promise<THREE.Group | null> {
    return new Promise((resolve) => {
      this.loader.load(
        this.base + file,
        (gltf) => {
          const g = gltf.scene;
          toonify(g, paint); // match the game's cel look
          if (flip) g.rotation.y = Math.PI; // applied before box math below
          const box = new THREE.Box3().setFromObject(g);
          const size = box.getSize(new THREE.Vector3());
          const dim = axis === 'y' ? size.y : Math.max(size.x, size.y, size.z);
          const s = dim > 0 ? targetSize / dim : 1;
          g.scale.setScalar(s);
          box.setFromObject(g);
          const center = box.getCenter(new THREE.Vector3());
          g.position.set(-center.x, -box.min.y, -center.z);
          const wrapper = new THREE.Group();
          wrapper.add(g);
          resolve(wrapper);
        },
        undefined,
        () => resolve(null) // missing file → procedural fallback, not an error
      );
    });
  }
}

/**
 * Two crossed planes showing frame 0 of a horizontal strip of square frames,
 * feet on y=0 — reads from every angle without per-frame camera billboarding,
 * and survives the squash (scale.y) the entities layer applies.
 */
function spriteBillboard(tex: THREE.Texture, height: number): THREE.Group {
  const img = tex.image as { width: number; height: number };
  const frames = Math.max(1, Math.round(img.width / img.height));
  tex.repeat.x = 1 / frames;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide
  });
  const g = new THREE.Group();
  for (const rot of [0, Math.PI / 2]) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(height, height), mat);
    plane.position.y = height / 2;
    plane.rotation.y = rot;
    g.add(plane);
  }
  return g;
}
