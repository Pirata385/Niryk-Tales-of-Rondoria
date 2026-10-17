import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LAYER_OUTLINE } from './PixelPipeline';

/**
 * Merges every mesh of static objects (village structures) into a few meshes baked in world space.
 * Material colors are multiplied into the vertex colors, so meshes only split by what a vertex
 * cannot carry (texture, sidedness, transparency, emission): hundreds of draw calls per pass become
 * a handful.
 */
export function staticBatch(objects: THREE.Object3D[]): THREE.Mesh[] {
  const groups = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[] }>();
  for (const root of objects) {
    root.updateMatrixWorld(true);
    root.traverseVisible((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const key = materialKey(mesh.material);
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { material: batchMaterial(mesh.material), geos: [] }));
      g.geos.push(bake(mesh.geometry, mesh.matrixWorld, (mesh.material as THREE.MeshToonMaterial).color));
    });
  }
  const out: THREE.Mesh[] = [];
  for (const { material, geos } of groups.values()) {
    const merged = mergeGeometries(unifyAttributes(geos), false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `Static_${material.name}`;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.layers.enable(LAYER_OUTLINE);
    mesh.matrixAutoUpdate = false;
    out.push(mesh);
    for (const g of geos) g.dispose();
  }
  return out;
}

function materialKey(m: THREE.Material): string {
  const t = m as THREE.MeshToonMaterial;
  // textures are named by content hash at import (tools/import-models.mjs): equal names = same image
  return [t.map ? t.map.name || t.map.uuid : '', m.side, m.transparent, m.alphaTest, t.emissive?.getHexString(), t.emissiveMap?.uuid ?? ''].join('|');
}

function batchMaterial(src: THREE.Material): THREE.Material {
  const m = src.clone() as THREE.MeshToonMaterial;
  m.name = m.map ? 'Textured' : m.emissive.getHex() ? 'Emissive' : 'Painted';
  m.color.set(1, 1, 1);
  m.vertexColors = true;
  return m;
}

/** Dequantized float copy in world space, with the material color folded into vertex colors. */
function bake(src: THREE.BufferGeometry, matrix: THREE.Matrix4, tint: THREE.Color): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') continue;
    const a = attr as THREE.BufferAttribute;
    const size = name === 'color' ? 4 : a.itemSize;
    const arr = new Float32Array(a.count * size);
    for (let i = 0; i < a.count; i++) {
      arr[i * size] = a.getX(i);
      if (size > 1) arr[i * size + 1] = a.getY(i);
      if (size > 2) arr[i * size + 2] = a.getZ(i);
      if (size > 3) arr[i * size + 3] = a.itemSize > 3 ? a.getW(i) : 1;
    }
    geo.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const count = src.attributes.position.count;
  if (!geo.attributes.color) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 4).fill(1), 4));
  const col = geo.attributes.color.array as Float32Array;
  for (let i = 0; i < count; i++) {
    col[i * 4] *= tint.r;
    col[i * 4 + 1] *= tint.g;
    col[i * 4 + 2] *= tint.b;
  }
  const index = src.index;
  if (index) geo.setIndex(Array.from({ length: index.count }, (_, i) => index.getX(i)));
  geo.applyMatrix4(matrix);
  return geo;
}

/** mergeGeometries needs identical attribute sets: fill missing ones (white color, zero uv). */
function unifyAttributes(geos: THREE.BufferGeometry[]): THREE.BufferGeometry[] {
  const names = new Set<string>();
  for (const g of geos) for (const n of Object.keys(g.attributes)) names.add(n);
  const indexed = geos.some((g) => g.index);
  for (const g of geos) {
    const count = g.attributes.position.count;
    for (const n of names) {
      if (g.attributes[n]) continue;
      const size = n === 'color' ? 4 : n === 'uv' ? 2 : 3;
      g.setAttribute(n, new THREE.BufferAttribute(new Float32Array(count * size).fill(n === 'color' ? 1 : 0), size));
    }
    if (indexed && !g.index) g.setIndex(Array.from({ length: count }, (_, i) => i));
  }
  return geos;
}
