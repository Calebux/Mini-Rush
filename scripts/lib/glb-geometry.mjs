// Shared GLB helpers for the track-path bake: pull world-space triangles out of
// a .glb without three.js (no DOM, no texture decode), plus a tiny PNG writer
// used for the bake's debug overlays.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { deflateSync } from 'node:zlib';

/**
 * Every primitive in the file, with positions already baked into world space.
 * `flat` is the fraction of surface area whose normal points within ~32° of
 * straight up — the signal that separates drivable tarmac from walls and trees.
 */
export async function readPrimitives(file) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(file);
  const out = [];

  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const M = node.getWorldMatrix();

    for (const prim of mesh.listPrimitives()) {
      const posAcc = prim.getAttribute('POSITION');
      if (!posAcc) continue;

      const count = posAcc.getCount();
      const P = new Float64Array(count * 3);
      const v = [0, 0, 0];
      for (let i = 0; i < count; i++) {
        posAcc.getElement(i, v);
        P[i * 3] = M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12];
        P[i * 3 + 1] = M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13];
        P[i * 3 + 2] = M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14];
      }

      const idxAcc = prim.getIndices();
      const index = idxAcc
        ? Uint32Array.from(idxAcc.getArray())
        : Uint32Array.from({ length: count }, (_, i) => i);

      const material = prim.getMaterial();
      out.push({
        node: node.getName() ?? '',
        material: material ? (material.getName() ?? '') : '',
        positions: P,
        index,
        ...measure(P, index)
      });
    }
  }
  return out;
}

function measure(P, index) {
  let area = 0, flatArea = 0, yWeighted = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;

  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    const tri = len / 2;
    area += tri;
    if (len > 0 && Math.abs(ny / len) > 0.85) {
      flatArea += tri;
      yWeighted += tri * (P[a + 1] + P[b + 1] + P[c + 1]) / 3;
    }
  }

  for (let i = 0; i < P.length; i += 3) {
    if (P[i] < minX) minX = P[i];
    if (P[i] > maxX) maxX = P[i];
    if (P[i + 1] < minY) minY = P[i + 1];
    if (P[i + 1] > maxY) maxY = P[i + 1];
    if (P[i + 2] < minZ) minZ = P[i + 2];
    if (P[i + 2] > maxZ) maxZ = P[i + 2];
  }

  return {
    area, flatArea,
    flat: area > 0 ? flatArea / area : 0,
    meanFlatY: flatArea > 0 ? yWeighted / flatArea : (minY + maxY) / 2,
    bounds: { minX, maxX, minY, maxY, minZ, maxZ },
    spanX: maxX - minX, spanY: maxY - minY, spanZ: maxZ - minZ
  };
}

/** Rasterize a primitive's near-horizontal triangles onto an XZ grid. */
export function rasterizeFlat(prim, grid, value = 1) {
  const { positions: P, index } = prim;
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const ny = uz * vx - ux * vz;
    const len = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx);
    if (len === 0 || Math.abs(ny / len) < 0.5) continue; // skip walls/kerb faces
    fillTriangle(
      grid,
      grid.toCol(P[a]), grid.toRow(P[a + 2]),
      grid.toCol(P[b]), grid.toRow(P[b + 2]),
      grid.toCol(P[c]), grid.toRow(P[c + 2]),
      value
    );
  }
}

export function makeGrid(bounds, resolution) {
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  const span = Math.max(spanX, spanZ);
  const pad = span * 0.02;
  const originX = bounds.minX - pad, originZ = bounds.minZ - pad;
  const world = span + pad * 2;
  const cell = world / resolution;
  const w = Math.max(1, Math.ceil((spanX + pad * 2) / cell));
  const h = Math.max(1, Math.ceil((spanZ + pad * 2) / cell));
  return {
    w, h, cell, originX, originZ,
    data: new Uint8Array(w * h),
    toCol: (x) => (x - originX) / cell,
    toRow: (z) => (z - originZ) / cell,
    toWorldX: (col) => originX + (col + 0.5) * cell,
    toWorldZ: (row) => originZ + (row + 0.5) * cell,
    at(col, row) {
      if (col < 0 || row < 0 || col >= this.w || row >= this.h) return 0;
      return this.data[row * this.w + col];
    }
  };
}

function fillTriangle(grid, x0, y0, x1, y1, x2, y2, value) {
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
      const l2 = 1 - l0 - l1;
      // Small negative tolerance keeps hairline gaps from opening between the
      // triangles of a tessellated road surface.
      if (l0 >= -0.02 && l1 >= -0.02 && l2 >= -0.02) grid.data[r * grid.w + c] = value;
    }
  }
}

// ---- minimal PNG writer (debug overlays only) ------------------------------

export function writePng(path, width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
  return { png, path };
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
  return out;
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}
