import * as THREE from 'three';
import type { Pond, WorldData } from '@shared/world/worldgen';
import { GRADE_GLSL, SHARED } from '../render/look';

const VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute float depth;
varying float vDepth;
varying vec3 vWorld;
void main() {
  vDepth = depth;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

/**
 * Toon water: flat bands from a pale shallow rim to a deep teal, drifting highlight streaks in two
 * directions, a foam line where it meets the bank and the sky's warm glow on the far side.
 */
const FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${GRADE_GLSL}
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uInk;
varying float vDepth;
varying vec3 vWorld;
void main() {
  float d = vDepth;
  // the shore is where the depth crosses zero (interpolated), not the grid's edge
  if (d < -0.004) discard;
  float aa = fwidth(d) + 0.002;
  vec3 col = mix(uShallow, uDeep, smoothstep(0.18 - aa, 0.18 + aa, d));
  col = mix(col, uDeep * 0.82, smoothstep(0.45 - aa, 0.45 + aa, d));
  // drifting highlight streaks
  vec2 p = vWorld.xz;
  float s1 = sin(p.x * 1.7 + p.y * 0.6 + uTime * 0.9) * sin(p.y * 2.3 - uTime * 0.6);
  float s2 = sin(p.x * 0.9 - p.y * 1.9 - uTime * 0.7);
  float hi = smoothstep(0.86, 0.9, s1 * 0.6 + s2 * 0.5);
  col = mix(col, uFoam, hi * 0.55 * smoothstep(0.08, 0.2, d));
  // foam at the bank, then a thin ink line on the shore
  float foam = 1.0 - smoothstep(0.035 - aa, 0.035 + aa, d + 0.012 * sin(p.x * 5.0 + p.y * 3.0 + uTime * 1.5));
  col = mix(col, uFoam, foam);
  col = mix(col, uInk, 1.0 - smoothstep(0.004, 0.012 + aa, d));
  gl_FragColor = vec4(nirykGrade(col), 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** The ponds' water surfaces. */
export class Water {
  readonly group = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;

  constructor(world: WorldData) {
    this.group.name = 'Water';
    this.material = new THREE.ShaderMaterial({
      name: 'Water',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      fog: true,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: SHARED.uTime,
        uGrade: SHARED.uGrade,
        uInk: SHARED.uInk,
        uDeep: { value: new THREE.Color('#2f7f9a') },
        uShallow: { value: new THREE.Color('#7cc6c0') },
        uFoam: { value: new THREE.Color('#f2f6ee') },
      },
    });
    for (const p of world.ponds) this.group.add(this.surface(world, p));
  }

  /** A grid over the pond with the water depth per vertex (foam and bands follow the real bank). */
  private surface(world: WorldData, p: Pond): THREE.Mesh {
    const half = p.r * 1.6 + 1;
    const step = 0.35;
    const n = Math.ceil((half * 2) / step) + 1;
    const pos: number[] = [];
    const depth: number[] = [];
    const index: number[] = [];
    const id = new Int32Array(n * n).fill(-1);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = p.x - half + i * step;
        const z = p.z - half + j * step;
        if (world.pondDist(x, z) > 1.2) continue;
        id[j * n + i] = pos.length / 3;
        pos.push(x, p.level, z);
        depth.push(Math.max(-0.2, p.level - world.height(x, z)));
      }
    }
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = id[j * n + i];
        const b = id[j * n + i + 1];
        const c = id[(j + 1) * n + i];
        const d = id[(j + 1) * n + i + 1];
        if (a < 0 || b < 0 || c < 0 || d < 0) continue;
        index.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('depth', new THREE.Float32BufferAttribute(depth, 1));
    geo.setIndex(index);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.name = 'Pond';
    mesh.receiveShadow = false;
    return mesh;
  }

  dispose(): void {
    for (const c of this.group.children) (c as THREE.Mesh).geometry.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
