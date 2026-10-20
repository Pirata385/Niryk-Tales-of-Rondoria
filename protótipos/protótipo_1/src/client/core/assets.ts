import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { SpriteAtlas } from '../render/Billboards';

// Every asset is bundled by Vite: URLs for binaries, parsed objects for JSON. Models come from the
// @models alias (meshopt-compressed normally; decompressed copies in the single-file build).
const urls = import.meta.glob('/assets/**/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const modelGlob = import.meta.glob('@models/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
for (const [key, url] of Object.entries(modelGlob)) urls[`/assets/models/${key.split('/').pop()}`] = url;
const json = import.meta.glob('/assets/**/*.json', { import: 'default', eager: true }) as Record<string, unknown>;

export function assetUrl(path: string): string {
  const url = urls[`/assets/${path}`];
  if (!url) throw new Error(`missing asset: ${path}`);
  return url;
}

export function hasAsset(path: string): boolean {
  return `/assets/${path}` in urls;
}

export function assetJson<T>(path: string): T {
  const data = json[`/assets/${path}`];
  if (!data) throw new Error(`missing asset: ${path}`);
  return data as T;
}

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map<string, Promise<THREE.Texture>>();

export function loadTexture(path: string): Promise<THREE.Texture> {
  let p = textureCache.get(path);
  if (!p) {
    p = textureLoader.loadAsync(assetUrl(path));
    textureCache.set(path, p);
  }
  return p;
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

/** Loads (once) a model from assets/models. Clone it with SkeletonUtils before adding to a scene. */
export function loadModel(name: string): Promise<GLTF> {
  let p = gltfCache.get(name);
  if (!p) {
    const url = assetUrl(`models/${name}.glb`);
    p = loader().then((l) => (url.startsWith('data:') ? l.parseAsync(dataUrlBuffer(url), '') : l.loadAsync(url)));
    gltfCache.set(name, p);
  }
  return p;
}

export async function loadSpriteAtlas(name: string): Promise<{ atlas: SpriteAtlas; texture: THREE.Texture }> {
  const atlas = assetJson<SpriteAtlas>(`sprites/${name}.json`);
  const texture = await loadTexture(`sprites/${atlas.image}`);
  return { atlas, texture };
}
