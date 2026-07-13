import * as THREE from 'three';
import { ROAD_HALF_WIDTH, SAMPLE_STEP } from './constants';
import { mulberry32 } from './meshes';
import { toonMat } from './toon';

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
}

const DEFAULT_SHAPE: TrackShape = { ctlMin: 11, ctlVar: 4, rMin: 0.6, rVar: 0.75 };

export class Track {
  readonly length: number;
  private px: Float32Array;
  private pz: Float32Array;
  private th: Float32Array;
  private kv: Float32Array;

  constructor(seed: number, targetLength: number, shape: TrackShape = DEFAULT_SHAPE) {
    const rand = mulberry32(seed);
    const nCtl = shape.ctlMin + Math.floor(rand() * shape.ctlVar);
    const R = targetLength / (2 * Math.PI);
    const cx: number[] = [], cz: number[] = [];
    for (let i = 0; i < nCtl; i++) {
      const a = (i / nCtl) * Math.PI * 2 + (rand() - 0.5) * (2.2 / nCtl);
      const r = R * (shape.rMin + rand() * shape.rVar);
      cx.push(Math.sin(a) * r);
      cz.push(-Math.cos(a) * r);
    }

    // oversample the closed spline into a fine polyline
    const SUB = 48;
    const rx: number[] = [], rz: number[] = [];
    for (let i = 0; i < nCtl; i++) {
      const a = (i - 1 + nCtl) % nCtl, b = i, c = (i + 1) % nCtl, d = (i + 2) % nCtl;
      for (let j = 0; j < SUB; j++) {
        const t = j / SUB;
        rx.push(catmull(cx[a], cx[b], cx[c], cx[d], t));
        rz.push(catmull(cz[a], cz[b], cz[c], cz[d], t));
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
  buildRoadMesh(): THREE.Mesh {
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
      const v = (i * SAMPLE_STEP) / 8;
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
      toonMat(0x9aa0b4, { map: roadTexture() })
    );
    mesh.frustumCulled = false; // spans the whole map; fog hides the distance
    return mesh;
  }
}

let roadTex: THREE.Texture | null = null;
function roadTexture(): THREE.Texture {
  if (roadTex) return roadTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#3a3d45';
  ctx.fillRect(0, 0, 128, 128);
  // asphalt noise
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? '#41444d' : '#34373f';
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  // edge lines
  ctx.fillStyle = '#c9cdd6';
  ctx.fillRect(4, 0, 3, 128);
  ctx.fillRect(121, 0, 3, 128);
  // two dashed dividers
  for (const x of [44, 82]) {
    for (let y = 0; y < 128; y += 32) ctx.fillRect(x, y, 3, 18);
  }
  roadTex = new THREE.CanvasTexture(c);
  roadTex.wrapS = THREE.RepeatWrapping;
  roadTex.wrapT = THREE.RepeatWrapping;
  roadTex.magFilter = THREE.NearestFilter;
  roadTex.colorSpace = THREE.SRGBColorSpace;
  return roadTex;
}
