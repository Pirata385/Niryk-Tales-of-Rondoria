import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { NATURE, type NatureAsset } from '@shared/world/natureCatalog';
import { loadModelOrNull } from '../core/assets';
import { toonFromGltf, toonMaterial } from '../render/toon';

/** One drawable piece of a nature asset: a geometry with its toon material and its place in the model. */
export interface NaturePart {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshToonMaterial;
  /** Model space of the part (the GLB node transform, e.g. dequantization). */
  matrix: THREE.Matrix4;
  /** Wind uniform of the material, when it sways. */
  wind?: { value: THREE.Vector2 };
}

export interface NatureModel {
  name: string;
  parts: NaturePart[];
  placeholder: boolean;
}

const RIM: Record<string, number> = { tree: 0.35, bush: 0.35, rock: 0.25, grass: 0.15, flowers: 0.2 };

function windFor(a: NatureAsset | undefined, material: string): { sway: number; height: number } | null {
  if (!a?.wind || !a.wind.materials.includes(material)) return null;
  return { sway: a.wind.sway, height: a.height };
}

const cache = new Map<string, Promise<NatureModel>>();

/** The model of a nature asset: the imported GLB, or a placeholder shape of the catalog's size. */
export function natureModel(name: string): Promise<NatureModel> {
  let p = cache.get(name);
  if (!p) {
    p = build(name);
    cache.set(name, p);
  }
  return p;
}

async function build(name: string): Promise<NatureModel> {
  const a = NATURE[name];
  const gltf = await loadModelOrNull(name);
  if (!gltf) return { name, parts: placeholder(name, a), placeholder: true };
  const parts: NaturePart[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const material = toonFromGltf(m, { rim: RIM[a?.kind ?? ''] ?? 0.3, wind: windFor(a, m.name) });
      parts.push({ geometry: mesh.geometry, material, matrix: mesh.matrixWorld.clone(), wind: material.userData.wind });
    }
  });
  return { name, parts, placeholder: false };
}

// ------------------------------------------------------------------ placeholders

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

function part(geos: THREE.BufferGeometry[], material: string, a: NatureAsset | undefined): NaturePart {
  const geometry = mergeGeometries(geos)!;
  const mat = toonMaterial({ name: material, vertexColors: true }, { rim: RIM[a?.kind ?? ''] ?? 0.3, wind: windFor(a, material) });
  return { geometry, material: mat, matrix: new THREE.Matrix4(), wind: mat.userData.wind };
}

/** Simple shapes with the catalog's measures, so the world reads right before the models land. */
function placeholder(name: string, a: NatureAsset | undefined): NaturePart[] {
  const h = a?.height ?? 1;
  const r = a?.radius ?? 0.5;
  const kind = a?.kind ?? 'rock';
  if (kind === 'tree' && name.startsWith('pine')) {
    const trunk = paint(new THREE.CylinderGeometry(0.12, 0.26, h * 0.3, 7).translate(0, h * 0.15, 0), '#7a5034');
    const cones = [0, 1, 2, 3].map((i) => {
      const t = i / 4;
      const cr = r * (1 - t * 0.7);
      return paint(new THREE.ConeGeometry(cr, h * 0.36, 9).translate(0, h * (0.28 + t * 0.2) + h * 0.18, 0), i % 2 ? '#2f8a5a' : '#3a9a62');
    });
    return [part([trunk], 'Bark', a), part(cones, 'Leaves', a)];
  }
  if (kind === 'tree') {
    const c0 = a?.canopy?.[0] ?? h * 0.4;
    const trunk = paint(new THREE.CylinderGeometry(0.2, 0.36, c0 + 0.6, 8).translate(0, (c0 + 0.6) / 2, 0), '#7a5034');
    const blobs: THREE.BufferGeometry[] = [];
    const k = (h - c0) / 2;
    for (const [x, y, z, s] of [[0, 0.5, 0, 1], [0.55, 0.3, 0.2, 0.7], [-0.5, 0.35, -0.25, 0.75], [0.1, 0.85, -0.1, 0.65], [-0.2, 0.25, 0.55, 0.6]]) {
      blobs.push(paint(new THREE.IcosahedronGeometry(r * 0.62 * s, 2).translate(x * r, c0 + k * 0.4 + y * k, z * r), '#5fae45'));
    }
    return [part([trunk], 'Bark', a), part(blobs, 'Leaves', a)];
  }
  if (kind === 'bush') {
    const blobs = [[0, 0.45, 0, 1], [0.4, 0.35, 0.1, 0.7], [-0.35, 0.35, -0.15, 0.75]].map(([x, y, z, s]) =>
      paint(new THREE.IcosahedronGeometry(r * 0.55 * s, 2).translate(x * r, y * h, z * r), '#62b04a'),
    );
    return [part(blobs, 'Leaves', a)];
  }
  if (kind === 'stump') {
    return [part([paint(new THREE.CylinderGeometry(r * 0.75, r, h, 9).translate(0, h / 2, 0), '#7a5034')], 'Bark', a)];
  }
  if (kind === 'log') {
    const len = a?.capsule ? Math.hypot(a.capsule[1][0] - a.capsule[0][0], a.capsule[1][2] - a.capsule[0][2]) : 1.8;
    const lr = a?.capsule?.[2] ?? 0.2;
    return [part([paint(new THREE.CylinderGeometry(lr, lr * 1.1, len, 9).rotateZ(Math.PI / 2).translate(0, lr, 0), '#7a5034')], 'Bark', a)];
  }
  if (kind === 'grass' || kind === 'flowers') {
    const blades: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const lean = 0.35;
      blades.push(
        paint(
          new THREE.ConeGeometry(0.025, h, 3).translate(0, h / 2, 0).rotateX(Math.sin(ang) * lean).rotateZ(Math.cos(ang) * lean).translate(Math.cos(ang) * 0.06, 0, Math.sin(ang) * 0.06),
          i % 2 ? '#6fbf4a' : '#86cf55',
        ),
      );
    }
    const parts = [part(blades, 'Grass', a)];
    if (kind === 'flowers') {
      const hue = ['#f2d14a', '#f4f0ea', '#c58ae8'][Number(name.slice(-1)) % 3] ?? '#f2d14a';
      const heads = [0, 1, 2].map((i) => paint(new THREE.IcosahedronGeometry(0.045, 0).translate(Math.cos(i * 2.1) * 0.08, h * (0.9 + i * 0.05), Math.sin(i * 2.1) * 0.08), hue));
      parts.push(part(heads, 'Flower', a));
    }
    return parts;
  }
  // rocks
  const rock = paint(new THREE.DodecahedronGeometry(r * 0.85, 0).scale(1, h / (r * 1.4), 1).translate(0, h * 0.42, 0), '#9a96a0');
  return [part([rock], 'Rock', a)];
}
