import * as THREE from 'three';
import { AssetLibrary } from './assets';
import { CarSpec } from './cars';
import { buildShooterArm, syncCarGroundFx } from './meshes';
import {
  ACCEL, BASE_SPEED, BRAKE, BRAKE_SPEED, CENTRIFUGAL, COAST_DECEL, COAST_SPEED,
  END_SPEED_BONUS, NITRO_SPEED, NITRO_TIME, OFFROAD_SPEED, PLAYER_X_LIMIT,
  ROAD_HALF_WIDTH, WALL_CRASH_DRIFT, WALL_CRASH_MIN_V
} from './constants';
import { Track } from './track';

const GRAVITY = 26; // m/s² pulling the car back down after a ramp jump

export class Player {
  readonly mesh: THREE.Group;
  s = 0;
  x = 0;
  v = 0;
  nitroTanks = 1; // start with one
  nitroTimer = 0;
  finished = false;
  raceLength = 0; // laps × track length; set by the game each race

  damage = 0;      // recent hits taken: three inside the window wreck you in
                   // Burnout, HEAT_LIMIT of them bust you in Police Chase
  damageCool = 3.5; // seconds of clean running that clears the tally
  heatGrace = 0;    // Police Chase: counts down after a PIT; no heat until it's out
  lastHitAt = -10;
  tumbleT = 0;     // > 0 = wrecked and rolling, controls are dead
  wallHit = 0;     // per-frame: 1 = grazed the road edge, 2 = corner-slam crash

  draftGauge = 0;       // 0..1 slipstream charge
  draftingActive = false; // true when inside draft cone behind an AI
  voltageLevel = 100;   // Voltage Surge mode: battery level (0..100)
  voltageMode = false;  // whether voltage mode is active

  airH = 0;             // metres above the road; > 0 = airborne off a ramp
  landed = false;       // per-frame: true on the single frame the car touches down
  gripMul = 1;          // weather grip modifier (<1 = slippery), set per race
  private airV = 0;     // vertical velocity while airborne

  private rollA = 0;
  private xVel = 0;
  private driftV = 0; // outward velocity owed to corner force alone (not steering)
  private bumpCooldown = 0;
  private steerLean = 0;
  private latV = 0; // smoothed real lateral velocity (drag steering bypasses xVel)

  private static readonly TUMBLE_TIME = 1.4;

  /** Hand-out-the-window shooter, shown in gun modes only. */
  private shooter: THREE.Group;
  private shooterKick = 0;
  private static readonly SHOOTER_REST_Z = -0.16;
  private static readonly SHOOTER_KICK_TIME = 0.14;

  constructor(
    scene: THREE.Scene, assets: AssetLibrary, private track: Track,
    private spec: CarSpec
  ) {
    this.mesh = assets.cloneCar(spec);
    scene.add(this.mesh);
    // Rides on the car rather than the camera, so it leans and rolls with the
    // body. Offsets suit the normalized car bodies (max dimension 3.9).
    this.shooter = buildShooterArm();
    this.shooter.position.set(0.70, 0.54, Player.SHOOTER_REST_Z);
    this.shooter.visible = false;
    this.mesh.add(this.shooter);
  }

  /** Gun modes: the hand comes out of the window. */
  setShooter(on: boolean): void {
    this.shooter.visible = on;
    if (!on) this.shooterKick = 0;
  }

  /** Kick the arm back on a shot. */
  shooterRecoil(): void {
    this.shooterKick = Player.SHOOTER_KICK_TIME;
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
    this.draftGauge = 0;
    this.draftingActive = false;
    this.voltageLevel = 100;
    this.airH = 0;
    this.airV = 0;
    this.landed = false;
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

  /** Top-speed multiplier of the car being driven, upgrades included. */
  get speedMul(): number {
    return this.spec.speed;
  }

  /** Off the ground after a ramp — barriers and off-road drag don't apply. */
  get airborne(): boolean {
    return this.airH > 0.001;
  }

  /**
   * Hit a launch ramp: leap into the air, higher the faster you're going.
   * No-op when crawling, already airborne, or wrecked. Returns true if it fired.
   */
  launch(): boolean {
    if (this.airborne || this.tumbleT > 0 || this.v < 18) return false;
    this.airV = THREE.MathUtils.clamp(this.v * 0.26, 5, 12); // faster ⇒ bigger air
    this.airH = 0.02;
    return true;
  }

  fireNitro(): boolean {
    if (this.nitroTanks <= 0 || this.nitroTimer > 0 || this.tumbleT > 0) return false;
    this.nitroTanks--;
    this.nitroTimer = NITRO_TIME * this.spec.nitro;
    return true;
  }

  triggerDraftBoost(): boolean {
    if (this.draftGauge < 1 || this.nitroTimer > 0 || this.tumbleT > 0) return false;
    this.draftGauge = 0;
    this.nitroTimer = NITRO_TIME * this.spec.nitro * 1.25; // 25% longer draft boost!
    return true;
  }

  bump(pushDir: number, shove = 6, retainedSpeed = 0.72): void {
    if (this.bumpCooldown > 0) return;
    this.bumpCooldown = 0.5;
    this.v *= retainedSpeed;
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
    this.heatGrace = Math.max(0, this.heatGrace - dt);
    this.nitroTimer = Math.max(0, this.nitroTimer - dt);
    this.landed = false;
    if (this.damage > 0 && elapsed - this.lastHitAt > this.damageCool) this.damage = 0;
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
      if (this.offroad && !this.nitroActive && !this.airborne) target = Math.min(target, OFFROAD_SPEED);
      if (braking && !this.nitroActive) target = Math.min(target, BRAKE_SPEED);
      if (this.tumbleT > 0) target = 2;
      if (this.voltageMode && this.tumbleT <= 0) {
        this.nitroTanks = Math.max(1, this.nitroTanks); // nitro locked ready
        this.voltageLevel = Math.max(0, this.voltageLevel - dt * 12);
        if (this.voltageLevel <= 0) target *= 0.35; // out of voltage!
      }
    }
    let rate: number;
    if (this.v < target) rate = ACCEL * this.spec.accel * (this.nitroActive ? 1.8 : 1);
    else if (braking) rate = BRAKE * 1.6;
    else if (this.offroad || gas) rate = BRAKE;
    else rate = COAST_DECEL;
    this.v = THREE.MathUtils.damp(this.v, target, rate / Math.max(this.v, 8), dt * 8);
    this.s += this.v * dt;

    // vertical — a ramp launch arcs up under gravity and lands back on the road
    if (this.airH > 0 || this.airV > 0) {
      this.airV -= GRAVITY * dt;
      this.airH += this.airV * dt;
      if (this.airH <= 0) {
        this.airH = 0;
        this.airV = 0;
        this.landed = true;
      }
    }

    // lateral: direct drag + held keys + centrifugal push in corners.
    // +x is the driver's LEFT, so screen-right input subtracts.
    const grip = this.spec.grip * this.gripMul;
    const dragMeters = (driving ? dragPx : 0) * (13 / window.innerWidth) * grip;
    const f = this.track.frame(this.s);
    // grippy cars steer harder AND shrug off more of the corner push
    const cornerPush = f.curvature * this.v * this.v * CENTRIFUGAL * (2 - grip) * dt;
    this.xVel += cornerPush;
    this.xVel -= keySteer * 55 * grip * dt;
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
    if (driving && this.tumbleT <= 0 && !this.airborne
      && Math.abs(prevX) <= roadEdge && Math.abs(this.x) > roadEdge) {
      const outward = Math.sign(this.x);
      // drift toward THIS side only; drag steering never enters driftV
      if (this.driftV * outward > WALL_CRASH_DRIFT && this.v > WALL_CRASH_MIN_V) {
        this.wallHit = 2;
      }
    }
    if (Math.abs(this.x) > PLAYER_X_LIMIT) {
      const outward = Math.sign(this.x);
      this.x = outward * PLAYER_X_LIMIT;
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
    this.shooterKick = Math.max(0, this.shooterKick - dt);
    this.syncMesh(elapsed);
  }

  private syncMesh(elapsed: number): void {
    this.track.place(this.mesh, this.s, this.x);
    this.mesh.rotation.y += Math.PI + this.steerLean; // model faces +z; flip down-track
    this.mesh.rotation.z = -this.steerLean * 0.25;
    this.mesh.position.y = Math.sin(elapsed * 24) * 0.012 + (this.offroad && !this.airborne ? Math.abs(Math.sin(elapsed * 30)) * 0.05 : 0);
    // ramp jump: lift the body and pitch the nose up on the way up, down on the way down
    this.mesh.rotation.x = this.airH > 0 ? THREE.MathUtils.clamp(-this.airV * 0.03, -0.35, 0.45) : 0;
    if (this.airH > 0) this.mesh.position.y += this.airH;
    if (this.tumbleT > 0) {
      const k = 1 - this.tumbleT / Player.TUMBLE_TIME;
      this.mesh.rotation.z = this.rollA;
      this.mesh.position.y += Math.sin(Math.min(1, k) * Math.PI) * 1.1;
    }
    if (this.shooter.visible) {
      const k = this.shooterKick > 0
        ? Math.sin((this.shooterKick / Player.SHOOTER_KICK_TIME) * Math.PI)
        : 0;
      this.shooter.position.z = Player.SHOOTER_REST_Z - k * 0.17;
      this.shooter.rotation.x = -k * 0.45;
    }
    syncCarGroundFx(this.mesh);
  }
}
