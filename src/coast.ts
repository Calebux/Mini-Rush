import * as T from 'three';
import { EnvironmentKit } from './environment';
import { mulberry32 } from './meshes';
import { Track } from './track';
import { localBuilding } from './architecture';

type AddStatic = (object: T.Object3D, s: number) => void;
const terrains = new WeakMap<Track, (x: number, z: number) => number>();

/** Low coastal dunes, with a broad flat safety apron around EVERY return leg. */
export function coastalTerrain(track: Track, shore: number): T.Group {
  const route = Array.from({ length: Math.ceil(track.length / 6) }, (_, i) => ({ ...track.frame(i * 6), s: i * 6 }));
  const height = (x: number, z: number) => {
    let d = Infinity, closest = route[0];
    for (const p of route) { const q = (x - p.x) ** 2 + (z - p.z) ** 2; if (q < d) { d = q; closest = p; } }
    const waterSide = ((x - closest.x) * closest.nx + (z - closest.z) * closest.nz) * shore > 0 && closest.s < track.length * 2 / 3;
    if (waterSide) return -.19;
    const rise = T.MathUtils.smoothstep(Math.sqrt(d), 23, 52);
    const dune = 1.6 + (Math.sin(x * .033) + Math.cos(z * .027) + 2) * 1.4;
    return -.09 + rise * dune;
  };
  terrains.set(track, height);
  const minX = Math.min(...route.map(p => p.x)) - 85, minZ = Math.min(...route.map(p => p.z)) - 85;
  const cols = Math.ceil((Math.max(...route.map(p => p.x)) + 85 - minX) / 6);
  const rows = Math.ceil((Math.max(...route.map(p => p.z)) + 85 - minZ) / 6);
  const pos: number[] = [], uv: number[] = [], colors: number[] = [], indices: number[] = [];
  for (let row = 0; row <= rows; row++) for (let col = 0; col <= cols; col++) {
    const x = minX + col * 6, z = minZ + row * 6, y = height(x, z);
    pos.push(x, y, z); uv.push(x / 7, z / 7);
    const patch = (Math.sin(x * .056 + Math.cos(z * .023)) + Math.cos(z * .09)) * .08 + .5;
    const c = new T.Color(0x65784b).lerp(new T.Color(0x999577), patch);
    colors.push(c.r, c.g, c.b);
    if (row && col < cols) { const a = (row - 1) * (cols + 1) + col, b = a + cols + 1; indices.push(a, b, a + 1, b, b + 1, a + 1); }
  }
  const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const map = turfTexture();
  const mesh = new T.Mesh(geometry, new T.MeshStandardMaterial({ color: 0xffffff, map, vertexColors: true, roughness: 1 }));
  mesh.receiveShadow = true;
  const g = new T.Group(); g.name = 'terrain-lagos'; g.add(mesh); return g;
}

export function turfTexture(): T.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const ctx = c.getContext('2d')!, rand = mulberry32(0x67a55);
  ctx.fillStyle = '#bdc2a8'; ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 43000; i++) {
    const x = rand() * 512, y = rand() * 512;
    ctx.strokeStyle = rand() < .5 ? '#47563528' : '#fbf4d549'; ctx.lineWidth = .7;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rand() * 2 - 1, y - rand() * 5); ctx.stroke();
  }
  const texture = new T.CanvasTexture(c); texture.colorSpace = T.SRGBColorSpace;
  texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.anisotropy = 4; return texture;
}

/** Original leaf atlas; cutout geometry, not expensive transparent clouds. */
function leafTexture(palm: boolean): T.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const ctx = c.getContext('2d')!, rand = mulberry32(palm ? 719 : 320);
  ctx.strokeStyle = '#657046'; ctx.lineWidth = palm ? 4 : 6;
  ctx.beginPath(); ctx.moveTo(256, 500); ctx.quadraticCurveTo(250, 250, 256, 10); ctx.stroke();
  if (palm) {
    for (let i = 0; i < 44; i++) for (const side of [-1, 1]) {
      const y = 20 + i * 10.4, width = Math.sin((i + 3) / 49 * Math.PI) * 208;
      ctx.fillStyle = ['#617c3e', '#779248', '#4c6b35', '#83944c'][i % 4];
      ctx.beginPath(); ctx.moveTo(256, y); ctx.quadraticCurveTo(256 + side * width * .65, y + 8, 256 + side * width, y + 60);
      ctx.quadraticCurveTo(256 + side * width * .45, y + 31, 256, y + 9); ctx.fill();
    }
  } else {
    for (let branch = 0; branch < 18; branch++) {
      const y = 55 + branch * 23, side = branch % 2 ? -1 : 1, end = 256 + side * (65 + Math.sin(branch / 18 * Math.PI) * 135);
      ctx.strokeStyle = '#726543'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(256, y + 45); ctx.lineTo(end, y - 5); ctx.stroke();
      for (let i = 0; i < 24; i++) {
        const f = rand(), x = 256 + (end - 256) * f + (rand() - .5) * 50, ly = y + 45 - f * 50 + (rand() - .5) * 64;
        ctx.fillStyle = ['#516d37', '#718448', '#899853', '#3d5c34', '#5d7b40'][Math.floor(rand() * 5)];
        ctx.beginPath(); ctx.ellipse(x, ly, 5 + rand() * 7, 12 + rand() * 9, side * .7 + rand(), 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4; return tex;
}

/** Dress the first two districts, all shared materials merged into 60 m sectors. */
export function dressLagosCoast(track: Track, kit: EnvironmentKit, shore: number, add: AddStatic, seed: number): void {
  const rand = mulberry32(seed ^ 0xc0a57), route = track.outline(2);
  const terrainY = terrains.get(track) ?? (() => 0);
  const bark = new T.MeshStandardMaterial({ color: 0x746b50, roughness: 1 });
  const foliage = new T.MeshStandardMaterial({ map: leafTexture(false), color: 0xb4c992, roughness: .93, side: T.DoubleSide, alphaTest: .42 });
  const fronds = new T.MeshStandardMaterial({ map: leafTexture(true), color: 0xc2d79e, roughness: .86, side: T.DoubleSide, alphaTest: .42 });
  const card = new T.PlaneGeometry(1, 1), trunk = new T.CylinderGeometry(.12, .12, 1, 7);
  function branch(g: T.Group, a: T.Vector3, b: T.Vector3, radius: number) {
    const m = new T.Mesh(trunk, bark); m.position.copy(a).add(b).multiplyScalar(.5);
    m.scale.set(radius, a.distanceTo(b), radius); m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize()); g.add(m);
  }
  function tree(palm: boolean): T.Group {
    const g = new T.Group(), h = palm ? 6.8 + rand() * 3.7 : 5.3 + rand() * 3;
    const lean = (rand() - .5) * 1.3;
    const curve = new T.CatmullRomCurve3(Array.from({ length: 5 }, (_, k) => new T.Vector3(lean * (k / 4) ** 2, h * k / 4, 0)));
    g.add(new T.Mesh(new T.TubeGeometry(curve, 12, palm ? .16 : .23, 7, false), bark));
    if (palm) {
      for (let i = 0; i < 11; i++) {
        const len = 3.4 + rand() * .8, geo = new T.PlaneGeometry(1.65, len, 2, 8);
        const positions = geo.getAttribute('position');
        for (let v = 0; v < positions.count; v++) {
          const t = (positions.getY(v) + len / 2) / len;
          const x = positions.getX(v);
          positions.setXYZ(v, x, .65 * Math.sin(t * Math.PI) - .95 * t * t - Math.abs(x) * .16, t * len);
        }
        geo.computeVertexNormals();
        const leaf = new T.Mesh(geo, fronds); leaf.position.set(lean, h, 0); leaf.rotation.y = i / 11 * Math.PI * 2; g.add(leaf);
      }
    } else {
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4, reach = 1.6 + rand() * .8;
        const tip = new T.Vector3(lean + Math.cos(a) * reach, h - .7 + rand() * 1.4, Math.sin(a) * reach);
        branch(g, new T.Vector3(lean * .5, h * .58, 0), tip, .37);
        for (let k = 0; k < 2; k++) {
          const leaf = new T.Mesh(card, foliage); leaf.position.copy(tip); leaf.scale.set(3.2, 3.1, 1); leaf.rotation.set(k ? -.7 : .25, a + k * Math.PI / 2, .18); g.add(leaf);
        }
      }
    }
    return g;
  }
  function shrub(): T.Group {
    const g = new T.Group();
    for (let i = 0; i < 4; i++) { const leaf = new T.Mesh(card, foliage); leaf.position.set((rand() - .5) * .5, .5, (rand() - .5) * .5); leaf.scale.set(1.25, 1.35, 1); leaf.rotation.y = i * Math.PI / 4; g.add(leaf); }
    return g;
  }
  function place(g: T.Group, s: number, offset: number, radius: number) {
    track.place(g, s, offset);
    if (route.some(p => Math.hypot(p.x - g.position.x, p.z - g.position.z) < 7 + radius)) return;
    g.position.y = Math.max(-.02, terrainY(g.position.x, g.position.z));
    g.rotation.y += rand() * Math.PI * 2; add(g, s);
  }
  const end = track.length * 2 / 3;
  for (let s = 8; s < end; s += 12 + rand() * 6) {
    place(tree(true), s, shore * (11 + rand() * 1.2), 2);
    place(tree(rand() < .35), s + 5, -shore * (13 + rand() * 5), 3);
    if (s % 36 < 18) place(tree(false), s + 10, -shore * (28 + rand() * 13), 3);
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) place(shrub(), s + i * 3, side * (9.2 + rand() * 1.2), .5);
  }
  // Irregular inland groves connect the near trees to the dune horizon.
  for (let s = 12; s < end; s += 23 + rand() * 7) {
    for (const distance of [25, 36, 48]) {
      place(tree(false), s + rand() * 16, -shore * (distance + rand() * 8), 3);
      if (rand() < .65) place(shrub(), s + rand() * 8, -shore * (distance - 5), .5);
    }
  }
  // A few city clusters beyond the greenbelt keep The Island recognisably urban.
  for (const s of [track.length * .09, track.length * .18, track.length * .27]) {
    for (let i = 0; i < 2; i++) {
      const building = localBuilding('lagos', kit, rand, true);
      track.place(building, s + i * 13, -shore * (50 + i * 8));
      if (route.some(p => Math.hypot(p.x - building.position.x, p.z - building.position.z) < 15)) continue;
      building.position.y = terrainY(building.position.x, building.position.z);
      building.rotation.y += shore * Math.PI / 2; add(building, s);
    }
  }
  // Thin galvanized rails follow the actual spline, with regular reflectors.
  for (let s = 3; s < end - 3; s += 4) for (const side of [-1, 1]) {
    const f = track.frame(s), next = track.frame(s + 4), offset = side * 8.1;
    const a = new T.Vector3(f.x + f.nx * offset, .78, f.z + f.nz * offset);
    const b = new T.Vector3(next.x + next.nx * offset, .78, next.z + next.nz * offset);
    const g = new T.Group();
    const rail = new T.Mesh(new T.BoxGeometry(.10, .23, a.distanceTo(b) + .05), kit.material(0xc8cec9));
    rail.position.copy(a).add(b).multiplyScalar(.5); rail.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), b.clone().sub(a).normalize()); g.add(rail);
    kit.box(g, a.x, .41, a.z, .10, .82, .13, 0x9da9a5);
    if (Math.floor(s / 4) % 3 === 0) kit.box(g, a.x, .88, a.z, .13, .09, .15, side === shore ? 0xdfbb74 : 0xe4e8dd);
    add(g, s);
  }
  // Purposeful wayfinding rather than a repeated oversized street arch.
  for (const [s, label] of [[45, 'LAGOON DRIVE'], [track.length / 3 + 25, 'BAR BEACH']] as const) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#24554a'; ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = '#e7e8d6'; ctx.lineWidth = 4; ctx.strokeRect(6, 6, 500, 116);
    ctx.fillStyle = '#e7e8d6'; ctx.font = '600 43px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(label, 256, 78);
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
    const g = new T.Group(), sign = new T.Mesh(new T.PlaneGeometry(3.8, .95), new T.MeshStandardMaterial({ map: tex, side: T.DoubleSide, roughness: .8 }));
    sign.position.y = 2.5; g.add(sign);
    for (const x of [-1.4, 1.4]) kit.box(g, x, 1.2, 0, .08, 2.4, .08, 0x8e9995);
    track.place(g, s, -shore * 10.2); g.rotation.y += Math.PI; add(g, s);
  }
}
