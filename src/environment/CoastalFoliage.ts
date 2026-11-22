import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addCollider, getTerrainHeight } from '../terrain/terrainMath';
import { CAUSTICS_GLSL } from '../shaders/causticsChunk';
import { mergeStaticGroupByMaterial } from '../utils/geometryBatcher';

function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * Coastal & underwater vegetation:
 *  - Sculpted curved coconut palm trees with ringed bark, coconuts, and wind-swaying fronds
 *  - Instanced swaying beach dune grass / sea oats along upper dunes
 *  - Underwater swaying kelp ribbons & textured reef coral heads with live underwater caustics
 */
export class CoastalFoliage {
  public readonly group = new THREE.Group();
  public readonly palmsGroup = new THREE.Group();
  public readonly reefFloraGroup = new THREE.Group();
  public readonly palmPositions: Array<[number, number]> = [];
  private readonly windUniforms = {
    uTime: { value: 0 },
    uWindStrength: { value: 1.0 }
  };
  private readonly kelpMaterials: CustomShaderMaterial[] = [];

  constructor() {
    this.group.name = 'CoastalFoliage';
    this.palmsGroup.name = 'CoastalPalms';
    this.reefFloraGroup.name = 'UnderwaterReefFlora';
    this.group.add(this.palmsGroup, this.reefFloraGroup);
    const rand = seededRandom(4207);

    this.buildPalmTrees(rand);
    this.buildCoastalPinesAndShrubs(rand);
    this.buildGrassAndSeagrass(rand);
    this.buildUnderwaterReefFlora(rand);
  }

  private buildPalmTrees(rand: () => number): void {
    const loader = new THREE.TextureLoader();
    // Real Poly Haven CC0 palm bark PBR set (downloaded, never procedural)
    const barkDiff = loader.load('./textures/palm_tree_bark_diff_1k.jpg');
    barkDiff.wrapS = barkDiff.wrapT = THREE.RepeatWrapping;
    barkDiff.repeat.set(2, 6);
    barkDiff.anisotropy = 8;
    barkDiff.colorSpace = THREE.SRGBColorSpace;

    const barkNor = loader.load('./textures/palm_tree_bark_nor_gl_1k.jpg');
    barkNor.wrapS = barkNor.wrapT = THREE.RepeatWrapping;
    barkNor.repeat.set(2, 6);
    barkNor.anisotropy = 8;

    const barkRough = loader.load('./textures/palm_tree_bark_rough_1k.jpg');
    barkRough.wrapS = barkRough.wrapT = THREE.RepeatWrapping;
    barkRough.repeat.set(2, 6);
    barkRough.anisotropy = 8;

    const trunkMat = new THREE.MeshStandardMaterial({
      map: barkDiff,
      normalMap: barkNor,
      roughnessMap: barkRough,
      normalScale: new THREE.Vector2(1.0, 1.0),
      color: 0xdccbb8,
      roughness: 1.0,
      metalness: 0.0
    });

    const coconutMat = new THREE.MeshStandardMaterial({
      color: 0x4b321d,
      roughness: 0.78
    });

    const frondTex = this.createFeatheryFrondTexture();
    const frondSwayChunk = /* glsl */ `
      {
        float tip = clamp(uv.y, 0.0, 1.0);
        vec4 instP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          instP = instanceMatrix * instP;
        #endif
        vec4 wp = modelMatrix * instP;
        float gust = sin(uTime * 1.85 + wp.x * 0.28 + wp.z * 0.22) * 0.16 +
                     cos(uTime * 3.2 + wp.x * 0.7) * 0.055;
        transformed.y += gust * tip * tip * uWindStrength * 1.45;
        transformed.x += gust * tip * uWindStrength * 0.75;
      }
    `;

    const frondMat = new THREE.MeshStandardMaterial({
      map: frondTex,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.62,
      metalness: 0.0
    });
    frondMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.windUniforms.uTime;
      shader.uniforms.uWindStrength = this.windUniforms.uWindStrength;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWindStrength;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${frondSwayChunk}`);
    };
    frondMat.customProgramCacheKey = () => 'feathery-palm-frond';

    const frondDepthMat = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: frondTex,
      alphaTest: 0.4
    });
    frondDepthMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.windUniforms.uTime;
      shader.uniforms.uWindStrength = this.windUniforms.uWindStrength;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWindStrength;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${frondSwayChunk}`);
    };
    frondDepthMat.customProgramCacheKey = () => 'feathery-palm-frond-depth';

    // Pre-build a UV-mapped arched V-folded frond strip paired with 150 serrated leaflet cutouts
    const frondGeo = this.createPalmFrondGeometry();

    // Sweeping tropical palm groves framing the expanded 230m bay & dunes (leaving Tiki Bar, Lifeguard & headland rocks clear!)
    const palmSpots: Array<[number, number, number, number]> = [
      [-68, -41, 1.12, 0.4],
      [-51.5, -35.5, 1.16, -0.5],
      [-49.5, -36.5, 1.06, 1.1],
      [-41, -37, 1.18, 0.2],
      [-33, -34, 1.06, 1.6],
      [-28, -38, 1.14, -0.7],
      [-15, -36, 1.08, 0.9],
      [-9, -38, 1.12, 2.1],
      [4, -36, 1.15, -0.4],
      [11, -35, 1.04, 0.6],
      [19, -37, 1.18, -1.1],
      [27, -34, 1.02, 1.5],
      [35, -36, 1.12, 0.2],
      [44, -33, 1.16, -0.8],
      [54, -36, 1.10, 1.9],
      [67, -40, 1.10, -0.9],
      [-52, -45, 1.24, 2.3],
      [-34, -48, 1.20, -0.2],
      [-14, -47, 1.22, 1.3],
      [8, -46, 1.18, -1.4],
      [28, -46, 1.20, 0.7],
      [48, -42, 1.16, -0.5],
      // Upper tropical hillside palm canopy (framing lush sweeping coastal backdrop hills!)
      [-66, -54, 1.28, 0.8],
      [-46, -58, 1.32, -1.1],
      [-26, -56, 1.26, 2.0],
      [-4, -58, 1.30, 0.3],
      [18, -56, 1.28, -0.9],
      [38, -55, 1.24, 1.7],
      [58, -50, 1.22, -0.4],
      // Curated natural palm clusters framing flanks & trails (replacing uniform palm-spam wall so
      // coastal pines, flowering shrubs, cliffside villas, border fences & lighthouse shine!)
      [-76, -48, 1.24, 0.5],
      [-54, -48, 1.20, 0.9],
      [-38, -46, 1.18, -2.0],
      [-12, -48, 1.20, 2.6],
      [14, -48, 1.20, -2.3],
      [36, -46, 1.18, 2.0],
      [56, -44, 1.18, -1.8],
      [72, -46, 1.22, 1.9],
      [-84, -36, 1.20, 0.7],
      [-74, -38, 1.18, 1.5],
      [-44, -44, 1.18, 1.8],
      [-24, -44, 1.16, -2.2],
      [22, -44, 1.18, 0.5],
      [44, -44, 1.18, 1.3],
      [66, -42, 1.18, -1.5],
      [74, -34, 1.16, 0.9],
      [84, -40, 1.20, -1.9]
    ];

    const nearTrunks: THREE.BufferGeometry[] = [];
    const farTrunks: THREE.BufferGeometry[] = [];
    const coconutMatrices: THREE.Matrix4[] = [];
    const nearFrondMatrices: THREE.Matrix4[] = [];
    const farFrondMatrices: THREE.Matrix4[] = [];

    const dummyTree = new THREE.Object3D();
    const dummyChild = new THREE.Object3D();
    const worldMat = new THREE.Matrix4();

    for (const [px, pz, scale, yaw] of palmSpots) {
      this.palmPositions.push([px, pz]);
      const groundY = getTerrainHeight(px, pz);
      dummyTree.position.set(px, groundY - 0.15, pz);
      dummyTree.rotation.set(0, yaw, 0);
      dummyTree.scale.set(1, 1, 1);
      dummyTree.updateMatrix();

      const height = (6.6 + rand() * 2.4) * scale;
      const lean = 1.1 + rand() * 1.35;

      // Curved ringed trunk
      const segs = 14;
      const curvePts: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const xOff = Math.sin(t * Math.PI * 0.65) * lean;
        const zOff = Math.pow(t, 1.5) * lean * 0.55;
        curvePts.push(new THREE.Vector3(xOff, t * height, zOff));
      }
      const curve = new THREE.CatmullRomCurve3(curvePts);
      const trunkGeo = new THREE.TubeGeometry(curve, 12, 0.24 * scale, 6, false);

      const tPos = trunkGeo.attributes.position as THREE.BufferAttribute;
      const center = new THREE.Vector3();
      const v = new THREE.Vector3();
      for (let i = 0; i < tPos.count; i++) {
        v.fromBufferAttribute(tPos, i);
        const t = THREE.MathUtils.clamp(v.y / height, 0, 1);
        curve.getPointAt(t, center);
        const ring = 1.0 + 0.08 * Math.sin(t * 48.0);
        const taper = THREE.MathUtils.lerp(1.38, 0.56, Math.pow(t, 0.72)) * ring;
        v.sub(center).multiplyScalar(taper).add(center);
        tPos.setXYZ(i, v.x, v.y, v.z);
      }
      trunkGeo.computeVertexNormals();
      const nonIdxTrunk = trunkGeo.toNonIndexed();
      nonIdxTrunk.applyMatrix4(dummyTree.matrix);
      trunkGeo.dispose();
      if (pz > -48) nearTrunks.push(nonIdxTrunk);
      else farTrunks.push(nonIdxTrunk);

      const top = curve.getPointAt(1.0);

      // 4 coconuts tucked under fronds (batched into 1 InstancedMesh)
      for (let c = 0; c < 4; c++) {
        const ang = (c / 4) * Math.PI * 2 + rand() * 0.5;
        dummyChild.position.set(
          top.x + Math.cos(ang) * 0.24 * scale,
          top.y - 0.18 * scale,
          top.z + Math.sin(ang) * 0.24 * scale
        );
        dummyChild.rotation.set(0, 0, 0);
        dummyChild.scale.set(0.14 * scale, 0.14 * 1.18 * scale, 0.14 * scale);
        dummyChild.updateMatrix();
        worldMat.copy(dummyTree.matrix).multiply(dummyChild.matrix);
        coconutMatrices.push(worldMat.clone());
      }

      // 12 radiating arched palm fronds near shoreline, 8 fuller fronds on distant rear hillside!
      const isNear = pz > -46;
      const frondCount = isNear ? 12 : 8;
      const upperTier = isNear ? 5 : 3;
      const lowerTier = frondCount - upperTier;
      for (let f = 0; f < frondCount; f++) {
        const tier = f < upperTier ? 0 : 1;
        const angle = (f / (tier === 0 ? upperTier : lowerTier)) * Math.PI * 2 + tier * 0.45 + (rand() - 0.5) * 0.25;
        dummyChild.position.copy(top);
        dummyChild.rotation.set(tier === 0 ? -0.35 + rand() * 0.14 : 0.12 + rand() * 0.2, angle, 0);
        const fs = scale * (tier === 0 ? 0.88 : 1.06) * (isNear ? 1.0 : 1.12) * (0.92 + rand() * 0.18);
        dummyChild.scale.set(fs, fs, fs);
        dummyChild.updateMatrix();
        worldMat.copy(dummyTree.matrix).multiply(dummyChild.matrix);
        if (isNear) nearFrondMatrices.push(worldMat.clone());
        else farFrondMatrices.push(worldMat.clone());
      }

      addCollider(px, pz, 0.38 * scale, height);
    }

    // 1. Merged Trunk Meshes (near beach trunks cast shadows; distant rear-hill trunks skip shadow pass!)
    const addTrunkBatch = (geos: THREE.BufferGeometry[], castShadow: boolean) => {
      if (geos.length === 0) return;
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (merged) {
        const mesh = new THREE.Mesh(merged, trunkMat);
        mesh.castShadow = castShadow;
        mesh.receiveShadow = true;
        this.palmsGroup.add(mesh);
      }
    };
    addTrunkBatch(nearTrunks, true);
    addTrunkBatch(farTrunks, false);

    // 2. Instanced Coconuts (1 draw call for all coconuts!)
    if (coconutMatrices.length > 0) {
      const cocoGeo = new THREE.SphereGeometry(1, 5, 4);
      const cocoInst = new THREE.InstancedMesh(cocoGeo, coconutMat, coconutMatrices.length);
      cocoInst.castShadow = false;
      cocoInst.receiveShadow = true;
      for (let i = 0; i < coconutMatrices.length; i++) {
        cocoInst.setMatrixAt(i, coconutMatrices[i]);
      }
      cocoInst.instanceMatrix.needsUpdate = true;
      cocoInst.computeBoundingSphere();
      this.palmsGroup.add(cocoInst);
    }

    // 3. Instanced Near & Far Palm Fronds (2 draw calls total for all 408 feathery fronds!)
    const addFrondInst = (mats: THREE.Matrix4[], castShadow: boolean) => {
      if (mats.length === 0) return;
      const inst = new THREE.InstancedMesh(frondGeo, frondMat, mats.length);
      inst.castShadow = castShadow;
      if (castShadow) inst.customDepthMaterial = frondDepthMat;
      inst.receiveShadow = true;
      for (let i = 0; i < mats.length; i++) {
        inst.setMatrixAt(i, mats[i]);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      this.palmsGroup.add(inst);
    };
    addFrondInst(nearFrondMatrices, true);
    addFrondInst(farFrondMatrices, false);
  }

  private createFeatheryFrondTexture(): THREE.CanvasTexture {
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 512;
    const c = cv.getContext('2d')!;
    c.clearRect(0, 0, 128, 512);

    const rand = seededRandom(9917);
    for (let i = 0; i < 150; i++) {
      const v = 0.03 + (i / 150) * 0.95;
      const y = 512 - v * 512;
      const len = 58 * Math.pow(Math.sin(Math.PI * Math.min(1, v * 1.04 + 0.04)), 0.6) * (0.85 + rand() * 0.2);
      for (const side of [-1, 1]) {
        const g = 96 + rand() * 68;
        c.strokeStyle = `rgb(${Math.round(42 + rand() * 44 + v * 40)},${Math.round(g + v * 28)},${Math.round(28 + rand() * 24)})`;
        c.lineWidth = 3.6;
        c.beginPath();
        c.moveTo(64, y);
        c.quadraticCurveTo(64 + side * len * 0.5, y - 10, 64 + side * len, y - 26 + rand() * 8);
        c.stroke();
      }
    }
    c.strokeStyle = '#8a8a3c';
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(64, 512);
    c.lineTo(64, 6);
    c.stroke();

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  private createPalmFrondGeometry(): THREE.BufferGeometry {
    const NS = 8;
    const L = 3.45;
    const W = 0.78;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= NS; i++) {
      const s = i / NS;
      const z = s * L;
      const yBase = Math.sin(s * Math.PI * 0.80) * 0.58 - s * s * 0.92;
      const w = W * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.02 + 0.03)), 0.72);
      for (let k = -1; k <= 1; k++) {
        positions.push(k * w, yBase - Math.abs(k) * w * 0.34, z);
        uvs.push((k + 1) * 0.5, s);
      }
    }
    for (let i = 0; i < NS; i++) {
      for (let k = 0; k < 2; k++) {
        const a = i * 3 + k;
        indices.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  private createTuftGeometry(
    rand: () => number,
    blades: number,
    baseCol: THREE.Color,
    tipCol: THREE.Color
  ): THREE.BufferGeometry {
    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const SEG = 2;
    const tmpCol = new THREE.Color();

    for (let b = 0; b < blades; b++) {
      const a = rand() * Math.PI * 2;
      const r0 = rand() * 0.12;
      const h = 0.45 + rand() * 0.52;
      const lean = 0.12 + rand() * 0.42;
      const wd = 0.015 + rand() * 0.012;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const start = pos.length / 3;
      for (let i = 0; i <= SEG; i++) {
        const t = i / SEG;
        const out = r0 + lean * t * t * h;
        const w = wd * (1 - t * 0.92);
        for (const s of [-1, 1]) {
          pos.push(ca * out - sa * w * s, h * t, sa * out + ca * w * s);
          nor.push(ca * 0.35, 0.93, sa * 0.35);
          tmpCol.copy(baseCol).lerp(tipCol, t);
          col.push(tmpCol.r, tmpCol.g, tmpCol.b);
        }
      }
      for (let i = 0; i < SEG; i++) {
        const k = start + i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    return g;
  }

  /**
   * 560 wind-swaying Marram dune grass tufts + 200 swaying underwater seagrass blades (frustum-culled West/East batches).
   */
  /**
   * Realistic Feathered-Foliage Mediterranean Coastal Pines & Cypresses (only 2 instanced draw calls,
   * ~2,400 tris total — ZERO cartoony smooth blobs, crisp sunlit conifer needles with alphaTest!).
   */
  private buildCoastalPinesAndShrubs(rand: () => number): void {
    // Procedural high-detail layered conifer pine-needle bough texture (alphaTest crisp needles)
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 256;
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 256);
    for (let i = 0; i < 240; i++) {
      const ang = (i / 240) * Math.PI * 2 + (i % 7) * 0.13;
      const rad = 18 + ((i * 37) % 92);
      const cx = 128 + Math.cos(ang) * rad * 0.92;
      const cy = 128 + Math.sin(ang) * rad * 0.72;
      const len = 24 + (i % 18);
      ctx.strokeStyle = i % 3 === 0 ? '#2b5232' : i % 3 === 1 ? '#3b6a3b' : '#4f7f44';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len * 0.75);
      ctx.stroke();
    }
    const needleTex = new THREE.CanvasTexture(cv);
    needleTex.colorSpace = THREE.SRGBColorSpace;
    needleTex.anisotropy = 4;

    const trunkGeo = new THREE.CylinderGeometry(0.11, 0.24, 4.6, 6);
    trunkGeo.translate(0, 2.3, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4534, roughness: 0.94 });

    // Multi-layered crossed & tiered feathery conifer bough cards (~36 tris per tree!)
    const cards: THREE.BufferGeometry[] = [];
    const tiers: Array<[number, number]> = [
      [3.1, 2.3],
      [4.2, 2.0],
      [5.2, 1.55],
      [6.0, 1.05]
    ];
    for (const [ty, w] of tiers) {
      const horiz = new THREE.PlaneGeometry(w * 2, w * 2);
      horiz.rotateX(-Math.PI / 2);
      horiz.translate(0, ty, 0);
      cards.push(horiz);
      for (let k = 0; k < 2; k++) {
        const vCard = new THREE.PlaneGeometry(w * 1.9, w * 0.95);
        vCard.rotateY((k * Math.PI) / 2 + ty);
        vCard.translate(0, ty + 0.15, 0);
        cards.push(vCard);
      }
    }
    const crownGeo = mergeGeometries(cards, false)!;
    for (const c of cards) c.dispose();

    const crownMat = new THREE.MeshStandardMaterial({
      map: needleTex,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
      roughness: 0.84
    });

    const pineSpots: Array<[number, number, number]> = [
      [-86, -54, 1.15], [-78, -62, 1.25], [-70, -56, 1.08], [-64, -68, 1.22],
      [-56, -58, 1.12], [-48, -66, 1.26], [-42, -55, 1.05], [-34, -70, 1.28],
      [-26, -57, 1.10], [-18, -68, 1.24], [-10, -58, 1.08], [-2, -72, 1.26],
      [8, -60, 1.14], [16, -70, 1.22], [24, -56, 1.06], [32, -68, 1.25],
      [40, -58, 1.12], [48, -70, 1.24], [56, -58, 1.10], [64, -68, 1.22],
      [72, -56, 1.14], [80, -64, 1.26], [88, -50, 1.18], [92, -38, 1.06],
      [-92, -40, 1.10], [-82, -26, 0.96], [-72, -32, 0.98], [76, -28, 0.95],
      [86, -24, 1.02], [-60, -76, 1.32], [-22, -78, 1.34], [12, -78, 1.32],
      [44, -78, 1.30], [74, -74, 1.28]
    ];

    const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, pineSpots.length);
    const crownInst = new THREE.InstancedMesh(crownGeo, crownMat, pineSpots.length);
    trunkInst.castShadow = false;
    crownInst.castShadow = false;
    crownInst.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    const pineTones = [0xd4e8cf, 0xc4deb8, 0xdce8c5, 0xc2d6bc, 0xd8e4c8];
    pineSpots.forEach(([px, pz, sc], i) => {
      const gy = getTerrainHeight(px, pz);
      dummy.position.set(px, gy - 0.25, pz);
      dummy.rotation.set((rand() - 0.5) * 0.10, rand() * Math.PI * 2, (rand() - 0.5) * 0.10);
      const sXZ = sc * (0.90 + rand() * 0.34);
      const sY = sc * (0.95 + rand() * 0.36);
      dummy.scale.set(sXZ, sY, sXZ);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(i, dummy.matrix);
      crownInst.setMatrixAt(i, dummy.matrix);
      col.setHex(pineTones[i % pineTones.length]);
      crownInst.setColorAt(i, col);
    });
    trunkInst.instanceMatrix.needsUpdate = true;
    crownInst.instanceMatrix.needsUpdate = true;
    if (crownInst.instanceColor) crownInst.instanceColor.needsUpdate = true;
    this.palmsGroup.add(trunkInst, crownInst);
  }

  private buildGrassAndSeagrass(rand: () => number): void {
    const mkTuftMat = (speed: number, amp: number, cacheKey: string) => {
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        roughness: 0.78,
        metalness: 0.0
      });
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = this.windUniforms.uTime;
        shader.uniforms.uWindStrength = this.windUniforms.uWindStrength;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWindStrength;')
          .replace(
            '#include <begin_vertex>',
            /* glsl */ `
            #include <begin_vertex>
            {
              float ph = uTime * ${speed.toFixed(2)} + instanceMatrix[3].x * 0.6 + instanceMatrix[3].z * 0.8;
              float hh = transformed.y * transformed.y;
              float wScale = (0.7 + 0.3 * uWindStrength);
              transformed.x += (sin(ph) + 0.5 * sin(ph * 2.7)) * ${amp.toFixed(3)} * hh * wScale;
              transformed.z += cos(ph * 1.3) * ${(amp * 0.6).toFixed(3)} * hh * wScale;
            }
            `
          );
      };
      mat.customProgramCacheKey = () => cacheKey;
      return mat;
    };

    const dummy = new THREE.Object3D();
    const emitSplitTufts = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      pts: Array<[number, number, number]>,
      yScaleMin: number,
      yScaleSpan: number,
      targetGroup: THREE.Group
    ) => {
      const west = pts.filter(([x]) => x < 0);
      const east = pts.filter(([x]) => x >= 0);
      for (const batch of [west, east]) {
        if (batch.length === 0) continue;
        const inst = new THREE.InstancedMesh(geo, mat, batch.length);
        for (let i = 0; i < batch.length; i++) {
          const [tx, tz, sc] = batch[i];
          dummy.position.set(tx, getTerrainHeight(tx, tz) - 0.03, tz);
          dummy.rotation.set(0, rand() * Math.PI * 2, 0);
          dummy.scale.set(sc, sc * (yScaleMin + rand() * yScaleSpan), sc);
          dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix);
        }
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        inst.castShadow = false;
        inst.receiveShadow = true;
        inst.frustumCulled = true;
        targetGroup.add(inst);
      }
    };

    const isClearDune = (gx: number, gz: number): boolean => {
      if (gz > -28.8) return false;
      if (gx > -62.0 && gx < -52.0 && gz > -32.2) return false; // West Hammock Grove
      if (gx > -51.5 && gx < -43.5 && gz > -32.6) return false; // West Coffee Cart Deck
      if (gx > -40.5 && gx < -32.5 && gz > -32.6) return false; // West picnic terrace
      if (gx > -28.0 && gx < -12.5 && gz > -34.5) return false; // Tiki Bar + Surf Rack
      if (gx > -12.8 && gx < 2.2 && gz > -33.6) return false;   // Center Patio + Lifeguard Tower
      if (gx > 5.5 && gx < 16.0 && gz > -32.6) return false;    // East Café Terrace
      if (gx > 29.0 && gx < 37.0 && gz > -32.6) return false;   // Far East Picnic Terrace
      if (gx > 44.0 && gx < 53.0 && gz > -32.6) return false;   // East Lagoon Overlook Deck
      if (gx > -68.0 && gx < -53.0 && gz > -47.0 && gz < -35.0) return false; // West Fort
      return true;
    };

    // 1. Coastal Dune Grass (760 tufts × 5 blades across expanded 184m dunes)
    const grassGeo = this.createTuftGeometry(rand, 5, new THREE.Color(0x3a4718), new THREE.Color(0xcab668));
    const grassMat = mkTuftMat(2.0, 0.16, 'dune-grass-sway');
    const grassPts: Array<[number, number, number]> = [];
    for (let i = 0; i < 4200 && grassPts.length < 760; i++) {
      const gx = (rand() - 0.5) * 184;
      const gz = -28.8 - rand() * 42.0;
      if (!isClearDune(gx, gz)) continue;
      grassPts.push([gx, gz, 0.85 + rand() * 0.85]);
    }
    emitSplitTufts(grassGeo, grassMat, grassPts, 0.8, 0.5, this.palmsGroup);

    // 2. Underwater Seagrass Tufts (280 tufts × 4 blades swaying gently on expanded seabed)
    const weedGeo = this.createTuftGeometry(rand, 4, new THREE.Color(0x0d2b12), new THREE.Color(0x418229));
    const weedMat = mkTuftMat(0.9, 0.28, 'seagrass-sway');
    const weedPts: Array<[number, number, number]> = [];
    for (let i = 0; i < 2400 && weedPts.length < 280; i++) {
      const wx = (rand() - 0.5) * 156;
      const wz = 14.0 + rand() * 60.0;
      const h = getTerrainHeight(wx, wz);
      if (h > -1.45 || h < -12.0) continue;
      const maxSc = Math.min(1.8, Math.max(0.45, -h * 0.52));
      weedPts.push([wx, wz, Math.min(0.85 + rand() * 1.15, maxSc)]);
    }
    emitSplitTufts(weedGeo, weedMat, weedPts, 0.85, 0.4, this.reefFloraGroup);
  }

  private buildUnderwaterReefFlora(rand: () => number): void {
    // 1. Swaying underwater seagrass / kelp ribbons
    const kelpGeo = new THREE.PlaneGeometry(0.18, 1.65, 1, 7);
    kelpGeo.translate(0, 0.825, 0);

    const kelpMat = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      roughness: 0.7,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uSunDirection: { value: new THREE.Vector3(0.35, 0.72, 0.58).normalize() },
        uSunColor: { value: new THREE.Color(0xfff4dd) }
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying float vH;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        void main() {
          vH = uv.y;
          vec3 p = position;
          // Taper tip
          p.x *= (1.0 - vH * 0.72);
          vec4 baseWp = modelMatrix * instanceMatrix * vec4(p, 1.0);
          float current = sin(uTime * 1.45 + baseWp.x * 0.35 + baseWp.z * 0.28 + vH * 3.2) * 0.26;
          p.x += current * vH;
          p.z += cos(uTime * 1.15 + baseWp.z * 0.4 + vH * 2.5) * 0.16 * vH;
          csm_Position = p;
          vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
          vWorldPos = wp.xyz;
          vWorldNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        varying float vH;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;

        ${CAUSTICS_GLSL}

        void main() {
          vec3 baseCol = mix(vec3(0.08, 0.24, 0.14), vec3(0.20, 0.44, 0.22), vH);
          vec3 caustics = computeUnderwaterCaustics(vWorldPos, abs(normalize(vWorldNormal)), uSunDirection, 0.0, uTime);
          csm_DiffuseColor = vec4(baseCol, 1.0);
          csm_Emissive = caustics * uSunColor * 0.38;
        }
      `
    });
    this.kelpMaterials.push(kelpMat);

    const kelpSpots: Array<{ x: number; y: number; z: number; rot: number; sy: number }> = [];
    for (let i = 0; i < 680 && kelpSpots.length < 140; i++) {
      const x = (rand() - 0.5) * 64;
      const z = 24 + rand() * 42;
      const h = getTerrainHeight(x, z);
      // Keep kelp deeply submerged even during wave troughs so tips never poke out of the water
      if (h > -2.75 || h < -12.0) continue;
      const maxSy = Math.min(1.35, Math.max(0.28, (-h - 1.65) / 1.65));
      kelpSpots.push({
        x,
        y: h - 0.06,
        z,
        rot: rand() * Math.PI * 2,
        sy: (0.45 + rand() * 0.55) * maxSy
      });
    }

    const kelpInst = new THREE.InstancedMesh(kelpGeo, kelpMat, kelpSpots.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < kelpSpots.length; i++) {
      const k = kelpSpots[i];
      dummy.position.set(k.x, k.y, k.z);
      dummy.rotation.set(0, k.rot, 0);
      dummy.scale.set(1, k.sy, 1);
      dummy.updateMatrix();
      kelpInst.setMatrixAt(i, dummy.matrix);
    }
    kelpInst.instanceMatrix.needsUpdate = true;
    this.reefFloraGroup.add(kelpInst);

    // 2. Smooth high-detail sculpted underwater reef coral clusters (brain mounds + branching staghorn coral!)
    //    Uses smooth indexed SphereGeometry & branching tapered tubes + rock normal relief (ZERO faceted low-poly blobs!)
    const loader = new THREE.TextureLoader();
    const coralNor = loader.load('./textures/rock_nor_gl.jpg');
    coralNor.wrapS = coralNor.wrapT = THREE.RepeatWrapping;
    coralNor.repeat.set(3, 3);
    coralNor.anisotropy = 8;

    const coralColors = [0xd46a55, 0xc8844c, 0x9b64a6, 0xcfa34e, 0x4aa395];

    // Smooth indexed brain-coral dome
    const brainGeo = new THREE.SphereGeometry(0.42, 12, 9);
    const cPos = brainGeo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < cPos.count; i++) {
      v.fromBufferAttribute(cPos, i);
      const ridge =
        1.0 +
        0.10 * Math.sin(v.x * 16.0 + Math.cos(v.z * 12.0)) * Math.cos(v.y * 12.0) +
        0.08 * Math.sin(v.z * 14.0 + v.x * 9.0);
      v.multiplyScalar(ridge);
      if (v.y < -0.05) v.y *= 0.42;
      cPos.setXYZ(i, v.x, v.y, v.z);
    }
    brainGeo.computeVertexNormals();

    // Pre-build 5 shared coral materials (instead of 34 unique shaders!) for higher GPU FPS
    const coralMats = coralColors.map((colHex) => {
      const mat = new CustomShaderMaterial({
        baseMaterial: THREE.MeshStandardMaterial,
        color: colHex,
        normalMap: coralNor,
        normalScale: new THREE.Vector2(0.85, 0.85),
        roughness: 0.82,
        metalness: 0.0,
        uniforms: {
          uTime: { value: 0 },
          uSunDirection: { value: new THREE.Vector3(0.35, 0.72, 0.58).normalize() },
          uSunColor: { value: new THREE.Color(0xfff4dd) }
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorldPos;
          varying vec3 vWorldNormal;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorldPos = wp.xyz;
            vWorldNormal = normalize(mat3(modelMatrix) * normal);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uSunDirection;
          uniform vec3 uSunColor;
          varying vec3 vWorldPos;
          varying vec3 vWorldNormal;
          ${CAUSTICS_GLSL}
          void main() {
            vec3 caustics = computeUnderwaterCaustics(vWorldPos, normalize(vWorldNormal), uSunDirection, 0.0, uTime);
            float dusk = 1.0 - smoothstep(0.06, 0.34, uSunDirection.y);
            float bioPulse = 0.65 + 0.35 * sin(uTime * 1.9 + vWorldPos.x * 0.35 + vWorldPos.z * 0.25);
            vec3 bioGlow = vec3(0.14, 0.78, 0.92) * dusk * bioPulse * 0.55;
            csm_Emissive = caustics * uSunColor * 0.48 + bioGlow;
          }
        `
      });
      this.kelpMaterials.push(mat);
      return mat;
    });

    const branchGeo = new THREE.CapsuleGeometry(0.055, 0.42, 3, 7);
    branchGeo.translate(0, 0.24, 0);

    for (let c = 0; c < 24; c++) {
      const x = (rand() - 0.5) * 52;
      const z = 22 + rand() * 32;
      const h = getTerrainHeight(x, z);
      if (h > -2.35) continue;

      const mat = coralMats[c % coralMats.length];
      const cluster = new THREE.Group();
      cluster.position.set(x, h + 0.02, z);
      cluster.rotation.y = rand() * Math.PI * 2;

      if (c % 2 === 0) {
        // Organic multi-dome brain coral head
        const mainDome = new THREE.Mesh(brainGeo, mat);
        const sx = 0.65 + rand() * 0.75;
        const sy = 0.48 + rand() * 0.55;
        const sz = 0.65 + rand() * 0.75;
        mainDome.scale.set(sx, sy, sz);
        mainDome.position.y = sy * 0.14;
        mainDome.receiveShadow = true;
        cluster.add(mainDome);

        const subDome = new THREE.Mesh(brainGeo, coralMats[(c + 2) % coralMats.length]);
        subDome.scale.set(sx * 0.58, sy * 0.55, sz * 0.58);
        subDome.position.set(sx * 0.34, sy * 0.08, sz * 0.22);
        cluster.add(subDome);
      } else {
        // Branching staghorn coral bouquet rising from a smooth reef base
        const base = new THREE.Mesh(brainGeo, coralMats[(c + 1) % coralMats.length]);
        base.scale.set(0.55, 0.30, 0.55);
        cluster.add(base);

        const branches = 6 + Math.floor(rand() * 4);
        for (let b = 0; b < branches; b++) {
          const ang = (b / branches) * Math.PI * 2 + rand() * 0.4;
          const tilt = 0.24 + rand() * 0.42;
          const sc = 0.72 + rand() * 0.65;
          const limb = new THREE.Mesh(branchGeo, mat);
          limb.position.set(Math.cos(ang) * 0.12, 0.05, Math.sin(ang) * 0.12);
          limb.rotation.set(Math.sin(ang) * tilt, ang, -Math.cos(ang) * tilt);
          limb.scale.set(sc * 0.85, sc, sc * 0.85);
          cluster.add(limb);
        }
      }

      this.reefFloraGroup.add(cluster);
    }

    // Merge all underwater coral clusters by material (150+ meshes -> 5 draw calls!)
    mergeStaticGroupByMaterial(this.reefFloraGroup);
  }

  public update(
    elapsedTime: number,
    waveIntensity: number,
    sunDirection: THREE.Vector3,
    sunColor: THREE.Color
  ): void {
    const wind = 0.7 + waveIntensity * 0.5;
    this.windUniforms.uTime.value = elapsedTime;
    this.windUniforms.uWindStrength.value = wind;
    for (let i = 0; i < this.kelpMaterials.length; i++) {
      const u = this.kelpMaterials[i].uniforms;
      u.uTime.value = elapsedTime;
      u.uSunDirection.value.copy(sunDirection);
      u.uSunColor.value.copy(sunColor);
    }
  }
}
