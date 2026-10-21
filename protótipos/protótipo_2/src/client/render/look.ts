import * as THREE from 'three';

/**
 * The art direction in numbers: one place for the light, the toon bands, the ink and the sky.
 * Colors are sRGB hex (three converts them to linear); tints multiply the albedo.
 */
export const LOOK = {
  /**
   * Toward the sun (world): an afternoon sun from the left and a little behind the spawn view
   * (seed 1 looks toward -X-Z), so the hero's back and the clearing are lit and the shadows fall
   * across the meadow to the right.
   */
  sunDir: new THREE.Vector3(-0.3, 0.62, 0.72).normalize(),
  /** Albedo multipliers of the three toon bands: warm light, a warm-neutral mid, a cool shadow. */
  light: new THREE.Color('#fff1d6').multiplyScalar(1.08),
  mid: new THREE.Color('#d9c6c8'),
  shadow: new THREE.Color('#7c86c4'),
  /** The shadow band on skin (materials with `warm`): a rosy brown instead of the cool blue. */
  shadowWarm: new THREE.Color('#b08690'),
  /** dot(N, L) where the bands change: shadow | mid | light. */
  bands: new THREE.Vector2(0.0, 0.32),
  rim: new THREE.Color('#ffe2b0'),
  ink: new THREE.Color('#1b1424'),
  /** Ink line width in css px up close (characters at ~2.5 m) and its scale far away. */
  inkWidth: 2.4,
  inkFarScale: 0.3,
  inkNear: 3,
  inkFar: 45,
  skyTop: new THREE.Color('#3f74c8'),
  skyMid: new THREE.Color('#86b4e6'),
  horizon: new THREE.Color('#f2d6b0'),
  sunGlow: new THREE.Color('#ffd28a'),
  fog: new THREE.Color('#cfd6d8'),
  fogNear: 38,
  fogFar: 135,
  /** Gentle grade on every toon surface: saturation and contrast around mid gray. */
  saturation: 1.1,
  contrast: 1.06,
};

/**
 * Render layers. The game camera draws layer 0 only; the sun's shadow camera draws both, so the
 * head and hair hidden in first person (moved to FP_HIDDEN) still cast their shadow.
 */
export const LAYERS = { fpHidden: 1 };

/**
 * Uniforms shared by reference by every material of the game (toon, outline, sky, water,
 * grass): changing a value here changes it everywhere at once.
 */
export const SHARED = {
  uTime: { value: 0 },
  /** Drawing buffer size in px (outline widths are in screen pixels). */
  uResolution: { value: new THREE.Vector2(1280, 720) },
  /** css px -> drawing buffer px. */
  uPixelRatio: { value: 1 },
  uLight: { value: LOOK.light },
  uMid: { value: LOOK.mid },
  uShadow: { value: LOOK.shadow },
  uShadowWarm: { value: LOOK.shadowWarm },
  uBands: { value: LOOK.bands },
  uRimColor: { value: LOOK.rim },
  uInk: { value: LOOK.ink },
  uInkWidth: { value: LOOK.inkWidth },
  uInkRange: { value: new THREE.Vector3(LOOK.inkNear, LOOK.inkFar, LOOK.inkFarScale) },
  uGrade: { value: new THREE.Vector2(LOOK.saturation, LOOK.contrast) },
  uSunDir: { value: LOOK.sunDir },
};

/** GLSL: the color grade (linear in, linear out). */
export const GRADE_GLSL = /* glsl */ `
uniform vec2 uGrade;
vec3 nirykGrade(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, uGrade.x), 0.0);
  vec3 g = pow(c, vec3(1.0 / 2.2));
  g = (g - 0.5) * uGrade.y + 0.5;
  return pow(max(g, 0.0), vec3(2.2));
}
`;

/**
 * GLSL: wind for leaves and grass (vertex, model space, before skinning/instancing). Bends the
 * top more than the base; the phase comes from the instance's position so neighbors differ.
 */
export const WIND_PARS_GLSL = /* glsl */ `
uniform float uTime;
uniform vec2 uWind; // x: sway (m at the top), y: height of the asset (m)
`;
export const WIND_GLSL = /* glsl */ `
{
  vec3 windBase = vec3(0.0);
  #ifdef USE_INSTANCING
    windBase = instanceMatrix[3].xyz;
  #endif
  float wh = clamp(transformed.y / max(uWind.y, 0.01), 0.0, 1.5);
  float ph = uTime * 1.6 + dot(windBase.xz, vec2(0.23, 0.17)) + transformed.y * 0.35;
  vec2 sway = vec2(sin(ph) + 0.4 * sin(ph * 2.3 + 1.3), 0.6 * cos(ph * 0.9 + 0.4));
  transformed.xz += sway * uWind.x * wh * wh;
}
`;
