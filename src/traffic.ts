import * as THREE from 'three';
import { AssetLibrary, disposeCarInstance } from './assets';
import { buildDanfo } from './danfo';
import { ROAD_HALF_WIDTH } from './constants';
import { mulberry32, syncCarGroundFx } from './meshes';
import { Track } from './track';

/**
 * Ambient traffic.
 *
 * The style economy pays out for near-misses, but with only three rivals on the
 * road there was almost nothing to nearly miss — and nothing to measure speed
 * against, which is why 140 km/h read as a number rather than a sensation. This
 * fills the lap with slow civilian cars the player threads through.
 *
 * The pool is fixed and recycled: cars that fall behind are re-seeded ahead, so
 * the cost is flat regardless of lap length. They drive lanes at a fraction of
 * racing speed and drift between lanes slowly, which is enough to make a gap
 * close while you are aiming at it.
 */

// Four lanes inside the road, with 2.25 m between neighbours — wide enough to
// thread at speed, tight enough that it counts.
const LANES = [-3.4, -1.15, 1.15, 3.4];
const MIN_ROW_GAP = 26;   // metres between one row of traffic and the next
const ROW_SPREAD = 34;    // ...plus up to this much more

export interface TrafficCar {
  mesh: THREE.Group;
  s: number;
  x: number;
  v: number;
  lane: number;
  targetLane: number;
  laneTimer: number;
  wrecked: number; // > 0 = spinning out after a hit, no longer steering
  rollA: number;
  nearMissed: boolean; // already paid out for this pass
  closestPass: number;
  contactLength: number;
}

export class TrafficManager {
  readonly cars: TrafficCar[] = [];
  private rand: () => number;
  private ahead = 210;   // seed this far in front of the player
  private behind = 70;   // recycle once this far back
  private cursor = 0;    // s of the next row to be laid down
  private lastLane = -9; // so consecutive rows never block adjacent lanes

  constructor(
    scene: THREE.Scene, assets: AssetLibrary, private track: Track,
    seed: number, count: number, avoidModel = -1, mapId = ''
  ) {
    this.rand = mulberry32(seed ^ 0x7a11c);
    for (let i = 0; i < count; i++) {
      // Start with a danfo and repeat every third slot so Lagos always has
      // minibuses, including in the first visible rows. Keep the pool bounded.
      const mesh = mapId === 'lagos' && i % 3 === 0
        ? buildDanfo()
        : assets.cloneTraffic(i + (avoidModel >= 0 ? avoidModel + 1 : 0));
      if (!mesh) continue;
      mesh.visible = false;
      scene.add(mesh);
      const lane = Math.floor(this.rand() * LANES.length);
      this.cars.push({
        mesh, s: 0, x: LANES[lane], v: 0, lane, targetLane: lane,
        laneTimer: 2 + this.rand() * 6, wrecked: 0, rollA: 0, nearMissed: false,
        closestPass: Infinity, contactLength: mesh.userData.trafficKind === 'danfo' ? 3.7 : 3.4
      });
    }
  }

  /** Lay the pool out down the road, leaving the grid itself clear. */
  reset(playerS: number): void {
    this.cursor = playerS + 90; // nobody parked on the start line
    this.lastLane = -9;
    for (const car of this.cars) this.place(car);
  }

  private cruiseSpeed(): number {
    return 13 + this.rand() * 9; // roughly a third of racing pace
  }

  /**
   * Put a car at the head of the queue.
   *
   * Rows are spaced out and never use a lane adjacent to the row before them,
   * so there is always a line through. Traffic that blocks the whole road is
   * not an obstacle, it is a wall — the first build boxed the player in at
   * walking pace, which is the opposite of what this is for.
   */
  private place(car: TrafficCar): void {
    let lane = Math.floor(this.rand() * LANES.length);
    while (Math.abs(lane - this.lastLane) < 2) lane = (lane + 1) % LANES.length;
    this.lastLane = lane;
    car.s = this.cursor;
    this.cursor += MIN_ROW_GAP + this.rand() * ROW_SPREAD;
    car.lane = lane;
    car.targetLane = lane;
    car.x = LANES[lane];
    car.laneTimer = 4 + this.rand() * 8;
    car.v = this.cruiseSpeed();
    car.wrecked = 0;
    car.rollA = 0;
    car.nearMissed = false;
    car.closestPass = Infinity;
  }

  /** Knocked out of the way: spins, sheds speed, stops being a near-miss. */
  hit(car: TrafficCar, force: number): void {
    car.wrecked = Math.max(car.wrecked, 0.9 + force * 0.5);
    car.v *= 0.45;
    car.nearMissed = true;
  }

  update(dt: number, playerS: number, _trackLength: number, playerSpeed = 0): void {
    for (const car of this.cars) {
      if (car.wrecked > 0) {
        car.wrecked -= dt;
        car.rollA += dt * 7;
        car.v = Math.max(0, car.v - dt * 9);
      } else {
        car.rollA *= Math.max(0, 1 - dt * 4);
        car.laneTimer -= dt;
        if (car.laneTimer <= 0 && car.targetLane === car.lane) {
          car.laneTimer = 5 + this.rand() * 9;
          // one lane at a time, and never off the edge of the road
          const dir = this.rand() < 0.5 ? -1 : 1;
          const candidate = THREE.MathUtils.clamp(car.lane + dir, 0, LANES.length - 1);
          const gap = car.s - playerS;
          const passing = gap > -12 && gap < Math.max(28, (playerSpeed - car.v) * 1.5);
          const occupied = this.cars.some(other => other !== car &&
            Math.abs(other.s - car.s) < 14 &&
            (other.targetLane === candidate || Math.abs(other.x - LANES[candidate]) < 1.8));
          if (!passing && !occupied) car.targetLane = candidate;
        }
        if (car.targetLane !== car.lane) {
          const goal = LANES[car.targetLane];
          car.x += Math.sign(goal - car.x) * Math.min(Math.abs(goal - car.x), dt * 1.5);
          if (Math.abs(goal - car.x) < 0.08) { car.x = goal; car.lane = car.targetLane; }
        }
      }
      car.s += car.v * dt;

      // Keep traffic and player in the same unwrapped race distance. Wrapping
      // only one of them made visible traffic intangible on later laps.
      let gap = car.s - playerS;
      if (gap < -this.behind) {
        // Re-enter beyond the visible horizon; queued cars farther ahead wait
        // their turn instead of being re-seeded farther away every frame.
        this.cursor = Math.max(this.cursor, playerS + this.ahead);
        this.place(car);
        gap = car.s - playerS;
      }
      const visible = gap > -this.behind && gap < this.ahead;
      car.mesh.visible = visible;
      if (!visible) continue;

      const f = this.track.frame(car.s);
      car.mesh.position.set(
        f.x + f.nx * car.x,
        car.wrecked > 0 ? Math.sin(Math.min(1, car.wrecked) * Math.PI) * 0.5 : 0,
        f.z + f.nz * car.x
      );
      // AssetLibrary and procedural cars share +Z forward, just like racers.
      car.mesh.rotation.set(0, Math.PI - f.theta, car.rollA);
      syncCarGroundFx(car.mesh);
    }
  }

  /** Lateral distance at which a pass counts as threading the needle. */
  static readonly NEAR_MISS_BAND = { min: 1.67, max: 3.2 };

  /** True while the car is inside the road, i.e. a legitimate obstacle. */
  static onRoad(car: TrafficCar): boolean {
    return Math.abs(car.x) < ROAD_HALF_WIDTH;
  }

  dispose(scene: THREE.Scene): void {
    for (const car of this.cars) {
      scene.remove(car.mesh);
      disposeCarInstance(car.mesh);
    }
    this.cars.length = 0;
  }
}
