import * as THREE from 'three';
import { AssetLibrary } from './assets';
import { BASE_SPEED, END_SPEED_BONUS, RIVAL_LAT_GRIP, ROAD_HALF_WIDTH } from './constants';
import { buildCar } from './meshes';
import { Track } from './track';

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
}

const NAMES = ['BLAZE', 'VOLT', 'RUST', 'HAVOC', 'JINX', 'DIESEL', 'MAULER'];

const TUMBLE_TIME = 1.4;

/** AI racers: racing-line wander, rubber-banding, zombie plowing. */
export class RivalManager {
  rivals: Rival[] = [];
  raceLength = 0; // laps × track length; set by the game each race
  gripMul = 1;    // weather grip modifier (<1 = slippery), set per race

  constructor(
    scene: THREE.Scene, assets: AssetLibrary, private track: Track,
    avoidModel = -1, // traffic slot the player is driving
    count = 3,
    private pursuit = false // Cop Chase: the single rival is THE HEAT
  ) {
    for (let i = 0; i < count; i++) {
      const mesh = (pursuit ? assets.clonePolice() : assets.cloneTraffic(i, avoidModel))
        ?? buildCar(i + 1);
      scene.add(mesh);
      this.rivals.push({
        name: pursuit ? 'THE HEAT' : NAMES[i % NAMES.length],
        mesh,
        s: 0, x: 0, v: 0,
        baseSpeed: BASE_SPEED - 1.5 + (i % 4) * 1.2,
        wobblePhase: i * 2.4,
        finishTime: -1,
        bumpCooldown: 0,
        damage: 0,
        lastHitAt: -10,
        tumbleT: 0,
        rollA: 0,
        skill: pursuit ? 1.3 : 0.92 + (i % 3) * 0.11
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
      this.sync(r, 0);
    });
  }

  /** Wreck a rival — it rolls, sheds speed, and rejoins the race after. */
  wreck(r: Rival): void {
    r.tumbleT = TUMBLE_TIME;
    r.rollA = 0;
    r.damage = 0;
    r.v *= 0.2;
  }

  update(
    dt: number, elapsed: number, raceTime: number, playerS: number,
    driving: boolean, playerX = 0, aggression = 0, playerV = 0
  ): void {
    const total = this.raceLength || this.track.length;
    for (const r of this.rivals) {
      r.bumpCooldown = Math.max(0, r.bumpCooldown - dt);
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
          // the cop matches the PLAYER's speed plus a gap correction, so it
          // parks in the mirrors at any pace. On the power it only shadows
          // you; lift off and it rams every bump cooldown until you're busted
          target = playerV + THREE.MathUtils.clamp((-3.5 - gap) * 0.7, -30, 10);
          if (gap > -8) target += playerV > BASE_SPEED * 0.75 ? -1.2 : 2.5;
          target = Math.min(target, r.baseSpeed + 12 + progression);
        } else {
          target = r.baseSpeed + progression + Math.sin(elapsed * 0.7 + r.wobblePhase) * 1.2;
          // rubber band: keep the pack racing the player
          if (gap < -70) target += 6;
          else if (gap < -25) target += 2.5;
          else if (gap > 90) target -= 5;
          else if (gap > 35) target -= 1.5;
        }
      }
      if (driving) {
        // brake for the bend ahead: cap speed so lateral force (v²·k) stays
        // inside the AI's grip. Sloppy skill = later, lighter braking.
        let k = 0;
        for (const look of [8, 18, 30]) {
          k = Math.max(k, Math.abs(this.track.frame(r.s + look).curvature));
        }
        // weather cuts the AI's cornering grip just like it does the player's,
        // so rain/sandstorm slows the whole field, not only the human
        const grip = RIVAL_LAT_GRIP * this.gripMul;
        if (k > 1e-4) {
          target = Math.min(target, Math.sqrt((grip * r.skill) / k));
        }
        // already past the limit mid-corner (rubber-band shove, late braking):
        // the overcooked ones spin out — same rules as the player at the wall
        const kNow = Math.abs(this.track.frame(r.s).curvature);
        if (!this.pursuit && kNow * r.v * r.v > grip * r.skill * 2.1) {
          this.wreck(r);
          continue;
        }
      }
      r.v = THREE.MathUtils.damp(r.v, target, 1.6, dt * 4);
      r.s += r.v * dt;

      // racing line: lazy weave, stay on the asphalt
      let line = Math.sin(r.s * 0.015 + r.wobblePhase) * (ROAD_HALF_WIDTH - 1.8);
      // aggressive modes: nearby rivals abandon the line and hunt the player
      const huntRange = this.pursuit ? 16 : 9;
      if (aggression > 0 && driving && Math.abs(r.s - playerS) < huntRange) {
        line = THREE.MathUtils.clamp(playerX, -(ROAD_HALF_WIDTH - 1), ROAD_HALF_WIDTH - 1);
      }
      r.x = THREE.MathUtils.damp(r.x, line, 1.2 + aggression * 1.6, dt);

      if (r.finishTime < 0 && r.s >= total) r.finishTime = raceTime;
      this.sync(r, elapsed);
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
  }
}
