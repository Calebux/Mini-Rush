import * as THREE from 'three';

// Ghost of your best run on THIS exact circuit: (s, x) sampled at 10 Hz,
// stored per track identity in localStorage (LRU, small). Most useful on the
// daily circuit — same track all day — and on seeded/retried runs.

export interface GhostData {
  car: number;   // CarSpec index the ghost drove
  time: number;  // finish time (lower = better, decides replacement)
  score: number;
  hz: number;
  pts: number[]; // s0, x0, s1, x1, ...
}

const INDEX_KEY = 'minirush.ghosts';
const MAX_GHOSTS = 8;
const HZ = 10;
const MAX_SAMPLES = 3600; // 6 min cap — beyond that stop recording

export const ghostKey = (
  seed: number, mapId: string, modeId: string, laps: number, len: number
): string => `minirush.ghost.${seed}.${mapId}.${modeId}.${laps}.${len}`;

export function loadGhost(key: string): GhostData | null {
  try {
    const g = JSON.parse(localStorage.getItem(key) ?? 'null') as GhostData | null;
    return g && Array.isArray(g.pts) && g.pts.length >= 4 ? g : null;
  } catch {
    return null;
  }
}

/** Keep the best (fastest) run per circuit; evict the oldest circuit past cap. */
export function saveGhost(key: string, g: GhostData): boolean {
  const prev = loadGhost(key);
  if (prev && prev.time <= g.time) return false;
  try {
    localStorage.setItem(key, JSON.stringify(g));
  } catch {
    return false; // storage full — ghosts are a luxury, never break the game
  }
  let index: string[];
  try {
    const raw = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') as string[];
    index = Array.isArray(raw) ? raw : [];
  } catch {
    index = [];
  }
  index = index.filter((k) => k !== key);
  index.push(key);
  while (index.length > MAX_GHOSTS) localStorage.removeItem(index.shift()!);
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  return true;
}

export class GhostRecorder {
  private acc = 0;
  private pts: number[] = [];

  sample(dt: number, s: number, x: number): void {
    if (this.pts.length >= MAX_SAMPLES * 2) return;
    this.acc += dt;
    if (this.acc < 1 / HZ && this.pts.length > 0) return;
    this.acc = 0;
    this.pts.push(Math.round(s * 100) / 100, Math.round(x * 100) / 100);
  }

  data(car: number, time: number, score: number): GhostData {
    return { car, time, score, hz: HZ, pts: this.pts };
  }
}

/** Interpolated ghost position at race time t; null once the run has ended. */
export function ghostPos(g: GhostData, t: number): { s: number; x: number } | null {
  const n = g.pts.length / 2;
  const f = t * g.hz;
  if (f >= n - 1) return null;
  const i = Math.max(0, Math.floor(f));
  const a = f - i;
  return {
    s: g.pts[i * 2] + (g.pts[(i + 1) * 2] - g.pts[i * 2]) * a,
    x: g.pts[i * 2 + 1] + (g.pts[(i + 1) * 2 + 1] - g.pts[i * 2 + 1]) * a
  };
}

/** Spectral copy of a car mesh: pale, see-through, contact-free. */
export function ghostMesh(src: THREE.Group): THREE.Group {
  const g = src.clone(true);
  const tint = new THREE.Color(0x9adfff);
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const wasArray = Array.isArray(mesh.material);
    const mats = (wasArray ? mesh.material as THREE.Material[] : [mesh.material as THREE.Material])
      .map((m) => {
        const c = m.clone() as THREE.Material & { color?: THREE.Color };
        c.transparent = true;
        c.opacity = 0.32;
        c.depthWrite = false;
        c.color?.lerp(tint, 0.65);
        return c;
      });
    mesh.material = wasArray ? mats : mats[0];
  });
  return g;
}
