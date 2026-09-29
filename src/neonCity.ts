import * as THREE from 'three';
import { ROAD_HALF_WIDTH } from './constants';
import type { Track } from './track';

/**
 * Neon dressing for the night cities: lit signs on the facades, the glow
 * around them, and their smear on the wet road.
 *
 * Phones render without bloom, so "glow" cannot be left to a post pass. Every
 * sign gets an additive halo quad and a streak on the tarmac instead — flat
 * geometry that costs a couple of draws per sector however many signs there
 * are. On desktop bloom lands on top of it.
 *
 * Everything is collected as plain quads per 60 m sector and built into two
 * meshes per sector: the signs (one shared atlas) and the light (one additive
 * material, tinted per vertex). It never goes through batchEnvironment, which
 * would bake ambient occlusion over the tint and make the halos cast shadows.
 */

export const NEON_PALETTE = [0xff2e9a, 0x22e6ff, 0xa36bff, 0xffb23a, 0x9dff5a, 0xff4a4a, 0xff7ad9, 0xcfe8ff];

// Horizontal boards: Latin and short Japanese words. Vertical blades: kana and
// kanji stacked one per line, the shape a street full of signs actually has.
const WORDS = ['BAR', 'HOTEL', 'NOODLE', 'CLUB', '24H', 'RAMEN', 'SUSHI', 'KARAOKE',
  'ARCADE', 'LIVE', 'OPEN', 'MOTEL', 'RUSH', 'カフェ', '寿司屋', 'ラーメン'];
const BLADES = ['ホテル', '居酒屋', 'ラーメン', '電気街', 'カラオケ', '夜の街', '酒場', 'パチンコ'];

const ATLAS = 1024;
const H_CELL = { w: 256, h: 128, cols: 4, rows: 4 };  // top half
const V_CELL = { w: 128, h: 512, cols: 8 };           // bottom half

interface SignCell { u0: number; v0: number; u1: number; v1: number; color: number }

let atlas: { texture: THREE.CanvasTexture; words: SignCell[]; blades: SignCell[] } | null = null;
let glowTexture: THREE.CanvasTexture | null = null;

const FONT = '"Hiragino Sans","Noto Sans CJK JP","Yu Gothic","Meiryo","Arial Black",sans-serif';

function css(color: number, alpha = 1): string {
  const c = new THREE.Color(color);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${alpha})`;
}

/** Draw one sign into its cell: dark backing board, neon border, tube lettering. */
function drawSign(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
  text: string, color: number, vertical: boolean): void {
  const pad = 6;
  ctx.save();
  ctx.fillStyle = '#07060d';
  ctx.fillRect(x + pad, y + pad, w - pad * 2, h - pad * 2);
  // border tube
  ctx.shadowColor = css(color);
  ctx.shadowBlur = 12;
  ctx.strokeStyle = css(color);
  ctx.lineWidth = 4;
  ctx.strokeRect(x + pad + 7, y + pad + 7, w - pad * 2 - 14, h - pad * 2 - 14);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const glyphs = vertical ? [...text] : [text];
  const room = vertical ? (h - 60) / glyphs.length : h - 44;
  let size = Math.floor(vertical ? Math.min(room * 0.86, w - 40) : room);
  ctx.font = `900 ${size}px ${FONT}`;
  if (!vertical) {
    // shrink long words to fit the board
    const measured = ctx.measureText(text).width;
    const fit = w - 44;
    if (measured > fit) size = Math.floor(size * fit / measured);
    ctx.font = `900 ${size}px ${FONT}`;
  }
  glyphs.forEach((glyph, i) => {
    const gx = x + w / 2;
    const gy = vertical ? y + 30 + room * (i + 0.5) : y + h / 2 + 2;
    // wide coloured tube with its glow, then the white-hot core
    ctx.shadowBlur = 16;
    ctx.lineWidth = Math.max(3, size * 0.09);
    ctx.strokeStyle = css(color);
    ctx.strokeText(glyph, gx, gy);
    ctx.shadowBlur = 6;
    ctx.fillStyle = css(new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.55).getHex());
    ctx.fillText(glyph, gx, gy);
  });
  ctx.restore();
}

export function signAtlas(): NonNullable<typeof atlas> {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#07060d';
  ctx.fillRect(0, 0, ATLAS, ATLAS);
  const words: SignCell[] = [], blades: SignCell[] = [];
  WORDS.forEach((word, i) => {
    const col = i % H_CELL.cols, row = Math.floor(i / H_CELL.cols);
    const x = col * H_CELL.w, y = row * H_CELL.h;
    const color = NEON_PALETTE[(i * 3) % NEON_PALETTE.length];
    drawSign(ctx, x, y, H_CELL.w, H_CELL.h, word, color, false);
    words.push({ u0: x / ATLAS, u1: (x + H_CELL.w) / ATLAS,
      v0: 1 - (y + H_CELL.h) / ATLAS, v1: 1 - y / ATLAS, color });
  });
  BLADES.forEach((word, i) => {
    const x = i * V_CELL.w, y = ATLAS / 2;
    const color = NEON_PALETTE[(i * 5 + 1) % NEON_PALETTE.length];
    drawSign(ctx, x, y, V_CELL.w, V_CELL.h, word, color, true);
    blades.push({ u0: x / ATLAS, u1: (x + V_CELL.w) / ATLAS,
      v0: 1 - (y + V_CELL.h) / ATLAS, v1: 1 - y / ATLAS, color });
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  atlas = { texture, words, blades };
  return atlas;
}

/** Soft round falloff; stretched by its quad it is a halo, a streak or a pool. */
export function glow(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowTexture = new THREE.CanvasTexture(canvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

/** Quad soup for one layer of one sector. */
export class Quads {
  readonly pos: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];

  /** centre ± right ± up; uv rect and a linear-space tint. */
  add(c: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3,
    uv: [number, number, number, number], tint: THREE.Color): void {
    const [u0, v0, u1, v1] = uv;
    const corners: [number, number, number, number][] = [
      [-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1],
      [-1, -1, u0, v0], [1, 1, u1, v1], [-1, 1, u0, v1]
    ];
    for (const [a, b, u, v] of corners) {
      this.pos.push(c.x + right.x * a + up.x * b, c.y + right.y * a + up.y * b, c.z + right.z * a + up.z * b);
      this.uv.push(u, v);
      this.col.push(tint.r, tint.g, tint.b);
    }
  }

  mesh(material: THREE.Material): THREE.Mesh | null {
    if (!this.pos.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }
}

const FULL: [number, number, number, number] = [0, 0, 1, 1];
const UP = new THREE.Vector3(0, 1, 0);
const SECTOR = 60;

export interface NeonPlaced { s: number; obj: THREE.Object3D }

export class NeonDressing {
  private sectors = new Map<number, { signs: Quads; light: Quads }>();
  private readonly signMat: THREE.MeshBasicMaterial;
  private readonly lightMat: THREE.MeshBasicMaterial;

  constructor(private track: Track, private rand: () => number) {
    const { texture } = signAtlas();
    // > 1 so the tubes clear the bloom threshold where there is bloom, and
    // stay the brightest thing in frame where there is not.
    this.signMat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide,
      color: new THREE.Color(1.25, 1.25, 1.25) });
    this.lightMat = new THREE.MeshBasicMaterial({ map: glow(), vertexColors: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, fog: false });
  }

  private sector(s: number) {
    const index = Math.floor(this.track.wrap(s) / SECTOR);
    let sector = this.sectors.get(index);
    if (!sector) {
      sector = { signs: new Quads(), light: new Quads() };
      this.sectors.set(index, sector);
    }
    return sector;
  }

  /** Point at (s, lateral, y) plus the road's forward and lateral unit vectors. */
  private basis(s: number, lateral: number, y: number) {
    const f = this.track.frame(s);
    const a = this.track.frame(s - 0.5), b = this.track.frame(s + 0.5);
    const forward = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
    const normal = new THREE.Vector3(f.nx, 0, f.nz);
    const at = new THREE.Vector3(f.x + f.nx * lateral, y, f.z + f.nz * lateral);
    return { at, forward, normal };
  }

  /** Streak of a light source across the wet tarmac, on the source's side. */
  private reflect(s: number, side: number, color: THREE.Color, height: number, strength = 0.2): void {
    const length = 5 + height * 0.55;
    // the smear lands nearer to you than the light that makes it
    const { at, forward, normal } = this.basis(s - length * 0.35, side * (ROAD_HALF_WIDTH - 1.1), 0.045);
    const right = normal.clone().multiplyScalar(0.9);
    const along = forward.clone().multiplyScalar(length / 2);
    // lay the quad flat: "up" runs along the road
    this.sector(s).light.add(at, right, along, FULL, color.clone().multiplyScalar(strength));
  }

  /**
   * Dress one facade. `front` is its distance from the road centre, `height`
   * the building's height; signs never go above the roofline.
   */
  facade(s: number, side: number, front: number, height: number, width: number): void {
    const { words, blades } = signAtlas();
    const rand = this.rand;
    const sector = this.sector(s);
    // A hanging blade sign: sticks out of the wall, faces down the street.
    if (height > 9 && rand() < 0.8) {
      const cell = blades[Math.floor(rand() * blades.length)];
      const w = 1.3, h = Math.min(height * 0.5, 5.2 + rand() * 2.2);
      const y = Math.min(height - h / 2 - 0.6, 4.4 + h / 2 + rand() * 3);
      const along = (rand() - 0.5) * width * 0.6;
      const { at, forward, normal } = this.basis(s + along, side * (front - 1.0), y);
      const right = new THREE.Vector3().crossVectors(forward, UP).normalize().multiplyScalar(w / 2);
      const up = UP.clone().multiplyScalar(h / 2);
      sector.signs.add(at, right, up, [cell.u0, cell.v0, cell.u1, cell.v1], new THREE.Color(1, 1, 1));
      const tint = new THREE.Color(cell.color);
      // halo just behind the board, spill on the wall, and its reflection
      const halo = at.clone().addScaledVector(forward, 0.12);
      sector.light.add(halo, right.clone().multiplyScalar(2.6), up.clone().multiplyScalar(1.45), FULL,
        tint.clone().multiplyScalar(0.275));
      const spill = at.clone().addScaledVector(normal, side * 0.9);
      const wallRight = forward.clone().multiplyScalar(2.2);
      sector.light.add(spill, wallRight, up.clone().multiplyScalar(1.3), FULL, tint.clone().multiplyScalar(0.15));
      this.reflect(s + along, side, tint, y);
    }
    // A board flat on the wall, facing the road, over the shopfront.
    if (rand() < 0.75) {
      const cell = words[Math.floor(rand() * words.length)];
      const w = Math.min(width * 0.7, 3.4 + rand() * 1.6), h = w / 2;
      const y = 3.6 + h / 2 + rand() * Math.max(0, Math.min(height - 8, 6));
      const along = (rand() - 0.5) * width * 0.4;
      const { at, normal } = this.basis(s + along, side * (front - 0.12), y);
      const facing = normal.clone().multiplyScalar(side); // from the road into the wall
      const right = new THREE.Vector3().crossVectors(facing, UP).normalize().multiplyScalar(w / 2);
      const up = UP.clone().multiplyScalar(h / 2);
      sector.signs.add(at, right, up, [cell.u0, cell.v0, cell.u1, cell.v1], new THREE.Color(1, 1, 1));
      const tint = new THREE.Color(cell.color);
      const halo = at.clone().addScaledVector(facing, 0.06);
      sector.light.add(halo, right.clone().multiplyScalar(1.7), up.clone().multiplyScalar(2.1), FULL,
        tint.clone().multiplyScalar(0.21));
      this.reflect(s + along, side, tint, y, 0.16);
    }
    // Shopfront glow at street level.
    if (rand() < 0.7) {
      const tint = new THREE.Color(NEON_PALETTE[Math.floor(rand() * NEON_PALETTE.length)]);
      const { at, forward } = this.basis(s, side * (front - 0.3), 1.5);
      sector.light.add(at, forward.clone().multiplyScalar(width * 0.45), UP.clone().multiplyScalar(1.6), FULL,
        tint.clone().multiplyScalar(0.17));
      const floor = this.basis(s, side * (front - 2.2), 0.05);
      sector.light.add(floor.at, floor.forward.clone().multiplyScalar(width * 0.4),
        floor.normal.clone().multiplyScalar(1.8), FULL, tint.clone().multiplyScalar(0.11));
    }
  }

  /** A streetlamp's head glow and the pool of light it throws on the road. */
  lamp(s: number, side: number): void {
    const tint = new THREE.Color(0xcfe0ff);
    const head = this.basis(s, side * 7.7, 6.45);
    this.sector(s).light.add(head.at, new THREE.Vector3().crossVectors(head.forward, UP).multiplyScalar(1.3),
      UP.clone().multiplyScalar(1.3), FULL, tint.clone().multiplyScalar(0.35));
    const pool = this.basis(s, side * (ROAD_HALF_WIDTH - 1.6), 0.05);
    this.sector(s).light.add(pool.at, pool.normal.clone().multiplyScalar(3.2),
      pool.forward.clone().multiplyScalar(4.6), FULL, new THREE.Color(0x8ea6d8).multiplyScalar(0.14));
  }

  /** The neon gantries that span the road: glow the tubes and their reflections. */
  portal(s: number): void {
    const sector = this.sector(s);
    const cyan = new THREE.Color(0x44dacc), pink = new THREE.Color(0xef61ae);
    for (const side of [-1, 1]) {
      const post = this.basis(s, side * 6.9, 4.5);
      sector.light.add(post.at, new THREE.Vector3().crossVectors(post.forward, UP).multiplyScalar(1.4),
        UP.clone().multiplyScalar(5.5), FULL, cyan.clone().multiplyScalar(0.225));
      this.reflect(s, side, cyan, 7, 0.24);
    }
    const top = this.basis(s, 0, 8.7);
    sector.light.add(top.at, top.normal.clone().multiplyScalar(8.5), UP.clone().multiplyScalar(1.5), FULL,
      pink.clone().multiplyScalar(0.25));
    const pool = this.basis(s - 3, 0, 0.05);
    sector.light.add(pool.at, pool.normal.clone().multiplyScalar(4.5), pool.forward.clone().multiplyScalar(6),
      FULL, pink.clone().multiplyScalar(0.11));
  }

  /** Build the sector meshes. Each entry is shown and hidden by the scenery window. */
  build(): NeonPlaced[] {
    const out: NeonPlaced[] = [];
    for (const [index, sector] of this.sectors) {
      const group = new THREE.Group();
      const signs = sector.signs.mesh(this.signMat);
      const light = sector.light.mesh(this.lightMat);
      if (signs) group.add(signs);
      if (light) {
        light.renderOrder = 2; // after the opaque world, like every additive
        group.add(light);
      }
      out.push({ s: index * SECTOR + SECTOR / 2, obj: group });
    }
    return out;
  }

  dispose(): void {
    // the atlas and glow textures are shared across races
    this.signMat.dispose();
    this.lightMat.dispose();
  }
}

/** The shared atlas and glow textures are kept; the dispose sweep must skip them. */
export function isSharedNeonTexture(texture: THREE.Texture | null | undefined): boolean {
  return !!texture && (texture === atlas?.texture || texture === glowTexture);
}

let puddles: THREE.CanvasTexture | null = null;
/**
 * Roughness for wet asphalt: mostly glossy, with drier patches and standing
 * water. Green channel is what three reads for roughness.
 */
export function puddleRoughness(): THREE.CanvasTexture {
  if (puddles) return puddles;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgb(0,120,0)';
  ctx.fillRect(0, 0, 256, 256);
  let seed = 0x70756464;
  const rand = () => {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822507) >>> 0;
    seed = Math.imul(seed ^ (seed >>> 13), 3266489909) >>> 0;
    return ((seed ^= seed >>> 16) >>> 0) / 4294967296;
  };
  // Many small soft patches that overlap into irregular shapes. A few big
  // round ones read as painted ovals once perspective stretches them.
  for (let i = 0; i < 260; i++) {
    const x = rand() * 256, y = rand() * 256, r = 3 + rand() * rand() * 16;
    const wet = rand() < 0.6;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, wet ? 'rgba(0,30,0,0.55)' : 'rgba(0,190,0,0.35)');
    g.addColorStop(1, wet ? 'rgba(0,30,0,0)' : 'rgba(0,190,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, r * (0.5 + rand() * 0.8), r, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  puddles = new THREE.CanvasTexture(canvas);
  puddles.wrapS = puddles.wrapT = THREE.RepeatWrapping;
  return puddles;
}
