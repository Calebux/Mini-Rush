import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { carGroundFx, polishCar } from './meshes';

// A shared, code-built minibus: +Z forward, tires on y=0. Cached like the GLBs;
// only the contact shadow belongs to an individual traffic instance.
let template: THREE.Group | null = null;

function buildTemplate(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'danfo';
  root.userData.trafficKind = 'danfo';
  const paint = new THREE.MeshStandardMaterial({ color: 0xf5b91b, roughness: 0.57, metalness: 0.15 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x202422, roughness: 0.86 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x294b58, roughness: 0.2, metalness: 0.45 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x8f9694, roughness: 0.48, metalness: 0.65 });
  const lamps = new THREE.MeshStandardMaterial({ color: 0xffedbf, emissive: 0xffd488, emissiveIntensity: 0.25 });
  const rear = new THREE.MeshStandardMaterial({ color: 0xbb3022, roughness: 0.4 });
  const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const batch = parts.get(material) ?? [];
    batch.push(geometry); parts.set(material, batch);
  };
  const box = (m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => {
    add(new THREE.BoxGeometry(w, h, d).translate(x, y, z), m);
  };

  // Tall, flat-front silhouette, with a slightly narrower passenger cabin.
  box(paint, 1.78, 0.88, 4.12, 0, 0.87, 0);
  box(paint, 1.69, 0.89, 3.93, 0, 1.72, -0.04);
  box(paint, 1.79, 0.12, 4.05, 0, 2.19, -0.04);
  box(trim, 1.55, 0.16, 3.65, 0, 0.4, 0);

  for (const side of [-1, 1]) {
    // The two black belt stripes wrap around the yellow body.
    for (const y of [1.02, 1.2]) box(trim, 0.018, 0.075, 4.1, side * 0.899, y, 0);
    for (const z of [-1.43, -0.48, 0.47, 1.39]) {
      box(trim, 0.024, 0.66, 0.84, side * 0.852, 1.73, z);
      box(glass, 0.028, 0.56, 0.73, side * 0.867, 1.74, z);
      box(metal, 0.03, 0.022, 0.74, side * 0.871, 1.72, z);
    }
    // Door seams, handles, mirrors and a step below the sliding passenger door.
    for (const z of [0.95, 1.9]) box(trim, 0.02, 0.71, 0.018, side * 0.902, 0.78, z);
    box(metal, 0.035, 0.055, 0.17, side * 0.92, 1.29, 1.08);
    box(trim, 0.17, 0.045, 0.05, side * 0.93, 1.56, 1.79);
    box(trim, 0.12, 0.23, 0.16, side * 1.015, 1.65, 1.79);
    box(glass, 0.09, 0.17, 0.018, side * 1.015, 1.65, 1.7);
    for (const z of [-1.32, 1.3]) {
      add(new THREE.CylinderGeometry(0.36, 0.36, 0.2, 12)
        .rotateZ(Math.PI / 2).translate(side * 0.86, 0.36, z), trim);
      add(new THREE.CylinderGeometry(0.19, 0.19, 0.215, 10)
        .rotateZ(Math.PI / 2).translate(side * 0.875, 0.36, z), metal);
    }
  }
  box(trim, 0.028, 0.76, 0.024, 0.902, 0.82, -0.94);
  box(metal, 0.035, 0.055, 0.19, 0.92, 1.3, -0.78);
  box(trim, 0.18, 0.09, 1.7, 0.9, 0.4, -0.05);

  // Split windshield, rear window, bumpers and contrasting front/rear lights.
  box(trim, 1.55, 0.7, 0.035, 0, 1.74, 1.938);
  box(glass, 1.43, 0.57, 0.04, 0, 1.75, 1.96);
  box(trim, 0.045, 0.59, 0.045, 0, 1.75, 1.984);
  box(trim, 1.47, 0.63, 0.025, 0, 1.73, -2.019);
  box(glass, 1.34, 0.51, 0.03, 0, 1.73, -2.04);
  for (const end of [-1, 1]) {
    for (const y of [1.02, 1.2]) box(trim, 1.79, 0.075, 0.02, 0, y, end * 2.065);
    box(trim, 1.86, 0.15, 0.16, 0, 0.48, end * 2.08);
    box(metal, 0.4, 0.13, 0.025, 0, 0.64, end * 2.085);
    for (const x of [-0.66, 0.66]) box(end > 0 ? lamps : rear, 0.23, 0.19, 0.045, x, 0.85, end * 2.08);
  }
  box(trim, 0.73, 0.19, 0.025, 0, 0.86, 2.077);
  for (const y of [0.81, 0.86, 0.91]) box(metal, 0.65, 0.016, 0.03, 0, y, 2.095);

  // One small atlas for the destination board and rear lettering.
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#edce75'; ctx.fillRect(0, 0, 512, 128);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#202422';
  ctx.font = 'bold 42px sans-serif'; ctx.fillText('YABA • CMS', 256, 34);
  ctx.font = 'bold 40px sans-serif'; ctx.fillText('LAGOS DANFO', 256, 98);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 });
  for (const front of [true, false]) {
    const geo = new THREE.PlaneGeometry(front ? 1.12 : 1.22, 0.18);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 0.5 + (front ? 0.5 : 0));
    if (!front) geo.rotateY(Math.PI);
    geo.translate(0, front ? 1.98 : 1.31, front ? 2.01 : -2.07);
    add(geo, sign);
  }

  // Batch all the detail into seven draw calls, shared by the whole fleet.
  for (const [material, geometries] of parts) {
    const merged = mergeGeometries(geometries, false)!;
    geometries.forEach(g => g.dispose());
    root.add(new THREE.Mesh(merged, material));
  }
  polishCar(root);
  return root;
}

export function buildDanfo(): THREE.Group {
  template ??= buildTemplate();
  const bus = template.clone(true);
  bus.add(carGroundFx(0xf5b91b));
  return bus;
}
