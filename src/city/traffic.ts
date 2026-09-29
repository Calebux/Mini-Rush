import * as THREE from 'three';
import type { AssetLibrary } from '../assets';
import { disposeCarInstance } from '../assets';
import { buildDanfo } from '../danfo';
import { CityDrive } from './drive';
import { BLOCKS, HALF, STREET, streetAt } from './layout';

interface CityTrafficCar {
  mesh: THREE.Group;
  axis: 'x' | 'z';
  lane: number;
  line: number;
  direction: number;
  speed: number;
  cooldown: number;
}

const LANES = [-3.5, 3.5];
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};

/** Civilian traffic for free roam. Cars loop city streets and collide softly. */
export class CityTraffic {
  private cars: CityTrafficCar[] = [];
  private rand: () => number;

  constructor(private scene: THREE.Scene, assets: AssetLibrary, count = 16) {
    this.rand = rng(0x4e454f4e);
    for (let i = 0; i < count; i++) {
      const mesh = i % 4 === 0 ? buildDanfo() : assets.cloneTraffic(i + 2);
      if (!mesh) continue;
      mesh.userData.cityTraffic = true;
      scene.add(mesh);
      const axis = i % 2 === 0 ? 'x' : 'z';
      const lane = i % LANES.length;
      const line = streetAt(1 + (i * 3) % (BLOCKS - 1));
      const direction = this.rand() < 0.5 ? -1 : 1;
      const car: CityTrafficCar = {
        mesh, axis, lane, line, direction, speed: 9 + this.rand() * 10, cooldown: 0
      };
      this.cars.push(car);
      this.place(car, i);
    }
  }

  private place(car: CityTrafficCar, index: number): void {
    const span = HALF - STREET;
    const progress = -span + ((index * 97) % Math.max(1, Math.floor(span * 2)));
    if (car.axis === 'x') {
      car.mesh.position.set(progress, 0, car.line + LANES[car.lane]);
      car.mesh.rotation.y = car.direction > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      car.mesh.position.set(car.line + LANES[car.lane], 0, progress);
      car.mesh.rotation.y = car.direction > 0 ? 0 : Math.PI;
    }
  }

  update(dt: number, player: CityDrive): void {
    for (const car of this.cars) {
      const p = car.mesh.position;
      if (car.axis === 'x') p.x += car.direction * car.speed * dt;
      else p.z += car.direction * car.speed * dt;
      const span = HALF - STREET;
      const value = car.axis === 'x' ? p.x : p.z;
      if (value > span + 18) {
        if (car.axis === 'x') p.x = -span - 18;
        else p.z = -span - 18;
      } else if (value < -span - 18) {
        if (car.axis === 'x') p.x = span + 18;
        else p.z = span + 18;
      }
      if (car.cooldown > 0) car.cooldown -= dt;
      const dx = p.x - player.x, dz = p.z - player.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 4.0 && distance > 0.01 && car.cooldown <= 0) {
        const nx = dx / distance, nz = dz / distance;
        player.bumpFromTraffic(-nx, -nz, Math.max(3, 13 - distance * 2));
        p.x += nx * 1.7;
        p.z += nz * 1.7;
        car.cooldown = 0.55;
      }
    }
  }

  dispose(): void {
    for (const car of this.cars) {
      this.scene.remove(car.mesh);
      disposeCarInstance(car.mesh);
    }
    this.cars.length = 0;
  }
}
