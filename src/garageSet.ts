import * as T from 'three';
import { toonMat } from './toon';

/**
 * The garage the car is shown in: modelled, in the game's cel-shaded style,
 * so the menu looks like the same game as the races. Only the car is
 * realistic; everything here is flat colour with stepped toon shading.
 *
 * A closed room 28 m square, because the turntable camera orbits all the way
 * round: roller shutters to the back, a tool wall and bench to the left, a
 * lift, tyres and drums to the right, the way out behind the camera.
 */

const ROOM = 14;          // half-width: the turntable camera orbits at most 11 m out
const HEIGHT = 8.5;

export function buildGarage(scene: T.Scene): void {
  const mats = new Map<string, T.Material>();
  const m = (color: number, extra: Partial<T.MeshToonMaterialParameters> = {}) => {
    const key = `${color}/${JSON.stringify(extra)}`;
    let mat = mats.get(key);
    if (!mat) { mat = toonMat(color, extra); mats.set(key, mat); }
    return mat;
  };
  const glow = (color: number, strength = 1.8) =>
    new T.MeshBasicMaterial({ color: new T.Color(color).multiplyScalar(strength), toneMapped: false });
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: T.Material,
    shadow = true) => {
    const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  const cyl = (rt: number, rb: number, h: number, x: number, y: number, z: number, mat: T.Material, seg = 20) => {
    const mesh = new T.Mesh(new T.CylinderGeometry(rt, rb, h, seg), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };

  // ── floor: polished concrete, a painted bay, a hazard-striped edge ─────
  const floor = new T.Mesh(new T.PlaneGeometry(ROOM * 2, ROOM * 2), m(0x6b7080, { map: concreteTexture() }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.05;
  floor.receiveShadow = true;
  scene.add(floor);
  const line = m(0xf2c230);
  for (const x of [-4.2, 4.2]) box(0.12, 0.012, 9, x, -0.04, 0, line, false);
  box(8.52, 0.012, 0.12, 0, -0.04, -4.5, line, false);
  // hazard stripes along the back wall
  const stripes = new T.Mesh(new T.PlaneGeometry(ROOM * 2, 0.7), m(0xffffff, { map: hazardTexture() }));
  stripes.rotation.x = -Math.PI / 2;
  stripes.position.set(0, -0.035, -ROOM + 0.6);
  scene.add(stripes);

  // ── walls: dark lower panels, lighter upper, a ceiling ────────────────
  const lower = m(0x2a3040), upper = m(0x444b5e), trim = m(0x1b1f2b);
  for (const [x, z, ry] of [[0, -ROOM, 0], [0, ROOM, Math.PI], [-ROOM, 0, Math.PI / 2], [ROOM, 0, -Math.PI / 2]] as const) {
    const wall = new T.Group();
    wall.position.set(x, 0, z);
    wall.rotation.y = ry;
    const add = (w: number, h: number, d: number, px: number, py: number, pz: number, mat: T.Material) => {
      const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
      mesh.position.set(px, py, pz);
      mesh.receiveShadow = true;
      wall.add(mesh);
    };
    add(ROOM * 2, 2.4, 0.3, 0, 1.15, 0, lower);
    add(ROOM * 2, HEIGHT - 2.4, 0.3, 0, 2.3 + (HEIGHT - 2.4) / 2, 0.02, upper);
    add(ROOM * 2, 0.14, 0.4, 0, 2.38, 0.06, trim);
    // vertical steel pilasters every 6.5 m
    for (let px = -ROOM + 0.2; px <= ROOM; px += 6.5) add(0.35, HEIGHT, 0.5, px, HEIGHT / 2, 0.1, trim);
    scene.add(wall);
  }
  box(ROOM * 2, 0.3, ROOM * 2, 0, HEIGHT + 0.15, 0, m(0x1a1d27), false);
  // roof beams
  for (let z = -ROOM + 3; z < ROOM; z += 5) box(ROOM * 2, 0.35, 0.3, 0, HEIGHT - 0.2, z, trim, false);

  // ── back wall: two roller shutters and the sign ───────────────────────
  for (const x of [-5.5, 5.5]) {
    const frame = m(0x1b1f2b), slat = m(0x8a91a3), slat2 = m(0x747b8d);
    box(6.4, 0.35, 0.5, x, 5.3, -ROOM + 0.35, frame);
    for (const side of [-1, 1]) box(0.3, 5.3, 0.5, x + side * 3.05, 2.65, -ROOM + 0.35, frame);
    for (let y = 0.2; y < 5.1; y += 0.34) box(5.8, 0.3, 0.12, x, y + 0.15, -ROOM + 0.25, Math.round(y / 0.34) % 2 ? slat : slat2, false);
    // a yellow-black kick plate
    const plate = new T.Mesh(new T.PlaneGeometry(5.8, 0.35), m(0xffffff, { map: hazardTexture() }));
    plate.position.set(x, 0.2, -ROOM + 0.33);
    scene.add(plate);
  }
  const sign = new T.Mesh(new T.PlaneGeometry(6.4, 1.6),
    new T.MeshBasicMaterial({ map: signTexture(), toneMapped: false, transparent: true, color: new T.Color(1.4, 1.4, 1.4) }));
  sign.position.set(0, 7.2, -ROOM + 0.2);
  scene.add(sign);

  // ── left wall: pegboard with tools, a bench, a red tool chest ─────────
  const peg = new T.Mesh(new T.PlaneGeometry(9, 2.6), m(0xb9855a, { map: pegTexture() }));
  peg.position.set(-ROOM + 0.18, 3.6, -1.5);
  peg.rotation.y = Math.PI / 2;
  scene.add(peg);
  const tool = m(0xc7ccd6), grip = m(0xe0433a);
  for (let i = 0; i < 9; i++) {
    const z = -5.4 + i * 0.95, long = 0.7 + (i % 3) * 0.25;
    box(0.06, long, 0.12, -ROOM + 0.3, 3.8, z, tool, false);
    box(0.08, 0.28, 0.16, -ROOM + 0.31, 3.8 - long / 2 + 0.12, z, i % 2 ? grip : m(0x2f7de1), false);
  }
  box(1.1, 0.12, 6, -ROOM + 0.8, 1.05, -1.5, m(0x7a5436));           // bench top
  for (const z of [-4.3, 1.3]) box(1, 1, 0.12, -ROOM + 0.8, 0.5, z, trim);
  box(1, 0.08, 5.6, -ROOM + 0.8, 0.3, -1.5, trim);                    // shelf
  const chest = m(0xd8322c), drawer = m(0xa92320);
  box(1.3, 1.9, 1.8, -ROOM + 0.9, 0.95, 3.4, chest);
  for (let i = 0; i < 5; i++) box(0.04, 0.26, 1.5, -ROOM + 1.56, 0.4 + i * 0.32, 3.4, drawer, false);
  box(0.9, 0.5, 1.4, -ROOM + 0.9, 2.15, 3.4, chest);

  // ── right wall: a two-post lift, tyre stacks, oil drums ───────────────
  const liftRed = m(0xd8322c), steel = m(0x9aa1b1);
  for (const z of [-6.2, -1.8]) {
    box(0.55, 4.6, 0.55, ROOM - 2.2, 2.3, z, liftRed);
    box(0.25, 0.25, 1.8, ROOM - 2.9, 0.6, z + (z < -4 ? 0.9 : -0.9), steel);
  }
  box(0.4, 0.3, 4.9, ROOM - 2.2, 4.75, -4, liftRed);
  const tyre = m(0x1d1f25), rim = m(0x8a91a3);
  for (const [x, z, n] of [[ROOM - 1.3, 2, 4], [ROOM - 1.3, 3.3, 3], [ROOM - 2.6, 2.5, 2]] as const) {
    for (let i = 0; i < n; i++) {
      const t = new T.Mesh(new T.TorusGeometry(0.42, 0.2, 10, 24), tyre);
      t.rotation.x = Math.PI / 2;
      t.position.set(x, 0.2 + i * 0.4, z);
      t.castShadow = t.receiveShadow = true;
      scene.add(t);
      const hub = new T.Mesh(new T.CylinderGeometry(0.24, 0.24, 0.3, 14), rim);
      hub.position.copy(t.position);
      scene.add(hub);
    }
  }
  for (const [z, color] of [[6.2, 0x2f7de1], [7.1, 0xd8322c], [6.6, 0xf2c230]] as const) {
    cyl(0.42, 0.42, 1.25, ROOM - 1.1 - (color === 0xf2c230 ? 0.9 : 0), 0.62, z, m(color));
    cyl(0.44, 0.44, 0.06, ROOM - 1.1 - (color === 0xf2c230 ? 0.9 : 0), 0.95, z, m(0x1b1f2b));
  }

  // ── behind the camera: the open entrance, the neon street outside ────
  box(10, 6.2, 0.2, 0, 3.1, ROOM - 0.25, new T.MeshBasicMaterial({ color: 0x120c2a }), false);
  for (const side of [-1, 1]) box(0.4, 6.6, 0.5, side * 5.2, 3.3, ROOM - 0.35, trim);
  box(10.8, 0.4, 0.5, 0, 6.5, ROOM - 0.35, trim);
  // lit windows across the street, seen through the doorway
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const lit = [0x9fe8ff, 0xffc987, 0xff8fd8][i % 3];
    box(0.26, 0.34, 0.05, -4.3 + rand() * 8.6, 1.5 + rand() * 4.2, ROOM - 0.4, glow(lit, 0.45 + rand() * 0.35), false);
  }
  // an extra roller shutter each side of the doorway
  for (const x of [-9.8, 9.8]) {
    for (let y = 0.2; y < 5.1; y += 0.34) box(5.8, 0.3, 0.12, x, y + 0.15, ROOM - 0.3, Math.round(y / 0.34) % 2 ? m(0x8a91a3) : m(0x747b8d), false);
    box(6.4, 0.35, 0.5, x, 5.3, ROOM - 0.35, trim);
  }

  // ── the lights: ceiling strips, and a neon line on each side wall ────
  for (const x of [-6, 0, 6]) {
    for (const z of [-8, 0, 8]) {
      box(0.35, 0.08, 2.6, x, HEIGHT - 0.45, z, glow(0xf4f7ff, 2.2), false);
      box(0.45, 0.12, 2.8, x, HEIGHT - 0.38, z, trim, false);
    }
  }
  box(0.06, 0.06, 20, -ROOM + 0.25, 2.5, -1, glow(0xff2e9a, 2.6), false);
  box(0.06, 0.06, 20, ROOM - 0.25, 2.5, -1, glow(0x22e6ff, 2.6), false);

  // soft bounce from the ceiling strips and the floor
  scene.add(new T.HemisphereLight(0xeef2ff, 0x3a3f4c, 1.25));
  const key = new T.DirectionalLight(0xffffff, 1.9);
  key.position.set(-3, HEIGHT - 0.5, 4);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: .5, far: 20 });
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 4;
  key.shadow.normalBias = .03;
  key.shadow.bias = -.0002;
  scene.add(key, key.target);
  const fillPink = new T.PointLight(0xff2e9a, 14, 14, 1.8); fillPink.position.set(-ROOM + 1.5, 2.6, -1); scene.add(fillPink);
  const fillCyan = new T.PointLight(0x22e6ff, 14, 14, 1.8); fillCyan.position.set(ROOM - 1.5, 2.6, -1); scene.add(fillCyan);
}

// ── painted textures ───────────────────────────────────────────────────

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void,
  repeat?: [number, number]): T.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}

/** Concrete in big flat-shaded slabs with a few oil stains: cartoon, not photo. */
function concreteTexture(): T.CanvasTexture {
  return canvasTexture(512, 512, (ctx) => {
    ctx.fillStyle = '#9aa0ad';
    ctx.fillRect(0, 0, 512, 512);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const v = 150 + Math.floor(rand() * 16);
      ctx.fillStyle = `rgb(${v},${v + 3},${v + 12})`;
      ctx.fillRect(i * 128 + 2, j * 128 + 2, 124, 124);
    }
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = 'rgba(40,44,56,0.22)';
      ctx.beginPath();
      ctx.ellipse(rand() * 512, rand() * 512, 14 + rand() * 30, 8 + rand() * 18, rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [6, 6]);
}

function hazardTexture(): T.CanvasTexture {
  return canvasTexture(128, 32, (ctx) => {
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(0, 0, 128, 32);
    ctx.fillStyle = '#1b1f2b';
    for (let x = -32; x < 160; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 32); ctx.lineTo(x + 16, 32); ctx.lineTo(x + 32, 0); ctx.lineTo(x + 16, 0);
      ctx.closePath();
      ctx.fill();
    }
  }, [12, 1]);
}

function pegTexture(): T.CanvasTexture {
  return canvasTexture(256, 128, (ctx) => {
    ctx.fillStyle = '#c9956a';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#7a5436';
    for (let x = 8; x < 256; x += 16) for (let y = 8; y < 128; y += 16) {
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function signTexture(): T.CanvasTexture {
  return canvasTexture(1024, 256, (ctx) => {
    ctx.clearRect(0, 0, 1024, 256);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 132px Orbitron, "Arial Black", sans-serif';
    ctx.shadowColor = '#ff2e9a';
    ctx.shadowBlur = 30;
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#ff2e9a';
    ctx.strokeText('MINIRUSH', 512, 110);
    ctx.fillStyle = '#ffe0f0';
    ctx.shadowBlur = 8;
    ctx.fillText('MINIRUSH', 512, 110);
    ctx.font = '700 32px Orbitron, sans-serif';
    ctx.shadowColor = '#22e6ff';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#b5f6ff';
    ctx.fillText('C U S T O M S   ·   G A R A G E', 512, 214);
  });
}
