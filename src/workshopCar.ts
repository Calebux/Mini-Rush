import * as T from 'three';
import type { CarSpec } from './cars';
import { freshBuild } from './workshop';

/** Original RUSH ONE coupe. All parts share mounting points; nose is +Z. */
export function buildWorkshopCar(spec: CarSpec): T.Group {
  const g = new T.Group(); g.userData.workshopCar = true;
  const p = (spec.build ?? freshBuild()).parts;
  const paint = new T.MeshPhysicalMaterial({ color: spec.color, metalness: .38, roughness: .25, clearcoat: 1, clearcoatRoughness: .16 });
  const black = new T.MeshStandardMaterial({ color: 0x161c24, roughness: .55 });
  const glass = new T.MeshPhysicalMaterial({ color: 0x18333e, metalness: .35, roughness: .12, clearcoat: 1 });
  const metal = new T.MeshStandardMaterial({ color: p.wheels === 'turbine' ? 0xd4aa5a : p.wheels === 'disc' ? 0xe5e9dd : 0xc5cbd0, metalness: .8, roughness: .25 });
  const rubber = new T.MeshStandardMaterial({ color: 0x111418, roughness: .94 });
  const lamp = new T.MeshStandardMaterial({ color: 0xf8fff4, emissive: 0xcffff2, emissiveIntensity: 1.2 });
  const red = new T.MeshStandardMaterial({ color: 0xe92832, emissive: 0xe92832, emissiveIntensity: .7 });
  function mesh(geo: T.BufferGeometry, mat: T.Material, x: number, y: number, z: number) {
    const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m;
  }
  function box(w: number, h: number, d: number, x: number, y: number, z: number, mat: T.Material = paint) {
    return mesh(new T.BoxGeometry(w, h, d), mat, x, y, z);
  }
  // Extruded side profiles give real sloped hood, glass and fastback contours.
  function profile(points: number[][], width: number, mat: T.Material) {
    const shape = new T.Shape(); points.forEach(([z, y], i) => i ? shape.lineTo(z, y) : shape.moveTo(z, y)); shape.closePath();
    const geo = new T.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: .045, bevelSize: .045, bevelSegments: 2, steps: 1 });
    geo.rotateY(-Math.PI / 2); geo.translate(width / 2, 0, 0); return mesh(geo, mat, 0, 0, 0);
  }
  profile([[-1.93, .43], [1.98, .43], [2.02, .65], [1.74, .83], [.72, .96], [-1.65, 1.0], [-2.0, .79]], 1.72, paint);
  profile([[-1.36, .99], [-.62, 1.57], [.27, 1.57], [.91, .96]], 1.37, glass);
  box(1.43, .075, .94, 0, 1.61, -.17);
  for (const x of [-.71, .71]) {
    box(.06, .54, .065, x, 1.29, -.35);
    box(.055, .12, 1.67, x, 1.00, -.24);
    box(.19, .025, .05, x * 1.24, .98, -.48, black);
    box(.24, .12, .18, x * 1.34, 1.13, .54, black);
  }
  box(1.74, .13, 3.74, 0, .42, 0, black);
  box(1.82, .08, .36, 0, .40, 1.87, black);
  box(1.21, .16, .035, 0, .62, 2.04, black);
  for (const x of [-.65, .65]) {
    box(.39, .075, .04, x, .79, 1.95, lamp);
    box(.58, .09, .04, x * .83, .84, -2.02, red);
    box(.26, .09, .17, x, .45, -2.04, black);
  }
  box(.35, .13, .03, 0, .67, -2.04, metal);
  for (const x of [-1, 1]) for (const z of [-1.24, 1.24]) {
    const wx = x * (p.body === 'wide' ? .97 : .89);
    const tyre = mesh(new T.CylinderGeometry(.39, .39, .27, 24), rubber, wx, .40, z); tyre.rotation.z = Math.PI / 2;
    const hub = mesh(new T.CylinderGeometry(.265, .265, .28, 24), p.wheels === 'disc' ? metal : black, wx, .40, z); hub.rotation.z = Math.PI / 2;
    const count = p.wheels === 'turbine' ? 10 : 5;
    for (let k = 0; k < count; k++) {
      const a = k / count * Math.PI * 2;
      const spoke = box(.035, .225, .048, wx + x * .15, .40 + Math.cos(a) * .12, z + Math.sin(a) * .12, metal); spoke.rotation.x = a;
    }
    const cap = mesh(new T.CylinderGeometry(.075, .075, .3, 12), metal, wx, .40, z); cap.rotation.z = Math.PI / 2;
    if (p.body === 'wide') box(.18, .12, .88, x * .96, .84, z);
  }
  if (p.body === 'wide') for (const x of [-1, 1]) box(.15, .13, 1.62, x * .91, .43, 0);
  if (p.wing === 'duck') { const w = box(1.69, .12, .18, 0, 1.03, -1.85); w.rotation.x = -.25; }
  if (p.wing === 'gt') {
    for (const x of [-.56, .56]) box(.06, .43, .17, x, 1.20, -1.71, black);
    box(1.95, .065, .38, 0, 1.43, -1.75, black);
    for (const x of [-.96, .96]) box(.045, .22, .40, x, 1.47, -1.75);
  }
  if (p.body === 'rally') {
    for (const x of [-.57, .57]) box(.06, .11, .90, x, 1.72, -.18, black);
    for (const z of [-.61, .25]) box(1.27, .055, .055, 0, 1.77, z, metal);
    for (const x of [-.54, -.18, .18, .54]) {
      const light = mesh(new T.CylinderGeometry(.13, .13, .12, 16), lamp, x, .93, 2.0); light.rotation.x = Math.PI / 2;
    }
  }
  return g;
}
