import * as THREE from 'three';
import { AssetLibrary } from './assets';
import type { CarSpec } from './cars';
import { BASE_SPEED, END_SPEED_BONUS, RIVAL_LAT_GRIP, ROAD_HALF_WIDTH } from './constants';
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
  overtakeUrge: number;  // 0..1 how hard it tries to pass slower traffic
  blockUrge: number;     // 0..1 how hard it defends its position
  draftSeek: number;     // 0..1 tendency to tuck behind another car
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

export interface Rival {
  name: string;
  mesh: THREE.Group;
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
  overtakeCooldown: number; // seconds until the AI tries another overtake lane change
  lastOvertakeDir: number;  // -1 or 1, which side they went last time
  laneBias: number;         // pursuit: this unit's flank offset from the player (m)
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

const NAMES = ['BLAZE', 'VOLT', 'RUST', 'HAVOC', 'JINX', 'DIESEL', 'MAULER'];

const TUMBLE_TIME = 1.4;

/** AI racers: personality-driven racing, overtaking, drafting, rubber-banding. */
export class RivalManager {
  rivals: Rival[] = [];
  raceLength = 0; // laps × track length; set by the game each race
  gripMul = 1;    // weather grip modifier (<1 = slippery), set per race

  constructor(
    scene: THREE.Scene, assets: AssetLibrary, private track: Track,
    avoidModel = -1, // traffic slot the player is driving
    count = 3,
    private pursuit = false, // Cop Chase: the single rival is THE HEAT
    // Class modes (Hyper Cup) hand over a shelf of garage cars to race in
    // place of the traffic shells. Empty ⇒ the usual civilian pool.
    carPool: CarSpec[] = []
  ) {
    for (let i = 0; i < count; i++) {
      const spec = carPool.length ? carPool[i % carPool.length] : null;
      const mesh = (pursuit
        ? assets.clonePolice()
        : spec ? assets.cloneCar(spec) : assets.cloneTraffic(i, avoidModel))
        ?? buildCar(i + 1);
      scene.add(mesh);
      const personality = pursuit ? 'aggressive' as Personality : PERSONALITIES[i % PERSONALITIES.length];
      const tune = PERSONALITY_TUNES[personality];
      this.rivals.push({
        // the lead car is THE HEAT; the rest of the squad are numbered units
        name: pursuit ? (i === 0 ? 'THE HEAT' : `UNIT ${i + 1}`)
          : spec ? spec.name : NAMES[i % NAMES.length],
        mesh,
        s: 0, x: 0, v: 0,
        baseSpeed: BASE_SPEED - 1.5 + (i % 4) * 1.2 + tune.speedBias,
        wobblePhase: i * 2.4,
        finishTime: -1,
        bumpCooldown: 0,
        damage: 0,
        lastHitAt: -10,
        tumbleT: 0,
        rollA: 0,
        skill: pursuit ? 1.3 : 0.92 + (i % 3) * 0.11,
        personality,
        tune,
        overtakeCooldown: 0,
        lastOvertakeDir: i % 2 === 0 ? 1 : -1,
        // a pursuing squad fans out instead of queueing in one lane, so the
        // mirrors show cars on both quarters rather than a single tailgater
        laneBias: count > 1
          ? ((i / (count - 1)) - 0.5) * 2 * 1.7
          : 0,
        pursuitPhase: 'tail',
        // staggered, so the squad takes turns rather than all lunging at once
        pursuitT: 2.5 + i * 2.4,
        pursuitSide: i % 2 === 0 ? 1 : -1
      });
    }
  }

  reset(grid: { s: number; x: number }[]): void {
    this.rivals.forEach((r, i) => {
      r.s = grid[i].s;
      r.x = grid[i].x;
      r.v = 0;
      r.finishTime = -1;
      r.bumpCooldown = 0;
      r.damage = 0;
      r.lastHitAt = -10;
      r.tumbleT = 0;
      r.rollA = 0;
      r.overtakeCooldown = 0;
      // Police Chase: units gridded behind the player chase (first run
      // staggered per unit); units gridded ahead lie in wait and attack.
      r.pursuitPhase = grid[i].s > 0 ? 'block' : 'tail';
      r.pursuitT = grid[i].s > 0 ? 6 : 2.5 + i * 2.4;
      this.sync(r, 0);
    });
  }

  /** Wreck a rival — it rolls, sheds speed, and rejoins the race after. */
  wreck(r: Rival): void {
    r.tumbleT = TUMBLE_TIME;
    r.rollA = 0;
    r.damage = 0;
    r.v *= 0.2 * r.tune.recoveryRate;
  }

  update(
    dt: number, elapsed: number, raceTime: number, playerS: number,
    driving: boolean, playerX = 0, aggression = 0, playerV = 0
  ): void {
    const total = this.raceLength || this.track.length;
    for (const r of this.rivals) {
      r.bumpCooldown = Math.max(0, r.bumpCooldown - dt);
      r.overtakeCooldown = Math.max(0, r.overtakeCooldown - dt);
      if (r.damage > 0 && elapsed - r.lastHitAt > 3.5) r.damage = 0;

      if (r.tumbleT > 0) {
        r.tumbleT -= dt;
        r.rollA += dt * 9;
        r.v = THREE.MathUtils.damp(r.v, 2, 6, dt);
        r.s += r.v * dt;
        this.sync(r, elapsed);
        continue;
      }

      let target = 0;
      if (driving) {
        const progression = Math.min(1, r.s / total) * END_SPEED_BONUS;
        const gap = r.s - playerS;
        if (this.pursuit) {
          target = this.pursue(r, dt, gap, playerV, progression);
        } else {
          const wobble = Math.sin(elapsed * 0.7 * r.tune.wobbleFreq + r.wobblePhase);
          target = r.baseSpeed + progression + wobble * 1.2;
          // rubber band: keep the pack racing the player
          if (gap < -70) target += 6;
          else if (gap < -25) target += 2.5;
          else if (gap > 90) target -= 5;
          else if (gap > 35) target -= 1.5;

          // drafting: rivals behind another car at close range get a speed boost
          if (r.tune.draftSeek > 0) {
            for (const other of this.rivals) {
              if (other === r || other.tumbleT > 0) continue;
              const sGap = other.s - r.s;
              if (sGap > 3 && sGap < 20 && Math.abs(other.x - r.x) < 1.5 && r.v > 18) {
                target += 2.5 * r.tune.draftSeek;
                break;
              }
            }
          }
        }
      }
      if (driving) {
        // brake for the bend ahead — personality affects how far they look
        let k = 0;
        const lookDists = [8, 18, 30].map(d => d * r.tune.brakeLookahead);
        for (const look of lookDists) {
          k = Math.max(k, Math.abs(this.track.frame(r.s + look).curvature));
        }
        const grip = RIVAL_LAT_GRIP * this.gripMul;
        if (k > 1e-4) {
          target = Math.min(target, Math.sqrt((grip * r.skill) / k));
        }
        const kNow = Math.abs(this.track.frame(r.s).curvature);
        if (!this.pursuit && kNow * r.v * r.v > grip * r.skill * 2.1) {
          this.wreck(r);
          continue;
        }
      }
      r.v = THREE.MathUtils.damp(r.v, target, 1.6, dt * 4);
      r.s += r.v * dt;

      // racing line: personality-modulated weave
      const wAmp = (ROAD_HALF_WIDTH - 1.8) * r.tune.wobbleAmp;
      let line = Math.sin(r.s * 0.015 * r.tune.wobbleFreq + r.wobblePhase) * wAmp;

      // overtaking: if a rival is close ahead and slower, swerve around it
      if (driving && !this.pursuit && r.overtakeCooldown <= 0) {
        for (const other of this.rivals) {
          if (other === r || other.tumbleT > 0) continue;
          const sGap = other.s - r.s;
          // close ahead and going slower
          if (sGap > 0 && sGap < 12 && Math.abs(other.x - r.x) < 2.5 && other.v < r.v - 1) {
            if (Math.random() < r.tune.overtakeUrge) {
              // pick the side with more room
              const goLeft = other.x > 0 ? -1 : 1;
              r.lastOvertakeDir = goLeft;
              line = THREE.MathUtils.clamp(
                other.x + goLeft * 3.2,
                -(ROAD_HALF_WIDTH - 1), ROAD_HALF_WIDTH - 1
              );
              r.overtakeCooldown = 2.0 + Math.random() * 1.5;
            }
            break;
          }
        }
        // also overtake the PLAYER if rival is faster and near
        const pGap = playerS - r.s;
        if (pGap > 0 && pGap < 12 && Math.abs(playerX - r.x) < 2.5 && r.v > playerV + 1) {
          if (Math.random() < r.tune.overtakeUrge * 0.7) {
            const goSide = playerX > 0 ? -1 : 1;
            line = THREE.MathUtils.clamp(
              playerX + goSide * 3.0,
              -(ROAD_HALF_WIDTH - 1), ROAD_HALF_WIDTH - 1
            );
            r.overtakeCooldown = 2.5;
          }
        }
      }

      // blocking: if the player (or a faster rival) is close behind, weave to defend
      if (driving && !this.pursuit && r.tune.blockUrge > 0.3) {
        const pBehind = r.s - playerS;
        if (pBehind > 2 && pBehind < 18 && playerV > r.v) {
          // shift toward the player's lane to make passing harder
          const blockLine = THREE.MathUtils.clamp(
            playerX, -(ROAD_HALF_WIDTH - 1.2), ROAD_HALF_WIDTH - 1.2
          );
          line = THREE.MathUtils.lerp(line, blockLine, r.tune.blockUrge * 0.6);
        }
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
          THREE.MathUtils.clamp(lane, -(ROAD_HALF_WIDTH - 1), ROAD_HALF_WIDTH - 1),
          r.pursuitPhase === 'tail' ? 0.6 : 0.92
        );
      } else if (aggression > 0 && driving && Math.abs(r.s - playerS) < 9) {
        // aggressive modes: nearby rivals abandon the line and hunt the player
        line = THREE.MathUtils.clamp(playerX, -(ROAD_HALF_WIDTH - 1), ROAD_HALF_WIDTH - 1);
      }
      r.x = THREE.MathUtils.damp(r.x, line, 1.2 + aggression * 1.6, dt);

      if (r.finishTime < 0 && r.s >= total) r.finishTime = raceTime;
      this.sync(r, elapsed);
    }
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
          r.pursuitT = gap > 0 ? 6 : 2.2;
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
          r.pursuitT = passed ? 1.5 + Math.random() * 2 : 2.2;
        }
        break;
      case 'drop':
        if (r.pursuitT <= 0) {
          r.pursuitPhase = 'tail';
          r.pursuitT = 2 + Math.random() * 3;
        }
        break;
    }

    switch (r.pursuitPhase) {
      case 'surge': return playerV + 9;    // run them down
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
    syncCarGroundFx(r.mesh);
  }
}
