import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STRUCTURES } from '@shared/world/worldgen';
import { hasModel, loadModelOrNull } from '../core/assets';
import { toonFromGltf, toonMaterial } from '../render/toon';

/** One drawable piece of a structure: a geometry with its material and its place in the model. */
export interface StructurePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Model space of the part (GLB node transform, or a unit of a group). */
  matrix: THREE.Matrix4;
  /** Gets an ink hull (false for glowing glass). */
  ink: boolean;
}

export interface StructureModel {
  type: string;
  parts: StructurePart[];
  /** The GLB it came from, or null for the placeholder. */
  source: string | null;
}

/**
 * GLB names tried for each structure type, in order (the first one imported wins). Types not
 * listed use their own name (house_a, well, stall, fence, bench...).
 */
export const MODEL_NAMES: Record<string, string[]> = {
  lamp: ['lamp_post', 'lamp'],
  notice: ['notice_board', 'notice'],
  crates: ['crates', 'crate'],
  barrels: ['barrels', 'barrel'],
};

/** A group type built from several copies of a single-unit model: x, z, rotation y per copy. */
const UNITS: Record<string, { model: string; at: [number, number, number][] }> = {
  crates: { model: 'crate', at: [[-0.4, 0, 0.1], [0.4, 0.05, -0.15]] },
  barrels: { model: 'barrel', at: [[-0.36, 0, 0], [0.38, 0.08, 0.6]] },
};

const cache = new Map<string, Promise<StructureModel>>();

/** The model of a structure type: its imported GLB (by name, see MODEL_NAMES), or a toon placeholder. */
export function structureModel(type: string): Promise<StructureModel> {
  let p = cache.get(type);
  if (!p) {
    p = build(type);
    cache.set(type, p);
  }
  return p;
}

async function build(type: string): Promise<StructureModel> {
  for (const name of MODEL_NAMES[type] ?? [type]) {
    if (!hasModel(name)) continue;
    const gltf = await loadModelOrNull(name);
    if (!gltf) continue;
    const unit = UNITS[type]?.model === name ? UNITS[type].at : [[0, 0, 0] as [number, number, number]];
    const parts: StructurePart[] = [];
    gltf.scene.updateMatrixWorld(true);
    const at = new THREE.Matrix4();
    for (const [x, z, ry] of unit) {
      at.makeRotationY(ry).setPosition(x, 0, z);
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          parts.push({ geometry: mesh.geometry, material: toonFromGltf(m, { rim: 0.3 }), matrix: at.clone().multiply(mesh.matrixWorld), ink: true });
        }
      });
    }
    return { type, parts, source: name };
  }
  return { type, parts: placeholder(type), source: null };
}

// ------------------------------------------------------------------ placeholders

type V3 = [number, number, number];

/** Non-indexed, flat vertex color, no uv (so every piece merges with every other). */
function paint(g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function box(size: V3, at: V3, hex: string, rot: V3 = [0, 0, 0]): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(...size);
  if (rot[0]) g.rotateX(rot[0]);
  if (rot[1]) g.rotateY(rot[1]);
  if (rot[2]) g.rotateZ(rot[2]);
  return paint(g.translate(...at), hex);
}

function cyl(rTop: number, rBottom: number, h: number, at: V3, hex: string, seg = 14): THREE.BufferGeometry {
  return paint(new THREE.CylinderGeometry(rTop, rBottom, h, seg).translate(...at), hex);
}

function ball(r: number, at: V3, hex: string, detail = 1): THREE.BufferGeometry {
  return paint(new THREE.IcosahedronGeometry(r, detail).translate(...at), hex);
}

/**
 * A gable prism on y = 0 (the triangular end walls on ±X, the ridge along X at height h), plus
 * two roof slabs of thickness `th` overhanging by `oh`.
 */
function gableRoof(w: number, d: number, h: number, y: number, wall: string, roof: string, oh = 0.35, th = 0.16): THREE.BufferGeometry[] {
  const A: V3 = [-w / 2, 0, d / 2];
  const B: V3 = [w / 2, 0, d / 2];
  const C: V3 = [w / 2, 0, -d / 2];
  const D: V3 = [-w / 2, 0, -d / 2];
  const E: V3 = [-w / 2, h, 0];
  const F: V3 = [w / 2, h, 0];
  const tris = [A, B, F, A, F, E, C, D, E, C, E, F, D, A, E, B, C, F];
  const prism = new THREE.BufferGeometry();
  prism.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris.flat()), 3));
  prism.computeVertexNormals();
  const out = [paint(prism.translate(0, y, 0), wall)];
  const len = Math.hypot(h, d / 2);
  const ang = Math.atan2(h, d / 2);
  for (const side of [1, -1]) {
    const dir = new THREE.Vector3(0, -h / len, (side * d) / 2 / len);
    const n = new THREE.Vector3(0, d / 2 / len, (side * h) / len);
    const c = new THREE.Vector3(0, y + h / 2, (side * d) / 4).addScaledVector(dir, oh / 2).addScaledVector(n, th / 2);
    out.push(paint(new THREE.BoxGeometry(w + oh * 2, th, len + oh).rotateX(side * ang).translate(c.x, c.y, c.z), roof));
  }
  // ridge beam
  out.push(paint(new THREE.CylinderGeometry(0.09, 0.09, w + oh * 2, 8).rotateZ(Math.PI / 2).translate(0, y + h + th * 0.6, 0), roof));
  return out;
}

const WOOD = '#9a6a42';
const WOOD_DARK = '#6a4630';
const STONE = '#a39c93';
const STONE_DARK = '#8a847d';
const GLASS = '#3e4c68';

interface HouseStyle {
  wall: number;
  roofH: number;
  plaster: string;
  roof: string;
  shutter: string;
  door: number;
  floors: number;
}

const HOUSES: Record<string, HouseStyle> = {
  house_a: { wall: 3.0, roofH: 2.4, plaster: '#efe1c4', roof: '#b4533b', shutter: '#3f6a8a', door: 0, floors: 1 },
  house_b: { wall: 3.9, roofH: 2.8, plaster: '#e9d6b6', roof: '#5f6f9c', shutter: '#7a3a3a', door: -1.2, floors: 2 },
  house_c: { wall: 2.8, roofH: 2.2, plaster: '#f2e8d2', roof: '#c08b3f', shutter: '#4f7a46', door: 0.9, floors: 1 },
};

function house(type: string): THREE.BufferGeometry[] {
  const { w, d } = STRUCTURES[type];
  const s = HOUSES[type];
  const g: THREE.BufferGeometry[] = [];
  const front = d / 2;
  // stone footing (reaches under the ground on slopes), plaster walls, timber corners and bands
  g.push(box([w + 0.18, 1.0, d + 0.18], [0, -0.1, 0], STONE_DARK));
  g.push(box([w, s.wall, d], [0, s.wall / 2, 0], s.plaster));
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.push(box([0.24, s.wall, 0.24], [(x * w) / 2, s.wall / 2, (z * d) / 2], WOOD_DARK));
  g.push(box([w + 0.1, 0.22, d + 0.1], [0, s.wall - 0.11, 0], WOOD_DARK));
  if (s.floors > 1) g.push(box([w + 0.08, 0.18, d + 0.08], [0, s.wall * 0.5, 0], WOOD_DARK));
  g.push(...gableRoof(w, d, s.roofH, s.wall, s.plaster, s.roof));
  // chimney through the back slope
  g.push(box([0.62, s.roofH + 0.9, 0.62], [w * 0.28, s.wall + (s.roofH + 0.9) / 2, -d * 0.22], STONE));
  g.push(box([0.74, 0.14, 0.74], [w * 0.28, s.wall + s.roofH + 0.9, -d * 0.22], STONE_DARK));
  // the door with its frame and step (front, +Z)
  g.push(box([1.4, 2.3, 0.1], [s.door, 1.15, front + 0.02], WOOD_DARK));
  g.push(box([1.1, 2.08, 0.14], [s.door, 1.04, front + 0.04], '#5a3a26'));
  g.push(box([0.08, 0.08, 0.08], [s.door + 0.36, 1.05, front + 0.14], '#c9a24a'));
  g.push(box([1.7, 0.22, 0.7], [s.door, 0.0, front + 0.36], STONE));
  // windows: frame, glass, shutters, a flower box under the front ones
  const window = (x: number, y: number, z: number, ry: number, flowers: boolean) => {
    const c = Math.cos(ry);
    const sn = Math.sin(ry);
    const at = (lx: number, ly: number, lz: number): V3 => [x + lx * c + lz * sn, y + ly, z - lx * sn + lz * c];
    g.push(box([1.05, 1.05, 0.1], at(0, 0, 0.02), WOOD_DARK, [0, ry, 0]));
    g.push(box([0.8, 0.8, 0.1], at(0, 0, 0.05), GLASS, [0, ry, 0]));
    g.push(box([0.06, 0.8, 0.12], at(0, 0, 0.06), WOOD_DARK, [0, ry, 0]));
    for (const sx of [-1, 1]) g.push(box([0.4, 1.0, 0.06], at(sx * 0.76, 0, 0.04), s.shutter, [0, ry, 0]));
    if (flowers) {
      g.push(box([1.0, 0.22, 0.28], at(0, -0.66, 0.14), WOOD, [0, ry, 0]));
      for (let k = 0; k < 4; k++) g.push(ball(0.09, at(-0.33 + k * 0.22, -0.48, 0.15), ['#e8506a', '#f2d14a', '#f4f0ea', '#c060d0'][k], 0));
    }
  };
  const wx = s.door === 0 ? w * 0.3 : -Math.sign(s.door) * w * 0.22;
  window(wx, 1.75, front, 0, true);
  if (s.door === 0) window(-wx, 1.75, front, 0, true);
  if (s.floors > 1) for (const x of [-w * 0.25, w * 0.25]) window(x, s.wall * 0.76, front, 0, false);
  window(w / 2, 1.75, 0, Math.PI / 2, false);
  window(-w / 2, 1.75, 0, -Math.PI / 2, false);
  return g;
}

function well(): THREE.BufferGeometry[] {
  const g = [cyl(1.12, 1.18, 0.85, [0, 0.42, 0], STONE, 18)];
  g.push(paint(new THREE.TorusGeometry(1.1, 0.11, 6, 18).rotateX(Math.PI / 2).translate(0, 0.86, 0), '#b9b1a7'));
  g.push(cyl(0.93, 0.93, 0.04, [0, 0.82, 0], '#2f5a7a', 18));
  for (const x of [-0.98, 0.98]) g.push(box([0.18, 2.5, 0.18], [x, 1.25, 0], WOOD_DARK));
  g.push(paint(new THREE.CylinderGeometry(0.08, 0.08, 2.0, 8).rotateZ(Math.PI / 2).translate(0, 1.95, 0), WOOD));
  g.push(cyl(0.012, 0.012, 0.6, [0.15, 1.62, 0], '#c8b48a', 4));
  g.push(cyl(0.15, 0.12, 0.24, [0.15, 1.24, 0], WOOD));
  g.push(...gableRoof(2.3, 1.5, 0.6, 2.5, WOOD, '#b4533b', 0.2, 0.1));
  return g;
}

function stall(): THREE.BufferGeometry[] {
  const g = [box([2.9, 1.0, 0.8], [0, 0.5, 0.45], WOOD), box([3.0, 0.08, 0.9], [0, 1.02, 0.45], WOOD_DARK)];
  for (const [x, z] of [[-1.45, 0.85], [1.45, 0.85], [-1.45, -0.85], [1.45, -0.85]]) g.push(box([0.12, 2.4 + (z < 0 ? 0.2 : 0), 0.12], [x, 1.2 + (z < 0 ? 0.1 : 0), z], WOOD_DARK));
  const n = 6;
  for (let i = 0; i < n; i++) {
    const sw = 3.3 / n;
    g.push(box([sw, 0.06, 2.2], [-1.65 + sw * (i + 0.5), 2.48, 0.05], i % 2 ? '#f1e4c8' : '#c8443a', [0.19, 0, 0]));
  }
  // goods: apples, cabbages and a basket
  for (let k = 0; k < 8; k++) g.push(ball(0.07, [-1.1 + (k % 4) * 0.16, 1.11, 0.32 + Math.floor(k / 4) * 0.16], k % 3 ? '#c8402f' : '#8cb43a', 0));
  for (let k = 0; k < 3; k++) g.push(ball(0.13, [0.25 + k * 0.28, 1.18, 0.45], '#7aa84a', 1));
  g.push(cyl(0.2, 0.16, 0.2, [1.1, 1.16, 0.45], '#b8925a', 10));
  return g;
}

function notice(): THREE.BufferGeometry[] {
  const g = [-0.7, 0.7].map((x) => box([0.14, 2.1, 0.14], [x, 1.05, 0], WOOD_DARK));
  g.push(box([1.5, 1.0, 0.08], [0, 1.4, 0.02], WOOD));
  for (const [x, y, r] of [[-0.42, 1.48, 0.06], [0.05, 1.36, -0.05], [0.45, 1.5, 0.08]]) g.push(box([0.32, 0.4, 0.02], [x, y, 0.08], '#f4ecd8', [0, 0, r]));
  g.push(...gableRoof(1.6, 0.45, 0.22, 2.1, WOOD_DARK, '#b4533b', 0.12, 0.08));
  return g;
}

function lampPost(): THREE.BufferGeometry[] {
  const iron = '#3d3a44';
  const g = [box([0.34, 0.3, 0.34], [0, 0.15, 0], STONE), cyl(0.055, 0.075, 2.6, [0, 1.6, 0], iron, 8)];
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.push(box([0.035, 0.42, 0.035], [x * 0.13, 3.0, z * 0.13], iron));
  g.push(box([0.34, 0.05, 0.34], [0, 2.78, 0], iron), box([0.34, 0.05, 0.34], [0, 3.22, 0], iron));
  g.push(paint(new THREE.ConeGeometry(0.27, 0.2, 4).rotateY(Math.PI / 4).translate(0, 3.35, 0), iron));
  return g;
}

function crates(): THREE.BufferGeometry[] {
  const g: THREE.BufferGeometry[] = [];
  const crate = (s: number, x: number, y: number, z: number, ry: number) => {
    g.push(box([s, s, s], [x, y + s / 2, z], '#b0814f', [0, ry, 0]));
    for (const by of [0.07, s - 0.07]) g.push(box([s + 0.03, 0.09, s + 0.03], [x, y + by, z], WOOD_DARK, [0, ry, 0]));
  };
  crate(0.74, -0.38, 0, 0, 0.1);
  crate(0.68, 0.4, 0, 0.05, -0.15);
  crate(0.52, -0.3, 0.74, 0.02, 0.35);
  return g;
}

function barrels(): THREE.BufferGeometry[] {
  const g: THREE.BufferGeometry[] = [];
  const profile = [[0, 0], [0.3, 0], [0.35, 0.22], [0.37, 0.47], [0.35, 0.72], [0.3, 0.95], [0, 0.95]].map(([x, y]) => new THREE.Vector2(x, y));
  for (const [x, z] of [[-0.36, 0], [0.38, 0.08]]) {
    g.push(paint(new THREE.LatheGeometry(profile, 14).translate(x, 0, z), '#8b5a33'));
    for (const y of [0.2, 0.75]) g.push(paint(new THREE.TorusGeometry(0.355, 0.025, 4, 16).rotateX(Math.PI / 2).translate(x, y, z), '#4a4650'));
  }
  return g;
}

function fence(): THREE.BufferGeometry[] {
  const g = [-1.43, 0, 1.43].map((x) => box([0.14, 1.0, 0.14], [x, 0.5, 0], WOOD_DARK));
  for (const y of [0.45, 0.8]) g.push(box([3.0, 0.1, 0.06], [0, y, 0], WOOD));
  return g;
}

function bench(): THREE.BufferGeometry[] {
  const g = [box([1.6, 0.08, 0.42], [0, 0.46, 0.04], WOOD)];
  for (const x of [-0.65, 0.65]) g.push(box([0.1, 0.46, 0.38], [x, 0.23, 0.04], WOOD_DARK), box([0.08, 0.5, 0.06], [x, 0.72, -0.2], WOOD_DARK, [-0.15, 0, 0]));
  g.push(box([1.6, 0.3, 0.06], [0, 0.8, -0.22], WOOD, [-0.15, 0, 0]));
  return g;
}

function flowerBed(): THREE.BufferGeometry[] {
  const g = [cyl(0.74, 0.78, 0.28, [0, 0.14, 0], STONE, 16), cyl(0.66, 0.66, 0.02, [0, 0.29, 0], '#5e4632', 16)];
  const hues = ['#e8506a', '#f2d14a', '#f4f0ea', '#b070e0', '#f08a3a'];
  for (let k = 0; k < 9; k++) {
    const a = k * 2.4;
    const r = k === 0 ? 0 : 0.22 + (k % 3) * 0.13;
    g.push(ball(0.13, [Math.cos(a) * r, 0.36, Math.sin(a) * r], k % 2 ? '#4f9a42' : '#5fae48', 0));
    g.push(ball(0.065, [Math.cos(a) * r, 0.5, Math.sin(a) * r], hues[k % hues.length], 0));
  }
  return g;
}

const BUILDERS: Record<string, () => THREE.BufferGeometry[]> = {
  well, stall, notice, lamp: lampPost, crates, barrels, fence, bench, flower_bed: flowerBed,
};

/** A tidy toon stand-in of the structure's footprint and height, one vertex-colored mesh. */
function placeholder(type: string): StructurePart[] {
  const geos = HOUSES[type] ? house(type) : (BUILDERS[type]?.() ?? [box([STRUCTURES[type]?.w ?? 1, 1, STRUCTURES[type]?.d ?? 1], [0, 0.5, 0], WOOD)]);
  const material = toonMaterial({ name: 'Structure', vertexColors: true }, { rim: 0.3 });
  const parts: StructurePart[] = [{ geometry: mergeGeometries(geos)!, material, matrix: new THREE.Matrix4(), ink: true }];
  if (type === 'lamp') {
    // the lantern glass glows (unlit, warm)
    const glass = new THREE.BoxGeometry(0.22, 0.36, 0.22).translate(0, 3.0, 0);
    parts.push({ geometry: glass, material: new THREE.MeshBasicMaterial({ name: 'Glow', color: '#ffd98a' }), matrix: new THREE.Matrix4(), ink: false });
  }
  return parts;
}
