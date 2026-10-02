import * as THREE from 'three';
import { AssetLibrary, disposeCarInstance } from '../assets';
import { glow } from '../neonCity';
import { CityDrive } from './drive';
import { blockAt, EDGE } from './layout';
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
const HELI_HEIGHT = 14;          // low enough to sit in the top of the chase camera's view
const OFFICER_HEIGHT = 1.62;     // the officer as played, metres
const ARGUE_TIME = 3.6;          // seconds at the window before the fine

/** The officer walking up after a bust: out of the cruiser, to the window, arguing. */
interface Arrest {
  body: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  walk: THREE.AnimationAction | null;
  argue: THREE.AnimationAction | null;
  target: THREE.Vector3;
  phase: 'walk' | 'argue';
  t: number;
  stars: number;
  speed: number;
}

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
  /** half the car's height and width: where its middle sits upright and on its side */
  /**
   * Its job in the chase. Chasers sit on the player's tail, cutoffs take the
   * streets round and come at them from ahead, and a roadblock (3+ stars)
   * parks across the junction the player is heading for.
   */
  role: 'chase' | 'cutoff' | 'block';
  /** a roadblock in place: parked broadside, waiting */
  parked?: boolean;
  parkedFor?: number;
  /** the junction a roadblock is heading for, held until the player passes it */
  blockSpot?: P | null;
  half: number;
  halfW: number;
  /** flipped and out of the chase */
  wreck?: Wreck;
}

/** A cruiser rolled by a hard hit: ballistic, then settled on its roof or side. */
interface Wreck {
  t: number;
  y: number;         // height of the car's middle
  vy: number;
  roll: number;      // about the car's length: the barrel roll
  rollV: number;
  pitch: number;
  pitchV: number;
  yawV: number;
}

const GRAVITY = 22;
const WRECK_TIME = 7;            // seconds a wreck lies there before it is cleared
const FLIP_SPEED = 15;           // m/s of closing speed that rolls a cruiser (~55 km/h)

export class CityPolice {
  /** 0..5; fractional between thresholds. */
  heat = 0;
  /** set by the city: in daylight the helicopter keeps its searchlight off */
  daylight = false;
  private units: Unit[] = [];
  private heli: THREE.Group | null = null;
  /** the helicopter's lights: a slow red beacon and a white strobe, so it reads at night */
  private heliLights: THREE.Sprite[] = [];
  private heliRotors: THREE.Object3D[] = [];
  private beam: THREE.Mesh | null = null;
  private evade = 0;
  private bust = 0;
  private time = 0;
  private events: PoliceEvent[] = [];
  private truckModel: THREE.Group | null = null;
  private heliModel: THREE.Group | null = null;
  private sirenOn = false;
  private officerModel: { scene: THREE.Group; clips: THREE.AnimationClip[]; height: number } | null = null;
  private arrest: Arrest | null = null;

  constructor(private scene: THREE.Scene, private assets: AssetLibrary,
    private audio: { startSiren(): void; siren(level: number): void; stopSiren(): void; play(name: 'crash', volume?: number): void }) {
    assets.loadExtra('armored_truck.glb', 6.4).then((m) => { this.truckModel = m; });
    assets.loadExtra('police_heli.glb', 11).then((m) => {
      // the model file carries a stray ground quad ("Plane") from its scene,
      // scaled up hundreds of times: the odd rectangle under the helicopter
      const stray: THREE.Object3D[] = [];
      m?.traverse((o) => { if ((o as THREE.Mesh).isMesh && /^plane/i.test(o.name)) stray.push(o); });
      for (const o of stray) o.removeFromParent();
      this.heliModel = m;
    });
    assets.loadCharacter('police_officer.glb').then((m) => { this.officerModel = m; });
  }

  /** An arrest is playing: the player's car is held. */
  get arresting(): boolean {
    return this.arrest !== null;
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
    this.endArrest();
    this.heat = 0;
    this.evade = this.bust = 0;
    for (const u of this.units) this.removeUnit(u);
    this.units = [];
    if (this.heli) { this.scene.remove(this.heli); this.heli = null; this.heliRotors = []; }
    for (const l of this.heliLights) l.material.dispose();
    this.heliLights = [];
    if (this.sirenOn) { this.audio.stopSiren(); this.sirenOn = false; }
  }

  update(dt: number, player: CityDrive, traffic?: { block(d: CityDrive, radius?: number): { hit: number; nx: number; nz: number } } | null): void {
    this.time += dt;
    if (this.arrest) {
      this.updateArrest(dt, player);
      return;
    }
    const stars = this.stars;
    this.spawn(stars, player);

    // drive the units along the roads to the player
    let nearest = Infinity;
    for (const u of this.units) {
      if (u.wreck) {
        this.tumble(u, dt);
        // a wreck is still a car-sized lump of steel in the road
        const wx = player.x - u.drive.x, wz = player.z - u.drive.z, wd = Math.hypot(wx, wz);
        if (wd < 3.2 && wd > 0.01) player.bumpFromTraffic(wx / wd, wz / wd, 2.5);
        continue;
      }
      const dx = player.x - u.drive.x, dz = player.z - u.drive.z;
      const dist = Math.hypot(dx, dz);
      nearest = Math.min(nearest, dist);
      this.driveUnit(u, player, dist, dt);
      if (u.gone) continue;
      // civilians are solid: a cruiser bounces off them, and one that ploughs
      // into them flat out rolls over
      const blocked = traffic?.block(u.drive, u.kind === 'truck' ? 1.7 : 1.15);
      if (blocked && u.kind === 'car' && blocked.hit > 26) {
        this.flip(u, blocked.nx, blocked.nz, blocked.hit, null);
        continue;
      }
      // police cars are solid: the player can't drive through one, parked or not
      if (dist < 3.1 && dist > 0.01) {
        const push = 3.1 - dist;
        player.x += (dx / dist) * push;
        player.z += (dz / dist) * push;
      }
      // a hard hit rolls a cruiser: the player driving into it, or its own
      // crash. A cruiser ramming a slow player is not the player's hit.
      const playerInto = dist > 0.01 ? -(player.vel.x * dx + player.vel.y * dz) / dist : 0;
      if (u.kind === 'car' && dist < 3.8 && dist > 0.01 && playerInto > FLIP_SPEED) {
        const closing = Math.hypot(player.vel.x - u.drive.vel.x, player.vel.y - u.drive.vel.y);
        this.flip(u, -dx / dist, -dz / dist, closing, player);
        continue;
      }
      // contact: shove the player; ramming a cruiser is a crime of its own
      if (dist < (u.kind === 'truck' ? 4.4 : 3.6) && dist > 0.01 && Math.abs(u.drive.speed) > 6) {
        const nx = dx / dist, nz = dz / dist;
        const force = u.kind === 'truck' ? 12 : 8;
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

    // police cars can't pass through each other
    for (let i = 0; i < this.units.length; i++) for (let j = i + 1; j < this.units.length; j++) {
      const a = this.units[i], b = this.units[j];
      const ra = a.kind === 'truck' ? 1.7 : 1.15, rb = b.kind === 'truck' ? 1.7 : 1.15;
      const dx = b.drive.x - a.drive.x, dz = b.drive.z - a.drive.z, d = Math.hypot(dx, dz);
      if (d < 0.01 || d >= ra + rb) continue;
      const push = (ra + rb - d) / 2, nx = dx / d, nz = dz / d;
      a.drive.x -= nx * push; a.drive.z -= nz * push;
      b.drive.x += nx * push; b.drive.z += nz * push;
    }

    // hopelessly stuck units leave; spawn() sends replacements from the road
    for (const u of this.units.filter((v) => v.gone)) this.removeUnit(u);
    this.units = this.units.filter((v) => !v.gone);

    // the helicopter hangs over the player with its searchlight on them
    if (this.heli) {
      // out ahead of the player and a little to one side, where the chase
      // camera looks: it hunts you from the front, searchlight back on you
      const moving = Math.hypot(player.vel.x, player.vel.y) > 3;
      const hx = moving ? player.vel.x / Math.hypot(player.vel.x, player.vel.y) : Math.sin(player.yaw);
      const hz = moving ? player.vel.y / Math.hypot(player.vel.x, player.vel.y) : Math.cos(player.yaw);
      // on the right of the view: the activity card covers the top left
      const target = new THREE.Vector3(player.x + hx * 36 - hz * 10, HELI_HEIGHT, player.z + hz * 36 + hx * 10);
      // it flies at the player's speed, so it holds its place ahead instead of trailing
      this.heli.position.x += player.vel.x * dt;
      this.heli.position.z += player.vel.y * dt;
      this.heli.position.lerp(target, 1 - Math.exp(-dt * 1.3));
      this.heli.lookAt(player.x, HELI_HEIGHT - 6, player.z);
      for (const r of this.heliRotors) r.rotation[r.userData.axis as 'x' | 'y' | 'z'] += dt * 38;
      // red beacon once a second, white strobe a quick double flash
      const [beacon, strobe] = this.heliLights;
      if (beacon) beacon.visible = this.time % 1 < 0.5;
      if (strobe) { const s = this.time % 1.4; strobe.visible = s < 0.06 || (s > 0.16 && s < 0.22); }
      if (this.beam) this.beam.visible = !this.daylight;
      if (this.beam && !this.daylight) {
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
        // still in sight: the chase escalates, a star about every 50 s
        this.crime(dt * 0.02);
      }
      // busted: stopped with a unit on you
      const slow = Math.hypot(player.vel.x, player.vel.y) < 4;
      const unitNear = this.units.some((u) => !u.wreck && Math.hypot(u.drive.x - player.x, u.drive.z - player.z) < 11);
      if (slow && unitNear) this.bust += dt;
      else this.bust = Math.max(0, this.bust - dt * 1.5);
      if (this.bust >= BUST_TIME) {
        this.startArrest(player, stars);
        return;
      }
    } else {
      // no stars: a little heat cools off on its own
      this.heat = Math.max(0, this.heat - dt * 0.02);
    }

    const siren = stars > 0 ? Math.min(1, 0.4 + (1 - Math.min(1, nearest / 140)) * 0.6) : 0;
    if (siren > 0 && !this.sirenOn) { this.audio.startSiren(); this.sirenOn = true; }
    if (siren === 0 && this.sirenOn) { this.audio.stopSiren(); this.sirenOn = false; }
    if (this.sirenOn) this.audio.siren(siren);
  }

  /** Bring the force up to what the stars call for. */
  private spawn(stars: number, player: CityDrive): void {
    const cars = [0, 2, 3, 4, 4, 5][stars];
    const trucks = stars >= 4 ? 1 : 0;
    const have = (k: Unit['kind']) => this.units.filter((u) => u.kind === k).length;
    if (have('car') < cars) this.addUnit('car', player);
    else if (have('truck') < trucks && this.truckModel) this.addUnit('truck', player);
    if (stars >= 3 && !this.heli && this.heliModel) this.addHeli(player);
  }

  private addUnit(kind: Unit['kind'], player: CityDrive): void {
    const mesh = kind === 'truck' ? this.truckModel!.clone(true) : this.assets.clonePolice();
    if (!mesh) return;
    // its job first: it decides where the unit comes from
    const cars = this.units.filter((v) => v.kind === 'car' && !v.wreck);
    const role: Unit['role'] = kind === 'truck' ? 'chase'
      : this.stars >= 3 && !cars.some((v) => v.role === 'block') ? 'block'
      : cars.filter((v) => v.role === 'cutoff').length < cars.filter((v) => v.role === 'chase').length ? 'cutoff' : 'chase';
    // chasers arrive on a junction behind the player; a cutoff or a roadblock
    // comes in from the streets ahead of them, where it can actually get in front
    const f = player.forward;
    const ahead = (q: P) => (q.x - player.x) * f.x + (q.z - player.z) * f.y;
    const front = role !== 'chase';
    let spots = junctionsNear({ x: player.x, z: player.z }, front ? 110 : 70, front ? 230 : 150);
    if (front) {
      const forward = spots.filter((q) => ahead(q) > 60);
      if (forward.length) spots = forward;
    }
    spots.sort((a, b) => (front ? ahead(b) - ahead(a) : ahead(a) - ahead(b)));
    const spot = spots[Math.floor(Math.random() * Math.min(4, spots.length))]
      ?? { x: THREE.MathUtils.clamp(player.x - f.x * 90, -EDGE + 10, EDGE - 10), z: THREE.MathUtils.clamp(player.z - f.y * 90, -EDGE + 10, EDGE - 10) };
    const { x, z } = spot;
    const drive = new CityDrive(kind === 'truck' ? 32 : 40 + this.stars * 2, kind === 'truck' ? 0.8 : 1.15);
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
    // the body's half height, and half a car's width (the box also holds the wide ground glow)
    this.units.push({ kind, mesh, drive, path: [], replan: 0, stuck: 0, reverse: 0, lights, role,
      half: Math.max(0.5, (top - 0.05) / 2), halfW: 0.95 });
  }

  private addHeli(player: CityDrive): void {
    const heli = this.heliModel!.clone(true);
    heli.position.set(player.x + 120, HELI_HEIGHT + 20, player.z + 120);
    heli.traverse((o) => {
      if (/main\s*rotor/i.test(o.name)) { o.userData.axis = 'y'; this.heliRotors.push(o); }
      else if (/tail\s*rotor/i.test(o.name)) { o.userData.axis = 'x'; this.heliRotors.push(o); }
    });
    // nav lights on the belly and tail: sprites, so they face the camera
    const size = new THREE.Box3().setFromObject(heli).getSize(new THREE.Vector3());
    this.heliLights = [[0xff2a3a, 0, -size.y * 0.35, 0, 2.2], [0xffffff, 0, size.y * 0.1, -size.z * 0.45, 1.8]].map(([color, x, y, z, s]) => {
      const light = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: new THREE.Color(color).multiplyScalar(2),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      light.position.set(x, y, z);
      light.scale.setScalar(s);
      heli.add(light);
      return light;
    });
    this.scene.add(heli);
    this.heli = heli;
    if (!this.beam) {
      const cone = new THREE.CylinderGeometry(0.3, 3.4, 1, 24, 1, true);
      this.beam = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xdfe8ff).multiplyScalar(0.06),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
      this.beam.renderOrder = 3;
    }
    this.scene.add(this.beam);
  }

  private driveUnit(u: Unit, player: CityDrive, dist: number, dt: number): void {
    const d = u.drive;
    const speedP = Math.hypot(player.vel.x, player.vel.y);
    // a roadblock in place: parked across the road until the player is past it
    if (u.parked) {
      d.vel.set(0, 0);
      u.parkedFor = (u.parkedFor ?? 0) + dt;
      const away = (player.x - d.x) * player.vel.x + (player.z - d.z) * player.vel.y > 0; // player heading away from it
      if ((away && dist > 40) || dist > 200 || u.parkedFor > 14) { u.parked = false; u.role = 'chase'; }
      u.mesh.position.set(d.x, 0, d.z);
      u.mesh.rotation.set(0, d.yaw, 0);
      return;
    }
    // where this unit is going, by its job
    const heading = speedP > 3 ? { x: player.vel.x / speedP, z: player.vel.y / speedP } : { x: Math.sin(player.yaw), z: Math.cos(player.yaw) };
    const clampCity = (p: P): P => ({ x: THREE.MathUtils.clamp(p.x, -EDGE + 8, EDGE - 8), z: THREE.MathUtils.clamp(p.z, -EDGE + 8, EDGE - 8) });
    let goal: P = { x: player.x, z: player.z };
    let blockSpot: P | null = null;
    if (u.role === 'cutoff' && dist > 35 && speedP > 8) {
      goal = clampCity({ x: player.x + heading.x * 70, z: player.z + heading.z * 70 });
    } else if (u.role === 'block' && speedP > 8) {
      // pick a junction ahead of the player and hold it, rather than chasing
      // one that slides forward as they drive
      const aheadOf = (j: P) => (j.x - player.x) * heading.x + (j.z - player.z) * heading.z;
      if (!u.blockSpot || aheadOf(u.blockSpot) < 25) {
        const ahead = clampCity({ x: player.x + heading.x * 110, z: player.z + heading.z * 110 });
        u.blockSpot = junctionsNear(ahead, 0, 70)
          .filter((j) => aheadOf(j) > 50)
          .sort((p1, p2) => Math.hypot(p1.x - ahead.x, p1.z - ahead.z) - Math.hypot(p2.x - ahead.x, p2.z - ahead.z))[0] ?? null;
        u.replan = 0;
      }
      blockSpot = u.blockSpot;
      if (blockSpot) goal = blockSpot;
    }
    u.replan -= dt;
    if (u.replan <= 0) {
      u.path = route({ x: d.x, z: d.z }, goal, d.forward.x || d.forward.y ? { x: d.forward.x, z: d.forward.y } : undefined).slice(1);
      u.replan = 0.7;
    }
    while (u.path.length > 1 && Math.hypot(u.path[0].x - d.x, u.path[0].z - d.z) < 9) u.path.shift();
    // in at the kill: straight at where the player is going, but only with
    // open road between — never through a building
    const lead = Math.min(1.1, dist / 30);
    const leadPoint = { x: player.x + player.vel.x * lead, z: player.z + player.vel.y * lead };
    const close = u.role !== 'block' && dist < 32 && this.clearLine(d, leadPoint);
    const aim = close ? leadPoint : u.path[0] ?? goal;
    const want = Math.atan2(aim.x - d.x, aim.z - d.z);
    const diff = Math.atan2(Math.sin(want - d.yaw), Math.cos(want - d.yaw));
    // a roadblock arriving: pull up broadside across the road and wait
    if (blockSpot && Math.hypot(blockSpot.x - d.x, blockSpot.z - d.z) < 8 && d.speed < 16) {
      u.parked = true;
      u.parkedFor = 0;
      d.vel.set(0, 0);
      d.x = blockSpot.x; d.z = blockSpot.z;
      d.yaw = Math.atan2(heading.x, heading.z) + Math.PI / 2;
      return;
    }
    // left hopelessly behind: withdrawn, and spawn() sends one in from nearer
    if (dist > 320) { u.gone = true; return; }
    // stuck against a kerb: back out for a moment
    if (Math.abs(d.speed) < 2 && dist > 12) u.stuck += dt; else u.stuck = 0;
    if (u.stuck > 1.2) { u.reverse = 1; u.stuck = 0; u.fails = (u.fails ?? 0) + 1; }
    if ((u.fails ?? 0) > 4 && dist > 60) { u.gone = true; return; }
    if (u.reverse > 0) {
      u.reverse -= dt;
      d.update(dt, { steer: Math.sign(diff), gas: false, brake: true });
    } else {
      // brake for the corner coming up, like a driver, instead of meeting the wall
      let cornerBrake = false;
      if (!close && u.path.length > 1) {
        const c = u.path[0], n = u.path[1];
        const inA = Math.atan2(c.x - d.x, c.z - d.z), outA = Math.atan2(n.x - c.x, n.z - c.z);
        const turn = Math.abs(Math.atan2(Math.sin(outA - inA), Math.cos(outA - inA)));
        if (turn > 0.5) {
          const toCorner = Math.hypot(c.x - d.x, c.z - d.z);
          const cornerSpeed = turn > 2 ? 9 : 15;
          cornerBrake = d.speed > Math.sqrt(cornerSpeed * cornerSpeed + 2 * 20 * Math.max(0, toCorner - 8));
        }
      }
      const sharp = Math.abs(diff) > 0.9 && d.speed > 14;
      // nitro only down a long clear straight, far behind
      const straight = u.path.length > 0 && Math.hypot(u.path[0].x - d.x, u.path[0].z - d.z) > 90;
      if (dist > 80 && straight && Math.abs(diff) < 0.1 && !cornerBrake) d.fireNitro();
      // close in, then pull up beside the player rather than ramming them;
      // a player still moving fast gets chased at full speed
      const arriving = dist < 16 && speedP <= 8;
      const tooFast = arriving && d.speed > Math.max(3, (dist - 6) * 1.4);
      // a roadblock eases in to its junction so it can stop there
      const toSpot = blockSpot ? Math.hypot(blockSpot.x - d.x, blockSpot.z - d.z) : Infinity;
      const settling = toSpot < 45 && d.speed > Math.max(5, (toSpot - 3) * 0.9);
      const brake = sharp || tooFast || cornerBrake || settling;
      d.update(dt, { steer: THREE.MathUtils.clamp(-diff * 2.4, -1, 1), gas: !brake && !(arriving && dist < 7), brake });
    }
    u.mesh.position.set(d.x, 0, d.z);
    u.mesh.rotation.set(0, d.yaw, 0);
  }

  /** Open road from a car to a point: no block's kerb in the way. */
  private clearLine(from: { x: number; z: number }, to: P): boolean {
    for (let i = 1; i <= 8; i++) {
      const t = i / 8, x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t;
      const b = blockAt(x, z);
      if (b && x > b.x0 - 1 && x < b.x1 + 1 && z > b.z0 - 1 && z < b.z1 + 1) return false;
    }
    return true;
  }

  /**
   * Roll a cruiser: thrown up and away along (nx, nz), barrel-rolling. The
   * player's hit also shoves them back and counts as a serious crime.
   */
  private flip(u: Unit, nx: number, nz: number, force: number, player: CityDrive | null): void {
    const d = u.drive;
    const k = Math.min(1.6, force / FLIP_SPEED);
    // which way it rolls: the side it was hit on
    const side = Math.sign(nx * Math.cos(d.yaw) - nz * Math.sin(d.yaw)) || 1;
    u.wreck = {
      t: 0, y: u.half, vy: 5.5 + k * 3.5,
      roll: 0, rollV: side * (7 + k * 3), pitch: 0, pitchV: (Math.random() - 0.5) * 3, yawV: (Math.random() - 0.5) * 4
    };
    d.vel.set(d.vel.x * 0.4 + nx * force * 0.55, d.vel.y * 0.4 + nz * force * 0.55);
    for (const l of u.lights) l.visible = false;
    this.audio.play('crash', 1);
    if (player) {
      player.vel.multiplyScalar(0.55);
      player.impact = Math.max(player.impact, 12);
      this.crime(0.6);
    }
  }

  /** A wreck in the air, bouncing, then lying still until it is cleared. */
  private tumble(u: Unit, dt: number): void {
    const w = u.wreck!, d = u.drive;
    w.t += dt;
    w.vy -= GRAVITY * dt;
    w.y += w.vy * dt;
    w.roll += w.rollV * dt;
    w.pitch += w.pitchV * dt;
    d.yaw += w.yawV * dt;
    // the middle sits higher on its side than on its wheels or roof
    const floor = u.half + (u.halfW - u.half) * Math.abs(Math.sin(w.roll));
    // only a car coming down lands: one still rising rolls on up over the floor
    const grounded = w.y <= floor && w.vy <= 0;
    if (w.y < floor && w.vy > 0) w.y = floor;
    if (grounded) {
      w.y = floor;
      if (w.vy < -3) {
        // a bounce: most of the spin and the slide go into the road
        w.vy *= -0.3;
        w.rollV *= 0.55;
        w.pitchV *= 0.4;
        w.yawV *= 0.5;
        d.vel.multiplyScalar(0.7);
      } else {
        w.vy = 0;
        // come to rest on the nearest face: wheels, side or roof
        if (Math.abs(w.rollV) < 4) {
          w.rollV = 0;
          const rest = Math.round(w.roll / (Math.PI / 2)) * (Math.PI / 2);
          w.roll += (rest - w.roll) * Math.min(1, dt * 7);
        }
        w.pitchV = 0;
        w.pitch *= Math.exp(-dt * 8);
        w.yawV *= Math.exp(-dt * 4);
      }
    }
    d.coast(dt, grounded ? 2.6 : 0.2);
    // turn about the car's middle, not the ground under its wheels
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(w.pitch, d.yaw, w.roll, 'YXZ'));
    const middle = new THREE.Vector3(0, u.half, 0).applyQuaternion(q);
    u.mesh.quaternion.copy(q);
    u.mesh.position.set(d.x - middle.x, w.y - middle.y, d.z - middle.z);
    if (w.t > WRECK_TIME) u.gone = true;
  }

  /** Busted: the nearest cruiser's officer gets out and walks to the window. */
  private startArrest(player: CityDrive, stars: number): void {
    player.vel.set(0, 0);
    const src = this.officerModel;
    const cruiser = this.units.filter((u) => u.kind === 'car' && !u.wreck)
      .sort((a, b) => Math.hypot(a.drive.x - player.x, a.drive.z - player.z) - Math.hypot(b.drive.x - player.x, b.drive.z - player.z))[0];
    if (!src || !cruiser) {
      // no officer to send (the model is still loading): the bust lands at once
      this.events.push({ type: 'busted', stars });
      this.clear();
      return;
    }
    for (const u of this.units) u.drive.vel.set(0, 0);
    const { root, clips, height } = AssetLibrary.cloneCharacter(src);
    root.scale.setScalar(OFFICER_HEIGHT / height);
    const body = new THREE.Group();
    body.add(root);
    // out of the cruiser's driver side
    const cf = cruiser.drive.forward;
    body.position.set(cruiser.drive.x + cf.y * 1.4, 0, cruiser.drive.z - cf.x * 1.4);
    this.scene.add(body);
    // to the player's window (their left side), a step out from the door
    const pf = player.forward;
    const target = new THREE.Vector3(player.x + pf.y * 1.9 + pf.x * 0.3, 0, player.z - pf.x * 1.9 + pf.y * 0.3);
    const mixer = new THREE.AnimationMixer(root);
    const clip = (n: string) => clips.find((c) => c.name === n);
    const inPlace = (c: THREE.AnimationClip | undefined) => {
      if (!c) return undefined;
      const copy = c.clone();
      for (const track of copy.tracks) {
        if (!/Hips\.position$/.test(track.name)) continue;
        const v = track.values;
        for (let i = 0; i < v.length; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; }
      }
      return copy;
    };
    const walkClip = inPlace(clip('walk')), argueClip = clip('argue');
    const walk = walkClip ? mixer.clipAction(walkClip) : null;
    const argue = argueClip ? mixer.clipAction(argueClip) : null;
    walk?.play();
    this.arrest = { body, mixer, walk, argue, target, phase: 'walk', t: 0, stars, speed: 1.35 };
    this.bust = 0;
  }

  private updateArrest(dt: number, player: CityDrive): void {
    const a = this.arrest!;
    player.vel.set(0, 0);
    a.t += dt;
    a.mixer?.update(dt);
    // the light bars keep flashing and the helicopter keeps circling
    const on = Math.floor(this.time * 7) % 2 === 0;
    for (const u of this.units) if (!u.wreck) u.lights.forEach((l, i) => { l.visible = (i === 0) === on; });
    for (const r of this.heliRotors) r.rotation[r.userData.axis as 'x' | 'y' | 'z'] += dt * 38;
    if (a.phase === 'walk') {
      const toGo = a.target.clone().sub(a.body.position);
      const step = a.speed * dt;
      if (toGo.length() <= step || a.t > 8) {
        a.body.position.copy(a.target);
        a.phase = 'argue';
        a.t = 0;
        if (a.argue) { a.argue.reset().play(); a.walk?.crossFadeTo(a.argue, 0.3, false); }
      } else {
        a.body.position.addScaledVector(toGo.normalize(), step);
        a.body.rotation.y = Math.atan2(toGo.x, toGo.z);
      }
      return;
    }
    // at the window, facing the driver
    const face = Math.atan2(player.x - a.body.position.x, player.z - a.body.position.z);
    a.body.rotation.y += Math.atan2(Math.sin(face - a.body.rotation.y), Math.cos(face - a.body.rotation.y)) * Math.min(1, dt * 6);
    if (a.t >= ARGUE_TIME) {
      this.events.push({ type: 'busted', stars: a.stars });
      this.clear();
    }
  }

  private endArrest(): void {
    if (!this.arrest) return;
    this.arrest.mixer?.stopAllAction();
    this.scene.remove(this.arrest.body);
    this.arrest = null;
  }

  /** Where the camera should look during an arrest: the officer at the window. */
  arrestShot(player: CityDrive): { position: THREE.Vector3; look: THREE.Vector3 } | null {
    if (!this.arrest) return null;
    const o = this.arrest.body.position;
    const pf = player.forward;
    return {
      position: new THREE.Vector3(player.x + pf.y * 6.5 + pf.x * 4.5, 2.4, player.z - pf.x * 6.5 + pf.y * 4.5),
      look: new THREE.Vector3(o.x * 0.6 + player.x * 0.4, 1.1, o.z * 0.6 + player.z * 0.4)
    };
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

