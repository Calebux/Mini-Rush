import * as THREE from 'three';
import { EnvironmentKit } from './environment';

/** Location-specific street silhouettes; the shared kit keeps scale/light coherent. */
export function localBuilding(id: string, kit: EnvironmentKit, rand: () => number,
  tall = false): THREE.Group {
  if (id === 'lagos') return kit.building(rand, tall);
  const g = new THREE.Group(), t = kit.theme;
  const wall = t.facade[Math.floor(rand() * t.facade.length)];
  const box = (x: number, y: number, z: number, w: number, h: number, d: number,
    color: number, glow = false) => kit.box(g, x, y, z, w, h, d, color, glow);
  const glass = t.night ? 0x425d76 : 0x66858b;
  g.name = `architecture-${id}`;

  if (id === 'london') {
    // Narrow brick townhouses: individual doors, sash windows, white lintels,
    // pitched slate roofs and chimneys. No tropical balconies or awnings.
    const floors = tall ? 5 : 3, h = floors * 2.8;
    for (const x of [-3.05, 3.05]) {
      box(x, h / 2, 0, 5.9, h, 7.4, wall);
      for (const side of [-1, 1]) {
        box(x, 0.24, side * 3.9, 6, 0.48, 0.5, t.pavement);
        box(x + 1.5, 1.15, side * 3.74, 1.05, 2.3, 0.12, t.accent);
        for (let f = 0; f < floors; f++) {
          for (const col of [-1.55, 0.1, 1.7]) {
            if (!f && col > 1) continue;
            const y = f * 2.8 + 1.65;
            box(x + col, y, side * 3.78, 1.13, 1.65, 0.12, 0xe1dbca);
            box(x + col, y, side * 3.86, 0.88, 1.38, 0.07, glass);
            box(x + col, y, side * 3.91, 0.92, 0.07, 0.08, 0xe1dbca);
          }
          box(x, f * 2.8 + 2.75, side * 3.75, 6, 0.12, 0.28, 0xcac0ac);
        }
      }
      for (const side of [-1, 1]) {
        const roof = box(x + side * 1.52, h + 0.85, 0, 3.5, 0.2, 8, 0x53616d);
        roof.rotation.z = -side * 0.48;
      }
      box(x + 2.4, h + 1.5, 0.9, 0.72, 2.2, 1.2, wall);
      for (const z of [0.55, 1.25]) box(x + 2.4, h + 2.8, z, 0.3, 0.6, 0.3, 0x895444);
    }
    return g;
  }

  if (['neon', 'tokyo', 'seoul', 'beijing', 'saopaulo'].includes(id)) {
    // Contemporary cities get curtain walls, not the Lagos stucco facade.
    const w = 7 + rand() * 4, d = 7 + rand() * 3;
    const floors = (tall ? 10 : 5) + Math.floor(rand() * 6), h = floors * 3;
    box(0, h / 2, 0, w, h, d, glass);
    const cyber = id === 'neon', tokyo = id === 'tokyo';
    for (let f = 0; f <= floors; f++) {
      const y = f * 3;
      box(0, y, 0, w + 0.35, cyber ? 0.12 : 0.3, d + 0.35,
        cyber && f % 3 === 0 ? t.accent : wall, cyber && f % 3 === 0);
    }
    for (const side of [-1, 1]) {
      for (let col = -2; col <= 2; col++) {
        box(col * w / 5, h / 2, side * (d / 2 + 0.05), 0.13, h, 0.18, wall);
        if (t.night) for (let f = 0; f < floors; f++) {
          if (rand() > 0.35) continue;
          box(col * w / 5 + w / 10, f * 3 + 1.5, side * (d / 2 + 0.07),
            w / 5 - 0.3, 1.8, 0.08, id === 'seoul' ? 0xc6edee : 0xffd9a1, true);
        }
      }
      if (cyber || tokyo) {
        const neon = cyber ? 0xf15aa7 : 0xffae62;
        box(side * w * 0.38, h * 0.48, side * (d / 2 + 0.3), 1.15, h * 0.66, 0.5, neon, true);
        for (let mark = 0; mark < 5; mark++) {
          box(side * w * 0.38, h * (0.23 + mark * 0.11), side * (d / 2 + 0.57),
            0.65, 0.18, 0.05, 0x2b3549);
        }
      }
      if (id === 'saopaulo') {
        for (const x of [-w * 0.36, w * 0.36]) {
          box(x, h / 2, side * (d / 2 + 0.5), 0.65, h + 1, 1.1, 0xc9c4b5);
        }
      }
    }
    box(0, h + 0.8, 0, w * 0.55, 1.6, d * 0.6, wall);
    box(0, 2.7, d / 2 + 0.85, w + 0.4, 0.25, 2.2, t.accent, cyber);
    if (id === 'seoul') box(w * 0.3, h + 3, 0, 0.14, 6, 0.14, t.accent, true);
    return g;
  }

  if (id === 'accra' || id === 'nairobi' || id === 'cairo') {
    const floors = id === 'cairo' ? 2 + Math.floor(rand() * 2) : tall ? 4 : 2;
    const h = floors * 3.2, w = 10, d = 7;
    box(0, h / 2, 0, w, h, d, wall);
    for (const side of [-1, 1]) {
      for (let f = 0; f < floors; f++) {
        for (const x of [-3.5, 0, 3.5]) {
          box(x, f * 3.2 + 1.6, side * 3.53, 1.65, 1.85, 0.1, glass);
          if (id !== 'cairo') {
            for (const sx of [-1, 1]) box(x + sx * 1.02, f * 3.2 + 1.6, side * 3.63,
              0.35, 2, 0.12, t.accent);
          }
        }
        box(0, f * 3.2 + 0.2, side * 4.1, 11, 0.3, 1.9, t.pavement);
        for (const x of [-5, -1.7, 1.7, 5]) box(x, f * 3.2 + 1.65, side * 4.6,
          0.35, 3.3, 0.35, id === 'nairobi' ? t.accent : t.pavement);
      }
    }
    if (id === 'accra') {
      for (const side of [-1, 1]) {
        const roof = box(side * 2.75, h + 0.95, 0, 6, 0.23, 10, 0xb75d40);
        roof.rotation.z = -side * 0.35;
      }
    } else {
      box(0, h + 0.3, 0, 10.7, 0.6, 8.3, t.pavement);
      if (id === 'cairo') {
        const dome = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), kit.material(t.pavement));
        dome.position.y = h + 0.6; g.add(dome);
      } else box(0, h + 1, 0, 6, 1.1, 4, t.accent);
    }
    return g;
  }

  if (id === 'mumbai' || id === 'rio') {
    // Art-deco / beachfront apartments: wraparound horizontal balconies,
    // rounded stair towers, and roof fins instead of a window-grid wall.
    const floors = tall ? 8 : 3 + Math.floor(rand() * 3), h = floors * 3;
    box(0, h / 2, 0, 9, h, 7, wall);
    for (let f = 0; f < floors; f++) {
      for (const side of [-1, 1]) {
        box(0, f * 3 + 1.6, side * 3.55, 8.2, 1.6, 0.1, glass);
        box(0, f * 3 + 0.35, side * 4, 10.6, 0.22, 2, t.pavement);
        box(0, f * 3 + 1, side * 4.8, 10.6, 0.65, 0.18, id === 'rio' ? 0xe2e2cd : t.accent);
      }
    }
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, h + 2, 12), kit.material(t.accent));
    tower.position.set(4.5, h / 2 + 1, 0); g.add(tower);
    for (const x of [-0.7, 0, 0.7]) box(x, h + 1.3, 0, 0.3, 2.6, 7.5, t.pavement);
    return g;
  }
  return kit.building(rand, tall);
}

/** Recognisable, stylised local landmarks, deliberately off the racing line. */
export function localLandmark(id: string, kit: EnvironmentKit): THREE.Group | null {
  const g = new THREE.Group(), t = kit.theme;
  g.name = `landmark-${id}`;
  const box = (x: number, y: number, z: number, w: number, h: number, d: number,
    color = t.pavement, glow = false) => kit.box(g, x, y, z, w, h, d, color, glow);
  if (id === 'london') {
    box(0, 13, 0, 5, 26, 5, 0xc9af84);
    for (const y of [1, 17, 23, 26]) box(0, y, 0, 6, 0.6, 6, 0xe0d1ad);
    for (const side of [-1, 1]) {
      const face = new THREE.Mesh(new THREE.CircleGeometry(1.65, 24), kit.material(0xffefc8));
      face.position.set(0, 21, side * 2.56); face.rotation.y = side < 0 ? Math.PI : 0; g.add(face);
      box(0, 21.55, side * 2.6, 0.12, 1.1, 0.08, 0x36414a);
      box(0.5, 21, side * 2.6, 1, 0.12, 0.08, 0x36414a);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4.4, 9, 4), kit.material(0x435c62));
    roof.rotation.y = Math.PI / 4; roof.position.y = 30.5; g.add(roof);
  } else if (id === 'lagos') {
    // Cable-stayed lagoon bridge pylon, a landmark on the water rather than
    // fake collision geometry across the driveable circuit.
    for (const x of [-4, 4]) box(x, 17, 0, 1.4, 34, 1.8, 0xd4c6ae);
    box(0, 26, 0, 9, 1.2, 1.8, 0xd4c6ae); box(0, 6, 0, 12, 0.7, 38, 0xacb3ae);
    for (const side of [-1, 1]) for (let i = 1; i < 6; i++) {
      const z = side * i * 3.3, y = 30 - i * 1.2;
      for (const x of [-4, 4]) {
        const cable = box(x, (y + 6) / 2, z / 2, 0.06, Math.hypot(y - 6, z), 0.06, 0xe2d8be);
        cable.rotation.x = Math.atan2(-z, y - 6);
      }
    }
  } else if (id === 'mumbai' || id === 'accra' || id === 'beijing') {
    for (const x of [-5, 5]) box(x, 6, 0, 3, 12, 5);
    box(0, 11, 0, 13, 3, 5); box(0, 13, 0, 15, 0.7, 6);
    if (id === 'accra') {
      const shape = new THREE.Shape();
      for (let i = 0; i < 10; i++) {
        const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 1.05 : 2.5;
        if (!i) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      shape.closePath();
      const star = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false }), kit.material(0x253d40));
      star.position.set(0, 15.5, 0); g.add(star);
    } else for (const x of [-5, 5]) {
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 4, id === 'beijing' ? 4 : 12), kit.material(t.accent));
      roof.position.set(x, 15.2, 0); roof.rotation.y = Math.PI / 4; g.add(roof);
    }
  } else if (id === 'seoul' || id === 'nairobi') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(id === 'seoul' ? 1 : 3, 2.5, 31, 12), kit.material(t.pavement));
    shaft.position.y = 15.5; g.add(shaft);
    for (const y of [26, 29]) {
      const deck = new THREE.Mesh(new THREE.CylinderGeometry(5, 4, 2.2, 16), kit.material(t.accent));
      deck.position.y = y; g.add(deck);
    }
    box(0, 37, 0, 0.3, 17, 0.3, t.accent, t.night);
  } else if (id === 'saopaulo') {
    for (const x of [-9, 9]) box(x, 8, 0, 1.4, 16, 9, 0xd94d43);
    box(0, 11, 0, 19, 6, 8, 0x6c929d); box(0, 14.5, 0, 22, 1.2, 9, 0xd94d43);
  } else if (id === 'tokyo') {
    for (const x of [-5, 5]) box(x, 6, 0, 0.85, 12, 0.85, 0xcb5340);
    box(0, 10.5, 0, 13, 0.8, 1, 0xcb5340); box(0, 12, 0, 15, 0.7, 1.5, 0x344755);
  } else if (id === 'cairo') {
    const pyramid = new THREE.Mesh(new THREE.ConeGeometry(22, 28, 4), kit.material(0xdcc099));
    pyramid.position.y = 14; pyramid.rotation.y = Math.PI / 4; g.add(pyramid);
  } else if (id === 'cota' || id === 'cartoonoval') {
    for (const x of [-3.5, 3.5]) box(x, 14, 0, 0.6, 28, 0.6, t.accent);
    box(0, 27, 0, 11, 2, 8, 0xdadfd8);
    if (id === 'cota') for (let i = 0; i < 9; i++) box(0, 27 - i * 2.5, -i * 0.5,
      0.35, 2.8, 0.35, 0xd74d42);
  } else return null;
  return g;
}
