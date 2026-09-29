import * as THREE from 'three';
import { CARS } from '../cars';
import { deposit, grantCar } from '../economy';
import {
  BRIDGE_Z, EAST_ISLAND_X0, EAST_ISLAND_X1, EDGE, streetAt
} from './layout';

type PointKind = 'collectible' | 'race';

export interface ActivityPoint {
  id: string;
  kind: PointKind;
  label: string;
  x: number;
  z: number;
  color: number;
  detail: string;
}

interface Collectible extends ActivityPoint {
  kind: 'collectible';
  carId: string;
}

interface StreetRace extends ActivityPoint {
  kind: 'race';
  checkpoints: { x: number; z: number }[];
  reward: number;
}

export interface CityActivityEvent {
  type: 'collect' | 'race-start' | 'race-checkpoint' | 'race-finish';
  text: string;
  color: string;
}

export interface CityActivityStatus {
  title: string;
  detail: string;
  action: string;
  target: { x: number; z: number; label: string; color: number } | null;
  progress: number;
  timer: number;
}

const STORAGE_KEY = 'minirush.city.activities.v1';

const COLLECTIBLES: Collectible[] = [
  { id: 'chrome-token', kind: 'collectible', label: 'CHROME TOKEN', detail: 'Hidden under the downtown overpass · unlocks SUNBURST',
    x: streetAt(2), z: streetAt(4), color: 0xffc531, carId: 'sunburst' },
  { id: 'neon-token', kind: 'collectible', label: 'NEON TOKEN', detail: 'Behind the night market signs · unlocks PHANTOM',
    x: streetAt(9), z: streetAt(3), color: 0x22e6ff, carId: 'phantom' },
  { id: 'island-token', kind: 'collectible', label: 'ISLAND TOKEN', detail: 'At the east island ferry cut · unlocks THUNDERVOLT',
    x: EAST_ISLAND_X1 - 110, z: BRIDGE_Z + 72, color: 0xff2e9a, carId: 'volt' }
];

const RACES: StreetRace[] = [
  { id: 'neon-loop', kind: 'race', label: 'NEON LOOP', detail: 'Four corners · street start · +120 coins', color: 0xff2e9a,
    x: streetAt(2), z: streetAt(7), reward: 120,
    checkpoints: [
      { x: streetAt(8), z: streetAt(7) }, { x: streetAt(8), z: streetAt(2) },
      { x: streetAt(2), z: streetAt(2) }, { x: streetAt(2), z: streetAt(7) }
    ] },
  { id: 'market-cut', kind: 'race', label: 'MARKET CUT', detail: 'Tight alleys · no reset · +160 coins', color: 0xffc531,
    x: streetAt(9), z: streetAt(8), reward: 160,
    checkpoints: [
      { x: streetAt(4), z: streetAt(8) }, { x: streetAt(4), z: streetAt(5) },
      { x: streetAt(10), z: streetAt(5) }, { x: streetAt(10), z: streetAt(8) }
    ] },
  { id: 'island-run', kind: 'race', label: 'ISLAND RUN', detail: 'Freeway sprint to the east island · +220 coins', color: 0x22e6ff,
    x: EDGE - 22, z: BRIDGE_Z, reward: 220,
    checkpoints: [
      { x: EAST_ISLAND_X0 + 90, z: BRIDGE_Z }, { x: EAST_ISLAND_X1 - 110, z: BRIDGE_Z },
      { x: EAST_ISLAND_X1 - 110, z: BRIDGE_Z + 112 }, { x: EAST_ISLAND_X1 - 110, z: BRIDGE_Z + 72 }
    ] }
];

// Passenger fares are their own mode now (src/city/fares.ts).
const ALL_POINTS: ActivityPoint[] = [...COLLECTIBLES, ...RACES];

function distance(aX: number, aZ: number, bX: number, bZ: number): number {
  return Math.hypot(aX - bX, aZ - bZ);
}

function loadState(): { collected: string[]; races: string[] } {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<ReturnType<typeof loadState>>;
    return {
      collected: Array.isArray(raw.collected) ? raw.collected : [],
      races: Array.isArray(raw.races) ? raw.races : []
    };
  } catch {
    return { collected: [], races: [] };
  }
}

export class CityActivities {
  readonly points = ALL_POINTS;
  private state = loadState();
  private events: CityActivityEvent[] = [];
  private gpsId: string | null = null;
  private activeRace: StreetRace | null = null;
  private raceCheckpoint = 0;
  private raceTime = 0;
  private markerRoot = new THREE.Group();
  private markers = new Map<string, THREE.Group>();
  private gpsBeacon = new THREE.Group();

  constructor(private scene: THREE.Scene) {
    this.markerRoot.name = 'city-activity-markers';
    scene.add(this.markerRoot);
    for (const point of ALL_POINTS) this.addMarker(point);
    this.buildGpsBeacon();
    this.refreshVisibility();
  }

  private addMarker(point: ActivityPoint): void {
    const group = new THREE.Group();
    group.position.set(point.x, 0.1, point.z);
    const material = new THREE.MeshBasicMaterial({ color: point.color, transparent: true, opacity: 0.86 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(point.kind === 'race' ? 4.5 : 2.4, 0.18, 8, 28), material);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
    const gem = new THREE.Mesh(
      point.kind === 'race'
        ? new THREE.CylinderGeometry(0.15, 0.15, 5.5, 8)
        : new THREE.OctahedronGeometry(0.85, 0),
      new THREE.MeshBasicMaterial({ color: point.color, transparent: true, opacity: 0.9 })
    );
    gem.position.y = point.kind === 'race' ? 2.7 : 2.1;
    group.add(gem);
    group.userData.baseY = point.kind === 'race' ? 2.7 : 2.1;
    this.markerRoot.add(group);
    this.markers.set(point.id, group);
  }

  private buildGpsBeacon(): void {
    const material = new THREE.MeshBasicMaterial({ color: 0x22e6ff, transparent: true, opacity: 0.72 });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 9, 8), material);
    beam.position.y = 4.5;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.12, 8, 24), material);
    ring.rotation.x = Math.PI / 2;
    this.gpsBeacon.add(beam, ring);
    this.gpsBeacon.visible = false;
    this.markerRoot.add(this.gpsBeacon);
  }

  setGps(id?: string | null): void {
    this.gpsId = id ?? null;
    this.refreshGpsBeacon();
  }

  setNearestGps(x: number, z: number): boolean {
    const target = this.nearestAvailable(x, z);
    if (!target) return false;
    this.setGps(target.id);
    return true;
  }

  consumeEvent(): CityActivityEvent | null {
    return this.events.shift() ?? null;
  }

  isAvailable(id: string): boolean {
    const point = ALL_POINTS.find((entry) => entry.id === id);
    if (!point) return false;
    if (point.kind === 'collectible') return !this.state.collected.includes(point.id);
    return !this.state.races.includes(point.id);
  }

  status(x: number, z: number): CityActivityStatus {
    const target = this.currentTarget();
    if (this.activeRace) {
      return {
        title: this.activeRace.label,
        detail: `CHECKPOINT ${Math.min(this.raceCheckpoint + 1, this.activeRace.checkpoints.length)} / ${this.activeRace.checkpoints.length}`,
        action: 'RACING', target, progress: this.raceCheckpoint / this.activeRace.checkpoints.length, timer: this.raceTime
      };
    }
    const nearby = this.nearestAvailable(x, z);
    if (nearby && distance(x, z, nearby.x, nearby.z) < 18) {
      return {
        title: nearby.label, detail: nearby.detail,
        action: nearby.kind === 'race' ? 'START RACE' : 'COLLECT',
        target: { x: nearby.x, z: nearby.z, label: nearby.label, color: nearby.color }, progress: 0, timer: 0
      };
    }
    const gps = this.gpsId ? ALL_POINTS.find((point) => point.id === this.gpsId) : null;
    return {
      title: gps?.label ?? 'ACTIVITY RADAR',
      detail: gps?.detail ?? 'Set a waypoint to find collectibles, races and rides.',
      action: 'SET GPS', target: gps ? { x: gps.x, z: gps.z, label: gps.label, color: gps.color } : null,
      progress: 0, timer: 0
    };
  }

  activateNearby(x: number, z: number): boolean {
    const point = this.nearestAvailable(x, z);
    if (!point || distance(x, z, point.x, point.z) > 18) return false;
    if (point.kind === 'collectible') {
      this.collect(point as Collectible);
      return true;
    }
    this.activeRace = point as StreetRace;
    this.raceCheckpoint = 0;
    this.raceTime = 0;
    this.setGps(point.id);
    this.events.push({ type: 'race-start', text: `${point.label} · GO`, color: '#ff2e9a' });
    return true;
  }

  update(dt: number, elapsed: number, x: number, z: number): void {
    for (const point of COLLECTIBLES) {
      if (this.state.collected.includes(point.id)) continue;
      const marker = this.markers.get(point.id);
      if (marker) {
        marker.rotation.y = elapsed * 1.6;
        marker.position.y = 0.1 + Math.sin(elapsed * 3 + point.x) * 0.2;
      }
      if (distance(x, z, point.x, point.z) < 6) this.collect(point);
    }
    if (this.activeRace) this.updateRace(dt, x, z);
    this.refreshGpsBeacon(elapsed);
    this.refreshVisibility();
  }

  private updateRace(dt: number, x: number, z: number): void {
    const race = this.activeRace!;
    this.raceTime += dt;
    const next = race.checkpoints[this.raceCheckpoint];
    if (distance(x, z, next.x, next.z) > 12) return;
    this.raceCheckpoint++;
    if (this.raceCheckpoint >= race.checkpoints.length) {
      this.state.races.push(race.id);
      this.save();
      deposit(race.reward);
      this.events.push({ type: 'race-finish', text: `${race.label} COMPLETE · +${race.reward} COINS`, color: '#fcff52' });
      this.activeRace = null;
      this.setGps(null);
      return;
    }
    this.events.push({ type: 'race-checkpoint', text: `CHECKPOINT ${this.raceCheckpoint} / ${race.checkpoints.length}`, color: '#22e6ff' });
  }

  private collect(point: Collectible): void {
    if (this.state.collected.includes(point.id)) return;
    this.state.collected.push(point.id);
    grantCar(point.carId);
    this.save();
    const car = CARS.find((entry) => entry.id === point.carId);
    this.events.push({ type: 'collect', text: `${point.label} FOUND · ${car?.name ?? point.carId} UNLOCKED`, color: '#22e6ff' });
    this.setGps(null);
  }

  private nearestAvailable(x: number, z: number): ActivityPoint | null {
    const candidates = ALL_POINTS.filter((point) => {
      if (point.kind === 'collectible') return !this.state.collected.includes(point.id);
      return !this.state.races.includes(point.id);
    });
    candidates.sort((a, b) => distance(x, z, a.x, a.z) - distance(x, z, b.x, b.z));
    return candidates[0] ?? null;
  }

  private currentTarget(): { x: number; z: number; label: string; color: number } | null {
    if (this.activeRace) {
      const next = this.activeRace.checkpoints[this.raceCheckpoint];
      return { ...next, label: `CHECKPOINT ${this.raceCheckpoint + 1}`, color: this.activeRace.color };
    }
    const point = this.gpsId ? ALL_POINTS.find((entry) => entry.id === this.gpsId) : null;
    return point ? { x: point.x, z: point.z, label: point.label, color: point.color } : null;
  }

  private refreshGpsBeacon(elapsed = 0): void {
    const target = this.currentTarget();
    this.gpsBeacon.visible = !!target;
    if (!target) return;
    this.gpsBeacon.position.set(target.x, 0, target.z);
    this.gpsBeacon.children.forEach((child, index) => {
      child.rotation.y = index === 1 ? elapsed * 1.6 : 0;
      const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      material.color.setHex(target.color);
    });
  }

  private refreshVisibility(): void {
    for (const point of ALL_POINTS) {
      const marker = this.markers.get(point.id);
      if (!marker) continue;
      const done = point.kind === 'collectible' ? this.state.collected.includes(point.id)
        : this.state.races.includes(point.id);
      marker.visible = !done && !this.activeRace;
    }
  }

  private save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  }

  dispose(): void {
    this.scene.remove(this.markerRoot);
    this.markerRoot.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const material = mesh.material as THREE.Material;
      material.dispose();
    });
  }
}

export const cityActivityPoints = (): ActivityPoint[] => ALL_POINTS;
