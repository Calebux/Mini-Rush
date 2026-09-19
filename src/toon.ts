import * as THREE from 'three';

// Shared cel-shading bits — the Highway-Warriors-style stepped lighting.

let grad: THREE.DataTexture | null = null;

/** 4-step luminance ramp; NearestFilter keeps the bands hard-edged. */
export function toonGradient(): THREE.DataTexture {
  if (grad) return grad;
  grad = new THREE.DataTexture(new Uint8Array([100, 150, 210, 255]), 4, 1, THREE.RedFormat);
  grad.minFilter = THREE.NearestFilter;
  grad.magFilter = THREE.NearestFilter;
  grad.needsUpdate = true;
  return grad;
}

export function toonMat(
  color: number,
  extra: Partial<THREE.MeshToonMaterialParameters> = {}
): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });
}

// Untextured CAD-style exports (cgtrader OBJs etc.) arrive all-gray, but their
// material names carry semantics — recolor by keyword. Order matters.
const NAME_COLORS: [RegExp, number][] = [
  [/tire|tyre|rubber/i, 0x17181d],
  [/glass|wind(ow|shield)/i, 0x14202f],
  [/carbon/i, 0x23262e],
  [/interior|leather|seat|roof|dash|trim/i, 0x24262e],
  [/chrome|steel|alumin|silver|rim|exhaust|grill/i, 0xb4bac4],
  [/red/i, 0xd92b3a]
];
const LIGHT_RE = /light|lamp|led|beam/i;
const PAINT_RE = /paint|body|shell|hood|bonnet|fender|bumper|door/i;

/** Keep the car's real textures and normals, with a readable satin paint finish.
 * Converting these to ToonMaterial discarded sky reflections and made the dark
 * hero shell disappear whenever it drove through a tree/building shadow.
 */
export function finishVehicle(root: THREE.Object3D, paint?: number): void {
  const cache = new Map<THREE.Material, THREE.Material>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const convert = (material: THREE.Material): THREE.Material => {
      if (cache.has(material)) return cache.get(material)!;
      const src = material as THREE.MeshStandardMaterial;
      if (!src.color) return material;
      const out = src.isMeshStandardMaterial ? src.clone() : new THREE.MeshStandardMaterial({
        color: src.color, map: src.map, side: src.side, transparent: src.transparent,
        opacity: src.opacity, alphaTest: src.alphaTest
      });
      out.name = src.name;
      const name = src.name;
      const neutral = !src.map && Math.abs(src.color.r - src.color.g) < 0.02 &&
        Math.abs(src.color.g - src.color.b) < 0.02 && src.color.r > 0.4;
      // The main CAD shell is named Metallic / Cool Grey. Preserve black aero,
      // brakes, badges and textured liveries instead of painting the whole car.
      if (!src.map && paint !== undefined && /paint.*(metallic|cool grey)|^body|^shell/i.test(name)) {
        out.color.setHex(paint);
        out.userData.isPaint = true; // a skin repaints exactly these
      } else if (neutral) {
        const hit = NAME_COLORS.find(([re]) => re.test(name));
        if (hit) out.color.setHex(hit[1]);
        else if (/black|soft|cloth/i.test(name)) out.color.setHex(0x30343d);
        else if (paint !== undefined && PAINT_RE.test(name)) {
          out.color.setHex(paint);
          out.userData.isPaint = true;
        }
      }
      out.roughness = src.map ? 0.72 : /glass/i.test(name) ? 0.18 :
        /tire|tyre|rubber|cloth|carbon|interior/i.test(name) ? 0.85 : 0.32;
      out.metalness = src.map ? 0.05 : /steel|alumin|chrome|rim/i.test(name) ? 0.65 :
        /paint|body/i.test(name) ? 0.25 : 0.08;
      if (/emissive|headlight|taillight/i.test(name) && neutral) {
        const light = /warm|tail/i.test(name) ? 0xff3b25 : 0xc4edff;
        out.color.setHex(light); out.emissive.setHex(light); out.emissiveIntensity = 0.6;
      }
      if (src.map) src.map.magFilter = THREE.NearestFilter;
      cache.set(material, out);
      return out;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
  });
  root.userData.vehicleFinish = true;
}

/**
 * Re-skin a loaded GLB with toon materials so real kits match the cel look.
 * paint: hero color applied to texture-less "paint"-named materials.
 */
export function toonify(root: THREE.Object3D, paint?: number): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const convert = (m: THREE.Material): THREE.Material => {
      const src = m as THREE.MeshStandardMaterial;
      if (!src.color) return m;
      if (src.map) src.map.magFilter = THREE.NearestFilter; // crisp PSX texels

      const out = new THREE.MeshToonMaterial({
        color: src.color,
        map: src.map ?? null,
        gradientMap: toonGradient(),
        transparent: src.transparent,
        opacity: src.opacity,
        alphaTest: src.alphaTest,
        side: src.side
      });
      if (src.emissive) {
        out.emissive.copy(src.emissive);
        out.emissiveIntensity = src.emissiveIntensity ?? 1;
      }
      // name-based recolor only for untinted defaults (gray/white, no map) —
      // GLBs with baked palettes or textures pass through untouched
      const c = src.color;
      const isDefault = !src.map &&
        Math.abs(c.r - c.g) < 0.02 && Math.abs(c.g - c.b) < 0.02 && c.r > 0.45;
      if (isDefault) {
        const name = m.name || '';
        if (LIGHT_RE.test(name)) {
          out.color.setHex(0xfff2c0);
          out.emissive.setHex(0xfff2c0);
          out.emissiveIntensity = 0.8;
        } else if (paint !== undefined && PAINT_RE.test(name)) {
          out.color.setHex(paint);
          out.userData.isPaint = true; // a skin repaints exactly these
        } else {
          const hit = NAME_COLORS.find(([re]) => re.test(name));
          if (hit) out.color.setHex(hit[1]);
        }
      }
      return out;
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(convert)
      : convert(mesh.material);
  });
}

/**
 * Give one cloned car its own paint. Models are loaded once and their
 * materials shared by every clone, so a skin (or a rival's garage colour) can
 * only change the body by cloning the materials the load marked as paint.
 * Returns true when something was repainted, which is also the signal that the
 * instance now owns materials to dispose with it.
 */
export function repaintVehicle(root: THREE.Object3D, color: number, loadPaint?: number): boolean {
  const swaps = new Map<THREE.Material, THREE.Material>();
  const reskin = (m: THREE.Material): THREE.Material => {
    // the load marks what it painted; a model that arrived already wearing that
    // colour — baked rims, a second body material — is matched by colour
    const wearsLoadPaint = loadPaint !== undefined
      && (m as THREE.MeshStandardMaterial).color?.getHex() === loadPaint;
    if (!m.userData.isPaint && !wearsLoadPaint) return m;
    let out = swaps.get(m);
    if (!out) {
      out = m.clone();
      out.userData = { ...m.userData, instanceOwned: true };
      (out as THREE.MeshStandardMaterial).color.setHex(color);
      swaps.set(m, out);
    }
    return out;
  };
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(reskin) : reskin(mesh.material);
  });
  return swaps.size > 0;
}
