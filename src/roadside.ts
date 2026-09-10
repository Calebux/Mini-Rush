import * as THREE from 'three';
import { districtIndexAt, ROAD_HALF_WIDTH } from './constants';
import { EnvironmentKit, isRural } from './environment';
import type { MapSpec } from './maps';
import { Track } from './track';
import { mulberry32 } from './meshes';
import { coastalTerrain, turfTexture } from './coast';

/**
 * Extrude a cross-section along the real road, including raised curb faces.
 *
 * Vertex colours carry the same sky-occlusion idea as the scenery batches: the
 * far edge of a frontage is tucked under the buildings that line it, so it
 * darkens with distance from the kerb. Without it the pavement reads as one
 * flat sheet of light and nothing standing on it looks connected.
 */
function ribbon(track: Track, start: number, end: number, profile: [number, number][],
  material: THREE.Material): THREE.Mesh {
  const rows = Math.ceil((end - start) / 2), cols = profile.length;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const shades: number[] = [];
  for (let row = 0; row <= rows; row++) {
    const s = start + (end - start) * row / rows, f = track.frame(s);
    for (const [offset, y] of profile) {
      positions.push(f.x + f.nx * offset, y, f.z + f.nz * offset);
      uvs.push(offset / 3, s / 3);
      const reach = Math.min(1, Math.max(0, (Math.abs(offset) - ROAD_HALF_WIDTH) / 13));
      const shade = 1 - 0.18 * reach * reach;
      shades.push(shade, shade, shade);
    }
    if (row === 0) continue;
    for (let col = 0; col < cols - 1; col++) {
      const a = (row - 1) * cols + col, b = a + cols;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(shades, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

export function buildRoadside(track: Track, map: MapSpec, kit: EnvironmentKit): THREE.Group {
  const group = new THREE.Group(), t = kit.theme;
  group.name = 'connected-roadside';
  const shaded = (m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial => {
    const clone = m.clone();
    clone.vertexColors = true;
    return clone;
  };
  const paving = shaded(kit.material(t.pavement));
  paving.map = pavingTexture(map.id);
  // Both sides of the ribbon use the same normal-facing cross section.
  const curb = shaded(kit.material(new THREE.Color(t.pavement).multiplyScalar(1.12).getHex()));
  const soil = shaded(kit.material(t.ground));
  if (map.id === 'lagos') soil.map = turfTexture();
  const water = shaded(kit.material(t.water));
  water.roughness = 0.28;
  water.metalness = 0.2;
  water.bumpMap = waterRipples();
  water.bumpScale = 0.11;
  const verge = shaded(kit.material(
    new THREE.Color(t.ground).lerp(new THREE.Color(t.pavement), 0.35).getHex()));
  if (map.id === 'lagos') verge.color.setHex(0x555d52);
  const roadEdge = ROAD_HALF_WIDTH + 0.6;
  const circuit = t.landscape === 'stadium';
  const runoff = circuit ? shaded(kit.material(0xffffff)) : null;
  if (runoff) runoff.map = runoffTexture(map.id === 'cota');
  // Signed polygon area tells us which side faces away from the circuit interior.
  const outline = track.outline();
  let area = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    area += a.x * b.z - b.x * a.z;
  }
  const outward = (area > 0 ? 1 : -1) * (map.id === 'lagos' ? -1 : 1);
  for (let di = 0; di < 3; di++) {
    const coastalDrive = map.id === 'lagos' && di < 2;
    const start = di * track.length / 3, end = (di + 1) * track.length / 3;
    const rural = isRural(map.districts[districtIndexAt((start + end) / 2, track.length)].flavor);
    for (const side of [-1, 1]) {
      const waterfront = t.coast && side === outward &&
        (di < 2 || map.id === 'newzealand');
      const add = (points: [number, number][], material: THREE.Material) => {
        const profile = points.map(([x, y]) => [x * side, y] as [number, number]);
        // Negative-to-positive offsets give upward normals on either roadside.
        if (side < 0) profile.reverse();
        group.add(ribbon(track, start, end, profile, material));
      };
      add([[roadEdge, 0.008], [roadEdge + (coastalDrive ? .45 : 1.0), 0.008], [roadEdge + (coastalDrive ? .85 : 1.6), -0.07]], verge);
      if (runoff) {
        add([[roadEdge + 0.05, 0.028], [17, 0.028], [19, -0.07]], runoff);
      } else if (!rural && !coastalDrive) {
        add([[roadEdge + 0.1, 0.025], [roadEdge + 0.1, 0.2], [roadEdge + 0.45, 0.2]], curb);
        const extent = waterfront ? 10.8 : 19;
        add([[roadEdge + 0.45, 0.2], [extent, 0.2], [extent + 0.2, -0.07]], paving);
      }
      if (waterfront) {
        if (coastalDrive) {
          add([[roadEdge + .85, -.015], [13.5, -.03], [14.2, -.10]], soil);
          add([[14.2, -.10], [15.2, -.16]], verge);
          add([[15.2, -.14], [75, -.14]], water);
        } else {
          add([[11.1, -0.15], [11.1, 0.65], [11.55, 0.65], [11.55, -0.15]], curb);
          add([[11.55, -0.14], [55, -0.14]], water);
        }
      } else if (!coastalDrive) {
        add([[rural ? roadEdge + 1.6 : 11, -0.075], [34, -0.075]], soil);
      }
    }
  }
  // Mark the chosen shore side so the placement pass leaves the lagoon open.
  group.userData.outward = outward;
  if (map.id === 'lagos') group.add(coastalTerrain(track, outward));
  if (['mountains', 'forest', 'desert'].includes(t.landscape)) {
    group.add(buildTerrain(track, kit, outward));
  }
  return group;
}

function runoffTexture(cota: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = cota ? '#4b759a' : '#c1b99f'; ctx.fillRect(0, 0, 256, 256);
  if (cota) {
    for (let stripe = -2; stripe < 6; stripe++) {
      ctx.fillStyle = stripe % 2 ? '#e9e4d6' : '#bd5046';
      ctx.beginPath(); ctx.moveTo(stripe * 64, 0); ctx.lineTo(stripe * 64 + 28, 0);
      ctx.lineTo(stripe * 64 + 120, 256); ctx.lineTo(stripe * 64 + 92, 256); ctx.fill();
    }
  } else {
    ctx.fillStyle = '#e6b753'; ctx.fillRect(0, 0, 28, 256);
    for (let row = 0; row < 8; row++) {
      ctx.fillStyle = row % 2 ? '#f1e5c7' : '#4e636c'; ctx.fillRect(30, row * 32, 28, 32);
    }
  }
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 4;
  return texture;
}

/** Low, continuous landforms; no floating rock ring or identical cone skyline.
 * Vertices near ANY road segment are flattened so tight return legs stay clear.
 */
function buildTerrain(track: Track, kit: EnvironmentKit, shore: number): THREE.Group {
  const g = new THREE.Group(), t = kit.theme;
  g.name = `terrain-${t.id}`;
  const route = track.outline(4);
  const xs = route.map(p => p.x), zs = route.map(p => p.z);
  const minX = Math.min(...xs) - 85, minZ = Math.min(...zs) - 85;
  const cols = Math.ceil((Math.max(...xs) + 85 - minX) / 10);
  const rows = Math.ceil((Math.max(...zs) + 85 - minZ) / 10);
  // World-space grid, NOT wide offset ribbons: ribbons fold over one another
  // on hairpins and can create giant overhead polygons above the roadway.
  const pos: number[] = [], colors: number[] = [], index: number[] = [];
  for (let row = 0; row <= rows; row++) {
      for (let col = 0; col <= cols; col++) {
        const x = minX + col * 10, z = minZ + row * 10;
        let distanceSq = Infinity, nearest = 0;
        for (let i = 0; i < route.length; i++) {
          const p = route[i], d = (x - p.x) ** 2 + (z - p.z) ** 2;
          if (d < distanceSq) { distanceSq = d; nearest = i; }
        }
        const p = route[nearest], next = route[(nearest + 1) % route.length];
        const onShore = t.coast && ((x - p.x) * (next.z - p.z) - (z - p.z) * (next.x - p.x)) * shore > 0;
        const ridge = (Math.sin(x * 0.024) + Math.cos(z * 0.037) + 2) / 4;
        const rise = onShore ? 0 : THREE.MathUtils.smoothstep(Math.sqrt(distanceSq), 18, 58);
        const height = t.id === 'norway' ? 9 + ridge * 31 : t.id === 'iceland' ? 8 + ridge * 17 :
          t.id === 'newzealand' ? 5 + ridge * 21 : t.id === 'cairo' ? 2 + ridge * 9 : 1 + ridge * 5;
        const y = -0.12 + rise * height;
        pos.push(x, y, z);
        const stone = t.id === 'norway' || t.id === 'iceland';
        const color = new THREE.Color(stone ? t.rock : t.ground);
        if (t.id === 'norway' && y > 25) color.lerp(new THREE.Color(0xdbe7e4), THREE.MathUtils.smoothstep(y, 25, 36));
        color.multiplyScalar(0.88 + ridge * 0.18);
        colors.push(color.r, color.g, color.b);
        if (row && col < cols) {
          const a = (row - 1) * (cols + 1) + col, b = a + cols + 1;
          index.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(index); geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true,
      roughness: 1, flatShading: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material); mesh.receiveShadow = true;
    g.add(mesh);
  return g;
}

function pavingTexture(id: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32(0x70617665);
  ctx.fillStyle = '#b7b0a1'; ctx.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 4; row++) {
    for (let col = -1; col < 3; col++) {
      const x = col * 256 + (row % 2) * 128, y = row * 128;
      const shade = 218 + Math.floor(rand() * 24);
      ctx.fillStyle = `rgb(${shade},${shade - 3},${shade - 10})`;
      ctx.fillRect(x + 2, y + 2, 253, 125);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(x + 2, y + 2, 253, 2);
      ctx.fillRect(x + 2, y + 2, 2, 125);
    }
  }
  for (let i = 0; i < 15000; i++) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(80,70,45,0.06)' : 'rgba(255,255,255,0.08)';
    ctx.fillRect(rand() * 512, rand() * 512, 1, 1);
  }
  if (id === 'rio') {
    // Copacabana's flowing black-and-cream mosaic gives this coast its own
    // ground-plane rhythm, even before the coloured hillside houses appear.
    ctx.fillStyle = '#e8e1c8'; ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = '#66716d'; ctx.lineWidth = 52;
    for (let wave = -1; wave < 4; wave++) {
      ctx.beginPath();
      for (let y = 0; y <= 512; y += 4) {
        const x = wave * 192 + Math.sin(y / 512 * Math.PI * 2) * 55;
        if (!y) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function waterRipples(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!, rand = mulberry32(0x736561);
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 300; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.03 + rand() * 0.14})`;
    ctx.fillRect(rand() * 256, rand() * 256, 5 + rand() * 34, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}
