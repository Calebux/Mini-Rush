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
  /** half its length and width: the box other cars can't drive into */
  halfLen: number;
  halfWid: number;
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
      // measured facing +z, before place() turns it onto its street
      const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
      const car: CityTrafficCar = {
        mesh, axis, lane, line, direction, speed: 9 + this.rand() * 10, cooldown: 0,
        halfLen: THREE.MathUtils.clamp(size.z / 2, 1.8, 3.2), halfWid: THREE.MathUtils.clamp(size.x / 2, 0.8, 1.3)
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

  /**
   * Push a car (a police cruiser) out of every civilian car it overlaps —
   * each one a solid box along its street, not a ghost — and bounce it off.
   * Returns the hardest closing speed, and the way it was pushed.
   */
  block(drive: CityDrive, radius = 1.15): { hit: number; nx: number; nz: number } {
    const out = { hit: 0, nx: 0, nz: 0 };
    for (const car of this.cars) {
      const p = car.mesh.position;
      const dx = drive.x - p.x, dz = drive.z - p.z;
      if (Math.abs(dx) > 6 || Math.abs(dz) > 6) continue;
      const alongX = car.axis === 'x';
      // in the car's frame: a along its street, c across it
      const a = alongX ? dx : dz, c = alongX ? dz : dx;
      let na = a - THREE.MathUtils.clamp(a, -car.halfLen, car.halfLen);
      let nc = c - THREE.MathUtils.clamp(c, -car.halfWid, car.halfWid);
      let dist = Math.hypot(na, nc);
      if (dist >= radius) continue;
      let depth: number;
      if (dist > 1e-4) {
        na /= dist; nc /= dist;
        depth = radius - dist;
      } else {
        // centre inside the box: out through the nearer side
        const endGap = car.halfLen - Math.abs(a), sideGap = car.halfWid - Math.abs(c);
        if (endGap < sideGap) { na = Math.sign(a) || 1; nc = 0; depth = endGap + radius; }
        else { na = 0; nc = Math.sign(c) || 1; depth = sideGap + radius; }
      }
      const nx = alongX ? na : nc, nz = alongX ? nc : na;
      drive.x += nx * depth;
      drive.z += nz * depth;
      // bounce off the civilian's own motion along its street
      const vx = alongX ? car.direction * car.speed : 0, vz = alongX ? 0 : car.direction * car.speed;
      const into = -((drive.vel.x - vx) * nx + (drive.vel.y - vz) * nz);
      if (into > 0) {
        // how hard it drove in on its own: being rear-ended by a civilian is not ploughing into one
        const own = -(drive.vel.x * nx + drive.vel.y * nz);
        drive.vel.x += nx * into * 1.25;
        drive.vel.y += nz * into * 1.25;
        if (into > 3) drive.vel.multiplyScalar(0.8);
        if (own > out.hit) { out.hit = own; out.nx = nx; out.nz = nz; }
      }
    }
    return out;
  }

  /** Moves the traffic; returns how hard the player hit it this frame (0 = clean). */
  update(dt: number, player: CityDrive): number {
    let hit = 0;
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
        const closing = Math.hypot(player.vel.x, player.vel.y);
        hit = Math.max(hit, closing);
        player.bumpFromTraffic(-nx, -nz, Math.max(3, 13 - distance * 2));
        p.x += nx * 1.7;
        p.z += nz * 1.7;
        car.cooldown = 0.55;
      }
    }
    return hit;
  }

  dispose(): void {
    for (const car of this.cars) {
      this.scene.remove(car.mesh);
      disposeCarInstance(car.mesh);
    }
    this.cars.length = 0;
  }
}
