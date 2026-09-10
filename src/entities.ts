import * as THREE from 'three';
import { ROAD_HALF_WIDTH } from './constants';
import { buildCoin, buildNitro, mulberry32 } from './meshes';
import { Track } from './track';

interface Pickup {
  s: number;
  x: number;
  obj: THREE.Object3D;
  taken: boolean;
  kind: 'coin' | 'nitro';
}

/**
 * Collectibles on the asphalt: coin arcs and nitro tanks. All placed at
 * generation time; only a sliding window near the player is animated and
 * collision-checked.
 */
export class Entities {
  private pickups: Pickup[] = [];
  private group = new THREE.Group();
  private pLo = 0;

  constructor(scene: THREE.Scene, track: Track, seed: number) {
    const rand = mulberry32(seed ^ 0xb10b);

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

  /** Fresh pickups for a new lap; the window pointer restarts. */
  beginLap(): void {
    this.pLo = 0;
    for (const p of this.pickups) {
      p.taken = false;
      p.obj.visible = false;
    }
  }

  /** Animate the pickups in the window near playerS (lap-wrapped). */
  update(_dt: number, elapsed: number, playerS: number): void {
    this.pLo = this.advance(this.pickups, this.pLo, playerS);
    for (let i = this.pLo; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      if (p.s > playerS + 175) break;
      if (!p.taken && !p.obj.visible) p.obj.visible = true;
      if (!p.taken) p.obj.rotation.y = elapsed * 3;
    }
  }

  private advance(items: { s: number; obj: THREE.Object3D }[], lo: number, playerS: number): number {
    while (lo < items.length && items[lo].s < playerS - 35) {
      items[lo].obj.visible = false;
      lo++;
    }
    return lo;
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

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
  }
}
