// Convert a downloaded circuit .glb into a web-sized asset the game can both
// render and bake a racing line from.
//
//   node scripts/import-track.mjs <source.glb> <dest.glb> [--texture 1024]
//
// The important part is what this does NOT do: no --join, no --flatten. Those
// are on by default in `gltf-transform optimize`, and they weld separate
// surfaces into one mesh — which fuses a circuit's tarmac into its paddock and
// pit apron, leaving a filled blob that no centreline can be traced from.
// Keeping meshes split is what lets bake-track-path.mjs find the racing surface.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup, prune, weld, quantize, textureCompress, metalRough, simplify, instance
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { statSync } from 'node:fs';
import sharp from 'sharp';

const [src, dest] = process.argv.slice(2);
if (!src || !dest) {
  console.error('usage: node scripts/import-track.mjs <source.glb> <dest.glb> [--texture 1024] [--ratio 0.2]');
  process.exit(1);
}
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};
const textureSize = arg('texture', 1024);
const ratio = arg('ratio', 0.2);
const str = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null;
};
const keepRe = str('keep') ? new RegExp(str('keep'), 'i') : null;
const dropRe = str('drop') ? new RegExp(str('drop'), 'i') : null;
const yaw = arg('yaw', 0) * Math.PI / 180;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
await MeshoptSimplifier.ready;

// The game already grows its own trees, buildings and streetlights along the
// route, so an imported circuit only needs to contribute the racing surface and
// its immediate furniture. Dropping the kit's scenery is where the real size
// win is — a single cartoon tree in this pack is 45k triangles.
if (keepRe || dropRe) {
  let dropped = 0;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const names = `${node.getName()} ${mesh.getName()} ` +
      mesh.listPrimitives().map((p) => p.getMaterial()?.getName() ?? '').join(' ');
    const keep = keepRe ? keepRe.test(names) : true;
    const drop = dropRe ? dropRe.test(names) : false;
    if (!keep || drop) { node.setMesh(null); dropped++; }
  }
  console.log(`  dropped ${dropped} scenery nodes`);
}

// Vehicle scans are frequently authored at an angle on the turntable, which
// leaves the car's long axis diagonal to Z. The game measures cars by their
// bounding box (to size them and to place wheels), so straighten it at import
// rather than carrying a per-asset fudge factor in the engine.
if (yaw) {
  const [qx, qy, qz, qw] = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
  for (const node of doc.getRoot().listScenes().flatMap((s) => s.listChildren())) {
    const [x, y, z] = node.getTranslation();
    const c = Math.cos(yaw), s = Math.sin(yaw);
    node.setTranslation([x * c + z * s, y, -x * s + z * c]);
    const [ax, ay, az, aw] = node.getRotation();
    node.setRotation([
      qw * ax + qx * aw + qy * az - qz * ay,
      qw * ay - qx * az + qy * aw + qz * ax,
      qw * az + qx * ay - qy * ax + qz * aw,
      qw * aw - qx * ax - qy * ay - qz * az
    ]);
  }
  console.log(`  yawed scene by ${(yaw * 180 / Math.PI).toFixed(1)}°`);
}

await doc.transform(
  // Sketchfab exports often use KHR_materials_pbrSpecularGlossiness, which
  // three.js dropped support for — convert before anything else touches materials.
  metalRough(),
  dedup(),
  instance({ min: 2 }),
  prune({ keepAttributes: false, keepLeaves: false }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [textureSize, textureSize] }),
  // Weld first: FBX-sourced exports are usually fully unwelded (three vertices
  // per triangle), and the simplifier can only collapse edges it can see.
  weld(),
  // Scenery kits ship 40k-triangle trees. lockBorder is what makes this safe on
  // a circuit: a road ribbon is an open surface, and pinning its boundary keeps
  // the tarmac edges exactly where they were. Without it the simplifier opens
  // hairline cracks along the track that break centreline extraction.
  simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.002, lockBorder: true }),
  prune({ keepAttributes: false, keepLeaves: false }),
  quantize()
);

await io.write(dest, doc);

const before = statSync(src).size / 1e6;
const after = statSync(dest).size / 1e6;
const meshes = doc.getRoot().listMeshes().length;
console.log(`${src.split('/').pop()} -> ${dest.split('/').pop()}`);
console.log(`  ${before.toFixed(1)} MB -> ${after.toFixed(1)} MB  (${meshes} meshes kept separate)`);
