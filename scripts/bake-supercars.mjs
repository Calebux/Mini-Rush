// Turn a cgtrader supercar export into a game-ready GLB.
//
// These arrive as CAD data — 170k–380k triangles across up to 1200 meshes, with
// semantic material names but no image files. The whole race scene draws about
// 500k triangles, so a car has to come down to traffic-car scale before it can
// share the road. Colour is baked here because AssetLibrary loads the supercar
// slots without a paint override; only the underglow is tinted at runtime.
//
// The four Bugatti/Lamborghini sources are .fbx, which needs converting first:
//   npm i --no-save fbx2gltf
//   ./node_modules/fbx2gltf/bin/Darwin/FBX2glTF --binary --input car.fbx --output car
// Usage: node scripts/bake-supercars.mjs in.glb out.glb <paintHex> [triangleBudget]
import { NodeIO } from '@gltf-transform/core';
import { KHRMeshQuantization } from '@gltf-transform/extensions';
import {
  dedup, flatten, join, prune, quantize, simplify, weld
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const [inFile, outFile, paintHex, budgetArg] = process.argv.slice(2);
const PAINT = parseInt(paintHex ?? 'ff2e8a', 16);
const BUDGET = Number(budgetArg ?? 26000);

// Name matching alone is not enough on these exports: "Aventador" contains
// "vent", and the Mansory kit paints the whole body with a material called
// "rim_1". So parts are matched by name, but the *body* is found by triangle
// share — on a car model the paint always covers the most surface.
const PART_RULES = [
  [/tire|tyre|rubber/i, 0x17181d, 0],                  // [match, color, emissive]
  [/glass|window|windscreen|windshield/i, 0x16202e, 0],
  [/tail.?light|rear.?light|brake.?light/i, 0xff5040, 0xff2a1a],
  [/head.?light|light.?bucket|\blights?\b|\bemis\b|\blamp/i, 0xd8ecff, 0xbfe2ff],
  [/interior|cloth|seat|tilli|leather|dash|carpet/i, 0x24262e, 0],
  [/plastic|rubberised/i, 0x1b1e24, 0],
  [/carbon/i, 0x23262e, 0],
  [/\bmesh\b|grill|air.?vent|radiator|engine|exhaust/i, 0x191b20, 0],
  [/brake|\bdisc\b|calliper|caliper/i, 0x4a4d55, 0],
  [/chrome|alumin|steel|\bmetal|silver/i, 0xb4bac4, 0],
  [/badge|logo|emblem/i, 0xd92b3a, 0],
  [/\bplate\b|number.?plate/i, 0xe6e3d8, 0],
  [/wheel|\brim\b|\brim_|_rim\b/i, 0x9aa0aa, 0]
];
// The body is never one of these, however big it is. Wheels are on the list
// because CAD rim spokes out-triangle the smooth panels they sit behind — on
// the Aventador the Mansory rims alone are 329k of the model's 384k triangles.
const NEVER_BODY =
  /glass|window|tire|tyre|rubber|interior|seat|light|lamp|emis|wheel|\brim\b|\brim_|_rim\b|brake|calliper|caliper/i;
// Preference order for the body, strongest signal first. Both Bugattis carry a
// "Coloured" trim material larger than their actual "Paint" shell, so an
// explicit paint name has to beat a merely bigger one.
// No \b anchors: these names run words together ("2019Paint_Material1").
const BODY_NAMES = [/paint/i, /body|exterior|shell/i, /colou?red/i];
const TRIM = 0x2c313c; // anything the rules and the share test both miss

const lin = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
});

const triangles = (doc) => {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      n += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  }
  return Math.round(n);
};

const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
const doc = await io.read(inFile);
const before = triangles(doc);

// Triangle share per material, measured before anything is merged away.
const share = new Map();
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices();
    const t = (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    const mat = prim.getMaterial();
    if (mat) share.set(mat, (share.get(mat) ?? 0) + t);
  }
}
const candidates = [...share.entries()]
  .filter(([m]) => !NEVER_BODY.test(m.getName()))
  .sort((a, b) => b[1] - a[1]);
const body = (BODY_NAMES.reduce(
  (found, re) => found ?? candidates.find(([m]) => re.test(m.getName())),
  undefined) ?? candidates[0])?.[0];

for (const m of doc.getRoot().listMaterials()) {
  const name = m.getName();
  const rule = PART_RULES.find(([re]) => re.test(name));
  const color = m === body ? PAINT : rule ? rule[1] : TRIM;
  m.setBaseColorFactor([...lin(color), 1]);
  if (m !== body && rule && rule[2]) m.setEmissiveFactor(lin(rule[2]));
  m.setMetallicFactor(0);
  m.setRoughnessFactor(0.55);
  // The FBX referenced texture files that never shipped; drop the empty slots
  // so prune can collect them and toonify() has flat colour to work with.
  m.setBaseColorTexture(null);
  m.setMetallicRoughnessTexture(null);
  m.setNormalTexture(null);
  m.setEmissiveTexture(null);
  m.setOcclusionTexture(null);
  if (m === body) console.log(`  body: ${name} (${Math.round(share.get(m))} tris)`);
}

await doc.transform(prune(), dedup(), flatten(), join(), weld());
const welded = triangles(doc);
await doc.transform(
  simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, BUDGET / welded), error: 0.004 }),
  prune(),
  quantize()
);
await io.write(outFile, doc);
console.log(`${outFile}: ${before} → ${triangles(doc)} tris, ${doc.getRoot().listMeshes().length} meshes`);
