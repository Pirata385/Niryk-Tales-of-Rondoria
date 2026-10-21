// Writes decompressed copies of assets/models/*.glb (no EXT_meshopt_compression, quantization kept)
// to .cache/models-raw. The single-file build embeds those, so the page needs no WebAssembly
// decoder (an Artifact page's content policy may not allow it). Run by `npm run build:single`.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'assets/models';
const DST = '.cache/models-raw';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
mkdirSync(DST, { recursive: true });
for (const f of readdirSync(SRC).filter((f) => f.endsWith('.glb'))) {
  const doc = await io.read(join(SRC, f));
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (ext.extensionName === 'EXT_meshopt_compression') ext.dispose();
  }
  await io.write(join(DST, f), doc);
}
console.log(`raw models -> ${DST}`);
