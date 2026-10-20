import * as THREE from 'three';
import { Rng } from '@shared/math/random';
import type { WorldData } from '@shared/world/worldgen';
import { toonMaterial } from '../render/toon';

const C = (hex: string) => new THREE.Color(hex);
/** Ground palette (sRGB): sunny meadow, fresh green, forest floor, moss, dirt, mud. */
const MEADOW_A = C('#93c457');
const MEADOW_B = C('#62a548');
const FOREST = C('#4c7f3d');
const MOSS = C('#6b7a3a');
const DIRT = C('#b98f5c');
const DIRT_DARK = C('#94704a');
const MUD = C('#6e5a42');

/**
 * A tiling grayscale texture of short painted strokes around 1.0: breaks up the flat ground color
 * without fighting the toon bands.
 */
function strokeTexture(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const v = new Float32Array(size * size).fill(1);
  const rng = new Rng(7);
  for (let i = 0; i < 2600; i++) {
    const x0 = rng.range(0, size);
    const y0 = rng.range(0, size);
    const len = rng.range(3, 9);
    const ang = -1.1 + rng.range(-0.35, 0.35);
    const shade = rng.chance(0.55) ? rng.range(0.9, 0.95) : rng.range(1.04, 1.08);
    for (let t = 0; t < len; t += 0.5) {
      for (const w of [0, 1]) {
        const x = Math.floor(x0 + Math.cos(ang) * t + w * 0.5) & (size - 1);
        const y = Math.floor(y0 + Math.sin(ang) * t + w) & (size - 1);
        v[y * size + x] = shade;
      }
    }
  }
  for (let i = 0; i < size * size; i++) {
    const b = Math.round(Math.min(1.2, v[i]) * 200);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The ground: one heightfield mesh over the whole scenery (the playable square and the wooded
 * hills around it), vertex-painted from the world's ground sample (meadow tones, forest floor,
 * trail dirt, muddy banks), toon shaded with the sun's stepped shadows.
 */
export class Terrain {
  readonly mesh: THREE.Mesh;

  constructor(world: WorldData, spacing = 1.5) {
    const ext = world.extent;
    const n = Math.ceil((ext * 2) / spacing) + 1;
    const step = (ext * 2) / (n - 1);
    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const uv = new Float32Array(n * n * 2);
    const c = new THREE.Color();
    const tmp = new THREE.Color();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const x = -ext + i * step;
        const z = -ext + j * step;
        const y = world.height(x, z);
        pos.set([x, y, z], k * 3);
        uv.set([x / 3.2, z / 3.2], k * 2);
        const g = world.ground(x, z);
        c.copy(MEADOW_A).lerp(MEADOW_B, Math.min(1, Math.max(0, (g.tone - 0.3) * 2.2)));
        c.lerp(tmp.copy(FOREST).lerp(MOSS, g.tone > 0.55 ? 0.45 : 0.1), g.forest * 0.85);
        c.lerp(tmp.copy(DIRT).lerp(DIRT_DARK, g.tone), g.dirt);
        c.lerp(MUD, g.mud * 0.9);
        col.set([c.r, c.g, c.b], k * 3);
      }
    }
    const index: number[] = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        const b = a + 1;
        const d = a + n;
        const e = d + 1;
        index.push(a, d, b, b, d, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mat = toonMaterial({ name: 'Ground', vertexColors: true, map: strokeTexture() }, { rim: 0 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'Terrain';
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const m = this.mesh.material as THREE.MeshToonMaterial;
    m.map?.dispose();
    m.dispose();
  }
}
