import * as THREE from 'three';
import { AssetLibrary } from './assets';
import type { CarSpec } from './cars';
import {
  BASE_SPEED, END_SPEED_BONUS, NITRO_SPEED, NITRO_TIME, PRO_NITRO_EVERY, PRO_PACE_BONUS,
  PRO_PACE_SHARE, PRO_SKILL, PURSUIT_ATTACK_EVERY, PURSUIT_FIRST_RUN, PURSUIT_LAT_GRIP,
  PURSUIT_SURGE_OVER, RIVAL_BRAKE, RIVAL_CATCHUP, RIVAL_LAT_GRIP,
  RIVAL_MIN_CORNER_SPEED, RIVAL_NITRO_EVERY, RIVAL_PACE_SHARE, ROAD_HALF_WIDTH, SAMPLE_STEP,
  WALL_CRASH_MIN_V
} from './constants';
import { buildCar, syncCarGroundFx } from './meshes';
import { Track } from './track';

/**
 * Personality archetypes — each rival draws one at race start, tinting its
 * speed target, cornering, line choice and aggressiveness so the pack
 * doesn't feel like a rubber-band blob.
 */
export type Personality = 'balanced' | 'aggressive' | 'cautious' | 'erratic' | 'drafter' | 'blocker';

interface PersonalityTune {
  speedBias: number;     // ±m/s added to the base speed target
  brakeLookahead: number; // how far ahead the AI scans for corners (m)
  wobbleAmp: number;     // lateral line-weave amplitude multiplier
  wobbleFreq: number;    // lateral line-weave frequency multiplier
  overtakeUrge: number;  // 0..1 how hard it goes for a pass (≥ 0.6 leans on you door to door)
  blockUrge: number;     // 0..1 how hard it defends its position
  draftSeek: number;     // 0..1 how much it gets out of a slipstream
  recoveryRate: number;  // post-wreck speed recovery multiplier
}

const PERSONALITY_TUNES: Record<Personality, PersonalityTune> = {
  balanced:   { speedBias: 0,   brakeLookahead: 1.0, wobbleAmp: 1.0, wobbleFreq: 1.0, overtakeUrge: 0.4, blockUrge: 0.2, draftSeek: 0.2, recoveryRate: 1.0 },
  aggressive: { speedBias: 1.5, brakeLookahead: 0.8, wobbleAmp: 0.7, wobbleFreq: 1.3, overtakeUrge: 0.9, blockUrge: 0.1, draftSeek: 0.1, recoveryRate: 1.2 },
  cautious:   { speedBias: -1,  brakeLookahead: 1.4, wobbleAmp: 1.2, wobbleFreq: 0.8, overtakeUrge: 0.2, blockUrge: 0.5, draftSeek: 0.3, recoveryRate: 0.8 },
  erratic:    { speedBias: 0.5, brakeLookahead: 0.9, wobbleAmp: 1.8, wobbleFreq: 2.0, overtakeUrge: 0.6, blockUrge: 0.1, draftSeek: 0.0, recoveryRate: 1.1 },
  drafter:    { speedBias: -0.5,brakeLookahead: 1.1, wobbleAmp: 0.5, wobbleFreq: 0.7, overtakeUrge: 0.3, blockUrge: 0.1, draftSeek: 0.85, recoveryRate: 1.0 },
  blocker:    { speedBias: 0,   brakeLookahead: 1.2, wobbleAmp: 0.6, wobbleFreq: 0.9, overtakeUrge: 0.2, blockUrge: 0.85, draftSeek: 0.1, recoveryRate: 0.9 },
};

const PERSONALITIES: Personality[] = ['balanced', 'aggressive', 'cautious', 'erratic', 'drafter', 'blocker'];
// a pro field has no passengers: nobody dawdles through bends or wanders off line
const PRO_PERSONALITIES: Personality[] = ['aggressive', 'blocker', 'balanced', 'drafter'];

export interface Rival {
  name: string;
  car: string;         // the garage car it drives; '' for a street shell
  mesh: THREE.Group;
  flame: THREE.Mesh;   // nitro exhaust, lit while boosting
  s: number;
  x: number;
  v: number;
  baseSpeed: number;
  wobblePhase: number;
  finishTime: number; // -1 until finished
  bumpCooldown: number;
  damage: number;      // Burnout: recent hits taken
  lastHitAt: number;   // damage decays when hits stop landing
  tumbleT: number;     // > 0 = wrecked and rolling
  rollA: number;       // barrel-roll angle while tumbling
  skill: number;       // corner-braking judgement — the sloppy ones overcook bends
  personality: Personality;
  tune: PersonalityTune;
  nitroTanks: number;  // boosts in hand
  nitroT: number;      // > 0 = burning
  nitroEarnT: number;  // seconds until the next tank arrives
  draftT: number;      // seconds spent in someone's slipstream
  passT: number;       // > 0 = committed to going round the car ahead
  passSide: number;    // -1 / 1 — the side it goes round on
  passTarget: number;  // -1 = the player, otherwise the index of the rival being passed
  chopT: number;       // > 0 = just got by the player and is cutting across its nose
  readX: number;       // the player's lane as this driver has registered it (lags)
  laneBias: number;         // lateral offset from the shared line — the field fans out
  pursuitPhase: PursuitPhase; // police chase: what this unit is currently doing
  pursuitT: number;           // seconds left in the current phase
  pursuitSide: number;        // -1 / 1 — which side it runs the player down
}

/**
 * Police Chase manoeuvre cycle. A unit that only ever tails sits in the chase
 * camera's blind spot forever, which reads as nothing chasing you at all — so
 * each one takes turns running the player down: up one side, across the nose,
 * then holds the road in front and rams. Units that start down the road wait
 * in `block` and attack as the player arrives.
 */
type PursuitPhase = 'tail' | 'surge' | 'cut' | 'block' | 'drop';

export const RIVAL_NAMES = ['BLAZE', 'VOLT', 'RUST', 'HAVOC', 'JINX', 'DIESEL', 'MAULER'];

const TUMBLE_TIME = 1.4;
const NITRO_HELD_MAX = 2;
/** Rivals can brake this many times harder than cornerCap plans for, so they stay on its curve. */
const BRAKE_HEADROOM = 2;

/**
 * AI racers. Outside Police Chase they race to win: they corner near the pace
 * a committed player carries, slipstream, spend nitro where it gains places,
 * commit to passes, slam the door after one, cover the inside when you line
 * up a move, and dig in when dropped rather than waiting for you.
 */
export class RivalManager {
  rivals: Rival[] = [];
  raceLength = 0; // laps × track length; set by the game each race
  gripMul = 1;    // weather grip modifier (<1 = slippery), set per race
  paceMul = 1;    // the player's car speed multiplier; the field's pace is set against it
  onNitro: (r: Rival) => void = () => {};

  private readonly flameGeo = new THREE.ConeGeometry(0.2, 1.3, 8, 1, true).rotateX(-Math.PI / 2);
  private readonly flameMat = new THREE.MeshBasicMaterial({
    color: 0x7fd4ff, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false
  });

  constructor(
    scene: THREE.Scene, assets: AssetLibrary, private track: Track,
    avoidModel = -1, // traffic slot the player is driving
    count = 3,
    private pursuit = false, // Cop Chase: the single rival is THE HEAT
    // Class modes (Hyper Cup) hand over a shelf of garage cars to race in
    // place of the traffic shells. Empty ⇒ the usual civilian pool.
    carPool: CarSpec[] = [],
    private pro = false // HARDCORE: the pro field
  ) {
    const personalities = pro ? PRO_PERSONALITIES : PERSONALITIES;
    for (let i = 0; i < count; i++) {
      const spec = carPool.length ? carPool[i % carPool.length] : null;
      const mesh = (pursuit
        ? assets.clonePolice()
        : spec ? assets.cloneCar(spec) : assets.cloneTraffic(i, avoidModel))
        ?? buildCar(i + 1);
      scene.add(mesh);
      // tip points down −z, out of the tail of a normalized body (length 3.9)
      const flame = new THREE.Mesh(this.flameGeo, this.flameMat);
      flame.position.set(0, 0.42, -2.6);
      flame.visible = false;
      mesh.add(flame);
      const personality = pursuit ? 'aggressive' as Personality : personalities[i % personalities.length];
      const tune = PERSONALITY_TUNES[personality];
      this.rivals.push({
        // the lead car is THE HEAT; the rest of the squad are numbered units.
        // Racers go by a driver name even in a shared car, so a class mode's
        // classification never lists the same name twice.
        name: pursuit ? (i === 0 ? 'THE HEAT' : `UNIT ${i + 1}`)
          : RIVAL_NAMES[i % RIVAL_NAMES.length],
        car: spec ? spec.name : '',
        mesh,
        flame,
        s: 0, x: 0, v: 0,
        baseSpeed: this.basePace(i, tune),
        wobblePhase: i * 2.4,
        finishTime: -1,
        bumpCooldown: 0,
        damage: 0,
        lastHitAt: -10,
        tumbleT: 0,
        rollA: 0,
        skill: pursuit ? 1.3 : pro ? PRO_SKILL + (i % 3) * 0.04 : 0.92 + (i % 3) * 0.11,
        personality,
        tune,
        nitroTanks: 1,
        nitroT: 0,
        nitroEarnT: this.nitroEvery,
        draftT: 0,
        passT: 0,
        passSide: 1,
        passTarget: -1,
        chopT: 0,
        readX: 0,
        // a pursuing squad fans out instead of queueing in one lane, so the
        // mirrors show cars on both quarters rather than a single tailgater
        laneBias: count > 1
          ? ((i / (count - 1)) - 0.5) * 2 * 1.7
          : 0,
        pursuitPhase: 'tail',
        // staggered, so the squad takes turns rather than all lunging at once
        pursuitT: PURSUIT_FIRST_RUN + i * 2.0,
        pursuitSide: i % 2 === 0 ? 1 : -1
      });
    }
  }

  /** Straight-line pace for grid slot i, before progression and racecraft. */
  private basePace(i: number, tune: PersonalityTune): number {
    // Police Chase is balanced around its own fixed pace. Scaling it to the
    // player's car was tried and measured no different: a unit's speed target
    // comes from `pursue`, which is playerV-relative in every phase but the
    // tail, where baseSpeed is only a ceiling.
    if (this.pursuit) return BASE_SPEED - 1.5 + (i % 4) * 1.2 + tune.speedBias;
    const anchor = 1 + (this.paceMul - 1) * this.paceShare;
    return BASE_SPEED * anchor + tune.speedBias + ((i % 3) - 1) * 0.7
      + (this.pro ? PRO_PACE_BONUS : 0);
  }

  /** How much of the player's top-speed edge the field matches. */
  private get paceShare(): number {
    return this.pro ? PRO_PACE_SHARE : RIVAL_PACE_SHARE;
  }

  private get nitroEvery(): number {
    return this.pro ? PRO_NITRO_EVERY : RIVAL_NITRO_EVERY;
  }

  reset(grid: { s: number; x: number }[]): void {
    this.rivals.forEach((r, i) => {
      r.s = grid[i].s;
      r.x = grid[i].x;
      r.v = 0;
      r.baseSpeed = this.basePace(i, r.tune); // paceMul is set after construction
      r.finishTime = -1;
      r.bumpCooldown = 0;
      r.damage = 0;
      r.lastHitAt = -10;
      r.tumbleT = 0;
      r.rollA = 0;
      // one boost off the grid, like the player; top-ups are staggered so the
      // field never fires in unison
      r.nitroTanks = 1;
      r.nitroT = 0;
      r.nitroEarnT = this.nitroEvery * (0.8 + i * 0.12);
      r.draftT = 0;
      r.passT = 0;
      r.passTarget = -1;
      r.chopT = 0;
      r.readX = grid[i].x;
      // Police Chase: units gridded behind the player chase (first run
      // staggered per unit); units gridded ahead lie in wait and attack.
      r.pursuitPhase = grid[i].s > 0 ? 'block' : 'tail';
      r.pursuitT = grid[i].s > 0 ? 6 : PURSUIT_FIRST_RUN + i * 2.0;
      this.sync(r, 0);
    });
  }

  /** Wreck a rival — it rolls, sheds speed, and rejoins the race after. */
  wreck(r: Rival): void {
    r.tumbleT = TUMBLE_TIME;
    r.rollA = 0;
    r.damage = 0;
    r.v *= 0.2 * r.tune.recoveryRate;
    r.nitroT = 0;
    r.passT = 0;
    r.chopT = 0;
  }

  /** Free the field's shared nitro flame. The car bodies are the game's to free. */
  dispose(): void {
    this.flameGeo.dispose();
    this.flameMat.dispose();
  }

  update(
    dt: number, elapsed: number, raceTime: number, playerS: number,
    driving: boolean, playerX = 0, aggression = 0, playerV = 0, playerNitro = false
  ): void {
    const total = this.raceLength || this.track.length;
    const half = ROAD_HALF_WIDTH - 1;
    for (const r of this.rivals) {
      r.bumpCooldown = Math.max(0, r.bumpCooldown - dt);
      r.nitroT = Math.max(0, r.nitroT - dt);
      if (r.damage > 0 && elapsed - r.lastHitAt > 3.5) r.damage = 0;

      if (r.tumbleT > 0) {
        r.tumbleT -= dt;
        r.rollA += dt * 9;
        r.v = THREE.MathUtils.damp(r.v, 2, 6, dt);
        r.s += r.v * dt;
        this.sync(r, elapsed);
        continue;
      }

      const gap = r.s - playerS; // > 0 = ahead of the player
      // still in the race and racing the player; pursuit has its own brain
      const racing = driving && !this.pursuit && r.finishTime < 0;
      let target = 0;
      if (driving) {
        const progression = Math.min(1, r.s / total) * END_SPEED_BONUS;
        if (this.pursuit) {
          target = this.pursue(r, dt, gap, playerV, progression);
        } else {
          const wobble = Math.sin(elapsed * 0.7 * r.tune.wobbleFreq + r.wobblePhase);
          target = r.baseSpeed + progression + wobble;
          if (racing) target = this.racePace(r, dt, gap, total, target, playerS, playerX, playerNitro);
        }
      }
      if (driving) {
        const grip = (this.pursuit ? PURSUIT_LAT_GRIP : RIVAL_LAT_GRIP) * this.gripMul;
        if (this.pursuit) {
          // brake for the bend ahead — personality affects how far they look
          let k = 0;
          const lookDists = [8, 18, 30].map(d => d * r.tune.brakeLookahead);
          for (const look of lookDists) {
            k = Math.max(k, Math.abs(this.track.frame(r.s + look).curvature));
          }
          if (k > 1e-4) {
            target = Math.min(target, Math.sqrt((grip * r.skill) / k));
          }
        } else {
          target = Math.min(target, this.cornerCap(r, grip));
          // the player's wall-crash rule: nobody is thrown off below crash speed
          const kNow = Math.abs(this.track.curvatureAt(r.s));
          if (r.v > WALL_CRASH_MIN_V && kNow * r.v * r.v > grip * r.skill * 2.1) {
            this.wreck(r);
            continue;
          }
        }
      }
      if (!this.pursuit && r.v > target) {
        // Brake along a straight line to the target. An exponential follower
        // lags a falling braking curve by ~6 m/s — exactly the margin that
        // carried rivals into hairpins above crash speed.
        r.v = Math.max(target, r.v - RIVAL_BRAKE * BRAKE_HEADROOM * dt);
      } else {
        r.v = THREE.MathUtils.damp(r.v, target, 1.6, dt * 4);
      }
      r.s += r.v * dt;

      const weave = Math.sin(r.s * 0.015 * r.tune.wobbleFreq + r.wobblePhase);
      let line: number;
      if (!driving) {
        line = r.x; // hold the grid slot through the countdown
      } else if (this.pursuit) {
        line = weave * (ROAD_HALF_WIDTH - 1.8) * r.tune.wobbleAmp;
      } else {
        // racing line: apex the inside of the coming bend (corner force pushes
        // toward +curvature, so inside is the other way), fan out on straights
        const kLine = this.track.frame(r.s + 26).curvature;
        const inside = -Math.sign(kLine) * Math.min(1, Math.abs(kLine) / 0.014) * (ROAD_HALF_WIDTH - 2.2);
        line = inside + r.laneBias * 0.6 + weave * 0.9 * r.tune.wobbleAmp;
        if (racing) line = this.raceLine(r, dt, gap, playerS, playerX, playerV, line);
      }

      // Pursuit lane control runs well beyond the ordinary hunt range,
      // because a surge starts from behind and has to arrive alongside.
      if (this.pursuit && driving && Math.abs(r.s - playerS) < 45) {
        const lane = r.pursuitPhase === 'surge'
          ? playerX + r.pursuitSide * 3.4   // up the outside, clear of the wing
          : r.pursuitPhase === 'cut' || r.pursuitPhase === 'block'
            ? playerX                        // across the nose, or ramming from in front
            : playerX + r.laneBias;          // tailing on its flank
        line = THREE.MathUtils.lerp(
          line,
          THREE.MathUtils.clamp(lane, -half, half),
          r.pursuitPhase === 'tail' ? 0.6 : 0.92
        );
      } else if (aggression > 0 && driving && Math.abs(r.s - playerS) < 9) {
        // aggressive modes: nearby rivals abandon the line and hunt the player
        line = THREE.MathUtils.clamp(playerX, -half, half);
      }
      const agility = (this.pursuit ? 1.2 : 1.4) + aggression * 1.6
        + (r.passT > 0 || r.chopT > 0 ? 1.2 : 0);
      r.x = THREE.MathUtils.damp(r.x, THREE.MathUtils.clamp(line, -half, half), agility, dt);

      if (r.finishTime < 0 && r.s >= total) r.finishTime = raceTime;
      this.sync(r, elapsed);
    }
  }

  /**
   * Speed target for a rival racing the player: dig in when dropped,
   * slipstream, and spend nitro where it wins a place.
   */
  private racePace(
    r: Rival, dt: number, gap: number, total: number, target: number,
    playerS: number, playerX: number, playerNitro: boolean
  ): number {
    const easeFrom = this.pro ? 120 : 70;
    if (gap < -12) {
      // dropped: chase the player down instead of waiting for them to lift
      target += Math.min(1, (-gap - 12) / 60) * RIVAL_CATCHUP;
    } else if (gap > easeFrom) {
      // a runaway leader eases off, so it stays a target rather than a rumour;
      // a pro lifts later and less
      target -= Math.min(1, (gap - easeFrom) / 90) * (this.pro ? 3 : 6);
    }

    if (this.inTow(r, playerS, playerX)) {
      r.draftT += dt;
      target += 1.5 + 2.5 * r.tune.draftSeek;
    } else {
      r.draftT = 0;
    }

    r.nitroEarnT -= dt;
    if (r.nitroEarnT <= 0) {
      r.nitroTanks = Math.min(NITRO_HELD_MAX, r.nitroTanks + 1);
      r.nitroEarnT = this.nitroEvery * (0.85 + Math.random() * 0.3);
    }
    if (r.nitroT <= 0 && r.nitroTanks > 0 && r.v > 22 && this.boostPays(r, target)) {
      let urge = 0;
      if (gap < -3 && gap > -45) urge = 0.5 + r.tune.overtakeUrge;          // the player is right there
      else if (gap > 0 && gap < 18 && playerNitro) urge = 0.4 + r.tune.blockUrge; // answer their boost
      else if (gap < -70) urge = 0.7;                                        // lost touch
      if (total - r.s < 320 && gap > -90) urge = Math.max(urge, 2);          // sprint for the line
      if (Math.random() < urge * dt) {
        r.nitroTanks--;
        r.nitroT = NITRO_TIME;
        this.onNitro(r);
      }
    }
    if (r.nitroT > 0) target = Math.max(target, NITRO_SPEED * (1 + (this.paceMul - 1) * this.paceShare) * 0.95);
    if (r.passT > 0) target += 1.2; // committed to the move
    return target;
  }

  /**
   * Where a racing rival wants to be across the road: going round whatever is
   * holding it up, slamming the door on the player after a pass, covering the
   * player's line when they line up a move, leaning on them door to door.
   */
  private raceLine(
    r: Rival, dt: number, gap: number, playerS: number, playerX: number, playerV: number, line: number
  ): number {
    if (r.passT <= 0) {
      let aheadGap = 18, aheadX = 0, aheadV = 0, target = -2; // -2 = nothing ahead
      const pg = playerS - r.s;
      if (pg > 0 && pg < aheadGap && Math.abs(playerX - r.x) < 2.6) {
        aheadGap = pg; aheadX = playerX; aheadV = playerV; target = -1;
      }
      this.rivals.forEach((o, j) => {
        const og = o.s - r.s;
        if (o !== r && o.tumbleT <= 0 && og > 0 && og < aheadGap && Math.abs(o.x - r.x) < 2.6) {
          aheadGap = og; aheadX = o.x; aheadV = o.v; target = j;
        }
      });
      const wantsBy = r.v - aheadV > 0.8 || r.draftT > 0.6 || r.nitroT > 0;
      if (target > -2 && wantsBy && Math.random() < (0.6 + r.tune.overtakeUrge) * dt * 3) {
        const half = ROAD_HALF_WIDTH - 1;
        r.passSide = half - aheadX >= aheadX + half ? 1 : -1; // round the side with more road
        r.passT = 3.2;
        r.passTarget = target;
      }
    }
    if (r.passT > 0) {
      r.passT -= dt;
      const t = r.passTarget < 0 ? { s: playerS, x: playerX } : this.rivals[r.passTarget];
      line = t.x + r.passSide * 3.0;
      if (r.s - t.s > 5.5) {
        r.passT = 0;
        const slam = 0.25 + r.tune.overtakeUrge * 0.35 + r.tune.blockUrge * 0.4;
        if (r.passTarget < 0 && Math.random() < slam) r.chopT = 1.1;
      }
    }

    if (r.chopT > 0) {
      r.chopT -= dt;
      if (gap > 2 && gap < 18) line = THREE.MathUtils.lerp(line, playerX, 0.85);
      else r.chopT = 0;
    }

    // Defending reacts to where the player WAS a beat ago, so a late switch
    // beats the block instead of the rival mirroring every twitch.
    r.readX = THREE.MathUtils.damp(r.readX, playerX, 2 + r.tune.blockUrge * 2.5, dt);
    if (r.passT <= 0 && r.chopT <= 0 && gap > 1.5 && gap < 22 && playerV > r.v - 1) {
      line = THREE.MathUtils.lerp(line, r.readX, Math.min(0.9, 0.25 + r.tune.blockUrge * 0.7));
    }

    if (Math.abs(gap) < 4 && Math.abs(playerX - r.x) < 3.4 && r.tune.overtakeUrge >= 0.6) {
      line = THREE.MathUtils.lerp(line, playerX, 0.3);
    }
    return line;
  }

  /**
   * Fastest speed from which every bend in braking range can still be made.
   * The scan runs every track sample: hairpins on the technical layouts are
   * shorter than the gaps a sparse look-ahead leaves, and rivals used to hit
   * them blind and wreck dozens of times a race. Below crash speed a car can
   * scrape through anything, so no bend asks for less than that.
   */
  private cornerCap(r: Rival, grip: number): number {
    const reach = (12 + r.v * 1.1) * r.tune.brakeLookahead;
    let cap = Infinity;
    for (let d = 0; d <= reach; d += SAMPLE_STEP) {
      const k = Math.abs(this.track.curvatureAt(r.s + d));
      if (k < 1e-4) continue;
      const bend = Math.max(RIVAL_MIN_CORNER_SPEED, Math.sqrt((grip * r.skill) / k));
      cap = Math.min(cap, Math.sqrt(bend * bend + 2 * RIVAL_BRAKE * d));
    }
    return cap;
  }

  /** In the slipstream of the player or another rival. */
  private inTow(r: Rival, playerS: number, playerX: number): boolean {
    if (r.v < 18) return false;
    const pg = playerS - r.s;
    if (pg > 3 && pg < 22 && Math.abs(playerX - r.x) < 1.5) return true;
    for (const o of this.rivals) {
      if (o === r || o.tumbleT > 0) continue;
      const og = o.s - r.s;
      if (og > 3 && og < 20 && Math.abs(o.x - r.x) < 1.5) return true;
    }
    return false;
  }

  /**
   * The next ~70 m can be taken well above cruising pace. A fixed "is it
   * straight" test never fired on the flowing layouts, where the road is never
   * quite straight but a boost still pays.
   */
  private boostPays(r: Rival, cruise: number): boolean {
    const grip = RIVAL_LAT_GRIP * this.gripMul * r.skill;
    const fast = (cruise + 6) * (cruise + 6);
    for (let d = 10; d <= 70; d += SAMPLE_STEP * 2) {
      if (Math.abs(this.track.curvatureAt(r.s + d)) * fast > grip) return false;
    }
    return true;
  }

  /**
   * Advance one unit's manoeuvre cycle and return its speed target. Phases
   * chain tail → surge → cut → drop → tail, so a unit is regularly alongside
   * or ahead of the player rather than permanently out of shot.
   */
  private pursue(
    r: Rival, dt: number, gap: number, playerV: number, progression: number
  ): number {
    r.pursuitT -= dt;
    // Whatever it was doing, a unit that ends up in front of the player turns
    // on them — the cops ahead are as dangerous as the ones behind.
    if (gap > 4 && gap < 45 && (r.pursuitPhase === 'tail' || r.pursuitPhase === 'drop')) {
      r.pursuitPhase = 'block';
      r.pursuitT = 6;
    }
    switch (r.pursuitPhase) {
      case 'tail':
        // close enough to make a move, and its turn has come round
        if (r.pursuitT <= 0 && gap > -26) {
          r.pursuitPhase = 'surge';
          r.pursuitT = 5;
          r.pursuitSide = r.x >= 0 ? 1 : -1; // commit to the side it's already on
        }
        break;
      case 'surge':
        // hold it until the nose is clear ahead, or the run simply fails
        if (gap > 5 || r.pursuitT <= 0) {
          r.pursuitPhase = 'cut';
          r.pursuitT = 1.8;
        }
        break;
      case 'cut':
        // across the nose; if it made it in front, stay there and attack
        if (r.pursuitT <= 0) {
          r.pursuitPhase = gap > 0 ? 'block' : 'drop';
          r.pursuitT = gap > 0 ? 6 : 2.8;
        }
        break;
      case 'block':
        // still waiting down the road: the attack clock doesn't run yet
        if (gap > 45) {
          r.pursuitT = 6;
        } else if (gap < -4 || r.pursuitT <= 0) {
          // player got past (join the chase) or it has held the door long enough
          const passed = gap < -4;
          r.pursuitPhase = passed ? 'tail' : 'drop';
          r.pursuitT = passed ? PURSUIT_ATTACK_EVERY + Math.random() * 2 : 2.8;
        }
        break;
      case 'drop':
        if (r.pursuitT <= 0) {
          r.pursuitPhase = 'tail';
          r.pursuitT = PURSUIT_ATTACK_EVERY + Math.random() * 2;
        }
        break;
    }

    switch (r.pursuitPhase) {
      case 'surge': return playerV + PURSUIT_SURGE_OVER; // run them down
      case 'cut':   return playerV - 3.5;  // across the nose, on the brakes
      case 'block':
        // far down the road it crawls so the player arrives; in range it
        // brake-checks in the player's path so the hit comes from the front,
        // with a floor so the chase never grinds to walking pace
        return gap > 45 ? BASE_SPEED * 0.5 : Math.max(playerV - 4, BASE_SPEED * 0.55);
      case 'drop':  return playerV - 7;    // fall back for another run
      default: {
        let t = playerV + THREE.MathUtils.clamp((-3.5 - gap) * 0.7, -30, 10);
        if (gap > -8) t += playerV > BASE_SPEED * 0.75 ? -1.2 : 2.5;
        return Math.min(t, r.baseSpeed + 12 + progression);
      }
    }
  }

  private sync(r: Rival, elapsed: number): void {
    this.track.place(r.mesh, r.s, r.x);
    r.mesh.rotation.y += Math.PI;
    r.mesh.position.y = Math.sin(elapsed * 22 + r.wobblePhase) * 0.012;
    if (r.tumbleT > 0) {
      const k = 1 - r.tumbleT / TUMBLE_TIME;
      r.mesh.rotation.z = r.rollA;
      r.mesh.position.y += Math.sin(Math.min(1, k) * Math.PI) * 1.1;
    }
    r.flame.visible = r.nitroT > 0 && r.tumbleT <= 0;
    if (r.flame.visible) r.flame.scale.z = 0.75 + Math.random() * 0.5;
    syncCarGroundFx(r.mesh);
  }
}
