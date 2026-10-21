import * as THREE from 'three';
import { GRADE_GLSL, SHARED, WIND_GLSL, WIND_PARS_GLSL } from './look';

export interface ToonOptions {
  /** Rim light on the silhouette (0 = none; characters ~1, nature ~0.4). */
  rim?: number;
  /** Wind sway: top displacement (m) and the asset's height (m). */
  wind?: { sway: number; height: number } | null;
  /** 0..1: how much the shadow band turns warm (skin: light scattered under it, not a gray shade). */
  warm?: number;
}

/**
 * The toon light, replacing three's light accumulation: one sun (the scene's directional light,
 * with its shadow map) in three flat bands, light warm and shadow cool, with anti-aliased band
 * edges, a stepped shadow, a little sky bounce on faces turned up and a rim on the silhouette.
 */
const TOON_LIGHT = /* glsl */ `
  vec3 toonColor;
  {
    float ndl = -1.0;
    float sunShadow = 1.0;
    #if NUM_DIR_LIGHTS > 0
      ndl = dot(normal, directionalLights[0].direction);
      #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
        DirectionalLightShadow toonSh = directionalLightShadows[0];
        sunShadow = receiveShadow ? getShadow(directionalShadowMap[0], toonSh.shadowMapSize, toonSh.shadowIntensity,
          toonSh.shadowBias, toonSh.shadowRadius, vDirectionalShadowCoord[0]) : 1.0;
      #endif
    #endif
    float aa = fwidth(ndl) + 0.004;
    float shade = smoothstep(0.38, 0.62, sunShadow);
    float b1 = smoothstep(uBands.x - aa, uBands.x + aa, ndl) * shade;
    float b2 = smoothstep(uBands.y - aa, uBands.y + aa, ndl) * shade;
    vec3 worldN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    vec3 tint = mix(uShadow, uShadowWarm, uWarm) * (0.86 + 0.2 * worldN.y);
    tint = mix(tint, uMid, b1);
    tint = mix(tint, uLight, b2);
    toonColor = diffuseColor.rgb * tint;
    // rim: a bright stepped edge on the silhouette, strongest on the lit side and on top
    vec3 toonV = normalize(vViewPosition);
    float fres = 1.0 - clamp(dot(normal, toonV), 0.0, 1.0);
    float rimAa = fwidth(fres) + 0.01;
    float rim = smoothstep(0.66 - rimAa, 0.66 + rimAa, fres) * clamp(worldN.y * 1.2 + 0.55, 0.0, 1.0) * (0.35 + 0.65 * b1);
    toonColor += (uRimColor * 0.45 + diffuseColor.rgb * 0.55) * rim * uRimStrength * 0.6;
  }
`;

const FRAG_PARS = /* glsl */ `
uniform vec3 uLight;
uniform vec3 uMid;
uniform vec3 uShadow;
uniform vec3 uShadowWarm;
uniform float uWarm;
uniform vec2 uBands;
uniform vec3 uRimColor;
uniform float uRimStrength;
${GRADE_GLSL}
`;

/** Patches a MeshToonMaterial-based program with the toon light, the grade and (optionally) wind. */
function patch(mat: THREE.MeshToonMaterial, rim: { value: number }, wind: { value: THREE.Vector2 }, warm: { value: number }): void {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, SHARED, { uRimStrength: rim, uWind: wind, uWarm: warm });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_PARS_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n#ifdef USE_WIND\n${WIND_GLSL}\n#endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <lights_toon_fragment>', TOON_LIGHT)
      .replace('#include <lights_fragment_begin>', '')
      .replace('#include <lights_fragment_maps>', '')
      .replace('#include <lights_fragment_end>', '')
      .replace(
        'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
        'vec3 outgoingLight = nirykGrade(toonColor) + totalEmissiveRadiance;',
      );
  };
  mat.customProgramCacheKey = () => 'niryk-toon-2';
}

/** A toon material (any MeshToonMaterial parameters: color, map, vertexColors, side...). */
export function toonMaterial(params: THREE.MeshToonMaterialParameters = {}, opts: ToonOptions = {}): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial(params);
  const rim = { value: opts.rim ?? 0 };
  const wind = { value: new THREE.Vector2(opts.wind?.sway ?? 0, opts.wind?.height ?? 1) };
  // three reads material.defines at compile time; the type only declares it on ShaderMaterial
  const withDefines = mat as THREE.MeshToonMaterial & { defines?: Record<string, string> };
  if (opts.wind) withDefines.defines = { ...withDefines.defines, USE_WIND: '' };
  const warm = { value: opts.warm ?? 0 };
  mat.userData.rim = rim;
  mat.userData.wind = wind;
  mat.userData.warm = warm;
  patch(mat, rim, wind, warm);
  return mat;
}

/** Converts a material loaded from glTF into a toon material keeping its color, maps and vertex colors. */
export function toonFromGltf(src: THREE.Material, opts: ToonOptions = {}): THREE.MeshToonMaterial {
  const s = src as THREE.MeshStandardMaterial;
  return toonMaterial(
    {
      name: s.name,
      color: s.color?.clone() ?? new THREE.Color(1, 1, 1),
      map: s.map ?? null,
      vertexColors: s.vertexColors,
      transparent: s.transparent,
      opacity: s.opacity,
      alphaTest: s.alphaTest,
      side: s.side,
      emissive: s.emissive?.clone() ?? new THREE.Color(0, 0, 0),
      emissiveMap: s.emissiveMap ?? null,
      emissiveIntensity: s.emissiveIntensity ?? 1,
    },
    opts,
  );
}

/** The wind settings of a toon material (from toonMaterial), if any. */
export function windOf(mat: THREE.Material): { value: THREE.Vector2 } | undefined {
  return mat.userData.wind as { value: THREE.Vector2 } | undefined;
}
