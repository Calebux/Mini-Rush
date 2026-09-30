import * as THREE from 'three';
import type { AssetLibrary } from '../assets';
import { disposeCarInstance } from '../assets';
import { glow } from '../neonCity';
import { CityDrive } from './drive';
import { EDGE } from './layout';
import { junctionsNear, P, route } from './roads';

/**
 * Wanted level for the open city. Drive recklessly — ram traffic, smash into
 * walls at speed, run down the police — and the stars climb; stars bring the
 * police. 1–2 stars: patrol cars. 3: a helicopter with a searchlight joins.
 * 4–5: the armoured truck too.
 *
 * Police drive the same car physics as the player and follow the road graph
 * to you, so they turn corners rather than hunting through buildings. Get
 * clear of them (and out from under the helicopter) and the stars fade; stop
 * with a cruiser on you and you are busted.
 */

const MAX_STARS = 5;
const EVADE_RADIUS = 105;        // no unit this close: you are out of sight
const EVADE_TIME = 9;            // seconds out of sight to lose the stars
const BUST_TIME = 3;             // seconds stopped beside a cruiser
const HELI_HEIGHT = 34;

export type PoliceEvent = { type: 'wanted' | 'evaded' | 'busted'; stars: number };

interface Unit {
  kind: 'car' | 'truck';
  mesh: THREE.Group;
  drive: CityDrive;
  path: P[];
  replan: number;
  stuck: number;
  reverse: number;
  lights: THREE.Mesh[];
  fails?: number;
  gone?: boolean;
}

export class CityPolice {
  /** 0..5; fractional between thresholds. */
  heat = 0;
  private units: Unit[] = [];
  private heli: THREE.Group | null = null;
  private heliRotors: THREE.Object3D[] = [];
  private beam: THREE.Mesh | null = null;
  private evade = 0;
  private bust = 0;
  private time = 0;
  private events: PoliceEvent[] = [];
  private truckModel: THREE.Group | null = null;
  private heliModel: THREE.Group | null = null;
  private sirenOn = false;

  constructor(private scene: THREE.Scene, private assets: AssetLibrary,
    private audio: { startSiren(): void; siren(level: number): void; stopSiren(): void }) {
    assets.loadExtra('armored_truck.glb', 6.4).then((m) => { this.truckModel = m; });
    assets.loadExtra('police_heli.glb', 11).then((m) => { this.heliModel = m; });
  }

  get stars(): number {
    return Math.min(MAX_STARS, Math.floor(this.heat));
  }

  /** 0..1: how close you are to being busted. */
  get bustProgress(): number {
    return this.bust / BUST_TIME;
  }

  /** 0..1: how far through losing them you are. */
  get evadeProgress(): number {
    return this.stars > 0 ? this.evade / EVADE_TIME : 0;
  }

  consumeEvent(): PoliceEvent | null {
    return this.events.shift() ?? null;
  }

  /** Something reckless happened: `amount` in fractions of a star. */
  crime(amount: number): void {
    const before = this.stars;
    this.heat = Math.min(MAX_STARS + 0.99, this.heat + amount);
    this.evade = 0;
    if (this.stars > before) this.events.push({ type: 'wanted', stars: this.stars });
  }

  /** Clear everything: after a bust, or when leaving the city. */
  clear(): void {
    this.heat = 0;
    this.evade = this.bust = 0;
    for (const u of this.units) this.removeUnit(u);
    this.units = [];
    if (this.heli) { this.scene.remove(this.heli); this.heli = null; this.heliRotors = []; }
    if (this.sirenOn) { this.audio.stopSiren(); this.sirenOn = false; }
  }

  update(dt: number, player: CityDrive): void {
    this.time += dt;
    const stars = this.stars;
    this.spawn(stars, player);

    // drive the units along the roads to the player
    let nearest = Infinity;
    for (const u of this.units) {
      const dx = player.x - u.drive.x, dz = player.z - u.drive.z;
      const dist = Math.hypot(dx, dz);
      nearest = Math.min(nearest, dist);
      this.driveUnit(u, player, dist, dt);
      if (u.gone) continue;
      // contact: shove the player; ramming a cruiser is a crime of its own
      if (dist < (u.kind === 'truck' ? 4.4 : 3.6) && dist > 0.01 && Math.abs(u.drive.speed) > 6) {
        const nx = dx / dist, nz = dz / dist;
        const force = u.kind === 'truck' ? 9 : 5;
        player.bumpFromTraffic(nx, nz, force);
        u.drive.x -= nx * 0.5;
        u.drive.z -= nz * 0.5;
        const ramming = Math.hypot(player.vel.x, player.vel.y) > 14;
        if (ramming) this.crime(0.05);
      }
      // flashing light bar
      const on = Math.floor(this.time * 7) % 2 === 0;
      u.lights.forEach((l, i) => { l.visible = (i === 0) === on; });
    }

    // hopelessly stuck units leave; spawn() sends replacements from the road
    for (const u of this.units.filter((v) => v.gone)) this.removeUnit(u);
    this.units = this.units.filter((v) => !v.gone);

    // the helicopter hangs over the player with its searchlight on them
    if (this.heli) {
      const target = new THREE.Vector3(player.x - 10, HELI_HEIGHT, player.z - 14);
      this.heli.position.lerp(target, 1 - Math.exp(-dt * 0.9));
      this.heli.lookAt(player.x, HELI_HEIGHT - 6, player.z);
      for (const r of this.heliRotors) r.rotation[r.userData.axis as 'x' | 'y' | 'z'] += dt * 38;
      if (this.beam) {
        const from = this.heli.position;
        const to = new THREE.Vector3(player.x, 0.2, player.z);
        const mid = from.clone().add(to).multiplyScalar(0.5);
        this.beam.position.copy(mid);
        this.beam.lookAt(to);
        this.beam.rotateX(Math.PI / 2);
        this.beam.scale.set(1, from.distanceTo(to), 1);
      }
      nearest = Math.min(nearest, Math.hypot(this.heli.position.x - player.x, this.heli.position.z - player.z));
    }

    // losing them: out of sight long enough and the stars go
    if (stars > 0) {
      if (nearest > EVADE_RADIUS) {
        this.evade += dt;
        if (this.evade >= EVADE_TIME) {
          this.events.push({ type: 'evaded', stars });
          this.clear();
          return;
        }
      } else {
        this.evade = Math.max(0, this.evade - dt * 2);
      }
      // busted: stopped with a unit on you
      const slow = Math.hypot(player.vel.x, player.vel.y) < 4;
      const unitNear = this.units.some((u) => Math.hypot(u.drive.x - player.x, u.drive.z - player.z) < 11);
      if (slow && unitNear) this.bust += dt;
      else this.bust = Math.max(0, this.bust - dt * 1.5);
      if (this.bust >= BUST_TIME) {
        this.events.push({ type: 'busted', stars });
        this.clear();
        return;
      }
    } else {
      // no stars: a little heat cools off on its own
      this.heat = Math.max(0, this.heat - dt * 0.05);
    }

    const siren = stars > 0 ? Math.min(1, 0.4 + (1 - Math.min(1, nearest / 140)) * 0.6) : 0;
    if (siren > 0 && !this.sirenOn) { this.audio.startSiren(); this.sirenOn = true; }
    if (siren === 0 && this.sirenOn) { this.audio.stopSiren(); this.sirenOn = false; }
    if (this.sirenOn) this.audio.siren(siren);
  }

  /** Bring the force up to what the stars call for. */
  private spawn(stars: number, player: CityDrive): void {
    const cars = [0, 1, 2, 3, 3, 4][stars];
    const trucks = stars >= 4 ? 1 : 0;
    const have = (k: Unit['kind']) => this.units.filter((u) => u.kind === k).length;
    if (have('car') < cars) this.addUnit('car', player);
    else if (have('truck') < trucks && this.truckModel) this.addUnit('truck', player);
    if (stars >= 3 && !this.heli && this.heliModel) this.addHeli(player);
  }

  private addUnit(kind: Unit['kind'], player: CityDrive): void {
    const mesh = kind === 'truck' ? this.truckModel!.clone(true) : this.assets.clonePolice();
    if (!mesh) return;
    // arrive on a road junction a block or two away, preferring behind the player
    const f = player.forward;
    const spots = junctionsNear({ x: player.x, z: player.z }, 70, 150);
    spots.sort((a, b) => ((a.x - player.x) * f.x + (a.z - player.z) * f.y) - ((b.x - player.x) * f.x + (b.z - player.z) * f.y));
    const spot = spots[Math.floor(Math.random() * Math.min(4, spots.length))]
      ?? { x: THREE.MathUtils.clamp(player.x - f.x * 90, -EDGE + 10, EDGE - 10), z: THREE.MathUtils.clamp(player.z - f.y * 90, -EDGE + 10, EDGE - 10) };
    const { x, z } = spot;
    const drive = new CityDrive(kind === 'truck' ? 30 : 38 + this.stars * 1.5, kind === 'truck' ? 0.8 : 1.15);
    drive.x = x; drive.z = z;
    drive.yaw = Math.atan2(player.x - x, player.z - z);
    // two lamps on the roof, red and blue, taking turns
    const box = new THREE.Box3().setFromObject(mesh);
    const top = box.max.y - mesh.position.y + 0.05;
    const lights = [0xff2a3a, 0x2a6bff].map((color, i) => {
      const lamp = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1),
        new THREE.MeshBasicMaterial({ map: glow(), color: new THREE.Color(color).multiplyScalar(2.2), transparent: true,
          depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      lamp.position.set(i ? 0.35 : -0.35, top, 0);
      lamp.rotation.x = -Math.PI / 2;
      lamp.renderOrder = 3;
      mesh.add(lamp);
      return lamp;
    });
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    this.units.push({ kind, mesh, drive, path: [], replan: 0, stuck: 0, reverse: 0, lights });
  }

  private addHeli(player: CityDrive): void {
    const heli = this.heliModel!.clone(true);
    heli.position.set(player.x + 120, HELI_HEIGHT + 20, player.z + 120);
    heli.traverse((o) => {
      if (/main\s*rotor/i.test(o.name)) { o.userData.axis = 'y'; this.heliRotors.push(o); }
      else if (/tail\s*rotor/i.test(o.name)) { o.userData.axis = 'x'; this.heliRotors.push(o); }
    });
    this.scene.add(heli);
    this.heli = heli;
    if (!this.beam) {
      const cone = new THREE.CylinderGeometry(0.4, 4.2, 1, 24, 1, true);
      this.beam = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xdfe8ff).multiplyScalar(0.18),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
      this.beam.renderOrder = 3;
    }
    this.scene.add(this.beam);
  }

  private driveUnit(u: Unit, player: CityDrive, dist: number, dt: number): void {
    const d = u.drive;
    // follow the road graph; the last stretch is straight at the player
    u.replan -= dt;
    if (u.replan <= 0) {
      u.path = dist < 45 ? [{ x: player.x, z: player.z }] : route({ x: d.x, z: d.z }, { x: player.x, z: player.z }).slice(1);
      u.replan = 0.7;
    }
    while (u.path.length > 1 && Math.hypot(u.path[0].x - d.x, u.path[0].z - d.z) < 9) u.path.shift();
    const aim = u.path[0] ?? { x: player.x, z: player.z };
    const want = Math.atan2(aim.x - d.x, aim.z - d.z);
    const diff = Math.atan2(Math.sin(want - d.yaw), Math.cos(want - d.yaw));
    // stuck against a kerb: back out for a moment
    if (Math.abs(d.speed) < 2 && dist > 12) u.stuck += dt; else u.stuck = 0;
    if (u.stuck > 1.2) { u.reverse = 1; u.stuck = 0; u.fails = (u.fails ?? 0) + 1; }
    if ((u.fails ?? 0) > 4 && dist > 60) { u.gone = true; return; }
    if (u.reverse > 0) {
      u.reverse -= dt;
      d.update(dt, { steer: Math.sign(diff), gas: false, brake: true });
    } else {
      const sharp = Math.abs(diff) > 1.1 && d.speed > 16;
      // close in, then pull up beside the player rather than ramming them;
      // a player still moving fast gets chased at full speed
      const playerFast = Math.hypot(player.vel.x, player.vel.y) > 8;
      const arriving = dist < 16 && !playerFast;
      const tooFast = arriving && d.speed > Math.max(3, (dist - 6) * 1.4);
      d.update(dt, { steer: THREE.MathUtils.clamp(-diff * 2.4, -1, 1), gas: !sharp && !tooFast && !(arriving && dist < 7), brake: sharp || tooFast });
    }
    u.mesh.position.set(d.x, 0, d.z);
    u.mesh.rotation.set(0, d.yaw, 0);
  }

  private removeUnit(u: Unit): void {
    this.scene.remove(u.mesh);
    for (const l of u.lights) (l.material as THREE.Material).dispose();
    if (u.kind === 'car') disposeCarInstance(u.mesh);
  }

  dispose(): void {
    this.clear();
    if (this.beam) {
      this.scene.remove(this.beam);
      this.beam.geometry.dispose();
      (this.beam.material as THREE.Material).dispose();
    }
  }
}

