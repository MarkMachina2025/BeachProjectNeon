import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { addCollider, getTerrainHeight } from '../terrain/terrainMath';
import { CAUSTICS_GLSL } from '../shaders/causticsChunk';

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
  private readonly windMaterials: CustomShaderMaterial[] = [];
  private readonly kelpMaterials: CustomShaderMaterial[] = [];

  constructor() {
    this.group.name = 'CoastalFoliage';
    const rand = seededRandom(4207);

    this.buildPalmTrees(rand);
    this.buildDuneGrass(rand);
    this.buildUnderwaterReefFlora(rand);
  }

  private buildPalmTrees(rand: () => number): void {
    const loader = new THREE.TextureLoader();
    const barkDiff = loader.load('./textures/wood_Diffuse.jpg');
    barkDiff.wrapS = barkDiff.wrapT = THREE.RepeatWrapping;
    barkDiff.repeat.set(2, 6);
    barkDiff.anisotropy = 8;
    barkDiff.colorSpace = THREE.SRGBColorSpace;

    const barkNor = loader.load('./textures/wood_nor_gl.jpg');
    barkNor.wrapS = barkNor.wrapT = THREE.RepeatWrapping;
    barkNor.repeat.set(2, 6);
    barkNor.anisotropy = 8;

    const trunkMat = new THREE.MeshStandardMaterial({
      map: barkDiff,
      normalMap: barkNor,
      normalScale: new THREE.Vector2(0.85, 0.85),
      color: 0xcab39a,
      roughness: 0.90,
      metalness: 0.0
    });

    const coconutMat = new THREE.MeshStandardMaterial({
      color: 0x4b321d,
      roughness: 0.78
    });

    const frondMat = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      color: 0x3b7a38,
      roughness: 0.62,
      metalness: 0.0,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uWindStrength: { value: 1.0 }
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uWindStrength;
        varying float vFrondT;
        void main() {
          vec3 p = position;
          // Local z goes from 0 (stem) to ~3.4 (frond tip)
          float tip = clamp(p.z / 3.4, 0.0, 1.0);
          vFrondT = tip;
          vec4 wp = modelMatrix * vec4(p, 1.0);
          float gust = sin(uTime * 1.9 + wp.x * 0.28 + wp.z * 0.22) * 0.16 +
                       cos(uTime * 3.4 + wp.x * 0.7) * 0.05;
          p.y += gust * tip * tip * uWindStrength * 1.4;
          p.x += gust * tip * uWindStrength * 0.7;
          csm_Position = p;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vFrondT;
        void main() {
          vec3 baseGreen = vec3(0.18, 0.42, 0.15);
          vec3 sunlitTip = vec3(0.42, 0.64, 0.22);
          csm_DiffuseColor = vec4(mix(baseGreen, sunlitTip, vFrondT * 0.85), 1.0);
        }
      `
    });
    this.windMaterials.push(frondMat);

    // Pre-build an arched pinnate palm frond geometry (central rachis + V-folded leaflets)
    const frondGeo = this.createPalmFrondGeometry();

    // Expanded (+50% wider beach) natural palm groves framing the sweeping sandy dunes
    const palmSpots: Array<[number, number, number, number]> = [
      [-48, -22, 1.06, 0.4],
      [-42, -29, 1.12, -0.5],
      [-36, -24, 0.96, 1.1],
      [-30, -32, 1.14, 0.2],
      [-24, -27, 1.02, 1.6],
      [-18, -33, 1.16, -0.7],
      [-11, -35, 0.98, 0.9],
      [-4, -37, 1.08, 2.1],
      [4, -36, 1.12, -0.4],
      [11, -34, 1.02, 0.6],
      [18, -31, 1.16, -1.1],
      [25, -28, 0.96, 1.5],
      [32, -25, 1.08, 0.2],
      [39, -29, 1.14, -0.8],
      [46, -21, 1.04, 1.9],
      [-52, -16, 0.92, 0.8],
      [52, -15, 0.98, -0.9],
      [-28, -42, 1.22, 2.3],
      [-8, -44, 1.18, -0.2],
      [14, -43, 1.20, 1.3],
      [34, -40, 1.15, -1.4],
      [-44, -38, 1.10, 0.7]
    ];

    for (const [px, pz, scale, yaw] of palmSpots) {
      const groundY = getTerrainHeight(px, pz);
      const tree = new THREE.Group();
      tree.position.set(px, groundY - 0.15, pz);
      tree.rotation.y = yaw;

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
      const trunkGeo = new THREE.TubeGeometry(curve, 18, 0.24 * scale, 8, false);

      // Taper trunk radius from sturdy base to slender crown + bark rings
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

      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.castShadow = true;
      trunk.receiveShadow = true;
      tree.add(trunk);

      // Crown at trunk top
      const top = curve.getPointAt(1.0);
      const crown = new THREE.Group();
      crown.position.copy(top);
      tree.add(crown);

      // 3-4 coconuts tucked under fronds
      const cocoGeo = new THREE.SphereGeometry(0.14 * scale, 8, 7);
      for (let c = 0; c < 4; c++) {
        const ang = (c / 4) * Math.PI * 2 + rand() * 0.5;
        const coco = new THREE.Mesh(cocoGeo, coconutMat);
        coco.position.set(Math.cos(ang) * 0.24 * scale, -0.18 * scale, Math.sin(ang) * 0.24 * scale);
        coco.scale.set(1, 1.18, 1);
        coco.castShadow = true;
        crown.add(coco);
      }

      // 11-13 radiating arched palm fronds (2 tiers)
      const frondCount = 12;
      for (let f = 0; f < frondCount; f++) {
        const tier = f < 5 ? 0 : 1;
        const angle = (f / (tier === 0 ? 5 : 7)) * Math.PI * 2 + tier * 0.45 + (rand() - 0.5) * 0.25;
        const frond = new THREE.Mesh(frondGeo, frondMat);
        frond.rotation.y = angle;
        frond.rotation.x = tier === 0 ? -0.35 + rand() * 0.14 : 0.12 + rand() * 0.2;
        const fs = scale * (tier === 0 ? 0.88 : 1.06) * (0.92 + rand() * 0.18);
        frond.scale.set(fs, fs, fs);
        frond.castShadow = true;
        frond.receiveShadow = true;
        crown.add(frond);
      }

      this.group.add(tree);
      addCollider(px, pz, 0.38 * scale, height);
    }
  }

  private createPalmFrondGeometry(): THREE.BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    const length = 3.45;
    const leaflets = 16;

    // Central spine rib + paired drooping leaflets
    let vIdx = 0;
    const archY = (t: number) => Math.sin(t * Math.PI * 0.82) * 0.65 - t * t * 0.95;

    for (let i = 0; i < leaflets; i++) {
      const t0 = 0.08 + (i / leaflets) * 0.88;
      const t1 = Math.min(1.0, t0 + 0.075);
      const z0 = t0 * length;
      const z1 = t1 * length;
      const y0 = archY(t0);
      const y1 = archY(t1);

      const width = Math.sin(t0 * Math.PI) * 0.72 + 0.08;
      const droop = width * 0.42;

      for (const side of [-1, 1]) {
        const p0 = [0, y0, z0];
        const p1 = [0, y1, z1];
        const p2 = [side * width, y0 - droop, z0 + 0.16];
        const p3 = [side * width * 0.72, y1 - droop * 0.9, z1 + 0.14];

        positions.push(...p0, ...p1, ...p2, ...p3);
        const nx = side * 0.35;
        const ny = 0.92;
        normals.push(nx, ny, 0, nx, ny, 0, nx, ny, 0, nx, ny, 0);

        indices.push(vIdx, vIdx + 1, vIdx + 2, vIdx + 1, vIdx + 3, vIdx + 2);
        vIdx += 4;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  private buildDuneGrass(rand: () => number): void {
    // Tapered curved grass blade cluster geometry (5 blades per tuft)
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let vIdx = 0;

    for (let b = 0; b < 5; b++) {
      const ang = (b / 5) * Math.PI * 2 + b * 0.4;
      const h = 0.55 + (b % 3) * 0.16;
      const lean = 0.14 + (b % 2) * 0.08;
      const w = 0.032;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);

      const segs = 3;
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const bw = w * (1.0 - t * 0.88);
        const rOff = t * t * lean;
        const cx = ca * rOff;
        const cz = sa * rOff;
        const cy = t * h;

        positions.push(
          cx - sa * bw, cy, cz + ca * bw,
          cx + sa * bw, cy, cz - ca * bw
        );
        uvs.push(0, t, 1, t);
      }

      for (let s = 0; s < segs; s++) {
        const i0 = vIdx + s * 2;
        indices.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
      }
      vIdx += (segs + 1) * 2;
    }

    const tuftGeo = new THREE.BufferGeometry();
    tuftGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    tuftGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    tuftGeo.setIndex(indices);
    tuftGeo.computeVertexNormals();

    const grassMat = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      roughness: 0.78,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uWindStrength: { value: 1.0 }
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uWindStrength;
        varying float vTip;
        void main() {
          vTip = uv.y;
          vec3 p = position;
          vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
          float sway = sin(uTime * 2.2 + wp.x * 0.42 + wp.z * 0.35) * 0.14 * uWindStrength;
          p.x += sway * vTip * vTip;
          p.z += sway * 0.55 * vTip * vTip;
          csm_Position = p;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vTip;
        void main() {
          vec3 rootCol = vec3(0.30, 0.42, 0.18);
          vec3 dryTip  = vec3(0.68, 0.64, 0.34);
          csm_DiffuseColor = vec4(mix(rootCol, dryTip, pow(vTip, 1.3)), 1.0);
        }
      `
    });
    this.windMaterials.push(grassMat);

    // Scatter 540 tufts across the expanded dunes & back-beach crests
    const placements: Array<{ x: number; y: number; z: number; rot: number; scale: number }> = [];
    for (let i = 0; i < 960 && placements.length < 540; i++) {
      const x = (rand() - 0.5) * 136;
      const z = -22 - rand() * 38;
      const h = getTerrainHeight(x, z);
      if (h < 2.25) continue;
      placements.push({
        x,
        y: h - 0.04,
        z,
        rot: rand() * Math.PI * 2,
        scale: 0.78 + rand() * 0.92
      });
    }

    const inst = new THREE.InstancedMesh(tuftGeo, grassMat, placements.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.setScalar(p.scale);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.receiveShadow = true;
    inst.castShadow = false;
    this.group.add(inst);
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
    for (let i = 0; i < 680 && kelpSpots.length < 200; i++) {
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
    this.group.add(kelpInst);

    // 2. Sculpted underwater reef coral clusters (warm coral orange, violet, seafoam)
    const coralColors = [0xd96b52, 0xc97d4b, 0x9b5ea8, 0xd4a448, 0x4ca69a];
    const coralGeo = new THREE.DodecahedronGeometry(0.45, 2);
    const cPos = coralGeo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < cPos.count; i++) {
      v.fromBufferAttribute(cPos, i);
      const lump = 1.0 + 0.24 * Math.sin(v.x * 9.0) * Math.cos(v.y * 9.0) + 0.16 * Math.sin(v.z * 11.0);
      v.multiplyScalar(lump);
      if (v.y < -0.1) v.y *= 0.5;
      cPos.setXYZ(i, v.x, v.y, v.z);
    }
    coralGeo.computeVertexNormals();

    for (let c = 0; c < 34; c++) {
      const x = (rand() - 0.5) * 52;
      const z = 16 + rand() * 34;
      const h = getTerrainHeight(x, z);
      if (h > -1.6) continue;

      const mat = new CustomShaderMaterial({
        baseMaterial: THREE.MeshStandardMaterial,
        color: coralColors[c % coralColors.length],
        roughness: 0.75,
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
            csm_Emissive = caustics * uSunColor * 0.52;
          }
        `
      });
      this.kelpMaterials.push(mat);

      const coral = new THREE.Mesh(coralGeo, mat);
      coral.position.set(x, h + 0.12, z);
      coral.scale.set(0.7 + rand() * 1.2, 0.55 + rand() * 0.9, 0.7 + rand() * 1.2);
      coral.rotation.y = rand() * Math.PI * 2;
      coral.receiveShadow = true;
      this.group.add(coral);
    }
  }

  public update(
    elapsedTime: number,
    waveIntensity: number,
    sunDirection: THREE.Vector3,
    sunColor: THREE.Color
  ): void {
    const wind = 0.7 + waveIntensity * 0.5;
    for (let i = 0; i < this.windMaterials.length; i++) {
      this.windMaterials[i].uniforms.uTime.value = elapsedTime;
      this.windMaterials[i].uniforms.uWindStrength.value = wind;
    }
    for (let i = 0; i < this.kelpMaterials.length; i++) {
      const u = this.kelpMaterials[i].uniforms;
      u.uTime.value = elapsedTime;
      u.uSunDirection.value.copy(sunDirection);
      u.uSunColor.value.copy(sunColor);
    }
  }
}
