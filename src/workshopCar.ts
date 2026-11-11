import * as T from 'three';
import type { CarSpec } from './cars';
import { carParts, loft, section, smooth } from './carKit';
import { freshBuild } from './workshop';

// RUSH ONE's hardpoints. Nose is +Z; every part mounts off these.
const FRONT = 2.12, REAR = -2.08;
const AXLES = [1.34, -1.27];
const WHEEL_R = 0.37, ARCH_R = 0.45;
const SCALE = .93; // keep the 3.9 m race collision footprint

/**
 * Original RUSH ONE: a wide mid-engine berlinetta lofted from cross-sections. It
 * sits beside the garage's model cars rather than looking like a kit of boxes.
 * Every part shares the hardpoints above. Parts are merged per material, so the
 * whole car costs a handful of draw calls however it is built.
 */
export function buildWorkshopCar(spec: CarSpec): T.Group {
  const g = new T.Group(); g.userData.workshopCar = true;
  const p = (spec.build ?? freshBuild()).parts;
  const wide = p.body === 'wide';
  const paint = new T.MeshPhysicalMaterial({ color: spec.color, metalness: .48, roughness: .24, clearcoat: 1, clearcoatRoughness: .10 });
  const black = new T.MeshStandardMaterial({ color: 0x14181e, roughness: .6 });
  const carbon = new T.MeshPhysicalMaterial({ color: 0x11151c, metalness: .45, roughness: .3, clearcoat: .8, side: T.DoubleSide });
  const glass = new T.MeshPhysicalMaterial({ color: 0x07121b, metalness: .25, roughness: .18, clearcoat: 1 });
  const metal = new T.MeshStandardMaterial({ color: p.wheels === 'turbine' ? 0xd4aa5a : p.wheels === 'disc' ? 0xe8ebe4 : 0x9aabbc, metalness: .85, roughness: .22 });
  const steel = new T.MeshStandardMaterial({ color: 0x5b6168, metalness: .8, roughness: .35 });
  const rubber = new T.MeshStandardMaterial({ color: 0x121417, roughness: .92, side: T.DoubleSide });
  const well = new T.MeshStandardMaterial({ color: 0x08090b, roughness: 1, side: T.DoubleSide });
  const lamp = new T.MeshStandardMaterial({ color: 0xf4fbff, emissive: 0xd8f2ff, emissiveIntensity: 1.4 });
  const red = new T.MeshStandardMaterial({ color: 0xff2a36, emissive: 0xff1c2c, emissiveIntensity: 1.1 });
  const caliper = new T.MeshStandardMaterial({ color: 0xd62b2b, roughness: .4 });

  for (const material of [paint, metal, steel]) material.userData.carSurface = 1;
  glass.userData.carSurface = .5; carbon.userData.carSurface = .55;
  const { put, box, disc, finish } = carParts();

  // --- body: plan width, shoulder, fender crest and centreline, nose to tail
  const hips = (z: number) => wide ? .07 * Math.max(...AXLES.map(a => Math.exp(-(((z - a) / .55) ** 2)))) : 0;
  const halfWidth = smooth([[REAR, .88], [-1.78, 1.0], [-1.27, 1.035], [-.8, .98], [-.2, .89], [.5, .92], [1.0, 1.0], [1.34, 1.015], [1.8, .96], [FRONT, .84]]);
  const width = (z: number) => halfWidth(z) + hips(z);
  const shoulder = smooth([[REAR, .74], [-1.75, .85], [-1.27, .88], [-.8, .76], [-.3, .61], [.5, .64], [1, .79], [1.34, .84], [1.8, .68], [FRONT, .43]]);
  const crest = smooth([[REAR, .83], [-1.75, .94], [-1.27, .95], [-.7, .83], [-.1, .77], [.6, .77], [1, .88], [1.34, .9], [1.8, .73], [FRONT, .48]]);
  const spine = smooth([[REAR, .82], [-1.8, .87], [-1.4, .88], [-1, .86], [0, .78], [.65, .73], [1.2, .64], [1.8, .51], [FRONT, .43]]);
  const sill = (z: number) => {
    let y = .24;
    for (const a of AXLES) if (Math.abs(z - a) < ARCH_R) y = Math.max(y, WHEEL_R + Math.sqrt(ARCH_R ** 2 - (z - a) ** 2));
    return Math.min(y, shoulder(z) - .07);
  };
  const bodyRing = (z: number) => {
    const w = width(z), b = sill(z), s = shoulder(z), c = crest(z), top = spine(z);
    const pts = section([[0, b], [(w - .12) * .5, b], [w - .12, b + Math.min(.04, (s - b) * .25)], [w - .03, b + (s - b) * .45],
      [w, s], [w - .16, c], [(w - .16) * .55, top + (c - top) * .3], [0, top]]);
    // round the nose off in plan and elevation; the tail stays square-cut
    const nose = Math.max(0, (z - (FRONT - .3)) / .3), tail = Math.max(0, ((REAR + .14) - z) / .14);
    const sf = Math.sqrt(1 - Math.min(1, nose) ** 2), sr = Math.sqrt(1 - Math.min(1, tail) ** 2);
    const sx = (.86 + .14 * sf) * (.94 + .06 * sr), sy = (.85 + .15 * sf) * (.93 + .07 * sr), cy = (b + top) / 2;
    return pts.map(q => q.set(q.x * sx, cy + (q.y - cy) * sy, 0));
  };
  // Follow the actual skin for flush-mounted lamps and aero details.
  const surfaceY = (x: number, z: number): number => {
    const ring = bodyRing(z); let y = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i+1)%ring.length];
      if (x >= Math.min(a.x,b.x) && x <= Math.max(a.x,b.x) && Math.abs(a.x-b.x) > .0001)
        y = Math.max(y, a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x));
    }
    return y;
  };
  const zs: number[] = [];
  for (let i = 0; i <= 72; i++) zs.push(REAR + (FRONT - REAR) * i / 72);
  for (const a of AXLES) for (const e of [-ARCH_R - .004, -ARCH_R + .004, ARCH_R - .004, ARCH_R + .004]) zs.push(a + e);
  zs.sort((a, b) => a - b);
  put(loft(zs, bodyRing), paint);
  box(1.42, .24, 3.5, black, 0, .32, 0); // chassis tub: closes the arches from below

  // A compact teardrop canopy, carbon roof and open engine deck.
  const CAB_F = .86, CAB_R = -1.12;
  const roof = smooth([[CAB_R, .86], [-.82, 1.03], [-.48, 1.21], [-.1, 1.23], [.22, 1.18], [.55, .96], [CAB_F, .73]]);
  const cabBase = smooth([[CAB_R, .61], [-.7, .71], [-.2, .74], [.45, .69], [CAB_F, .61]]);
  const cabTop = smooth([[CAB_R, .35], [-.7, .48], [-.3, .55], [.25, .51], [CAB_F, .48]]);
  const cabRing = (z: number) => {
    const yb = spine(z) - .035, yr = Math.max(roof(z), yb + .01), wb = cabBase(z), wt = cabTop(z);
    return section([[0, yb], [wb * .5, yb], [wb, yb], [wb - .035, yb + (yr - yb) * .42], [wt, yr - .04], [wt * .55, yr - .005], [0, yr]]);
  };
  const cabZs = Array.from({ length: 57 }, (_, i) => CAB_R + (CAB_F - CAB_R) * i / 56);
  put(loft(cabZs, cabRing), glass);
  const lifted = (z: number) => cabRing(z).map(q => q.set(q.x * 1.008, q.y + .012, 0));
  put(loft(cabZs.filter(z => z <= .2 && z >= -.51), lifted, 16, 32), carbon);

  // Sculpted panels rather than rectangular blocks for the aero surfaces.
  const panel = (points: number[][], material: T.Material) => {
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(points.flat(), 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(points.flatMap(q => [q[0], q[2]]), 2));
    const indices: number[] = [];
    for (let i = 1; i < points.length - 1; i++) indices.push(0, i, i + 1);
    geo.setIndex(indices); geo.computeVertexNormals();
    put(geo, material);
  };
  const line = (points: number[][], material: T.Material, radius = .018) => {
    const curve = new T.CatmullRomCurve3(points.map(q => new T.Vector3(...q as [number, number, number])));
    put(new T.TubeGeometry(curve, 16, radius, 5, false), material);
  };
  for (const s of [-1, 1]) {
    // A-pillars follow the glass; buttresses run into the rear shoulders.
    line([[s*.5,1.17,.2],[s*.58,1.03,.47],[s*.67,.82,.73]], paint, .025);
    line([[s*.49,1.19,-.48],[s*.65,1.01,-.79],[s*.81,.91,-1.12],[s*.85,.92,-1.53]], paint, .04);
    line([[s*.71,.8,.45],[s*.76,.8,-.25],[s*.7,.87,-.74]], carbon, .015);
    // Floating blade mirrors.
    box(.18, .025, .035, carbon, s*.81, .88, .52, 0, s*-.2);
    box(.18, .06, .115, paint, s*.94, .9, .5, 0, s*.2);
    box(.14, .035, .012, glass, s*.94, .9, .44);
  }
  box(1.05, .025, .56, carbon, 0, .9, -1.42);
  for (let i = 0; i < 7; i++) box(1.0, .018, .025, steel, 0, .918, -1.17 - i*.075);

  // Wide front splitter, recessed corner intakes and twin blade DRLs.
  panel([[-.94,.22,1.65],[-.94,.22,2.0],[-.68,.22,2.15],[.68,.22,2.15],[.94,.22,2.0],[.94,.22,1.65]], carbon);
  box(1.35, .125, .035, black, 0, .335, 2.137);
  for (const x of [-.55,-.35,-.15,.15,.35,.55]) box(.018,.11,.025,carbon,x,.335,2.16);
  for (const s of [-1, 1]) {
    panel([[s*.56,.26,2.12],[s*.87,.29,2.0],[s*.88,.52,1.95],[s*.66,.49,2.07]], carbon);
    const lampPoints = [[.54,1.94],[.72,1.88],[.87,1.73]].map(([x,z]) => [s*x,surfaceY(x,z)+.022,z]);
    line(lampPoints, black, .039);
    line(lampPoints.map(([x,y,z]) => [x,y+.022,z+.008]), lamp, .018);
    line(lampPoints.slice(0,2).map(([x,y,z]) => [x,y+.006,z+.045]), lamp, .009);
    // Hood channels define a lower central nose between raised front fenders.
    line([[s*.32,.46,2.02],[s*.4,.56,1.68],[s*.47,.67,1.25],[s*.53,.75,.9]], paint, .022);
    for (let k=0;k<3;k++) box(.11,.012,.23,carbon,s*(.73+k*.045),crest(1.3)-.012,1.28,0,s*.12);
  }
  // Small original nose badge.
  panel([[-.045,.487,1.92],[0,.475,2.0],[.045,.487,1.92],[0,.504,1.87]], steel);

  // Deep side air channel: a visible intake behind the door, edged by a blade.
  for (const s of [-1, 1]) {
    panel([[s*1.01,.34,-.77],[s*1.015,.78,-.84],[s*.98,.72,-.37],[s*.95,.48,.35],[s*.95,.34,.56]], carbon);
    line([[s*.96,.32,.58],[s*.97,.35,-.1],[s*1.025,.47,-.62],[s*1.035,.78,-.88]], paint, .022);
    panel([[s*.91,.23,.86],[s*1.0,.22,.78],[s*1.04,.22,-.83],[s*.95,.28,-.93]], carbon);
    line([[s*.76,.8,.48],[s*.88,.62,.56],[s*.91,.35,.53]], black, .006);
    box(.013,.018,.13,steel,s*.91,.7,-.18);
  }

  // Full-width rear graphic, slim red blades and a pronounced diffuser.
  box(1.63,.16,.04,carbon,0,.68,REAR-.007);
  box(1.32,.16,.035,carbon,0,.43,REAR-.012);
  box(1.54,.025,.05,red,0,.735,REAR-.033);
  for (const s of [-1,1]) {
    box(.035,.09,.04,red,s*.755,.7,REAR-.034);
    const pipe = new T.CylinderGeometry(.064,.064,.14,20); pipe.rotateX(Math.PI/2);
    put(pipe,steel,s*.42,.48,REAR-.025);
    const opening = new T.CircleGeometry(.047,20); opening.rotateY(Math.PI);
    put(opening,black,s*.42,.48,REAR-.1);
  }
  panel([[-.8,.21,REAR-.06],[.8,.21,REAR-.06],[.68,.35,REAR+.38],[-.68,.35,REAR+.38]],carbon);
  for (const x of [-.69,-.39,0,.39,.69]) box(.022,.12,.34,carbon,x,.28,REAR+.08,-.25);
  if (p.wing === 'clean') box(1.65,.028,.12,paint,0,.85,-2.01,.18);
  if (p.wing === 'duck') box(1.78,.075,.27,paint,0,.91,-1.99,.3);
  if (p.wing === 'gt') {
    for (const s of [-1, 1]) {
      box(.045,.33,.12,carbon,s*.57,1.05,-1.84, -.22);
      box(.025,.18,.42,carbon,s*.96,1.24,-1.94);
    }
    box(1.94,.045,.38,carbon,0,1.26,-1.94,-.08);
  }

  // --- wheels: rounded tyres, a brake disc and caliper behind the spokes
  const tyreProfile = [[.265, -.15], [.33, -.155], [.36, -.14], [.37, -.1], [.37, .1], [.36, .14], [.33, .155], [.265, .15]]
    .map(([r, y]) => new T.Vector2(r, y));
  for (const s of [-1, 1]) for (const z of AXLES) {
    const x = s * (wide ? .96 : .89), y = WHEEL_R;
    put(new T.LatheGeometry(tyreProfile, 32), rubber, x, y, z, 0, 0, Math.PI / 2);
    disc(.265, .035, well, x - s * .105, y, z, 32);
    disc(.21, .025, steel, x + s * .045, y, z, 24);
    box(.04, .14, .08, caliper, x + s * .065, y + .08, z - .15, -Math.PI / 4);
    if (p.wheels === 'disc') {
      disc(.25, .025, metal, x + s * .11, y, z);
      disc(.06, .04, black, x + s * .125, y, z, 16);
    } else {
      const count = p.wheels === 'turbine' ? 10 : 5;
      for (let k = 0; k < count; k++) {
        const a = k / count * Math.PI * 2;
        if (p.wheels === 'turbine') box(.02, .2, .045, metal, x + s * .1, y + Math.cos(a) * .15, z + Math.sin(a) * .15, a, .55);
        else for (const e of [-.1, .1]) box(.03, .2, .035, metal, x + s * .1, y + Math.cos(a + e) * .155, z + Math.sin(a + e) * .155, a + e);
      }
      disc(.065, .05, metal, x + s * .11, y, z, 16);
    }
    const lip = new T.TorusGeometry(.262, .013, 6, 32); lip.rotateY(Math.PI / 2);
    put(lip, metal, x + s * .115, y, z);
    // arch liner, so the wheel sits in a dark well rather than under bare paint
    put(new T.CylinderGeometry(ARCH_R - .02, ARCH_R - .02, .36, 20, 1, true, 0, Math.PI), well, s * .87, y, z, 0, 0, Math.PI / 2);
    if (wide) {
      const flare = new T.TorusGeometry(ARCH_R + .01, .025, 6, 32, Math.PI); flare.rotateY(Math.PI / 2);
      put(flare, carbon, s * (width(z) - .01), y, z);
    }
  }

  // --- body kits
  if (p.body === 'rally') {
    for (const s of [-1, 1]) box(.05, .07, .95, black, s * .44, roof(-.25) + .06, -.25);
    for (const z of [-.6, .1]) box(.95, .04, .04, steel, 0, roof(z) + .1, z);
    for (const x of [-.52, -.18, .18, .52]) {
      const light = new T.CylinderGeometry(.1, .1, .08, 16); light.rotateX(Math.PI / 2);
      put(light, lamp, x, .5, 1.99);
      const rim = new T.CylinderGeometry(.115, .115, .07, 16); rim.rotateX(Math.PI / 2);
      put(rim, black, x, .5, 1.96);
    }
    for (const s of [-1, 1]) for (const z of AXLES) box(.26, .2, .02, black, s * .8, .2, z - ARCH_R - .02);
  }

  return finish(g, SCALE);
}
