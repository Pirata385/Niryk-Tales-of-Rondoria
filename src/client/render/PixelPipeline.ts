import * as THREE from 'three';
import { IsoCamera } from './IsoCamera';

/** Three.js layers used by the pipeline. */
export const LAYER_OUTLINE = 1; // 3D objects that get ink lines (characters, creatures, buildings)
export const LAYER_XRAY = 2; // silhouette when hidden behind scenery: the local player (lilac)
export const LAYER_XRAY_HOSTILE = 3; // same for hostile creatures (red)
/**
 * Markers drawn after the composite, straight into the low-res image: exact sRGB colors (no
 * grade, vignette, ink or x-ray on them) and no depth buffer, so they sit above canopies and
 * houses. Objects must be on this layer ONLY (`layers.set(LAYER_OVERLAY)`), use materials with
 * depthTest/depthWrite off and output sRGB. Their shaders may read `xrayDepth` (creatures).
 */
export const LAYER_OVERLAY = 4;

/**
 * Internal pixels along the SHORT side of the screen. The integer upscale factor is chosen from
 * it, so the amount of world on screen stays about the same on every device (≈12 m across the
 * short side at 32 px/m): 720p → 2×, 1080p and phones → 3×, 1440p → 4×.
 */
const SHORT_SIDE = 384;

/** Extra texels rendered around the view so the sub-texel shift never reveals an empty border. */
const MARGIN = 2;

const INK = new THREE.Color('#1b1424');
const XRAY_PLAYER = new THREE.Color('#d9c8ff');
const XRAY_HOSTILE = new THREE.Color('#ff7a6a');

/**
 * Low-resolution "pixel" renderer:
 *  1. beauty pass of the whole scene into a small target (nearest, no AA),
 *  2. normal+depth pass of LAYER_OUTLINE objects, 3. flat-color pass of the x-ray layers,
 *  4. composite at low res: ink outlines (silhouettes + creases), x-ray silhouette, color grade,
 *  5. LAYER_OVERLAY markers drawn over the composite (health bars, warning rings),
 *  6. integer nearest upscale to the canvas, shifted by the camera's sub-texel remainder.
 */
export class PixelPipeline {
  readonly renderer: THREE.WebGLRenderer;
  /** Internal resolution (without margin) and integer upscale factor. */
  width = 0;
  height = 0;
  scale = 1;

  private beauty: THREE.WebGLRenderTarget;
  private normals: THREE.WebGLRenderTarget;
  private xray: THREE.WebGLRenderTarget;
  private composite: THREE.WebGLRenderTarget;
  // double-sided like the feather cards: a single-sided override would see through a card's back
  // face to a deeper layer and draw outlines / x-ray silhouettes inside a thick wing
  private normalMaterial = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
  private xrayPlayerMat = new THREE.MeshBasicMaterial({ color: XRAY_PLAYER, side: THREE.DoubleSide });
  private xrayHostileMat = new THREE.MeshBasicMaterial({ color: XRAY_HOSTILE, side: THREE.DoubleSide });
  private compositeMat: THREE.ShaderMaterial;
  private upscaleMat: THREE.ShaderMaterial;
  private quadScene = new THREE.Scene();
  private quad: THREE.Mesh;
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // composite writes sRGB itself
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.autoClear = true;
    this.renderer.info.autoReset = false; // reset once per frame in render() so stats cover all passes

    this.beauty = makeTarget(true);
    this.normals = makeTarget(true);
    this.xray = makeTarget(true);
    this.composite = makeTarget(false);

    this.compositeMat = new THREE.ShaderMaterial({
      uniforms: {
        tBeauty: { value: this.beauty.texture },
        tBeautyDepth: { value: this.beauty.depthTexture },
        tNormal: { value: this.normals.texture },
        tNormalDepth: { value: this.normals.depthTexture },
        tXray: { value: this.xray.texture },
        tXrayDepth: { value: this.xray.depthTexture },
        depthRange: { value: 1 },
        ink: { value: INK.clone() }, // THREE.Color is already linear (color management on)
        shadowFloor: { value: new THREE.Color('#2a2238') }, // darkest a shaded surface may get
        resolution: { value: new THREE.Vector2(1, 1) },
        vignette: { value: 0.22 },
      },
      vertexShader: FULLSCREEN_VS,
      fragmentShader: COMPOSITE_FS,
      depthTest: false,
      depthWrite: false,
    });
    this.upscaleMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.composite.texture },
        lowRes: { value: new THREE.Vector2(1, 1) },
        scale: { value: 1 },
        shift: { value: new THREE.Vector2() },
      },
      vertexShader: FULLSCREEN_VS,
      fragmentShader: UPSCALE_FS,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /**
   * Depth of the x-ray pass (the local player and living hostiles), same size and camera as the
   * low-res image: overlay shaders compare against it to hide what a creature stands on. Holds
   * window-space depth (gl_FragCoord.z); 1.0 where no creature was drawn.
   */
  get xrayDepth(): THREE.DepthTexture {
    return this.xray.depthTexture!;
  }

  /** Call on window resize (css size + devicePixelRatio). */
  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    const ratio = Math.min(dpr, 3);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(cssWidth, cssHeight, false);
    const deviceW = Math.max(1, Math.round(cssWidth * ratio));
    const deviceH = Math.max(1, Math.round(cssHeight * ratio));
    this.scale = Math.max(1, Math.round(Math.min(deviceW, deviceH) / SHORT_SIDE));
    this.width = Math.ceil(deviceW / this.scale);
    this.height = Math.ceil(deviceH / this.scale);
    const w = this.width + MARGIN * 2;
    const h = this.height + MARGIN * 2;
    for (const t of [this.beauty, this.normals, this.xray, this.composite]) t.setSize(w, h);
    this.compositeMat.uniforms.resolution.value.set(w, h);
    this.upscaleMat.uniforms.lowRes.value.set(w, h);
    this.upscaleMat.uniforms.scale.value = this.scale;
  }

  render(scene: THREE.Scene, iso: IsoCamera): void {
    const r = this.renderer;
    const cam = iso.camera;
    r.info.reset();
    iso.setViewport(this.width + MARGIN * 2, this.height + MARGIN * 2);
    iso.update();

    // 1. beauty
    cam.layers.enableAll();
    cam.layers.disable(LAYER_OVERLAY);
    r.setRenderTarget(this.beauty);
    r.render(scene, cam);

    // 2. normals + depth of outlined objects
    const bg = scene.background;
    const fog = scene.fog;
    scene.background = null;
    scene.fog = null;
    r.shadowMap.autoUpdate = false;
    cam.layers.set(LAYER_OUTLINE);
    scene.overrideMaterial = this.normalMaterial;
    r.setClearColor(0x8080ff, 0);
    r.setRenderTarget(this.normals);
    r.render(scene, cam);

    // 3. x-ray silhouettes: player then hostiles, flat colors into one target
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.xray);
    cam.layers.set(LAYER_XRAY);
    scene.overrideMaterial = this.xrayPlayerMat;
    r.render(scene, cam);
    r.autoClear = false;
    cam.layers.set(LAYER_XRAY_HOSTILE);
    scene.overrideMaterial = this.xrayHostileMat;
    r.render(scene, cam);
    r.autoClear = true;
    scene.overrideMaterial = null;
    scene.background = bg;
    scene.fog = fog;
    r.shadowMap.autoUpdate = true;
    cam.layers.enableAll();
    r.setClearColor(0x000000, 1);

    // 4. composite (low res)
    this.compositeMat.uniforms.depthRange.value = cam.far - cam.near;
    this.quad.material = this.compositeMat;
    r.setRenderTarget(this.composite);
    r.render(this.quadScene, this.quadCam);

    // 5. overlay markers on top of the composite (matrices are already up to date: no re-update)
    const autoMatrix = scene.matrixWorldAutoUpdate;
    scene.matrixWorldAutoUpdate = false;
    scene.background = null;
    r.shadowMap.autoUpdate = false;
    r.autoClear = false;
    cam.layers.set(LAYER_OVERLAY);
    r.render(scene, cam);
    cam.layers.enableAll();
    r.autoClear = true;
    r.shadowMap.autoUpdate = true;
    scene.background = bg;
    scene.matrixWorldAutoUpdate = autoMatrix;

    // 6. upscale to canvas
    this.upscaleMat.uniforms.shift.value.set(MARGIN + iso.subTexel.x, MARGIN + iso.subTexel.y);
    this.quad.material = this.upscaleMat;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
  }

  /** Projects a world point to css pixels on the canvas (for DOM overlays like damage numbers). */
  worldToCss(p: THREE.Vector3, iso: IsoCamera, cssW: number, cssH: number, out = new THREE.Vector2()): THREE.Vector2 {
    const v = _ndc.copy(p).project(iso.camera);
    const tw = this.width + MARGIN * 2;
    const th = this.height + MARGIN * 2;
    const tx = ((v.x + 1) / 2) * tw - MARGIN - iso.subTexel.x;
    const ty = ((v.y + 1) / 2) * th - MARGIN - iso.subTexel.y;
    return out.set((tx / this.width) * cssW, (1 - ty / this.height) * cssH);
  }

  /** Converts a canvas css pixel to normalized device coords of the iso camera (for picking). */
  cssToNdc(x: number, y: number, cssW: number, cssH: number, out = new THREE.Vector2()): THREE.Vector2 {
    // The camera covers width+2*MARGIN texels; the canvas shows `width` of them shifted by MARGIN+subTexel.
    const tw = this.width + MARGIN * 2;
    const th = this.height + MARGIN * 2;
    const tx = (x / cssW) * this.width + MARGIN;
    const ty = (1 - y / cssH) * this.height + MARGIN;
    return out.set((tx / tw) * 2 - 1, (ty / th) * 2 - 1);
  }
}

const _ndc = new THREE.Vector3();

function makeTarget(depth: boolean): THREE.WebGLRenderTarget {
  const t = new THREE.WebGLRenderTarget(4, 4, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: depth,
  });
  if (depth) {
    t.depthTexture = new THREE.DepthTexture(4, 4);
    t.depthTexture.type = THREE.UnsignedIntType;
  }
  return t;
}

const FULLSCREEN_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const COMPOSITE_FS = /* glsl */ `
uniform sampler2D tBeauty;
uniform sampler2D tBeautyDepth;
uniform sampler2D tNormal;
uniform sampler2D tNormalDepth;
uniform sampler2D tXray;
uniform sampler2D tXrayDepth;
uniform float depthRange;
uniform vec3 ink;
uniform vec3 shadowFloor;
uniform vec2 resolution;
uniform float vignette;
varying vec2 vUv;

float lin(float d) { return d * depthRange; } // orthographic: depth is linear
float objDepth(ivec2 p) { return texelFetch(tNormalDepth, p, 0).r; }
vec3 objNormal(ivec2 p) { return texelFetch(tNormal, p, 0).xyz * 2.0 - 1.0; }

vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 maxP = ivec2(resolution) - 1;
  vec3 color = texelFetch(tBeauty, p, 0).rgb;
  float dB = texelFetch(tBeautyDepth, p, 0).r;
  float dO = objDepth(p);
  float inked = 0.0;

  // --- ink outlines on visible outlined objects (line drawn on the nearer pixel) ---
  if (dO < 1.0 && abs(lin(dO) - lin(dB)) < 0.08) {
    vec3 n = objNormal(p);
    float sil = 0.0;
    float crease = 0.0;
    ivec2 offs[4] = ivec2[4](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1));
    for (int i = 0; i < 4; i++) {
      ivec2 q = clamp(p + offs[i], ivec2(0), maxP);
      float dq = objDepth(q);
      if (dq >= 1.0 || lin(dq) - lin(dO) > 0.12) {
        sil = 1.0;
      } else if (lin(dq) >= lin(dO) - 0.02) {
        float nd = dot(n, objNormal(q));
        crease = max(crease, smoothstep(0.78, 0.6, nd));
      }
    }
    inked = max(sil, crease * 0.5);
    color = mix(color, ink, inked);
  }

  // --- x-ray silhouettes (player / hostiles) behind scenery ---
  float dX = texelFetch(tXrayDepth, p, 0).r;
  if (dX < 1.0 && lin(dX) > lin(dB) + 0.15) {
    color = mix(color, texelFetch(tXray, p, 0).rgb, 0.55);
  }

  // --- grade: gentle contrast/saturation, cool shadows, vignette ---
  vec3 c = toSRGB(color);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.1);
  c = (c - 0.5) * 1.06 + 0.5;
  c += vec3(-0.01, 0.0, 0.025) * (1.0 - l);
  vec2 uv = gl_FragCoord.xy / resolution - 0.5;
  c *= 1.0 - vignette * smoothstep(0.35, 0.85, length(uv * vec2(1.0, 0.85)));
  // never crush to black: shaded surfaces stop at a dark violet, only ink lines reach the ink color
  c = max(c, inked > 0.45 ? toSRGB(ink) : toSRGB(shadowFloor));
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const UPSCALE_FS = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 lowRes;
uniform float scale;
uniform vec2 shift;
void main() {
  vec2 texel = floor(gl_FragCoord.xy / scale + shift);
  gl_FragColor = texelFetch(tColor, ivec2(clamp(texel, vec2(0.0), lowRes - 1.0)), 0);
}`;
