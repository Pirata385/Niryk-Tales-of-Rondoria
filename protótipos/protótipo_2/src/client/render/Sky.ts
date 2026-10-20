import * as THREE from 'three';
import { LOOK, SHARED } from './look';

const VERTEX = /* glsl */ `
#include <fog_pars_vertex>
varying vec3 vDir;
void main() {
  #ifdef USE_FOG
    vFogDepth = 1.0;
  #endif
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // on the far plane
}
`;

/**
 * Painted sky: a gradient from a warm horizon to a deep blue zenith, a soft sun glow, and flat
 * two-tone clouds (fbm shapes cut by a threshold, a lit edge toward the sun, a lilac belly) that
 * drift slowly. The horizon melts into the scene's fog color exactly as fogged geometry does.
 */
const FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
varying vec3 vDir;
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSunDir;
uniform float uTime;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.3);
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, h));
  col = mix(col, uTop, smoothstep(0.18, 0.75, h));
  float sunDot = max(dot(d, normalize(uSunDir)), 0.0);
  col += uGlow * (pow(sunDot, 10.0) * 0.55 + pow(sunDot, 90.0) * 0.6);
  // sun disc: flat, with a soft rim
  col = mix(col, vec3(1.25, 1.12, 0.92), smoothstep(0.9975, 0.9985, sunDot));

  // clouds on a plane above: flat painted shapes with a lit edge and a cool belly
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.12) * 1.6 + vec2(uTime * 0.006, uTime * 0.002);
    float n = fbm(uv * 0.9);
    float shape = smoothstep(0.54, 0.56, n);
    vec2 toSun = normalize(uSunDir.xz + 1e-4);
    float lit = fbm(uv * 0.9 + toSun * 0.06);
    float edge = smoothstep(0.54, 0.56, lit);
    vec3 belly = mix(uMid, vec3(0.62, 0.6, 0.78), 0.65);
    vec3 cloud = mix(vec3(1.05, 1.0, 0.95), belly, (1.0 - edge) * 0.75 + smoothstep(0.6, 0.75, n) * 0.25);
    float fade = smoothstep(0.02, 0.2, h);
    col = mix(col, cloud, shape * fade * 0.95);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  #ifdef USE_FOG
    // the same color fogged geometry fades to (three passes fogColor in the output space)
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, 1.0 - smoothstep(-0.02, 0.1, h));
  #endif
}
`;

export class Sky {
  readonly mesh: THREE.Mesh;

  constructor() {
    const mat = new THREE.ShaderMaterial({
      name: 'Sky',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      fog: true,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTop: { value: LOOK.skyTop },
        uMid: { value: LOOK.skyMid },
        uHorizon: { value: LOOK.horizon },
        uGlow: { value: LOOK.sunGlow },
        uSunDir: SHARED.uSunDir,
        uTime: SHARED.uTime,
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat);
    this.mesh.name = 'Sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  /** Keeps the dome centered on the camera. */
  update(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
