import * as THREE from 'three';
import { FADE_FRAGMENT_PARS, FADE_VERTEX, FADE_VERTEX_PARS, type FadeUniforms } from './fade';
import { SHARED, WIND_GLSL, WIND_PARS_GLSL } from './look';

/**
 * Ink outlines by inverted hulls: a copy of the mesh drawn back faces only, pushed out along its
 * smoothed normals by a width measured in screen pixels (wide up close, thin far away). Skinned
 * hulls bind to the same skeleton, instanced hulls share the instance matrices, wind sways them
 * like their mesh.
 */

const smoothCache = new WeakMap<THREE.BufferGeometry, THREE.BufferAttribute>();

/**
 * Adds a `smoothNormal` attribute: the normals averaged over every vertex at the same position,
 * so hard edges and UV seams (split vertices) don't crack the hull open. Cached per geometry.
 */
export function ensureSmoothNormals(geometry: THREE.BufferGeometry): void {
  if (geometry.getAttribute('smoothNormal')) return;
  const cached = smoothCache.get(geometry);
  if (cached) {
    geometry.setAttribute('smoothNormal', cached);
    return;
  }
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  const n = pos.count;
  // position -> accumulated normal (keys quantized to 0.1 mm of the stored units)
  const sums = new Map<string, number[]>();
  const keys: string[] = new Array(n);
  let scale = 1e4;
  if (pos.normalized || !(pos.array instanceof Float32Array)) scale = 1e5; // quantized meshes: units are a fraction of the mesh
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * scale)},${Math.round(pos.getY(i) * scale)},${Math.round(pos.getZ(i) * scale)}`;
    keys[i] = k;
    let s = sums.get(k);
    if (!s) sums.set(k, (s = [0, 0, 0]));
    s[0] += nor.getX(i);
    s[1] += nor.getY(i);
    s[2] += nor.getZ(i);
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const s = sums.get(keys[i])!;
    const l = Math.hypot(s[0], s[1], s[2]) || 1;
    out[i * 3] = s[0] / l;
    out[i * 3 + 1] = s[1] / l;
    out[i * 3 + 2] = s[2] / l;
  }
  const attr = new THREE.BufferAttribute(out, 3);
  smoothCache.set(geometry, attr);
  geometry.setAttribute('smoothNormal', attr);
}

const VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
#include <fog_pars_vertex>
${WIND_PARS_GLSL}
attribute vec3 smoothNormal;
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform float uInkWidth;
uniform vec3 uInkRange; // near (m), far (m), width scale far away
uniform float uWidth;   // this hull's multiplier
#ifdef USE_FADE
${FADE_VERTEX_PARS}
varying float vDepth;
#endif

void main() {
  vec3 objectNormal = smoothNormal;
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #ifdef USE_WIND
  ${WIND_GLSL}
  #endif
  #include <skinning_vertex>
  #include <project_vertex>
  #ifdef FLIP_SIDED
    transformedNormal = -transformedNormal; // the hull is BackSide: undo three's flip
  #endif
  vec4 clipN = projectionMatrix * vec4(normalize(transformedNormal), 0.0);
  vec2 dirPx = clipN.xy * uResolution;
  float len = length(dirPx);
  dirPx = len > 1e-6 ? dirPx / len : vec2(0.0);
  float depth = -mvPosition.z;
  float px = uInkWidth * uPixelRatio * uWidth * mix(1.0, uInkRange.z, smoothstep(uInkRange.x, uInkRange.y, depth));
  gl_Position.xy += dirPx * px * 2.0 / uResolution * gl_Position.w;
  #ifdef USE_FADE
  ${FADE_VERTEX}
  vDepth = depth;
  #endif
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uInk;
#ifdef USE_FADE
${FADE_FRAGMENT_PARS}
varying float vDepth;
#endif
void main() {
  #ifdef USE_FADE
  nirykFade(vDepth);
  #endif
  gl_FragColor = vec4(uInk, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const materials = new Map<string, THREE.ShaderMaterial>();
/** A character's hull materials, per width (all its hulls share its fade uniforms). */
const fadeMaterials = new WeakMap<FadeUniforms, Map<number, THREE.ShaderMaterial>>();

/**
 * The hull material for a width multiplier (and wind settings, shared by reference with the
 * mesh's own material so both sway alike; and a character's fade, see render/fade.ts). Cached:
 * hulls with the same settings share it.
 */
export function outlineMaterial(width = 1, wind?: { value: THREE.Vector2 }, fade?: FadeUniforms): THREE.ShaderMaterial {
  const key = wind || fade ? '' : `w${width}`;
  const cached = key ? materials.get(key) : fade && !wind ? fadeMaterials.get(fade)?.get(width) : undefined;
  if (cached) return cached;
  const mat = new THREE.ShaderMaterial({
    name: 'Outline',
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.BackSide,
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...SHARED,
      uWidth: { value: width },
      uWind: wind ?? { value: new THREE.Vector2(0, 1) },
      ...fade,
    },
    defines: { ...(wind ? { USE_WIND: '' } : {}), ...(fade ? { USE_FADE: '' } : {}) },
  });
  if (key) materials.set(key, mat);
  else mat.userData.owned = true; // not shared across characters: whoever drops the hull disposes it
  if (fade && !wind) {
    const perWidth = fadeMaterials.get(fade) ?? new Map<number, THREE.ShaderMaterial>();
    perWidth.set(width, mat);
    fadeMaterials.set(fade, perWidth);
  }
  return mat;
}

export interface OutlineOptions {
  width?: number;
  /** Wind of the mesh's toon material (the hull sways with it). */
  wind?: { value: THREE.Vector2 };
  /** The character's fade (the hull fades with its mesh). */
  fade?: FadeUniforms;
}

/**
 * Adds an ink hull to a mesh, as its child (so it follows its transform and visibility). Skinned
 * meshes get a skinned hull on the same skeleton; instanced meshes a hull that shares the
 * instance matrices (keep `hull.count` in sync, or lower it to outline only the nearest ones).
 */
export function addOutline<T extends THREE.Mesh>(mesh: T, opts: OutlineOptions = {}): THREE.Mesh {
  ensureSmoothNormals(mesh.geometry);
  const mat = outlineMaterial(opts.width ?? 1, opts.wind, opts.fade);
  let hull: THREE.Mesh;
  const skinned = mesh as unknown as THREE.SkinnedMesh;
  const instanced = mesh as unknown as THREE.InstancedMesh;
  if (skinned.isSkinnedMesh) {
    const h = new THREE.SkinnedMesh(mesh.geometry, mat);
    h.bind(skinned.skeleton, skinned.bindMatrix);
    hull = h;
  } else if (instanced.isInstancedMesh) {
    const h = new THREE.InstancedMesh(mesh.geometry, mat, instanced.instanceMatrix.count);
    h.instanceMatrix = instanced.instanceMatrix;
    h.count = instanced.count;
    hull = h;
  } else {
    hull = new THREE.Mesh(mesh.geometry, mat);
  }
  hull.name = `${mesh.name}_ink`;
  hull.castShadow = false;
  hull.receiveShadow = false;
  hull.frustumCulled = mesh.frustumCulled;
  hull.userData.isOutline = true;
  hull.renderOrder = mesh.renderOrder;
  mesh.add(hull);
  mesh.userData.outline = hull;
  return hull;
}
