import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAUSTICS_GLSL } from '../shaders/causticsChunk';

export type HumanAnimState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'jump'
  | 'fall'
  | 'slide'
  | 'yoga'
  | 'rinse'
  | 'build_sand'
  | 'wade'
  | 'tread'
  | 'swim_surface'
  | 'swim_underwater'
  | 'sunbathe'
  | 'lounge'
  | 'chat'
  | 'play_ball'
  | 'sit_bar'
  | 'sit_chair'
  | 'dance'
  | 'wave'
  | 'scan_horizon'
  | 'whistle_signal'
  | 'snorkel_kick'
  | 'float_tube'
  | 'sup_paddle';

export type HairStyle = 'short_crop' | 'surfer_waves' | 'ponytail' | 'long_wavy' | 'top_bun' | 'curly_crown';
export type OutfitStyle = 'boardshorts' | 'rashguard' | 'bikini' | 'onepiece' | 'linen_shirt';

export interface HumanAppearance {
  gender: 'male' | 'female';
  height: number;
  skinHex: number;
  hairHex: number;
  hairStyle: HairStyle;
  outfitStyle: OutfitStyle;
  primaryColor: number;
  secondaryColor: number;
  sunglasses?: boolean;
  sunHat?: boolean;
  baseballCap?: boolean;
  sandals?: boolean;
  watch?: boolean;
  necklace?: boolean;
  isLifeguard?: boolean;
  snorkelGear?: boolean;
  /** Enable underwater caustics + wetness shader only for characters that touch water */
  useWaterCaustics?: boolean;
}

interface LoftRing {
  y: number;
  rx: number;
  rz: number;
  zOffset?: number;
  xOffset?: number;
}

/**
 * Generates a subtle tileable micro-grain normal map (fine skin pores + woven linen texture)
 * so human skin and summer clothing catch directional sunlight organically instead of flat plastic.
 */
function createHumanDetailNormalMap(): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Cross-woven micro-linen + organic stipple
      const weave = Math.sin(x * 0.98) * Math.cos(y * 0.98) * 0.35;
      const hash = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      const grain = (hash - Math.floor(hash) - 0.5) * 0.45;
      h[y * size + x] = weave + grain;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hL = h[y * size + ((x - 1 + size) % size)];
      const hR = h[y * size + ((x + 1) % size)];
      const hD = h[((y - 1 + size) % size) * size + x];
      const hU = h[((y + 1) % size) * size + x];
      const dx = (hL - hR) * 0.42;
      const dy = (hD - hU) * 0.42;
      const dz = 1.0;
      const inv = 1.0 / Math.hypot(dx, dy, dz);
      const off = (y * size + x) * 4;
      data[off] = Math.round((dx * inv * 0.5 + 0.5) * 255);
      data[off + 1] = Math.round((dy * inv * 0.5 + 0.5) * 255);
      data[off + 2] = Math.round((dz * inv * 0.5 + 0.5) * 255);
      data[off + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.needsUpdate = true;
  return tex;
}

const HUMAN_DETAIL_NORMAL = createHumanDetailNormalMap();

/**
 * Builds a smooth organically sculpted lofted mesh from elliptical cross-section rings.
 * Optional anatomical sculpting adds subtle chest sternum/pectoral definition, back spine curve,
 * or hip/glute contours instead of flat uniform cylinders.
 */
function createAnatomicalLoft(
  rings: LoftRing[],
  radialSegs = 12,
  closeEnds = true,
  sculpt?: 'chest' | 'pelvis' | 'head'
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const ringCount = rings.length;
  const stride = radialSegs + 1;

  for (let r = 0; r < ringCount; r++) {
    const ring = rings[r];
    const v = r / Math.max(1, ringCount - 1);
    const ox = ring.xOffset ?? 0;
    const oz = ring.zOffset ?? 0;
    for (let s = 0; s <= radialSegs; s++) {
      const u = s / radialSegs;
      const a = u * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      let rx = ring.rx;
      let rz = ring.rz;

      if (sculpt === 'chest' && v > 0.15 && v < 0.85) {
        const midBand = Math.sin(((v - 0.15) / 0.70) * Math.PI);
        // Subtle twin pectoral/ribcage fullness in front (sa > 0) + slight sternum & spine valley
        if (sa > 0.15) {
          const pecLobe = Math.sin(Math.min(1, Math.abs(ca) * 1.65) * Math.PI) * sa;
          const sternumDip = Math.exp(-ca * ca * 14.0) * sa;
          rz += (pecLobe * 0.011 - sternumDip * 0.008) * midBand;
        } else if (sa < -0.2) {
          // Gentle central spine furrow along back
          const spineDip = Math.exp(-ca * ca * 16.0) * (-sa);
          rz -= spineDip * 0.009 * midBand;
        }
      } else if (sculpt === 'pelvis' && v > 0.1 && v < 0.78) {
        const band = Math.sin(((v - 0.1) / 0.68) * Math.PI);
        if (sa < -0.15) {
          // Natural rear glute curvature
          const glute = Math.sin(Math.min(1, Math.abs(ca) * 1.55) * Math.PI) * (-sa);
          rz += glute * 0.014 * band;
        }
      } else if (sculpt === 'head' && v > 0.08 && v < 0.80) {
        // Sculpted human facial planes: tapered jaw/chin, subtle cheek fullness, soft recessed eye sockets & brow ridge
        if (sa > 0.25) {
          if (v < 0.34) {
            // Tapered jawline toward chin
            const jawT = 1.0 - v / 0.34;
            rx *= 1.0 - 0.14 * sa * jawT;
          } else if (v >= 0.34 && v < 0.56) {
            // Soft zygomatic cheekbone contour
            const cheekLobe = Math.sin(Math.min(1, Math.abs(ca) * 1.8) * Math.PI) * sa;
            rz += cheekLobe * 0.006;
          } else if (v >= 0.52 && v < 0.70) {
            // Gentle recessed orbital socket so eyes sit naturally inside the skull
            const socket = Math.sin(Math.min(1, Math.abs(ca) * 2.1) * Math.PI) * sa;
            rz -= socket * 0.0055;
          }
        }
      }

      const x = ox + ca * rx;
      const z = oz + sa * rz;
      positions.push(x, ring.y, z);
      uvs.push(u * 2.0, v * 2.0);
    }
  }

  for (let r = 0; r < ringCount - 1; r++) {
    for (let s = 0; s < radialSegs; s++) {
      const i0 = r * stride + s;
      const i1 = i0 + 1;
      const i2 = (r + 1) * stride + s;
      const i3 = i2 + 1;
      indices.push(i0, i2, i1, i1, i2, i3);
    }
  }

  if (closeEnds && ringCount >= 2) {
    // Bottom cap
    const bot = rings[0];
    const botCenterIdx = positions.length / 3;
    positions.push(bot.xOffset ?? 0, bot.y, bot.zOffset ?? 0);
    uvs.push(0.5, 0);
    for (let s = 0; s < radialSegs; s++) {
      indices.push(botCenterIdx, s, s + 1);
    }

    // Top cap
    const top = rings[ringCount - 1];
    const topCenterIdx = positions.length / 3;
    positions.push(top.xOffset ?? 0, top.y, top.zOffset ?? 0);
    uvs.push(0.5, 1);
    const topStart = (ringCount - 1) * stride;
    for (let s = 0; s < radialSegs; s++) {
      indices.push(topCenterIdx, topStart + s + 1, topStart + s);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export interface FootPlantEvent {
  foot: 'left' | 'right';
  worldPos: THREE.Vector3;
}

interface HumanWaterUniforms {
  uTime: { value: number };
  uWaterHeight: { value: number };
  uWetHeight: { value: number };
  uSunDirection: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
}

const SHARED_LAND_HUMAN_MAT = new THREE.MeshStandardMaterial({
  vertexColors: true,
  normalMap: HUMAN_DETAIL_NORMAL,
  normalScale: new THREE.Vector2(0.18, 0.18),
  roughness: 0.62,
  metalness: 0.02
});
SHARED_LAND_HUMAN_MAT.onBeforeCompile = (shader) => {
  shader.vertexShader =
    'attribute vec2 aMatProps;\nvarying vec2 vMatProps;\n' +
    shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vMatProps = aMatProps;`
    );
  shader.fragmentShader =
    'varying vec2 vMatProps;\n' +
    shader.fragmentShader
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         roughnessFactor = clamp(vMatProps.x, 0.08, 0.96);`
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
         float matType = vMatProps.y;
         float viewRim = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewPosition)), 0.0), 2.6);
         if (matType < 0.5) {
           // Human skin: warm sunlit subsurface scattering wrap + soft backlit rim glow
           reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.105, 0.056, 0.034);
           reflectedLight.directDiffuse += diffuseColor.rgb * vec3(0.14, 0.06, 0.03) * viewRim;
         } else if (matType < 1.5) {
           // Summer cotton/linen/swimwear fabric: soft velvety grazing cloth sheen (zero plastic gloss!)
           reflectedLight.indirectDiffuse += vec3(0.12, 0.115, 0.11) * viewRim * (0.4 + 0.6 * diffuseColor.rgb);
         } else if (matType < 2.5) {
           // Hair: soft sunlit crown specular ribbon
           reflectedLight.directSpecular += vec3(0.08, 0.075, 0.068) * (0.35 + 0.65 * viewRim);
         }`
      );
};
SHARED_LAND_HUMAN_MAT.customProgramCacheKey = () => 'skinned-human-pbr-sss-v3';

/**
 * Anatomically proportioned articulated human character with single-draw SkinnedMesh rig,
 * hierarchical THREE.Bone skeleton, smooth organic lofted limb/torso geometry, summer swimwear &
 * hairstyles, underwater caustics + wet-skin shader, and damped skeletal animation blending.
 */
export class HumanCharacter {
  public readonly root = new THREE.Group();
  public readonly appearance: HumanAppearance;

  // Hierarchical bone/joint pivots
  public readonly hips = new THREE.Bone();
  public readonly spine = new THREE.Bone();
  public readonly chest = new THREE.Bone();
  public readonly neck = new THREE.Bone();
  public readonly head = new THREE.Bone();

  public readonly upperArmL = new THREE.Bone();
  public readonly forearmL = new THREE.Bone();
  public readonly upperArmR = new THREE.Bone();
  public readonly forearmR = new THREE.Bone();

  public readonly thighL = new THREE.Bone();
  public readonly shinL = new THREE.Bone();
  public readonly footL = new THREE.Bone();

  public readonly thighR = new THREE.Bone();
  public readonly shinR = new THREE.Bone();
  public readonly footR = new THREE.Bone();

  private waterUniforms: HumanWaterUniforms | null = null;
  private animPhase = Math.random() * Math.PI * 2;
  private lastStepHalf = -1;
  private lastStrokeHalf = -1;
  private wetLevel = -2.0;

  private readonly _footPos = new THREE.Vector3();

  constructor(appearance: HumanAppearance) {
    this.appearance = appearance;
    const scale = appearance.height / 1.75;

    const isFemale = appearance.gender === 'female';

    const skinMat = this.createHumanMaterial(appearance.skinHex, 0.48, 0.0, 0);
    const primaryMat = this.createHumanMaterial(appearance.primaryColor, 0.84, 0.01, 1);
    const secondaryMat = this.createHumanMaterial(appearance.secondaryColor, 0.86, 0.01, 1);
    const hairMat = this.createHumanMaterial(appearance.hairHex, 0.56, 0.03, 2);
    const eyeWhiteMat = this.createHumanMaterial(0xf8f8f8, 0.14, 0.02, 3);
    const pupilMat = this.createHumanMaterial(0x181513, 0.08, 0.05, 3);
    const catchlightMat = this.createHumanMaterial(0xffffff, 0.05, 0.1, 3);
    const lipMat = this.createHumanMaterial(
      new THREE.Color(appearance.skinHex).lerp(new THREE.Color(0xb85c5c), 0.34).getHex(),
      0.38,
      0.0,
      0
    );

    // ==================== HIPS / PELVIS ====================
    this.hips.position.set(0, 0.95, 0);
    this.root.add(this.hips);

    const hipW = isFemale ? 0.185 : 0.168;
    const waistW = isFemale ? 0.132 : 0.152;
    const chestW = isFemale ? 0.172 : 0.205;
    const chestD = isFemale ? 0.118 : 0.128;

    const pelvisMat =
      appearance.outfitStyle === 'boardshorts' ||
      appearance.outfitStyle === 'rashguard' ||
      appearance.outfitStyle === 'linen_shirt' ||
      appearance.outfitStyle === 'onepiece' ||
      appearance.outfitStyle === 'bikini'
        ? primaryMat
        : skinMat;

    const pelvisGeo = createAnatomicalLoft([
      { y: -0.098, rx: hipW * 0.86, rz: 0.106, zOffset: -0.01 },
      { y: -0.01, rx: hipW, rz: 0.118, zOffset: -0.008 },
      { y: 0.06, rx: hipW * 0.94, rz: 0.110, zOffset: -0.004 },
      { y: 0.115, rx: waistW * 1.03, rz: 0.097, zOffset: 0.0 }
    ], 12, true, 'pelvis');
    const pelvisMesh = new THREE.Mesh(pelvisGeo, pelvisMat);
    pelvisMesh.castShadow = true;
    pelvisMesh.receiveShadow = true;
    this.hips.add(pelvisMesh);

    // Waistband + boardshort front drawstring tie (offset outward cleanly, zero z-fighting!)
    if (appearance.outfitStyle === 'boardshorts' || appearance.outfitStyle === 'linen_shirt') {
      const bandGeo = new THREE.TorusGeometry(waistW * 1.02, 0.012, 7, 18);
      bandGeo.rotateX(Math.PI / 2);
      bandGeo.scale(1.0, 1.0, 0.72);
      const band = new THREE.Mesh(bandGeo, secondaryMat);
      band.position.y = 0.112;
      this.hips.add(band);

      if (appearance.outfitStyle === 'boardshorts') {
        for (const side of [-1, 1]) {
          const cord = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.068, 0.009), secondaryMat);
          cord.position.set(side * 0.014, 0.075, 0.108);
          cord.rotation.z = side * 0.18;
          this.hips.add(cord);
        }
      }
    }

    // ==================== SPINE & TORSO (ZERO OVERLAP / ZERO Z-FIGHTING!) ====================
    this.spine.position.set(0, 0.12, 0);
    this.hips.add(this.spine);

    const midTorsoMat =
      appearance.outfitStyle === 'rashguard' || appearance.outfitStyle === 'onepiece'
        ? primaryMat
        : appearance.outfitStyle === 'linen_shirt'
          ? secondaryMat
          : skinMat;

    // Bottom ring inset cleanly inside pelvis (0.91x) and top ring inset cleanly inside chest (0.91x)
    // so bending/twisting during walking NEVER produces coplanar skin Z-fighting!
    const abdomenGeo = createAnatomicalLoft([
      { y: -0.015, rx: waistW * 0.91, rz: 0.088 },
      { y: 0.015, rx: waistW * 0.98, rz: 0.096, zOffset: 0.003 },
      { y: 0.095, rx: waistW * 0.99, rz: 0.099, zOffset: 0.005 },
      { y: 0.165, rx: chestW * 0.87, rz: chestD * 0.91, zOffset: 0.007 },
      { y: 0.195, rx: chestW * 0.80, rz: chestD * 0.84, zOffset: 0.006 }
    ]);
    const abdomenMesh = new THREE.Mesh(abdomenGeo, midTorsoMat);
    abdomenMesh.castShadow = true;
    abdomenMesh.receiveShadow = true;
    this.spine.add(abdomenMesh);

    // ==================== CHEST & SHOULDERS ====================
    this.chest.position.set(0, 0.175, 0);
    this.spine.add(this.chest);

    const upperTorsoMat =
      appearance.outfitStyle === 'rashguard' || appearance.outfitStyle === 'onepiece'
        ? primaryMat
        : appearance.outfitStyle === 'linen_shirt'
          ? secondaryMat
          : skinMat;

    const chestGeo = createAnatomicalLoft([
      { y: -0.012, rx: chestW * 0.89, rz: chestD * 0.93, zOffset: 0.006 },
      { y: 0.085, rx: chestW * 1.03, rz: chestD * 1.01, zOffset: 0.012 },
      { y: 0.19, rx: chestW * 0.99, rz: chestD * 0.87, zOffset: 0.004 },
      { y: 0.25, rx: 0.112, rz: 0.074, zOffset: -0.004 }
    ], 12, true, 'chest');
    const chestMesh = new THREE.Mesh(chestGeo, upperTorsoMat);
    chestMesh.castShadow = true;
    chestMesh.receiveShadow = true;
    this.chest.add(chestMesh);

    // Swimwear bikini top, linen shirt placket + buttons + pocket, or rashguard athletic trim
    if (appearance.outfitStyle === 'bikini') {
      const topGeo = createAnatomicalLoft([
        { y: 0.032, rx: chestW * 1.05, rz: chestD * 1.07, zOffset: 0.014 },
        { y: 0.125, rx: chestW * 1.08, rz: chestD * 1.11, zOffset: 0.018 },
        { y: 0.172, rx: chestW * 1.02, rz: chestD * 1.01, zOffset: 0.01 }
      ], 10);
      const topMesh = new THREE.Mesh(topGeo, secondaryMat);
      topMesh.castShadow = true;
      this.chest.add(topMesh);

      for (const side of [-1, 1]) {
        const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.010, 0.16, 5), secondaryMat);
        strap.position.set(side * 0.075, 0.21, 0.045);
        strap.rotation.z = side * 0.32;
        strap.rotation.x = -0.35;
        this.chest.add(strap);
      }
    } else if (appearance.outfitStyle === 'onepiece') {
      for (const side of [-1, 1]) {
        const strap = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.11, 0.13), primaryMat);
        strap.position.set(side * 0.095, 0.22, 0.005);
        this.chest.add(strap);
      }
    } else if (appearance.outfitStyle === 'linen_shirt') {
      // Tailored open resort collar + front button placket + pearl buttons + chest pocket
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.086, 0.018, 5, 12, Math.PI * 1.3), secondaryMat);
      collar.rotation.x = Math.PI / 2 + 0.22;
      collar.rotation.z = -Math.PI * 0.65;
      collar.position.set(0, 0.23, 0.015);
      this.chest.add(collar);

      const placket = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.22, 0.012), secondaryMat);
      placket.position.set(0, 0.075, chestD * 1.03 + 0.008);
      this.chest.add(placket);

      const btnMat = this.createHumanMaterial(0xf7f1e3, 0.25, 0.1, 3);
      for (const by of [0.01, 0.075, 0.14]) {
        const btn = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.010, 0.008), btnMat);
        btn.position.set(0, by, chestD * 1.05 + 0.012);
        this.chest.add(btn);
      }

      const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.074, 0.010), primaryMat);
      pocket.position.set(0.078, 0.11, chestD * 0.99 + 0.008);
      pocket.rotation.y = 0.24;
      this.chest.add(pocket);
    } else if (appearance.outfitStyle === 'rashguard' && !appearance.isLifeguard) {
      // Flush contoured athletic chest stripe hugging the torso loft seamlessly (ZERO sticking-out box!)
      const stripeGeo = createAnatomicalLoft([
        { y: 0.086, rx: chestW * 1.045, rz: chestD * 1.028, zOffset: 0.012 },
        { y: 0.122, rx: chestW * 1.042, rz: chestD * 1.010, zOffset: 0.011 }
      ], 12, false, 'chest');
      const stripe = new THREE.Mesh(stripeGeo, secondaryMat);
      this.chest.add(stripe);
    }

    // ==================== NECK & SCULPTED EXPRESSIVE FACE ====================
    this.neck.position.set(0, 0.24, 0.0);
    this.chest.add(this.neck);

    const neckGeo = createAnatomicalLoft([
      { y: -0.015, rx: 0.052, rz: 0.054 },
      { y: 0.048, rx: 0.044, rz: 0.047 },
      { y: 0.108, rx: 0.046, rz: 0.049 }
    ], 10);
    const neckMesh = new THREE.Mesh(neckGeo, skinMat);
    neckMesh.castShadow = true;
    this.neck.add(neckMesh);

    this.head.position.set(0, 0.096, 0.010);
    this.neck.add(this.head);

    // Sculpted human cranium, tapered jawline, cheekbones & subtle orbital recesses
    const headGeo = createAnatomicalLoft([
      { y: 0.002, rx: 0.040, rz: 0.054, zOffset: 0.020 }, // Soft tapered chin
      { y: 0.042, rx: 0.068, rz: 0.082, zOffset: 0.012 }, // Jawline
      { y: 0.098, rx: 0.084, rz: 0.096, zOffset: 0.003 }, // Cheekbones
      { y: 0.158, rx: 0.086, rz: 0.099, zOffset: -0.003 }, // Brow / temples
      { y: 0.208, rx: 0.070, rz: 0.084, zOffset: -0.008 }, // Crown
      { y: 0.232, rx: 0.024, rz: 0.030, zOffset: -0.008 }
    ], 11, true, 'head');
    const headMesh = new THREE.Mesh(headGeo, skinMat);
    headMesh.castShadow = true;
    headMesh.receiveShadow = true;
    this.head.add(headMesh);

    // Soft sculpted ears
    const earGeo = new THREE.SphereGeometry(0.019, 5, 4);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(earGeo, skinMat);
      ear.position.set(side * 0.083, 0.106, -0.008);
      ear.scale.set(0.42, 1.15, 0.72);
      this.head.add(ear);
    }

    // Natural sculpted nose bridge + rounded tip (replaces pointy cone!)
    const noseBridge = new THREE.Mesh(new THREE.CapsuleGeometry(0.0075, 0.028, 1, 4), skinMat);
    noseBridge.position.set(0, 0.106, 0.094);
    noseBridge.rotation.x = -0.22;
    this.head.add(noseBridge);
    const noseTip = new THREE.Mesh(new THREE.SphereGeometry(0.0105, 5, 4), skinMat);
    noseTip.position.set(0, 0.091, 0.102);
    noseTip.scale.set(1.18, 0.78, 0.92);
    this.head.add(noseTip);

    // Sculpted natural smiling upper & lower lips
    const upperLip = new THREE.Mesh(new THREE.CapsuleGeometry(0.0048, 0.024, 1, 4), lipMat);
    upperLip.rotation.z = Math.PI / 2;
    upperLip.position.set(0, 0.062, 0.0905);
    this.head.add(upperLip);
    const lowerLip = new THREE.Mesh(new THREE.CapsuleGeometry(0.0056, 0.020, 1, 4), lipMat);
    lowerLip.rotation.z = Math.PI / 2;
    lowerLip.position.set(0, 0.055, 0.0895);
    this.head.add(lowerLip);

    // Expressive realistic eyes: sclera, upper eyelid fold, colored iris, pupil, glossy catchlight, curved lashes & brow arches
    const irisPalette = [0x3b6e8c, 0x5c4328, 0x3b7252, 0x735235, 0x4b627a];
    const irisHex = irisPalette[Math.abs(Math.round(appearance.skinHex + appearance.hairHex)) % irisPalette.length];
    const irisMat = this.createHumanMaterial(irisHex, 0.10, 0.05, 3);
    const eyelidMat = this.createHumanMaterial(
      new THREE.Color(appearance.skinHex).multiplyScalar(0.92).getHex(),
      0.50,
      0.0,
      0
    );
    const eyeGeo = new THREE.SphereGeometry(0.0145, 5, 4);
    const irisGeo = new THREE.SphereGeometry(0.0096, 5, 4);
    const pupilGeo = new THREE.BoxGeometry(0.0072, 0.0072, 0.004);
    const glintGeo = new THREE.BoxGeometry(0.0028, 0.0028, 0.0026);
    const lidGeo = new THREE.BoxGeometry(0.026, 0.0065, 0.008);
    const lashGeo = new THREE.BoxGeometry(0.025, 0.0032, 0.005);
    const browGeo = new THREE.BoxGeometry(0.029, 0.0055, 0.006);
    for (const side of [-1, 1]) {
      const eyeX = side * 0.0315;
      const eyeY = 0.123;
      const eyeZ = 0.0845;

      const eye = new THREE.Mesh(eyeGeo, eyeWhiteMat);
      eye.position.set(eyeX, eyeY, eyeZ);
      eye.scale.set(1.06, 0.72, 0.62);
      this.head.add(eye);

      const iris = new THREE.Mesh(irisGeo, irisMat);
      iris.position.set(eyeX, eyeY, eyeZ + 0.0068);
      iris.scale.set(1.0, 0.96, 0.48);
      this.head.add(iris);

      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.set(eyeX, eyeY, eyeZ + 0.0096);
      this.head.add(pupil);

      const glint = new THREE.Mesh(glintGeo, catchlightMat);
      glint.position.set(eyeX + 0.0036, eyeY + 0.0032, eyeZ + 0.0114);
      this.head.add(glint);

      // Soft upper eyelid crease hugging top of eye
      const lid = new THREE.Mesh(lidGeo, eyelidMat);
      lid.rotation.z = -side * 0.12;
      lid.position.set(eyeX, eyeY + 0.0095, eyeZ + 0.0065);
      this.head.add(lid);

      const lash = new THREE.Mesh(lashGeo, pupilMat);
      lash.rotation.z = -side * 0.10;
      lash.position.set(eyeX, eyeY + 0.0072, eyeZ + 0.0092);
      this.head.add(lash);

      const brow = new THREE.Mesh(browGeo, hairMat);
      brow.rotation.z = -side * 0.14;
      brow.position.set(eyeX, eyeY + 0.021, eyeZ + 0.0075);
      this.head.add(brow);
    }

    // Styled sculpted hair
    this.buildHair(appearance.hairStyle, hairMat);

    // Optional stylish summer sunglasses, hats, lifeguard kit, snorkel gear, jewelry & watch
    if (appearance.sunglasses && !appearance.snorkelGear) {
      this.buildSunglasses();
    }
    if (appearance.sunHat) {
      this.buildSunHat(appearance.primaryColor);
    } else if (appearance.baseballCap || appearance.isLifeguard) {
      this.buildBaseballCap(appearance.isLifeguard ? 0xe63946 : appearance.primaryColor);
    }
    if (appearance.snorkelGear) {
      this.buildSnorkelMask(appearance.secondaryColor);
    }
    if (appearance.isLifeguard) {
      this.buildLifeguardKit();
    } else if (appearance.necklace) {
      const neckBead = new THREE.Mesh(
        new THREE.TorusGeometry(0.066, 0.006, 5, 14),
        new THREE.MeshStandardMaterial({ color: 0xf6eed8, roughness: 0.45 })
      );
      neckBead.rotation.x = Math.PI / 2 + 0.35;
      neckBead.position.set(0, 0.225, 0.025);
      this.chest.add(neckBead);
    }

    // ==================== ARMS ====================
    // Tuck shoulder pivot smoothly inside sculpted clavicle/deltoid line (no detached ball-joints)
    const shoulderX = chestW * 0.89;
    const sleeveMat =
      appearance.outfitStyle === 'rashguard'
        ? primaryMat
        : appearance.outfitStyle === 'linen_shirt'
          ? secondaryMat
          : skinMat;

    this.buildArm(this.upperArmL, this.forearmL, -1, shoulderX, skinMat, sleeveMat, isFemale);
    this.buildArm(this.upperArmR, this.forearmR, 1, shoulderX, skinMat, sleeveMat, isFemale);

    // ==================== LEGS ====================
    const hipLegX = hipW * 0.56;
    const shortsLength =
      appearance.outfitStyle === 'boardshorts' ||
      appearance.outfitStyle === 'rashguard' ||
      appearance.outfitStyle === 'linen_shirt'
        ? 0.24
        : 0.0;

    this.buildLeg(this.thighL, this.shinL, this.footL, -1, hipLegX, skinMat, primaryMat, shortsLength, isFemale);
    this.buildLeg(this.thighR, this.shinR, this.footR, 1, hipLegX, skinMat, primaryMat, shortsLength, isFemale);

    // Bake entire articulated rig into 1 SkinnedMesh draw call at identity root scale, then apply scale
    this.bakeSkinnedCharacter();
    this.root.scale.setScalar(scale);
  }

  private createHumanMaterial(colorHex: number, roughness: number, metalness: number, matType = 1): THREE.Material {
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness,
      metalness
    });
    mat.userData.matType = matType;
    return mat;
  }

  private createSkinnedCharacterMaterial(): THREE.Material {
    if (!this.appearance.useWaterCaustics) {
      return SHARED_LAND_HUMAN_MAT;
    }

    const uniforms: HumanWaterUniforms = {
      uTime: { value: 0 },
      uWaterHeight: { value: 0 },
      uWetHeight: { value: -2.0 },
      uSunDirection: { value: new THREE.Vector3(0.35, 0.72, 0.58).normalize() },
      uSunColor: { value: new THREE.Color(0xfff4dd) }
    };
    this.waterUniforms = uniforms;

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      normalMap: HUMAN_DETAIL_NORMAL,
      normalScale: new THREE.Vector2(0.18, 0.18),
      roughness: 0.62,
      metalness: 0.02
    });
    mat.customProgramCacheKey = () => 'skinned-human-caustics-pbr-v3';
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uWaterHeight = uniforms.uWaterHeight;
      shader.uniforms.uWetHeight = uniforms.uWetHeight;
      shader.uniforms.uSunDirection = uniforms.uSunDirection;
      shader.uniforms.uSunColor = uniforms.uSunColor;

      shader.vertexShader =
        'attribute vec2 aMatProps;\nvarying vec2 vMatProps;\nvarying vec3 vHumanWorldPos;\nvarying vec3 vHumanWorldNormal;\n' +
        shader.vertexShader
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
             vMatProps = aMatProps;`
          )
          .replace(
            '#include <worldpos_vertex>',
            `#include <worldpos_vertex>
             vHumanWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
             vHumanWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`
          );

      shader.fragmentShader =
        `uniform float uTime;
         uniform float uWaterHeight;
         uniform float uWetHeight;
         uniform vec3 uSunDirection;
         uniform vec3 uSunColor;
         varying vec2 vMatProps;
         varying vec3 vHumanWorldPos;
         varying vec3 vHumanWorldNormal;
         ${CAUSTICS_GLSL}
        ` +
        shader.fragmentShader
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
             roughnessFactor = clamp(vMatProps.x, 0.08, 0.96);
             float hWet = smoothstep(uWetHeight + 0.16, uWetHeight - 0.08, vHumanWorldPos.y);
             diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.76, 0.74, 0.72), hWet * 0.52);
             roughnessFactor = mix(roughnessFactor, 0.16, hWet * 0.78);`
          )
          .replace(
            '#include <lights_fragment_end>',
            `#include <lights_fragment_end>
             float matType = vMatProps.y;
             float viewRim = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewPosition)), 0.0), 2.6);
             if (matType < 0.5) {
               reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.105, 0.056, 0.034);
               reflectedLight.directDiffuse += diffuseColor.rgb * vec3(0.14, 0.06, 0.03) * viewRim;
             } else if (matType < 1.5) {
               reflectedLight.indirectDiffuse += vec3(0.12, 0.115, 0.11) * viewRim * (0.4 + 0.6 * diffuseColor.rgb);
             }`
          )
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
             vec3 hCaustics = computeUnderwaterCaustics(vHumanWorldPos, normalize(vHumanWorldNormal), uSunDirection, uWaterHeight, uTime);
             totalEmissiveRadiance += hCaustics * uSunColor * 0.58;`
          );
    };
    return mat;
  }

  private bakeSkinnedCharacter(): void {
    this.root.updateMatrixWorld(true);
    const bones: THREE.Bone[] = [
      this.hips,
      this.spine,
      this.chest,
      this.neck,
      this.head,
      this.upperArmL,
      this.forearmL,
      this.upperArmR,
      this.forearmR,
      this.thighL,
      this.shinL,
      this.footL,
      this.thighR,
      this.shinR,
      this.footR
    ];

    const parentIndexByBone = [-1, 0, 1, 2, 3, 2, 5, 2, 7, 0, 9, 10, 0, 12, 13];
    const boneWorldPos = bones.map((b) => {
      const p = new THREE.Vector3();
      b.getWorldPosition(p);
      return p;
    });

    const parts: THREE.BufferGeometry[] = [];
    const tmpColor = new THREE.Color();
    const tmpVert = new THREE.Vector3();

    for (let boneIdx = 0; boneIdx < bones.length; boneIdx++) {
      const bone = bones[boneIdx];
      const parentIdx = parentIndexByBone[boneIdx];
      const jointPos = boneWorldPos[boneIdx];
      const directStaticChildren: THREE.Object3D[] = [];
      for (const ch of bone.children) {
        if (!(ch instanceof THREE.Bone)) {
          directStaticChildren.push(ch);
        }
      }

      for (const rootChild of directStaticChildren) {
        rootChild.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh)) return;
          const src = obj.geometry;
          const g = src.index ? src.toNonIndexed() : src.clone();
          g.applyMatrix4(obj.matrixWorld);
          if (!g.attributes.normal) {
            g.computeVertexNormals();
          }

          for (const attr of Object.keys(g.attributes)) {
            if (attr !== 'position' && attr !== 'normal' && attr !== 'uv') {
              g.deleteAttribute(attr);
            }
          }
          g.morphAttributes = {};

          const posAttr = g.attributes.position as THREE.BufferAttribute;
          const normAttr = g.attributes.normal as THREE.BufferAttribute;
          const vertCount = posAttr.count;
          if (!g.attributes.uv) {
            const synthUv = new Float32Array(vertCount * 2);
            for (let v = 0; v < vertCount; v++) {
              synthUv[v * 2] = posAttr.getX(v) * 6.0;
              synthUv[v * 2 + 1] = posAttr.getY(v) * 6.0;
            }
            g.setAttribute('uv', new THREE.Float32BufferAttribute(synthUv, 2));
          }
          const srcMat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
          let matRough = 0.72;
          let matType = 1.0;
          if (srcMat && 'color' in srcMat && (srcMat as THREE.MeshStandardMaterial).color) {
            const stdMat = srcMat as THREE.MeshStandardMaterial;
            tmpColor.copy(stdMat.color);
            matRough = typeof stdMat.roughness === 'number' ? stdMat.roughness : 0.72;
            matType =
              typeof stdMat.userData?.matType === 'number'
                ? stdMat.userData.matType
                : matRough <= 0.26
                  ? 3.0
                  : 1.0;
          } else {
            tmpColor.setHex(0xffffff);
          }

          const colors = new Float32Array(vertCount * 3);
          const matProps = new Float32Array(vertCount * 2);
          const skinIndices = new Uint16Array(vertCount * 4);
          const skinWeights = new Float32Array(vertCount * 4);
          for (let v = 0; v < vertCount; v++) {
            tmpVert.fromBufferAttribute(posAttr, v);
            const ny = normAttr.getY(v);
            // Subtle baked anatomical vertical AO + sunlit top-contour warmth (eliminates flat clay shading!)
            const ao = 0.89 + 0.11 * THREE.MathUtils.clamp(ny * 0.5 + 0.5, 0, 1);
            const cOff = v * 3;
            colors[cOff] = Math.min(1, tmpColor.r * ao);
            colors[cOff + 1] = Math.min(1, tmpColor.g * (ao * 0.992));
            colors[cOff + 2] = Math.min(1, tmpColor.b * (ao * 0.985));

            matProps[v * 2] = matRough;
            matProps[v * 2 + 1] = matType;

            const sOff = v * 4;
            // Smooth dual-bone joint weight blending near limb/torso seams (zero wooden-doll joint cracks!)
            const dJoint = tmpVert.distanceTo(jointPos);
            const blendRadius = boneIdx >= 5 ? 0.088 : 0.068;
            if (parentIdx >= 0 && dJoint < blendRadius) {
              const wParent = 0.44 * (1.0 - dJoint / blendRadius);
              skinIndices[sOff] = boneIdx;
              skinIndices[sOff + 1] = parentIdx;
              skinWeights[sOff] = 1.0 - wParent;
              skinWeights[sOff + 1] = wParent;
            } else {
              skinIndices[sOff] = boneIdx;
              skinWeights[sOff] = 1.0;
            }
          }

          g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
          g.setAttribute('aMatProps', new THREE.Float32BufferAttribute(matProps, 2));
          g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
          g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
          parts.push(g);
        });
        bone.remove(rootChild);
      }
    }

    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    if (!merged) return;

    // Generous rest bounding sphere covers reclining, seated & swimming poses cleanly without per-frame recompute
    merged.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 2.4);

    const charMat = this.createSkinnedCharacterMaterial();
    const skinned = new THREE.SkinnedMesh(merged, charMat);
    skinned.castShadow = true;
    skinned.receiveShadow = true;
    skinned.name = 'SkinnedHumanCharacter';
    this.root.add(skinned);
    this.root.updateMatrixWorld(true);
    skinned.bind(new THREE.Skeleton(bones));
  }

  private buildHair(style: HairStyle, mat: THREE.Material): void {
    // Full-coverage outer hair dome with guaranteed +12mm clearance over cranium so ZERO skin clips through!
    const domeGeo = createAnatomicalLoft([
      { y: 0.132, rx: 0.096, rz: 0.108, zOffset: -0.012 }, // Hairline above brows & nape
      { y: 0.172, rx: 0.099, rz: 0.114, zOffset: -0.008 }, // Temples & upper back
      { y: 0.214, rx: 0.084, rz: 0.098, zOffset: -0.008 }, // Upper crown
      { y: 0.244, rx: 0.046, rz: 0.054, zOffset: -0.008 }, // Top dome
      { y: 0.252, rx: 0.008, rz: 0.010, zOffset: -0.008 }
    ], 10);
    const dome = new THREE.Mesh(domeGeo, mat);
    dome.castShadow = true;
    dome.receiveShadow = true;
    this.head.add(dome);

    // Clean back-of-head nape volume (covers occipital curve smoothly behind ears)
    const napeGeo = new THREE.SphereGeometry(0.094, 8, 6, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.28, Math.PI * 0.56);
    const nape = new THREE.Mesh(napeGeo, mat);
    nape.position.set(0, 0.138, -0.022);
    nape.rotation.y = Math.PI;
    nape.scale.set(1.02, 1.04, 1.05);
    this.head.add(nape);

    const topSweep = style === 'short_crop' ? new THREE.Mesh(new THREE.SphereGeometry(0.088, 8, 6), mat) : null;
    if (topSweep) {
      topSweep.position.set(0, 0.218, 0.012);
      topSweep.scale.set(1.04, 0.56, 1.12);
      this.head.add(topSweep);
    } else if (style === 'surfer_waves') {
      // Sculpted layered surfer flow sitting cleanly outside the hair dome
      const waveCrown = new THREE.Mesh(new THREE.SphereGeometry(0.096, 8, 6), mat);
      waveCrown.position.set(0, 0.208, -0.005);
      waveCrown.scale.set(1.06, 0.64, 1.15);
      this.head.add(waveCrown);

      for (let i = 0; i < 6; i++) {
        const ang = (i - 2.5) * 0.44;
        const lock = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.072, 2, 5), mat);
        lock.position.set(
          Math.sin(ang) * 0.092,
          0.168 - Math.abs(i - 2.5) * 0.008,
          -0.018 + Math.cos(ang) * 0.055
        );
        lock.rotation.set(0.32, ang, -ang * 0.28);
        this.head.add(lock);
      }
    } else if (style === 'ponytail') {
      const tailGeo = createAnatomicalLoft([
        { y: 0.0, rx: 0.024, rz: 0.024 },
        { y: -0.08, rx: 0.044, rz: 0.042, zOffset: -0.032 },
        { y: -0.19, rx: 0.035, rz: 0.033, zOffset: -0.052 },
        { y: -0.27, rx: 0.012, rz: 0.012, zOffset: -0.064 }
      ], 9);
      const tail = new THREE.Mesh(tailGeo, mat);
      tail.position.set(0, 0.175, -0.122);
      tail.castShadow = true;
      this.head.add(tail);
    } else if (style === 'long_wavy') {
      const drapeGeo = createAnatomicalLoft([
        { y: -0.22, rx: 0.106, rz: 0.054, zOffset: -0.048 },
        { y: -0.10, rx: 0.114, rz: 0.072, zOffset: -0.046 },
        { y: 0.02, rx: 0.110, rz: 0.084, zOffset: -0.036 },
        { y: 0.12, rx: 0.100, rz: 0.094, zOffset: -0.024 }
      ], 11);
      const drape = new THREE.Mesh(drapeGeo, mat);
      drape.position.set(0, 0.05, -0.014);
      drape.castShadow = true;
      this.head.add(drape);
    } else if (style === 'top_bun') {
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.056, 8, 6), mat);
      bun.position.set(0, 0.278, -0.036);
      bun.scale.set(1.06, 0.88, 1.06);
      this.head.add(bun);
    } else if (style === 'curly_crown') {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const puff = new THREE.Mesh(new THREE.SphereGeometry(0.048, 6, 5), mat);
        puff.position.set(Math.cos(a) * 0.070, 0.212 + (i % 2) * 0.022, Math.sin(a) * 0.074 - 0.014);
        this.head.add(puff);
      }
    }
  }

  private buildSunglasses(): void {
    const frameMat = this.createHumanMaterial(0x181b20, 0.18, 0.45, 3);
    const lensMat = this.createHumanMaterial(0x0b1f2e, 0.06, 0.55, 3);
    const glasses = new THREE.Group();
    glasses.position.set(0, 0.123, 0.094);
    for (const side of [-1, 1]) {
      // Rounded wayfarer rim & flush reflective lens wrapping subtly around the cheek/brow curve
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.019, 0.007, 7), frameMat);
      rim.rotation.x = Math.PI / 2;
      rim.rotation.z = -side * 0.18;
      rim.scale.set(1.12, 1.0, 0.86);
      rim.position.set(side * 0.033, 0, -0.002);
      glasses.add(rim);

      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.0175, 0.016, 0.0085, 7), lensMat);
      lens.rotation.x = Math.PI / 2;
      lens.rotation.z = -side * 0.18;
      lens.scale.set(1.10, 1.0, 0.84);
      lens.position.set(side * 0.033, 0, -0.001);
      glasses.add(lens);

      const temple = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.004, 0.076), frameMat);
      temple.position.set(side * 0.058, 0.003, -0.044);
      glasses.add(temple);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.004, 0.005), frameMat);
    bridge.position.set(0, 0.005, 0.002);
    glasses.add(bridge);
    this.head.add(glasses);
  }

  private buildSunHat(ribbonHex: number): void {
    const strawMat = new THREE.MeshStandardMaterial({ color: 0xdec08a, roughness: 0.92 });
    const ribbonMat = new THREE.MeshStandardMaterial({ color: ribbonHex, roughness: 0.7 });
    const hat = new THREE.Group();
    hat.position.set(0, 0.215, -0.008);
    hat.rotation.x = -0.08;

    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.014, 22), strawMat);
    brim.castShadow = true;
    hat.add(brim);

    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.115, 0.095, 18), strawMat);
    crown.position.y = 0.048;
    crown.castShadow = true;
    hat.add(crown);

    const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(0.116, 0.118, 0.022, 18), ribbonMat);
    ribbon.position.y = 0.016;
    hat.add(ribbon);

    this.head.add(hat);
  }

  private buildBaseballCap(capHex: number): void {
    const capMat = new THREE.MeshStandardMaterial({ color: capHex, roughness: 0.72 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65 });
    const cap = new THREE.Group();
    cap.position.set(0, 0.195, -0.004);
    cap.rotation.x = -0.06;

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.104, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.54),
      capMat
    );
    dome.scale.set(0.98, 0.92, 1.08);
    cap.add(dome);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.012, 0.115), capMat);
    visor.position.set(0, 0.008, 0.108);
    visor.rotation.x = 0.14;
    cap.add(visor);

    const emblem = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.024, 0.008), trimMat);
    emblem.position.set(0, 0.044, 0.108);
    cap.add(emblem);
    this.head.add(cap);
  }

  private buildSnorkelMask(accentHex: number): void {
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x1b222a, roughness: 0.45 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x6ce5f5, roughness: 0.12, metalness: 0.25 });
    const tubeMat = new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.4 });
    const tipMat = new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.35 });

    const mask = new THREE.Group();
    mask.position.set(0, 0.124, 0.098);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.112, 0.048, 0.026), rimMat);
    mask.add(frame);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.098, 0.036, 0.029), glassMat);
    mask.add(lens);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.096, 0.009, 5, 14), rimMat);
    strap.rotation.x = Math.PI / 2;
    strap.position.set(0, 0.006, -0.098);
    mask.add(strap);

    // J-shaped snorkel tube rising up along right temple with bright safety-orange top tip
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.30, 7), tubeMat);
    tube.position.set(0.088, 0.09, -0.012);
    tube.rotation.z = -0.08;
    mask.add(tube);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.012, 0.055, 7), tipMat);
    tip.position.set(0.10, 0.24, -0.012);
    mask.add(tip);
    const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.09, 6), rimMat);
    mouth.rotation.z = Math.PI / 2;
    mouth.position.set(0.044, -0.055, -0.004);
    mask.add(mouth);

    this.head.add(mask);
  }

  private buildLifeguardKit(): void {
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 });
    const redBuoyMat = new THREE.MeshStandardMaterial({ color: 0xe63946, roughness: 0.32 });
    const strapMat = new THREE.MeshStandardMaterial({ color: 0x1e252d, roughness: 0.72 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xe6bc55, roughness: 0.28, metalness: 0.8 });

    // Authentic white Lifeguard Cross emblem on front & back of red rashguard
    for (const zSign of [1, -1]) {
      const zOff = zSign > 0 ? 0.132 : -0.126;
      const barH = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.024, 0.012), whiteMat);
      barH.position.set(0, 0.11, zOff);
      this.chest.add(barH);
      const barV = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.085, 0.012), whiteMat);
      barV.position.set(0, 0.11, zOff);
      this.chest.add(barV);
    }

    // Lanyard & brass whistle hanging cleanly on chest
    const cord = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.005, 5, 14), strapMat);
    cord.rotation.x = Math.PI / 2 + 0.52;
    cord.position.set(0, 0.20, 0.045);
    this.chest.add(cord);
    const whistle = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.010, 0.036, 6), brassMat);
    whistle.rotation.z = Math.PI / 2;
    whistle.position.set(0, 0.135, 0.138);
    this.chest.add(whistle);

    // Classic bright red Lifeguard Rescue Torpedo Buoy carried in left hand!
    const buoy = new THREE.Group();
    buoy.position.set(-0.04, -0.31, 0.05);
    buoy.rotation.set(0.55, 0.12, 0.18);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.44, 5, 8), redBuoyMat);
    body.scale.set(0.75, 1.0, 1.15);
    buoy.add(body);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.011, 5, 10), strapMat);
    handle.position.set(0.055, 0.0, 0);
    buoy.add(handle);
    this.forearmL.add(buoy);
  }

  private buildArm(
    upperPivot: THREE.Bone,
    forearmPivot: THREE.Bone,
    side: -1 | 1,
    shoulderX: number,
    skinMat: THREE.Material,
    sleeveMat: THREE.Material,
    isFemale: boolean
  ): void {
    const rScale = isFemale ? 0.86 : 1.0;
    upperPivot.position.set(side * shoulderX, 0.185, 0.0);
    this.chest.add(upperPivot);

    // Smooth tapered deltoid/upper-arm loft starting seamlessly inside chest clavicle (no wooden ball-joints!)
    const upperGeo = createAnatomicalLoft([
      { y: -0.305, rx: 0.038 * rScale, rz: 0.039 * rScale },
      { y: -0.17, rx: 0.046 * rScale, rz: 0.048 * rScale },
      { y: -0.025, rx: 0.053 * rScale, rz: 0.054 * rScale, xOffset: -side * 0.008 },
      { y: 0.038, rx: 0.044 * rScale, rz: 0.046 * rScale, xOffset: -side * 0.024 }
    ], 8);
    const upperMesh = new THREE.Mesh(upperGeo, sleeveMat !== skinMat ? skinMat : skinMat);
    upperMesh.castShadow = true;
    upperMesh.receiveShadow = true;
    upperPivot.add(upperMesh);

    // Short sleeve overlay if wearing rashguard/shirt
    if (sleeveMat !== skinMat) {
      const sleeveGeo = createAnatomicalLoft([
        { y: -0.155, rx: 0.053 * rScale, rz: 0.055 * rScale },
        { y: -0.02, rx: 0.058 * rScale, rz: 0.060 * rScale, xOffset: -side * 0.008 },
        { y: 0.040, rx: 0.047 * rScale, rz: 0.048 * rScale, xOffset: -side * 0.024 }
      ], 8);
      const sleeve = new THREE.Mesh(sleeveGeo, sleeveMat);
      sleeve.castShadow = true;
      upperPivot.add(sleeve);
    }

    // Elbow & Forearm (seamless overlapping top collar blended by dual-bone skinning!)
    forearmPivot.position.set(0, -0.29, 0);
    upperPivot.add(forearmPivot);

    const foreGeo = createAnatomicalLoft([
      { y: -0.265, rx: 0.026 * rScale, rz: 0.024 * rScale },
      { y: -0.14, rx: 0.036 * rScale, rz: 0.035 * rScale },
      { y: -0.015, rx: 0.040 * rScale, rz: 0.039 * rScale },
      { y: 0.022, rx: 0.034 * rScale, rz: 0.035 * rScale }
    ], 8);
    const foreMesh = new THREE.Mesh(foreGeo, skinMat);
    foreMesh.castShadow = true;
    foreMesh.receiveShadow = true;
    forearmPivot.add(foreMesh);

    // Optional beach wristwatch with metallic dial face on left wrist
    if (side === -1 && this.appearance.watch) {
      const watchBand = new THREE.Mesh(
        new THREE.CylinderGeometry(0.030 * rScale, 0.030 * rScale, 0.024, 8),
        this.createHumanMaterial(0x222933, 0.45, 0.1, 1)
      );
      watchBand.position.set(0, -0.245, 0);
      forearmPivot.add(watchBand);
      const watchFace = new THREE.Mesh(
        new THREE.CylinderGeometry(0.014, 0.014, 0.010, 6),
        this.createHumanMaterial(0xdbe8f2, 0.10, 0.5, 3)
      );
      watchFace.rotation.z = Math.PI / 2;
      watchFace.position.set(-0.028 * rScale, -0.245, 0.005);
      forearmPivot.add(watchFace);
    }

    // Smooth sculpted organic hand: tapered oval palm -> slender rounded fingers + smooth angled thumb (ZERO cube blocks!)
    const handGeo = createAnatomicalLoft([
      { y: -0.362, rx: 0.011 * rScale, rz: 0.022 * rScale, xOffset: -side * 0.006, zOffset: 0.012 }, // Tapered fingertips
      { y: -0.322, rx: 0.014 * rScale, rz: 0.030 * rScale, xOffset: -side * 0.003, zOffset: 0.010 }, // Mid-fingers
      { y: -0.286, rx: 0.017 * rScale, rz: 0.032 * rScale, zOffset: 0.006 },                         // Palm
      { y: -0.258, rx: 0.022 * rScale, rz: 0.022 * rScale }                                          // Wrist blend
    ], 6);
    const handMesh = new THREE.Mesh(handGeo, skinMat);
    forearmPivot.add(handMesh);

    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.0085 * rScale, 0.028 * rScale, 1, 4), skinMat);
    thumb.position.set(-side * 0.008, -0.295, 0.034);
    thumb.rotation.set(0.48, 0, -side * 0.25);
    forearmPivot.add(thumb);
  }

  private buildLeg(
    thighPivot: THREE.Bone,
    shinPivot: THREE.Bone,
    footPivot: THREE.Bone,
    side: -1 | 1,
    hipX: number,
    skinMat: THREE.Material,
    shortsMat: THREE.Material,
    shortsLength: number,
    isFemale: boolean
  ): void {
    const rScale = isFemale ? 0.94 : 1.0;
    thighPivot.position.set(side * hipX, -0.04, 0.0);
    this.hips.add(thighPivot);

    // Sculpted seamless thigh overlapping smoothly into pelvis & knee (no rigid ball spheres!)
    const thighGeo = createAnatomicalLoft([
      { y: -0.455, rx: 0.054 * rScale, rz: 0.056 * rScale },
      { y: -0.24, rx: 0.073 * rScale, rz: 0.076 * rScale, zOffset: 0.004 },
      { y: -0.02, rx: 0.083 * rScale, rz: 0.085 * rScale },
      { y: 0.045, rx: 0.072 * rScale, rz: 0.076 * rScale }
    ], 8);
    const thighMesh = new THREE.Mesh(thighGeo, skinMat);
    thighMesh.castShadow = true;
    thighMesh.receiveShadow = true;
    thighPivot.add(thighMesh);

    // Boardshorts leg sleeve overlapping smoothly up into pelvis (ZERO hip/thigh skin slit when walking!)
    if (shortsLength > 0) {
      const legShortGeo = createAnatomicalLoft([
        { y: -shortsLength, rx: 0.081 * rScale, rz: 0.085 * rScale },
        { y: -0.02, rx: 0.090 * rScale, rz: 0.093 * rScale },
        { y: 0.068, rx: 0.088 * rScale, rz: 0.090 * rScale }
      ], 8);
      const legShort = new THREE.Mesh(legShortGeo, shortsMat);
      legShort.castShadow = true;
      legShort.receiveShadow = true;
      thighPivot.add(legShort);
    }

    // Seamless knee & sculpted calf/shin
    shinPivot.position.set(0, -0.44, 0);
    thighPivot.add(shinPivot);

    const shinGeo = createAnatomicalLoft([
      { y: -0.415, rx: 0.034 * rScale, rz: 0.036 * rScale }, // Ankle
      { y: -0.26, rx: 0.049 * rScale, rz: 0.053 * rScale, zOffset: -0.008 }, // Calf peak
      { y: -0.14, rx: 0.056 * rScale, rz: 0.060 * rScale, zOffset: -0.010 },
      { y: -0.015, rx: 0.054 * rScale, rz: 0.056 * rScale },
      { y: 0.030, rx: 0.048 * rScale, rz: 0.050 * rScale }
    ], 8);
    const shinMesh = new THREE.Mesh(shinGeo, skinMat);
    shinMesh.castShadow = true;
    shinMesh.receiveShadow = true;
    shinPivot.add(shinMesh);

    // Bare anatomical beach foot + optional flip-flop sandals OR scuba swim fins!
    footPivot.position.set(0, -0.42, 0.0);
    shinPivot.add(footPivot);

    const footGeo = createAnatomicalLoft([
      { y: -0.05, rx: 0.042, rz: 0.115, zOffset: 0.055 },
      { y: -0.02, rx: 0.044, rz: 0.110, zOffset: 0.050 },
      { y: 0.015, rx: 0.036, rz: 0.065, zOffset: 0.020 }
    ], 8);
    const footMesh = new THREE.Mesh(footGeo, skinMat);
    footMesh.receiveShadow = true;
    footPivot.add(footMesh);

    if (this.appearance.snorkelGear) {
      const finMat = new THREE.MeshStandardMaterial({ color: this.appearance.secondaryColor, roughness: 0.42 });
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.016, 0.34), finMat);
      fin.position.set(0, -0.045, 0.18);
      footPivot.add(fin);
    } else if (this.appearance.sandals) {
      const soleMat = this.createHumanMaterial(this.appearance.secondaryColor, 0.78, 0.0, 1);
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.015, 0.24), soleMat);
      sole.position.set(0, -0.054, 0.055);
      footPivot.add(sole);
      // Authentic V-shaped flip-flop toe straps!
      for (const sSide of [-1, 1]) {
        const strap = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.095), soleMat);
        strap.position.set(sSide * 0.024, -0.014, 0.088);
        strap.rotation.y = -sSide * 0.36;
        strap.rotation.x = 0.30;
        footPivot.add(strap);
      }
    }
  }

  private dampRot(obj: THREE.Object3D, tx: number, ty: number, tz: number, k: number): void {
    obj.rotation.x = THREE.MathUtils.lerp(obj.rotation.x, tx, k);
    obj.rotation.y = THREE.MathUtils.lerp(obj.rotation.y, ty, k);
    obj.rotation.z = THREE.MathUtils.lerp(obj.rotation.z, tz, k);
  }

  /**
   * Updates skeletal animation, smooth pose blending, wet-skin tracking, caustics uniforms,
   * and returns foot-plant or swim-stroke events when triggered.
   */
  public updateAnimation(
    state: HumanAnimState,
    dt: number,
    elapsedTime: number,
    speedNorm: number,
    swimPitch: number,
    waterHeight: number,
    sunDirection: THREE.Vector3,
    sunColor: THREE.Color,
    headLookYaw = 0
  ): { footPlant: FootPlantEvent | null; swimStroke: boolean } {
    const k = 1.0 - Math.exp(-12.0 * dt);
    let footPlant: FootPlantEvent | null = null;
    let swimStroke = false;

    // Track body wetness memory (gets wet immediately in water, dries slowly in sun)
    if (waterHeight > this.root.position.y + 0.05) {
      this.wetLevel = Math.max(this.wetLevel, waterHeight + 0.08);
    } else {
      this.wetLevel = Math.max(this.root.position.y - 0.5, this.wetLevel - 0.04 * dt);
    }

    // Update character caustics & wetness uniforms (only enabled on water-touching characters)
    if (this.waterUniforms) {
      const u = this.waterUniforms;
      u.uTime.value = elapsedTime;
      u.uWaterHeight.value = waterHeight;
      u.uWetHeight.value = this.wetLevel;
      u.uSunDirection.value.copy(sunDirection);
      u.uSunColor.value.copy(sunColor);
    }

    // Advance animation phase based on state
    if (state === 'walk') {
      this.animPhase += dt * (5.2 + speedNorm * 3.8);
    } else if (state === 'run') {
      this.animPhase += dt * (8.6 + speedNorm * 4.0);
    } else if (state === 'wade') {
      this.animPhase += dt * (3.8 + speedNorm * 2.8);
    } else if (state === 'swim_surface' || state === 'swim_underwater') {
      this.animPhase += dt * (4.2 + speedNorm * 3.2);
    } else if (state === 'tread') {
      this.animPhase += dt * 3.1;
    } else if (state === 'dance') {
      this.animPhase += dt * 5.6;
    } else if (state === 'wave') {
      this.animPhase += dt * 4.8;
    } else {
      this.animPhase += dt * 1.65;
    }

    const s = Math.sin(this.animPhase);
    const c = Math.cos(this.animPhase);

    // Target bone rotations
    let hipY = 0.95;
    let hipRx = 0, hipRy = 0, hipRz = 0;
    let spineRx = 0, spineRy = 0, spineRz = 0;
    let chestRx = 0, chestRy = 0;
    let headRx = 0, headRy = 0;
    let uaLx = 0, uaLz = -0.14, faLx = -0.12;
    let uaRx = 0, uaRz = 0.14, faRx = -0.12;
    let thLx = 0, thLz = 0, shLx = 0, ftLx = 0;
    let thRx = 0, thRz = 0, shRx = 0, ftRx = 0;

    if (state === 'idle') {
      const breath = Math.sin(elapsedTime * 1.8 + this.root.id * 0.7);
      hipY = 0.95 + breath * 0.006;
      spineRx = 0.02 + breath * 0.015;
      headRy = Math.sin(elapsedTime * 0.55 + this.root.id) * 0.14;
      uaLz = -0.13 - breath * 0.015;
      uaRz = 0.13 + breath * 0.015;
      faLx = -0.14;
      faRx = -0.14;
    } else if (state === 'chat') {
      const g = Math.sin(elapsedTime * 2.4 + this.root.id);
      const g2 = Math.cos(elapsedTime * 1.7 + this.root.id);
      hipY = 0.95;
      hipRz = 0.04;
      spineRy = g2 * 0.08;
      headRy = Math.sin(elapsedTime * 1.2 + this.root.id) * 0.18;
      headRx = Math.sin(elapsedTime * 2.2) * 0.07;
      uaLx = -0.25 + g * 0.18;
      uaLz = -0.18;
      faLx = -0.62 - g * 0.22;
      uaRx = -0.18 - g2 * 0.14;
      uaRz = 0.16;
      faRx = -0.45 + g2 * 0.15;
    } else if (state === 'walk' || state === 'run' || state === 'wade') {
      const isRun = state === 'run';
      const isWade = state === 'wade';
      const stride = isRun ? 0.78 : isWade ? 0.52 : 0.54;
      const armSwing = isRun ? 0.85 : isWade ? 0.34 : 0.48;
      const bounce = isRun ? 0.055 : 0.026;

      hipY = 0.95 - (isRun ? 0.04 : 0.01) + Math.abs(c) * bounce;
      hipRy = s * 0.10;
      hipRz = -s * 0.045;
      spineRx = isRun ? 0.18 : isWade ? 0.12 : 0.05;
      chestRy = -s * 0.14;

      // Legs
      thLx = s * stride;
      thRx = -s * stride;
      const liftL = Math.max(0, -c) * (isRun ? 1.15 : isWade ? 0.95 : 0.62);
      const liftR = Math.max(0, c) * (isRun ? 1.15 : isWade ? 0.95 : 0.62);
      shLx = liftL + (isRun ? 0.18 : 0.06);
      shRx = liftR + (isRun ? 0.18 : 0.06);
      ftLx = -liftL * 0.35;
      ftRx = -liftR * 0.35;

      // Arms counter-swing (slightly lifted out of water when wading!)
      uaLx = -s * armSwing - (isWade ? 0.25 : 0);
      uaRx = s * armSwing - (isWade ? 0.25 : 0);
      uaLz = isWade ? -0.42 : -0.12;
      uaRz = isWade ? 0.42 : 0.12;
      faLx = isRun ? -1.32 : isWade ? -0.78 : -0.28 - Math.max(0, -s) * 0.28;
      faRx = isRun ? -1.32 : isWade ? -0.78 : -0.28 - Math.max(0, s) * 0.28;

      // Detect exact foot-plant moment (when stride crosses zero going backward)
      const half = Math.floor(this.animPhase / Math.PI);
      if (half !== this.lastStepHalf) {
        this.lastStepHalf = half;
        const isRight = half % 2 === 0;
        const footBone = isRight ? this.footR : this.footL;
        this.root.updateMatrixWorld(true);
        footBone.getWorldPosition(this._footPos);
        footPlant = {
          foot: isRight ? 'right' : 'left',
          worldPos: this._footPos.clone()
        };
      }
    } else if (state === 'tread') {
      // Vertical buoyant treading water
      hipY = 0.88 + Math.sin(this.animPhase * 0.8) * 0.05;
      spineRx = 0.12;
      uaLx = -0.55 + c * 0.32;
      uaRx = -0.55 - c * 0.32;
      uaLz = -0.65 - s * 0.24;
      uaRz = 0.65 - s * 0.24;
      faLx = -0.68;
      faRx = -0.68;
      thLx = -0.42 + s * 0.35;
      thRx = -0.42 - s * 0.35;
      shLx = 0.72 + Math.max(0, -s) * 0.42;
      shRx = 0.72 + Math.max(0, s) * 0.42;
      ftLx = 0.5;
      ftRx = 0.5;
    } else if (state === 'swim_surface' || state === 'swim_underwater') {
      // Streamlined horizontal freestyle / underwater glide aligned to swimPitch
      const isUnder = state === 'swim_underwater';
      hipY = 0.92;
      hipRx = Math.PI * 0.48 - swimPitch * (isUnder ? 0.85 : 0.25);
      hipRz = s * 0.22; // authentic freestyle body roll
      spineRx = -0.08;
      headRx = isUnder ? -0.42 : -0.68; // look forward while swimming!

      // Alternating freestyle arm stroke (or smooth breaststroke sweep underwater)
      if (isUnder && speedNorm < 0.75) {
        // Graceful underwater breaststroke sweep
        const sweep = 0.5 + 0.5 * s;
        uaLx = -2.45 + sweep * 1.45;
        uaRx = -2.45 + sweep * 1.45;
        uaLz = -0.25 - Math.max(0, c) * 0.95;
        uaRz = 0.25 + Math.max(0, c) * 0.95;
        faLx = -0.55 - sweep * 0.45;
        faRx = -0.55 - sweep * 0.45;
      } else {
        // Freestyle alternating crawl stroke
        uaLx = -this.animPhase;
        uaRx = -this.animPhase + Math.PI;
        uaLz = -0.26;
        uaRz = 0.26;
        faLx = -0.45 - Math.max(0, Math.sin(this.animPhase)) * 0.55;
        faRx = -0.45 - Math.max(0, -Math.sin(this.animPhase)) * 0.55;
      }

      // Rhythmic flutter kick
      const kick = Math.sin(this.animPhase * 2.0);
      thLx = kick * 0.36;
      thRx = -kick * 0.36;
      shLx = 0.28 + Math.max(0, -kick) * 0.32;
      shRx = 0.28 + Math.max(0, kick) * 0.32;
      ftLx = 0.65;
      ftRx = 0.65;

      const strokeHalf = Math.floor(this.animPhase / Math.PI);
      if (strokeHalf !== this.lastStrokeHalf) {
        this.lastStrokeHalf = strokeHalf;
        swimStroke = true;
      }
    } else if (state === 'sunbathe') {
      // Lying relaxed on beach towel facing sky
      hipY = 0.14;
      hipRx = -Math.PI * 0.49;
      spineRx = 0.04;
      headRx = 0.18;
      headRy = Math.sin(elapsedTime * 0.35 + this.root.id) * 0.22;
      uaLx = -0.15;
      uaRx = -0.22;
      uaLz = -0.42;
      uaRz = 0.38;
      faLx = -0.25;
      faRx = -0.35;
      // One knee casually bent
      thLx = -0.58;
      shLx = 1.15;
      thRx = -0.05;
      shRx = 0.08;
      thLz = -0.08;
      thRz = 0.08;
    } else if (state === 'lounge') {
      // Seated reclined comfortably against the angled lounge chair backrest & pillow (pelvis ON cushion, arms on armrests!)
      hipY = 0.515;
      hipRx = -0.76;
      spineRx = -0.10;
      headRx = 0.28;
      headRy = Math.sin(elapsedTime * 0.4 + this.root.id) * 0.22;
      uaLx = -0.20;
      uaRx = -0.20;
      uaLz = -0.24;
      uaRz = 0.24;
      faLx = -0.46;
      faRx = -0.46;
      thLx = -0.92;
      thRx = -0.88;
      shLx = 0.14;
      shRx = 0.12;
      ftLx = 0.28;
      ftRx = 0.32;
      thLz = -0.06;
      thRz = 0.06;
    } else if (state === 'sit_bar') {
      // Seated upright FLUSH ON TOP of tall wooden barstool (~0.70m seat) with heels near brass foot rail!
      const g = Math.sin(elapsedTime * 1.9 + this.root.id);
      hipY = 0.720;
      spineRx = 0.05;
      headRy = Math.sin(elapsedTime * 0.9 + this.root.id) * 0.22;
      uaLx = -0.45 + g * 0.12;
      faLx = -0.95;
      uaRx = -0.32 - g * 0.10;
      faRx = -0.78;
      uaLz = -0.14;
      uaRz = 0.14;
      thLx = -1.46;
      thRx = -1.42;
      shLx = 1.48;
      shRx = 1.44;
    } else if (state === 'sit_chair') {
      // Seated squarely on bench, café chair, or picnic bench (~0.45m seat, foot soles flat ON TOP of wood!)
      const g = Math.sin(elapsedTime * 1.65 + this.root.id * 1.3);
      const g2 = Math.cos(elapsedTime * 1.2 + this.root.id);
      hipY = 0.54;
      spineRx = 0.03;
      spineRy = g2 * 0.05;
      headRy = Math.sin(elapsedTime * 0.85 + this.root.id) * 0.24;
      uaLx = -0.34 + g * 0.12;
      faLx = -0.82 - g * 0.08;
      uaRx = -0.26 - g2 * 0.08;
      faRx = -0.68;
      uaLz = -0.15;
      uaRz = 0.15;
      thLx = -1.52;
      thRx = -1.48;
      shLx = 1.48;
      shRx = 1.44;
    } else if (state === 'play_ball') {
      // Energetic playful beach-ball / volleyball jumping, tossing & volleying!
      const hop = Math.max(0, Math.sin(elapsedTime * 3.4 + this.root.id * 1.3));
      const swing = Math.sin(elapsedTime * 3.4 + this.root.id * 1.3);
      hipY = 0.93 + hop * 0.18;
      spineRx = 0.12 - hop * 0.16;
      headRx = -0.22;
      uaLx = -1.45 - hop * 0.95;
      uaRx = -1.45 - hop * 0.95;
      uaLz = -0.24 - swing * 0.14;
      uaRz = 0.24 + swing * 0.14;
      faLx = -0.35 + hop * 0.25;
      faRx = -0.35 + hop * 0.25;
      thLx = -0.24 + hop * 0.32;
      thRx = -0.18 + hop * 0.24;
      shLx = 0.42 - hop * 0.28;
      shRx = 0.36 - hop * 0.24;
    } else if (state === 'jump' || state === 'fall') {
      const isJump = state === 'jump';
      const flail = Math.sin(elapsedTime * 7.5 + this.root.id) * 0.14;
      hipY = isJump ? 0.96 : 0.91;
      hipRx = isJump ? -0.10 : 0.14;
      spineRx = isJump ? -0.06 : 0.18;
      headRx = isJump ? -0.12 : 0.24;
      uaLx = isJump ? -2.25 : -2.65 + flail;
      uaRx = isJump ? -2.25 : -2.65 - flail;
      uaLz = -0.52;
      uaRz = 0.52;
      faLx = -0.35;
      faRx = -0.35;
      thLx = isJump ? -0.78 : -0.45 + flail;
      thRx = isJump ? -0.42 : -0.28 - flail;
      shLx = isJump ? 1.15 : 0.75;
      shRx = isJump ? 0.72 : 0.58;
      ftLx = 0.35;
      ftRx = 0.35;
    } else if (state === 'slide') {
      // Seated tucked slide pose gliding cheerfully down the water chute!
      const joy = Math.sin(elapsedTime * 5.0 + this.root.id) * 0.12;
      hipY = 0.24;
      hipRx = -0.42;
      spineRx = -0.22;
      headRx = 0.14;
      uaLx = -2.20 + joy;
      uaRx = -2.20 - joy;
      uaLz = -0.45;
      uaRz = 0.45;
      faLx = -0.28;
      faRx = -0.28;
      thLx = -1.25;
      thRx = -1.18;
      shLx = 0.36;
      shRx = 0.32;
      ftLx = 0.32;
      ftRx = 0.32;
    } else if (state === 'yoga') {
      // Mindful ocean-facing sun-salutation / tree-pose seaside stretching
      const flow = 0.5 + 0.5 * Math.sin(elapsedTime * 0.65 + this.root.id * 1.4);
      hipY = 0.94 - flow * 0.06;
      spineRx = -0.04 * flow;
      headRx = -0.08 * flow;
      uaLx = THREE.MathUtils.lerp(-0.45, -2.85, flow);
      uaRx = THREE.MathUtils.lerp(-0.45, -2.85, flow);
      uaLz = THREE.MathUtils.lerp(-0.75, -0.18, flow);
      uaRz = THREE.MathUtils.lerp(0.75, 0.18, flow);
      faLx = THREE.MathUtils.lerp(-0.62, -0.25, flow);
      faRx = THREE.MathUtils.lerp(-0.62, -0.25, flow);
      thLx = -0.08 * flow;
      thRx = 0.08 * flow;
      shLx = 0.12 * flow;
      shRx = 0.06;
    } else if (state === 'rinse') {
      // Rinsing off saltwater hair under outdoor beach shower
      const scrub = Math.sin(elapsedTime * 3.8 + this.root.id);
      hipY = 0.95;
      spineRx = -0.06;
      headRx = -0.22 + scrub * 0.08;
      uaLx = -2.35 + scrub * 0.14;
      uaRx = -2.35 - scrub * 0.14;
      uaLz = -0.28;
      uaRz = 0.28;
      faLx = -1.15 + scrub * 0.18;
      faRx = -1.15 - scrub * 0.18;
      thLx = -0.04;
      thRx = 0.04;
    } else if (state === 'build_sand') {
      // Kneeling/crouching playfully while sculpting wet beach sandcastle
      const scoop = Math.sin(elapsedTime * 2.8 + this.root.id * 1.7);
      hipY = 0.56;
      hipRx = 0.18;
      spineRx = 0.38 + scoop * 0.06;
      headRx = 0.16;
      uaLx = -1.05 + scoop * 0.28;
      uaRx = -1.00 - scoop * 0.22;
      uaLz = -0.16;
      uaRz = 0.16;
      faLx = -0.58 - scoop * 0.24;
      faRx = -0.52 + scoop * 0.20;
      thLx = -1.35;
      thRx = -1.25;
      shLx = 1.68;
      shRx = 1.56;
    } else if (state === 'dance') {
      // Upbeat tropical Tiki groove: rhythmic hip bounce, torso sway & alternating raised arms
      const beat = Math.sin(this.animPhase);
      const halfBeat = Math.cos(this.animPhase * 0.5);
      hipY = 0.92 + Math.abs(beat) * 0.045;
      hipRy = halfBeat * 0.18;
      hipRz = beat * 0.085;
      spineRy = -halfBeat * 0.16;
      spineRz = -beat * 0.06;
      chestRy = beat * 0.14;
      headRy = halfBeat * 0.16;
      headRx = Math.abs(beat) * 0.08 - 0.04;
      uaLx = -0.95 + beat * 0.45;
      uaRx = -0.95 - beat * 0.45;
      uaLz = -0.42 - Math.max(0, beat) * 0.25;
      uaRz = 0.42 + Math.max(0, -beat) * 0.25;
      faLx = -1.05 - beat * 0.32;
      faRx = -1.05 + beat * 0.32;
      thLx = -0.14 + Math.max(0, beat) * 0.22;
      thRx = -0.14 + Math.max(0, -beat) * 0.22;
      shLx = 0.22 + Math.max(0, beat) * 0.25;
      shRx = 0.22 + Math.max(0, -beat) * 0.25;
    } else if (state === 'wave') {
      // Friendly overhead hand wave & warm head nod to nearby beachgoers
      const w = Math.sin(this.animPhase * 1.35);
      hipY = 0.95;
      hipRz = 0.035;
      spineRy = -0.06;
      headRy = w * 0.08;
      headRx = Math.sin(this.animPhase * 0.7) * 0.06;
      uaLx = -0.12;
      uaLz = -0.16;
      faLx = -0.24;
      uaRx = -2.45 + w * 0.12;
      uaRz = 0.38 + w * 0.28;
      faRx = -0.45 + Math.cos(this.animPhase * 1.35) * 0.32;
    } else if (state === 'scan_horizon') {
      // Patrol Lifeguard shading eyes & attentively scanning offshore swimmers left-to-right!
      const scan = Math.sin(elapsedTime * 0.85 + this.root.id);
      hipY = 0.95;
      spineRy = scan * 0.16;
      headRy = scan * 0.38;
      headRx = -0.05;
      uaLx = -0.15;
      uaLz = -0.18;
      faLx = -0.35;
      uaRx = -1.95;
      uaRz = 0.42;
      faRx = -1.65;
    } else if (state === 'whistle_signal') {
      // Lifeguard blowing whistle while waving arm high overhead to wave swimmers back!
      const sig = Math.sin(elapsedTime * 6.5);
      hipY = 0.95;
      spineRx = -0.04;
      headRx = -0.08;
      uaLx = -0.45;
      uaLz = -0.22;
      faLx = -0.82;
      uaRx = -2.65 + sig * 0.18;
      uaRz = 0.48 + sig * 0.32;
      faRx = -0.35 + sig * 0.22;
    } else if (state === 'snorkel_kick') {
      // Face-down buoyant coral-reef snorkeling with gentle swim-fin flutter kicks!
      const kick = Math.sin(elapsedTime * 4.4 + this.root.id);
      hipY = 0.86;
      hipRx = Math.PI * 0.49;
      headRx = -0.16;
      uaLx = -0.22;
      uaRx = -0.22;
      uaLz = -0.38;
      uaRz = 0.38;
      faLx = -0.35;
      faRx = -0.35;
      thLx = kick * 0.34;
      thRx = -kick * 0.34;
      shLx = 0.24 + Math.max(0, -kick) * 0.28;
      shRx = 0.24 + Math.max(0, kick) * 0.28;
      ftLx = 0.65;
      ftRx = 0.65;
    } else if (state === 'float_tube') {
      // Reclined lazily back inside an inflatable ocean donut ring with arms draped comfortably over the tube!
      const sway = Math.sin(elapsedTime * 1.1 + this.root.id) * 0.08;
      hipY = 0.35;
      hipRx = -0.82;
      spineRx = -0.14;
      headRx = 0.32;
      headRy = sway * 1.6;
      uaLx = -0.16;
      uaRx = -0.16;
      uaLz = -0.58;
      uaRz = 0.58;
      faLx = -0.34;
      faRx = -0.34;
      thLx = -1.05;
      thRx = -1.02;
      shLx = 0.68 + sway;
      shRx = 0.68 - sway;
    } else if (state === 'sup_paddle') {
      // Athletic Stand-Up Paddleboarder balanced over knees sweeping a long SUP paddle!
      const stroke = Math.sin(elapsedTime * 2.2 + this.root.id);
      hipY = 0.90;
      spineRx = 0.14 + stroke * 0.06;
      spineRy = stroke * 0.22;
      uaLx = -0.78 + stroke * 0.42;
      uaRx = -1.05 + stroke * 0.38;
      uaLz = -0.18;
      uaRz = 0.26;
      faLx = -0.72;
      faRx = -0.58;
      thLx = -0.20;
      thRx = -0.18;
      shLx = 0.24;
      shRx = 0.22;
    }

    this.hips.position.y = THREE.MathUtils.lerp(this.hips.position.y, hipY, k);
    this.dampRot(this.hips, hipRx, hipRy, hipRz, k);
    this.dampRot(this.spine, spineRx, spineRy, spineRz, k);
    this.dampRot(this.chest, chestRx, chestRy, 0, k);
    // Natural subtle breathing chest expansion + live head-glance toward nearby player/interest!
    const breath = 1.0 + Math.sin(elapsedTime * 2.1 + this.root.id * 1.7) * 0.022;
    this.chest.scale.set(1.0 + (breath - 1.0) * 0.45, 1.0, breath);
    this.dampRot(this.head, headRx, THREE.MathUtils.clamp(headRy + headLookYaw, -0.78, 0.78), 0, k);

    // Handle continuous rotation cleanly for freestyle arms
    if ((state === 'swim_surface' || state === 'swim_underwater') && !(state === 'swim_underwater' && speedNorm < 0.75)) {
      this.upperArmL.rotation.x = uaLx;
      this.upperArmR.rotation.x = uaRx;
      this.upperArmL.rotation.z = THREE.MathUtils.lerp(this.upperArmL.rotation.z, uaLz, k);
      this.upperArmR.rotation.z = THREE.MathUtils.lerp(this.upperArmR.rotation.z, uaRz, k);
    } else {
      // Wrap arm rotation back into [-PI, PI] smoothly when exiting freestyle
      this.upperArmL.rotation.x = Math.atan2(Math.sin(this.upperArmL.rotation.x), Math.cos(this.upperArmL.rotation.x));
      this.upperArmR.rotation.x = Math.atan2(Math.sin(this.upperArmR.rotation.x), Math.cos(this.upperArmR.rotation.x));
      this.dampRot(this.upperArmL, uaLx, 0, uaLz, k);
      this.dampRot(this.upperArmR, uaRx, 0, uaRz, k);
    }

    this.dampRot(this.forearmL, faLx, 0, 0, k);
    this.dampRot(this.forearmR, faRx, 0, 0, k);
    this.dampRot(this.thighL, thLx, 0, thLz, k);
    this.dampRot(this.thighR, thRx, 0, thRz, k);
    this.dampRot(this.shinL, shLx, 0, 0, k);
    this.dampRot(this.shinR, shRx, 0, 0, k);
    this.dampRot(this.footL, ftLx, 0, 0, k);
    this.dampRot(this.footR, ftRx, 0, 0, k);

    return { footPlant, swimStroke };
  }
}
