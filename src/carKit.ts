// Shared kit for the original procedural cars (RUSH ONE, STOCK 88): smooth
// profiles, lofted cross-sections, and a parts bin that merges everything per
// material so a whole car costs a handful of draw calls.
import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const RING = 48; // samples around every cross-section

/** Monotone cubic through (z, value) keys: smooth, and never overshoots a key. */
export function smooth(keys: number[][]): (z: number) => number {
  const n = keys.length, d: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) d[i] = (keys[i + 1][1] - keys[i][1]) / (keys[i + 1][0] - keys[i][0]);
  for (let i = 0; i < n; i++) m[i] = i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (!d[i]) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return z => {
    if (z <= keys[0][0]) return keys[0][1];
    if (z >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 0; while (z > keys[i + 1][0]) i++;
    const h = keys[i + 1][0] - keys[i][0], t = (z - keys[i][0]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * keys[i][1] + (t3 - 2 * t2 + t) * h * m[i]
      + (-2 * t3 + 3 * t2) * keys[i + 1][1] + (t3 - t2) * h * m[i + 1];
  };
}
export const slope = (f: (z: number) => number, z: number) => (f(z + 0.01) - f(z - 0.01)) / 0.02;

/** A closed section from its right half (bottom centre → top centre), mirrored and sampled smooth. */
export function section(right: number[][]): T.Vector3[] {
  const left = right.slice(1, -1).reverse().map(([x, y]) => [-x, y]);
  const curve = new T.CatmullRomCurve3([...right, ...left].map(([x, y]) => new T.Vector3(x, y, 0)), true, 'centripetal');
  return Array.from({ length: RING }, (_, k) => curve.getPoint(k / RING));
}

/** Skin a run of sections along z; `from..to` picks a strip of the ring instead of the whole loop. */
export function loft(zs: number[], ring: (z: number) => T.Vector3[], from = 0, to = RING): T.BufferGeometry {
  const closed = from === 0 && to === RING, cols = closed ? RING : to - from + 1;
  const pos: number[] = [], uv: number[] = [], index: number[] = [];
  const rings = zs.map(z => ring(z));
  rings.forEach((r, i) => {
    for (let k = 0; k < cols; k++) {
      const p = r[(from + k) % RING];
      pos.push(p.x, p.y, zs[i]); uv.push(k / cols, i / (zs.length - 1));
    }
  });
  const at = (i: number, k: number) => i * cols + (closed ? k % cols : k);
  for (let i = 0; i < zs.length - 1; i++) for (let k = 0; k < (closed ? cols : cols - 1); k++) {
    const a = at(i, k), b = at(i, k + 1), c = at(i + 1, k), e = at(i + 1, k + 1);
    index.push(a, b, c, b, e, c);
  }
  if (closed) for (const [i, facing] of [[zs.length - 1, 1], [0, -1]]) { // flat end caps
    const base = pos.length / 3, r = rings[i];
    const cx = r.reduce((s, p) => s + p.x, 0) / RING, cy = r.reduce((s, p) => s + p.y, 0) / RING;
    pos.push(cx, cy, zs[i]); uv.push(0.5, 0.5);
    r.forEach(p => { pos.push(p.x, p.y, zs[i]); uv.push(0.5, 0.5); });
    for (let k = 0; k < RING; k++) {
      const p = base + 1 + k, q = base + 1 + (k + 1) % RING;
      index.push(...(facing > 0 ? [base, p, q] : [base, q, p]));
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geo.setIndex(index); geo.computeVertexNormals();
  return geo;
}

/** Collects a car's parts by material; `finish` merges them into one mesh per material. */
export function carParts() {
  const parts = new Map<T.Material, T.BufferGeometry[]>();
  const euler = new T.Euler(), quat = new T.Quaternion(), one = new T.Vector3(1, 1, 1), at = new T.Vector3();
  const put = (geo: T.BufferGeometry, mat: T.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    geo.applyMatrix4(new T.Matrix4().compose(at.set(x, y, z), quat.setFromEuler(euler.set(rx, ry, rz)), one));
    if (!parts.has(mat)) parts.set(mat, []);
    parts.get(mat)!.push(geo);
  };
  const box = (w: number, h: number, d: number, mat: T.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
    put(new T.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz);
  /** A disc facing ±x (the wheel axis). */
  const disc = (r: number, depth: number, mat: T.Material, x: number, y: number, z: number, seg = 28) =>
    put(new T.CylinderGeometry(r, r, depth, seg), mat, x, y, z, 0, 0, Math.PI / 2);
  /** Merge into `g`, scaled. Alpha-tested decals don't cast shadows. */
  const finish = (g: T.Group, scale: number) => {
    g.userData.procedural = true; // owns its geometry and materials (see disposeCarInstance)
    for (const [mat, geos] of parts) {
      const merged = mergeGeometries(geos, false); merged.scale(scale, scale, scale);
      const mesh = new T.Mesh(merged, mat);
      mesh.castShadow = !mat.alphaTest; mesh.receiveShadow = true;
      geos.forEach(geo => geo.dispose());
      g.add(mesh);
    }
    return g;
  };
  return { put, box, disc, finish };
}
