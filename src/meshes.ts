import * as THREE from 'three';
import { outlineFor, toonMat } from './toon';

// Procedural low-poly stand-ins, used for any model not found in /assets/models.
// Cel-shaded and chunky — Highway-Warriors-flavored — so swapping in the real
// kits (which get toonify()'d on load) isn't jarring.

const mat = toonMat;

// neon arcade paint jobs; index 0 is the hero car
export const CAR_COLORS = [0xff2e8a, 0x00d9ff, 0xa3ff2e, 0xff9a1f, 0x8b5cf6, 0xffe93b];

/** Blob shadow + neon underglow, attachable to any car (procedural or GLB). */
export function carGroundFx(paint: number): THREE.Group {
  const g = new THREE.Group();
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.6, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  shadow.scale.set(0.75, 1.2, 1);
  g.add(shadow);

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.3, 4.1),
    new THREE.MeshBasicMaterial({
      color: paint, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.035;
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

export function buildCar(colorIndex = 0): THREE.Group {
  const outer = new THREE.Group();
  // parts are authored nose-at--z; the game treats +z as the model's front,
  // so everything solid goes in an inner group flipped 180°
  const g = new THREE.Group();
  g.rotation.y = Math.PI;
  outer.add(g);
  const paint = CAR_COLORS[colorIndex % CAR_COLORS.length];
  const paintMat = mat(paint);
  const trim = mat(0x1c2130);

  const body = new THREE.Mesh(profileGeometry(BODY_PROFILE, 1.7), paintMat);
  g.add(body);
  g.add(outlineFor(body, 1.03)); // cel outline

  // narrower cabin on top for the classic stepped two-box silhouette
  const cabin = new THREE.Mesh(profileGeometry(CABIN_PROFILE, 1.26), paintMat);
  g.add(cabin);
  g.add(outlineFor(cabin, 1.04));

  // glass band wrapping the cabin sides, proud of cabin + outline
  const glass = mat(0x16233a);
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

  // blob shadow + underglow (shadow maps are too costly for the MiniPay webview)
  outer.add(carGroundFx(paint));

  return outer;
}

let windowTexture: THREE.Texture | null = null;
function getWindowTexture(): THREE.Texture {
  if (windowTexture) return windowTexture;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2a3140';
  ctx.fillRect(0, 0, 64, 128);
  for (let y = 6; y < 122; y += 14) {
    for (let x = 6; x < 58; x += 12) {
      ctx.fillStyle = Math.random() < 0.55 ? '#ffe9a8' : '#1a1f2b';
      ctx.fillRect(x, y, 7, 9);
    }
  }
  windowTexture = new THREE.CanvasTexture(c);
  windowTexture.magFilter = THREE.NearestFilter;
  return windowTexture;
}

const CITY_TONES = [0x8a94a8, 0x707a90, 0x9aa0b5, 0x6b7488, 0x7d8ba0];

export function buildCityBuilding(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const w = 5 + rand() * 5;
  const h = 8 + rand() * 22;
  const d = 5 + rand() * 5;
  const tone = CITY_TONES[Math.floor(rand() * CITY_TONES.length)];

  const winMat = mat(0xffffff, { map: getWindowTexture() });
  const topMat = mat(tone);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    [winMat, winMat, topMat, topMat, winMat, winMat]
  );
  body.position.y = h / 2;
  g.add(body);

  if (rand() < 0.4) {
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 0.4, 1.6, d * 0.4), mat(0x4a5266));
    roof.position.y = h + 0.8;
    g.add(roof);
  }
  return g;
}

const DESERT_TONES = [0xd9b98a, 0xc9a878, 0xe0c49a, 0xbf9d70];

export function buildDesertBuilding(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const w = 4 + rand() * 4;
  const h = 3 + rand() * 4;
  const d = 4 + rand() * 4;
  const tone = DESERT_TONES[Math.floor(rand() * DESERT_TONES.length)];

  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(tone));
  body.position.y = h / 2;
  g.add(body);

  const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 0.1), mat(0x5b4a35));
  door.position.set(0, 0.75, d / 2 + 0.05);
  g.add(door);

  if (rand() < 0.5) {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(Math.min(w, d) * 0.35, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      mat(tone)
    );
    dome.position.y = h;
    g.add(dome);
  }
  return g;
}

export function buildCactus(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const green = mat(0x4f9e57);
  const h = 1.6 + rand() * 1.6;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, h, 6), green);
  trunk.position.y = h / 2;
  g.add(trunk);
  if (rand() < 0.7) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.9, 6), green);
    arm.position.set(0.38, h * 0.6, 0);
    arm.rotation.z = -0.5;
    g.add(arm);
  }
  return g;
}

export function buildStreetlight(): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.6, 6), mat(0x3a4050));
  pole.position.y = 2.3;
  g.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.08), mat(0x3a4050));
  arm.position.set(-0.5, 4.55, 0);
  g.add(arm);
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.1, 0.18),
    mat(0xfff3c4, { emissive: 0xffedad, emissiveIntensity: 1.2 })
  );
  lamp.position.set(-1.0, 4.5, 0);
  g.add(lamp);
  return g;
}

const MEDIEVAL_WALL = [0xd8cbb0, 0xcfc0a2, 0xe0d4bc];

export function buildMedievalHouse(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const w = 4 + rand() * 3;
  const h = 2.6 + rand() * 1.8;
  const d = 4 + rand() * 3;
  const wall = MEDIEVAL_WALL[Math.floor(rand() * MEDIEVAL_WALL.length)];

  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(wall));
  body.position.y = h / 2;
  g.add(body);

  // timber frame stripes
  const beam = mat(0x5b4632);
  for (const x of [-w / 2 + 0.15, w / 2 - 0.15]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.22, h, 0.22), beam);
    b.position.set(x, h / 2, d / 2 + 0.02);
    g.add(b);
  }
  const cross = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, 0.22), beam);
  cross.position.set(0, h * 0.55, d / 2 + 0.02);
  g.add(cross);

  // gabled roof (prism)
  const roofH = 1.4 + rand() * 1.2;
  const roof = new THREE.Mesh(
    prismGeometry(w * 1.15, roofH, d * 1.12),
    mat(rand() < 0.5 ? 0x8a4a3a : 0x6e4433)
  );
  roof.position.y = h;
  g.add(roof);

  const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 0.1), mat(0x4a3826));
  door.position.set(0, 0.75, d / 2 + 0.06);
  g.add(door);
  return g;
}

function prismGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const hw = w / 2, hd = d / 2;
  const geo = new THREE.BufferGeometry();
  const verts = new Float32Array([
    // front triangle
    -hw, 0, hd, hw, 0, hd, 0, h, hd,
    // back triangle
    hw, 0, -hd, -hw, 0, -hd, 0, h, -hd,
    // left slope
    -hw, 0, hd, 0, h, hd, 0, h, -hd, -hw, 0, hd, 0, h, -hd, -hw, 0, -hd,
    // right slope
    hw, 0, hd, hw, 0, -hd, 0, h, -hd, hw, 0, hd, 0, h, -hd, 0, h, hd
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return geo;
}

// bright coastal paint jobs — Lagos / Mumbai facades
const PAINT_TONES = [0xd86a3a, 0x3a8ad8, 0xd8b83a, 0x4aa86a, 0xc85a8a, 0x8a6ad8];

export function buildColorfulBuilding(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const w = 4.5 + rand() * 4;
  const h = 5 + rand() * 9;
  const d = 4.5 + rand() * 4;
  const tone = PAINT_TONES[Math.floor(rand() * PAINT_TONES.length)];

  const winMat = mat(0xffffff, { map: getWindowTexture() });
  const wallMat = mat(tone);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    [winMat, winMat, wallMat, wallMat, winMat, winMat]
  );
  body.position.y = h / 2;
  g.add(body);

  // painted parapet band on the roofline
  const band = new THREE.Mesh(new THREE.BoxGeometry(w * 1.04, 0.5, d * 1.04), mat(0xf2ead8));
  band.position.y = h - 0.2;
  g.add(band);
  if (rand() < 0.5) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.2, 8), mat(0x2c2f38));
    tank.position.set((rand() - 0.5) * w * 0.4, h + 0.6, 0);
    g.add(tank);
  }
  return g;
}

export function buildPalm(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const trunk = mat(0x8a6a48);
  const h = 3.4 + rand() * 2.2;
  const lean = (rand() - 0.5) * 0.5;
  // three stacked segments fake the curve
  for (let i = 0; i < 3; i++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.14 - i * 0.02, 0.17 - i * 0.02, h / 3 + 0.1, 6), trunk);
    seg.position.set(lean * i * 0.5, h / 6 + (h / 3) * i, 0);
    seg.rotation.z = lean * (i + 1) * 0.22;
    g.add(seg);
  }
  const top = new THREE.Vector3(lean * 1.4, h, 0);
  const frond = mat(0x3f9a4f);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rand() * 0.5;
    const f = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 0.5), frond);
    f.position.set(top.x + Math.cos(a) * 0.85, top.y, top.z + Math.sin(a) * 0.85);
    f.rotation.y = -a;
    f.rotation.z = 0.45; // droop
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

export function buildTree(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const h = 1.6 + rand() * 1.4;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, h, 6), mat(0x6a4f38));
  trunk.position.y = h / 2;
  g.add(trunk);
  const leaf = mat(rand() < 0.5 ? 0x4f8a3f : 0x5f9a48);
  const r = 1.1 + rand() * 0.9;
  const crown = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), leaf);
  crown.position.y = h + r * 0.7;
  crown.scale.y = 0.85;
  g.add(crown);
  if (rand() < 0.5) {
    const side = new THREE.Mesh(new THREE.SphereGeometry(r * 0.55, 7, 5), leaf);
    side.position.set(r * 0.7, h + r * 0.45, (rand() - 0.5) * r);
    g.add(side);
  }
  return g;
}

const PAGODA_WALLS = [0x9a4038, 0x8a8a92, 0xb0a890];

export function buildPagodaHouse(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const w = 4 + rand() * 3;
  const h = 2.4 + rand() * 1.4;
  const d = 4 + rand() * 2.5;
  const wall = PAGODA_WALLS[Math.floor(rand() * PAGODA_WALLS.length)];

  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(wall));
  body.position.y = h / 2;
  g.add(body);

  // wide overhanging tiled roof; taller houses get a second tier
  const roofMat = mat(0x3a4a5a);
  const roof = new THREE.Mesh(prismGeometry(w * 1.5, 1.1 + rand() * 0.5, d * 1.4), roofMat);
  roof.position.y = h;
  g.add(roof);
  if (rand() < 0.45) {
    const upper = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, h * 0.6, d * 0.55), mat(wall));
    upper.position.y = h + 1.1;
    g.add(upper);
    const roof2 = new THREE.Mesh(prismGeometry(w * 0.9, 0.8, d * 0.85), roofMat);
    roof2.position.y = h + 1.1 + h * 0.3;
    g.add(roof2);
  }
  // gold ridge trim
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(w * 1.5, 0.12, 0.2), mat(0xd8a848));
  ridge.position.y = h + 1.05;
  g.add(ridge);

  const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.6, 0.1), mat(0x5a2f28));
  door.position.set(0, 0.8, d / 2 + 0.06);
  g.add(door);
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

const BRICK_TONES = [0x8a5344, 0x7a4a3e, 0x96604a];

export function buildTerraceHouse(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const w = 4 + rand() * 2.5;
  const h = 4.5 + rand() * 2;
  const d = 4 + rand() * 2;
  const brick = BRICK_TONES[Math.floor(rand() * BRICK_TONES.length)];

  const winMat = mat(0xffffff, { map: getWindowTexture() });
  const wallMat = mat(brick);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    [winMat, winMat, wallMat, wallMat, winMat, winMat]
  );
  body.position.y = h / 2;
  g.add(body);

  const roof = new THREE.Mesh(prismGeometry(w * 1.06, 1.3, d * 1.04), mat(0x3f4550));
  roof.position.y = h;
  g.add(roof);

  // chimney pots — the London silhouette
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.1, 0.55), mat(brick));
  chimney.position.set(w * 0.3, h + 1.15, 0);
  g.add(chimney);
  for (const x of [-0.12, 0.12]) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.4, 6), mat(0xc9a084));
    pot.position.set(w * 0.3 + x, h + 1.85, 0);
    g.add(pot);
  }

  const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.6, 0.1), mat(rand() < 0.4 ? 0x2a4a7a : 0x2f2f36));
  door.position.set(-w * 0.25, 0.8, d / 2 + 0.06);
  g.add(door);
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

const AWNING_TONES = [0xd8452e, 0x2e8ad8, 0xd8a82e, 0x3aa85f];

export function buildStall(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const w = 2.4 + rand() * 1.2;
  const tone = AWNING_TONES[Math.floor(rand() * AWNING_TONES.length)];

  const counter = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, 1.2), mat(0x7a5a3a));
  counter.position.y = 0.45;
  g.add(counter);

  const poleMat = mat(0x4a3a28);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 5), poleMat);
    p.position.set(sx * (w / 2 - 0.1), 1.1, sz * 0.55);
    g.add(p);
  }

  // striped awning: alternating slats reads as stripes from race distance
  for (let i = 0; i < 4; i++) {
    const slat = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.3, 0.06, 0.42),
      mat(i % 2 === 0 ? tone : 0xf2ead8)
    );
    slat.position.set(0, 2.25 - i * 0.06, -0.6 + i * 0.42);
    slat.rotation.x = 0.18;
    g.add(slat);
  }

  // crates of un-lootable goods
  for (let i = 0; i < 2 + Math.floor(rand() * 2); i++) {
    const c = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.3, 0.4),
      mat(PAINT_TONES[Math.floor(rand() * PAINT_TONES.length)])
    );
    c.position.set((rand() - 0.5) * (w - 0.6), 1.05, (rand() - 0.5) * 0.6);
    c.rotation.y = rand();
    g.add(c);
  }
  return g;
}

const ZOMBIE_SHIRTS = [0x6b4f8a, 0x8a4f4f, 0x4f6b8a, 0x55604a];

export function buildZombie(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const skin = mat(0x7fae5a); // sickly green
  const shirt = mat(ZOMBIE_SHIRTS[Math.floor(rand() * ZOMBIE_SHIRTS.length)]);

  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.6, 0.26), mat(0x3a3f4a));
  legs.position.y = 0.3;
  g.add(legs);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.32), shirt);
  torso.position.y = 0.9;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.36), skin);
  head.position.y = 1.42;
  head.rotation.z = (rand() - 0.5) * 0.4; // lolling head
  g.add(head);

  // arms stretched forward (zombie shamble)
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.62), skin);
    arm.position.set(side * 0.36, 1.06, 0.4);
    arm.rotation.x = -0.15;
    g.add(arm);
  }
  return g;
}

/**
 * Boss zombie: a hulking, blood-red brute. Same silhouette as buildZombie but
 * bulkier and scaled up, so it reads as a mini-boss on the horde track.
 */
export function buildBossZombie(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const flesh = mat(0x8a2f22, { emissive: 0x501208, emissiveIntensity: 0.55 }); // angry red
  const dark = mat(0x2a1512);

  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.42), dark);
  legs.position.y = 0.4;
  g.add(legs);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.9, 0.5), flesh);
  torso.position.y = 1.35;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.56, 0.52), flesh);
  head.position.y = 2.05;
  head.rotation.z = (rand() - 0.5) * 0.3;
  g.add(head);

  // glowing eyes so it stands out in the horde
  const eyeMat = mat(0xffdd22, { emissive: 0xffaa00, emissiveIntensity: 1 });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.06), eyeMat);
    eye.position.set(side * 0.14, 2.08, 0.28);
    g.add(eye);
  }

  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.9), flesh);
    arm.position.set(side * 0.6, 1.5, 0.5);
    arm.rotation.x = -0.2;
    g.add(arm);
  }

  g.scale.multiplyScalar(1.35);
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
  const pillarMat = mat(0x30353f);
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.7, 6.4, 0.7), pillarMat);
    p.position.set(side * (width / 2), 3.2, 0);
    g.add(p);
  }
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 16; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#111111';
      ctx.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(width, 1.4, 0.15),
    new THREE.MeshBasicMaterial({ map: tex })
  );
  banner.position.y = 5.9;
  g.add(banner);
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

export function buildPyramid(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const baseW = 12 + rand() * 14;
  const height = baseW * (0.65 + rand() * 0.2);
  const pyr = new THREE.Mesh(
    new THREE.ConeGeometry(baseW, height, 4),
    mat(0xcaa268)
  );
  pyr.position.y = height / 2;
  pyr.rotation.y = Math.PI / 4;
  g.add(pyr);
  g.add(outlineFor(pyr, 1.02));
  return g;
}

export function buildObelisk(): THREE.Group {
  const g = new THREE.Group();
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.9, 11, 4),
    mat(0xb89868)
  );
  pillar.position.y = 5.5;
  pillar.rotation.y = Math.PI / 4;
  g.add(pillar);
  g.add(outlineFor(pillar));

  const cap = new THREE.Mesh(
    new THREE.ConeGeometry(0.7, 1.4, 4),
    mat(0xffe93b, { emissive: 0xbfa018, emissiveIntensity: 0.6 })
  );
  cap.position.y = 11 + 0.7;
  cap.rotation.y = Math.PI / 4;
  g.add(cap);
  return g;
}

export function buildFavelaHouse(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const colors = [0xff5c5c, 0x48b6ff, 0xffcd38, 0x5ce67c, 0xeb6b34, 0x9c5cff];
  const tiers = 2 + Math.floor(rand() * 2);
  let curY = 0;
  for (let i = 0; i < tiers; i++) {
    const w = (tiers - i) * 2.2 + rand() * 1.5;
    const d = (tiers - i) * 2.2 + rand() * 1.5;
    const h = 2.2 + rand() * 0.8;
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(colors[Math.floor(rand() * colors.length)]));
    box.position.set((rand() * 0.6 - 0.3), curY + h / 2, (rand() * 0.6 - 0.3));
    g.add(box);
    g.add(outlineFor(box));
    curY += h;
  }
  return g;
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

export function buildBossTruck(paint = 0x2d343e): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.8, 5.4), mat(paint));
  body.position.y = 1.3;
  g.add(body);
  g.add(outlineFor(body));

  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.3, 2.2), mat(0x1a1d24));
  cab.position.set(0, 2.4, -0.6);
  g.add(cab);
  g.add(outlineFor(cab));

  const bullbar = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.8, 0.4), mat(0x768294));
  bullbar.position.set(0, 0.9, -2.8);
  g.add(bullbar);

  // Siren
  const siren = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.25, 0.4),
    new THREE.MeshBasicMaterial({ color: 0xff3b3b })
  );
  siren.position.set(0, 3.15, -0.6);
  g.add(siren);

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
  g.add(outlineFor(ramp));
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
