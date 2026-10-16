import * as THREE from 'three';
import type { Pond } from '@shared/world/worldgen';

const VS = /* glsl */ `
attribute float shore;
varying float vShore;
varying vec2 vWorld;
void main() {
  vShore = shore;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// Flat painted water: shallow rim, deeper center, two drifting noise layers whose crossings draw
// thin light ripples. Colors are linear (the pixel pipeline converts to sRGB at the end).
const FS = /* glsl */ `
uniform sampler2D tNoise;
uniform float uTime;
uniform vec3 cShallow;
uniform vec3 cDeep;
uniform vec3 cRim;
uniform vec3 cGlint;
varying float vShore;
varying vec2 vWorld;
void main() {
  if (vShore > 0.0) discard; // the shore line comes from the smooth distance, not the terrain mesh
  float depth = clamp(-vShore / 3.0, 0.0, 1.0);
  vec3 c = mix(cShallow, cDeep, floor(depth * 3.0) / 3.0); // stepped, like the toon bands
  if (vShore > -0.25) c = cRim;
  float a = texture2D(tNoise, vWorld * 0.045 + vec2(uTime * 0.006, uTime * 0.004)).r;
  float b = texture2D(tNoise, vWorld * 0.06 - vec2(uTime * 0.005, -uTime * 0.007)).r;
  float dash = texture2D(tNoise, vWorld * vec2(0.35, 0.9) + vec2(uTime * 0.02, 0.0)).r;
  if (abs(a - b) < 0.012 && dash > 0.55 && vShore < -0.6) c = cGlint; // short drifting glints
  gl_FragColor = vec4(c, 1.0);
}`;

/** The pond surfaces of the world (one small mesh each, beauty pass only). */
export class Water {
  readonly group = new THREE.Group();
  private readonly time = { value: 0 };

  constructor(ponds: Pond[], pondDist: (x: number, z: number) => number, noise: THREE.Texture) {
    noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VS,
      fragmentShader: FS,
      uniforms: {
        tNoise: { value: noise },
        uTime: this.time,
        cShallow: { value: new THREE.Color('#4f8fc4') },
        cDeep: { value: new THREE.Color('#2c5a96') },
        cRim: { value: new THREE.Color('#8cc6e2') },
        cGlint: { value: new THREE.Color('#d8eeff') },
      },
    });
    for (const p of ponds) {
      const size = p.r * 3.2;
      const seg = Math.ceil(size / 0.35);
      const geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const shore = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) shore[i] = pondDist(p.x + pos.getX(i), p.z + pos.getZ(i));
      geo.setAttribute('shore', new THREE.BufferAttribute(shore, 1));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(p.x, p.level, p.z); // the bowl's floor is below `level`, the bank above
      mesh.name = 'Pond';
      this.group.add(mesh);
    }
  }

  update(dt: number): void {
    this.time.value += dt;
  }
}
