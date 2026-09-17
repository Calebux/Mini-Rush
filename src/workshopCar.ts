import * as T from 'three';
import type { CarSpec } from './cars';
import { carParts, loft, section, slope, smooth } from './carKit';
import { freshBuild } from './workshop';

// RUSH ONE's hardpoints. Nose is +Z; every part mounts off these.
const FRONT = 2.02, REAR = -1.98;
const AXLES = [1.3, -1.22];
const WHEEL_R = 0.37, ARCH_R = 0.45;
const SCALE = .96; // 3.9 m nose to tail, like the garage's model cars

/**
 * Original RUSH ONE: a low mid-engine coupe lofted from cross-sections, so it
 * sits beside the garage's model cars rather than looking like a kit of boxes.
 * Every part shares the hardpoints above. Parts are merged per material, so the
 * whole car costs a handful of draw calls however it is built.
 */
export function buildWorkshopCar(spec: CarSpec): T.Group {
  const g = new T.Group(); g.userData.workshopCar = true;
  const p = (spec.build ?? freshBuild()).parts;
  const wide = p.body === 'wide';
  const paint = new T.MeshPhysicalMaterial({ color: spec.color, metalness: .22, roughness: .3, clearcoat: .55, clearcoatRoughness: .14 });
  const black = new T.MeshStandardMaterial({ color: 0x14181e, roughness: .6 });
  const carbon = new T.MeshPhysicalMaterial({ color: 0x1c2026, metalness: .3, roughness: .32, clearcoat: .7 });
  const glass = new T.MeshPhysicalMaterial({ color: 0x0f1b24, metalness: .5, roughness: .08, clearcoat: 1 });
  const metal = new T.MeshStandardMaterial({ color: p.wheels === 'turbine' ? 0xd4aa5a : p.wheels === 'disc' ? 0xe8ebe4 : 0xc9ced3, metalness: .85, roughness: .22 });
  const steel = new T.MeshStandardMaterial({ color: 0x5b6168, metalness: .8, roughness: .35 });
  const rubber = new T.MeshStandardMaterial({ color: 0x121417, roughness: .92, side: T.DoubleSide });
  const well = new T.MeshStandardMaterial({ color: 0x08090b, roughness: 1, side: T.DoubleSide });
  const lamp = new T.MeshStandardMaterial({ color: 0xf4fbff, emissive: 0xd8f2ff, emissiveIntensity: 1.4 });
  const red = new T.MeshStandardMaterial({ color: 0xff2a36, emissive: 0xff1c2c, emissiveIntensity: 1.1 });
  const caliper = new T.MeshStandardMaterial({ color: 0xd62b2b, roughness: .4 });

  const { put, box, disc, finish } = carParts();

  // --- body: plan width, shoulder, fender crest and centreline, nose to tail
  const hips = (z: number) => wide ? .07 * Math.max(...AXLES.map(a => Math.exp(-(((z - a) / .55) ** 2)))) : 0;
  const halfWidth = smooth([[REAR, .9], [-1.6, .97], [-1.22, .985], [-.7, .95], [-.2, .9], [.5, .89], [1, .93], [1.3, .94], [1.7, .9], [FRONT, .8]]);
  const width = (z: number) => halfWidth(z) + hips(z);
  const shoulder = smooth([[REAR, .78], [-1.6, .86], [-1.22, .88], [-.8, .8], [-.3, .7], [.5, .7], [.95, .82], [1.3, .86], [1.7, .78], [1.95, .6], [FRONT, .5]]);
  const crest = smooth([[REAR, .9], [-1.6, .97], [-1.22, .98], [-.7, .92], [-.1, .86], [.6, .86], [1, .9], [1.3, .92], [1.7, .82], [1.95, .64], [FRONT, .54]]);
  const spine = smooth([[REAR, .86], [-1.8, .94], [-1.5, .95], [-1, .93], [0, .88], [.95, .8], [1.3, .8], [1.7, .72], [1.95, .58], [FRONT, .52]]);
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
    const sx = (.62 + .38 * sf) * (.86 + .14 * sr), sy = (.6 + .4 * sf) * (.8 + .2 * sr), cy = (b + top) / 2;
    return pts.map(q => q.set(q.x * sx, cy + (q.y - cy) * sy, 0));
  };
  const zs: number[] = [];
  for (let i = 0; i <= 72; i++) zs.push(REAR + (FRONT - REAR) * i / 72);
  for (const a of AXLES) for (const e of [-ARCH_R - .004, -ARCH_R + .004, ARCH_R - .004, ARCH_R + .004]) zs.push(a + e);
  zs.sort((a, b) => a - b);
  put(loft(zs, bodyRing), paint);
  box(1.42, .24, 3.5, black, 0, .32, 0); // chassis tub: closes the arches from below

  // --- cabin: a low canopy set back over the engine, painted roof, louvred rear glass
  const CAB_F = .98, CAB_R = -1.55;
  const roof = smooth([[CAB_R, .95], [-1.2, 1.02], [-.8, 1.11], [-.35, 1.18], [.15, 1.18], [.45, 1.11], [.75, .96], [CAB_F, .79]]);
  const cabBase = smooth([[CAB_R, .58], [-1, .7], [-.4, .76], [.5, .74], [CAB_F, .64]]);
  const cabTop = smooth([[CAB_R, .34], [-1, .44], [-.3, .55], [.45, .54], [CAB_F, .52]]);
  const cabRing = (z: number) => {
    const yb = spine(z) - .03, yr = Math.max(roof(z), yb + .01), wb = cabBase(z), wt = cabTop(z);
    return section([[0, yb], [wb * .5, yb], [wb, yb], [wb - .05, yb + (yr - yb) * .4], [wt, yr - .06], [wt * .55, yr - .008], [0, yr]]);
  };
  const cabZs = Array.from({ length: 41 }, (_, i) => CAB_R + (CAB_F - CAB_R) * i / 40);
  put(loft(cabZs, cabRing), glass);
  // roof skin: the top arc of the canopy, lifted clear of the glass
  const lifted = (z: number) => cabRing(z).map(q => q.set(q.x * 1.012, q.y + .008, 0));
  put(loft(cabZs.filter(z => z <= .42 && z >= -.95), lifted, 16, 32), paint);
  for (let i = 0; i < 6; i++) {
    const z = -1.02 - i * .085;
    box(cabTop(z) * 1.9, .016, .05, black, 0, roof(z) + .02, z, -Math.atan(slope(roof, z)));
  }
  for (const s of [-1, 1]) { // mirrors, on short stalks off the A-pillar base
    const mx = cabBase(.6) + .02, my = spine(.6) + .08;
    box(.1, .025, .04, black, s * (mx + .03), my - .02, .62);
    box(.14, .075, .11, paint, s * (mx + .12), my, .6, 0, s * .2);
  }

  // --- nose
  box(1.34, .025, .14, carbon, 0, .215, 1.94);
  // a wide lower mouth with a slatted grille, and corner vents either side
  box(.9, .17, .08, black, 0, .37, 1.985);
  for (const y of [.33, .38, .43]) box(.86, .012, .02, carbon, 0, y, 2.03);
  for (const s of [-1, 1]) {
    box(.16, .2, .08, black, s * .6, .4, 1.93, 0, s * .55);
    // slim lamps laid along the fender crest, swept back at the outer end
    const hz = 1.8, tilt = -Math.atan(slope(crest, hz));
    box(.42, .02, .15, black, s * .6, crest(hz) - .005, hz, tilt, s * .38);
    box(.38, .02, .07, lamp, s * .61, crest(hz) + .004, hz + .03, tilt, s * .38);
  }

  // --- flanks: side intakes ahead of the rear wheels, carbon skirts
  for (const s of [-1, 1]) {
    box(.05, .15, .36, black, s * (width(-.52) - .03), .6, -.52, .32, s * -.08);
    box(.07, .06, 1.6, carbon, s * (width(.04) - .04), .26, .04);
  }

  // --- tail: light bar, diffuser, exhausts, and the wing the build asked for
  box(1.36, .035, .03, red, 0, .74, REAR - .005);
  for (const s of [-1, 1]) box(.3, .07, .03, red, s * .6, .7, REAR - .005);
  box(1.2, .12, .03, black, 0, .52, REAR - .005);
  box(1.4, .1, .16, carbon, 0, .27, REAR + .07);
  for (const x of [-.45, -.15, .15, .45]) box(.02, .07, .14, black, x, .29, REAR + .05);
  for (const s of [-1, 1]) {
    const pipe = new T.CylinderGeometry(.055, .055, .12, 16); pipe.rotateX(Math.PI / 2);
    put(pipe, steel, s * .3, .36, REAR - .03);
  }
  if (p.wing === 'clean') box(1.46, .025, .08, paint, 0, spine(-1.93) + .012, -1.93, .25);
  if (p.wing === 'duck') box(1.62, .06, .26, paint, 0, spine(-1.84) + .04, -1.84, .3);
  if (p.wing === 'gt') {
    for (const s of [-1, 1]) {
      box(.045, .3, .12, black, s * .5, 1.1, -1.74);
      box(.025, .2, .42, carbon, s * .91, 1.25, -1.8);
    }
    box(1.8, .045, .36, carbon, 0, 1.27, -1.8, -.08);
  }

  // --- wheels: rounded tyres, a brake disc and caliper behind the spokes
  const tyreProfile = [[.265, -.15], [.33, -.155], [.36, -.14], [.37, -.1], [.37, .1], [.36, .14], [.33, .155], [.265, .15]]
    .map(([r, y]) => new T.Vector2(r, y));
  for (const s of [-1, 1]) for (const z of AXLES) {
    const x = s * (wide ? .87 : .8), y = WHEEL_R;
    put(new T.LatheGeometry(tyreProfile, 32), rubber, x, y, z, 0, 0, Math.PI / 2);
    disc(.265, .2, well, x - s * .02, y, z, 24);
    disc(.21, .025, steel, x + s * .045, y, z, 24);
    box(.06, .13, .15, caliper, x + s * .07, y + .12, z - .12, -Math.PI / 4);
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
    put(new T.CylinderGeometry(ARCH_R - .02, ARCH_R - .02, .36, 20, 1, true, 0, Math.PI), well, s * .78, y, z, 0, 0, Math.PI / 2);
    if (wide) {
      const flare = new T.TorusGeometry(ARCH_R + .01, .03, 6, 20, Math.PI); flare.rotateY(Math.PI / 2);
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
