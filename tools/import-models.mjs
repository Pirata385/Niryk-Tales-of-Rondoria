// Imports the GLBs exported by Pyram3D into the game, optimized for the web:
//   - welds and simplifies dense SDF meshes to a triangle budget (meshoptimizer),
//     skipping thin feather cards and small parts,
//   - removes redundant animation keys, quantizes vertex data, meshopt-compresses buffers,
//   - names every texture by its content hash, so the client can share identical painted textures
//     between models (and batch the village into a few draw calls).
//
//   node tools/import-models.mjs [name ...]     (default: everything)
//   PYRAM3D_EXPORTS=/path/to/Pyram3D/projects/niryk/exports
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, quantize, resample, simplifyPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const SRC = resolve(process.env.PYRAM3D_EXPORTS ?? '../Pyram3D/projects/niryk/exports');
const DST = resolve('assets/models');

/** Max triangles per primitive (by mesh-name prefix); unmatched primitives use DEFAULT_BUDGET. */
const BUDGETS = [
  [/^Body/, 3600],
  [/^Outfit/, 3200],
  [/^Hair_/, 1100],
  [/^Wings/, 2600],
  [/^Eyes/, 400],
  [/^Armor/, 3400],
  [/^Wolf/, 5000],
];
const DEFAULT_BUDGET = 2500;
/** Max simplification error (fraction of the mesh size): tighter where garments sit 1-2 cm over
 *  the skin, so simplifying them can't sink the cloth under the body. */
const ERRORS = [
  [/^Outfit/, 0.004],
  [/^Body/, 0.008], // covered skin is deleted at build time; the rest may move a little more
  [/^Armor/, 0.02], // rigid plates ~4 cm over the cloth: room to simplify down to the 4k budget
];
const DEFAULT_ERROR = 0.012;
const NEVER_SIMPLIFY = /Feather/; // thin double-sided cards break when collapsed

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
  for (const file of findGlbs(SRC)) {
    const name = basename(file, '.glb');
    if (only.length && !only.includes(name)) continue;
    const doc = await io.read(file);
    await doc.transform(dedup(), weld());
    for (const tex of doc.getRoot().listTextures()) {
      const hash = createHash('sha1').update(tex.getImage()).digest('hex').slice(0, 10);
      tex.setName(`${tex.getName() || 'tex'}#${hash}`);
    }
    let before = 0;
    let after = 0;
    const perMesh = [];
    for (const mesh of doc.getRoot().listMeshes()) {
      // the budget is per mesh: shared proportionally by its primitives (one per material)
      const budget = BUDGETS.find(([re]) => re.test(mesh.getName()))?.[1] ?? DEFAULT_BUDGET;
      const prims = mesh.listPrimitives();
      const fixed = prims.filter((p) => NEVER_SIMPLIFY.test(p.getMaterial()?.getName() ?? ''));
      const flexible = prims.filter((p) => !fixed.includes(p));
      const fixedTris = fixed.reduce((a, p) => a + triCount(p), 0);
      const flexTris = flexible.reduce((a, p) => a + triCount(p), 0);
      const ratio = Math.min(1, Math.max(0.05, (budget - fixedTris) / Math.max(1, flexTris)));
      before += fixedTris + flexTris;
      if (ratio < 1) {
        // lockBorder keeps the seams between primitives (material boundaries) closed
        const error = ERRORS.find(([re]) => re.test(mesh.getName()))?.[1] ?? DEFAULT_ERROR;
        // armor parts are separate plates: their material seams don't need locking
        const lockBorder = !/^Armor/.test(mesh.getName());
        for (const prim of flexible) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error, lockBorder });
      }
      after += prims.reduce((a, p) => a + triCount(p), 0);
      perMesh.push(`${mesh.getName()}=${mesh.listPrimitives().reduce((a, p) => a + triCount(p), 0)}`);
    }
    await doc.transform(
      resample({ tolerance: 1e-4 }),
      prune({ keepLeaves: true }), // keep the empty socket nodes
      quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8, quantizeWeight: 8 }),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    const out = join(DST, `${name}.glb`);
    await io.write(out, doc);
    const kb = (statSync(out).size / 1024).toFixed(0);
    console.log(`${name}: ${before} -> ${after} tris, ${kb} KB\n  ${perMesh.join(' ')}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
