import * as THREE from 'three';
import { AssetLibrary } from './assets';
import { districtIndexAt, ROAD_HALF_WIDTH } from './constants';
import { Flavor, MapSpec } from './maps';
import { buildBossZombie, buildCoin, buildNitro, buildZombie, mulberry32 } from './meshes';
import { toonMat } from './toon';
import { Track } from './track';

interface Zombie {
  s: number;
  x: number;
  obj: THREE.Object3D;
  phase: number;
  facing: number; // random heading offset
  squashedAt: number; // -1 = alive
  baseY: number;
}

interface Pickup {
  s: number;
  x: number;
  obj: THREE.Object3D;
  taken: boolean;
  kind: 'coin' | 'nitro';
}

interface Obstacle {
  s: number;
  x: number;
  obj: THREE.Object3D;
  hit: boolean;
}

interface Boss {
  s: number;
  x: number;
  obj: THREE.Object3D;
  hp: number;
  lastHitAt: number; // i-frame window start; -10 = never hit
  deadAt: number;    // -1 = alive
  baseHp: number;
}

// A boss shrugs off repeated drive-overs within this window (prevents one pass
// counting as three hits across consecutive frames).
const BOSS_IFRAME = 0.6;
const BOSS_HP = 3;

const ZOMBIE_DENSITY: Record<Flavor, number> = {
  towers: 0.85, palms: 0.6, pagoda: 0.9, park: 0.7, terrace: 1, market: 0.95,
  pyramids: 0.65, favela: 0.95, cyberarcade: 0.9
};

/**
 * Everything living/collectible on the asphalt. All placed at generation
 * time; only a sliding window near the player is animated & collision-checked.
 */
export class Entities {
  private zombies: Zombie[] = [];
  private pickups: Pickup[] = [];
  private obstacles: Obstacle[] = [];
  private boss: Boss | null = null;
  private group = new THREE.Group();
  private zLo = 0;
  private pLo = 0;
  private oLo = 0;

  constructor(
    scene: THREE.Scene, private track: Track, assets: AssetLibrary,
    seed: number, map: MapSpec, zombieMul = 1, latchers = false
  ) {
    const rand = mulberry32(seed ^ 0xb10b);

    // horde modes (Outbreak / high zombieMul) get a mini-boss per lap, parked
    // near 60% of the circuit. Not in latcher modes — the cling mechanic there
    // already fills the road.
    if (zombieMul >= 2 && !latchers) {
      const bs = track.length * 0.6;
      const bx = (rand() * 2 - 1) * (ROAD_HALF_WIDTH - 1.6);
      const obj = buildBossZombie(rand);
      track.place(obj, bs, bx);
      obj.visible = false;
      this.group.add(obj);
      this.boss = { s: bs, x: bx, obj, hp: BOSS_HP, lastHitAt: -10, deadAt: -1, baseHp: BOSS_HP };
    }

    // zombie clusters — the mode scales cluster odds and size (Outbreak horde)
    let s = latchers ? 42 : 130;
    while (s < track.length - 60) {
      const flavor = map.districts[districtIndexAt(s, track.length)].flavor;
      if (latchers || rand() < ZOMBIE_DENSITY[flavor] * zombieMul) {
        const count = latchers
          ? 3 + Math.floor(rand() * 3)
          : (2 + Math.floor(rand() * 4)) * (zombieMul >= 2 ? 2 : 1);
        for (let i = 0; i < count; i++) {
          const kit = assets.zombies;
          const obj = kit.length ? kit[Math.floor(rand() * kit.length)].clone(true) : buildZombie(rand);
          const zs = s + rand() * 14;
          const zx = latchers
            ? (rand() * 2 - 1) * Math.min(2.7, ROAD_HALF_WIDTH - 0.9)
            : (rand() * 2 - 1) * (ROAD_HALF_WIDTH - 0.8);
          if (latchers) obj.scale.multiplyScalar(1.45);
          track.place(obj, zs, zx);
          obj.visible = false;
          this.group.add(obj);
          this.zombies.push({
            s: zs, x: zx, obj, phase: rand() * 10,
            facing: rand() * Math.PI * 2, squashedAt: -1, baseY: 0
          });
        }
      }
      s += latchers ? 34 + rand() * 24 : 30 + rand() * 45;
    }
    this.zombies.sort((a, b) => a.s - b.s);

    if (latchers) {
      let os = 72;
      while (os < track.length - 50) {
        const obj = buildScrapeObstacle(rand);
        const ox = (rand() * 2 - 1) * Math.min(2.9, ROAD_HALF_WIDTH - 1);
        track.place(obj, os, ox);
        obj.visible = false;
        this.group.add(obj);
        this.obstacles.push({ s: os, x: ox, obj, hit: false });
        os += 58 + rand() * 38;
      }
    }

    // coin arcs
    for (let cs = 90; cs < track.length - 40; cs += 85 + rand() * 60) {
      const lane = (rand() * 2 - 1) * (ROAD_HALF_WIDTH - 1.6);
      const count = 5;
      for (let i = 0; i < count; i++) {
        const obj = buildCoin();
        track.place(obj, cs + i * 3, lane, 0.85);
        obj.visible = false;
        this.group.add(obj);
        this.pickups.push({ s: cs + i * 3, x: lane, obj, taken: false, kind: 'coin' });
      }
    }

    // nitro tanks
    for (let ns = 200; ns < track.length - 80; ns += 240 + rand() * 120) {
      const obj = buildNitro();
      const nx = (rand() * 2 - 1) * (ROAD_HALF_WIDTH - 2);
      track.place(obj, ns, nx);
      obj.visible = false;
      this.group.add(obj);
      this.pickups.push({ s: ns, x: nx, obj, taken: false, kind: 'nitro' });
    }
    this.pickups.sort((a, b) => a.s - b.s);

    scene.add(this.group);
  }

  /** Fresh zombies and pickups for a new lap; the window pointers restart. */
  beginLap(): void {
    this.zLo = 0;
    this.pLo = 0;
    this.oLo = 0;
    for (const z of this.zombies) {
      z.squashedAt = -1;
      z.obj.scale.y = 1;
      z.obj.visible = false;
    }
    for (const p of this.pickups) {
      p.taken = false;
      p.obj.visible = false;
    }
    for (const o of this.obstacles) {
      o.hit = false;
      o.obj.visible = false;
    }
    if (this.boss) {
      this.boss.hp = this.boss.baseHp;
      this.boss.lastHitAt = -10;
      this.boss.deadAt = -1;
      this.boss.obj.scale.setScalar(1.35);
      this.boss.obj.visible = false;
    }
  }

  /**
   * Animate the window near playerS (lap-wrapped) and collide against the
   * given position. Rivals call trySquash separately.
   */
  update(dt: number, elapsed: number, playerS: number): void {
    this.zLo = this.advance(this.zombies, this.zLo, playerS);
    this.pLo = this.advance(this.pickups, this.pLo, playerS);
    this.oLo = this.advance(this.obstacles, this.oLo, playerS);

    for (let i = this.zLo; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (z.s > playerS + 175) break;
      if (!z.obj.visible) z.obj.visible = true;
      if (z.squashedAt >= 0) {
        const t = Math.min(1, (elapsed - z.squashedAt) / 0.25);
        z.obj.scale.y = Math.max(0.12, 1 - t);
        z.obj.position.y = z.baseY * (1 - t);
        if (elapsed - z.squashedAt > 3) z.obj.visible = false;
      } else {
        // shamble: bob + sway + slow shuffle across the road
        z.obj.position.y = Math.abs(Math.sin(elapsed * 6 + z.phase)) * 0.09;
        z.obj.rotation.z = Math.sin(elapsed * 3 + z.phase) * 0.12;
        z.x += Math.sin(elapsed * 0.6 + z.phase) * 0.35 * dt;
        this.track.place(z.obj, z.s, z.x, z.obj.position.y);
        z.obj.rotation.y += z.facing;
      }
    }

    for (let i = this.pLo; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      if (p.s > playerS + 175) break;
      if (!p.taken && !p.obj.visible) p.obj.visible = true;
      if (!p.taken) p.obj.rotation.y = elapsed * 3;
    }

    for (let i = this.oLo; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      if (o.s > playerS + 175) break;
      if (!o.hit && !o.obj.visible) o.obj.visible = true;
    }

    const b = this.boss;
    if (b) {
      const near = b.s > playerS - 35 && b.s < playerS + 175;
      if (b.deadAt >= 0) {
        const t = Math.min(1, (elapsed - b.deadAt) / 0.4);
        b.obj.scale.setScalar(1.35 * Math.max(0.1, 1 - t));
        if (elapsed - b.deadAt > 3) b.obj.visible = false;
      } else if (near) {
        b.obj.visible = true;
        // menacing sway + a red flash during i-frames
        b.obj.position.y = Math.abs(Math.sin(elapsed * 4)) * 0.14;
        b.obj.rotation.y = Math.sin(elapsed * 1.5) * 0.25 + Math.PI;
        const flashing = elapsed - b.lastHitAt < BOSS_IFRAME;
        this.track.place(b.obj, b.s, b.x, b.obj.position.y);
        b.obj.visible = flashing ? Math.floor(elapsed * 20) % 2 === 0 : true;
      } else {
        b.obj.visible = false;
      }
    }
  }

  /**
   * Boss collision. A nitro drive-over is an instant kill; otherwise each pass
   * chips one HP, but only once per i-frame window. Returns what happened so the
   * game can pop text, shake, and award points/coins.
   */
  trySquashBoss(
    s: number, x: number, elapsed: number, nitro: boolean
  ): { hit: boolean; killed: boolean; coins: number; s: number; x: number } | null {
    const b = this.boss;
    if (!b || b.deadAt >= 0) return null;
    if (Math.abs(b.s - s) > 4 || Math.abs(b.x - x) > 2.2) return null;
    if (!nitro && elapsed - b.lastHitAt < BOSS_IFRAME) return null; // still invulnerable

    b.lastHitAt = elapsed;
    if (nitro) b.hp = 0;
    else b.hp -= 1;

    if (b.hp <= 0) {
      b.deadAt = elapsed;
      return { hit: true, killed: true, coins: 5, s: b.s, x: b.x };
    }
    return { hit: true, killed: false, coins: 0, s: b.s, x: b.x };
  }

  private advance(items: { s: number; obj: THREE.Object3D }[], lo: number, playerS: number): number {
    while (lo < items.length && items[lo].s < playerS - 35) {
      items[lo].obj.visible = false;
      lo++;
    }
    return lo;
  }

  /** Squash any zombie under the given car position. Returns count squashed. */
  trySquash(s: number, x: number, elapsed: number): number {
    let n = 0;
    for (let i = this.zLo; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (z.s > s + 3) break;
      if (z.squashedAt >= 0) continue;
      if (Math.abs(z.s - s) < 2.4 && Math.abs(z.x - x) < 1.3) {
        z.squashedAt = elapsed;
        z.baseY = z.obj.position.y;
        n++;
      }
    }
    return n;
  }

  /**
   * Gun modes: kill the first alive zombie in the lane corridor
   * [s0, s1] × |x ± tol|. Returns its position (for the impact puff) or null.
   */
  tryShoot(s0: number, s1: number, x: number, elapsed: number): { s: number; x: number } | null {
    for (let i = this.zLo; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (z.s > s1) break;
      if (z.s < s0 || z.squashedAt >= 0) continue;
      if (Math.abs(z.x - x) < 1.6) {
        z.squashedAt = elapsed;
        z.baseY = z.obj.position.y;
        return { s: z.s, x: z.x };
      }
    }
    return null;
  }

  /** Collect pickups under the player. */
  tryCollect(s: number, x: number): { coins: number; nitro: number } {
    let coins = 0, nitro = 0;
    for (let i = this.pLo; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      if (p.s > s + 3) break;
      if (p.taken) continue;
      if (Math.abs(p.s - s) < 2.2 && Math.abs(p.x - x) < 1.4) {
        p.taken = true;
        p.obj.visible = false;
        if (p.kind === 'coin') coins++;
        else nitro++;
      }
    }
    return { coins, nitro };
  }

  tryHitObstacle(s: number, x: number): number {
    let n = 0;
    for (let i = this.oLo; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      if (o.s > s + 3) break;
      if (o.hit) continue;
      if (Math.abs(o.s - s) < 2.6 && Math.abs(o.x - x) < 1.45) {
        o.hit = true;
        o.obj.visible = false;
        n++;
      }
    }
    return n;
  }

  /**
   * Query the lateral position of the nearest alive zombie ahead of s within
   * `range` metres. Returns null if the lane is clear — used by rival AI to
   * dodge clusters instead of mindlessly plowing through them.
   */
  nearestZombieAhead(s: number, range: number): { zs: number; zx: number } | null {
    for (let i = this.zLo; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (z.s > s + range) break;
      if (z.s < s + 2 || z.squashedAt >= 0) continue;
      return { zs: z.s, zx: z.x };
    }
    return null;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
  }
}

function buildScrapeObstacle(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const stripe = [toonMat(0xd9352b), toonMat(0xf2ead8)];
  const dark = toonMat(0x20242c);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.38, 0.42), stripe[Math.floor(rand() * 2)]);
  rail.position.y = 0.72;
  g.add(rail);
  for (const x of [-0.82, 0, 0.82]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.9, 0.18), dark);
    post.position.set(x, 0.38, 0);
    g.add(post);
  }
  const coneMat = toonMat(0xff8a1f);
  for (const x of [-1.25, 1.25]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.72, 4), coneMat);
    cone.position.set(x, 0.36, 0.18);
    cone.rotation.y = Math.PI / 4;
    g.add(cone);
  }
  g.rotation.y = (rand() * 2 - 1) * 0.18;
  return g;
}
