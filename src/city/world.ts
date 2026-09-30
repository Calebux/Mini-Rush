import * as THREE from 'three';
import { glow, isSharedNeonTexture, NEON_PALETTE, puddleRoughness, Quads, signAtlas } from '../neonCity';
import {
  Block, BLOCKS, BRIDGE_HALF, BRIDGE_Z, CITY_BLOCKS, CITY_EXTENT, EAST_ISLAND_X0,
  EAST_ISLAND_X1, EAST_ISLAND_Z0, EAST_ISLAND_Z1, EDGE, HALF, PITCH, RING, SHORE,
  STREET, streetAt
} from './layout';

/**
 * Builds the open city: wet streets, towers, signs and their light, all in
 * chunks of 2×2 blocks that are shown only near the car.
 *
 * A tower is one textured box, not a box per window: the facade texture is a
 * 8×8 grid of 3 m window bays and a second texture marks which bays are lit,
 * so a 90 m tower costs the same as a shed. Each chunk is four meshes —
 * facades, plain solids, signs, light — whatever it contains.
 */

const CHUNK = 2;              // blocks per chunk side
const SHOW_RADIUS = 360;      // metres from the car to a chunk's centre
const BAY = 3;                // one window bay, metres
const CELLS = 8;              // bays per texture repeat

export const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---------------------------------------------------------------- textures

let facadeTex: { map: THREE.CanvasTexture; lit: THREE.CanvasTexture } | null = null;

/** Window bays and their lights. Shared by every city drive, never disposed. */
function facadeTextures() {
  if (facadeTex) return facadeTex;
  const px = 64, size = px * CELLS;
  const map = document.createElement('canvas'), lit = document.createElement('canvas');
  map.width = map.height = lit.width = lit.height = size;
  const m = map.getContext('2d')!, l = lit.getContext('2d')!;
  const rand = rng(0x66616361);
  l.fillStyle = '#000';
  l.fillRect(0, 0, size, size);
  for (let cx = 0; cx < CELLS; cx++) {
    for (let cy = 0; cy < CELLS; cy++) {
      const x = cx * px, y = cy * px;
      // concrete frame, then a recessed pane with a mullion
      m.fillStyle = '#8a8f9c';
      m.fillRect(x, y, px, px);
      m.fillStyle = '#6f7482';
      m.fillRect(x, y + px - 10, px, 10);            // floor slab
      // two 1.2 m panes per bay, each lit or dark on its own: real towers
      // have narrow windows, and a bay-wide pane read as a cartoon
      for (const pane of [0, 1]) {
        const wx = x + 6 + pane * (px / 2 - 3), ww = px / 2 - 9;
        const glass = 18 + Math.floor(rand() * 16);
        m.fillStyle = `rgb(${glass},${glass + 5},${glass + 16})`;
        m.fillRect(wx, y + 9, ww, px - 24);
        m.fillStyle = 'rgba(255,255,255,0.06)';      // sky in the glass
        m.fillRect(wx, y + 9, ww, 6);
        if (rand() < 0.24) {
          const c = new THREE.Color(NEON_PALETTE[Math.floor(rand() * NEON_PALETTE.length)])
            .lerp(new THREE.Color(0xfff2dc), 0.6 + rand() * 0.35);
          const k = 0.22 + rand() * 0.55;
          l.fillStyle = `rgb(${Math.round(c.r * 255 * k)},${Math.round(c.g * 255 * k)},${Math.round(c.b * 255 * k)})`;
          l.fillRect(wx, y + 9, ww, px - 24);
          if (rand() < 0.4) {                        // a blind half drawn
            l.fillStyle = 'rgba(0,0,0,0.8)';
            l.fillRect(wx, y + 9, ww, (px - 24) * (0.3 + rand() * 0.5));
          }
        }
      }
    }
  }
  const make = (canvas: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  facadeTex = { map: make(map), lit: make(lit) };
  return facadeTex;
}

let asphalt: THREE.CanvasTexture | null = null;
function asphaltTexture(): THREE.CanvasTexture {
  if (asphalt) return asphalt;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#3d3f45';
  ctx.fillRect(0, 0, 256, 256);
  const rand = rng(0x61737068);
  for (let i = 0; i < 9000; i++) {
    const v = 40 + Math.floor(rand() * 40);
    ctx.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + rand() * 0.4})`;
    ctx.fillRect(rand() * 256, rand() * 256, 1 + rand() * 2, 1 + rand() * 2);
  }
  asphalt = new THREE.CanvasTexture(c);
  asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
  asphalt.colorSpace = THREE.SRGBColorSpace;
  return asphalt;
}

// --------------------------------------------------------------- geometry

/** Non-indexed box soup with per-vertex colour and metre-scaled facade UVs. */
export class Solids {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = [];

  /**
   * Axis-aligned box from (x0,y0,z0) to (x1,y1,z1). Side faces get UVs in
   * window bays (offset by `bay` so neighbours do not share a lit pattern);
   * the top face maps to one dark pane. No bottom face.
   */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    color: THREE.Color, bay: [number, number] = [0, 0], top = true): void {
    const [bu, bv] = bay;
    const face = (corners: number[][], n: number[], uvs: number[][]) => {
      for (const k of [0, 1, 2, 0, 2, 3]) {
        this.pos.push(...corners[k]);
        this.nor.push(...n);
        this.uv.push(...uvs[k]);
        this.col.push(color.r, color.g, color.b);
      }
    };
    const U = (a: number) => (a / BAY + bu) / CELLS, V = (y: number) => (y / BAY + bv) / CELLS;
    const w = x1 - x0, d = z1 - z0;
    // +z (south) and -z (north) faces run along x; ±x faces run along z
    face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1],
      [[U(0), V(y0)], [U(w), V(y0)], [U(w), V(y1)], [U(0), V(y1)]]);
    face([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1],
      [[U(0), V(y0)], [U(w), V(y0)], [U(w), V(y1)], [U(0), V(y1)]]);
    face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0],
      [[U(0), V(y0)], [U(d), V(y0)], [U(d), V(y1)], [U(0), V(y1)]]);
    face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0],
      [[U(0), V(y0)], [U(d), V(y0)], [U(d), V(y1)], [U(0), V(y1)]]);
    if (top) {
      const t = 0.5 / CELLS / 64; // one texel of frame: flat, no windows
      face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0],
        [[t, t], [t, t], [t, t], [t, t]]);
    }
  }

  mesh(material: THREE.Material): THREE.Mesh | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return new THREE.Mesh(g, material);
  }
}

interface Chunk {
  cx: number; cz: number;
  facades: Solids; solids: Solids; signs: Quads; light: Quads;
  group: THREE.Group;
}

const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0);
const FULL: [number, number, number, number] = [0, 0, 1, 1];

export class CityWorld {
  readonly group = new THREE.Group();
  private chunks: Chunk[] = [];
  private materials: THREE.Material[] = [];

  constructor() {
    const { map, lit } = facadeTextures();
    const facadeMat = new THREE.MeshStandardMaterial({ map, emissiveMap: lit, emissive: 0xffffff,
      emissiveIntensity: 1.0, roughness: 0.5, metalness: 0.25, vertexColors: true });
    const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
    const signMat = new THREE.MeshBasicMaterial({ map: signAtlas().texture, side: THREE.DoubleSide,
      color: new THREE.Color(1.25, 1.25, 1.25) });
    const lightMat = new THREE.MeshBasicMaterial({ map: glow(), vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    this.materials.push(facadeMat, solidMat, signMat, lightMat);

    this.buildGround();
    this.buildEastIsland();

    const n = Math.ceil(BLOCKS / CHUNK);
    const grid: Chunk[][] = [];
    for (let a = 0; a < n; a++) {
      grid.push([]);
      for (let b = 0; b < n; b++) {
        const chunk: Chunk = {
          cx: streetAt(a * CHUNK) + PITCH * CHUNK / 2, cz: streetAt(b * CHUNK) + PITCH * CHUNK / 2,
          facades: new Solids(), solids: new Solids(), signs: new Quads(), light: new Quads(),
          group: new THREE.Group()
        };
        grid[a].push(chunk);
        this.chunks.push(chunk);
      }
    }
    for (const block of CITY_BLOCKS) {
      this.dressBlock(grid[Math.floor(block.i / CHUNK)][Math.floor(block.j / CHUNK)], block);
    }
    this.dressStreets((x, z) => {
      const a = THREE.MathUtils.clamp(Math.floor((x + HALF) / (PITCH * CHUNK)), 0, n - 1);
      const b = THREE.MathUtils.clamp(Math.floor((z + HALF) / (PITCH * CHUNK)), 0, n - 1);
      return grid[a][b];
    });
    for (const chunk of this.chunks) {
      const parts = [chunk.facades.mesh(facadeMat), chunk.solids.mesh(solidMat),
        chunk.signs.mesh(signMat), chunk.light.mesh(lightMat)];
      for (const mesh of parts) {
        if (!mesh) continue;
        if (mesh.material === lightMat) mesh.renderOrder = 2;
        else { mesh.castShadow = false; mesh.receiveShadow = true; }
        chunk.group.add(mesh);
      }
      this.group.add(chunk.group);
    }
  }

  /** Streets, the expressway, the harbour water and the city's outer wall. */
  private buildGround(): void {
    const size = CITY_EXTENT * 2 + 240;
    const tex = asphaltTexture().clone();
    tex.repeat.set(size / 9, size / 9);
    const puddles = puddleRoughness().clone();
    puddles.repeat.set(size / 26, size / 26);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
      // roughness above 1 scales the puddle map: standing water ~0.15, the
      // rest a damp 0.7, so the sheen is in patches rather than everywhere
      new THREE.MeshStandardMaterial({ map: tex, roughnessMap: puddles, roughness: 1.5, metalness: 0.1,
        color: 0x9aa2b6, envMapIntensity: 1.0 }));
    road.rotation.x = -Math.PI / 2;
    road.receiveShadow = true;
    this.group.add(road);
    this.materials.push(road.material as THREE.Material);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(size, 900),
      new THREE.MeshStandardMaterial({ color: 0x0b1626, roughness: 0.08, metalness: 0.6, envMapIntensity: 2.2 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.03, SHORE + 450);
    this.group.add(water);
    this.materials.push(water.material as THREE.Material);
  }

  /** Long freeway bridge and a compact second island beyond the old map edge. */
  private buildEastIsland(): void {
    const expansion = new THREE.Group();
    expansion.name = 'east-island-expansion';
    const islandWidth = EAST_ISLAND_X1 - EAST_ISLAND_X0;
    const islandDepth = EAST_ISLAND_Z1 - EAST_ISLAND_Z0;
    const land = new THREE.Mesh(new THREE.BoxGeometry(islandWidth, 0.18, islandDepth),
      new THREE.MeshStandardMaterial({ color: 0x1a2532, roughness: 0.92 }));
    land.position.set((EAST_ISLAND_X0 + EAST_ISLAND_X1) / 2, -0.02, (EAST_ISLAND_Z0 + EAST_ISLAND_Z1) / 2);
    land.receiveShadow = true;
    expansion.add(land);
    const roadTexture = asphaltTexture().clone();
    roadTexture.needsUpdate = true;
    roadTexture.repeat.set(34, 4);
    const roadMat = new THREE.MeshStandardMaterial({ map: roadTexture, roughness: 0.72, metalness: 0.16, color: 0x7b8294 });
    const road = new THREE.Mesh(new THREE.BoxGeometry(islandWidth - 28, 0.12, 22), roadMat);
    road.position.set((EAST_ISLAND_X0 + EAST_ISLAND_X1) / 2, 0.1, BRIDGE_Z);
    road.receiveShadow = true;
    expansion.add(road);
    const bridgeWidth = EAST_ISLAND_X0 - EDGE + 16;
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(bridgeWidth, 0.35, BRIDGE_HALF * 2), roadMat);
    bridge.position.set((EDGE + EAST_ISLAND_X0) / 2, 0.18, BRIDGE_Z);
    bridge.receiveShadow = true;
    expansion.add(bridge);
    const railMat = new THREE.MeshBasicMaterial({ color: 0x22e6ff, transparent: true, opacity: 0.8 });
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(bridgeWidth, 0.7, 0.25), railMat);
      rail.position.set((EDGE + EAST_ISLAND_X0) / 2, 0.72, BRIDGE_Z + side * (BRIDGE_HALF - 1));
      expansion.add(rail);
      const islandRail = new THREE.Mesh(new THREE.BoxGeometry(islandWidth - 28, 0.45, 0.18), railMat);
      islandRail.position.set((EAST_ISLAND_X0 + EAST_ISLAND_X1) / 2, 0.55, BRIDGE_Z + side * 10.3);
      expansion.add(islandRail);
    }
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xe6ecf5, transparent: true, opacity: 0.52 });
    for (let x = EDGE + 16; x < EAST_ISLAND_X1 - 12; x += 18) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(8, 0.035, 0.16), lineMat);
      dash.position.set(x, 0.4, BRIDGE_Z);
      expansion.add(dash);
    }
    const rand = rng(0x15e451);
    for (let i = 0; i < 22; i++) {
      const x = EAST_ISLAND_X0 + 32 + rand() * (islandWidth - 64);
      const z = EAST_ISLAND_Z0 + 24 + rand() * (islandDepth - 48);
      if (Math.abs(z - BRIDGE_Z) < 38) continue;
      const width = 10 + rand() * 20, depth = 10 + rand() * 18, height = 9 + rand() * 34;
      const color = new THREE.Color().setHSL(0.57 + rand() * 0.12, 0.2, 0.16 + rand() * 0.14);
      const building = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth),
        new THREE.MeshStandardMaterial({ color, roughness: 0.58, metalness: 0.2 }));
      building.position.set(x, height / 2, z);
      expansion.add(building);
      if (rand() < 0.7) {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(width * 0.65, 8), 1.2),
          new THREE.MeshBasicMaterial({ color: rand() < 0.5 ? 0xff2e9a : 0x22e6ff, transparent: true, opacity: 0.85 }));
        sign.position.set(x, Math.min(height - 2, 8 + rand() * 14), z - depth / 2 - 0.1);
        expansion.add(sign);
      }
    }
    this.group.add(expansion);
    this.materials.push(roadMat, railMat, lineMat, land.material as THREE.Material);
  }

  /** Towers, shops, plazas or the harbour, depending on the block's district. */
  private dressBlock(chunk: Chunk, block: Block): void {
    const rand = rng(block.i * 977 + block.j * 131 + 7);
    const kerb = new THREE.Color(0x3a4152);
    // raised pavement over the whole block, kerb to kerb
    chunk.solids.box(block.x0, 0, block.z0, block.x1, 0.18, block.z1, kerb);
    const inset = 4;
    const x0 = block.x0 + inset, x1 = block.x1 - inset, z0 = block.z0 + inset;

    if (block.district === 'plaza') {
      this.plaza(chunk, block, rand);
      return;
    }
    if (block.district === 'harbour') {
      this.harbour(chunk, block, rand);
      return;
    }
    const split = block.district === 'downtown' ? 2 : block.district === 'market' ? 4 : 3;
    const gap = 2.4;
    const cell = (x1 - x0 - gap * (split - 1)) / split;
    for (let a = 0; a < split; a++) {
      for (let b = 0; b < split; b++) {
        // interior lots of a 3×3 or 4×4 split face no street: leave a courtyard
        const edgeA = a === 0 || a === split - 1, edgeB = b === 0 || b === split - 1;
        if (!edgeA && !edgeB) continue;
        const bx0 = x0 + a * (cell + gap), bz0 = z0 + b * (cell + gap);
        const bx1 = bx0 + cell, bz1 = bz0 + cell;
        const h = this.height(block, rand);
        const tint = new THREE.Color().setHSL(0.58 + rand() * 0.14, 0.05 + rand() * 0.08, 0.24 + rand() * 0.16);
        const bay: [number, number] = [Math.floor(rand() * CELLS), Math.floor(rand() * CELLS)];
        chunk.facades.box(bx0, 0.18, bz0, bx1, h, bz1, tint, bay);
        // setbacks and crowns make a skyline rather than a row of bricks
        if (h > 40 && rand() < 0.7) {
          const s = cell * (0.18 + rand() * 0.12), top = h + 6 + rand() * 18;
          chunk.facades.box(bx0 + s, h, bz0 + s, bx1 - s, top, bz1 - s, tint, bay);
          if (rand() < 0.5) this.beacon(chunk, (bx0 + bx1) / 2, top + 4, (bz0 + bz1) / 2);
          chunk.solids.box((bx0 + bx1) / 2 - 0.15, top, (bz0 + bz1) / 2 - 0.15,
            (bx0 + bx1) / 2 + 0.15, top + 4, (bz0 + bz1) / 2 + 0.15, new THREE.Color(0x2a2f3a));
        } else {
          // rooftop plant
          chunk.solids.box(bx0 + cell * 0.2, h, bz0 + cell * 0.3, bx0 + cell * 0.45, h + 2.2, bz0 + cell * 0.6,
            new THREE.Color(0x4a505c));
        }
        // the sides that face a street get signs and a lit shopfront
        const sides: [boolean, THREE.Vector3, THREE.Vector3, number][] = [
          [a === 0, V3(bx0, 0, (bz0 + bz1) / 2), V3(-1, 0, 0), bz1 - bz0],
          [a === split - 1, V3(bx1, 0, (bz0 + bz1) / 2), V3(1, 0, 0), bz1 - bz0],
          [b === 0, V3((bx0 + bx1) / 2, 0, bz0), V3(0, 0, -1), bx1 - bx0],
          [b === split - 1, V3((bx0 + bx1) / 2, 0, bz1), V3(0, 0, 1), bx1 - bx0]
        ];
        for (const [faces, at, out, width] of sides) {
          if (faces) this.storefront(chunk, block, at, out, width, h, rand);
        }
      }
    }
  }

  private height(block: Block, rand: () => number): number {
    switch (block.district) {
      case 'downtown': return 48 + rand() * rand() * 80;
      case 'midtown': return 16 + rand() * 32;
      case 'market': return 7 + rand() * 7;
      default: return 10 + rand() * 6;
    }
  }

  /** Signs, their glow and reflection, and a lit shopfront on one street-facing wall. */
  private storefront(chunk: Chunk, block: Block, base: THREE.Vector3, out: THREE.Vector3,
    width: number, height: number, rand: () => number): void {
    const { words, blades } = signAtlas();
    const along = V3(-out.z, 0, out.x); // along the wall
    const market = block.district === 'market';
    const street = base.clone().addScaledVector(out, 4 + STREET * 0.5 - 1.6); // near kerb lane
    // hanging blade signs, one or two, sticking out over the pavement
    const count = market ? 2 : rand() < 0.75 ? 1 : 0;
    for (let k = 0; k < count; k++) {
      const cell = blades[Math.floor(rand() * blades.length)];
      const w = 1.3, h = Math.min(height * 0.5, 4.6 + rand() * 2.6);
      const y = Math.min(height - h / 2 - 0.5, 3.6 + h / 2 + rand() * 3);
      if (y - h / 2 < 3) continue;
      const shift = (rand() - 0.5) * width * 0.7;
      const at = base.clone().addScaledVector(out, 1.0).addScaledVector(along, shift).setY(y);
      const right = out.clone().multiplyScalar(w / 2);
      const up = UP.clone().multiplyScalar(h / 2);
      chunk.signs.add(at, right, up, [cell.u0, cell.v0, cell.u1, cell.v1], new THREE.Color(1, 1, 1));
      const tint = new THREE.Color(cell.color);
      chunk.light.add(at, right.clone().multiplyScalar(2.6), up.clone().multiplyScalar(1.45), FULL,
        tint.clone().multiplyScalar(0.28));
      chunk.light.add(at.clone().addScaledVector(out, -0.9), along.clone().multiplyScalar(2.2),
        up.clone().multiplyScalar(1.3), FULL, tint.clone().multiplyScalar(0.15));
      this.reflection(chunk, street.clone().addScaledVector(along, shift), along, tint, y, 0.2);
    }
    // a lettered board flat on the wall
    if (rand() < (market ? 0.9 : 0.55)) {
      const cell = words[Math.floor(rand() * words.length)];
      const w = Math.min(width * 0.6, 3.6 + rand() * 2), h = w / 2;
      const y = 3.4 + h / 2 + rand() * Math.max(0, Math.min(height - 8, 5));
      if (y + h / 2 < height) {
        const shift = (rand() - 0.5) * width * 0.4;
        const at = base.clone().addScaledVector(out, 0.1).addScaledVector(along, shift).setY(y);
        const right = along.clone().multiplyScalar(-w / 2);
        const up = UP.clone().multiplyScalar(h / 2);
        chunk.signs.add(at, right, up, [cell.u0, cell.v0, cell.u1, cell.v1], new THREE.Color(1, 1, 1));
        const tint = new THREE.Color(cell.color);
        chunk.light.add(at.clone().addScaledVector(out, 0.05), right.clone().multiplyScalar(1.7),
          up.clone().multiplyScalar(2.1), FULL, tint.clone().multiplyScalar(0.21));
        this.reflection(chunk, street.clone().addScaledVector(along, shift), along, tint, y, 0.16);
      }
    }
    // lit shopfront and its spill on the pavement
    if (rand() < 0.85) {
      const tint = new THREE.Color(NEON_PALETTE[Math.floor(rand() * NEON_PALETTE.length)])
        .lerp(new THREE.Color(0xfff0d8), 0.4);
      const front = base.clone().addScaledVector(out, 0.08).setY(1.5);
      chunk.light.add(front, along.clone().multiplyScalar(width * 0.45), UP.clone().multiplyScalar(1.5), FULL,
        tint.clone().multiplyScalar(0.3));
      const spill = base.clone().addScaledVector(out, 2.2).setY(0.22);
      chunk.light.add(spill, along.clone().multiplyScalar(width * 0.42), out.clone().multiplyScalar(1.9), FULL,
        tint.clone().multiplyScalar(0.12));
    }
  }

  /** A light's streak on the wet street, running along the traffic. */
  private reflection(chunk: Chunk, at: THREE.Vector3, along: THREE.Vector3, tint: THREE.Color,
    height: number, strength: number): void {
    const across = V3(along.z, 0, -along.x).multiplyScalar(0.8);
    chunk.light.add(at.clone().setY(0.05), across, along.clone().multiplyScalar(4 + height * 0.3), FULL,
      tint.clone().multiplyScalar(strength));
  }

  /** Red aircraft warning light on a tall roof. */
  private beacon(chunk: Chunk, x: number, y: number, z: number): void {
    const red = new THREE.Color(0xff3030).multiplyScalar(0.8);
    chunk.light.add(V3(x, y, z), V3(1.2, 0, 0), V3(0, 1.2, 0), FULL, red);
    chunk.light.add(V3(x, y, z), V3(0, 0, 1.2), V3(0, 1.2, 0), FULL, red);
  }

  private plaza(chunk: Chunk, block: Block, rand: () => number): void {
    const cx = (block.x0 + block.x1) / 2, cz = (block.z0 + block.z1) / 2;
    const stone = new THREE.Color(0x4a5064);
    chunk.solids.box(cx - 6, 0.18, cz - 6, cx + 6, 0.8, cz + 6, stone);
    // a holo pillar in the middle
    chunk.solids.box(cx - 0.8, 0.8, cz - 0.8, cx + 0.8, 14, cz + 0.8, new THREE.Color(0x1d2230));
    const tint = new THREE.Color(NEON_PALETTE[Math.floor(rand() * NEON_PALETTE.length)]);
    for (const [ax, az] of [[1, 0], [0, 1]]) {
      chunk.light.add(V3(cx, 9, cz), V3(ax * 3.2, 0, az * 3.2), V3(0, 6, 0), FULL, tint.clone().multiplyScalar(0.35));
    }
    chunk.light.add(V3(cx, 0.25, cz), V3(12, 0, 0), V3(0, 0, 12), FULL, tint.clone().multiplyScalar(0.16));
    for (let k = 0; k < 10; k++) {
      const x = block.x0 + 6 + rand() * (block.x1 - block.x0 - 12);
      const z = block.z0 + 6 + rand() * (block.z1 - block.z0 - 12);
      if (Math.abs(x - cx) < 9 && Math.abs(z - cz) < 9) continue;
      chunk.solids.box(x - 0.2, 0.18, z - 0.2, x + 0.2, 2.6, z + 0.2, new THREE.Color(0x3b2e28));
      chunk.solids.box(x - 1.6, 2.4, z - 1.6, x + 1.6, 5.2, z + 1.6, new THREE.Color(0x1f4a44));
    }
  }

  /** Warehouses, stacked containers and a gantry crane over the quay. */
  private harbour(chunk: Chunk, block: Block, rand: () => number): void {
    const colors = [0xb2452f, 0x2f6fb2, 0xc9a032, 0x3f8f58, 0x8a8f99];
    const shed = new THREE.Color(0x565c6a);
    const mid = (block.x0 + block.x1) / 2;
    chunk.solids.box(block.x0 + 5, 0.18, block.z0 + 5, mid - 3, 11 + rand() * 4, block.z0 + 30, shed);
    for (let k = 0; k < 14; k++) {
      const x = mid + 2 + (k % 4) * 6.4, z = block.z0 + 6 + Math.floor(k / 4) * 3.2;
      const stack = 1 + Math.floor(rand() * 3);
      for (let s = 0; s < stack; s++) {
        const c = new THREE.Color(colors[Math.floor(rand() * colors.length)]);
        chunk.solids.box(x, 0.18 + s * 2.6, z, x + 6, 0.18 + (s + 1) * 2.6 - 0.1, z + 2.5, c);
      }
    }
    if (block.i % 3 === 1) {
      const x = mid, z = block.z1 - 10;
      const crane = new THREE.Color(0xc9a032);
      for (const dx of [-6, 6]) chunk.solids.box(x + dx - 0.6, 0.18, z - 0.6, x + dx + 0.6, 34, z + 0.6, crane);
      chunk.solids.box(x - 7, 32, z - 1, x + 7, 34.5, z + 40, crane);
      this.beacon(chunk, x, 36, z + 38);
    }
    // quay lights along the water
    for (let x = block.x0 + 6; x < block.x1; x += 16) {
      const tint = new THREE.Color(0xffc987);
      chunk.light.add(V3(x, 6, block.z1 - 1), V3(1, 0, 0), V3(0, 1, 0), FULL, tint.clone().multiplyScalar(0.6));
      chunk.light.add(V3(x, 0.24, block.z1 - 3), V3(3, 0, 0), V3(0, 0, 3), FULL, tint.clone().multiplyScalar(0.15));
    }
  }

  /** Lane lines, streetlamps and the expressway's barrier. */
  private dressStreets(chunkAt: (x: number, z: number) => Chunk): void {
    const dash = new THREE.Color(0xd9c46a).multiplyScalar(0.35);
    const pole = new THREE.Color(0x2a2f3a);
    const lampTint = new THREE.Color(0xcfe0ff);
    for (let k = 0; k <= BLOCKS; k++) {
      const c = streetAt(k);
      for (let t = -HALF; t < HALF; t += 6) {
        // centre dashes, skipped through the junctions
        const inJunction = ((t + HALF) % PITCH) < STREET / 2 + 2 || ((t + HALF) % PITCH) > PITCH - STREET / 2 - 2;
        if (inJunction) continue;
        chunkAt(c, t).light.add(V3(c, 0.04, t + 1.5), V3(0.12, 0, 0), V3(0, 0, 1.5), FULL, dash);
        chunkAt(t, c).light.add(V3(t + 1.5, 0.04, c), V3(1.5, 0, 0), V3(0, 0, 0.12), FULL, dash);
      }
      // lamps every 28 m, alternating sides
      for (let t = -HALF + PITCH / 2, n = 0; t < HALF; t += 28, n++) {
        const side = n % 2 ? 1 : -1;
        for (const vertical of [true, false]) {
          const x = vertical ? c + side * (STREET / 2 + 0.6) : t;
          const z = vertical ? t : c + side * (STREET / 2 + 0.6);
          if (Math.abs(x) > HALF + 1 || Math.abs(z) > HALF + 1) continue;
          const chunk = chunkAt(x, z);
          chunk.solids.box(x - 0.1, 0.18, z - 0.1, x + 0.1, 6.6, z + 0.1, pole);
          const hx = vertical ? x - side * 1.4 : x, hz = vertical ? z : z - side * 1.4;
          chunk.light.add(V3(hx, 6.4, hz), V3(1.1, 0, 0), V3(0, 1.1, 0), FULL, lampTint.clone().multiplyScalar(0.55));
          chunk.light.add(V3(hx, 6.4, hz), V3(0, 0, 1.1), V3(0, 1.1, 0), FULL, lampTint.clone().multiplyScalar(0.55));
          chunk.light.add(V3(hx, 0.05, hz), V3(3.4, 0, 0), V3(0, 0, 3.4), FULL, new THREE.Color(0x8ea6d8).multiplyScalar(0.16));
        }
      }
    }
    // the expressway barrier all round: a wall with a neon rail
    const wall = new THREE.Color(0x30364a);
    const rail = new THREE.Color(0x22e6ff).multiplyScalar(0.5);
    for (let t = -EDGE; t < EDGE; t += 40) {
      const len = Math.min(40, EDGE - t);
      for (const [x0, z0, x1, z1] of [
        [t, -EDGE - 1, t + len, -EDGE], [t, EDGE, t + len, EDGE + 1],
        [-EDGE - 1, t, -EDGE, t + len], [EDGE, t, EDGE + 1, t + len]
      ]) {
        if (x0 === EDGE && z0 < BRIDGE_Z + BRIDGE_HALF && z1 > BRIDGE_Z - BRIDGE_HALF) continue;
        const chunk = chunkAt((x0 + x1) / 2, (z0 + z1) / 2);
        chunk.solids.box(x0, 0, z0, x1, 1.2, z1, wall);
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, horiz = x1 - x0 > z1 - z0;
        chunk.light.add(V3(mx, 1.25, mz), horiz ? V3(len / 2, 0, 0) : V3(0, 0, len / 2), V3(0, 0.35, 0), FULL, rail);
      }
    }
    // expressway lane markings
    const ringMid = HALF + STREET / 2 + RING / 2;
    for (let t = -EDGE; t < EDGE; t += 8) {
      for (const [x, z, horiz] of [[t, -ringMid, true], [t, ringMid, true], [-ringMid, t, false], [ringMid, t, false]] as const) {
        chunkAt(x, z).light.add(V3(horiz ? x + 2 : x, 0.04, horiz ? z : z + 2),
          horiz ? V3(2, 0, 0) : V3(0.15, 0, 0), horiz ? V3(0, 0, 0.15) : V3(0, 0, 2), FULL,
          new THREE.Color(0xe6ecf5).multiplyScalar(0.3));
      }
    }
  }

  /** Show the chunks near the car, hide the rest. */
  update(x: number, z: number): void {
    for (const chunk of this.chunks) {
      chunk.group.visible = Math.hypot(chunk.cx - x, chunk.cz - z) < SHOW_RADIUS;
    }
  }

  dispose(): void {
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    for (const m of this.materials) {
      const std = m as THREE.MeshStandardMaterial;
      // clones of the shared textures belong to this drive
      if (std.map && std.map !== facadeTex?.map && !isSharedNeonTexture(std.map)) std.map.dispose();
      if (std.roughnessMap) std.roughnessMap.dispose();
      m.dispose();
    }
  }
}
