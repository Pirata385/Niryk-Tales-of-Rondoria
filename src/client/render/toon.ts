import * as THREE from 'three';

let gradient: THREE.DataTexture | null = null;

/**
 * Three-band light ramp (shadow / mid / light) for MeshToonMaterial.
 * Coordinate is dot(N,L)*0.5+0.5: < 0.5 faces away from the sun, then a narrow mid band.
 */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const bands = [0, 0, 0, 0.5, 0.5, 1, 1, 1];
  const data = new Uint8Array(bands.map((b) => Math.round(b * 255)));
  gradient = new THREE.DataTexture(data, bands.length, 1, THREE.RedFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

export interface ToonOptions {
  /** Stepped fresnel rim (0 disables). Characters use ~0.35. */
  rim?: number;
  rimColor?: THREE.ColorRepresentation;
}

/** Creates a toon material with the project ramp, optional rim light. */
export function toonMaterial(params: THREE.MeshToonMaterialParameters = {}, opts: ToonOptions = {}): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...params });
  if (opts.rim) addRim(mat, opts.rim, opts.rimColor ?? '#bcd2ff');
  return mat;
}

/** Converts a material loaded from glTF into a toon material keeping color, map and vertex colors. */
export function toonFromGltf(src: THREE.Material, opts: ToonOptions = {}): THREE.MeshToonMaterial {
  const s = src as THREE.MeshStandardMaterial;
  const mat = toonMaterial(
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
  if (mat.map) {
    mat.map.magFilter = THREE.NearestFilter;
    mat.map.minFilter = THREE.NearestFilter;
  }
  return mat;
}

function addRim(mat: THREE.MeshToonMaterial, strength: number, color: THREE.ColorRepresentation): void {
  const rimColor = new THREE.Color(color);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.rimStrength = { value: strength };
    shader.uniforms.rimColor = { value: rimColor };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float rimStrength;\nuniform vec3 rimColor;')
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 rimN = normalize(normal); // flipped on back faces (double-sided feathers), unlike vNormal
          float rimF = 1.0 - saturate(dot(rimN, vec3(0.0, 0.0, 1.0)));
          // stepped rim on the upper silhouette only (faces turned down, like a tunic hem, stay
          // clean); not purely multiplied by the albedo so it still reads on dark materials
          float rimUp = smoothstep(-0.25, 0.25, rimN.y);
          outgoingLight += (rimColor * 0.18 + diffuseColor.rgb * 0.2) * step(0.75, rimF) * rimUp * rimStrength * 2.5;
        }
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => `rim-${strength}`;
}
