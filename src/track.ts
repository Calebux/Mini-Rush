import * as THREE from 'three';
import { ROAD_HALF_WIDTH, SAMPLE_STEP } from './constants';
import { mulberry32 } from './meshes';
import { BakedPath } from './trackPaths';

export interface Frame {
  x: number;
  z: number;
  theta: number; // heading; tangent = (sinθ, -cosθ)
  nx: number;    // left normal = (-cosθ, -sinθ)
  nz: number;
  curvature: number;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

const normAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Closed street circuit: radial control points around a center, smoothed with
 * a closed Catmull-Rom spline and resampled every SAMPLE_STEP meters. All
 * positions in the game are (s = distance along the lap, wrapping modulo
 * length; x = lateral offset, +x is the driver's left). s=0 is the start line.
 */
export interface TrackShape {
  ctlMin: number; // fewer control points = flowing, more = technical
  ctlVar: number;
  rMin: number;   // radius spread — how far corners swing in/out
  rVar: number;
  layout?: TrackLayout; // named circuit plan; undefined keeps the radial generator
  /** Centreline baked from an imported circuit — overrides every field above. */
  baked?: BakedPath | null;
}

export type TrackLayout =
  | 'waterfront'
  | 'city-grid'
  | 'coastal'
  | 'market-knot'
  | 'desert-rally'
  | 'mountain-switchback'
  | 'forest-rally'
  | 'neon-knot';

// The road ribbon's full painted width. An imported circuit is never scaled
// below this, or the generated ribbon would overhang its own tarmac onto grass.
const RIBBON_WIDTH = (ROAD_HALF_WIDTH + 0.6) * 2;

const DEFAULT_SHAPE: TrackShape = { ctlMin: 11, ctlVar: 4, rMin: 0.6, rVar: 0.75 };
const safeNumber = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

const LAYOUTS: Record<TrackLayout, [number, number][]> = {
  // Long promenade straight, bridge bend, then a tight inland return.
  waterfront: [
    [-0.95, -0.48], [-0.45, -0.68], [0.25, -0.7], [0.88, -0.54],
    [1.04, -0.08], [0.72, 0.28], [0.2, 0.38], [-0.24, 0.72],
    [-0.8, 0.48], [-1.04, 0.02]
  ],
  // Blocky city circuit: short straights linked by hard avenue turns.
  'city-grid': [
    [-0.78, -0.78], [-0.18, -0.78], [0.46, -0.78], [0.84, -0.5],
    [0.84, -0.04], [0.42, -0.04], [0.42, 0.44], [0.9, 0.72],
    [0.08, 0.84], [-0.52, 0.58], [-0.9, 0.12], [-0.56, -0.34]
  ],
  // Fast beach road with a cliff-side hook and a narrow return.
  coastal: [
    [-0.98, -0.28], [-0.46, -0.62], [0.34, -0.72], [0.96, -0.48],
    [1.1, 0.0], [0.86, 0.46], [0.32, 0.72], [-0.34, 0.62],
    [-0.82, 0.28], [-1.08, 0.02]
  ],
  // Dense bazaar/plaza loop with quick left-right rhythm.
  'market-knot': [
    [-0.72, -0.56], [-0.18, -0.72], [0.34, -0.54], [0.08, -0.2],
    [0.66, -0.12], [0.92, 0.28], [0.34, 0.5], [-0.02, 0.24],
    [-0.44, 0.72], [-0.92, 0.36], [-0.62, 0.0], [-0.98, -0.28]
  ],
  // Big rally oval: high speed, broad sweepers, sparse heavy braking.
  'desert-rally': [
    [-1.18, -0.32], [-0.62, -0.68], [0.3, -0.72], [1.08, -0.42],
    [1.22, 0.12], [0.72, 0.54], [-0.08, 0.7], [-0.84, 0.5],
    [-1.24, 0.08]
  ],
  // Hairpin climb/descent shape for touge, fjord and icy passes.
  'mountain-switchback': [
    [-0.82, -0.74], [-0.16, -0.82], [0.54, -0.62], [0.2, -0.3],
    [0.82, -0.08], [0.34, 0.16], [0.9, 0.46], [0.1, 0.76],
    [-0.64, 0.58], [-0.22, 0.2], [-0.86, -0.08], [-0.42, -0.42]
  ],
  // Uneven rally loop with medium corners and one long commitment straight.
  'forest-rally': [
    [-0.9, -0.48], [-0.38, -0.8], [0.16, -0.62], [0.62, -0.76],
    [0.98, -0.28], [0.72, 0.2], [0.92, 0.62], [0.18, 0.76],
    [-0.48, 0.5], [-0.98, 0.24]
  ],
  // Compact cyber street maze, intentionally technical and bend-heavy.
  'neon-knot': [
    [-0.7, -0.7], [-0.08, -0.82], [0.48, -0.54], [0.12, -0.22],
    [0.78, -0.02], [0.5, 0.34], [0.9, 0.72], [0.08, 0.6],
    [-0.34, 0.82], [-0.78, 0.38], [-0.36, 0.02], [-0.94, -0.34]
  ],
};

function layoutControls(
  layout: TrackLayout, rand: () => number, targetLength: number
): { x: number[]; z: number[] } {
  const pts = LAYOUTS[layout];
  let perimeter = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    perimeter += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const scale = Math.max(600, targetLength) / Math.max(1, perimeter);
  const jitter = scale * 0.035;
  const x: number[] = [], z: number[] = [];
  for (const [px, pz] of pts) {
    x.push(px * scale + (rand() - 0.5) * jitter);
    z.push(pz * scale + (rand() - 0.5) * jitter);
  }
  return { x, z };
}

export class Track {
  readonly length: number;
  /**
   * Uniform factor mapping the imported model's units to world metres. Scenery
   * scales the .glb by exactly this so the shell lands on the driven route.
   * 1 for generated tracks.
   */
  readonly modelScale: number = 1;
  private px: Float32Array;
  private pz: Float32Array;
  private th: Float32Array;
  private kv: Float32Array;

  constructor(seed: number, targetLength: number, shape: TrackShape = DEFAULT_SHAPE) {
    const rand = mulberry32(seed);
    const rx: number[] = [], rz: number[] = [];

    if (shape.baked) {
      // Imported circuit: the baked centreline already is the fine polyline, so
      // it goes in untouched — no spline fitting, which would round off the very
      // corners the circuit is known for. Scale respects the requested race
      // length but never squeezes the tarmac narrower than the painted ribbon.
      const baked = shape.baked;
      const byLength = Math.max(600, safeNumber(targetLength, 1800)) / Math.max(1, baked.length);
      // Measured at the circuit's narrowest point, not its median, so the
      // ribbon stays on tarmac through the tightest corner too.
      const byWidth = RIBBON_WIDTH / Math.max(1, baked.roadWidthMin || baked.roadWidth);
      this.modelScale = Math.max(byLength, byWidth);
      for (const [x, z] of baked.points) {
        rx.push(x * this.modelScale);
        rz.push(z * this.modelScale);
      }
    } else {
      const ctlMin = Math.max(4, Math.floor(safeNumber(shape.ctlMin, DEFAULT_SHAPE.ctlMin)));
      const ctlVar = Math.max(1, Math.floor(safeNumber(shape.ctlVar, DEFAULT_SHAPE.ctlVar)));
      const rMin = Math.max(0.1, safeNumber(shape.rMin, DEFAULT_SHAPE.rMin));
      const rVar = Math.max(0, safeNumber(shape.rVar, DEFAULT_SHAPE.rVar));
      const R = Math.max(600, safeNumber(targetLength, 1800)) / (2 * Math.PI);
      let cx: number[] = [], cz: number[] = [];
      if (shape.layout) {
        const controls = layoutControls(shape.layout, rand, targetLength);
        cx = controls.x;
        cz = controls.z;
      } else {
        const nCtl = ctlMin + Math.floor(rand() * ctlVar);
        for (let i = 0; i < nCtl; i++) {
          const a = (i / nCtl) * Math.PI * 2 + (rand() - 0.5) * (2.2 / nCtl);
          const r = R * (rMin + rand() * rVar);
          cx.push(Math.sin(a) * r);
          cz.push(-Math.cos(a) * r);
        }
      }
      const nCtl = cx.length;

      // oversample the closed spline into a fine polyline
      const SUB = 48;
      for (let i = 0; i < nCtl; i++) {
        const a = (i - 1 + nCtl) % nCtl, b = i, c = (i + 1) % nCtl, d = (i + 2) % nCtl;
        for (let j = 0; j < SUB; j++) {
          const t = j / SUB;
          rx.push(catmull(cx[a], cx[b], cx[c], cx[d], t));
          rz.push(catmull(cz[a], cz[b], cz[c], cz[d], t));
        }
      }
    }

    // walk the polyline and emit one sample every SAMPLE_STEP
    const sx: number[] = [], sz: number[] = [];
    let acc = 0;
    let prevX = rx[0], prevZ = rz[0];
    sx.push(prevX); sz.push(prevZ);
    for (let i = 1; i <= rx.length; i++) {
      const X = rx[i % rx.length], Z = rz[i % rz.length];
      let segLen = Math.hypot(X - prevX, Z - prevZ);
      while (acc + segLen >= SAMPLE_STEP) {
        const need = SAMPLE_STEP - acc;
        const k = need / segLen;
        prevX += (X - prevX) * k;
        prevZ += (Z - prevZ) * k;
        segLen -= need;
        acc = 0;
        sx.push(prevX); sz.push(prevZ);
      }
      acc += segLen;
      prevX = X; prevZ = Z;
    }
    sx.pop(); sz.pop(); // last emitted sample ~coincides with sample 0

    const n = sx.length;
    this.length = n * SAMPLE_STEP;
    this.px = Float32Array.from(sx);
    this.pz = Float32Array.from(sz);
    this.th = new Float32Array(n);
    this.kv = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const dx = sx[(i + 1) % n] - sx[i];
      const dz = sz[(i + 1) % n] - sz[i];
      this.th[i] = Math.atan2(dx, -dz); // tangent = (sinθ, -cosθ)
    }
    for (let i = 0; i < n; i++) {
      this.kv[i] = normAngle(this.th[(i + 1) % n] - this.th[i]) / SAMPLE_STEP;
    }
  }

  /** Wrap any distance (negative or multi-lap) onto [0, length). */
  wrap(s: number): number {
    return ((s % this.length) + this.length) % this.length;
  }

  /** Top-down circuit polyline for minimaps — one point every `step` samples. */
  outline(step = 4): { x: number; z: number }[] {
    const pts: { x: number; z: number }[] = [];
    for (let i = 0; i < this.px.length; i += step) {
      pts.push({ x: this.px[i], z: this.pz[i] });
    }
    return pts;
  }

  frame(s: number): Frame {
    const n = this.px.length;
    const f = this.wrap(s) / SAMPLE_STEP;
    const i = Math.floor(f) % n;
    const j = (i + 1) % n;
    const a = f - Math.floor(f);
    return this.mk(
      this.px[i] + (this.px[j] - this.px[i]) * a,
      this.pz[i] + (this.pz[j] - this.pz[i]) * a,
      this.th[i] + normAngle(this.th[j] - this.th[i]) * a,
      this.kv[i]
    );
  }

  private mk(x: number, z: number, theta: number, curvature: number): Frame {
    return { x, z, theta, nx: -Math.cos(theta), nz: -Math.sin(theta), curvature };
  }

  /** Place an object at (s, lateral, y), facing down-track. */
  place(obj: THREE.Object3D, s: number, lateral: number, y = 0): void {
    const f = this.frame(s);
    obj.position.set(f.x + f.nx * lateral, y, f.z + f.nz * lateral);
    obj.rotation.y = -f.theta;
  }

  /** One closed ribbon mesh for the whole circuit, with painted lane dashes. */
  buildRoadMesh(style: RoadStyle = 'city'): THREE.Mesh {
    const n = this.px.length;
    const rows = n + 1; // repeat sample 0 at the end to close the loop
    const w = ROAD_HALF_WIDTH + 0.6; // slight shoulder
    const pos = new Float32Array(rows * 2 * 3);
    const uv = new Float32Array(rows * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i < rows; i++) {
      const k = i % n;
      const t = this.th[k];
      const nx = -Math.cos(t), nz = -Math.sin(t);
      const x = this.px[k], z = this.pz[k];
      pos.set([x + nx * w, 0.02, z + nz * w, x - nx * w, 0.02, z - nz * w], i * 6);
      const v = (i * SAMPLE_STEP) / (style === 'coast' ? 32 : 8);
      uv.set([0, v, 1, v], i * 4);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0xe6e2d8, map: roadTexture(style), roughness: style === 'snow' ? 0.55 : 0.94,
        ...(style === 'coast' ? { bumpMap: asphaltGrain(), bumpScale: .018 } : {}) })
    );
    mesh.frustumCulled = false; // spans the whole map; fog hides the distance
    return mesh;
  }
}

export type RoadStyle = 'city' | 'rally' | 'snow' | 'circuit' | 'coast';
const roadTextures = new Map<RoadStyle, THREE.Texture>();
function roadTexture(style: RoadStyle): THREE.Texture {
  const cached = roadTextures.get(style);
  if (cached) return cached;
  if (style === 'coast') {
    const texture = coastalAsphalt(); roadTextures.set(style, texture); return texture;
  }
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = style === 'snow' ? '#66777d' : style === 'rally' ? '#55534c' : '#484947';
  ctx.fillRect(0, 0, 256, 256);
  // asphalt noise
  const rand = mulberry32(0x617370);
  for (let i = 0; i < 2200; i++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(200,205,198,0.08)' : 'rgba(20,30,25,0.12)';
    ctx.fillRect(rand() * 256, rand() * 256, 1, 1);
  }
  // edge lines
  ctx.fillStyle = '#e7e3ce';
  ctx.fillRect(8, 0, 3, 256);
  ctx.fillRect(245, 0, 3, 256);
  if (style === 'city') {
    for (const x of [86, 168]) ctx.fillRect(x, 0, 4, 110);
  } else if (style !== 'circuit') {
    ctx.fillStyle = style === 'rally' ? '#dfc88c' : '#e0e7e4';
    ctx.fillRect(126, 0, 4, 140);
  }
  const roadTex = new THREE.CanvasTexture(c);
  roadTex.wrapS = THREE.RepeatWrapping;
  roadTex.wrapT = THREE.RepeatWrapping;
  roadTex.anisotropy = 8;
  roadTex.colorSpace = THREE.SRGBColorSpace;
  roadTextures.set(style, roadTex);
  return roadTex;
}

let grain: THREE.CanvasTexture | undefined;
function asphaltGrain(): THREE.CanvasTexture {
  if (grain) return grain;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d')!, pixels = ctx.createImageData(256, 256), rand = mulberry32(591);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const n = 85 + rand() * 80; pixels.data.set([n, n, n, 255], i);
  }
  ctx.putImageData(pixels, 0, 0); grain = new THREE.CanvasTexture(c);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping; grain.repeat.set(5, 10); grain.anisotropy = 4;
  return grain;
}

/** Original asphalt atlas: fine aggregate, worn paint, tyre bands and sparse repairs. */
function coastalAsphalt(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 2048;
  const ctx = c.getContext('2d')!, rand = mulberry32(0xc0a57);
  const pixels = ctx.createImageData(c.width, c.height);
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const n = (rand() - .5) * 15 + Math.sin(x * .021 + Math.sin(y * .006)) * 2 + Math.sin(y * .025) * 1.5;
    const i = (y * c.width + x) * 4;
    pixels.data.set([58 + n, 64 + n, 68 + n, 255], i);
  }
  ctx.putImageData(pixels, 0, 0);
  for (const x of [250, 365, 660, 775]) {
    const shade = ctx.createLinearGradient(x - 34, 0, x + 34, 0);
    shade.addColorStop(0, 'transparent'); shade.addColorStop(.5, '#17202725'); shade.addColorStop(1, 'transparent');
    ctx.fillStyle = shade; ctx.fillRect(x - 34, 0, 68, 2048);
  }
  ctx.strokeStyle = '#19212688'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 9; i++) {
    let x = 75 + rand() * 850, y = rand() * 2048;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 12; k++) { x += (rand() - .5) * 14; y += 7 + rand() * 15; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  ctx.fillStyle = '#e2e2d1'; ctx.fillRect(29, 0, 10, 2048); ctx.fillRect(985, 0, 10, 2048);
  ctx.fillStyle = '#d7c789';
  for (let y = 0; y < 2048; y += 512) ctx.fillRect(508, y, 8, 240);
  for (let i = 0; i < 19000; i++) {
    ctx.fillStyle = rand() < .5 ? '#333b4220' : '#d9dedb13'; ctx.fillRect(rand() * 1024, rand() * 2048, 1, 1);
  }
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 8; return texture;
}
