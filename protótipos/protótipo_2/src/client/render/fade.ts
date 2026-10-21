import * as THREE from 'three';

/**
 * Screen-door (dithered) fading of a character's parts, for the local player's view: a stipple of
 * discarded pixels instead of alpha blending, so nothing is sorted and the ink hulls fade with
 * their meshes (both run the same test). Per vertex, the `fadeMask` attribute says what may fade:
 *   x  the parts that get between the shoulder camera and the crosshair: wings, tail, hair
 *      (1 = all of it; on skinned meshes the weight of the wing and tail bones),
 *   y  what hangs on the head (the weight of Head and its child bones): dropped in first person.
 * The uniforms are one set per character, shared by all its materials and hulls.
 */
export interface FadeUniforms {
  /** 0..1: how much the masked parts clear around the screen center (the crosshair). */
  uFadeCenter: { value: number };
  /** Inner and outer radius of that clearing, as fractions of the screen height. */
  uFadeArea: { value: THREE.Vector2 };
  /**
   * Near-camera fade, view depth in m: everything from x (gone) to y (solid); the masked parts
   * from z to w. 0, 0 turns a pair off.
   */
  uFadeNear: { value: THREE.Vector4 };
  /** 1: fragments of vertices hung on the head are dropped (first person). */
  uHideHead: { value: number };
}

export function fadeUniforms(): FadeUniforms {
  return {
    uFadeCenter: { value: 0 },
    uFadeArea: { value: new THREE.Vector2(0.07, 0.2) },
    uFadeNear: { value: new THREE.Vector4(0, 0, 0, 0) },
    uHideHead: { value: 0 },
  };
}

export const FADE_VERTEX_PARS = /* glsl */ `
attribute vec2 fadeMask;
varying vec2 vFadeMask;
`;

export const FADE_VERTEX = /* glsl */ `
vFadeMask = fadeMask;
`;

/** Reads uResolution (SHARED: the program's uniforms must include it). */
export const FADE_FRAGMENT_PARS = /* glsl */ `
uniform vec2 uResolution;
varying vec2 vFadeMask;
uniform float uFadeCenter;
uniform vec2 uFadeArea;
uniform vec4 uFadeNear;
uniform float uHideHead;
float nirykBayer2(vec2 a) {
  a = floor(a);
  return fract(dot(a, vec2(0.5, a.y * 0.75)));
}
float nirykBayer8(vec2 a) {
  return nirykBayer2(0.25 * a) * 0.0625 + nirykBayer2(0.5 * a) * 0.25 + nirykBayer2(a);
}
float nirykNear(vec2 range, float depth) {
  return range.y > 0.0 ? 1.0 - smoothstep(range.x, range.y, depth) : 0.0;
}
/** Discards this fragment if the fade covers it (depth: view-space distance, m). */
void nirykFade(float depth) {
  if (uHideHead > 0.5 && vFadeMask.y > 0.5) discard;
  float h = uResolution.y;
  float r = length(gl_FragCoord.xy - 0.5 * uResolution) / h;
  float a = uFadeCenter * vFadeMask.x * (1.0 - smoothstep(uFadeArea.x, uFadeArea.y, r));
  a = max(a, nirykNear(uFadeNear.xy, depth));
  a = max(a, nirykNear(uFadeNear.zw, depth) * vFadeMask.x);
  if (a > 0.0 && nirykBayer8(gl_FragCoord.xy) < a) discard;
}
`;

/** Wings, tail, feathers and plumes (not "Detail" or "Tailor"), by node or bone name. */
const FADE_PART = /wing|(?<!de)tail(?!or)|feather|plume/i;

/** True when a node (or one of its ancestors up to `root`) is a part that fades whole. */
function maskedByName(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    if (n.name.startsWith('Hair_') || FADE_PART.test(n.name)) return true;
    if (n === root) break;
  }
  return false;
}

const masks = new WeakMap<THREE.BufferGeometry, THREE.BufferAttribute>();

/**
 * Gives a character mesh its `fadeMask` attribute (see FadeUniforms). Skinned meshes read it from
 * their skin weights (geometries shared by several instances of a GLB compute it once);
 * the placeholder's plain meshes from their names (`head`: the mesh hangs on the head).
 */
export function addFadeMask(mesh: THREE.Mesh, root: THREE.Object3D, head: THREE.Object3D | null): void {
  const geo = mesh.geometry;
  const cached = masks.get(geo);
  if (cached) {
    geo.setAttribute('fadeMask', cached);
    return;
  }
  const n = geo.getAttribute('position').count;
  const out = new Float32Array(n * 2);
  const whole = maskedByName(mesh, root) ? 1 : 0;
  const skinned = mesh as THREE.SkinnedMesh;
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  if (skinned.isSkinnedMesh && si && sw) {
    const bones = skinned.skeleton.bones;
    const headBones = new Set<number>();
    const fadeBones = new Set<number>();
    const headBone = bones.find((b) => b.name === 'Head');
    bones.forEach((b, i) => {
      if (FADE_PART.test(b.name)) fadeBones.add(i);
      for (let p: THREE.Object3D | null = b; p; p = p.parent) {
        if (p === headBone) {
          headBones.add(i);
          break;
        }
      }
    });
    for (let v = 0; v < n; v++) {
      let fx = 0;
      let hy = 0;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(v, k);
        if (w <= 0) continue;
        const b = si.getComponent(v, k);
        if (fadeBones.has(b)) fx += w;
        if (headBones.has(b)) hy += w;
      }
      out[v * 2] = Math.max(whole, Math.min(1, fx));
      out[v * 2 + 1] = Math.min(1, hy);
    }
  } else {
    let onHead = 0;
    for (let p: THREE.Object3D | null = mesh; p && p !== root; p = p.parent) if (p === head) onHead = 1;
    for (let v = 0; v < n; v++) {
      out[v * 2] = whole;
      out[v * 2 + 1] = onHead;
    }
  }
  const attr = new THREE.BufferAttribute(out, 2);
  masks.set(geo, attr);
  geo.setAttribute('fadeMask', attr);
}
