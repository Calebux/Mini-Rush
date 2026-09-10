import * as THREE from 'three';
import { toonMat } from './toon';

// Procedural low-poly stand-ins, used for any model not found in /assets/models.
// Cel-shaded and chunky — Highway-Warriors-flavored — so swapping in the real
// kits (which get toonify()'d on load) isn't jarring.

const mat = toonMat;

// neon arcade paint jobs; index 0 is the hero car
export const CAR_COLORS = [0xff2e8a, 0x00d9ff, 0xa3ff2e, 0xff9a1f, 0x8b5cf6, 0xffe93b];

let contactTexture: THREE.CanvasTexture | null = null;
function softContactTexture(): THREE.CanvasTexture {
  if (contactTexture) return contactTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 5, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.65)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
  contactTexture = new THREE.CanvasTexture(canvas);
  return contactTexture;
}

/** Preserve model paint/textures; let opaque bodies cast and receive the world light. */
export function polishCar(car: THREE.Group): void {
  car.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.every((m) => !m.transparent && m.side !== THREE.BackSide)) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
}

// Neon underglow is a night-map flourish. Left at full strength it puts a
// glowing green puddle under a hatchback at noon, which is the same style
// mismatch the cel outlines were.
let underglow = 1;
export function setUnderglow(intensity: number): void { underglow = intensity; }

const contactInverse = new THREE.Quaternion();
const contactHeading = new THREE.Quaternion();
const contactEuler = new THREE.Euler();

/** Project the soft footprint onto the road while the body leans or jumps. */
export function syncCarGroundFx(car: THREE.Group): void {
  // Cached on the car: this runs per car per frame and the group never moves
  // in the hierarchy. `null` records "this car has no footprint", so a car
  // built without one is not re-searched every frame either.
  let fx = car.userData.groundFx as THREE.Object3D | null | undefined;
  if (fx === undefined) {
    fx = car.getObjectByName('car-ground-fx') ?? null;
    car.userData.groundFx = fx;
  }
  if (!fx) return;
  contactInverse.copy(car.quaternion).invert();
  contactHeading.setFromEuler(contactEuler.set(0, car.rotation.y, 0));
  fx.quaternion.copy(contactInverse).multiply(contactHeading);
  fx.position.set(0, -car.position.y, 0).applyQuaternion(contactInverse);
  const height = Math.max(0, car.position.y);
  (fx.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>).material.opacity = 0.65 / (1 + height * 0.6);
  (fx.children[1] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>).material.opacity =
    0.22 * underglow / (1 + height * 2);
}

/** Blob shadow + neon underglow, attachable to any car (procedural or GLB). */
export function carGroundFx(paint: number): THREE.Group {
  const g = new THREE.Group();
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.0, 5.0),
    new THREE.MeshBasicMaterial({ color: 0x101923, map: softContactTexture(),
      transparent: true, opacity: 0.65, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.055;
  g.add(shadow);

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.3, 4.1),
    new THREE.MeshBasicMaterial({
      color: paint, map: softContactTexture(), transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.06;
  g.name = 'car-ground-fx';
  g.add(glow);
  return g;
}

/** Extrude a side profile across the car's width and remap onto car axes. */
function profileGeometry(pts: [number, number][], width: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const depth = width - 0.12;
  const geo = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.06,
    bevelSegments: 1
  });
  // shape plane is (length, height) extruded along z=width
  geo.rotateY(-Math.PI / 2);
  geo.translate(depth / 2, 0, 0);
  return geo;
}

// low wedge slab up to the beltline; the cabin is a separate, narrower piece
const BODY_PROFILE: [number, number][] = [
  [-1.9, 0.22], [-1.84, 0.5], [-0.6, 0.64], [0.9, 0.68], [1.86, 0.6], [1.9, 0.22]
];
const CABIN_PROFILE: [number, number][] = [
  [-0.5, 0.6], [0.0, 1.0], [0.78, 0.98], [1.3, 0.6]
];

/**
 * Procedural cel-shaded car. colorIndex picks from CAR_COLORS; paintOverride
 * takes an exact hex instead, so a garage car whose colour isn't in the shared
 * palette still renders in its own livery rather than falling back to slot 0.
 */
export function buildCar(colorIndex = 0, paintOverride?: number): THREE.Group {
  const outer = new THREE.Group();
  // parts are authored nose-at--z; the game treats +z as the model's front,
  // so everything solid goes in an inner group flipped 180°
  const g = new THREE.Group();
  g.rotation.y = Math.PI;
  outer.add(g);
  const paint = paintOverride ?? CAR_COLORS[colorIndex % CAR_COLORS.length];
  const paintMat = new THREE.MeshPhongMaterial({ color: paint, specular: 0x555b62, shininess: 65 });
  const trim = mat(0x1c2130);

  const body = new THREE.Mesh(profileGeometry(BODY_PROFILE, 1.7), paintMat);
  g.add(body);

  // narrower cabin on top for the classic stepped two-box silhouette
  const cabin = new THREE.Mesh(profileGeometry(CABIN_PROFILE, 1.26), paintMat);
  g.add(cabin);

  // glass band wrapping the cabin sides, proud of cabin + outline
  const glass = new THREE.MeshPhongMaterial({ color: 0x1c3444, specular: 0x9baebc, shininess: 100 });
  const windows = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.24, 1.1), glass);
  windows.position.set(0, 0.76, 0.5);
  g.add(windows);

  // windshield lying on the cabin's front slope
  const shield = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.07, 0.56), glass);
  shield.position.set(0, 0.8, -0.24);
  shield.rotation.x = Math.atan2(0.4, 0.5);
  g.add(shield);

  // rear wing floating on struts so the silhouette shows a gap
  for (const x of [-0.5, 0.5]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.09), trim);
    strut.position.set(x, 0.72, 1.66);
    g.add(strut);
  }
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.38), paintMat);
  wing.position.set(0, 0.84, 1.68);
  g.add(wing);

  const wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.3, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.32, 8);
  hubGeo.rotateZ(Math.PI / 2);
  const wheelMat = mat(0x14161c);
  const hubMat = mat(0xd8dce6);
  for (const [x, z] of [[-0.8, -1.2], [0.8, -1.2], [-0.8, 1.25], [0.8, 1.25]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(x, 0.33, z);
    g.add(w);
    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.position.copy(w.position);
    g.add(hub);
  }

  // pop-up style headlights + full-width retro taillight bar
  const head = mat(0xfff2b0, { emissive: 0xfff2b0, emissiveIntensity: 0.9 });
  for (const x of [-0.5, 0.5]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.26), head);
    h.position.set(x, 0.64, -1.58);
    g.add(h);
  }
  const tailBar = new THREE.Mesh(
    new THREE.BoxGeometry(1.56, 0.14, 0.12),
    mat(0xff3b30, { emissive: 0xff3b30, emissiveIntensity: 1.2 })
  );
  tailBar.position.set(0, 0.42, 1.97);
  g.add(tailBar);

  // Soft contact remains legible even outside the directional shadow's bounds.
  outer.add(carGroundFx(paint));
  polishCar(outer);

  return outer;
}

/**
 * The shooter: a sleeved forearm out of the driver's window with a pistol in
 * the fist. Parented to the car so it inherits steering lean and body roll.
 * Local +Z is the car's nose, +X the driver's side, and the barrel points
 * forward down-track. Sized for the normalized 3.9-long car bodies.
 */
export function buildShooterArm(): THREE.Group {
  const g = new THREE.Group();
  const skin = mat(0xc98a4b);
  const sleeve = mat(0x23262e);
  const steel = mat(0x2e323c);

  // shoulder and sleeve, half-buried in the door so the arm reads as attached
  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.22), sleeve);
  upper.position.set(0.08, 0, 0);
  g.add(upper);

  const fore = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.20, 0.52), skin);
  fore.position.set(0.30, 0.02, 0.30);
  g.add(fore);

  const fist = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.22), skin);
  fist.position.set(0.30, 0.03, 0.64);
  g.add(fist);

  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, 0.36), steel);
  slide.position.set(0.30, 0.06, 0.86);
  g.add(slide);

  return g;
}

export function buildPalm(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.MeshStandardMaterial({ color: 0x887250, roughness: 0.95 });
  const h = 6.2 + rand() * 2.6;
  const lean = (rand() - 0.5) * 0.5;
  // Joined segments follow a single curve; no displaced seams between the rings.
  for (let i = 0; i < 6; i++) {
    const a = new THREE.Vector3(lean * (i / 6) ** 2, h * i / 6, 0);
    const b = new THREE.Vector3(lean * ((i + 1) / 6) ** 2, h * (i + 1) / 6, 0);
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.24 - (i + 1) * 0.012,
      0.24 - i * 0.012, a.distanceTo(b) + 0.015, 9), trunk);
    seg.position.copy(a).add(b).multiplyScalar(0.5);
    seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
    g.add(seg);
  }
  const top = new THREE.Vector3(lean, h, 0);
  const fronds = [0x4c672f, 0x607c39, 0x728846].map((color) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide }));
  const frondGeo = new THREE.BufferGeometry();
  const sections = [[0, 0, 0.025], [0.7, 0.5, 0.26], [1.6, 0.7, 0.48],
    [2.6, 0.37, 0.45], [3.45, -0.22, 0.25], [3.95, -0.92, 0.015]];
  const positions: number[] = [], indices: number[] = [];
  sections.forEach(([x, y, w], row) => {
    positions.push(x, y - 0.1, -w, x, y + 0.035, 0, x, y - 0.1, w);
    if (row === 0) return;
    for (let col = 0; col < 2; col++) {
      const a = (row - 1) * 3 + col, b = row * 3 + col;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  });
  frondGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  frondGeo.setIndex(indices);
  frondGeo.computeVertexNormals();
  for (let i = 0; i < 13; i++) {
    const a = (i / 8) * Math.PI * 2 + rand() * 0.3;
    const f = new THREE.Mesh(frondGeo, fronds[i % 3]);
    f.position.copy(top);
    f.rotation.y = -a;
    if (i >= 8) {
      f.scale.setScalar(0.78);
      f.rotation.z = 0.55;
    }
    g.add(f);
  }
  const nut = mat(0x6a4a2a);
  for (let i = 0; i < 2; i++) {
    const n = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5), nut);
    n.position.set(top.x + (rand() - 0.5) * 0.4, top.y - 0.25, (rand() - 0.5) * 0.4);
    g.add(n);
  }
  return g;
}

export function buildLanternPole(): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.4, 6), mat(0x4a3830));
  pole.position.y = 1.7;
  g.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.07, 0.07), mat(0x4a3830));
  arm.position.set(0, 3.3, 0);
  g.add(arm);
  const lantern = mat(0xe83a2a, { emissive: 0xd82a1a, emissiveIntensity: 0.9 });
  for (const x of [-0.6, 0.6]) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), lantern);
    l.scale.y = 1.25;
    l.position.set(x, 3.0, 0);
    g.add(l);
    const tassel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.02, 0.22, 5), mat(0xd8a848));
    tassel.position.set(x, 2.6, 0);
    g.add(tassel);
  }
  return g;
}

export function buildPhoneBox(): THREE.Group {
  const g = new THREE.Group();
  const red = mat(0xc41e2a);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.2, 0.95), red);
  body.position.y = 1.1;
  g.add(body);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.22, 1.05), red);
  cap.position.y = 2.3;
  g.add(cap);
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(0.99, 0.26, 0.99),
    mat(0xf2f2e8, { emissive: 0xfff2c0, emissiveIntensity: 0.35 })
  );
  sign.position.y = 2.05;
  g.add(sign);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.2, 0.98), mat(0x16233a));
  glass.position.y = 1.15;
  g.add(glass);
  return g;
}

export function buildNitro(): THREE.Group {
  const g = new THREE.Group();
  const tank = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10),
    mat(0x37b6ff, { emissive: 0x1178c0, emissiveIntensity: 0.7 })
  );
  tank.position.y = 0.85;
  g.add(tank);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 8), mat(0xe8ecf5));
  cap.position.y = 1.4;
  g.add(cap);
  return g;
}

export function buildFinishArch(width: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'finish-gantry';
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x0f3d2e, roughness: 0.55, metalness: 0.35 });
  const accent = new THREE.MeshBasicMaterial({ color: 0xd4af37 });
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.85, 7, 0.85), pillarMat);
    p.position.set(side * (width / 2), 3.5, 0);
    g.add(p);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 5.2, 0.9), accent);
    strip.position.set(side * (width / 2 - 0.25), 3, 0); g.add(strip);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 1.5), pillarMat);
    foot.position.set(side * width / 2, 0.175, 0); g.add(foot);
  }
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0f3d2e'; ctx.fillRect(0, 0, 1024, 256);
  for (const base of [0, 224]) for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 64; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#0a1a14';
      ctx.fillRect(x * 16, base + y * 16, 16, 16);
    }
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#d4af37'; ctx.font = '900 28px sans-serif';
  ctx.fillText('M I N I R U S H   /   G R A N D   P R I X', 512, 62);
  ctx.fillStyle = '#ffffff'; ctx.font = '900 140px sans-serif';
  ctx.fillText('FINISH', 512, 151);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(width + 0.9, 2.1, 0.8), pillarMat);
  beam.position.y = 6.1; g.add(beam);
  const bannerMat = new THREE.MeshBasicMaterial({ map: tex });
  for (const side of [-1, 1]) {
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(width, 2.0), bannerMat);
    banner.position.set(0, 6.1, side * 0.41);
    if (side < 0) banner.rotation.y = Math.PI;
    g.add(banner);
  }
  // A broad chequered stripe marks the exact timing line on the asphalt.
  const checker = document.createElement('canvas'); checker.width = 320; checker.height = 64;
  const paint = checker.getContext('2d')!;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 20; x++) {
    paint.fillStyle = (x + y) % 2 ? '#17211f' : '#ffffff';
    paint.fillRect(x * 16, y * 16, 16, 16);
  }
  const checkTex = new THREE.CanvasTexture(checker);
  checkTex.colorSpace = THREE.SRGBColorSpace; checkTex.magFilter = THREE.NearestFilter;
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(width - 3, 2.4),
    new THREE.MeshBasicMaterial({ map: checkTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  stripe.name = 'finish-road-stripe'; stripe.rotation.x = -Math.PI / 2; stripe.position.y = 0.035; g.add(stripe);
  for (const side of [-1, 1]) {
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 3.2),
      new THREE.MeshBasicMaterial({ map: checkTex, side: THREE.DoubleSide }));
    flag.position.set(side * (width / 2 + 1.1), 3.5, 0);
    g.add(flag);
  }
  polishCar(g);
  return g;
}

export function buildCoin(): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(0.42, 0.42, 0.1, 14);
  geo.rotateX(Math.PI / 2);
  return new THREE.Mesh(
    geo,
    mat(0xfcff52, { emissive: 0xb8bb1e, emissiveIntensity: 0.55 })
  );
}

export function buildBeachUmbrella(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.8, 6), mat(0x8c6d46));
  pole.position.y = 1.4;
  g.add(pole);
  const colors = [0xff3b3b, 0x3bd5ff, 0xffde3b, 0x52ff66];
  const canopy = new THREE.Mesh(
    new THREE.ConeGeometry(1.6, 0.6, 8, 1, true),
    mat(colors[Math.floor(rand() * colors.length)], { side: THREE.DoubleSide })
  );
  canopy.position.y = 2.7;
  g.add(canopy);
  return g;
}

export function buildHoloSign(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7, 0.4), mat(0x222634));
  post.position.y = 3.5;
  g.add(post);
  const signColors = [0x00ffcc, 0xff2e8a, 0xffe93b, 0x8b5cf6];
  const color = signColors[Math.floor(rand() * signColors.length)];
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 4.5, 0.15),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82 })
  );
  sign.position.set(1.6, 5.0, 0);
  g.add(sign);
  return g;
}

export function buildArcadeArch(): THREE.Group {
  const g = new THREE.Group();
  const matRed = mat(0xd9352b);
  const matGold = mat(0xffe93b, { emissive: 0xc49a12, emissiveIntensity: 0.5 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.6), matRed);
    post.position.set(side * 3.8, 3, 0);
    g.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(8.6, 1.2, 0.8), matRed);
  beam.position.y = 6.2;
  g.add(beam);
  const crest = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.8, 0.9), matGold);
  crest.position.y = 7.1;
  g.add(crest);
  return g;
}

export function buildLaunchRamp(): THREE.Group {
  const g = new THREE.Group();
  const L = 5.5, H = 1.25, W = 4.2; // length (down-track), peak height, width
  // right-triangle side profile — flat ground edge, hypotenuse ramps up to a
  // vertical lip; extruded across the road width into a solid wedge
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(L, 0);
  shape.lineTo(L, H);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false });
  geo.translate(-L / 2, 0, -W / 2); // centre on the lane, base sitting on the road
  const ramp = new THREE.Mesh(geo, mat(0xffcc00));
  ramp.rotation.y = Math.PI / 2; // length runs down-track; slope faces the driver, lip forward
  g.add(ramp);
  return g;
}

// deterministic PRNG so recycled chunks vary but stay reproducible per seed
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
