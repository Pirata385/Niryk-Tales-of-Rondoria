import * as THREE from 'three';
import { LOOK, SHARED } from './look';

/**
 * The WebGL renderer: native MSAA, sRGB output, no tone mapping (the toon bands decide the
 * colors), shadow maps, and the shared screen-size uniforms the ink outlines are measured in.
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  /** Phones draw at a lower pixel ratio (fill rate), desktops up to 2. */
  readonly maxPixelRatio: number;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly touch: boolean,
    maxPixelRatio?: number,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(LOOK.fog);
    this.maxPixelRatio = maxPixelRatio ?? (touch ? 1.75 : 2);
  }

  resize(width: number, height: number, dpr: number): void {
    const ratio = Math.min(dpr, this.maxPixelRatio);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    SHARED.uResolution.value.copy(size);
    SHARED.uPixelRatio.value = size.y / height;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.render(scene, camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
