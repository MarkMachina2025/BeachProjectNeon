import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { CAUSTICS_GLSL } from '../shaders/causticsChunk';

export type HumanAnimState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'wade'
  | 'tread'
  | 'swim_surface'
  | 'swim_underwater'
  | 'sunbathe'
  | 'lounge'
  | 'chat';

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
}

interface LoftRing {
  y: number;
  rx: number;
  rz: number;
  zOffset?: number;
  xOffset?: number;
}

/**
 * Builds a smooth organically sculpted lofted mesh from elliptical cross-section rings.
 * Produces natural anatomical curvature (clavicles, waist taper, calves, forearms, cranium)
 * instead of primitive blocks or cylinders.
 */
function createAnatomicalLoft(rings: LoftRing[], radialSegs = 20, closeEnds = true): THREE.BufferGeometry {
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
      const x = ox + Math.cos(a) * ring.rx;
      const z = oz + Math.sin(a) * ring.rz;
      positions.push(x, ring.y, z);
      uvs.push(u, v);
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

/**
 * Anatomically proportioned articulated human character with hierarchical bone rig,
 * smooth organic lofted limb/torso geometry, summer swimwear & hairstyles,
 * underwater caustics + wet-skin shader, and damped skeletal animation blending.
 */
export class HumanCharacter {
  public readonly root = new THREE.Group();
  public readonly appearance: HumanAppearance;

  // Hierarchical bone/joint pivots
  public readonly hips = new THREE.Group();
  public readonly spine = new THREE.Group();
  public readonly chest = new THREE.Group();
  public readonly neck = new THREE.Group();
  public readonly head = new THREE.Group();

  public readonly upperArmL = new THREE.Group();
  public readonly forearmL = new THREE.Group();
  public readonly upperArmR = new THREE.Group();
  public readonly forearmR = new THREE.Group();

  public readonly thighL = new THREE.Group();
  public readonly shinL = new THREE.Group();
  public readonly footL = new THREE.Group();

  public readonly thighR = new THREE.Group();
  public readonly shinR = new THREE.Group();
  public readonly footR = new THREE.Group();

  private readonly causticMaterials: CustomShaderMaterial[] = [];
  private animPhase = Math.random() * Math.PI * 2;
  private lastStepHalf = -1;
  private lastStrokeHalf = -1;
  private wetLevel = -2.0;

  private readonly _footPos = new THREE.Vector3();

  constructor(appearance: HumanAppearance) {
    this.appearance = appearance;
    const scale = appearance.height / 1.75;
    this.root.scale.setScalar(scale);

    const isFemale = appearance.gender === 'female';

    const skinMat = this.createHumanMaterial(appearance.skinHex, 0.56, 0.0);
    const primaryMat = this.createHumanMaterial(appearance.primaryColor, 0.72, 0.02);
    const secondaryMat = this.createHumanMaterial(appearance.secondaryColor, 0.68, 0.02);
    const hairMat = this.createHumanMaterial(appearance.hairHex, 0.78, 0.04);
    const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf6f6f6, roughness: 0.25 });
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x1d1a18, roughness: 0.15 });
    const lipMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(appearance.skinHex).lerp(new THREE.Color(0xb85c5c), 0.32),
      roughness: 0.45
    });

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
      { y: -0.09, rx: hipW * 0.82, rz: 0.105, zOffset: -0.01 },
      { y: -0.02, rx: hipW, rz: 0.118, zOffset: -0.008 },
      { y: 0.07, rx: hipW * 0.94, rz: 0.112, zOffset: -0.004 },
      { y: 0.14, rx: waistW * 1.04, rz: 0.098, zOffset: 0.0 }
    ]);
    const pelvisMesh = new THREE.Mesh(pelvisGeo, pelvisMat);
    pelvisMesh.castShadow = true;
    pelvisMesh.receiveShadow = true;
    this.hips.add(pelvisMesh);

    // Waistband / swim tie detail
    if (appearance.outfitStyle === 'boardshorts' || appearance.outfitStyle === 'linen_shirt') {
      const bandGeo = new THREE.TorusGeometry(waistW * 0.94, 0.014, 7, 18);
      bandGeo.rotateX(Math.PI / 2);
      bandGeo.scale(1.0, 1.0, 0.78);
      const band = new THREE.Mesh(bandGeo, secondaryMat);
      band.position.y = 0.12;
      this.hips.add(band);
    }

    // ==================== SPINE & TORSO ====================
    this.spine.position.set(0, 0.13, 0);
    this.hips.add(this.spine);

    const midTorsoMat =
      appearance.outfitStyle === 'rashguard' || appearance.outfitStyle === 'onepiece'
        ? primaryMat
        : appearance.outfitStyle === 'linen_shirt'
          ? secondaryMat
          : skinMat;

    const abdomenGeo = createAnatomicalLoft([
      { y: -0.01, rx: waistW * 1.02, rz: 0.096 },
      { y: 0.09, rx: waistW * 0.98, rz: 0.098, zOffset: 0.005 },
      { y: 0.19, rx: chestW * 0.88, rz: chestD * 0.92, zOffset: 0.008 }
    ]);
    const abdomenMesh = new THREE.Mesh(abdomenGeo, midTorsoMat);
    abdomenMesh.castShadow = true;
    abdomenMesh.receiveShadow = true;
    this.spine.add(abdomenMesh);

    // ==================== CHEST & SHOULDERS ====================
    this.chest.position.set(0, 0.18, 0);
    this.spine.add(this.chest);

    const upperTorsoMat =
      appearance.outfitStyle === 'rashguard' || appearance.outfitStyle === 'onepiece'
        ? primaryMat
        : appearance.outfitStyle === 'linen_shirt'
          ? secondaryMat
          : skinMat;

    const chestGeo = createAnatomicalLoft([
      { y: -0.02, rx: chestW * 0.88, rz: chestD * 0.92, zOffset: 0.006 },
      { y: 0.09, rx: chestW * 1.02, rz: chestD, zOffset: 0.012 },
      { y: 0.19, rx: chestW * 0.98, rz: chestD * 0.86, zOffset: 0.004 },
      { y: 0.25, rx: 0.115, rz: 0.075, zOffset: -0.004 }
    ]);
    const chestMesh = new THREE.Mesh(chestGeo, upperTorsoMat);
    chestMesh.castShadow = true;
    chestMesh.receiveShadow = true;
    this.chest.add(chestMesh);

    // Swimwear bikini top or shirt collar accents
    if (appearance.outfitStyle === 'bikini') {
      const topGeo = createAnatomicalLoft([
        { y: 0.03, rx: chestW * 0.99, rz: chestD * 1.02, zOffset: 0.014 },
        { y: 0.125, rx: chestW * 1.03, rz: chestD * 1.06, zOffset: 0.018 },
        { y: 0.175, rx: chestW * 0.96, rz: chestD * 0.95, zOffset: 0.01 }
      ]);
      const topMesh = new THREE.Mesh(topGeo, secondaryMat);
      topMesh.castShadow = true;
      this.chest.add(topMesh);

      // Halter straps
      for (const side of [-1, 1]) {
        const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.16, 6), secondaryMat);
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
      // Relaxed open beach collar V-neck
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.018, 6, 14, Math.PI * 1.3), secondaryMat);
      collar.rotation.x = Math.PI / 2 + 0.22;
      collar.rotation.z = -Math.PI * 0.65;
      collar.position.set(0, 0.23, 0.015);
      this.chest.add(collar);
    }

    // ==================== NECK & SCULPTED HEAD ====================
    this.neck.position.set(0, 0.24, 0.0);
    this.chest.add(this.neck);

    const neckGeo = createAnatomicalLoft([
      { y: -0.01, rx: 0.056, rz: 0.058 },
      { y: 0.05, rx: 0.050, rz: 0.052 },
      { y: 0.105, rx: 0.052, rz: 0.054 }
    ], 12);
    const neckMesh = new THREE.Mesh(neckGeo, skinMat);
    neckMesh.castShadow = true;
    this.neck.add(neckMesh);

    this.head.position.set(0, 0.10, 0.012);
    this.neck.add(this.head);

    // Sculpted human cranium + jawline
    const headGeo = createAnatomicalLoft([
      { y: 0.00, rx: 0.054, rz: 0.068, zOffset: 0.018 }, // Chin
      { y: 0.04, rx: 0.078, rz: 0.092, zOffset: 0.010 }, // Jaw
      { y: 0.10, rx: 0.092, rz: 0.108, zOffset: 0.002 }, // Cheekbones
      { y: 0.17, rx: 0.094, rz: 0.112, zOffset: -0.004 }, // Forehead / temples
      { y: 0.22, rx: 0.074, rz: 0.092, zOffset: -0.008 }, // Crown
      { y: 0.245, rx: 0.025, rz: 0.030, zOffset: -0.008 }
    ], 16);
    const headMesh = new THREE.Mesh(headGeo, skinMat);
    headMesh.castShadow = true;
    headMesh.receiveShadow = true;
    this.head.add(headMesh);

    // Ears
    const earGeo = new THREE.SphereGeometry(0.022, 8, 6);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(earGeo, skinMat);
      ear.position.set(side * 0.092, 0.11, -0.006);
      ear.scale.set(0.45, 1.15, 0.72);
      this.head.add(ear);
    }

    // Subtle sculpted nose & lips
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.042, 6), skinMat);
    nose.position.set(0, 0.102, 0.112);
    nose.rotation.x = Math.PI * 0.36;
    this.head.add(nose);

    const lips = new THREE.Mesh(new THREE.CapsuleGeometry(0.007, 0.026, 4, 6), lipMat);
    lips.rotation.z = Math.PI / 2;
    lips.position.set(0, 0.058, 0.096);
    this.head.add(lips);

    // Eyes & eyebrows
    const eyeGeo = new THREE.SphereGeometry(0.013, 8, 6);
    const pupilGeo = new THREE.SphereGeometry(0.0075, 6, 6);
    const browGeo = new THREE.BoxGeometry(0.028, 0.0065, 0.008);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeWhiteMat);
      eye.position.set(side * 0.034, 0.128, 0.096);
      eye.scale.set(1.0, 0.78, 0.65);
      this.head.add(eye);

      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.set(side * 0.034, 0.128, 0.102);
      this.head.add(pupil);

      const brow = new THREE.Mesh(browGeo, hairMat);
      brow.position.set(side * 0.034, 0.146, 0.100);
      brow.rotation.z = -side * 0.08;
      this.head.add(brow);
    }

    // Styled sculpted hair
    this.buildHair(appearance.hairStyle, hairMat);

    // Optional stylish summer sunglasses
    if (appearance.sunglasses) {
      this.buildSunglasses();
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
  }

  private createHumanMaterial(colorHex: number, roughness: number, metalness: number): CustomShaderMaterial {
    const mat = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      color: colorHex,
      roughness,
      metalness,
      uniforms: {
        uTime: { value: 0 },
        uWaterHeight: { value: 0 },
        uWetHeight: { value: -2.0 },
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
        uniform float uWaterHeight;
        uniform float uWetHeight;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;

        ${CAUSTICS_GLSL}

        void main() {
          vec3 n = normalize(vWorldNormal);
          // Wet skin / fabric darkening & sheen below high-water mark on body
          float wet = smoothstep(uWetHeight + 0.14, uWetHeight - 0.08, vWorldPos.y);
          vec3 col = csm_DiffuseColor.rgb;
          col = mix(col, col * vec3(0.76, 0.74, 0.72), wet * 0.55);
          csm_DiffuseColor = vec4(col, 1.0);
          csm_Roughness = mix(csm_Roughness, 0.22, wet * 0.72);

          // Animated dual-layer underwater caustics dancing on submerged body parts
          vec3 caustics = computeUnderwaterCaustics(vWorldPos, n, uSunDirection, uWaterHeight, uTime);
          csm_Emissive = caustics * uSunColor * 0.58;
        }
      `
    });
    this.causticMaterials.push(mat);
    return mat;
  }

  private buildHair(style: HairStyle, mat: THREE.Material): void {
    // Base cranial hair cap
    const capGeo = new THREE.SphereGeometry(0.104, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
    const cap = new THREE.Mesh(capGeo, mat);
    cap.position.set(0, 0.145, -0.012);
    cap.scale.set(0.98, 1.04, 1.12);
    cap.castShadow = true;
    this.head.add(cap);

    if (style === 'short_crop') {
      const topTuft = new THREE.Mesh(new THREE.SphereGeometry(0.086, 12, 8), mat);
      topTuft.position.set(0, 0.21, 0.015);
      topTuft.scale.set(1.02, 0.58, 1.16);
      topTuft.castShadow = true;
      this.head.add(topTuft);
    } else if (style === 'surfer_waves') {
      for (let i = 0; i < 5; i++) {
        const lock = new THREE.Mesh(new THREE.CapsuleGeometry(0.032, 0.08, 6, 8), mat);
        const ang = (i - 2) * 0.45;
        lock.position.set(Math.sin(ang) * 0.085, 0.175 - Math.abs(i - 2) * 0.015, -0.02 + Math.cos(ang) * 0.04);
        lock.rotation.set(0.35, ang, -ang * 0.3);
        lock.castShadow = true;
        this.head.add(lock);
      }
    } else if (style === 'ponytail') {
      const tailGeo = createAnatomicalLoft([
        { y: 0.0, rx: 0.026, rz: 0.026 },
        { y: -0.08, rx: 0.044, rz: 0.042, zOffset: -0.03 },
        { y: -0.19, rx: 0.034, rz: 0.032, zOffset: -0.05 },
        { y: -0.27, rx: 0.012, rz: 0.012, zOffset: -0.06 }
      ], 10);
      const tail = new THREE.Mesh(tailGeo, mat);
      tail.position.set(0, 0.18, -0.115);
      tail.castShadow = true;
      this.head.add(tail);
    } else if (style === 'long_wavy') {
      const drapeGeo = createAnatomicalLoft([
        { y: -0.22, rx: 0.105, rz: 0.055, zOffset: -0.045 },
        { y: -0.10, rx: 0.115, rz: 0.072, zOffset: -0.042 },
        { y: 0.02, rx: 0.112, rz: 0.085, zOffset: -0.032 },
        { y: 0.12, rx: 0.102, rz: 0.095, zOffset: -0.020 }
      ], 14);
      const drape = new THREE.Mesh(drapeGeo, mat);
      drape.position.set(0, 0.05, -0.01);
      drape.castShadow = true;
      this.head.add(drape);
    } else if (style === 'top_bun') {
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.058, 12, 10), mat);
      bun.position.set(0, 0.275, -0.045);
      bun.scale.set(1.05, 0.88, 1.05);
      bun.castShadow = true;
      this.head.add(bun);
    } else if (style === 'curly_crown') {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const puff = new THREE.Mesh(new THREE.SphereGeometry(0.048, 9, 7), mat);
        puff.position.set(Math.cos(a) * 0.068, 0.215 + (i % 2) * 0.02, Math.sin(a) * 0.072 - 0.015);
        puff.castShadow = true;
        this.head.add(puff);
      }
    }
  }

  private buildSunglasses(): void {
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.2, metalness: 0.4 });
    const lensMat = new THREE.MeshPhysicalMaterial({
      color: 0x0b1a24,
      roughness: 0.08,
      metalness: 0.45,
      clearcoat: 1.0
    });
    const glasses = new THREE.Group();
    glasses.position.set(0, 0.128, 0.106);
    for (const side of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.028, 0.008), lensMat);
      lens.position.set(side * 0.036, 0, 0);
      glasses.add(lens);
      const temple = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.006, 0.105), frameMat);
      temple.position.set(side * 0.058, 0.004, -0.05);
      glasses.add(temple);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.008), frameMat);
    bridge.position.set(0, 0.006, 0);
    glasses.add(bridge);
    this.head.add(glasses);
  }

  private buildArm(
    upperPivot: THREE.Group,
    forearmPivot: THREE.Group,
    side: -1 | 1,
    shoulderX: number,
    skinMat: THREE.Material,
    sleeveMat: THREE.Material,
    isFemale: boolean
  ): void {
    const rScale = isFemale ? 0.86 : 1.0;
    upperPivot.position.set(side * shoulderX, 0.185, 0.0);
    this.chest.add(upperPivot);

    // Smooth blended deltoid shoulder cap tucked into torso
    const shoulderCap = new THREE.Mesh(new THREE.SphereGeometry(0.052 * rScale, 12, 9), sleeveMat);
    shoulderCap.scale.set(0.95, 1.02, 0.96);
    shoulderCap.position.set(-side * 0.008, -0.005, 0);
    shoulderCap.castShadow = true;
    upperPivot.add(shoulderCap);

    // Upper arm loft (extends down -Y with seamless shoulder taper)
    const upperGeo = createAnatomicalLoft([
      { y: -0.29, rx: 0.037 * rScale, rz: 0.038 * rScale },
      { y: -0.16, rx: 0.046 * rScale, rz: 0.048 * rScale },
      { y: -0.02, rx: 0.050 * rScale, rz: 0.052 * rScale }
    ], 12);
    const upperMesh = new THREE.Mesh(upperGeo, skinMat);
    upperMesh.castShadow = true;
    upperMesh.receiveShadow = true;
    upperPivot.add(upperMesh);

    // Short sleeve overlay if wearing rashguard/shirt
    if (sleeveMat !== skinMat) {
      const sleeveGeo = createAnatomicalLoft([
        { y: -0.15, rx: 0.053 * rScale, rz: 0.055 * rScale },
        { y: -0.02, rx: 0.058 * rScale, rz: 0.060 * rScale }
      ], 11);
      const sleeve = new THREE.Mesh(sleeveGeo, sleeveMat);
      sleeve.castShadow = true;
      upperPivot.add(sleeve);
    }

    // Elbow & Forearm
    forearmPivot.position.set(0, -0.29, 0);
    upperPivot.add(forearmPivot);

    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.037 * rScale, 9, 7), skinMat);
    forearmPivot.add(elbow);

    const foreGeo = createAnatomicalLoft([
      { y: -0.26, rx: 0.027 * rScale, rz: 0.025 * rScale },
      { y: -0.14, rx: 0.036 * rScale, rz: 0.035 * rScale },
      { y: -0.02, rx: 0.040 * rScale, rz: 0.039 * rScale }
    ], 10);
    const foreMesh = new THREE.Mesh(foreGeo, skinMat);
    foreMesh.castShadow = true;
    foreMesh.receiveShadow = true;
    forearmPivot.add(foreMesh);

    // Sculpted hand
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.034 * rScale, 9, 8), skinMat);
    hand.position.set(0, -0.30, 0.008);
    hand.scale.set(0.68, 1.48, 0.95);
    hand.castShadow = true;
    forearmPivot.add(hand);
  }

  private buildLeg(
    thighPivot: THREE.Group,
    shinPivot: THREE.Group,
    footPivot: THREE.Group,
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

    // Hip socket cap
    const hipCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.078 * rScale, 10, 8),
      shortsLength > 0 ? shortsMat : skinMat
    );
    thighPivot.add(hipCap);

    // Sculpted thigh
    const thighGeo = createAnatomicalLoft([
      { y: -0.44, rx: 0.054 * rScale, rz: 0.056 * rScale },
      { y: -0.24, rx: 0.072 * rScale, rz: 0.076 * rScale, zOffset: 0.004 },
      { y: -0.02, rx: 0.082 * rScale, rz: 0.084 * rScale }
    ], 12);
    const thighMesh = new THREE.Mesh(thighGeo, skinMat);
    thighMesh.castShadow = true;
    thighMesh.receiveShadow = true;
    thighPivot.add(thighMesh);

    // Boardshorts leg sleeve
    if (shortsLength > 0) {
      const legShortGeo = createAnatomicalLoft([
        { y: -shortsLength, rx: 0.080 * rScale, rz: 0.084 * rScale },
        { y: -0.01, rx: 0.089 * rScale, rz: 0.091 * rScale }
      ], 12);
      const legShort = new THREE.Mesh(legShortGeo, shortsMat);
      legShort.castShadow = true;
      legShort.receiveShadow = true;
      thighPivot.add(legShort);
    }

    // Knee & sculpted calf/shin
    shinPivot.position.set(0, -0.44, 0);
    thighPivot.add(shinPivot);

    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.052 * rScale, 10, 8), skinMat);
    shinPivot.add(knee);

    const shinGeo = createAnatomicalLoft([
      { y: -0.41, rx: 0.034 * rScale, rz: 0.036 * rScale }, // Ankle
      { y: -0.26, rx: 0.048 * rScale, rz: 0.052 * rScale, zOffset: -0.008 }, // Calf peak
      { y: -0.14, rx: 0.056 * rScale, rz: 0.060 * rScale, zOffset: -0.010 },
      { y: -0.02, rx: 0.052 * rScale, rz: 0.054 * rScale }
    ], 11);
    const shinMesh = new THREE.Mesh(shinGeo, skinMat);
    shinMesh.castShadow = true;
    shinMesh.receiveShadow = true;
    shinPivot.add(shinMesh);

    // Bare anatomical beach foot
    footPivot.position.set(0, -0.42, 0.0);
    shinPivot.add(footPivot);

    const footGeo = createAnatomicalLoft([
      { y: -0.05, rx: 0.042, rz: 0.115, zOffset: 0.055 },
      { y: -0.02, rx: 0.044, rz: 0.110, zOffset: 0.050 },
      { y: 0.015, rx: 0.036, rz: 0.065, zOffset: 0.020 }
    ], 10);
    const footMesh = new THREE.Mesh(footGeo, skinMat);
    footMesh.castShadow = true;
    footMesh.receiveShadow = true;
    footPivot.add(footMesh);
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
    sunColor: THREE.Color
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

    // Update character caustics & wetness uniforms
    for (let i = 0; i < this.causticMaterials.length; i++) {
      const u = this.causticMaterials[i].uniforms;
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
      // Seated reclined comfortably on wooden beach lounge chair
      hipY = 0.44;
      hipRx = -0.62;
      spineRx = -0.14;
      headRx = 0.32;
      headRy = Math.sin(elapsedTime * 0.4 + this.root.id) * 0.25;
      uaLx = -0.35;
      uaRx = -0.35;
      uaLz = -0.26;
      uaRz = 0.26;
      faLx = -0.45;
      faRx = -0.45;
      thLx = -0.92;
      thRx = -0.88;
      shLx = 0.22;
      shRx = 0.28;
      thLz = -0.06;
      thRz = 0.06;
    }

    this.hips.position.y = THREE.MathUtils.lerp(this.hips.position.y, hipY, k);
    this.dampRot(this.hips, hipRx, hipRy, hipRz, k);
    this.dampRot(this.spine, spineRx, spineRy, spineRz, k);
    this.dampRot(this.chest, chestRx, chestRy, 0, k);
    this.dampRot(this.head, headRx, headRy, 0, k);

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
