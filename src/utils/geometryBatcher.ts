import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function isDynamicBranch(obj: THREE.Object3D, stopAt: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = obj;
  while (cur && cur !== stopAt) {
    if (cur.userData?.dynamic === true) return true;
    cur = cur.parent;
  }
  return false;
}

/**
 * Merges static child meshes sharing the same material and shadow flags underneath `root`
 * into a single non-indexed BufferGeometry draw call, slashing GPU draw calls & traversal overhead.
 * Preserves InstancedMeshes, SkinnedMeshes, and any branch flagged with `userData.dynamic = true`.
 */
export function mergeStaticGroupByMaterial(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();

  interface Bucket {
    material: THREE.Material;
    castShadow: boolean;
    receiveShadow: boolean;
    meshes: THREE.Mesh[];
  }

  const buckets = new Map<string, Bucket>();

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (obj instanceof THREE.InstancedMesh) return;
    if ((obj as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
    if (Array.isArray(obj.material)) return;
    if (isDynamicBranch(obj, root)) return;

    const mat = obj.material;
    const key = `${mat.uuid}|${obj.castShadow ? 1 : 0}|${obj.receiveShadow ? 1 : 0}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        material: mat,
        castShadow: obj.castShadow,
        receiveShadow: obj.receiveShadow,
        meshes: []
      };
      buckets.set(key, b);
    }
    b.meshes.push(obj);
  });

  const relMat = new THREE.Matrix4();

  for (const bucket of buckets.values()) {
    if (bucket.meshes.length <= 1) continue;

    const prepared: THREE.BufferGeometry[] = [];
    for (const mesh of bucket.meshes) {
      const src = mesh.geometry;
      const g = src.index ? src.toNonIndexed() : src.clone();
      relMat.copy(rootInv).multiply(mesh.matrixWorld);
      g.applyMatrix4(relMat);
      if (!g.attributes.normal) {
        g.computeVertexNormals();
      }
      prepared.push(g);
    }

    // Ensure every geometry in the bucket has the exact same attribute set
    const commonAttrs = Object.keys(prepared[0].attributes).filter((attrName) =>
      prepared.every((g) => g.attributes[attrName] !== undefined)
    );
    if (commonAttrs.length === 0) {
      for (const g of prepared) g.dispose();
      continue;
    }
    for (const g of prepared) {
      for (const k of Object.keys(g.attributes)) {
        if (!commonAttrs.includes(k)) {
          g.deleteAttribute(k);
        }
      }
      g.morphAttributes = {};
    }

    const merged = mergeGeometries(prepared, false);
    for (const g of prepared) g.dispose();
    if (!merged) continue;

    merged.computeBoundingBox();
    merged.computeBoundingSphere();

    const mergedMesh = new THREE.Mesh(merged, bucket.material);
    mergedMesh.castShadow = bucket.castShadow;
    mergedMesh.receiveShadow = bucket.receiveShadow;
    mergedMesh.name = `Merged_${bucket.material.name || bucket.meshes[0].name || 'Batch'}`;
    root.add(mergedMesh);

    for (const mesh of bucket.meshes) {
      mesh.parent?.remove(mesh);
    }
  }
}
