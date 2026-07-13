import * as THREE from 'three';
import { mulberry32 } from './meshes';

/**
 * Cylindrical pixel-art skyline ring at the horizon, for maps that define
 * `skyline`. Tries /assets/sprites/<name>.png (e.g. a buildings layer from
 * the Free Futuristic City / Cyberpunk Street packs — transparent PNG),
 * and until that exists draws a procedural pixel skyline lit with the
 * map's district accent colors. Lives inside the sky group so it follows
 * the camera like the dome does.
 */
export function buildSkyline(name: string, accents: number[]): THREE.Mesh {
  const canvas = pixelSkyline(accents);
  const tex = new THREE.CanvasTexture(canvas);
  setupTex(tex, repeatFor(canvas.width / canvas.height));

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    fog: false,
    side: THREE.BackSide
  });

  const loader = new THREE.TextureLoader();
  loader.load(`${import.meta.env.BASE_URL}assets/sprites/${name}.png`, (t) => {
    const img = t.image as { width: number; height: number };
    setupTex(t, repeatFor(img.width / img.height));
    mat.map = t;
    mat.needsUpdate = true;
  });

  const geo = new THREE.CylinderGeometry(RADIUS, RADIUS, HEIGHT, 48, 1, true);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 24; // base slightly below the horizon line
  mesh.renderOrder = 0; // after the sky dome and sun discs
  mesh.frustumCulled = false;
  return mesh;
}

const RADIUS = 225;
const HEIGHT = 52;

/** Tile count that keeps the texture's pixel aspect square on the ring. */
function repeatFor(aspect: number): number {
  return Math.max(1, Math.round((Math.PI * 2 * RADIUS) / HEIGHT / aspect));
}

function setupTex(t: THREE.Texture, repeat: number): void {
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.x = repeat;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
}

/** Fallback art: dark tower silhouettes, lit windows, antennas, sign glows. */
function pixelSkyline(accents: number[]): HTMLCanvasElement {
  const W = 1024, H = 160;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const rand = mulberry32(0xc17b);
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

  let x = 0;
  while (x < W) {
    const w = 10 + Math.floor(rand() * 24);
    const h = 24 + Math.floor(rand() * rand() * 124);
    const top = H - h;
    // silhouette, slightly varied so towers read as separate slabs
    const shade = 10 + Math.floor(rand() * 8);
    ctx.fillStyle = `rgb(${shade},${shade + 3},${shade + 22})`;
    ctx.fillRect(x, top, w, h);

    // lit windows in the map's accent colors
    for (let gy = top + 4; gy < H - 4; gy += 5) {
      for (let gx = x + 2; gx < x + w - 2; gx += 4) {
        if (rand() < 0.24) {
          ctx.fillStyle = hex(accents[Math.floor(rand() * accents.length)] ?? 0xffe93b);
          ctx.globalAlpha = 0.5 + rand() * 0.5;
          ctx.fillRect(gx, gy, 2, 3);
        }
      }
    }
    ctx.globalAlpha = 1;

    // rooftop dressing: antennas on the tall ones, a glowing sign on some
    if (h > 90 && rand() < 0.5) {
      ctx.fillStyle = '#1a1e38';
      ctx.fillRect(x + Math.floor(w / 2), top - 9, 2, 9);
      ctx.fillStyle = '#ff5252';
      ctx.fillRect(x + Math.floor(w / 2), top - 10, 2, 2);
    }
    if (h > 50 && rand() < 0.22) {
      ctx.fillStyle = hex(accents[Math.floor(rand() * accents.length)] ?? 0xff2e8a);
      ctx.fillRect(x + 2, top + 2, w - 4, 3);
    }

    x += w + (rand() < 0.25 ? 3 : 0);
  }
  return c;
}
