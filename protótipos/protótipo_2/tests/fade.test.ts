import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addFadeMask } from '../src/client/render/fade';

/** A tiny rig: Hips > Chest > (Head > HairBone), (LeftWing1), Hips > Tail1. */
function rig() {
  const bone = (name: string, parent?: THREE.Bone) => {
    const b = new THREE.Bone();
    b.name = name;
    parent?.add(b);
    return b;
  };
  const hips = bone('Hips');
  const chest = bone('Chest', hips);
  const head = bone('Head', chest);
  const hairBone = bone('HairBone', head);
  const wing = bone('LeftWing1', chest);
  const tail = bone('Tail1', hips);
  return { bones: [hips, chest, head, hairBone, wing, tail], head };
}

/** One vertex per row of (bone indices, weights). */
function skinned(name: string, rows: [number[], number[]][]) {
  const { bones, head } = rig();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(rows.length * 3), 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(rows.flatMap(([i]) => [...i, 0, 0, 0, 0].slice(0, 4)), 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(rows.flatMap(([, w]) => [...w, 0, 0, 0, 0].slice(0, 4)), 4));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  mesh.name = name;
  const root = new THREE.Group();
  root.add(bones[0], mesh);
  mesh.bind(new THREE.Skeleton(bones));
  return { mesh, root, head };
}

const mask = (mesh: THREE.Mesh) => Array.from(mesh.geometry.getAttribute('fadeMask').array as Float32Array).map((v) => Math.round(v * 100) / 100);

describe('fade mask', () => {
  it('reads wing and tail weights (x) and the head and its children (y) from the skin', () => {
    const { mesh, root, head } = skinned('Body', [
      [[1], [1]], // chest
      [[4, 1], [0.75, 0.25]], // mostly wing
      [[5], [1]], // tail
      [[2], [1]], // head
      [[3, 1], [0.6, 0.4]], // a bone under the head
    ]);
    addFadeMask(mesh, root, head);
    expect(mask(mesh)).toEqual([0, 0, 0.75, 0, 1, 0, 0, 1, 0, 0.6]);
  });

  it('fades whole meshes named for hair, wings, tail or plumes, but not a "Detail"', () => {
    const hair = skinned('Hair_crista', [[[2], [1]]]);
    addFadeMask(hair.mesh, hair.root, hair.head);
    expect(mask(hair.mesh)).toEqual([1, 1]);
    const plumes = skinned('Head_Plumes', [[[2], [1]]]);
    addFadeMask(plumes.mesh, plumes.root, plumes.head);
    expect(mask(plumes.mesh)).toEqual([1, 1]);
    const detail = skinned('Outfit_Detail', [[[1], [1]]]);
    addFadeMask(detail.mesh, detail.root, detail.head);
    expect(mask(detail.mesh)).toEqual([0, 0]);
  });

  it('marks plain meshes by name and by hanging under the head (stand-in bodies)', () => {
    const root = new THREE.Group();
    const head = new THREE.Object3D();
    head.name = 'Head';
    root.add(head);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    wing.name = 'Wing_vane';
    root.add(wing);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 4, 3), new THREE.MeshBasicMaterial());
    eye.name = 'Head_eye_l';
    head.add(eye);
    addFadeMask(wing, root, head);
    addFadeMask(eye, root, head);
    const w = mask(wing);
    const e = mask(eye);
    expect(w.filter((_, i) => i % 2 === 0).every((v) => v === 1) && w.filter((_, i) => i % 2 === 1).every((v) => v === 0)).toBe(true);
    expect(e.filter((_, i) => i % 2 === 0).every((v) => v === 0) && e.filter((_, i) => i % 2 === 1).every((v) => v === 1)).toBe(true);
  });
});
