import * as THREE from 'three';
import { Rng } from '@shared/math/random';
import type { WorldData } from '@shared/world/worldgen';
import { toonMaterial } from '../render/toon';

/** Stones per texture side, texture size (px) and how many meters one texture covers. */
const CELLS = 8;
const SIZE = 256;
const TILE_M = 2.3;

/**
 * A tiling cobblestone texture (sRGB): rounded stones of warm grays from jittered cells, a lighter
 * crown on each and dark mortar between them.
 */
function cobbleTexture(): THREE.DataTexture {
  const rng = new Rng(11);
  const pts: [number, number][] = [];
  const tone: number[] = [];
  for (let j = 0; j < CELLS; j++) {
    for (let i = 0; i < CELLS; i++) {
      pts.push([i + 0.2 + rng.next() * 0.6, j + 0.2 + rng.next() * 0.6]);
      tone.push(rng.next());
    }
  }
  const data = new Uint8Array(SIZE * SIZE * 4);
  const cell = SIZE / CELLS;
  const warm = new THREE.Color('#c4b59c');
  const cool = new THREE.Color('#a6a29e');
  const mortar = new THREE.Color('#7d6e5c');
  const c = new THREE.Color();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / cell;
      const v = y / cell;
      let d1 = Infinity;
      let d2 = Infinity;
      let best = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ci = Math.floor(u) + di;
          const cj = Math.floor(v) + dj;
          const k = (((cj % CELLS) + CELLS) % CELLS) * CELLS + (((ci % CELLS) + CELLS) % CELLS);
          const px = pts[k][0] + (ci - (((ci % CELLS) + CELLS) % CELLS));
          const py = pts[k][1] + (cj - (((cj % CELLS) + CELLS) % CELLS));
          const d = Math.hypot(u - px, v - py);
          if (d < d1) {
            d2 = d1;
            d1 = d;
            best = k;
          } else if (d < d2) d2 = d;
        }
      }
      const edge = d2 - d1; // 0 on the border between two stones
      c.copy(cool).lerp(warm, tone[best]);
      c.multiplyScalar(1.06 - Math.min(0.5, d1) * 0.22); // a lighter crown
      if (edge < 0.09) c.lerp(mortar, 1 - edge / 0.09);
      const o = (y * SIZE + x) * 4;
      data[o] = Math.round(c.r * 255);
      data[o + 1] = Math.round(c.g * 255);
      data[o + 2] = Math.round(c.b * 255);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The cobbled village square: a disc over the plaza that follows the ground a few centimeters
 * above it, with a ring of curb stones at its edge.
 */
export class Plaza {
  readonly mesh: THREE.Mesh;

  constructor(world: WorldData) {
    const plaza = world.plaza!;
    const rings = 16;
    const segs = 72;
    const R = plaza.r + 0.3;
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const index: number[] = [];
    const curb = new THREE.Color('#b5a68e');
    for (let j = 0; j <= rings; j++) {
      const r = (j / rings) * R;
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const x = plaza.x + Math.cos(a) * r;
        const z = plaza.z + Math.sin(a) * r;
        pos.push(x, world.height(x, z) + 0.04, z);
        uv.push(x / TILE_M, z / TILE_M);
        // the outer ring is a lighter curb band
        const k = j === rings ? 0.92 : 1;
        col.push(j === rings ? curb.r : k, j === rings ? curb.g : k, j === rings ? curb.b : k);
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < segs; i++) {
        const a = j * (segs + 1) + i;
        const b = a + segs + 1;
        index.push(a, a + 1, b, a + 1, b + 1, b); // counter-clockwise seen from above
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mat = toonMaterial({ name: 'Cobbles', map: cobbleTexture(), vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, { rim: 0 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'Plaza';
    this.mesh.receiveShadow = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const m = this.mesh.material as THREE.MeshToonMaterial;
    m.map?.dispose();
    m.dispose();
    this.mesh.removeFromParent();
  }
}
