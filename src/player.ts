import * as THREE from 'three';
import { AssetLibrary } from './assets';
import { CarSpec } from './cars';
import {
  ACCEL, BASE_SPEED, BRAKE, BRAKE_SPEED, CENTRIFUGAL, COAST_DECEL, COAST_SPEED,
  END_SPEED_BONUS, NITRO_SPEED, NITRO_TIME, OFFROAD_SPEED, ROAD_HALF_WIDTH,
  WALL_CRASH_DRIFT, WALL_CRASH_MIN_V
} from './constants';
import { Track } from './track';

export class Player {
  readonly mesh: THREE.Group;
  s = 0;
  x = 0;
  v = 0;
  nitroTanks = 1; // start with one
  nitroTimer = 0;
  finished = false;
  raceLength = 0; // laps × track length; set by the game each race

  damage = 0;      // Burnout: recent hits taken; three inside a window = wreck
  lastHitAt = -10;
  tumbleT = 0;     // > 0 = wrecked and rolling, controls are dead
  wallHit = 0;     // per-frame: 1 = grazed the road edge, 2 = corner-slam crash

  private rollA = 0;
  private xVel = 0;
  private driftV = 0; // outward velocity owed to corner force alone (not steering)
  private bumpCooldown = 0;
  private steerLean = 0;
  private latV = 0; // smoothed real lateral velocity (drag steering bypasses xVel)

  private static readonly TUMBLE_TIME = 1.4;

  constructor(
    scene: THREE.Scene, assets: AssetLibrary, private track: Track,
    private spec: CarSpec
  ) {
    this.mesh = assets.cloneCar(spec);
    scene.add(this.mesh);
  }

  reset(gridSlot: { s: number; x: number }): void {
    this.s = gridSlot.s;
    this.x = gridSlot.x;
    this.v = 0;
    this.xVel = 0;
    this.driftV = 0;
    this.wallHit = 0;
    this.latV = 0;
    this.nitroTanks = 1;
    this.nitroTimer = 0;
    this.finished = false;
    this.bumpCooldown = 0;
    this.damage = 0;
    this.lastHitAt = -10;
    this.tumbleT = 0;
    this.rollA = 0;
    this.syncMesh(0);
  }

  /** Burnout wreck: barrel roll, big speed dump, controls dead until upright. */
  wreck(): void {
    this.tumbleT = Player.TUMBLE_TIME;
    this.rollA = 0;
    this.damage = 0;
    this.v *= 0.2;
    this.nitroTimer = 0;
    this.driftV = 0;
    this.xVel = 0;
  }

  get offroad(): boolean {
    return Math.abs(this.x) > ROAD_HALF_WIDTH + 0.3;
  }

  /** Sliding sideways hard enough to smoke the tires. */
  get drifting(): boolean {
    return this.v > 16 && Math.abs(this.latV) > 3.2 && !this.offroad;
  }

  /** Kicking up dust off the asphalt. */
  get dusting(): boolean {
    return this.offroad && this.v > 7;
  }

  get nitroActive(): boolean {
    return this.nitroTimer > 0;
  }

  fireNitro(): boolean {
    if (this.nitroTanks <= 0 || this.nitroTimer > 0 || this.tumbleT > 0) return false;
    this.nitroTanks--;
    this.nitroTimer = NITRO_TIME * this.spec.nitro;
    return true;
  }

  bump(pushDir: number, shove = 6): void {
    if (this.bumpCooldown > 0) return;
    this.bumpCooldown = 0.5;
    this.v *= 0.72;
    this.xVel += pushDir * shove;
  }

  get canBump(): boolean {
    return this.bumpCooldown <= 0;
  }

  /** Current steering lean (for the gun HUD sway). */
  get lean(): number {
    return this.steerLean;
  }

  /** dragPx: pixels of horizontal drag this frame; keySteer: -1..1 held. */
  update(
    dt: number, elapsed: number, dragPx: number, keySteer: number,
    driving: boolean, braking = false, gas = true
  ): void {
    this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);
    this.nitroTimer = Math.max(0, this.nitroTimer - dt);
    if (this.damage > 0 && elapsed - this.lastHitAt > 3.5) this.damage = 0;
    if (this.tumbleT > 0) {
      this.tumbleT -= dt;
      this.rollA += dt * 9;
      dragPx = 0;
      keySteer = 0;
      braking = false;
      gas = false;
    }

    // longitudinal — the gas pedal sets the target; lifting off coasts down
    // gently, braking scrubs speed hard, which also kills the v² corner
    // push, so brake-into-corner is the way to hit a tight apex
    const progression =
      Math.min(1, this.s / (this.raceLength || this.track.length)) * END_SPEED_BONUS;
    let target = 0;
    if (driving) {
      target = this.nitroActive
        ? NITRO_SPEED * this.spec.speed
        : gas
          ? BASE_SPEED * this.spec.speed + progression
          : COAST_SPEED;
      if (this.offroad && !this.nitroActive) target = Math.min(target, OFFROAD_SPEED);
      if (braking && !this.nitroActive) target = Math.min(target, BRAKE_SPEED);
      if (this.tumbleT > 0) target = 2;
    }
    let rate: number;
    if (this.v < target) rate = ACCEL * this.spec.accel * (this.nitroActive ? 1.8 : 1);
    else if (braking) rate = BRAKE * 1.6;
    else if (this.offroad || gas) rate = BRAKE;
    else rate = COAST_DECEL;
    this.v = THREE.MathUtils.damp(this.v, target, rate / Math.max(this.v, 8), dt * 8);
    this.s += this.v * dt;

    // lateral: direct drag + held keys + centrifugal push in corners.
    // +x is the driver's LEFT, so screen-right input subtracts.
    const dragMeters = (driving ? dragPx : 0) * (13 / window.innerWidth) * this.spec.grip;
    const f = this.track.frame(this.s);
    // grippy cars steer harder AND shrug off more of the corner push
    const cornerPush = f.curvature * this.v * this.v * CENTRIFUGAL * (2 - this.spec.grip) * dt;
    this.xVel += cornerPush;
    this.xVel -= keySteer * 55 * this.spec.grip * dt;
    this.xVel *= Math.exp(-6 * dt);
    // driftV shadows xVel but only ever hears the corner force — at the wall
    // it tells "thrown wide by speed" (crash) apart from "steered into it"
    this.driftV = (this.driftV + cornerPush) * Math.exp(-6 * dt);
    const prevX = this.x;
    this.x += this.xVel * dt - dragMeters;
    this.wallHit = 0;
    // barrier slam: carried OFF the road by corner force at speed. Checked at
    // the road edge (where the barriers stand) — beyond it the offroad strip
    // scrubs so much speed that a "crash" out there would never feel earned.
    const roadEdge = ROAD_HALF_WIDTH + 0.3;
    if (driving && this.tumbleT <= 0
      && Math.abs(prevX) <= roadEdge && Math.abs(this.x) > roadEdge) {
      const outward = Math.sign(this.x);
      // drift toward THIS side only; drag steering never enters driftV
      if (this.driftV * outward > WALL_CRASH_DRIFT && this.v > WALL_CRASH_MIN_V) {
        this.wallHit = 2;
      }
    }
    const edge = ROAD_HALF_WIDTH + 2.6;
    if (Math.abs(this.x) > edge) {
      const outward = Math.sign(this.x);
      this.x = outward * edge;
      if (this.tumbleT <= 0) {
        if (this.wallHit === 0) this.wallHit = 1; // scraping the outer wall
        this.xVel = Math.min(this.xVel * outward, 0) * outward; // kill outward velocity
        this.driftV = 0;
      }
    }
    this.latV = THREE.MathUtils.damp(this.latV, (this.x - prevX) / Math.max(dt, 1e-4), 8, dt);

    this.steerLean = THREE.MathUtils.damp(
      this.steerLean,
      THREE.MathUtils.clamp(this.xVel * 0.05 - dragMeters * 2.2, -0.45, 0.45),
      10, dt
    );
    this.syncMesh(elapsed);
  }

  private syncMesh(elapsed: number): void {
    this.track.place(this.mesh, this.s, this.x);
    this.mesh.rotation.y += Math.PI + this.steerLean; // model faces +z; flip down-track
    this.mesh.rotation.z = -this.steerLean * 0.25;
    this.mesh.position.y = Math.sin(elapsed * 24) * 0.012 + (this.offroad ? Math.abs(Math.sin(elapsed * 30)) * 0.05 : 0);
    if (this.tumbleT > 0) {
      const k = 1 - this.tumbleT / Player.TUMBLE_TIME;
      this.mesh.rotation.z = this.rollA;
      this.mesh.position.y += Math.sin(Math.min(1, k) * Math.PI) * 1.1;
    }
  }
}
