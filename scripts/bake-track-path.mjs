// Extract the drivable centreline out of an imported circuit .glb so the game
// can race on the real geometry instead of a procedural spline that merely sits
// near it.
//
//   node scripts/bake-track-path.mjs <glb> --road <regex> --out <json> [flags]
//
// How it works: rasterize the tarmac primitives onto a top-down occupancy grid,
// find the infield (the enclosed hole the circuit wraps around), walk that
// hole's boundary in order, and for each boundary step march outward across the
// tarmac — the midpoint of that crossing is a centreline sample. Ordering comes
// free from the boundary walk, which is what makes this work on circuits whose
// meshes are unnamed and split across dozens of primitives.
//
// Flags:
//   --road <regex>     node/material name filter selecting the racing surface
//   --out <path>       JSON destination
//   --res <n>          grid resolution across the long axis (default 900)
//   --max-tri <n>      drop triangles larger than n x the median (default 60);
//                      strips paddock/apron slabs off a tarmac mesh
//   --reverse          flip travel direction
//   --start <x,z>      model-space point to use as the start/finish line
//   --debug <png>      write a verification overlay
import { writeFileSync } from 'node:fs';
import { readPrimitives, makeGrid, writePng } from './lib/glb-geometry.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const file = argv[0];
if (!file || has('help')) {
  console.log('usage: node scripts/bake-track-path.mjs <glb> --road <regex> --out <json>');
  process.exit(file ? 0 : 1);
}
const roadRe = new RegExp(flag('road', '.'), 'i');
const outPath = flag('out');
const RES = Number(flag('res', 900));
const MAX_TRI = Number(flag('max-tri', 60));
const debugPath = flag('debug');
const startAt = flag('start') ? flag('start').split(',').map(Number) : null;

const prims = await readPrimitives(file);
const road = prims.filter((p) => roadRe.test(`${p.node} ${p.material}`));
if (!road.length) {
  console.error(`no primitive matched --road ${roadRe} in ${file}`);
  console.error('available:', prims.map((p) => `${p.node}/${p.material}`).slice(0, 40).join(', '));
  process.exit(1);
}

// ---- 1. tarmac mask --------------------------------------------------------

const tris = collectTriangles(road);
const triMedian = medianArea(tris);
const kept = tris.filter((t) => t.area <= triMedian * MAX_TRI);
const bounds = triBounds(kept);
const grid = makeGrid(bounds, RES);
for (const t of kept) {
  fillTri(grid, grid.toCol(t.ax), grid.toRow(t.az), grid.toCol(t.bx), grid.toRow(t.bz), grid.toCol(t.cx), grid.toRow(t.cz));
}
// Seal seams in the tarmac. Circuits routinely ship with real breaks in the
// road surface where the pit lane splits off, and a single leaking pixel drains
// the infield into the outside region and loses the loop entirely.
closeGaps(grid, Number(flag('close', 4)));

// ---- 2. infield ------------------------------------------------------------

const { outside, infield, infieldSize } = findInfield(grid);
if (!infieldSize) {
  console.error('no enclosed infield found — the tarmac mask is not a closed loop.');
  console.error('try a tighter --road filter, a lower --max-tri, or a higher --res.');
  process.exit(1);
}

// ---- 3. ordered boundary walk -> centreline --------------------------------

const contour = traceContour(grid, infield);
const raw = [];
for (const [c, r] of contour) {
  const hit = marchAcross(grid, infield, c, r);
  if (hit) raw.push(hit);
}
// Pit lanes and paddock roads branch off the infield boundary, and the walk
// follows them. Those excursions cross a road span far wider (or far narrower)
// than the circuit itself, so drop the outliers and let the resample bridge the
// gap with a chord along the racing surface.
const widthMedian = median(raw.map((h) => h[2]));
const samples = raw.filter((h) => h[2] > widthMedian * 0.35 && h[2] < widthMedian * 2.2);
if (samples.length < 32) {
  console.error(`only ${samples.length} centreline samples — mask is too thin or broken.`);
  process.exit(1);
}

let path = samples.map(([c, r, width]) => ({ x: grid.toWorldX(c), z: grid.toWorldZ(r), w: width * grid.cell }));
path = smooth(resample(path, 900), 9);
if (has('reverse')) path.reverse();
if (startAt) path = rollToStart(path, startAt[0], startAt[1]);

// ---- 4. emit ---------------------------------------------------------------

const cx = path.reduce((s, p) => s + p.x, 0) / path.length;
const cz = path.reduce((s, p) => s + p.z, 0) / path.length;
const length = polyLength(path);
const widths = path.map((p) => p.w).sort((a, b) => a - b);
const roadWidth = widths[Math.floor(widths.length / 2)];
// The narrowest stretch decides whether the game's painted ribbon can sit
// inside the tarmac everywhere, so record it rather than only the median.
const roadWidthMin = widths[Math.floor(widths.length * 0.02)];
const roadY = medianRoadY(kept);

const out = {
  source: file.split('/').pop(),
  generatedBy: 'scripts/bake-track-path.mjs',
  // Model-space metrics. The game scales all of these by one factor at load so
  // the path and the .glb stay locked together.
  length: round(length),
  roadWidth: round(roadWidth),
  roadWidthMin: round(roadWidthMin),
  roadY: round(roadY),
  center: [round(cx), round(cz)],
  points: path.map((p) => [round(p.x - cx), round(p.z - cz)])
};
if (outPath) {
  writeFileSync(outPath, `${JSON.stringify(out, null, 0)}\n`);
}

console.log(`${file.split('/').pop()} -> ${outPath ?? '(dry run)'}`);
console.log(`  primitives     ${road.length} (${tris.length} tris, ${tris.length - kept.length} oversized dropped)`);
console.log(`  grid           ${grid.w}x${grid.h} @ ${grid.cell.toFixed(2)} u/cell`);
console.log(`  infield        ${infieldSize} cells, contour ${contour.length}`);
console.log(`  lap length     ${length.toFixed(1)} model units`);
console.log(`  road width     ${roadWidth.toFixed(1)} median, ${roadWidthMin.toFixed(1)} narrowest (model units)`);
console.log(`  points         ${out.points.length}`);

if (debugPath) writeFileSync(debugPath, debugOverlay(grid, outside, infield, path, cx, cz));

// ---- helpers ---------------------------------------------------------------

function collectTriangles(prims) {
  const out = [];
  for (const p of prims) {
    const { positions: P, index } = p;
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len === 0 || Math.abs(ny / len) < 0.5) continue; // walls, kerb faces, barriers
      out.push({
        ax: P[a], az: P[a + 2], bx: P[b], bz: P[b + 2], cx: P[c], cz: P[c + 2],
        y: (P[a + 1] + P[b + 1] + P[c + 1]) / 3, area: len / 2
      });
    }
  }
  return out;
}

function median(values) {
  const a = [...values].sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : 1;
}

function medianArea(tris) {
  return median(tris.map((t) => t.area));
}

function medianRoadY(tris) {
  const ys = tris.map((t) => t.y).sort((a, b) => a - b);
  return ys.length ? ys[Math.floor(ys.length / 2)] : 0;
}

function triBounds(tris) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const t of tris) {
    minX = Math.min(minX, t.ax, t.bx, t.cx); maxX = Math.max(maxX, t.ax, t.bx, t.cx);
    minZ = Math.min(minZ, t.az, t.bz, t.cz); maxZ = Math.max(maxZ, t.az, t.bz, t.cz);
  }
  return { minX, maxX, minZ, maxZ };
}

function fillTri(grid, x0, y0, x1, y1, x2, y2) {
  const minC = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
  const maxC = Math.min(grid.w - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minR = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
  const maxR = Math.min(grid.h - 1, Math.ceil(Math.max(y0, y1, y2)));
  const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  if (Math.abs(denom) < 1e-12) return;
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      const px = c + 0.5, py = r + 0.5;
      const l0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / denom;
      const l1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / denom;
      if (l0 >= -0.03 && l1 >= -0.03 && 1 - l0 - l1 >= -0.03) grid.data[r * grid.w + c] = 1;
    }
  }
}

/** Morphological close: dilate then erode, sealing seams without fattening the band. */
function closeGaps(grid, radius) {
  const dil = dilate(grid.data, grid.w, grid.h, radius);
  const ero = erode(dil, grid.w, grid.h, radius);
  grid.data.set(ero);
}

function dilate(src, w, h, r) {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let dy = -r; dy <= r && !on; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && src[ny * w + nx]) { on = 1; break; }
        }
      }
      out[y * w + x] = on;
    }
  }
  return out;
}

function erode(src, w, h, r) {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let all = 1;
      for (let dy = -r; dy <= r && all; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !src[ny * w + nx]) { all = 0; break; }
        }
      }
      out[y * w + x] = all;
    }
  }
  return out;
}

/** Flood from the border; the largest remaining empty component is the infield. */
function findInfield(grid) {
  const { w, h, data } = grid;
  const outside = new Uint8Array(w * h);
  const stack = [];
  for (let c = 0; c < w; c++) stack.push(c, 0, c, h - 1);
  for (let r = 0; r < h; r++) stack.push(0, r, w - 1, r);
  while (stack.length) {
    const r = stack.pop(), c = stack.pop();
    if (c < 0 || r < 0 || c >= w || r >= h) continue;
    const i = r * w + c;
    if (outside[i] || data[i]) continue;
    outside[i] = 1;
    stack.push(c + 1, r, c - 1, r, c, r + 1, c, r - 1);
  }

  const label = new Int32Array(w * h).fill(-1);
  let best = -1, bestSize = 0;
  for (let seed = 0; seed < w * h; seed++) {
    if (data[seed] || outside[seed] || label[seed] >= 0) continue;
    let size = 0;
    const q = [seed];
    label[seed] = seed;
    while (q.length) {
      const i = q.pop();
      size++;
      const c = i % w, r = (i / w) | 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= w || nr >= h) continue;
        const ni = nr * w + nc;
        if (data[ni] || outside[ni] || label[ni] >= 0) continue;
        label[ni] = seed;
        q.push(ni);
      }
    }
    if (size > bestSize) { bestSize = size; best = seed; }
  }

  const infield = new Uint8Array(w * h);
  if (best >= 0) for (let i = 0; i < label.length; i++) if (label[i] === best) infield[i] = 1;
  return { outside, infield, infieldSize: bestSize };
}

/** Moore-neighbour boundary walk around the infield: ordered and closed. */
function traceContour(grid, infield) {
  const { w, h } = grid;
  const at = (c, r) => (c < 0 || r < 0 || c >= w || r >= h ? 0 : infield[r * w + c]);
  let sc = -1, sr = -1;
  for (let r = 0; r < h && sr < 0; r++) {
    for (let c = 0; c < w; c++) if (at(c, r)) { sc = c; sr = r; break; }
  }
  if (sr < 0) return [];

  const N = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const out = [[sc, sr]];
  let c = sc, r = sr, dir = 6;
  const limit = w * h * 4;
  for (let step = 0; step < limit; step++) {
    let moved = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8; // resume just behind the incoming direction
      const nc = c + N[d][0], nr = r + N[d][1];
      if (!at(nc, nr)) continue;
      c = nc; r = nr; dir = d; moved = true;
      break;
    }
    if (!moved) break;
    if (c === sc && r === sr) break;
    out.push([c, r]);
  }
  return out;
}

/**
 * From an infield boundary cell, step outward until the tarmac ends. Returns
 * the crossing midpoint and its width in cells.
 */
function marchAcross(grid, infield, c, r) {
  const { w, h, data } = grid;
  const road = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : data[y * w + x]);
  const inf = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : infield[y * w + x]);

  // Outward normal: away from the local infield mass.
  let mx = 0, mz = 0, n = 0;
  const R = 4;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      if (inf(c + dx, r + dy)) { mx += dx; mz += dy; n++; }
    }
  }
  if (!n) return null;
  let ox = -mx / n, oz = -mz / n;
  const len = Math.hypot(ox, oz);
  if (len < 1e-6) return null;
  ox /= len; oz /= len;

  // Enter the tarmac first — the boundary cell itself is infield.
  let t = 0;
  const maxSteps = Math.max(w, h);
  while (t < maxSteps && !road(Math.round(c + ox * t), Math.round(r + oz * t))) t += 0.5;
  if (t >= maxSteps) return null;
  const entry = t;
  while (t < maxSteps && road(Math.round(c + ox * t), Math.round(r + oz * t))) t += 0.5;
  const width = t - entry;
  if (width < 1) return null;

  const mid = entry + width / 2;
  return [c + ox * mid, r + oz * mid, width];
}

function polyLength(pts) {
  let d = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    d += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return d;
}

function resample(pts, count) {
  const total = polyLength(pts);
  const step = total / count;
  const out = [];
  let i = 0, carry = 0;
  let cur = { ...pts[0] };
  out.push({ ...cur });
  while (out.length < count && i < pts.length * 2) {
    const next = pts[(i + 1) % pts.length];
    let seg = Math.hypot(next.x - cur.x, next.z - cur.z);
    if (carry + seg < step) { carry += seg; cur = { ...next }; i++; continue; }
    const need = step - carry;
    const k = need / seg;
    cur = { x: cur.x + (next.x - cur.x) * k, z: cur.z + (next.z - cur.z) * k, w: next.w };
    out.push({ ...cur });
    carry = 0;
  }
  return out;
}

/** Circular moving average — takes the pixel stair-stepping out of the trace. */
function smooth(pts, radius) {
  const n = pts.length;
  return pts.map((_, i) => {
    let x = 0, z = 0, w = 0, count = 0;
    for (let k = -radius; k <= radius; k++) {
      const p = pts[(i + k + n * 2) % n];
      x += p.x; z += p.z; w += p.w; count++;
    }
    return { x: x / count, z: z / count, w: w / count };
  });
}

function rollToStart(pts, x, z) {
  let best = 0, bestD = Infinity;
  pts.forEach((p, i) => {
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  });
  return [...pts.slice(best), ...pts.slice(0, best)];
}

function round(v) {
  return Math.round(v * 100) / 100;
}

function debugOverlay(grid, outside, infield, path, cx, cz) {
  const { w, h, data } = grid;
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    let col;
    if (data[i]) col = [96, 100, 116];
    else if (infield[i]) col = [38, 92, 58];
    else if (outside[i]) col = [16, 18, 26];
    else col = [70, 40, 90];
    rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; rgba[o + 3] = 255;
  }
  const dot = (px, pz, col, size = 1) => {
    const c = Math.round(grid.toCol(px)), r = Math.round(grid.toRow(pz));
    for (let dy = -size; dy <= size; dy++) {
      for (let dx = -size; dx <= size; dx++) {
        const x = c + dx, y = r + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const o = (y * w + x) * 4;
        rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; rgba[o + 3] = 255;
      }
    }
  };
  path.forEach((p, i) => {
    // Colour ramp along the lap makes the travel direction readable at a glance.
    const t = i / path.length;
    dot(p.x, p.z, [Math.round(60 + 195 * t), Math.round(250 - 150 * t), 90]);
  });
  dot(path[0].x, path[0].z, [255, 60, 60], 4);
  dot(cx, cz, [90, 160, 255], 2);
  return writePng('', w, h, rgba).png;
}
