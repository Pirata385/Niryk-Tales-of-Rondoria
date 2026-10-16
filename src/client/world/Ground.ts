import * as THREE from 'three';
import { toonMaterial } from '../render/toon';

export interface GroundTextures {
  grassA: THREE.Texture;
  grassB: THREE.Texture;
  dirt: THREE.Texture;
  cobble: THREE.Texture;
  noise: THREE.Texture;
}

export interface GroundOptions {
  /** World extent (square, centered on origin), meters. */
  size: number;
  /** Vertex spacing, meters. */
  step: number;
  height: (x: number, z: number) => number;
  /**
   * Splat weights at a point: r = second grass, g = dirt path, b = cobble, a = cool shade (near
   * woods; pulls the grass toward blue-green).
   * Sampled into a texture (2 texels per meter).
   */
  splat: (x: number, z: number) => [number, number, number, number];
}

/** Tile size of the painted ground textures (256 px at 32 px/m). */
const TILE_METERS = 8;

/**
 * Terrain mesh with a painterly splat shader: hard, noise-broken boundaries between painted
 * tileable textures (no blurry blends), big low-frequency color patches, toon-lit with shadows.
 */
export function createGround(tex: GroundTextures, opts: GroundOptions): THREE.Mesh {
  const segs = Math.round(opts.size / opts.step);
  const geo = new THREE.PlaneGeometry(opts.size, opts.size, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, opts.height(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();

  const res = Math.round(opts.size * 2);
  const data = new Uint8Array(res * res * 4);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const x = ((i + 0.5) / res - 0.5) * opts.size;
      const z = ((j + 0.5) / res - 0.5) * opts.size;
      const w = opts.splat(x, z);
      const o = (j * res + i) * 4;
      for (let k = 0; k < 4; k++) data[o + k] = Math.max(0, Math.min(255, Math.round(w[k] * 255)));
    }
  }
  const splat = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  splat.magFilter = THREE.LinearFilter;
  splat.minFilter = THREE.LinearFilter;
  splat.needsUpdate = true;

  for (const t of [tex.grassA, tex.grassB, tex.dirt, tex.cobble]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
  }
  tex.noise.wrapS = tex.noise.wrapT = THREE.RepeatWrapping;
  tex.noise.colorSpace = THREE.NoColorSpace;

  const mat = toonMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      tGrassA: { value: tex.grassA },
      tGrassB: { value: tex.grassB },
      tDirt: { value: tex.dirt },
      tCobble: { value: tex.cobble },
      tNoise: { value: tex.noise },
      tSplat: { value: splat },
      worldSize: { value: opts.size },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vGroundXZ;
        uniform sampler2D tGrassA, tGrassB, tDirt, tCobble, tNoise, tSplat;
        uniform float worldSize;`,
      )
      .replace(
        '#include <map_fragment>',
        `{
          vec2 p = vGroundXZ;
          vec2 tuv = p / ${TILE_METERS.toFixed(1)};
          vec4 sp = texture2D(tSplat, p / worldSize + 0.5);
          float n1 = texture2D(tNoise, p / 23.0).r;
          float n2 = texture2D(tNoise, p / 6.1 + vec2(0.37, 0.71)).g;
          float n3 = texture2D(tNoise, p / 1.7 + vec2(0.11, 0.53)).b;
          vec3 grass = texture2D(tGrassA, tuv).rgb;
          if (sp.r + (n1 - 0.5) * 0.9 > 0.5) grass = texture2D(tGrassB, tuv + 0.5).rgb;
          // big painterly patches with a hue shift: warm clearings, cool shade near the woods
          float big = texture2D(tNoise, p / 37.0 + vec2(0.3, 0.9)).r;
          float cool = sp.a + (n1 - 0.5) * 0.5;
          if (cool > 0.5) grass *= vec3(0.82, 0.92, 1.0);
          else if (big > 0.6) grass *= vec3(1.1, 1.05, 0.84);
          else if (big < 0.36) grass *= vec3(0.93, 0.96, 0.97);
          vec3 col = grass;
          // dirt path: thin dark border on the grass side, grass tufts invading the edge
          float d = sp.g + (n2 - 0.5) * 0.4 + (n3 - 0.5) * 0.12;
          if (d > 0.5) {
            col = texture2D(tDirt, tuv).rgb;
            if (d < 0.6 && n3 > 0.58) col = grass * vec3(0.92, 0.9, 0.85);
          } else if (d > 0.475) {
            col = vec3(0.157, 0.073, 0.034); // #6e4c33 in linear
          }
          // plaza: cobbles inside a ring of bigger curb stones; the border is broken by noise
          float c = sp.b + (n1 - 0.5) * 0.3 + (n3 - 0.5) * 0.06;
          if (c > 0.5) col = texture2D(tCobble, tuv).rgb;
          else if (c > 0.33) col = texture2D(tCobble, tuv * 0.5 + 0.27).rgb * vec3(0.92, 0.9, 0.86);
          else if (c > 0.31) col = vec3(0.07, 0.055, 0.045);
          diffuseColor.rgb *= col;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'ground-splat';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'Ground';
  return mesh;
}
