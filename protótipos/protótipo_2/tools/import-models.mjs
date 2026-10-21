// Imports the GLBs exported by Pyram3D (prototype 2) into the game, optimized for the web:
//   - characters stay smooth: a generous triangle budget per mesh and a tight error bound, so the
//     simplifier only removes what is flat; normals and skin weights keep 12/16 bits,
//   - nature is already low-poly: only welded, quantized and compressed,
//   - redundant animation keys are removed, buffers meshopt-compressed,
//   - nature.json (the catalog the world generator reads) is copied to assets/nature.json.
//
//   node tools/import-models.mjs [name ...]     (default: everything)
//   PYRAM3D_EXPORTS=/path/to/Pyram3D/projects/niryk/protótipo_2/exports
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, quantize, resample, simplifyPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const SRC = resolve(process.env.PYRAM3D_EXPORTS ?? '../../../Pyram3D/projects/niryk/protótipo_2/exports');
const DST = resolve('assets/models');

/**
 * Per-mesh triangle budget and max simplification error (fraction of the mesh's size), by mesh
 * name. The error bound wins over the budget: a smooth surface keeps its triangles.
 */
const CHARACTER_RULES = [
  [/^Head_Eyes/, Infinity, 0], // tiny, three materials: never touched
  [/^Head_Skin/, 6000, 0.0025],
  [/^Head_Brows/, 1400, 0.006],
  [/^Hair_/, 3000, 0.004],
  [/^Body/, 6500, 0.002],
  [/^Outfit/, 14000, 0.0015], // cloth sits 1-2 cm over the skin: keep it from sinking in
  // Harpins: wing feathers are thin closed solids a couple of cm apart (a coarse error would fold
  // them into each other or blunt their tips); plume locks on legs, tail and temples are pointed
  [/wing|feather/i, 26000, 0.0006],
  [/plume|tail|leg|feet|toe|claw|talon/i, 12000, 0.0012],
];
const CHARACTER_DEFAULT = [8000, 0.003];
/** Harpin bodies carry the plumed eagle legs, scaled toes and claws in Body: about twice the skin. */
const HARPIN_RULES = [[/^Body/, 14000, 0.0015]];
/** Nature, props and creatures: never simplified (already authored to budget). */
const KINDS = { characters: 'character', creatures: 'creature', equipment: 'prop', buildings: 'prop', nature: 'nature' };

function findGlbs(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...findGlbs(p));
    else if (f.endsWith('.glb')) out.push(p);
  }
  return out;
}

function triCount(prim) {
  const idx = prim.getIndices();
  return idx ? idx.getCount() / 3 : prim.getAttribute('POSITION').getCount() / 3;
}

async function main() {
  if (!existsSync(SRC)) throw new Error(`Pyram3D exports not found: ${SRC}`);
  await MeshoptSimplifier.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  mkdirSync(DST, { recursive: true });
  const only = process.argv.slice(2);
  let total = 0;
  for (const file of findGlbs(SRC)) {
    const name = basename(file, '.glb');
    if (only.length && !only.includes(name)) continue;
    const kind = KINDS[basename(dirname(file))] ?? 'prop';
    const doc = await io.read(file);
    // materials are color slots and wind groups by name: identical white materials must stay apart
    await doc.transform(dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }), weld());
    let before = 0;
    let after = 0;
    const perMesh = [];
    for (const mesh of doc.getRoot().listMeshes()) {
      const prims = mesh.listPrimitives();
      const tris = prims.reduce((a, p) => a + triCount(p), 0);
      before += tris;
      if (kind === 'character') {
        const rules = name.startsWith('harpin') ? [...HARPIN_RULES, ...CHARACTER_RULES] : CHARACTER_RULES;
        const [, budget, error] = rules.find(([re]) => re.test(mesh.getName())) ?? [null, ...CHARACTER_DEFAULT];
        const ratio = Math.min(1, budget / Math.max(1, tris));
        // lockBorder keeps the seams between primitives (material boundaries) and the open
        // borders (neck, sleeves) exactly where the neighbor mesh expects them
        if (ratio < 1 && error > 0) {
          for (const prim of prims) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error, lockBorder: true });
        }
      }
      const now = mesh.listPrimitives().reduce((a, p) => a + triCount(p), 0);
      after += now;
      perMesh.push(`${mesh.getName()}=${now}`);
    }
    // skinned and seen up close: characters and creatures keep fine normals and skin weights
    const character = kind === 'character' || kind === 'creature';
    await doc.transform(
      resample({ tolerance: 1e-4 }),
      prune({ keepLeaves: true }), // keep the empty socket nodes
      quantize({
        quantizePosition: 14,
        // smooth toon bands read the normals directly: more bits on the characters
        quantizeNormal: character ? 12 : 10,
        quantizeTexcoord: 12,
        quantizeColor: 8,
        quantizeWeight: character ? 16 : 8,
      }),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    const out = join(DST, `${name}.glb`);
    await io.write(out, doc);
    const kb = statSync(out).size / 1024;
    total += kb;
    console.log(`${name} (${kind}): ${before} -> ${after} tris, ${kb.toFixed(0)} KB${character ? `\n  ${perMesh.join(' ')}` : ''}`);
  }
  const catalog = join(SRC, 'nature', 'nature.json');
  if (existsSync(catalog) && !only.length) {
    copyFileSync(catalog, resolve('assets/nature.json'));
    console.log('nature.json -> assets/nature.json');
  }
  console.log(`total ${(total / 1024).toFixed(2)} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
