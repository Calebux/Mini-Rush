import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AssetLibrary } from '../assets';
import { glow, Quads } from '../neonCity';
import {
  Block, BLOCKS, BRIDGE_HALF, BRIDGE_Z, CITY_BLOCKS, CITY_EXTENT, EAST_ISLAND_X0, EAST_ISLAND_X1,
  EAST_ISLAND_Z0, EAST_ISLAND_Z1, EDGE, HALF, PITCH, SHORE, STREET, streetAt
} from './layout';
import { rng, Solids } from './world';

/**
 * Kaduna by day, on the same street grid as Neon City (so the car, the GPS,
 * the fares and the police all work unchanged) but dressed as itself:
 * harmattan haze, wide roads worn rough (potholes, patches, faded paint,
 * red laterite at the kerbs), low painted buildings with parapets, water
 * tanks and zinc, hand-painted shop boards, neem trees, the Central Mosque
 * on Ahmadu Bello Way, Kasuwa's stalls and umbrellas, the Kaduna River in
 * the south, and akara sellers frying at the roadside: a black pot on three
 * stones over a live fire, smoke rising, the seller sat beside it.
 */

const CHUNK = 2;
const SHOW_RADIUS = 340;
const CELLS = 8;
const BAY = 3;

const PAINT = [0xe9dcc0, 0xd8e6ef, 0xcfe2c7, 0xefc9c4, 0xe6c07c, 0xf0ead9, 0xc9d4e8, 0xd9b99a];
const LATERITE = new THREE.Color(0x9c5f3e);

// ---------------------------------------------------------------- textures

let tex: { wall: THREE.CanvasTexture; boards: THREE.CanvasTexture; road: THREE.CanvasTexture } | null = null;

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
};
const finish = (c: HTMLCanvasElement, repeat = false) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
};

/** Painted plaster with barred windows, louvres and the odd stain: tinted per building. */
function wallTexture(): THREE.CanvasTexture {
  const px = 64, [c, ctx] = canvas(px * CELLS, px * CELLS);
  const rand = rng(0x6b6164);
  ctx.fillStyle = '#f4f0e8';
  ctx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 2600; i++) { // plaster grain
    ctx.fillStyle = `rgba(90,70,50,${0.02 + rand() * 0.05})`;
    ctx.fillRect(rand() * c.width, rand() * c.height, 2, 2);
  }
  for (let cx = 0; cx < CELLS; cx++) for (let cy = 0; cy < CELLS; cy++) {
    const x = cx * px, y = cy * px;
    ctx.fillStyle = 'rgba(0,0,0,.08)';             // floor band
    ctx.fillRect(x, y + px - 6, px, 6);
    if (rand() < 0.2) continue;                    // blank wall
    const w = 26 + rand() * 10, h = 30, wx = x + (px - w) / 2, wy = y + 10;
    ctx.fillStyle = rand() < 0.5 ? '#2c3a40' : '#3b4a3e';  // glass or louvre
    ctx.fillRect(wx, wy, w, h);
    ctx.strokeStyle = '#6c6f73';                   // burglar-proof bars
    ctx.lineWidth = 2;
    for (let b = wx + 4; b < wx + w; b += 5) { ctx.beginPath(); ctx.moveTo(b, wy); ctx.lineTo(b, wy + h); ctx.stroke(); }
    ctx.strokeRect(wx, wy, w, h);
    ctx.fillStyle = 'rgba(255,255,255,.35)';       // sill
    ctx.fillRect(wx - 2, wy + h, w + 4, 3);
    if (rand() < 0.3) {                            // rain-stain streak under the sill
      const g = ctx.createLinearGradient(0, wy + h, 0, y + px);
      g.addColorStop(0, 'rgba(80,60,40,.25)'); g.addColorStop(1, 'rgba(80,60,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(wx + rand() * w * 0.6, wy + h + 3, 6, px - h - 16);
    }
  }
  return finish(c, true);
}

const BOARDS = ['BUKA', 'PROVISIONS', 'CHEMIST', 'VULCANISER', 'POS', 'MAI SHAYI', 'GOD\'S TIME',
  'SUYA SPOT', 'PHONE REPAIR', 'BARBING SALON', 'FASHION', 'PHARMACY', 'MAI GUARDI', 'TAILOR', 'BLESSED', 'KASUWA'];
const BOARD_PAINT = ['#1d6fb8', '#d6342b', '#138a4e', '#e8a60a', '#6b3fa0', '#0c7f86', '#c2410c', '#1f2937'];

/** Hand-painted shop boards, four by four. */
function boardTexture(): THREE.CanvasTexture {
  const w = 256, h = 96, [c, ctx] = canvas(w * 4, h * 4);
  BOARDS.forEach((word, i) => {
    const x = (i % 4) * w, y = Math.floor(i / 4) * h;
    ctx.fillStyle = BOARD_PAINT[i % BOARD_PAINT.length];
    ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
    ctx.strokeStyle = '#f5efe0'; ctx.lineWidth = 4;
    ctx.strokeRect(x + 10, y + 10, w - 20, h - 20);
    ctx.fillStyle = '#fff8e8';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let size = 44;
    ctx.font = `900 ${size}px "Arial Black", Impact, sans-serif`;
    const fit = w - 40, m = ctx.measureText(word).width;
    if (m > fit) { size = Math.floor(size * fit / m); ctx.font = `900 ${size}px "Arial Black", Impact, sans-serif`; }
    ctx.fillText(word, x + w / 2, y + h / 2 + 2);
    ctx.fillStyle = 'rgba(0,0,0,.18)';             // weathering at the bottom
    ctx.fillRect(x + 4, y + h - 18, w - 8, 14);
  });
  return finish(c);
}

/** Worn asphalt: patches, cracks, potholes. */
function roadTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 512);
  const rand = rng(0x6b726f);
  ctx.fillStyle = '#56575a';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 14000; i++) {
    const v = 70 + Math.floor(rand() * 40);
    ctx.fillStyle = `rgba(${v},${v - 2},${v - 6},${0.3 + rand() * 0.4})`;
    ctx.fillRect(rand() * 512, rand() * 512, 1 + rand() * 2, 1 + rand() * 2);
  }
  for (let i = 0; i < 5; i++) {                    // patched tarmac, only a shade darker
    ctx.fillStyle = `rgba(48,48,50,${0.12 + rand() * 0.12})`;
    ctx.fillRect(rand() * 470, rand() * 470, 30 + rand() * 60, 20 + rand() * 50);
  }
  ctx.strokeStyle = 'rgba(25,25,25,.55)'; ctx.lineWidth = 1.4;   // cracks
  for (let i = 0; i < 26; i++) {
    let x = rand() * 512, y = rand() * 512;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (rand() - 0.5) * 40; y += (rand() - 0.5) * 40; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  for (let i = 0; i < 7; i++) {                    // potholes: dark rim, dusty bowl
    const x = rand() * 500, y = rand() * 500, r = 6 + rand() * 12;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, '#8a6a4f'); g.addColorStop(0.65, '#3a3027'); g.addColorStop(1, 'rgba(20,20,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, r * 1.3, r, rand() * 3, 0, Math.PI * 2); ctx.fill();
  }
  return finish(c, true);
}

function textures() {
  tex ??= { wall: wallTexture(), boards: boardTexture(), road: roadTexture() };
  return tex;
}

// --------------------------------------------------------------- geometry

/** Coloured non-box props (pots, domes, trees, umbrellas), merged per chunk. */
class Props {
  parts: THREE.BufferGeometry[] = [];
  add(geo: THREE.BufferGeometry, color: THREE.Color | number, at: THREE.Vector3, scale = new THREE.Vector3(1, 1, 1),
    rotY = 0): void {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    g.deleteAttribute('uv');
    const m = new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)), scale);
    g.applyMatrix4(m);
    const c = new THREE.Color(color);
    const n = g.getAttribute('position').count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]), 3));
    this.parts.push(g);
  }
  mesh(material: THREE.Material): THREE.Mesh | null {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    return merged ? new THREE.Mesh(merged, material) : null;
  }
}

const GEO = {
  cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
  pot: new THREE.CylinderGeometry(1, 0.62, 1, 14, 1, true),
  cone: new THREE.ConeGeometry(1, 1, 12),
  ball: new THREE.IcosahedronGeometry(1, 1),
  dome: new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  stone: new THREE.DodecahedronGeometry(1, 0)
};

interface Chunk {
  cx: number; cz: number;
  walls: Solids; solids: Solids; boards: Quads; props: Props; light: Quads;
  group: THREE.Group;
  stalls: THREE.Vector3[];       // where akara sellers sit, for the seller pool
}

const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0);
const FULL: [number, number, number, number] = [0, 0, 1, 1];

export class KadunaWorld {
  readonly group = new THREE.Group();
  private chunks: Chunk[] = [];
  private materials: THREE.Material[] = [];
  private fireMat: THREE.MeshBasicMaterial;
  private smoke: { sprite: THREE.Sprite; base: THREE.Vector3; t: number }[] = [];
  private sellers: { body: THREE.Group; mixer: THREE.AnimationMixer; at: THREE.Vector3 | null }[] = [];
  private stalls: { at: THREE.Vector3; face: number; out: THREE.Vector3 }[] = [];
  private time = 0;

  constructor(private assets: AssetLibrary) {
    const { wall, boards } = textures();
    const wallMat = new THREE.MeshStandardMaterial({ map: wall, vertexColors: true, roughness: 0.92 });
    const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const boardMat = new THREE.MeshStandardMaterial({ map: boards, side: THREE.DoubleSide, roughness: 0.8 });
    const propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true });
    this.fireMat = new THREE.MeshBasicMaterial({ map: glow(), vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    this.materials.push(wallMat, solidMat, boardMat, propMat, this.fireMat);

    this.buildGround();
    this.buildSouthBank();

    const n = Math.ceil(BLOCKS / CHUNK);
    const grid: Chunk[][] = [];
    for (let a = 0; a < n; a++) {
      grid.push([]);
      for (let b = 0; b < n; b++) {
        const chunk: Chunk = {
          cx: streetAt(a * CHUNK) + PITCH * CHUNK / 2, cz: streetAt(b * CHUNK) + PITCH * CHUNK / 2,
          walls: new Solids(), solids: new Solids(), boards: new Quads(), props: new Props(), light: new Quads(),
          group: new THREE.Group(), stalls: []
        };
        grid[a].push(chunk);
        this.chunks.push(chunk);
      }
    }
    const chunkAt = (x: number, z: number) => {
      const a = THREE.MathUtils.clamp(Math.floor((x + HALF) / (PITCH * CHUNK)), 0, n - 1);
      const b = THREE.MathUtils.clamp(Math.floor((z + HALF) / (PITCH * CHUNK)), 0, n - 1);
      return grid[a][b];
    };
    for (const block of CITY_BLOCKS) this.dressBlock(grid[Math.floor(block.i / CHUNK)][Math.floor(block.j / CHUNK)], block);
    this.dressStreets(chunkAt);
    this.buildEastSide();

    for (const chunk of this.chunks) {
      for (const mesh of [chunk.walls.mesh(wallMat), chunk.solids.mesh(solidMat), chunk.boards.mesh(boardMat),
        chunk.props.mesh(propMat), chunk.light.mesh(this.fireMat)]) {
        if (!mesh) continue;
        if (mesh.material === this.fireMat) mesh.renderOrder = 2;
        else { mesh.castShadow = true; mesh.receiveShadow = true; }
        chunk.group.add(mesh);
      }
      this.group.add(chunk.group);
    }
    this.buildSellers();
  }

  // ── the ground: rough roads, red dirt, the river ────────────────────────
  private buildGround(): void {
    const size = CITY_EXTENT * 2 + 240;
    const road = textures().road.clone();
    road.needsUpdate = true;
    road.repeat.set(size / 26, size / 26);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ map: road, roughness: 0.95, color: 0xd9d6d0 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
    this.materials.push(ground.material as THREE.Material);
    // outside the ring road: open laterite and scrub, not endless tarmac
    const dirt = new THREE.MeshStandardMaterial({ color: 0xb87a4e, roughness: 1 });
    this.materials.push(dirt);
    const w = size / 2 - EDGE - 2;
    for (const [x, z, sx, sz] of [[0, -EDGE - 2 - w / 2, size, w], [-EDGE - 2 - w / 2, 0, w, EDGE * 2 + 4], [EDGE + 2 + w / 2, 0, w, EDGE * 2 + 4]] as const) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), dirt);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.01, z);
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  /** The Kaduna River to the south: muddy green water behind a sandy bank. */
  private buildSouthBank(): void {
    const size = CITY_EXTENT * 2 + 240;
    const bank = new THREE.Mesh(new THREE.PlaneGeometry(size, 30), new THREE.MeshStandardMaterial({ color: 0xcfae7c, roughness: 1 }));
    bank.rotation.x = -Math.PI / 2;
    bank.position.set(0, 0.02, SHORE + 12);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(size, 900),
      new THREE.MeshStandardMaterial({ color: 0x5f7a5c, roughness: 0.25, metalness: 0.15 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.04, SHORE + 27 + 450);
    this.group.add(bank, water);
    this.materials.push(bank.material as THREE.Material, water.material as THREE.Material);
  }

  /** Across the bridge: Sabon Tasha, low and spread out along the road. */
  private buildEastSide(): void {
    const g = new THREE.Group();
    const iw = EAST_ISLAND_X1 - EAST_ISLAND_X0, id = EAST_ISLAND_Z1 - EAST_ISLAND_Z0;
    const land = new THREE.Mesh(new THREE.BoxGeometry(iw, 0.18, id), new THREE.MeshStandardMaterial({ color: 0xb88457, roughness: 1 }));
    land.position.set((EAST_ISLAND_X0 + EAST_ISLAND_X1) / 2, -0.02, (EAST_ISLAND_Z0 + EAST_ISLAND_Z1) / 2);
    const roadMat = new THREE.MeshStandardMaterial({ map: textures().road, roughness: 0.95, color: 0xcfcac2 });
    const road = new THREE.Mesh(new THREE.BoxGeometry(iw - 28, 0.12, 22), roadMat);
    road.position.set((EAST_ISLAND_X0 + EAST_ISLAND_X1) / 2, 0.1, BRIDGE_Z);
    const bw = EAST_ISLAND_X0 - EDGE + 16;
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.35, BRIDGE_HALF * 2), roadMat);
    bridge.position.set((EDGE + EAST_ISLAND_X0) / 2, 0.18, BRIDGE_Z);
    const railMat = new THREE.MeshStandardMaterial({ color: 0xd9d4c7, roughness: 0.8 });
    g.add(land, road, bridge);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.9, 0.3), railMat);
      rail.position.set((EDGE + EAST_ISLAND_X0) / 2, 0.8, BRIDGE_Z + side * (BRIDGE_HALF - 1));
      g.add(rail);
    }
    const rand = rng(0x5ab07);
    for (let i = 0; i < 26; i++) {
      const x = EAST_ISLAND_X0 + 32 + rand() * (iw - 64), z = EAST_ISLAND_Z0 + 24 + rand() * (id - 48);
      if (Math.abs(z - BRIDGE_Z) < 30) continue;
      const w = 10 + rand() * 14, d = 9 + rand() * 12, h = 4 + rand() * 7;
      const house = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color: PAINT[Math.floor(rand() * PAINT.length)], roughness: 0.95 }));
      house.position.set(x, h / 2, z);
      house.castShadow = house.receiveShadow = true;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.3, d + 0.8), new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 0.7, metalness: 0.4 }));
      roof.position.set(x, h + 0.15, z);
      g.add(house, roof);
      this.materials.push(house.material as THREE.Material, roof.material as THREE.Material);
    }
    this.group.add(g);
    this.materials.push(land.material as THREE.Material, roadMat, railMat);
  }

  // ── blocks ───────────────────────────────────────────────────────────────
  private dressBlock(chunk: Chunk, block: Block): void {
    const rand = rng(block.i * 911 + block.j * 173 + 11);
    // the pavement is dirt and broken slabs, a red laterite verge at the kerb
    chunk.solids.box(block.x0, 0, block.z0, block.x1, 0.14, block.z1, new THREE.Color(0xa99a86));
    chunk.solids.box(block.x0 - 1.2, 0, block.z0 - 1.2, block.x1 + 1.2, 0.06, block.z1 + 1.2, LATERITE);
    if (block.district === 'plaza') { this.square(chunk, block, rand); return; }
    if (block.district === 'harbour') { this.riverside(chunk, block, rand); return; }
    if (block.district === 'market') { this.market(chunk, block, rand); return; }
    const downtown = block.district === 'downtown';
    // the Central Mosque on Ahmadu Bello Way, once
    if (block.i === 5 && block.j === 6) { this.mosque(chunk, block); return; }
    const inset = 3.5, x0 = block.x0 + inset, x1 = block.x1 - inset, z0 = block.z0 + inset;
    const split = downtown ? 3 : 4, gap = 2, cell = (x1 - x0 - gap * (split - 1)) / split;
    for (let a = 0; a < split; a++) for (let b = 0; b < split; b++) {
      const edgeA = a === 0 || a === split - 1, edgeB = b === 0 || b === split - 1;
      const bx0 = x0 + a * (cell + gap), bz0 = z0 + b * (cell + gap), bx1 = bx0 + cell, bz1 = bz0 + cell;
      if (!edgeA && !edgeB) {                       // a compound's yard: a neem tree
        this.neem(chunk, V3((bx0 + bx1) / 2, 0.14, (bz0 + bz1) / 2), rand);
        continue;
      }
      const floors = downtown ? 2 + Math.floor(rand() * rand() * 5) : 1 + Math.floor(rand() * 2.4);
      const h = floors * BAY + 0.14;
      const tint = new THREE.Color(PAINT[Math.floor(rand() * PAINT.length)]);
      const bay: [number, number] = [Math.floor(rand() * CELLS), Math.floor(rand() * CELLS)];
      chunk.walls.box(bx0, 0.14, bz0, bx1, h, bz1, tint, bay);
      // parapet and the black water tank every roof has
      chunk.solids.box(bx0, h, bz0, bx1, h + 0.6, bz0 + 0.3, tint.clone().multiplyScalar(0.9));
      chunk.solids.box(bx0, h, bz1 - 0.3, bx1, h + 0.6, bz1, tint.clone().multiplyScalar(0.9));
      if (rand() < 0.6) {
        const tx = bx0 + cell * (0.25 + rand() * 0.5), tz = bz0 + cell * (0.25 + rand() * 0.5);
        chunk.props.add(GEO.cyl, 0x1b1c1f, V3(tx, h + 1.1, tz), V3(0.9, 1.8, 0.9));
        chunk.solids.box(tx - 1, h, tz - 1, tx + 1, h + 0.2, tz + 1, new THREE.Color(0x6b6f74));
      } else if (!downtown) {                       // a rusty zinc roof instead
        chunk.solids.box(bx0 - 0.3, h, bz0 - 0.3, bx1 + 0.3, h + 0.25, bz1 + 0.3,
          new THREE.Color(rand() < 0.5 ? 0x9a5a36 : 0x8b8f94));
      }
      const sides: [boolean, THREE.Vector3, THREE.Vector3, number][] = [
        [a === 0, V3(bx0, 0, (bz0 + bz1) / 2), V3(-1, 0, 0), bz1 - bz0],
        [a === split - 1, V3(bx1, 0, (bz0 + bz1) / 2), V3(1, 0, 0), bz1 - bz0],
        [b === 0, V3((bx0 + bx1) / 2, 0, bz0), V3(0, 0, -1), bx1 - bx0],
        [b === split - 1, V3((bx0 + bx1) / 2, 0, bz1), V3(0, 0, 1), bx1 - bx0]
      ];
      for (const [faces, at, out, width] of sides) if (faces) this.shopfront(chunk, at, out, width, rand);
    }
  }

  /** A painted board over the door, an awning, and sometimes an akara seller out front. */
  private shopfront(chunk: Chunk, base: THREE.Vector3, out: THREE.Vector3, width: number, rand: () => number): void {
    const along = V3(-out.z, 0, out.x);
    if (rand() < 0.7) {
      const k = Math.floor(rand() * BOARDS.length), u0 = (k % 4) / 4, v1 = 1 - Math.floor(k / 4) / 4;
      const w = Math.min(width * 0.7, 3.8), h = w * 0.375;
      const at = base.clone().addScaledVector(out, 0.08).setY(2.9 + h / 2);
      chunk.boards.add(at, along.clone().multiplyScalar(-w / 2), UP.clone().multiplyScalar(h / 2), [u0, v1 - 0.25, u0 + 0.25, v1], new THREE.Color(1, 1, 1));
    }
    if (rand() < 0.45) {                            // a zinc awning over the pavement
      const c = new THREE.Color(rand() < 0.5 ? 0x8b8f94 : 0x9a5a36);
      const p0 = base.clone().addScaledVector(along, -width * 0.35), p1 = base.clone().addScaledVector(along, width * 0.35).addScaledVector(out, 2);
      chunk.solids.box(Math.min(p0.x, p1.x), 2.55, Math.min(p0.z, p1.z), Math.max(p0.x, p1.x), 2.7, Math.max(p0.z, p1.z), c);
    }
    if (rand() < 0.028) this.akara(chunk, base.clone().addScaledVector(out, 3.6).addScaledVector(along, (rand() - 0.5) * width * 0.4), out, rand);
  }

  /** An akara stand: a black pot of oil on three stones over a fire, a table, baskets, a stool. */
  private akara(chunk: Chunk, at: THREE.Vector3, out: THREE.Vector3, rand: () => number): void {
    const p = chunk.props;
    const y = 0.14;
    for (let k = 0; k < 3; k++) {                   // the three stones
      const a = k * 2.1 + 0.4;
      p.add(GEO.stone, 0x6d655c, V3(at.x + Math.cos(a) * 0.42, y + 0.14, at.z + Math.sin(a) * 0.42), V3(0.2, 0.18, 0.2));
    }
    p.add(GEO.pot, 0x141414, V3(at.x, y + 0.5, at.z), V3(0.52, 0.34, 0.52));        // the pot
    p.add(GEO.cyl, 0xc58a1e, V3(at.x, y + 0.66, at.z), V3(0.47, 0.02, 0.47));       // hot oil
    for (let k = 0; k < 5; k++) {                   // akara balls frying
      p.add(GEO.ball, 0xb8661c, V3(at.x + (rand() - 0.5) * 0.5, y + 0.69, at.z + (rand() - 0.5) * 0.5), V3(0.07, 0.06, 0.07));
    }
    p.add(GEO.cyl, 0x3a2a1c, V3(at.x, y + 0.08, at.z), V3(0.36, 0.04, 0.36));       // firewood
    // the fire: a flickering glow under the pot
    const fire = new THREE.Color(0xff7a1a);
    chunk.light.add(V3(at.x, y + 0.3, at.z), V3(0.55, 0, 0), V3(0, 0.34, 0), FULL, fire.clone().multiplyScalar(0.9));
    chunk.light.add(V3(at.x, y + 0.3, at.z), V3(0, 0, 0.55), V3(0, 0.34, 0), FULL, fire.clone().multiplyScalar(0.9));
    chunk.light.add(V3(at.x, y + 0.05, at.z), V3(1.4, 0, 0), V3(0, 0, 1.4), FULL, fire.clone().multiplyScalar(0.35));
    // a table with a tray of finished akara, a basin, a stool
    const side = V3(-out.z, 0, out.x);
    const t = at.clone().addScaledVector(side, 1.3);
    chunk.solids.box(t.x - 0.55, y, t.z - 0.4, t.x + 0.55, y + 0.78, t.z + 0.4, new THREE.Color(0x7a5234));
    p.add(GEO.cyl, 0xd9d2c2, V3(t.x, y + 0.82, t.z), V3(0.36, 0.04, 0.36));
    for (let k = 0; k < 6; k++) p.add(GEO.ball, 0xa9581a, V3(t.x + (rand() - 0.5) * 0.4, y + 0.87, t.z + (rand() - 0.5) * 0.4), V3(0.07, 0.06, 0.07));
    p.add(GEO.cyl, 0x2f7de1, at.clone().addScaledVector(side, -1).setY(y + 0.16), V3(0.34, 0.16, 0.34));   // plastic basin
    const stool = at.clone().addScaledVector(out, 0.9);
    p.add(GEO.cyl, 0xe0433a, stool.clone().setY(y + 0.2), V3(0.22, 0.4, 0.22));
    // an umbrella over it all
    const umb = at.clone().addScaledVector(side, 0.6);
    p.add(GEO.cyl, 0xdedede, umb.clone().setY(y + 1.2), V3(0.04, 2.4, 0.04));
    p.add(GEO.cone, [0xe8a60a, 0x1d6fb8, 0xd6342b][Math.floor(rand() * 3)], umb.clone().setY(y + 2.55), V3(1.6, 0.5, 1.6));
    // smoke off the oil
    for (let k = 0; k < 3; k++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: 0xd8d2c8, transparent: true, opacity: 0, depthWrite: false }));
      const base = V3(at.x, y + 0.9, at.z);
      sprite.position.copy(base);
      chunk.group.add(sprite);
      this.materials.push(sprite.material);
      this.smoke.push({ sprite, base, t: k / 3 });
    }
    const face = Math.atan2(at.x - stool.x, at.z - stool.z);
    this.stalls.push({ at: stool, face, out: out.clone() });
    chunk.stalls.push(stool);
  }

  /** A neem: a short trunk under a broad, dense, dark-green crown. */
  private neem(chunk: Chunk, at: THREE.Vector3, rand: () => number): void {
    const h = 2.4 + rand() * 1.6, r = 2.2 + rand() * 1.4;
    chunk.props.add(GEO.cyl, 0x5b4632, at.clone().setY(at.y + h / 2), V3(0.26, h, 0.26));
    for (let k = 0; k < 3; k++) {
      const a = rand() * 6.28;
      chunk.props.add(GEO.ball, [0x3f6b35, 0x4b7a3c, 0x365d2e][k], V3(at.x + Math.cos(a) * r * 0.35, at.y + h + r * 0.45, at.z + Math.sin(a) * r * 0.35),
        V3(r * (k ? 0.75 : 1), r * 0.7, r * (k ? 0.75 : 1)));
    }
  }

  /** Kasuwa: rows of stalls under zinc and umbrellas, crates and sacks. */
  private market(chunk: Chunk, block: Block, rand: () => number): void {
    for (let x = block.x0 + 6; x < block.x1 - 5; x += 7) for (let z = block.z0 + 6; z < block.z1 - 5; z += 6.5) {
      if (rand() < 0.15) continue;
      const w = 4.2, d = 3.6;
      chunk.solids.box(x, 0.14, z, x + w, 1.0, z + d * 0.4, new THREE.Color(0x7a5234));               // counter
      for (const [px, pz] of [[x, z], [x + w, z], [x, z + d], [x + w, z + d]]) chunk.solids.box(px - 0.06, 0.14, pz - 0.06, px + 0.06, 2.6, pz + 0.06, new THREE.Color(0x5b4632));
      chunk.solids.box(x - 0.3, 2.6, z - 0.3, x + w + 0.3, 2.75, z + d + 0.3, new THREE.Color(rand() < 0.5 ? 0x9a5a36 : 0x8b8f94)); // zinc
      for (let k = 0; k < 4; k++) {                 // goods: sacks, crates, bowls of pepper
        const gx = x + 0.5 + rand() * (w - 1), gz = z + 0.2 + rand() * 0.6;
        chunk.props.add(k % 2 ? GEO.ball : GEO.cyl, [0xd6342b, 0xe8a60a, 0x138a4e, 0xf0ead9][k], V3(gx, 1.1, gz), V3(0.25, 0.18, 0.25));
      }
    }
    if (rand() < 0.9) this.akara(chunk, V3((block.x0 + block.x1) / 2, 0, block.z0 - 3.2), V3(0, 0, -1), rand);
  }

  /** Murtala Square: open ground, benches, trees and a flagpole. */
  private square(chunk: Chunk, block: Block, rand: () => number): void {
    const cx = (block.x0 + block.x1) / 2, cz = (block.z0 + block.z1) / 2;
    chunk.solids.box(block.x0 + 3, 0.14, block.z0 + 3, block.x1 - 3, 0.2, block.z1 - 3, new THREE.Color(0x8fa25a));
    chunk.props.add(GEO.cyl, 0xe5e5e5, V3(cx, 6.2, cz), V3(0.12, 12, 0.12));
    chunk.solids.box(cx + 0.1, 10.6, cz - 0.02, cx + 2.3, 11.9, cz + 0.02, new THREE.Color(0x138a4e));    // the flag, green-white-green
    chunk.solids.box(cx + 0.83, 10.61, cz - 0.03, cx + 1.56, 11.89, cz + 0.03, new THREE.Color(0xf5f5f5));
    for (let k = 0; k < 10; k++) this.neem(chunk, V3(block.x0 + 8 + rand() * (block.x1 - block.x0 - 16), 0.2, block.z0 + 8 + rand() * (block.z1 - block.z0 - 16)), rand);
  }

  /** The river bank: a line of neem, fishing canoes pulled up, a stall or two. */
  private riverside(chunk: Chunk, block: Block, rand: () => number): void {
    for (let x = block.x0 + 5; x < block.x1; x += 11) this.neem(chunk, V3(x + rand() * 3, 0.14, block.z1 - 6), rand);
    for (let k = 0; k < 3; k++) {
      const x = block.x0 + 10 + rand() * (block.x1 - block.x0 - 20);
      chunk.props.add(GEO.cyl, 0x6b4a2e, V3(x, 0.4, block.z1 - 1.5), V3(0.7, 5, 0.5), Math.PI / 2);
    }
    if (rand() < 0.7) this.akara(chunk, V3(block.x0 + 12 + rand() * 40, 0, block.z0 - 3.2), V3(0, 0, -1), rand);
  }

  /** The Central Mosque: white walls, a green dome, two minarets. */
  private mosque(chunk: Chunk, block: Block): void {
    const cx = (block.x0 + block.x1) / 2, cz = (block.z0 + block.z1) / 2;
    chunk.solids.box(block.x0 + 4, 0.14, block.z0 + 4, block.x1 - 4, 0.4, block.z1 - 4, new THREE.Color(0xe8e3d6));
    chunk.walls.box(cx - 16, 0.4, cz - 12, cx + 16, 11, cz + 12, new THREE.Color(0xf6f3ea), [2, 5]);
    chunk.props.add(GEO.dome, 0x1d8a5a, V3(cx, 11, cz), V3(10, 9, 10));
    chunk.props.add(GEO.cone, 0xd8b04a, V3(cx, 20.8, cz), V3(0.5, 2.4, 0.5));
    for (const sx of [-1, 1]) {
      chunk.props.add(GEO.cyl, 0xf6f3ea, V3(cx + sx * 21, 16, cz - 10), V3(1.4, 32, 1.4));
      chunk.props.add(GEO.cyl, 0xe0dbcf, V3(cx + sx * 21, 26, cz - 10), V3(2.2, 0.8, 2.2));
      chunk.props.add(GEO.dome, 0x1d8a5a, V3(cx + sx * 21, 32, cz - 10), V3(1.6, 2.4, 1.6));
    }
  }

  // ── streets: faded paint, dead streetlights, dirt verges ───────────────
  private dressStreets(chunkAt: (x: number, z: number) => Chunk): void {
    const paint = new THREE.Color(0xe8e3d0).multiplyScalar(0.28);
    for (let k = 0; k <= BLOCKS; k++) {
      const c = streetAt(k);
      for (let t = -HALF; t < HALF; t += 7) {
        const m = (t + HALF) % PITCH;
        if (m < STREET / 2 + 2 || m > PITCH - STREET / 2 - 2) continue;
        if (((t * 13 + k * 7) % 5 + 5) % 5 === 0) continue;      // worn away in places
        chunkAt(c, t).light.add(V3(c, 0.03, t + 1.5), V3(0.1, 0, 0), V3(0, 0, 1.4), FULL, paint);
        chunkAt(t, c).light.add(V3(t + 1.5, 0.03, c), V3(1.4, 0, 0), V3(0, 0, 0.1), FULL, paint);
      }
      for (let t = -HALF + PITCH / 2, i = 0; t < HALF; t += 32, i++) {
        const side = i % 2 ? 1 : -1;
        for (const vertical of [true, false]) {
          const x = vertical ? c + side * (STREET / 2 + 0.8) : t, z = vertical ? t : c + side * (STREET / 2 + 0.8);
          if (Math.abs(x) > HALF + 1 || Math.abs(z) > HALF + 1) continue;
          const chunk = chunkAt(x, z);
          chunk.solids.box(x - 0.09, 0.14, z - 0.09, x + 0.09, 7, z + 0.09, new THREE.Color(0x8b8f94));
          const hx = vertical ? x - side * 1.5 : x, hz = vertical ? z : z - side * 1.5;
          chunk.solids.box(Math.min(x, hx) - 0.07, 6.9, Math.min(z, hz) - 0.07, Math.max(x, hx) + 0.07, 7.05, Math.max(z, hz) + 0.07, new THREE.Color(0x8b8f94));
        }
      }
    }
    // the ring road's outer edge: a low painted kerb, red and white
    for (let t = -EDGE; t < EDGE; t += 4) {
      const col = new THREE.Color(Math.floor(t / 4) % 2 ? 0xd6342b : 0xf0ead9);
      for (const [x0, z0, x1, z1] of [[t, -EDGE - 0.6, t + 4, -EDGE], [t, EDGE, t + 4, EDGE + 0.6],
        [-EDGE - 0.6, t, -EDGE, t + 4], [EDGE, t, EDGE + 0.6, t + 4]]) {
        if (x0 === EDGE && z0 < BRIDGE_Z + BRIDGE_HALF && z1 > BRIDGE_Z - BRIDGE_HALF) continue;
        chunkAt((x0 + x1) / 2, (z0 + z1) / 2).solids.box(x0, 0, z0, x1, 0.35, z1, col);
      }
    }
  }

  // ── people ──────────────────────────────────────────────────────────────
  /** A few sellers, sat at whichever stalls are nearest the car. */
  private buildSellers(): void {
    const src = this.assets.passenger;
    if (!src) return;
    for (let k = 0; k < 4; k++) {
      const { root, clips, height } = AssetLibrary.cloneCharacter(src);
      root.scale.setScalar(1.55 / height);
      const body = new THREE.Group();
      body.add(root);
      body.visible = false;
      const mixer = new THREE.AnimationMixer(root);
      const sit = clips.find((c) => c.name === 'sit') ?? clips.find((c) => c.name === 'idle');
      if (sit) mixer.clipAction(sit).play();
      mixer.update(k * 0.7);
      this.group.add(body);
      this.sellers.push({ body, mixer, at: null });
    }
  }

  update(x: number, z: number, dt = 1 / 60): void {
    this.time += dt;
    for (const chunk of this.chunks) chunk.group.visible = Math.hypot(chunk.cx - x, chunk.cz - z) < SHOW_RADIUS;
    // fire flickers
    const f = 0.8 + Math.sin(this.time * 17) * 0.12 + Math.sin(this.time * 29) * 0.08;
    this.fireMat.opacity = f;
    // smoke rises and thins
    for (const s of this.smoke) {
      if (!s.sprite.parent?.visible) continue;
      s.t = (s.t + dt * 0.35) % 1;
      s.sprite.position.set(s.base.x + Math.sin(this.time + s.t * 5) * 0.2, s.base.y + s.t * 2.6, s.base.z);
      s.sprite.scale.setScalar(0.4 + s.t * 1.4);
      (s.sprite.material as THREE.SpriteMaterial).opacity = 0.45 * Math.sin(s.t * Math.PI);
    }
    // sellers sit at the four stalls nearest the car
    if (this.sellers.length && Math.floor(this.time * 2) !== Math.floor((this.time - dt) * 2)) {
      const near = [...this.stalls].sort((a, b) => Math.hypot(a.at.x - x, a.at.z - z) - Math.hypot(b.at.x - x, b.at.z - z)).slice(0, this.sellers.length);
      this.sellers.forEach((s, k) => {
        const stall = near[k];
        s.body.visible = !!stall && Math.hypot(stall.at.x - x, stall.at.z - z) < 150;
        if (stall) { s.body.position.copy(stall.at).setY(0.14); s.body.rotation.y = stall.face; }
      });
    }
    for (const s of this.sellers) if (s.body.visible) s.mixer.update(dt);
  }

  dispose(): void {
    for (const s of this.sellers) s.mixer.stopAllAction();
    // the sellers share the passenger model's geometry: leave theirs alone
    const shared = new Set<THREE.Object3D>();
    for (const s of this.sellers) s.body.traverse((o) => shared.add(o));
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !shared.has(o)) mesh.geometry.dispose();
    });
    for (const m of this.materials) {
      const std = m as THREE.MeshStandardMaterial;
      if (std.map && std.map !== tex?.wall && std.map !== tex?.boards && std.map !== tex?.road && std.map !== glow()) std.map.dispose();
      m.dispose();
    }
  }
}

