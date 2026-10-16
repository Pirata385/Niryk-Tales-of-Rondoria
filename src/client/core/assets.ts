import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { SpriteAtlas } from '../render/Billboards';

// Every file under /assets is bundled by Vite: URLs for binaries, parsed objects for JSON.
const urls = import.meta.glob('/assets/**/*.{png,glb}', { query: '?url', import: 'default', eager: true }) as Record<
  string,
  string
>;
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

const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const gltfCache = new Map<string, Promise<GLTF>>();

/** Loads (once) a model from assets/models. Clone it with SkeletonUtils before adding to a scene. */
export function loadModel(name: string): Promise<GLTF> {
  let p = gltfCache.get(name);
  if (!p) {
    p = gltfLoader.loadAsync(assetUrl(`models/${name}.glb`));
    gltfCache.set(name, p);
  }
  return p;
}

export async function loadSpriteAtlas(name: string): Promise<{ atlas: SpriteAtlas; texture: THREE.Texture }> {
  const atlas = assetJson<SpriteAtlas>(`sprites/${name}.json`);
  const texture = await loadTexture(`sprites/${atlas.image}`);
  return { atlas, texture };
}
