import * as T from 'three';
import type { CarSpec } from './cars';
import { carParts, loft, section, slope, smooth } from './carKit';

// STOCK 88's hardpoints. Nose is +Z. Front-engined, long in the wheelbase.
const FRONT = 2.06, REAR = -2.02;
const AXLES = [1.32, -1.3];
const WHEEL_R = 0.38, ARCH_R = 0.47, TRACK = 0.84;
const SCALE = .96; // 3.9 m nose to tail, like the garage's model cars

// One roundel texture for every STOCK 88 on the grid; disposing a car's
// materials leaves it alone, so it is drawn once and kept.
let roundel: T.CanvasTexture | null = null;
function numberRoundel(): T.CanvasTexture {
  if (roundel) return roundel;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff'; x.beginPath(); x.arc(128, 128, 122, 0, Math.PI * 2); x.fill();
  x.lineWidth = 9; x.strokeStyle = '#15171b'; x.beginPath(); x.arc(128, 128, 108, 0, Math.PI * 2); x.stroke();
  x.fillStyle = '#15171b'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '900 132px "Arial Black", Impact, system-ui, sans-serif'; x.fillText('88', 128, 136);
  roundel = new T.CanvasTexture(c); roundel.colorSpace = T.SRGBColorSpace; roundel.anisotropy = 4;
  return roundel;
}

/**
 * Original STOCK 88: an oval racer — slab sides, flared arches, a long bonnet,
 * a fastback cabin and a tall rear spoiler, in its garage paint with "88"
 * roundels. No sponsor or series marks. Built from the same kit as RUSH ONE.
 */
export function buildStockCar(spec: CarSpec): T.Group {
  const paint = new T.MeshPhysicalMaterial({ color: spec.color, metalness: .2, roughness: .32, clearcoat: .5, clearcoatRoughness: .16 });
  const black = new T.MeshStandardMaterial({ color: 0x14181e, roughness: .6 });
  const carbon = new T.MeshPhysicalMaterial({ color: 0x1c2026, metalness: .3, roughness: .32, clearcoat: .7 });
  const glass = new T.MeshPhysicalMaterial({ color: 0x0f1b24, metalness: .5, roughness: .08, clearcoat: 1 });
  const face = new T.MeshStandardMaterial({ color: 0x2a2e34, metalness: .6, roughness: .4 });
  const metal = new T.MeshStandardMaterial({ color: 0xc9ced3, metalness: .85, roughness: .22 });
  const rubber = new T.MeshStandardMaterial({ color: 0x121417, roughness: .92, side: T.DoubleSide });
  const well = new T.MeshStandardMaterial({ color: 0x08090b, roughness: 1, side: T.DoubleSide });
  const lamp = new T.MeshStandardMaterial({ color: 0xf2f0dc, emissive: 0xfff6d8, emissiveIntensity: .6 });
  const red = new T.MeshStandardMaterial({ color: 0xff2a36, emissive: 0xff1c2c, emissiveIntensity: .9 });
  const decal = new T.MeshStandardMaterial({ map: numberRoundel(), alphaTest: .5, roughness: .4 });
  const { put, box, disc, finish } = carParts();

  // --- body
  const width = smooth([[REAR, .94], [-1.6, 1], [-1.3, 1.02], [-.8, .97], [0, .95], [.8, .96], [1.32, 1.01], [1.75, .97], [FRONT, .84]]);
  const shoulder = smooth([[REAR, .86], [-1.3, .93], [-.75, .84], [0, .8], [.8, .84], [1.32, .92], [1.8, .8], [FRONT, .56]]);
  const crest = smooth([[REAR, .97], [-1.3, 1], [-.6, .95], [.4, .93], [1.32, .98], [1.8, .86], [FRONT, .62]]);
  const spine = smooth([[REAR, .98], [-1.6, 1], [-1.25, .99], [.55, .94], [1, .9], [1.6, .8], [1.9, .68], [FRONT, .6]]);
  const sill = (z: number) => {
    let y = .24;
    for (const a of AXLES) if (Math.abs(z - a) < ARCH_R) y = Math.max(y, WHEEL_R + Math.sqrt(ARCH_R ** 2 - (z - a) ** 2));
    return Math.min(y, shoulder(z) - .07);
  };
  const bodyRing = (z: number) => {
    const w = width(z), b = sill(z), s = shoulder(z), c = crest(z), top = spine(z);
    const pts = section([[0, b], [(w - .1) * .5, b], [w - .1, b + Math.min(.04, (s - b) * .25)], [w - .02, b + (s - b) * .5],
      [w, s], [w - .08, c], [(w - .08) * .5, top + (c - top) * .2], [0, top]]);
    const nose = Math.min(1, Math.max(0, (z - (FRONT - .28)) / .28)), tail = Math.min(1, Math.max(0, ((REAR + .1) - z) / .1));
    const sf = Math.sqrt(1 - nose ** 2), sr = Math.sqrt(1 - tail ** 2);
    const sx = (.7 + .3 * sf) * (.9 + .1 * sr), sy = (.62 + .38 * sf) * (.85 + .15 * sr), cy = (b + top) / 2;
    return pts.map(q => q.set(q.x * sx, cy + (q.y - cy) * sy, 0));
  };
  const zs: number[] = [];
  for (let i = 0; i <= 72; i++) zs.push(REAR + (FRONT - REAR) * i / 72);
  for (const a of AXLES) for (const e of [-ARCH_R - .004, -ARCH_R + .004, ARCH_R - .004, ARCH_R + .004]) zs.push(a + e);
  zs.sort((a, b) => a - b);
  put(loft(zs, bodyRing), paint);
  box(1.5, .24, 3.6, black, 0, .32, 0);

  // --- cabin: glass all round, then a painted roof and C-pillars laid over it
  const CAB_F = .6, CAB_R = -1.32;
  const roof = smooth([[CAB_R, .97], [-1, 1.15], [-.6, 1.29], [-.1, 1.31], [.25, 1.27], [.45, 1.12], [CAB_F, .93]]);
  const cabBase = smooth([[CAB_R, .74], [-.9, .84], [0, .86], [CAB_F, .78]]);
  const cabTop = smooth([[CAB_R, .56], [-.9, .66], [0, .68], [.3, .66], [CAB_F, .6]]);
  const cabRing = (z: number) => {
    const yb = spine(z) - .03, yr = Math.max(roof(z), yb + .01), wb = cabBase(z), wt = cabTop(z);
    return section([[0, yb], [wb * .5, yb], [wb, yb], [wb - .04, yb + (yr - yb) * .45], [wt, yr - .05], [wt * .55, yr - .008], [0, yr]]);
  };
  const cabZs = Array.from({ length: 41 }, (_, i) => CAB_R + (CAB_F - CAB_R) * i / 40);
  put(loft(cabZs, cabRing), glass);
  const lifted = (z: number) => cabRing(z).map(q => q.set(q.x * 1.015, q.y + .008, 0));
  put(loft(cabZs.filter(z => z <= .26 && z >= -.62), lifted, 16, 32), paint);
  const pillars = cabZs.filter(z => z <= -.6);
  put(loft(pillars, lifted, 8, 16), paint);
  put(loft(pillars, lifted, 32, 40), paint);
  box(.9, .02, .1, black, 0, spine(.66) + .01, .66); // cowl vent
  for (const x of [-.18, .18]) box(.26, .012, .12, black, x, roof(-.35) + .012, -.35); // roof flaps
  const top = new T.PlaneGeometry(.5, .5); top.rotateX(-Math.PI / 2);
  put(top, decal, 0, roof(-.05) + .026, -.05);

  // --- nose: split grille, sticker headlamps, bonnet pins, splitter
  box(1.06, .14, .08, black, 0, .36, FRONT - .035);
  for (const y of [.33, .39]) box(1.02, .012, .02, carbon, 0, y, FRONT + .01);
  box(.66, .06, .06, black, 0, .5, FRONT - .05);
  box(1.18, .03, .16, carbon, 0, .2, FRONT - .14);
  const bonnet = (z: number) => spine(z) + (crest(z) - spine(z)) * .6;
  for (const s of [-1, 1]) {
    const hz = 1.8;
    box(.36, .016, .17, lamp, s * .58, bonnet(hz) + .012, hz, -Math.atan(slope(bonnet, hz)), s * .22);
    put(new T.CylinderGeometry(.028, .028, .02, 12), metal, s * .42, spine(1.5) + (crest(1.5) - spine(1.5)) * .25 + .01, 1.5);
  }

  // --- flanks: number roundels, skirts, side-exit exhaust
  for (const s of [-1, 1]) {
    const side = new T.PlaneGeometry(.56, .56); side.rotateY(s * Math.PI / 2);
    put(side, decal, s * (width(-.05) + .008), .6, -.05);
    box(.06, .07, 1.7, black, s * (width(0) - .03), .27, 0);
  }
  for (const z of [-.72, -.84]) {
    const pipe = new T.CylinderGeometry(.05, .05, .14, 16); pipe.rotateZ(Math.PI / 2);
    put(pipe, metal, width(z) + .02, .3, z);
  }

  // --- tail: lamp stickers, bumper, the tall spoiler blade
  for (const s of [-1, 1]) box(.44, .09, .03, red, s * .52, .84, REAR - .005);
  box(1.6, .14, .06, black, 0, .34, REAR - .01);
  box(1.74, .26, .02, carbon, 0, spine(-1.94) + .12, -1.96, -.45);
  for (const s of [-1, 1]) box(.02, .2, .14, black, s * .86, spine(-1.94) + .1, -1.97, -.45);

  // --- wheels: fat tyres on dark steel wheels with five lugs, flared arches
  const tyreProfile = [[.27, -.17], [.34, -.175], [.37, -.16], [.38, -.12], [.38, .12], [.37, .16], [.34, .175], [.27, .17]]
    .map(([r, y]) => new T.Vector2(r, y));
  for (const s of [-1, 1]) for (const z of AXLES) {
    const x = s * TRACK, y = WHEEL_R;
    put(new T.LatheGeometry(tyreProfile, 32), rubber, x, y, z, 0, 0, Math.PI / 2);
    disc(.27, .24, well, x - s * .02, y, z, 24);
    disc(.25, .03, face, x + s * .1, y, z);
    disc(.075, .05, metal, x + s * .12, y, z, 16);
    for (let k = 0; k < 5; k++) {
      const a = k / 5 * Math.PI * 2;
      disc(.02, .04, metal, x + s * .125, y + Math.cos(a) * .12, z + Math.sin(a) * .12, 8);
    }
    const lip = new T.TorusGeometry(.255, .014, 6, 32); lip.rotateY(Math.PI / 2);
    put(lip, metal, x + s * .115, y, z);
    put(new T.CylinderGeometry(ARCH_R - .02, ARCH_R - .02, .4, 20, 1, true, 0, Math.PI), well, s * .82, y, z, 0, 0, Math.PI / 2);
    const flare = new T.TorusGeometry(ARCH_R + .01, .025, 6, 20, Math.PI); flare.rotateY(Math.PI / 2);
    put(flare, black, s * (width(z) - .01), y, z);
  }

  return finish(new T.Group(), SCALE);
}
