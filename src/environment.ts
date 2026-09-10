import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Flavor, MapSpec } from './maps';
import { mulberry32 } from './meshes';

/** One art direction per location. Districts share light, scale and materials. */
export interface EnvironmentTheme {
  id: string;
  sky: number; horizon: number; fog: number; ground: number;
  pavement: number; facade: number[]; accent: number; foliage: number; rock: number;
  water: number; night: boolean; coast: boolean;
  landscape: 'city' | 'mountains' | 'forest' | 'desert' | 'stadium';
}

const DAY: EnvironmentTheme = {
  id: 'lagos',
  sky: 0x75acc2, horizon: 0xffdfac, fog: 0xd8c2a0, ground: 0x727c55,
  pavement: 0xcab38b, facade: [0xdab97c, 0xcea062, 0xe5d3aa, 0xcfc6ab],
  accent: 0x326f68, foliage: 0x54764a, rock: 0x849087, water: 0x538d94,
  night: false, coast: false, landscape: 'city'
};

const THEMES: Record<string, Partial<EnvironmentTheme>> = {
  lagos: { coast: true, sky: 0x78afcb, horizon: 0xe6e6d5, fog: 0xbdcdd0,
    ground: 0x65754c, pavement: 0xbfc2af, foliage: 0x47643e, water: 0x397f8d,
    facade: [0xd5c9ad, 0xb6c6c1, 0xddd8c6, 0xacae99], accent: 0x306d63 },
  beijing: { sky: 0x849fae, horizon: 0xedcfae, fog: 0xb7ada0,
    facade: [0xaaa296, 0xc3b7a0, 0x8b9595], accent: 0xa34234, pavement: 0xb4afa3 },
  mumbai: { coast: true, sky: 0x79b4c7, facade: [0xd7b28a, 0xe0c9a1, 0xbb9c8e, 0xa5b6a7], accent: 0x3d7f80 },
  neon: { night: true, sky: 0x101a32, horizon: 0x4f476a, fog: 0x3c465c,
    ground: 0x252e3b, pavement: 0x576373, facade: [0x47566b, 0x5a526e, 0x38475d], accent: 0x47dcd2, foliage: 0x3c686b },
  london: { sky: 0x889eae, horizon: 0xd8d9cb, fog: 0xaeb9b9, pavement: 0xb2b2a8,
    facade: [0x94766b, 0xa48a77, 0x7d8588], accent: 0x375849, foliage: 0x496448, ground: 0x5e7058 },
  tokyo: { night: true, sky: 0x172a48, horizon: 0x7d7184, fog: 0x62697e,
    pavement: 0x697584, facade: [0x87939c, 0x747988, 0xa4989b], accent: 0xf27d98, ground: 0x3e514e },
  rio: { coast: true, sky: 0x61afcd, horizon: 0xffdda5, foliage: 0x487443,
    facade: [0xdbb461, 0xcf8472, 0x83b7af, 0xd1c6a0], accent: 0x427b69 },
  cairo: { sky: 0x8bb3c5, horizon: 0xf3d6a4, fog: 0xc9b18b, ground: 0xc1a57a,
    pavement: 0xd3bb93, facade: [0xccab7a, 0xddc79e, 0xb69771], accent: 0x58858a, landscape: 'desert' },
  nairobi: { sky: 0x8ab7ca, horizon: 0xf3dfb4, ground: 0x8a9060,
    facade: [0xbb9c7c, 0xd4c7a5, 0x8ca8a3], foliage: 0x667e42, accent: 0x587b67 },
  seoul: { night: true, sky: 0x1f2948, horizon: 0x867084, fog: 0x625a76,
    ground: 0x384447, pavement: 0x747583, facade: [0x829097, 0xa0a1aa, 0x626b83], accent: 0x78e5d0 },
  accra: { coast: true, facade: [0xd7ad70, 0xc98563, 0xe4cd98, 0x91aaa0], accent: 0x386d65 },
  saopaulo: { sky: 0x93aebe, horizon: 0xe9d5bc, fog: 0xa8b0b2,
    facade: [0xa0a7a7, 0xc2b9a9, 0x8c969e], pavement: 0xb3b4a9, accent: 0xb65c62 },
  norway: { sky: 0x455f83, horizon: 0xc9a391, fog: 0x8b96a1, ground: 0x586e60,
    pavement: 0x8e968d, foliage: 0x355c50, rock: 0x7d8788, facade: [0x925f4f, 0xbaa78d], accent: 0x9fb8b7,
    water: 0x577e91, landscape: 'mountains' },
  iceland: { sky: 0x8faec2, horizon: 0xe5edf0, fog: 0xb2c7d0, ground: 0x697b77,
    pavement: 0xb6c4c4, rock: 0x4a5d64, facade: [0x687c83, 0x91a7ae, 0xb8ced1], foliage: 0x61766a,
    accent: 0xe5ba6d, landscape: 'mountains' },
  canada: { sky: 0x80afc4, horizon: 0xdce4bf, fog: 0xa3bba9, ground: 0x536c48,
    pavement: 0x999d82, foliage: 0x345c47, facade: [0x91725a, 0xa38968], accent: 0x944e40, landscape: 'forest' },
  newzealand: { coast: true, sky: 0x70b8d3, horizon: 0xe3efd3, fog: 0xa5c3bd,
    ground: 0x6f9557, foliage: 0x4d794c, pavement: 0xb0b69a, landscape: 'mountains' },
  finland: { night: true, sky: 0x172c45, horizon: 0x627c91, fog: 0x536d7e,
    ground: 0xcadce2, pavement: 0xd4e3e7, foliage: 0x567b77, facade: [0x79624e, 0x9a8870],
    accent: 0xffd398, landscape: 'forest' },
  cartoonoval: { sky: 0x73bada, horizon: 0xe6eed8, fog: 0xb3cace, landscape: 'stadium',
    ground: 0x6a9857, accent: 0xd36d48, facade: [0xc8c9ba, 0x91a9b1] },
  cota: { sky: 0x88b7d0, horizon: 0xf0dfb8, fog: 0xc0c0ac, landscape: 'stadium',
    ground: 0x8b9561, accent: 0xb95548, facade: [0xb4b6ab, 0x929d9e] }
};

// hillside paint: kept saturated, then pulled toward the map's own facade tone
const FAVELA_PAINT = [0xe8564f, 0x3f9fd8, 0xe8b53a, 0x5cb96a, 0xdd7136, 0x8d64c4];

export function environmentTheme(map: MapSpec): EnvironmentTheme {
  return { ...DAY, ...THEMES[map.id], id: map.id };
}

/** A tiny sky cubemap provides soft sky reflections without external HDR assets. */
export function buildReflectionSky(theme: EnvironmentTheme): THREE.CubeTexture {
  const faces = Array.from({ length: 6 }, (_, i) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 64);
    gradient.addColorStop(0, new THREE.Color(i === 3 ? theme.ground : theme.sky).getStyle());
    gradient.addColorStop(1, new THREE.Color(i === 2 ? theme.sky : theme.horizon).getStyle());
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
    return canvas;
  });
  const texture = new THREE.CubeTexture(faces);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export const isRural = (flavor: Flavor): boolean =>
  ['park', 'conifers', 'rocks', 'cabins', 'pyramids'].includes(flavor);

/** Shared primitives/materials; scenery batches these into small track sectors. */
export class EnvironmentKit {
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private boxGeo = new THREE.BoxGeometry(1, 1, 1);
  private coneGeo = new THREE.ConeGeometry(1, 1, 7);
  private roofGeo = new THREE.ConeGeometry(1, 1, 4);
  private rockGeo = new THREE.IcosahedronGeometry(1, 0);
  private canopyGeo = new THREE.IcosahedronGeometry(1, 1);
  private shaftGeo = new THREE.CylinderGeometry(0.55, 1, 1, 4);
  private leafGeo = new THREE.BufferGeometry();
  private stucco: THREE.CanvasTexture;
  constructor(readonly theme: EnvironmentTheme) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!, rand = mulberry32(0x77616c6c);
    ctx.fillStyle = '#f5f3ed'; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 7000; i++) {
      ctx.fillStyle = rand() < 0.5 ? 'rgba(80,70,50,0.045)' : 'rgba(255,255,255,0.15)';
      ctx.fillRect(rand() * 256, rand() * 256, 1, 1);
    }
    this.stucco = new THREE.CanvasTexture(canvas);
    this.stucco.colorSpace = THREE.SRGBColorSpace;
    this.leafGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, -0.18, 0.36, 0.34, 0, 0.48, 0.4, 0.18, 0.36, 0.34, 0, 0.65, 0.95
    ], 3));
    this.leafGeo.setIndex([0, 1, 2, 0, 2, 3, 1, 4, 2, 2, 4, 3, 2, 1, 0, 3, 2, 0, 2, 4, 1, 3, 4, 2]);
    this.leafGeo.computeVertexNormals();
  }

  material(color: number, glow = false): THREE.MeshStandardMaterial {
    const key = `${color}/${glow}`;
    let material = this.materials.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color, roughness: 0.86,
        ...(glow ? { emissive: color, emissiveIntensity: 0.65 } : {}) });
      this.materials.set(key, material);
    }
    return material;
  }

  box(g: THREE.Group, x: number, y: number, z: number, w: number, h: number, d: number,
    color: number, glow = false): THREE.Mesh {
    const mesh = new THREE.Mesh(this.boxGeo, this.material(color, glow));
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    g.add(mesh);
    return mesh;
  }

  building(rand: () => number, tall = false): THREE.Group {
    const g = new THREE.Group(), t = this.theme;
    const w = 7.2 + rand() * 5.4, d = 6.8 + rand() * 3.4;
    const floors = tall ? 5 + Math.floor(rand() * 7) : 2 + Math.floor(rand() * 5);
    const floorH = 2.9 + rand() * 0.5, h = floors * floorH;
    g.userData.dimensions = { w, h, d };
    const wall = t.facade[Math.floor(rand() * t.facade.length)];
    const trim = new THREE.Color(wall).multiplyScalar(0.85).getHex();
    for (const color of [wall, trim]) {
      const material = this.material(color);
      material.map = this.stucco;
      material.bumpMap = this.stucco;
      material.bumpScale = 0.015;
    }
    const recess = new THREE.Color(wall).multiplyScalar(0.36).getHex();
    const glass = t.night ? 0x243849 : 0x344340;
    const balcony = !tall && rand() > 0.35;
    // A recessed core and real facade piers make openings have depth, rather than
    // painting dark rectangles onto a solid box. All dimensions are in metres.
    this.box(g, 0, h / 2, 0, w, h, d - 1.15, wall);
    this.box(g, 0, 0.2, 0, w + 0.2, 0.4, d + 0.1, trim);
    const bayW = w / 3;
    for (const side of [-1, 1]) {
      const front = side * d / 2;
      for (let col = 0; col < 4; col++) {
        this.box(g, -w / 2 + col * bayW, h / 2, front - side * 0.12, 0.42, h, 0.65, wall);
      }
      for (let floor = 0; floor < floors; floor++) {
        const base = floor * floorH;
        this.box(g, 0, base + 0.22, front - side * 0.08, w, 0.44, 0.72, wall);
        for (let col = -1; col <= 1; col++) {
          const x = col * bayW;
          const lit = t.night && rand() < 0.32;
          this.box(g, x, base + 1.7, front - side * 0.48, bayW - 0.42, 2.55, 0.1, recess);
          this.box(g, x, base + 1.65, front - side * 0.43, bayW - 0.88, 2.1, 0.08,
            lit ? 0xffd99b : glass, lit);
          this.box(g, x, base + 1.65, front - side * 0.35, 0.065, 2.13, 0.09, 0x625f4e);
          this.box(g, x, base + 0.59, front - side * 0.17, bayW - 0.75, 0.15, 0.68, trim);
          this.box(g, x, base + 2.76, front - side * 0.15, bayW - 0.7, 0.16, 0.55, wall);
          if (floor > 0 && balcony && (col === 0 || floor % 2 === 1)) {
            const z = front + side * 0.63;
            this.box(g, x, base + 0.35, z, bayW - 0.2, 0.18, 1.6, trim);
            this.box(g, x, base + 1.25, z + side * 0.67, bayW - 0.3, 0.075, 0.08, 0x4b5146);
            this.box(g, x, base + 0.65, z + side * 0.67, bayW - 0.3, 0.065, 0.08, 0x4b5146);
            for (let rail = 0; rail < 7; rail++) {
              this.box(g, x - bayW * 0.43 + rail * bayW * 0.143, base + 0.86,
                z + side * 0.67, 0.045, 0.8, 0.05, 0x4b5146);
            }
          }
          if (floor === 0) {
            const awning = this.box(g, x, 2.78, front + side * 0.72,
              bayW - 0.16, 0.10, 1.9, t.accent);
            awning.rotation.x = side * 0.23;
            this.box(g, x, 2.54, front + side * 1.64, bayW - 0.16, 0.2, 0.065, t.accent);
            for (const edge of [-1, 1]) {
              this.box(g, x + edge * (bayW / 2 - 0.16), 1.45, front + side * 0.25,
                0.21, 2.9, 0.4, wall);
            }
          }
        }
      }
      this.box(g, 0, h + 0.2, front, w + 0.7, 0.3, 0.85, trim);
      this.box(g, 0, h + 0.55, front - side * 0.12, w + 0.3, 0.6, 0.35, wall);
    }
    for (const side of [-1, 1]) {
      for (let floor = 1; floor < floors; floor++) {
        for (const z of [-d * 0.23, d * 0.23]) {
          this.box(g, side * (w / 2 + 0.025), floor * floorH + 1.7, z, 0.08, 1.9, 1.3, glass);
          this.box(g, side * (w / 2 + 0.1), floor * floorH + 0.7, z, 0.25, 0.14, 1.6, trim);
        }
      }
      this.box(g, side * w / 2, h + 0.4, 0, 0.35, 0.85, d, wall);
    }
    this.box(g, 0, h + 0.02, 0, w - 0.4, 0.12, d - 0.4, trim);
    this.box(g, w * 0.25, h + 0.6, 0, 1.5, 1.1, 1.9, 0xa7a69a);
    if (tall) this.box(g, 0, h + 1.1, 0, w * 0.5, 2.0, d * 0.5, wall);
    return g;
  }

  terrace(rand: () => number): THREE.Group {
    const g = this.building(rand), { w, h, d } = g.userData.dimensions;
    const roof = new THREE.Mesh(this.roofGeo, this.material(0x424f58));
    roof.position.y = h + 0.8;
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(w * 0.78, 1.7, d * 0.78);
    g.add(roof);
    this.box(g, w * 0.28, h + 1.4, 0, 0.65, 1.8, 0.75, this.theme.facade[0]);
    return g;
  }

  planter(rand: () => number, wide = false): THREE.Group {
    const g = new THREE.Group(), w = wide ? 2.8 : 1.8, d = wide ? 2.8 : 2.1;
    const stone = this.theme.pavement;
    this.box(g, 0, 0.15, 0, w, 0.3, d, stone);
    this.box(g, 0, 0.38, 0, w - 0.24, 0.15, d - 0.24, 0x4e5140);
    for (const side of [-1, 1]) {
      this.box(g, side * (w / 2 - 0.08), 0.34, 0, 0.16, 0.6, d, stone);
      this.box(g, 0, 0.34, side * (d / 2 - 0.08), w, 0.6, 0.16, stone);
    }
    for (let clump = 0; clump < (wide ? 4 : 3); clump++) {
      const x = (rand() - 0.5) * (w - 0.65), z = (rand() - 0.5) * (d - 0.65);
      for (let i = 0; i < 7; i++) {
        const leaf = new THREE.Mesh(this.leafGeo, this.material(this.theme.foliage));
        leaf.position.set(x, 0.4, z);
        leaf.rotation.y = i / 7 * Math.PI * 2 + rand();
        leaf.scale.setScalar(0.55 + rand() * 0.55);
        g.add(leaf);
      }
    }
    return g;
  }

  pine(rand: () => number): THREE.Group {
    const g = new THREE.Group(), h = 5 + rand() * 5;
    this.box(g, 0, h * 0.25, 0, 0.3, h * 0.5, 0.3, 0x715b48);
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(this.coneGeo, this.material(this.theme.foliage));
      mesh.position.y = h * (0.4 + i * 0.2);
      mesh.scale.set(h * (0.29 - i * 0.055), h * 0.55, h * (0.29 - i * 0.055));
      g.add(mesh);
      if (this.theme.id === 'finland') {
        const snow = new THREE.Mesh(this.coneGeo, this.material(0xe1eef0));
        snow.position.y = mesh.position.y + h * 0.09;
        snow.scale.copy(mesh.scale).multiplyScalar(0.76);
        g.add(snow);
      }
    }
    return g;
  }

  rock(rand: () => number, snow = false): THREE.Group {
    const g = new THREE.Group();
    const h = 2 + rand() * 5, w = 3 + rand() * 5;
    const mesh = new THREE.Mesh(this.rockGeo, this.material(this.theme.rock));
    mesh.position.y = h * 0.32;
    mesh.scale.set(w, h, w * 0.65);
    mesh.rotation.y = rand() * 6;
    g.add(mesh);
    if (snow) {
      const cap = new THREE.Mesh(this.rockGeo, this.material(0xd2e1df));
      cap.position.y = h * 0.85;
      cap.scale.set(w * 0.52, h * 0.3, w * 0.38);
      g.add(cap);
    }
    return g;
  }

  cabin(rand: () => number): THREE.Group {
    const g = new THREE.Group();
    const color = this.theme.facade[Math.floor(rand() * this.theme.facade.length)];
    this.box(g, 0, 0.18, 0, 7, 0.36, 6, this.theme.pavement);
    this.box(g, 0, 1.8, 0, 6, 3.4, 5, color);
    for (const side of [-1, 1]) {
      const roof = this.box(g, side * 1.65, 4.05, 0, 3.85, 0.22, 6, 0x3b4e53);
      roof.rotation.z = -side * 0.43;
      for (const x of [-1.65, 1.65]) {
        this.box(g, x, 2, side * 2.53, 1.25, 1.3, 0.1, 0xffd298, this.theme.night);
      }
      this.box(g, 0, 1.2, side * 2.54, 0.9, 2.3, 0.12, 0x384a45);
    }
    this.box(g, 1.6, 4.8, 0.5, 0.6, 1.6, 0.65, 0x747e7b);
    return g;
  }

  grandstand(): THREE.Group {
    const g = new THREE.Group();
    for (let row = 0; row < 5; row++) {
      const h = 0.7 + row * 0.65;
      this.box(g, 0, h / 2, -row * 1.05, 18, h, 1.05, this.theme.pavement);
      for (let seat = 0; seat < 16; seat++) {
        this.box(g, -8 + seat * 1.05, h + 0.15, -row * 1.05, 0.68, 0.3, 0.6,
          row % 2 ? this.theme.accent : 0x5c8194);
        this.box(g, -8 + seat * 1.05, h + 0.5, -row * 1.05 - 0.25, 0.68, 0.6, 0.12,
          row % 2 ? this.theme.accent : 0x5c8194);
      }
    }
    for (const x of [-8.5, 8.5]) this.box(g, x, 3.4, -2, 0.25, 6.8, 0.3, 0x586976);
    this.box(g, 0, 6.8, -2, 19, 0.28, 8, this.theme.pavement);
    return g;
  }

  lamp(): THREE.Group {
    const g = new THREE.Group();
    this.box(g, 0, 3.3, 0, 0.12, 6.6, 0.12, 0x46565b);
    this.box(g, 0, 6.6, -0.65, 0.16, 0.14, 1.4, 0x46565b);
    this.box(g, 0, 6.52, -1.15, 0.4, 0.08, 0.7, 0xffe5bc, true);
    return g;
  }

  /** Broadleaf tree: faceted canopy clumps over a tapered trunk. */
  tree(rand: () => number, autumn = false): THREE.Group {
    const g = new THREE.Group();
    const h = 2.6 + rand() * 2.2;
    const trunk = new THREE.Mesh(this.shaftGeo, this.material(0x6d5540));
    trunk.position.y = h / 2;
    trunk.scale.set(0.3, h, 0.3);
    g.add(trunk);
    const leaf = new THREE.Color(autumn ? [0xbf7139, 0xd79e46, 0xa75038][Math.floor(rand() * 3)] : this.theme.foliage);
    for (let i = 0; i < 3; i++) {
      const r = (1.5 + rand() * 0.7) * (i === 0 ? 1 : 0.62);
      const canopy = new THREE.Mesh(this.canopyGeo,
        this.material(leaf.clone().multiplyScalar(0.8 + i * 0.1).getHex()));
      const a = rand() * Math.PI * 2;
      canopy.position.set(i === 0 ? 0 : Math.cos(a) * r * 0.8,
        h + r * (i === 0 ? 0.55 : 0.15), i === 0 ? 0 : Math.sin(a) * r * 0.8);
      canopy.scale.set(r, r * 0.82, r);
      canopy.rotation.y = rand() * 3;
      g.add(canopy);
    }
    return g;
  }

  /**
   * Hillside stack: mismatched painted boxes under corrugated roofs. The paint
   * stays vivid — that is the district — but is pulled toward the map's own
   * facade tone so it belongs to the same street as its neighbours.
   */
  favelaHouse(rand: () => number): THREE.Group {
    const g = new THREE.Group(), t = this.theme;
    const tiers = 2 + Math.floor(rand() * 2);
    let base = 0;
    for (let i = 0; i < tiers; i++) {
      const w = (tiers - i) * 2.2 + rand() * 1.5;
      const d = (tiers - i) * 2.2 + rand() * 1.5;
      const h = 2.3 + rand() * 0.7;
      const paint = new THREE.Color(FAVELA_PAINT[Math.floor(rand() * FAVELA_PAINT.length)])
        .lerp(new THREE.Color(t.facade[0]), 0.22).getHex();
      const x = rand() * 0.7 - 0.35, z = rand() * 0.7 - 0.35;
      this.box(g, x, base + h / 2, z, w, h, d, paint);
      for (let slat = 0; slat * 0.42 < w; slat++) {
        this.box(g, x - w / 2 + 0.21 + slat * 0.42, base + h + 0.06, z, 0.3, 0.1, d + 0.35, 0x8d9298);
      }
      // openings sit on the two faces the road can see, once placed
      for (const face of [-1, 1]) {
        const zf = z + face * d / 2;
        for (const wx of [-w * 0.26, w * 0.26]) {
          const lit = t.night && rand() < 0.4;
          this.box(g, x + wx, base + h * 0.62, zf, 0.85, 0.9, 0.09,
            lit ? 0xffd08a : 0x2b3a44, lit);
          this.box(g, x + wx, base + h * 0.62 + 0.5, zf + face * 0.04, 0.97, 0.09, 0.06, 0xdad3c4);
        }
        if (i === 0) this.box(g, x, base + 0.95, zf, 0.85, 1.9, 0.1, 0x5b4433);
      }
      base += h;
    }
    return g;
  }

  /** Street stall: timber counter under a striped awning in the local accent. */
  stall(rand: () => number): THREE.Group {
    const g = new THREE.Group(), t = this.theme;
    const w = 2.6 + rand() * 1.3;
    const awning = new THREE.Color(FAVELA_PAINT[Math.floor(rand() * FAVELA_PAINT.length)])
      .lerp(new THREE.Color(t.accent), 0.45).getHex();
    this.box(g, 0, 0.45, 0, w, 0.9, 1.25, 0x7a5a3a);
    this.box(g, 0, 0.94, 0, w + 0.16, 0.09, 1.4, 0xd9cfb8);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) this.box(g, sx * (w / 2 - 0.1), 1.15, sz * 0.58, 0.09, 2.3, 0.09, 0x4a3a28);
    }
    // alternating slats read as stripes from race distance
    for (let i = 0; i < 5; i++) {
      const slat = this.box(g, 0, 2.3 - i * 0.075, -0.62 + i * 0.42, w + 0.34, 0.07, 0.44,
        i % 2 ? 0xf2ead8 : awning);
      slat.rotation.x = 0.18;
    }
    for (let i = 0; i < 2 + Math.floor(rand() * 2); i++) {
      const crate = this.box(g, (rand() - 0.5) * (w - 0.6), 1.14, (rand() - 0.5) * 0.6,
        0.42, 0.32, 0.42, t.facade[Math.floor(rand() * t.facade.length)]);
      crate.rotation.y = rand();
    }
    return g;
  }

  /** Tiered timber house: deep overhanging eaves, lattice screens, gold ridge. */
  pagodaHouse(rand: () => number): THREE.Group {
    const g = new THREE.Group(), t = this.theme;
    const w = 5 + rand() * 3, d = 4.5 + rand() * 2, h = 2.6 + rand() * 1.2;
    const wall = t.facade[Math.floor(rand() * t.facade.length)];
    const timber = new THREE.Color(t.accent).lerp(new THREE.Color(0x3a2118), 0.35).getHex();
    const plinth = 0.36;
    this.box(g, 0, 0.18, 0, w + 0.9, 0.36, d + 0.9, t.pavement);
    this.box(g, 0, plinth + h / 2, 0, w, h, d, wall);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.box(g, sx * (w / 2 - 0.13), plinth + h / 2, sz * (d / 2), 0.3, h, 0.3, timber);
      }
    }
    for (const face of [-1, 1]) {
      const zf = face * (d / 2 + 0.02);
      const lit = t.night;
      this.box(g, 0, plinth + h * 0.5, zf, w * 0.44, h * 0.62, 0.08,
        lit ? 0xffdca6 : 0x3b3a33, lit);
      for (let bar = 0; bar < 5; bar++) {
        this.box(g, (bar - 2) * w * 0.088, plinth + h * 0.5, zf + face * 0.05,
          0.06, h * 0.62, 0.06, timber);
      }
      this.box(g, 0, plinth + h, zf, w + 0.2, 0.16, 0.24, timber);
    }
    // A four-sided cone turned 45° is an axis-aligned square of side span·√2.
    const tier = (y: number, span: number, deep: number, rise: number) => {
      const roof = new THREE.Mesh(this.roofGeo, this.material(0x3d4a55));
      roof.position.y = y + rise / 2;
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(span, rise, deep);
      g.add(roof);
      this.box(g, 0, y - 0.05, 0, span * 1.5, 0.18, deep * 1.5, timber);
    };
    const top = plinth + h;
    tier(top, w * 1.02, d * 1.02, 1.15 + rand() * 0.35);
    if (rand() < 0.45) {
      this.box(g, 0, top + 1.5 + h * 0.3, 0, w * 0.55, h * 0.6, d * 0.55, wall);
      tier(top + 1.5 + h * 0.6, w * 0.66, d * 0.66, 0.9);
      this.box(g, 0, top + 2.4 + h * 0.6, 0, 0.26, 0.55, 0.26, 0xd8a848);
    }
    return g;
  }

  /** Stepped sandstone mass — the ruin district's silhouette, no cel outline. */
  pyramid(rand: () => number): THREE.Group {
    const g = new THREE.Group();
    const base = 14 + rand() * 12, steps = 7 + Math.floor(rand() * 4);
    const h = base * (0.62 + rand() * 0.16);
    const stone = new THREE.Color(this.theme.pavement)
      .lerp(new THREE.Color(0xc9a469), 0.5).getHex();
    const shade = new THREE.Color(stone).multiplyScalar(0.9).getHex();
    for (let i = 0; i < steps; i++) {
      const w = base * (1 - (i / steps) * 0.94);
      this.box(g, 0, (h / steps) * (i + 0.5), 0, w, h / steps, w, i % 2 ? stone : shade);
    }
    return g;
  }

  /** Tapered pillar with a lit pyramidion cap. */
  obelisk(): THREE.Group {
    const g = new THREE.Group();
    const stone = new THREE.Color(this.theme.pavement)
      .lerp(new THREE.Color(0xb89868), 0.55).getHex();
    this.box(g, 0, 0.35, 0, 2.2, 0.7, 2.2, stone);
    const shaft = new THREE.Mesh(this.shaftGeo, this.material(stone));
    shaft.position.y = 6;
    shaft.scale.set(1, 10.6, 1);
    shaft.rotation.y = Math.PI / 4;
    g.add(shaft);
    const cap = new THREE.Mesh(this.roofGeo, this.material(0xffe93b, true));
    cap.position.y = 11.85;
    cap.scale.set(0.82, 1.4, 0.82);
    cap.rotation.y = Math.PI / 4;
    g.add(cap);
    return g;
  }

  dispose(): void {
    this.boxGeo.dispose(); this.coneGeo.dispose(); this.roofGeo.dispose(); this.rockGeo.dispose();
    this.canopyGeo.dispose(); this.shaftGeo.dispose(); this.leafGeo.dispose();
    this.stucco.dispose();
    for (const material of this.materials.values()) material.dispose();
  }
}

/**
 * Cheap sky occlusion, baked into vertex colours at merge time so it costs
 * nothing per frame — and unlike the shadow map it survives on the tier that
 * has no shadow pass at all. Two terms: geometry near the pavement sees less
 * sky, and downward-facing faces (balcony soffits, awning undersides, eaves)
 * see almost none. This is the darkening that makes things sit *in* the ground
 * rather than on top of it; a shadow map alone never does crevices.
 */
function bakeVertexAO(geometry: THREE.BufferGeometry, strength: number): void {
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    // Gentle on purpose: this is contact shading, not a shadow. Overdone it
    // turns every trunk and lower storey into a silhouette.
    const rise = THREE.MathUtils.clamp(pos.getY(i) / 5.5, 0, 1);
    const sky = 0.90 + 0.10 * Math.max(0, nor ? nor.getY(i) : 1);
    const ao = 1 - (1 - (0.84 + 0.16 * rise) * sky) * strength;
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = ao;
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

/** Flatten static geometry by material: a window-filled block costs a few draws. */
export function batchEnvironment(root: THREE.Group, aoStrength = 1): THREE.Group {
  root.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const canonical = new Map<string, THREE.Material>();
  const collect = (geometry: THREE.BufferGeometry, source: THREE.Material) => {
    bakeVertexAO(geometry, aoStrength);
    if (source instanceof THREE.MeshToonMaterial) {
      source = new THREE.MeshStandardMaterial({ color: source.color, map: source.map,
        emissive: source.emissive, emissiveIntensity: source.emissiveIntensity,
        transparent: source.transparent, opacity: source.opacity, alphaTest: source.alphaTest,
        side: source.side, fog: source.fog, roughness: 0.9 });
    }
    const m = source as THREE.MeshToonMaterial;
    const key = [m.type, m.color?.getHex(), m.emissive?.getHex(), m.emissiveIntensity,
      m.map?.uuid, m.side, m.transparent, m.opacity, m.alphaTest, m.depthWrite, m.fog, m.blending,
      (m as unknown as THREE.MeshStandardMaterial).roughness, (m as unknown as THREE.MeshStandardMaterial).metalness].join('/');
    const material = canonical.get(key) ?? source;
    canonical.set(key, material);
    const list = buckets.get(material) ?? [];
    list.push(geometry);
    buckets.set(material, list);
  };
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone())
      .applyMatrix4(mesh.matrixWorld);
    // Some handmade roofs have no UVs; all batch inputs need matching attributes.
    if (!geometry.getAttribute('uv')) {
      geometry.setAttribute('uv', new THREE.BufferAttribute(
        new Float32Array(geometry.getAttribute('position').count * 2), 2));
    }
    if (Array.isArray(mesh.material)) {
      // Row houses use a different material on each box face. Split groups before
      // batching so their walls survive alongside the single-material roofs.
      for (const part of geometry.groups) {
        const material = mesh.material[part.materialIndex ?? 0];
        if (!material) continue;
        const face = new THREE.BufferGeometry();
        for (const name of ['position', 'normal', 'uv']) {
          const attr = geometry.getAttribute(name) as THREE.BufferAttribute;
          face.setAttribute(name, new THREE.Float32BufferAttribute(
            attr.array.slice(part.start * attr.itemSize, (part.start + part.count) * attr.itemSize), attr.itemSize));
        }
        collect(face, material);
      }
      geometry.dispose();
    } else collect(geometry, mesh.material);
  });
  const group = new THREE.Group();
  for (const [material, geometries] of buckets) {
    const merged = mergeGeometries(geometries, false);
    if (merged) {
      const shaded = material.clone();
      shaded.vertexColors = true;
      const mesh = new THREE.Mesh(merged, shaded);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    for (const geometry of geometries) geometry.dispose();
  }
  return group;
}

/** Low-poly layered horizon; same palette and geometry language as the near field. */
export function buildHorizon(theme: EnvironmentTheme): THREE.Group {
  let seed = 0x70616e;
  for (const char of theme.id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  const root = new THREE.Group(), rand = mulberry32(seed);
  const mountains = ['mountains', 'desert', 'forest'].includes(theme.landscape) || theme.id === 'rio';
  if (mountains) {
    // Continuous layered ridges. The previous evenly spaced cones made every
    // country look like the same row of toy pyramids.
    for (let layer = 0; layer < 2; layer++) {
      const positions: number[] = [], colors: number[] = [], index: number[] = [];
      const n = 96, radius = 235 - layer * 28;
      const ground = new THREE.Color(theme.id === 'rio' || theme.id === 'newzealand' ? theme.foliage : theme.rock);
      const fog = new THREE.Color(theme.fog);
      for (let i = 0; i <= n; i++) {
        const a = i / n * Math.PI * 2;
        const waves = 0.45 + Math.sin(a * 3 + seed % 7) * 0.22 + Math.sin(a * 7 + layer) * 0.17 +
          Math.sin(a * 13) * (theme.id === 'newzealand' || theme.id === 'rio' ? 0.03 : 0.1);
        const amplitude = theme.id === 'norway' ? 74 : theme.id === 'iceland' ? 50 :
          theme.id === 'rio' ? 64 : theme.id === 'newzealand' ? 49 : theme.landscape === 'desert' ? 19 : 23;
        const height = 6 + waves * amplitude;
        for (const fraction of [0, 0.72, 1]) {
          positions.push(Math.cos(a) * radius, fraction ? height * fraction - 4 : -12, Math.sin(a) * radius);
          const color = ground.clone().lerp(fog, layer ? 0.5 : 0.77);
          if ((theme.id === 'norway' || theme.id === 'iceland') && fraction === 1) color.lerp(new THREE.Color(0xe1edef), 0.72);
          color.multiplyScalar(0.94 + Math.sin(a * 7) * 0.06);
          colors.push(color.r, color.g, color.b);
        }
        if (i) for (let band = 0; band < 2; band++) {
          const b = i * 3 + band, prev = b - 3;
          index.push(prev, b, prev + 1, b, b + 1, prev + 1);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(index);
      root.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true,
        side: THREE.DoubleSide, fog: false })));
    }
    if (theme.landscape === 'mountains' || theme.landscape === 'desert') return root;
  }
  const base = theme.landscape === 'city' || theme.landscape === 'stadium' ? theme.facade[0]
    : theme.landscape === 'forest' ? theme.foliage : theme.rock;
  const colors = [0.82, 0.62].map((mix) => new THREE.Color(base)
    .lerp(new THREE.Color(theme.fog), mix));
  for (let layer = 0; layer < 2; layer++) {
    const material = new THREE.MeshBasicMaterial({ color: colors[layer], fog: false, vertexColors: true });
    const prototype = theme.landscape === 'city' || theme.landscape === 'stadium'
      ? new THREE.BoxGeometry(1, 1, 1)
      : new THREE.ConeGeometry(1, 1, theme.landscape === 'forest' ? 5 : 6);
    const normals = prototype.getAttribute('normal');
    const vertexColors: number[] = [];
    for (let i = 0; i < normals.count; i++) {
      const shade = 0.86 + Math.max(0, normals.getX(i) * 0.7 + normals.getZ(i) * 0.5) * 0.14;
      vertexColors.push(shade, shade, shade);
    }
    prototype.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 3));
    const count = theme.id === 'rio' ? 45 : theme.landscape === 'city' ? 110 : 65;
    const instances = new THREE.InstancedMesh(prototype, material, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2;
      const r = layer === 0 ? 224 : 193;
      const mountain = theme.landscape === 'mountains' || theme.landscape === 'desert';
      const cityHeight = theme.id === 'neon' || theme.id === 'seoul' ? 65 :
        theme.id === 'london' || theme.id === 'accra' ? 24 : 42;
      const h = mountain ? 16 + rand() * 35 : theme.landscape === 'forest' ? 6 + rand() * 13 :
        theme.landscape === 'stadium' ? 3 + rand() * 8 : 7 + rand() * rand() * cityHeight;
      const w = mountain ? 28 + rand() * 30 : 4 + rand() * 9;
      dummy.position.set(Math.cos(angle) * r, h / 2 - 9, Math.sin(angle) * r);
      dummy.scale.set(w, h, w * 0.7);
      dummy.rotation.y = angle;
      dummy.updateMatrix();
      instances.setMatrixAt(i, dummy.matrix);
    }
    instances.instanceMatrix.needsUpdate = true;
    root.add(instances);
  }
  return root;
}

export function disposeHorizon(root: THREE.Group): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
    else mesh.material.dispose();
  });
}
