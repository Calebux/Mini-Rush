// Bake a cel palette into an untextured CAD-style car GLB (cgtrader OBJ
// exports arrive with default-gray materials + semantic names). Baking BEFORE
// join keeps materials distinct so dedup can't collapse them into one.
// Usage: node scripts/bake-car-colors.cjs in.glb out.glb <paintHex>
const { NodeIO } = require('@gltf-transform/core');
const { KHRMeshQuantization } = require('@gltf-transform/extensions');
const { dedup, join, prune, quantize, weld } = require('@gltf-transform/functions');

const [inFile, outFile, paintHex] = process.argv.slice(2);
const PAINT = parseInt(paintHex ?? 'ff2e8a', 16);

const RULES = [
  [/emissive.*cool|headlight/i, 0xd8ecff, 0xbfe2ff],   // [match, color, emissive]
  [/emissive.*warm|tail.?light/i, 0xff5040, 0xff2a1a],
  [/tire|tyre|rubber|soft rough/i, 0x17181d, 0],
  [/glass/i, 0x16202e, 0],
  [/carbon/i, 0x23262e, 0],
  [/interior|cloth|seat|roof/i, 0x24262e, 0],
  [/mesh|grill/i, 0x191b20, 0],
  [/alumin|chrome|rim/i, 0xb4bac4, 0],
  [/steel/i, 0x878d96, 0],
  [/logo|red/i, 0xd92b3a, 0],
  [/matte black/i, PAINT, 0],                          // main body coat
  [/paint/i, 0x2c313c, 0],                             // other painted trim
];

const lin = (hex) => {
  const c = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return c;
};

(async () => {
  const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
  const doc = await io.read(inFile);
  for (const m of doc.getRoot().listMaterials()) {
    const name = m.getName();
    const rule = RULES.find(([re]) => re.test(name));
    if (!rule) {
      m.setBaseColorFactor([...lin(0x8a90a0), 1]);
      continue;
    }
    m.setBaseColorFactor([...lin(rule[1]), 1]);
    if (rule[2]) m.setEmissiveFactor(lin(rule[2]));
    console.log(name, '→', rule[1].toString(16));
  }
  await doc.transform(prune(), dedup(), weld(), join(), quantize());
  await io.write(outFile, doc);
  console.log('wrote', outFile);
})();
