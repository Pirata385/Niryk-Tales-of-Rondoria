import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Models are bundled by Vite from the @models alias: assets/models (meshopt-compressed by
// `npm run models`) or, in the single-file build, the decompressed copies in .cache/models-raw.
// Whatever is there is used; a missing model falls back to a placeholder shape in its view.
const modelGlob = import.meta.glob('@models/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const modelUrls = new Map<string, string>();
for (const [key, url] of Object.entries(modelGlob)) modelUrls.set(key.split('/').pop()!.replace(/\.glb$/, ''), url);

/** True when assets/models/<name>.glb was imported. */
export function hasModel(name: string): boolean {
  return modelUrls.has(name);
}

/** Names of every imported model. */
export function modelNames(): string[] {
  return [...modelUrls.keys()].sort();
}

let gltfLoader: Promise<GLTFLoader> | null = null;
function loader(): Promise<GLTFLoader> {
  gltfLoader ??= (async () => {
    const l = new GLTFLoader();
    if (!__SINGLE_FILE__) {
      // compressed models need the WebAssembly decoder (left out of the single-file build)
      const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
      l.setMeshoptDecoder(MeshoptDecoder);
    } else {
      // embedded textures through <img> (blob: image) instead of fetch(blob:), which a strict
      // content policy (an Artifact page) refuses
      l.register((parser) => {
        parser.textureLoader = new THREE.TextureLoader(parser.options.manager);
        return { name: 'niryk_img_textures' };
      });
    }
    return l;
  })();
  return gltfLoader;
}

/** data: URLs are decoded here instead of fetched (a page's content policy may block that). */
function dataUrlBuffer(url: string): ArrayBuffer {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

const gltfCache = new Map<string, Promise<GLTF>>();

/** Loads (once) a model from assets/models. Clone it (SkeletonUtils for skinned ones) before use. */
export function loadModel(name: string): Promise<GLTF> {
  let p = gltfCache.get(name);
  if (!p) {
    const url = modelUrls.get(name);
    if (!url) return Promise.reject(new Error(`missing model: ${name}`));
    p = loader().then((l) => (url.startsWith('data:') ? l.parseAsync(dataUrlBuffer(url), '') : l.loadAsync(url)));
    gltfCache.set(name, p);
  }
  return p;
}

/** Loads a model if it was imported, or resolves null (the caller builds a placeholder). */
export async function loadModelOrNull(name: string): Promise<GLTF | null> {
  if (!hasModel(name)) return null;
  try {
    return await loadModel(name);
  } catch (err) {
    console.warn(`model ${name} failed to load, using a placeholder`, err);
    return null;
  }
}
