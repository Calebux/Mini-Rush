import * as THREE from 'three';
import type { AssetLibrary } from '../assets';
import { disposeCarInstance } from '../assets';
import { CARS } from '../cars';
import { glow } from '../neonCity';
import { CityDrive } from './drive';
import { streetAt } from './layout';
import { P, RING_MID } from './roads';

/**
 * CITY GP: a race on the open city's own streets — the bounty's new home.
 * One fixed circuit (Downtown, east along Fourth, down to the expressway,
 * round the harbour, back up Sixth), checkpoint gates at every corner,
 * two laps, seven pro drivers. Pass the gates in order; miss one and the
 * next never lights until you go back for it.
 */

export const LAPS = 2;
const GATE_RADIUS = 13;
const FIELD = 7;

/** The circuit's corners, in order. It closes back on the first. */
export const CIRCUIT: P[] = [
  { x: streetAt(3), z: streetAt(4) },
  { x: streetAt(9), z: streetAt(4) },
  { x: streetAt(9), z: streetAt(7) },
  { x: RING_MID, z: streetAt(7) },
  { x: RING_MID, z: RING_MID },
  { x: streetAt(6), z: RING_MID },
  { x: streetAt(6), z: streetAt(9) },
  { x: streetAt(3), z: streetAt(9) }
];

/** Gates: every corner, plus one halfway down each long straight. */
function gates(): P[] {
  const out: P[] = [];
  for (let i = 0; i < CIRCUIT.length; i++) {
    const a = CIRCUIT[i], b = CIRCUIT[(i + 1) % CIRCUIT.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len > 300) out.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    out.push(b);
  }
  return out;
}

export const GATES = gates();
export const LAP_METRES = CIRCUIT.reduce((sum, a, i) => {
  const b = CIRCUIT[(i + 1) % CIRCUIT.length];
  return sum + Math.hypot(b.x - a.x, b.z - a.z);
}, 0);

const RIVAL_NAMES = ['VOLT', 'KESTREL', 'NOMAD', 'ORBIT', 'SABLE', 'TALON', 'EMBER'];
const RIVAL_COLORS = [0x22e6ff, 0xffb23a, 0x9dff5a, 0xa36bff, 0xf2f4ff, 0xff4a4a, 0xff7a1f];

interface Racer {
  name: string;
  drive: CityDrive;
  mesh: THREE.Group | null;     // null: the player (their car is drawn by the city)
  gate: number;                 // index of the next gate to pass, across all laps
  finish: number;               // race time at the line, -1 until then
  skill: number;                // 0.95..1.02 of the car's top speed
  stuck: number;                // seconds crawling while trying to go
  reverseT: number;             // seconds left backing out of a wall
}

export interface CityRaceStatus {
  phase: 'countdown' | 'racing' | 'finished';
  countdown: number;
  lap: number;
  place: number;
  field: number;
  time: number;
  next: P & { label: string; color: number };
  results: { name: string; time: number; you: boolean; estimated: boolean }[];
}

export class CityRace {
  phase: CityRaceStatus['phase'] = 'countdown';
  private t = -3.2;              // negative: counting down
  private racers: Racer[] = [];
  private gateMeshes: THREE.Group[] = [];
  private gateMat: THREE.MeshBasicMaterial;
  private postMat: THREE.MeshStandardMaterial;
  private events: string[] = [];

  constructor(private scene: THREE.Scene, assets: AssetLibrary, player: CityDrive, playerName: string) {
    this.gateMat = new THREE.MeshBasicMaterial({ map: glow(), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false });
    this.postMat = new THREE.MeshStandardMaterial({ color: 0x1c2233, roughness: 0.5, metalness: 0.4 });
    this.buildGates();
    // the grid: two columns behind the start line, player at the back left
    const a = CIRCUIT[0], b = CIRCUIT[1];
    const dir = new THREE.Vector2(b.x - a.x, b.z - a.z).normalize();
    const side = new THREE.Vector2(dir.y, -dir.x);
    const slot = (k: number) => ({
      x: a.x - dir.x * (12 + Math.floor(k / 2) * 9) + side.x * (k % 2 ? 3.4 : -3.4),
      z: a.z - dir.y * (12 + Math.floor(k / 2) * 9) + side.y * (k % 2 ? 3.4 : -3.4)
    });
    const yaw = Math.atan2(dir.x, dir.y);
    // a one-make race: the free sports car for everyone, each in its own neon
    for (let k = 0; k < FIELD; k++) {
      const spec = { ...CARS[0], color: RIVAL_COLORS[k] };
      const drive = CityDrive.forSpec(spec);
      const p = slot(k);
      drive.x = p.x; drive.z = p.z; drive.yaw = yaw;
      const mesh = assets.cloneCar(spec);
      mesh.position.set(p.x, 0, p.z);
      mesh.rotation.y = yaw;
      scene.add(mesh);
      this.racers.push({ name: RIVAL_NAMES[k], drive, mesh, gate: 0, finish: -1, skill: 0.95 + (k / FIELD) * 0.07, stuck: 0, reverseT: 0 });
    }
    const you = slot(FIELD);
    player.x = you.x; player.z = you.z; player.yaw = yaw; player.vel.set(0, 0);
    this.racers.push({ name: playerName, drive: player, mesh: null, gate: 0, finish: -1, skill: 1, stuck: 0, reverseT: 0 });
  }

  private get player(): Racer {
    return this.racers[this.racers.length - 1];
  }

  /** The rivals' positions, for the map. */
  rivals(): P[] {
    return this.racers.filter((r) => r.mesh).map((r) => ({ x: r.drive.x, z: r.drive.z }));
  }

  consumeEvent(): string | null {
    return this.events.shift() ?? null;
  }

  /** Neon arches over the road at each gate; the start/finish one checkered white. */
  private buildGates(): void {
    GATES.forEach((g, i) => {
      const prev = GATES[(i - 1 + GATES.length) % GATES.length];
      const along = new THREE.Vector2(g.x - prev.x, g.z - prev.z).normalize();
      const group = new THREE.Group();
      group.position.set(g.x, 0, g.z);
      group.rotation.y = Math.atan2(along.x, along.y);
      const span = 9.5;
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), this.postMat);
        post.position.set(sx * span, 3.5, 0);
        group.add(post);
      }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.5, 0.6, 0.5), this.postMat);
      bar.position.y = 7;
      group.add(bar);
      const light = new THREE.Mesh(new THREE.PlaneGeometry(span * 2.2, 4), this.gateMat.clone());
      light.position.y = 6.2;
      light.name = 'gate-light';
      group.add(light);
      this.scene.add(group);
      this.gateMeshes.push(group);
    });
  }

  update(dt: number): void {
    this.t += dt;
    if (this.phase === 'countdown') {
      for (const r of this.racers) r.drive.vel.set(0, 0);
      const n = Math.ceil(-this.t);
      if (n !== this.lastCount) { this.lastCount = n; this.events.push(n > 0 ? String(n) : 'GO'); }
      if (this.t >= 0) this.phase = 'racing';
      this.paintGates();
      return;
    }
    for (const r of this.racers) {
      if (r.mesh) this.driveRival(r, dt);
      // gates: the next one within reach counts
      const total = GATES.length * LAPS;
      if (r.finish < 0 && r.gate < total) {
        if (this.passed(r)) {
          r.gate++;
          if (r === this.player && r.gate < total) {
            if (r.gate % GATES.length === 0) this.events.push(`LAP ${Math.floor(r.gate / GATES.length) + 1} / ${LAPS}`);
          }
          if (r.gate >= total) {
            r.finish = this.t;
            if (r === this.player) { this.phase = 'finished'; this.events.push('FINISH'); }
          }
        }
      }
    }
    // cars shove each other apart
    for (let i = 0; i < this.racers.length; i++) for (let j = i + 1; j < this.racers.length; j++) {
      const a = this.racers[i].drive, b = this.racers[j].drive;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 2.6) {
        const push = (2.6 - d) / 2, nx = dx / d, nz = dz / d;
        a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
      }
    }
    for (const r of this.racers) if (r.mesh) { r.mesh.position.set(r.drive.x, 0, r.drive.z); r.mesh.rotation.set(0, r.drive.yaw, 0); }
    this.paintGates();
  }

  private lastCount = 99;

  /**
   * Through the next gate: within reach of its middle, or across its line
   * anywhere on the road. A car shoved wide still gets it, so nobody has to
   * turn back for a gate they drove under.
   */
  private passed(r: Racer): boolean {
    const i = r.gate % GATES.length;
    const g = GATES[i], prev = GATES[(i - 1 + GATES.length) % GATES.length];
    const dx = r.drive.x - g.x, dz = r.drive.z - g.z;
    if (Math.hypot(dx, dz) < GATE_RADIUS) return true;
    const len = Math.hypot(g.x - prev.x, g.z - prev.z) || 1;
    const ax = (g.x - prev.x) / len, az = (g.z - prev.z) / len;
    const along = dx * ax + dz * az, across = Math.abs(dx * az - dz * ax);
    return along > 0 && along < 30 && across < 22;
  }

  /** A rival aims a little way down the circuit and brakes for the corner ahead. */
  private driveRival(r: Racer, dt: number): void {
    const d = r.drive;
    // over the line: roll to a stop (holding the brake at a standstill would reverse)
    if (r.finish >= 0) { d.update(dt, { steer: 0, gas: false, brake: d.speed > 0.5 }); return; }
    // nosed into a wall: back out, turning away, then go again
    if (r.reverseT > 0) {
      r.reverseT -= dt;
      d.update(dt, { steer: r.reverseT > 0.6 ? 1 : -1, gas: false, brake: true });
      return;
    }
    const g = GATES[r.gate % GATES.length];
    const after = GATES[(r.gate + 1) % GATES.length];
    const toGate = Math.hypot(g.x - d.x, g.z - d.z);
    // blend toward the gate after as this one comes close, so corners are cut smoothly
    const blend = THREE.MathUtils.clamp(1 - toGate / 24, 0, 0.6);
    const aim = { x: g.x + (after.x - g.x) * blend, z: g.z + (after.z - g.z) * blend };
    const want = Math.atan2(aim.x - d.x, aim.z - d.z);
    const diff = Math.atan2(Math.sin(want - d.yaw), Math.cos(want - d.yaw));
    // how sharp the coming corner is decides the speed to arrive at
    const inA = Math.atan2(g.x - d.x, g.z - d.z), outA = Math.atan2(after.x - g.x, after.z - g.z);
    const turn = Math.abs(Math.atan2(Math.sin(outA - inA), Math.cos(outA - inA)));
    const cornerSpeed = turn > 0.6 ? 17 + (1 - turn / Math.PI) * 10 : 99;
    const safe = Math.sqrt(cornerSpeed * cornerSpeed + 2 * 20 * Math.max(0, toGate - 6));
    const brake = d.speed > safe || (Math.abs(diff) > 0.9 && d.speed > 15);
    const gas = !brake && d.speed < 40 * r.skill;
    r.stuck = gas && d.speed < 3 ? r.stuck + dt : 0;
    if (r.stuck > 1.2) { r.stuck = 0; r.reverseT = 1.3; }
    // behind you on a long straight: they use the nitro to stay in the fight
    if (toGate > 140 && Math.abs(diff) < 0.12 && this.progress(r) < this.progress(this.player) - 0.3) d.fireNitro();
    d.update(dt, { steer: THREE.MathUtils.clamp(-diff * 2.6, -1, 1), gas, brake });
  }

  /** The next gate glows magenta, the rest dim cyan, the start/finish white. */
  private paintGates(): void {
    const next = this.player.gate % GATES.length;
    this.gateMeshes.forEach((g, i) => {
      const m = (g.getObjectByName('gate-light') as THREE.Mesh).material as THREE.MeshBasicMaterial;
      const start = i === GATES.length - 1;
      const color = i === next ? 0xff2e9a : start ? 0xffffff : 0x22e6ff;
      m.color.setHex(color).multiplyScalar(i === next ? 1.6 : 0.45);
    });
  }

  /** Progress in gates plus how far along to the next, for ordering the field. */
  private progress(r: Racer): number {
    if (r.finish >= 0) return 1e6 - r.finish;
    const g = GATES[r.gate % GATES.length], prev = GATES[(r.gate - 1 + GATES.length) % GATES.length];
    const seg = Math.hypot(g.x - prev.x, g.z - prev.z) || 1;
    return r.gate + 1 - Math.min(1, Math.hypot(g.x - r.drive.x, g.z - r.drive.z) / seg);
  }

  status(): CityRaceStatus {
    const order = [...this.racers].sort((a, b) => this.progress(b) - this.progress(a));
    const you = this.player;
    const g = GATES[you.gate % GATES.length];
    const last = you.gate % GATES.length === GATES.length - 1;
    const lap = Math.min(LAPS, Math.floor(you.gate / GATES.length) + 1);
    // the finishing order: those home by their time, the rest by where they are
    const results = order.map((r) => ({
      name: r.name, you: r === you, estimated: r.finish < 0,
      time: r.finish >= 0 ? r.finish : this.t + (GATES.length * LAPS - this.progress(r)) * (LAP_METRES / GATES.length) / 38
    }));
    return {
      phase: this.phase, countdown: Math.max(0, Math.ceil(-this.t)), lap, place: order.indexOf(you) + 1,
      field: this.racers.length, time: Math.max(0, you.finish >= 0 ? you.finish : this.t),
      next: { ...g, label: last && lap === LAPS ? 'FINISH' : `GATE ${(you.gate % GATES.length) + 1}`, color: 0xff2e9a },
      results
    };
  }

  dispose(): void {
    for (const r of this.racers) if (r.mesh) { this.scene.remove(r.mesh); disposeCarInstance(r.mesh); }
    for (const g of this.gateMeshes) {
      this.scene.remove(g);
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.geometry.dispose(); if (m.material !== this.postMat) (m.material as THREE.Material).dispose(); }
      });
    }
    this.gateMat.dispose();
    this.postMat.dispose();
  }
}
