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

const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x0d1017, side: THREE.BackSide });

/** Inverted-hull outline: same geometry, flipped faces, scaled up a touch. */
export function outlineFor(mesh: THREE.Mesh, grow = 1.05): THREE.Mesh {
  const o = new THREE.Mesh(mesh.geometry, OUTLINE_MAT);
  o.position.copy(mesh.position);
  o.rotation.copy(mesh.rotation);
  o.scale.copy(mesh.scale).multiplyScalar(grow);
  return o;
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
        opacity: src.opacity
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
