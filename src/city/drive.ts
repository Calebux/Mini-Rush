import * as THREE from 'three';
import { BASE_SPEED } from '../constants';
import {
  blockAt, BRIDGE_HALF, BRIDGE_Z, CITY_BLOCKS, EAST_ISLAND_X0, EAST_ISLAND_X1,
  EAST_ISLAND_Z0, EAST_ISLAND_Z1, EDGE
} from './layout';

/**
 * Arcade car for the open city. The race car rides a spline; this one goes
 * where it is pointed. Velocity lives in the world and the heading turns
 * under it: whatever part of the velocity no longer points where the car
 * does is sideways slip, and grip bleeds it away. Low grip is a drift.
 */

export interface DriveInput {
  steer: number;   // -1 left .. 1 right
  gas: boolean;
  brake: boolean;
  /** Locks the rear: the tail lets go and the car drifts. */
  handbrake?: boolean;
}

const RADIUS = 1.15;           // the car as a circle, for kerbs and walls
const ACCEL = 17;              // m/s² at a standstill, tapering to top speed
const BRAKE = 28;              // foot brake, m/s²: hard, straight, no slide
const HANDBRAKE = 7;           // the handbrake scrubs less speed: it is for turning
const REVERSE_TOP = 6.5;            // ~23 km/h backwards
const REVERSE_DELAY = 0.3;     // seconds stopped with the brake held before it reverses
const GRIP = 9;                // how fast sideways slip dies, per second
const BRAKING_GRIP = 11;       // braking loads the front: a touch more bite
const DRIFT_GRIP = 1.9;        // handbrake at speed: the tail lets go
const NITRO_TIME = 2.6;
const NITRO_RECHARGE = 9;      // seconds for an empty tank to refill

export class CityDrive {
  x = 0;
  z = 0;
  yaw = 0;                     // model faces +z at yaw 0
  readonly vel = new THREE.Vector2();
  steer = 0;                   // smoothed input
  slip = 0;                    // sideways speed, m/s: > 4 reads as a drift
  nitro = 1;                   // 0..1 tank
  nitroT = 0;                  // seconds of boost left
  /** Per-frame: how hard the car hit something this frame, 0 when it did not. */
  impact = 0;
  /** The brake lights are on: slowing under the brake, or the handbrake. */
  braking = false;
  /** Going backwards under the brake pedal: the white reversing lights. */
  reversing = false;
  private stoppedFor = 0;

  constructor(private topSpeed: number, private accelMul: number) {}

  static forSpec(spec: { speed: number; accel: number }): CityDrive {
    return new CityDrive(BASE_SPEED * spec.speed * 1.08, spec.accel);
  }

  get forward(): THREE.Vector2 {
    return new THREE.Vector2(Math.sin(this.yaw), Math.cos(this.yaw));
  }

  /** Signed speed along the nose. */
  get speed(): number {
    return this.vel.x * Math.sin(this.yaw) + this.vel.y * Math.cos(this.yaw);
  }

  get boosting(): boolean {
    return this.nitroT > 0;
  }

  fireNitro(): boolean {
    if (this.nitro < 0.999 || this.nitroT > 0) return false;
    this.nitro = 0;
    this.nitroT = NITRO_TIME;
    return true;
  }

  update(dt: number, input: DriveInput): void {
    this.impact = 0;
    this.steer += (input.steer - this.steer) * Math.min(1, dt * 7);
    if (this.nitroT > 0) this.nitroT = Math.max(0, this.nitroT - dt);
    else this.nitro = Math.min(1, this.nitro + dt / NITRO_RECHARGE);

    let fwd = this.speed;
    const top = this.topSpeed * (this.boosting ? 1.45 : 1);
    const handbrake = !!input.handbrake;
    // The brake pedal stops the car; only once it has sat still for a moment
    // does holding it back the car up. Gas while rolling backwards brakes too.
    this.stoppedFor = input.brake && Math.abs(fwd) < 0.6 ? this.stoppedFor + dt : 0;
    if (this.boosting) {
      fwd += ACCEL * 1.6 * dt;
    } else if (input.gas && !input.brake) {
      fwd += (fwd < -0.5 ? BRAKE : ACCEL * this.accelMul * Math.max(0.12, 1 - Math.max(0, fwd) / top)) * dt;
    } else if (input.brake && fwd > 0.5) {
      fwd = Math.max(0, fwd - BRAKE * dt);
    } else if (input.brake && (fwd < -0.5 || this.stoppedFor > REVERSE_DELAY)) {
      fwd = Math.max(-REVERSE_TOP, fwd - ACCEL * 0.6 * dt);
    } else if (input.brake) {
      fwd = 0; // held at a standstill until the reverse kicks in
    } else {
      fwd -= fwd * 0.35 * dt + Math.sign(fwd) * 1.2 * dt; // rolling resistance
      if (Math.abs(fwd) < 0.3) fwd = 0;
    }
    fwd = Math.min(fwd, top);

    // Turn rate needs rolling speed, and fades at the top end so the car is
    // stable flat out. Reversing turns the other way, like a real car.
    const moving = THREE.MathUtils.clamp(Math.abs(fwd) / 7, 0, 1);
    const turn = this.steer * 2.3 * moving / (1 + Math.abs(fwd) / 30) * Math.sign(fwd || 1);
    this.yaw -= turn * dt;

    // rebuild the velocity: the nose's speed plus whatever slip survives
    const f = this.forward;
    const r = new THREE.Vector2(f.y, -f.x);
    let side = this.vel.dot(r);
    const drifting = handbrake && fwd > 8;
    const braking = input.brake && fwd > 0.5;
    side *= Math.exp(-(drifting ? DRIFT_GRIP : braking ? BRAKING_GRIP : GRIP) * dt);
    // the handbrake scrubs a little speed; the drift carries the rest round
    if (handbrake) fwd = Math.max(0, fwd - HANDBRAKE * dt);
    this.braking = braking || (handbrake && fwd > 0.5) || (input.gas && fwd < -0.5);
    this.reversing = input.brake && fwd < -0.5;
    this.slip = side;
    this.vel.set(f.x * fwd + r.x * side, f.y * fwd + r.y * side);

    this.x += this.vel.x * dt;
    this.z += this.vel.y * dt;
    this.collide();
  }

  /** A civilian car can shove the player without reaching into wall physics. */
  bumpFromTraffic(nx: number, nz: number, force: number): void {
    this.x += nx * 0.35;
    this.z += nz * 0.35;
    this.vel.x += nx * force;
    this.vel.y += nz * force;
    this.impact = Math.max(this.impact, force);
  }

  /** Kerbs of the blocks around the car and the expressway's outer wall. */
  private collide(): void {
    const near = [blockAt(this.x, this.z)];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      near.push(blockAt(this.x + dx * 20, this.z + dz * 20));
    }
    const seen = new Set<number>();
    for (const block of near) {
      if (!block) continue;
      const id = block.i * 1000 + block.j;
      if (seen.has(id)) continue;
      seen.add(id);
      this.pushOut(block.x0, block.z0, block.x1, block.z1);
    }
    const lim = EDGE - RADIUS;
    const island = this.x > EAST_ISLAND_X0 && this.x < EAST_ISLAND_X1
      && this.z > EAST_ISLAND_Z0 + RADIUS && this.z < EAST_ISLAND_Z1 - RADIUS;
    const bridge = this.x > EDGE - RADIUS && this.x < EAST_ISLAND_X0
      && Math.abs(this.z - BRIDGE_Z) < BRIDGE_HALF - RADIUS;
    if (!island && !bridge) {
      if (Math.abs(this.x) > lim) this.hit(Math.sign(this.x) * (Math.abs(this.x) - lim), 0);
      if (Math.abs(this.z) > lim) this.hit(0, Math.sign(this.z) * (Math.abs(this.z) - lim));
    } else if (island) {
      if (this.x > EAST_ISLAND_X1 - RADIUS) this.hit(this.x - (EAST_ISLAND_X1 - RADIUS), 0);
      if (this.z > EAST_ISLAND_Z1 - RADIUS) this.hit(0, this.z - (EAST_ISLAND_Z1 - RADIUS));
      if (this.z < EAST_ISLAND_Z0 + RADIUS) this.hit(0, this.z - (EAST_ISLAND_Z0 + RADIUS));
    }
  }

  /** Circle against one kerb rectangle. */
  private pushOut(x0: number, z0: number, x1: number, z1: number): void {
    const cx = THREE.MathUtils.clamp(this.x, x0, x1), cz = THREE.MathUtils.clamp(this.z, z0, z1);
    const dx = this.x - cx, dz = this.z - cz;
    const d = Math.hypot(dx, dz);
    if (d >= RADIUS) return;
    if (d > 1e-4) {
      this.hit(-dx / d * (RADIUS - d), -dz / d * (RADIUS - d));
      return;
    }
    // centre inside the kerb: leave by the nearest side
    const exits = [this.x - x0, x1 - this.x, this.z - z0, z1 - this.z];
    const k = exits.indexOf(Math.min(...exits));
    const push = exits[k] + RADIUS;
    this.hit(k === 0 ? push : k === 1 ? -push : 0, k === 2 ? push : k === 3 ? -push : 0);
  }

  /**
   * Move the car back by (px, pz) — pointing from the wall into it — and take
   * the velocity into the wall away, with a little bounce.
   */
  private hit(px: number, pz: number): void {
    this.x -= px;
    this.z -= pz;
    const len = Math.hypot(px, pz);
    if (len < 1e-6) return;
    const nx = px / len, nz = pz / len; // into the wall
    const into = this.vel.x * nx + this.vel.y * nz;
    if (into <= 0) return;
    this.vel.x -= nx * into * 1.3;
    this.vel.y -= nz * into * 1.3;
    // A real hit costs speed; a car pressed along a wall slides on it.
    if (into > 3) this.vel.multiplyScalar(0.82);
    this.impact = Math.max(this.impact, into);
  }
}

/** Every kerb rectangle, for the minimap. */
export const KERBS = CITY_BLOCKS;
