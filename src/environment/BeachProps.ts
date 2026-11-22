import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { addCollider, getTerrainHeight, getTerrainNormal } from '../terrain/terrainMath';
import { sampleWaveHeight } from '../ocean/wavePhysics';
import { CAUSTICS_GLSL } from '../shaders/causticsChunk';
import { CampAnchor } from './CoastalModels';
import { getBoardwalkY } from './CoastalLandmarks';
import { mergeStaticGroupByMaterial } from '../utils/geometryBatcher';
import { loadPbrSet } from '../utils/pbrMaterials';

export interface RestSpot {
  position: THREE.Vector3;
  yaw: number;
  kind: 'towel' | 'chair';
}

function createStripedTexture(colorA: string, colorB: string, stripes = 12): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const stripeW = canvas.width / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? colorA : colorB;
    ctx.fillRect(i * stripeW, 0, stripeW + 1, canvas.height);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.04)';
  for (let y = 0; y < canvas.height; y += 4) {
    ctx.fillRect(0, y, canvas.width, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function createSurfboardTexture(base: string, stripe: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 512);
  ctx.fillStyle = stripe;
  ctx.fillRect(46, 0, 36, 512);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(61, 0, 6, 512);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/**
 * Clean, Strictly Non-Overlapping Beach Scene Dressing Props:
 *  - Matte underwater reef rocks (photoscanned headland boulders handled in CoastalModels!)
 *  - 7 well-spaced striped beach umbrella / chair / towel / cooler / flip-flop camps
 *    (zero overlap with boardwalk, pier, or volleyball court!)
 *  - Surfboard rack & planted fiberglass surfboards
 *  - Weathered driftwood logs, marine buoys, inflatable swim ring & live playable water beach ball
 */
export class BeachProps {
  public readonly group = new THREE.Group();
  public readonly waterPropsGroup = new THREE.Group();
  public readonly restSpots: RestSpot[] = [];
  public readonly campAnchors: CampAnchor[] = [];
  public readonly bonfireHaloPos = new THREE.Vector3(-38.5, 0, -19.2);
  public readonly waterBeachBall: THREE.Mesh;
  public readonly beachFrisbee: THREE.Mesh;
  public floatRingMesh!: THREE.Mesh;
  public readonly floatRingPos = new THREE.Vector3(-14.5, 0.05, 8.8);
  public readonly floatRingVel = new THREE.Vector2(0, 0);
  public floatRingRiderActive = false;

  private readonly causticMaterials: CustomShaderMaterial[] = [];
  private readonly buoys: Array<{ mesh: THREE.Object3D; x: number; z: number }> = [];
  private bonfireLight: THREE.PointLight | null = null;
  private bonfireFlame: THREE.Mesh | null = null;

  // Shared cached materials so repeated drinks & camp props merge into single batched draw calls
  private readonly drinkGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.08,
    transparent: true,
    opacity: 0.45
  });
  private readonly drinkLiquidMats = [0xff6b4a, 0xffbe2e, 0x38d9a9, 0xf06595].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.22 })
  );
  private readonly drinkStrawMat = new THREE.MeshStandardMaterial({ color: 0xfff5e6, roughness: 0.45 });
  private readonly drinkLimeMat = new THREE.MeshStandardMaterial({ color: 0x69db4e, roughness: 0.55 });
  private drinkColorCursor = 0;

  constructor() {
    this.group.name = 'BeachProps';
    this.waterPropsGroup.name = 'WaterProps';

    this.buildUnderwaterReefRocks();
    this.buildBeachCamps();
    this.buildSurfboards();
    this.buildDriftwood();
    this.buildSandcastle();
    this.buildBonfirePit();
    this.buildYogaMats();
    this.buildSeashellsAndStarfish();
    this.buildTideLineClutter();
    this.buildSunkenAnchor();
    this.waterBeachBall = this.buildFloatingProps();
    this.beachFrisbee = this.buildBeachFrisbee();

    // Batch all static props & underwater rocks into minimal draw calls for smooth 60+ FPS!
    mergeStaticGroupByMaterial(this.group);
    mergeStaticGroupByMaterial(this.waterPropsGroup);
  }

  private createUnderseaRockMaterial(): CustomShaderMaterial {
    const loader = new THREE.TextureLoader();
    const rockDiff = loader.load('./textures/rock_Diffuse.jpg');
    rockDiff.wrapS = rockDiff.wrapT = THREE.RepeatWrapping;
    rockDiff.repeat.set(2, 2);
    rockDiff.anisotropy = 8;
    rockDiff.colorSpace = THREE.SRGBColorSpace;

    const rockNor = loader.load('./textures/rock_nor_gl.jpg');
    rockNor.wrapS = rockNor.wrapT = THREE.RepeatWrapping;
    rockNor.repeat.set(2, 2);
    rockNor.anisotropy = 8;

    const mat = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      map: rockDiff,
      normalMap: rockNor,
      normalScale: new THREE.Vector2(0.85, 0.85),
      color: 0x9e9588,
      roughness: 0.90,
      metalness: 0.0,
      envMapIntensity: 0.22,
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
          vec3 n = normalize(vWorldNormal);
          vec3 caustics = computeUnderwaterCaustics(vWorldPos, n, uSunDirection, 0.05, uTime);
          csm_Emissive = caustics * uSunColor * 0.45;
        }
      `
    });
    this.causticMaterials.push(mat);
    return mat;
  }

  private createSculptedReefGeo(radius: number, seed: number): THREE.BufferGeometry {
    const geo = new THREE.SphereGeometry(radius, 20, 14);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n1 = Math.sin(v.x * 1.7 + seed) * Math.cos(v.y * 1.9 - seed * 0.7) * Math.sin(v.z * 1.5 + seed * 1.3);
      const n2 = Math.cos(v.x * 3.6 - seed) * Math.sin(v.z * 3.2 + seed * 0.5);
      v.multiplyScalar(1.0 + n1 * 0.24 + n2 * 0.09);
      if (v.y < 0) v.y *= 0.62;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Underwater reef boulders ONLY (above-water coastal boulders now use 100% real photoscanned
   * Poly Haven rock_09 & rock_07 models with matte natural surfaces — zero shiny black spheres!).
   */
  private buildUnderwaterReefRocks(): void {
    const reefMat = this.createUnderseaRockMaterial();

    const reefRocks: Array<[number, number, number, number, number, number]> = [
      [-16, 36, 2.4, 1.3, 2.1, 11.4],
      [-7, 41, 2.9, 1.65, 2.5, 12.8],
      [6, 39, 2.5, 1.4, 2.2, 13.5],
      [15, 44, 3.1, 1.85, 2.7, 14.2],
      [-2, 48, 3.5, 2.1, 3.1, 15.1],
      [-22, 46, 2.8, 1.7, 2.4, 16.3],
      [24, 40, 2.3, 1.25, 1.9, 17.6],
      [3, 35, 1.5, 0.85, 1.35, 18.2],
      [-11, 34, 1.4, 0.78, 1.25, 19.4]
    ];

    for (const [x, z, rx, ry, rz, seed] of reefRocks) {
      const geo = this.createSculptedReefGeo(1.0, seed);
      const rock = new THREE.Mesh(geo, reefMat);
      const h = getTerrainHeight(x, z);
      rock.position.set(x, h + ry * 0.25, z);
      rock.scale.set(rx, ry, rz);
      rock.rotation.y = seed * 2.1;
      rock.receiveShadow = true;
      this.waterPropsGroup.add(rock);
      addCollider(x, z, Math.max(rx, rz) * 0.82, ry * 1.2);
    }
  }

  public createTropicalDrink(): THREE.Group {
    const g = new THREE.Group();
    const liquidMat = this.drinkLiquidMats[this.drinkColorCursor % this.drinkLiquidMats.length];
    this.drinkColorCursor++;

    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.034, 0.145, 10, 1, true), this.drinkGlassMat);
    glass.position.y = 0.074;
    g.add(glass);

    const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.031, 0.105, 10), liquidMat);
    liquid.position.y = 0.056;
    g.add(liquid);

    const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.19, 5), this.drinkStrawMat);
    straw.position.set(0.012, 0.115, 0);
    straw.rotation.z = -0.22;
    g.add(straw);

    const lime = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.009, 8, 1, false, 0, Math.PI), this.drinkLimeMat);
    lime.position.set(-0.04, 0.14, 0);
    lime.rotation.z = Math.PI / 2;
    g.add(lime);

    return g;
  }

  private placeFlipFlops(
    x: number,
    z: number,
    yaw: number,
    soleMat: THREE.Material,
    strapMat: THREE.Material
  ): void {
    const y = getTerrainHeight(x, z);

    const pair = new THREE.Group();
    pair.position.set(x, y + 0.014, z);
    pair.rotation.y = yaw;

    for (let i = 0; i < 2; i++) {
      const shoe = new THREE.Group();
      shoe.position.set(i === 0 ? -0.09 : 0.09, 0, i === 0 ? 0.02 : -0.03);
      shoe.rotation.y = i === 0 ? 0.18 : -0.22;

      const sole = new THREE.Mesh(new THREE.CapsuleGeometry(0.044, 0.16, 4, 8), soleMat);
      sole.rotation.x = Math.PI / 2;
      sole.scale.set(1, 1, 0.25);
      shoe.add(sole);

      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.007, 5, 8, Math.PI), strapMat);
      strap.position.set(0, 0.01, -0.02);
      strap.rotation.y = Math.PI / 2;
      shoe.add(strap);

      pair.add(shoe);
    }
    this.group.add(pair);
  }

  private buildBeachCamps(): void {
    const oakPbr = loadPbrSet('oak_wood_planks', 2, 1);
    const linenPbr = loadPbrSet('rough_linen', 3, 3);
    const terryPbr = loadPbrSet('terry_cloth', 3, 3);
    const strawPbr = loadPbrSet('bamboo_wall_02', 2, 2);

    const woodMat = new THREE.MeshStandardMaterial({
      map: oakPbr.map,
      normalMap: oakPbr.normalMap,
      roughnessMap: oakPbr.roughnessMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      color: 0xd4b085,
      roughness: 0.84
    });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0xd9e1e8, roughness: 0.30, metalness: 0.75 });

    const palettes: Array<{ a: string; b: string; cooler: number; towelA: string; towelB: string }> = [
      { a: '#e05344', b: '#fff8ee', cooler: 0x2692b8, towelA: '#2cb5b0', towelB: '#f7f1e3' },
      { a: '#218b9b', b: '#fffaf0', cooler: 0xe66a42, towelA: '#f2b84b', towelB: '#fff9ed' },
      { a: '#ebb038', b: '#fff8ec', cooler: 0x3b6ea5, towelA: '#df5f6e', towelB: '#fff6ee' },
      { a: '#2c4f7c', b: '#f7f4ec', cooler: 0x2da37a, towelA: '#4696c8', towelB: '#f5f5f5' }
    ];

    const canopyMats = palettes.map(
      (p) =>
        new THREE.MeshStandardMaterial({
          map: createStripedTexture(p.a, p.b, 16),
          normalMap: linenPbr.normalMap,
          roughnessMap: linenPbr.roughnessMap,
          normalScale: new THREE.Vector2(0.7, 0.7),
          roughness: 0.92,
          side: THREE.DoubleSide
        })
    );
    const cushionMats = palettes.map(
      (p) =>
        new THREE.MeshStandardMaterial({
          map: createStripedTexture(p.a, p.b, 6),
          normalMap: terryPbr.normalMap,
          roughnessMap: terryPbr.roughnessMap,
          normalScale: new THREE.Vector2(0.65, 0.65),
          roughness: 0.94
        })
    );
    const towelMats = palettes.map(
      (p) =>
        new THREE.MeshStandardMaterial({
          map: createStripedTexture(p.towelA, p.towelB, 10),
          normalMap: terryPbr.normalMap,
          roughnessMap: terryPbr.roughnessMap,
          normalScale: new THREE.Vector2(0.75, 0.75),
          roughness: 0.96,
          side: THREE.DoubleSide
        })
    );
    const coolerMats = palettes.map(
      (p) => new THREE.MeshStandardMaterial({ color: p.cooler, roughness: 0.34, metalness: 0.04 })
    );
    const coolerLidMat = new THREE.MeshStandardMaterial({ color: 0xf6f8fa, roughness: 0.30, metalness: 0.04 });
    const coolerLatchMat = new THREE.MeshStandardMaterial({ color: 0xdbe3ea, roughness: 0.25, metalness: 0.8 });
    const strawBagMat = new THREE.MeshStandardMaterial({
      map: strawPbr.map,
      normalMap: strawPbr.normalMap,
      roughnessMap: strawPbr.roughnessMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      color: 0xe3ca98,
      roughness: 0.94
    });
    const bagStrapMats = palettes.map((p) => new THREE.MeshStandardMaterial({ color: p.a, roughness: 0.72 }));
    const flipFlopSoleMats = palettes.map((p) => new THREE.MeshStandardMaterial({ color: p.cooler, roughness: 0.72 }));
    const flipFlopStrapMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 });

    // Carefully spaced camps keeping Boardwalk (z=-25), Volleyball Court (x=0..10, z=-19..-10),
    // and Ocean Pier (x=18..26) 100% clear with ZERO overlaps!
    const campConfigs: Array<{ x: number; z: number; yaw: number; hasChair: boolean; hasTowel: boolean; hasCooler: boolean }> = [
      { x: -42.0, z: -13.5, yaw: 0.24, hasChair: true, hasTowel: true, hasCooler: true },
      { x: -29.0, z: -14.8, yaw: 0.16, hasChair: true, hasTowel: true, hasCooler: true },
      { x: -16.5, z: -15.5, yaw: 0.10, hasChair: true, hasTowel: true, hasCooler: true },
      { x: -6.5, z: -16.8, yaw: 0.04, hasChair: false, hasTowel: true, hasCooler: true },
      { x: 14.2, z: -14.5, yaw: -0.14, hasChair: true, hasTowel: true, hasCooler: true },
      { x: 33.0, z: -14.0, yaw: -0.22, hasChair: true, hasTowel: true, hasCooler: true },
      { x: 45.0, z: -12.5, yaw: -0.30, hasChair: true, hasTowel: false, hasCooler: false }
    ];

    campConfigs.forEach((cfg, idx) => {
      const pi = idx % palettes.length;
      this.placeUmbrella(cfg.x, cfg.z, cfg.yaw, canopyMats[pi], woodMat, metalMat);

      const cosY = Math.cos(cfg.yaw);
      const sinY = Math.sin(cfg.yaw);

      // Helper converting local camp offset (lx right, lz forward) -> world (x, z)
      const toWorld = (lx: number, lz: number): [number, number] => [
        cfg.x + lx * cosY + lz * sinY,
        cfg.z - lx * sinY + lz * cosY
      ];

      if (cfg.hasChair) {
        const [cx, cz] = toWorld(1.85, 0.35);
        this.placeLoungeChair(cx, cz, cfg.yaw, cushionMats[pi], woodMat);
        this.restSpots.push({
          position: new THREE.Vector3(cx, getTerrainHeight(cx, cz), cz),
          yaw: cfg.yaw,
          kind: 'chair'
        });
      }

      let towelPos: THREE.Vector3 | undefined;
      if (cfg.hasTowel) {
        const [tx, tz] = toWorld(-1.85, 0.50);
        this.placeBeachTowel(tx, tz, cfg.yaw + 0.05, towelMats[pi]);
        towelPos = new THREE.Vector3(tx, getTerrainHeight(tx, tz), tz);
        this.restSpots.push({
          position: towelPos.clone(),
          yaw: cfg.yaw + 0.05,
          kind: 'towel'
        });
        const [fx, fz] = toWorld(-2.62, 0.92);
        this.placeFlipFlops(fx, fz, cfg.yaw + 0.35, flipFlopSoleMats[pi], flipFlopStrapMat);

        // Woven straw beach tote bag tucked neatly beside the towel
        const [bx, bz] = toWorld(-2.45, -0.58);
        this.placeBeachBag(bx, bz, cfg.yaw - 0.25, strawBagMat, bagStrapMats[pi]);
      }

      if (cfg.hasCooler) {
        const [kx, kz] = toWorld(-0.75, -1.05);
        this.placeCooler(kx, kz, cfg.yaw + 0.35, coolerMats[pi], coolerLidMat, coolerLatchMat);
      }

      // Side table cleanly positioned at (+0.65, +1.05) — ZERO intersection with lounge chair (+1.85, +0.35)!
      const [stX, stZ] = toWorld(0.65, 1.05);
      this.campAnchors.push({
        x: cfg.x,
        z: cfg.z,
        yaw: cfg.yaw,
        sideTablePos: new THREE.Vector3(stX, getTerrainHeight(stX, stZ), stZ),
        towelPos
      });
    });
  }

  private placeUmbrella(
    x: number,
    z: number,
    yaw: number,
    canopyMat: THREE.Material,
    woodMat: THREE.Material,
    metalMat: THREE.Material
  ): void {
    const group = new THREE.Group();
    const y = getTerrainHeight(x, z);
    group.position.set(x, y - 0.08, z);
    group.rotation.y = yaw;
    group.rotation.z = 0.09;

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 2.55, 10), woodMat);
    pole.position.y = 1.25;
    pole.castShadow = true;
    pole.receiveShadow = true;
    group.add(pole);

    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), woodMat);
    cap.position.y = 2.58;
    group.add(cap);

    const canopyGeo = new THREE.ConeGeometry(1.58, 0.52, 8, 4, true);
    const pos = canopyGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const py = pos.getY(i);
      const px = pos.getX(i);
      const pz = pos.getZ(i);
      const r = Math.hypot(px, pz) / 1.58;
      pos.setY(i, py + Math.sin(r * Math.PI * 0.5) * 0.14);
    }
    canopyGeo.computeVertexNormals();

    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.y = 2.28;
    canopy.castShadow = true;
    canopy.receiveShadow = true;
    group.add(canopy);

    const valanceGeo = new THREE.CylinderGeometry(1.56, 1.58, 0.18, 8, 1, true);
    const valance = new THREE.Mesh(valanceGeo, canopyMat);
    valance.position.y = 2.09;
    valance.castShadow = true;
    group.add(valance);

    for (let r = 0; r < 8; r++) {
      const ang = (r / 8) * Math.PI * 2;
      const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.48, 5), metalMat);
      rib.position.set(Math.cos(ang) * 0.72, 2.22, Math.sin(ang) * 0.72);
      rib.rotation.z = Math.PI * 0.42;
      rib.rotation.y = -ang;
      group.add(rib);
    }

    this.group.add(group);
    addCollider(x, z, 0.25, 2.5);
  }

  private placeLoungeChair(
    x: number,
    z: number,
    yaw: number,
    cushionMat: THREE.Material,
    woodMat: THREE.Material
  ): void {
    const group = new THREE.Group();
    const y = getTerrainHeight(x, z);
    const n = getTerrainNormal(x, z);

    group.position.set(x, y, z);
    const alignQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    group.quaternion.copy(alignQ).multiply(yawQ);

    const frameW = 0.72;
    const frameL = 1.92;
    const seatH = 0.34;

    for (const sx of [-frameW * 0.46, frameW * 0.46]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.06, frameL), woodMat);
      rail.position.set(sx, seatH, 0);
      rail.castShadow = true;
      rail.receiveShadow = true;
      group.add(rail);

      for (const lz of [-0.72, 0.72]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.055, seatH + 0.08, 0.055), woodMat);
        leg.position.set(sx, (seatH - 0.04) * 0.5, lz);
        group.add(leg);
      }

      // Vertical armrest support posts anchoring armrests cleanly into side rails (ZERO floating armrests!)
      for (const az of [-0.56, 0.12]) {
        const armPost = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.22, 0.045), woodMat);
        armPost.position.set(sx, seatH + 0.11, az);
        armPost.castShadow = true;
        group.add(armPost);
      }

      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.035, 0.78), woodMat);
      arm.position.set(sx, seatH + 0.22, -0.22);
      arm.castShadow = true;
      group.add(arm);

      // Angled rear wooden brace strut supporting the reclined backrest solidly from the side rail!
      const pTop = new THREE.Vector3(sx * 0.86, seatH + 0.34, -0.58);
      const pBot = new THREE.Vector3(sx, seatH + 0.02, -0.86);
      const strutLen = pTop.distanceTo(pBot);
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.042, strutLen), woodMat);
      strut.position.copy(pTop).lerp(pBot, 0.5);
      strut.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        pBot.clone().sub(pTop).normalize()
      );
      strut.castShadow = true;
      group.add(strut);
    }

    for (let s = 0; s < 7; s++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(frameW - 0.06, 0.024, 0.13), woodMat);
      slat.position.set(0, seatH + 0.025, 0.06 + s * 0.155);
      slat.receiveShadow = true;
      group.add(slat);
    }

    const backGroup = new THREE.Group();
    backGroup.position.set(0, seatH + 0.03, -0.14);
    // Positive X rotation lifts -Z backrest UPWARD into an ergonomic reclining angle (NOT down into sand!)
    backGroup.rotation.x = 0.64;
    for (let s = 0; s < 5; s++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(frameW - 0.06, 0.024, 0.125), woodMat);
      slat.position.set(0, 0, -0.12 - s * 0.15);
      backGroup.add(slat);
    }

    const backPad = new THREE.Mesh(new THREE.BoxGeometry(frameW - 0.12, 0.055, 0.76), cushionMat);
    backPad.position.set(0, 0.04, -0.44);
    backPad.castShadow = true;
    backGroup.add(backPad);

    const pillow = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.36, 5, 8), cushionMat);
    pillow.rotation.z = Math.PI / 2;
    pillow.position.set(0, 0.10, -0.72);
    backGroup.add(pillow);

    group.add(backGroup);

    const seatPad = new THREE.Mesh(new THREE.BoxGeometry(frameW - 0.12, 0.055, 1.04), cushionMat);
    seatPad.position.set(0, seatH + 0.065, 0.44);
    seatPad.castShadow = true;
    seatPad.receiveShadow = true;
    group.add(seatPad);

    this.group.add(group);
    addCollider(x, z, 0.65, 0.9);
  }

  private placeBeachTowel(x: number, z: number, yaw: number, mat: THREE.Material): void {
    const geo = new THREE.PlaneGeometry(1.05, 2.05, 10, 16);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);

    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const lz = pos.getZ(i);
      const wx = x + lx * cosY + lz * sinY;
      const wz = z - lx * sinY + lz * cosY;
      const ripple = Math.sin(lx * 7.0 + lz * 5.0) * 0.008;
      pos.setXYZ(i, wx, getTerrainHeight(wx, wz) + 0.024 + ripple, wz);
    }
    geo.computeVertexNormals();

    const towel = new THREE.Mesh(geo, mat);
    towel.receiveShadow = true;
    this.group.add(towel);
  }

  private placeCooler(
    x: number,
    z: number,
    yaw: number,
    bodyMat: THREE.Material,
    lidMat: THREE.Material,
    latchMat: THREE.Material
  ): void {
    const group = new THREE.Group();
    const y = getTerrainHeight(x, z);
    const n = getTerrainNormal(x, z);
    group.position.set(x, y - 0.02, z);

    const alignQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    group.quaternion.copy(alignQ).multiply(yawQ);

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.36, 0.38), bodyMat);
    body.position.y = 0.18;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.075, 0.41), lidMat);
    lid.position.y = 0.39;
    lid.castShadow = true;
    group.add(lid);

    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.03), latchMat);
    latch.position.set(0, 0.34, 0.205);
    group.add(latch);

    const cup = this.createTropicalDrink();
    cup.position.set(0.16, 0.43, 0.04);
    group.add(cup);

    this.group.add(group);
    addCollider(x, z, 0.38, 0.5);
  }

  private buildSurfboards(): void {
    const geo = new THREE.SphereGeometry(1, 16, 18);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);
      const taper = 1.0 - Math.pow(Math.max(0, y), 1.8) * 0.32 - Math.pow(Math.max(0, -y), 2.0) * 0.22;
      x *= 0.27 * taper;
      z = z * 0.036 + y * y * 0.055;
      y *= 1.12;
      pos.setXYZ(i, x, y, z);
    }
    geo.computeVertexNormals();

    const finGeo = new THREE.ConeGeometry(0.06, 0.16, 4);
    const finMat = new THREE.MeshStandardMaterial({ color: 0x1e252c, roughness: 0.35 });

    // 4 Surfboards nestled cleanly inside the Neon Tiki wooden surfboard rack (x = -16.2..-13.8, z = -27.55)
    // + 2 boards planted cleanly near beach camps!
    const rackBoards: Array<{ x: number; base: string; stripe: string }> = [
      { x: -16.22, base: '#fef6e4', stripe: '#22b5b0' },
      { x: -15.41, base: '#ffd166', stripe: '#ef476f' },
      { x: -14.60, base: '#ffffff', stripe: '#118ab2' },
      { x: -13.79, base: '#f78c6b', stripe: '#073b4c' }
    ];
    for (const rb of rackBoards) {
      const mat = new THREE.MeshPhysicalMaterial({
        map: createSurfboardTexture(rb.base, rb.stripe),
        roughness: 0.18,
        clearcoat: 0.78,
        clearcoatRoughness: 0.14
      });
      const board = new THREE.Mesh(geo, mat);
      const rackBaseY = Math.max(getBoardwalkY(-15.0) - 0.04, getTerrainHeight(-15.0, -27.55)) + 0.10;
      board.castShadow = true;
      board.receiveShadow = true;

      const fin = new THREE.Mesh(finGeo, finMat);
      fin.position.set(0, -0.78, -0.07);
      fin.rotation.x = -Math.PI * 0.45;
      board.add(fin);

      // Leaning neatly back against the rack crossbar with tails resting cleanly on the timber rack base!
      board.position.set(rb.x, rackBaseY + 1.04, -27.50);
      board.rotation.set(-0.22, 0.0, 0.0);
      this.group.add(board);
    }

    const sandBoards: Array<{ x: number; z: number; yaw: number; base: string; stripe: string }> = [
      // Neatly planted right beside Camp #2 & Camp #6 chairs (plenty of clearance from towels!)
      { x: -13.6, z: -16.6, yaw: 0.32, base: '#fef6e4', stripe: '#ff6b57' },
      { x: 30.2, z: -14.8, yaw: -0.36, base: '#e0fbfc', stripe: '#168aad' }
    ];

    for (const b of sandBoards) {
      const mat = new THREE.MeshPhysicalMaterial({
        map: createSurfboardTexture(b.base, b.stripe),
        roughness: 0.18,
        clearcoat: 0.78,
        clearcoatRoughness: 0.14
      });

      const board = new THREE.Mesh(geo, mat);
      const y = getTerrainHeight(b.x, b.z);
      board.castShadow = true;
      board.receiveShadow = true;

      const fin = new THREE.Mesh(finGeo, finMat);
      fin.position.set(0, -0.78, -0.07);
      fin.rotation.x = -Math.PI * 0.45;
      board.add(fin);

      board.position.set(b.x, y + 0.84, b.z);
      board.rotation.set(-0.14, b.yaw, 0.06);
      addCollider(b.x, b.z, 0.30, 1.9);
      this.group.add(board);
    }
  }

  private buildDriftwood(): void {
    const weatheredPbr = loadPbrSet('weathered_brown_planks', 3, 1);
    const driftMat = new THREE.MeshStandardMaterial({
      map: weatheredPbr.map,
      normalMap: weatheredPbr.normalMap,
      roughnessMap: weatheredPbr.roughnessMap,
      normalScale: new THREE.Vector2(0.95, 0.95),
      color: 0xd8cbb9,
      roughness: 0.95,
      metalness: 0.0
    });

    const logs: Array<[number, number, number, number]> = [
      [-35.0, -7.2, 0.42, 3.6],
      [39.0, -7.5, -0.52, 3.8],
      [-51.0, -14.2, -0.35, 3.2],
      [52.0, -13.0, 0.28, 3.4]
    ];

    for (const [x, z, yaw, len] of logs) {
      const pts = [
        new THREE.Vector3(-len * 0.5, -0.05, 0),
        new THREE.Vector3(-len * 0.15, 0.10, 0.18),
        new THREE.Vector3(len * 0.2, 0.06, -0.14),
        new THREE.Vector3(len * 0.5, -0.06, 0.10)
      ];
      const curve = new THREE.CatmullRomCurve3(pts);
      const geo = new THREE.TubeGeometry(curve, 12, 0.16, 7, false);
      const mesh = new THREE.Mesh(geo, driftMat);
      mesh.position.set(x, getTerrainHeight(x, z) - 0.035, z);
      const alignQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), getTerrainNormal(x, z));
      const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      mesh.quaternion.copy(alignQ).multiply(yawQ);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      addCollider(x, z, len * 0.28, 0.45);
    }
  }

  private buildFloatingProps(): THREE.Mesh {
    const buoyCoords: Array<[number, number]> = [
      [-24, 26],
      [2, 28],
      [34, 27]
    ];
    const orangeMat = new THREE.MeshStandardMaterial({ color: 0xf25c2a, roughness: 0.35 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf4f7fa, roughness: 0.4 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x3b4856, roughness: 0.5, metalness: 0.7 });

    for (const [bx, bz] of buoyCoords) {
      const b = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.28, 0.55, 14), orangeMat);
      base.castShadow = true;
      b.add(base);

      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.365, 0.34, 0.14, 14), whiteMat);
      stripe.position.y = 0.08;
      b.add(stripe);

      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.35, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), orangeMat);
      dome.position.y = 0.27;
      b.add(dome);

      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 7, 12), metalMat);
      ring.position.y = 0.68;
      b.add(ring);

      b.position.set(bx, 0, bz);
      b.userData.dynamic = true;
      this.waterPropsGroup.add(b);
      this.buoys.push({ mesh: b, x: bx, z: bz });
    }

    // Interactive Inflatable Pink/White Swim Ring — lays flat horizontally on waves, pushable & rideable ([E])!
    const floatRingMat = new THREE.MeshPhysicalMaterial({
      map: createStripedTexture('#ff70a6', '#ffffff', 12),
      roughness: 0.22,
      clearcoat: 0.78
    });
    const floatRingGeo = new THREE.TorusGeometry(0.46, 0.15, 12, 22);
    floatRingGeo.rotateX(Math.PI / 2); // Bake horizontal orientation into geometry so wave pitch/roll tilts cleanly!
    const floatRing = new THREE.Mesh(floatRingGeo, floatRingMat);
    floatRing.castShadow = true;
    floatRing.position.copy(this.floatRingPos);
    floatRing.userData.dynamic = true;
    this.waterPropsGroup.add(floatRing);
    this.floatRingMesh = floatRing;

    // Live interactive striped beach ball tossed back & forth by the 2 kids in the shallow surf!
    const ballMat = new THREE.MeshPhysicalMaterial({
      map: createStripedTexture('#ff595e', '#ffca3a', 6),
      roughness: 0.20,
      clearcoat: 0.75
    });
    const beachBall = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), ballMat);
    beachBall.castShadow = true;
    beachBall.position.set(-6.0, 1.0, 6.8);
    beachBall.userData.dynamic = true;
    this.waterPropsGroup.add(beachBall);

    return beachBall;
  }

  private placeBeachBag(
    x: number,
    z: number,
    yaw: number,
    strawMat: THREE.Material,
    strapMat: THREE.Material
  ): void {
    const g = new THREE.Group();
    g.position.set(x, getTerrainHeight(x, z) + 0.14, z);
    g.rotation.y = yaw;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.30, 0.18), strawMat);
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.06, 0.185), strapMat);
    stripe.position.y = -0.02;
    g.add(stripe);
    for (const sz of [-0.07, 0.07]) {
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 5, 10, Math.PI), strapMat);
      handle.position.set(0, 0.14, sz);
      g.add(handle);
    }
    this.group.add(g);
  }

  /**
   * Playful handcrafted kids' Sandcastle with 4 corner towers, battlements, red flag & plastic sand bucket!
   */
  private buildSandcastle(): void {
    const sx = -11.6;
    const sz = -6.8;
    const sy = getTerrainHeight(sx, sz);
    const g = new THREE.Group();
    g.position.set(sx, sy - 0.02, sz);

    const wetSandMat = new THREE.MeshStandardMaterial({ color: 0xb0936a, roughness: 0.95 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.34, 0.95), wetSandMat);
    base.position.y = 0.17;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    const towerGeo = new THREE.CylinderGeometry(0.16, 0.20, 0.56, 10);
    const roofGeo = new THREE.ConeGeometry(0.17, 0.20, 10);
    for (const tx of [-0.42, 0.42]) {
      for (const tz of [-0.42, 0.42]) {
        const t = new THREE.Mesh(towerGeo, wetSandMat);
        t.position.set(tx, 0.28, tz);
        t.castShadow = true;
        g.add(t);
        const r = new THREE.Mesh(roofGeo, wetSandMat);
        r.position.set(tx, 0.65, tz);
        g.add(r);
      }
    }
    // Central keep + mini red pennant flag
    const keep = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.68, 12), wetSandMat);
    keep.position.y = 0.34;
    keep.castShadow = true;
    g.add(keep);

    const stick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.42, 5),
      new THREE.MeshStandardMaterial({ color: 0x8b6844, roughness: 0.9 })
    );
    stick.position.y = 0.84;
    g.add(stick);
    const flag = new THREE.Mesh(
      new THREE.ConeGeometry(0.075, 0.18, 3),
      new THREE.MeshStandardMaterial({ color: 0xe63946, roughness: 0.6, side: THREE.DoubleSide })
    );
    flag.rotation.z = -Math.PI / 2;
    flag.position.set(0.09, 0.98, 0);
    g.add(flag);

    // Bright yellow plastic beach bucket & blue shovel resting beside the sandcastle
    const bucket = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.10, 0.22, 12),
      new THREE.MeshStandardMaterial({ color: 0xffca3a, roughness: 0.38 })
    );
    bucket.position.set(0.88, 0.11, 0.35);
    bucket.castShadow = true;
    g.add(bucket);

    const shovel = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.02, 0.36),
      new THREE.MeshStandardMaterial({ color: 0x2299c8, roughness: 0.4 })
    );
    shovel.position.set(0.74, 0.04, 0.62);
    shovel.rotation.y = 0.55;
    g.add(shovel);

    this.group.add(g);
    addCollider(sx, sz, 0.72, 0.8);
  }

  /**
   * Western Cove Beach Bonfire Ring with river stones, charred logs, driftwood seating & warm dusk embers!
   */
  private buildBonfirePit(): void {
    const fx = -38.5;
    const fz = -19.2;
    const fy = getTerrainHeight(fx, fz);
    this.bonfireHaloPos.set(fx, fy + 0.42, fz);
    const g = new THREE.Group();
    g.position.set(fx, fy, fz);

    // Real photoscanned Poly Haven stone_fire_pit is loaded cleanly around (-38.5, -19.2) in CoastalModels.ts!
    const logMat = new THREE.MeshStandardMaterial({ color: 0x3b2c20, roughness: 0.95 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.95, 7), logMat);
      log.position.set(Math.cos(a) * 0.16, 0.30, Math.sin(a) * 0.16);
      log.rotation.set(Math.sin(a) * 0.65, a, -Math.cos(a) * 0.65);
      g.add(log);
    }

    const emberMat = new THREE.MeshStandardMaterial({
      color: 0xff922b,
      emissive: 0xff5a14,
      emissiveIntensity: 1.65
    });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.58, 8), emberMat);
    flame.position.y = 0.42;
    flame.userData.dynamic = true;
    g.add(flame);
    this.bonfireFlame = flame;

    const light = new THREE.PointLight(0xff8c3b, 0.3, 14, 1.7);
    light.position.y = 0.92;
    light.visible = false; // Zero PBR fragment cost during bright midday sun
    g.add(light);
    this.bonfireLight = light;

    // 2 rustic textured driftwood seating benches positioned cleanly outside the stone pit rim
    const benchPbr = loadPbrSet('weathered_brown_planks', 2, 1);
    const benchMat = new THREE.MeshStandardMaterial({
      map: benchPbr.map,
      normalMap: benchPbr.normalMap,
      roughnessMap: benchPbr.roughnessMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
      color: 0xbba88f,
      roughness: 0.94
    });
    const yAxis = new THREE.Vector3(0, 1, 0);
    for (const ang of [-1.05, 0.85]) {
      const cx = fx + Math.cos(ang) * 2.55;
      const cz = fz + Math.sin(ang) * 2.55;
      const tx = -Math.sin(ang);
      const tz = Math.cos(ang);
      const e1x = cx - tx * 0.95;
      const e1z = cz - tz * 0.95;
      const e2x = cx + tx * 0.95;
      const e2z = cz + tz * 0.95;
      const h1 = getTerrainHeight(e1x, e1z);
      const h2 = getTerrainHeight(e2x, e2z);
      const hc = getTerrainHeight(cx, cz);

      const bench = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.21, 2.05, 9), benchMat);
      bench.position.set(cx - fx, Math.max((h1 + h2) * 0.5, hc) + 0.14 - fy, cz - fz);
      const dir3D = new THREE.Vector3(e2x - e1x, h2 - h1, e2z - e1z).normalize();
      bench.quaternion.setFromUnitVectors(yAxis, dir3D);
      bench.castShadow = true;
      bench.receiveShadow = true;
      g.add(bench);
    }

    this.group.add(g);
    addCollider(fx, fz, 1.15, 0.8);
  }

  /**
   * Woven seaside yoga & morning-stretch mats nestled cleanly onto East Beach sand!
   */
  private buildYogaMats(): void {
    const mats: Array<[number, number, number, string, string]> = [
      [28.5, -16.5, 0.08, '#2ec4b6', '#ffffff'],
      [30.5, -16.2, -0.06, '#e76f51', '#f4f1de']
    ];
    for (const [mx, mz, yaw, colA, colB] of mats) {
      const mat = new THREE.MeshStandardMaterial({
        map: createStripedTexture(colA, colB, 8),
        roughness: 0.92,
        side: THREE.DoubleSide
      });
      const geo = new THREE.PlaneGeometry(0.88, 1.92, 8, 14);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      for (let i = 0; i < pos.count; i++) {
        const lx = pos.getX(i);
        const lz = pos.getZ(i);
        const wx = mx + lx * cosY + lz * sinY;
        const wz = mz - lx * sinY + lz * cosY;
        pos.setXYZ(i, wx, getTerrainHeight(wx, wz) + 0.025, wz);
      }
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /**
   * 97 procedural coastal seashells (scallop fans, ribbed turret cones) & seabed starfish!
   */
  private buildSeashellsAndStarfish(): void {
    let seed = 5519;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    // 1. Scallop fan shell
    const pos: number[] = [];
    const idx: number[] = [];
    const A = 6;
    const R = 3;
    for (let i = 0; i <= R; i++) {
      for (let j = 0; j <= A; j++) {
        const r = i / R;
        const a = ((j / A) * 2 - 1) * 1.25;
        pos.push(
          Math.sin(a) * r,
          0.26 * Math.sin(Math.PI * r * 0.85) + 0.032 * Math.cos(a * 14) * r,
          Math.cos(a) * r - 0.4
        );
      }
    }
    for (let i = 0; i < R; i++) {
      for (let j = 0; j < A; j++) {
        const k = i * (A + 1) + j;
        idx.push(k, k + 1, k + A + 1, k + 1, k + A + 2, k + A + 1);
      }
    }
    const scallop = new THREE.BufferGeometry();
    scallop.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    scallop.setIndex(idx);
    scallop.computeVertexNormals();

    // 2. Ribbed spiral turret shell
    const turret = new THREE.ConeGeometry(0.32, 1.2, 5, 2);
    const tp = turret.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < tp.count; i++) {
      const y = tp.getY(i);
      const k = 1 + 0.16 * Math.sin(y * 22);
      tp.setX(i, tp.getX(i) * k);
      tp.setZ(i, tp.getZ(i) * k);
    }
    turret.rotateZ(Math.PI / 2 - 0.12);
    turret.translate(0, 0.25, 0);
    turret.computeVertexNormals();

    // 3. Beveled 5-arm coastal starfish
    const st = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const r = i % 2 ? 0.34 : 1.0;
      if (i === 0) st.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else st.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const star = new THREE.ExtrudeGeometry(st, {
      depth: 0.08,
      bevelEnabled: true,
      bevelSize: 0.08,
      bevelThickness: 0.10,
      bevelSegments: 1
    }).rotateX(-Math.PI / 2);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const c = new THREE.Color();

    const scatter = (
      geo: THREE.BufferGeometry,
      count: number,
      sizeRange: [number, number],
      palette: number[],
      roughness: number,
      inWater: boolean
    ) => {
      const mat = new THREE.MeshStandardMaterial({ roughness, side: THREE.DoubleSide });
      const inst = new THREE.InstancedMesh(geo, mat, count);
      for (let i = 0; i < count; i++) {
        const sx = (rnd() - 0.5) * 112;
        const offset = inWater ? 1.5 + rnd() * 20 : -5.5 + rnd() * rnd() * 6.5;
        const curveZ = 0.0014 * sx * sx - 1.25 * Math.sin(sx * 0.036) - 0.55 * Math.cos(sx * 0.075);
        const sz = curveZ + offset;
        const sc = sizeRange[0] + rnd() * (sizeRange[1] - sizeRange[0]);
        e.set((rnd() - 0.5) * 0.28, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.28);
        q.setFromEuler(e);
        m.compose(
          new THREE.Vector3(sx, getTerrainHeight(sx, sz) + sc * 0.04, sz),
          q,
          new THREE.Vector3(sc, sc, sc)
        );
        inst.setMatrixAt(i, m);
        inst.setColorAt(i, c.setHex(palette[Math.floor(rnd() * palette.length)]));
      }
      inst.castShadow = false;
      inst.receiveShadow = true;
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      (inWater ? this.waterPropsGroup : this.group).add(inst);
    };

    scatter(scallop, 55, [0.045, 0.085], [0xf3e3d0, 0xf0c9b8, 0xe8a98c, 0xfff5e6], 0.45, false);
    scatter(turret, 30, [0.04, 0.07], [0xe9dcc6, 0xcdb79a, 0xf5ead8], 0.50, false);
    scatter(star, 12, [0.08, 0.13], [0xd9532b, 0xe07a3f, 0xb8402a], 0.78, true);
  }

  /**
   * Subtle natural shoreline tide-line pebbles & damp seaweed wrack tufts near driftwood!
   */
  private buildTideLineClutter(): void {
    const pebbleGeo = new THREE.SphereGeometry(0.065, 7, 5);
    const pebbleMat = new THREE.MeshStandardMaterial({ color: 0x8e867a, roughness: 0.92 });
    const pebbleCoords: Array<[number, number, number]> = [
      [-34.6, -6.9, 1.1], [-33.9, -7.4, 0.8], [-35.5, -7.8, 1.3],
      [38.5, -7.1, 1.0], [39.6, -7.9, 1.2], [37.9, -6.4, 0.9],
      [-48.2, -11.2, 1.4], [47.5, -10.8, 1.3], [-22.4, -3.6, 0.8],
      [12.4, -4.1, 0.9], [-2.8, -3.9, 0.7], [28.2, -4.4, 1.0]
    ];
    const inst = new THREE.InstancedMesh(pebbleGeo, pebbleMat, pebbleCoords.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < pebbleCoords.length; i++) {
      const [px, pz, sc] = pebbleCoords[i];
      dummy.position.set(px, getTerrainHeight(px, pz) + 0.01, pz);
      dummy.rotation.set(0, i * 1.4, 0);
      dummy.scale.set(sc * 1.3, sc * 0.45, sc);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    this.group.add(inst);
  }

  /**
   * Sunken weathered iron ship anchor & chain links resting on the turquoise seabed near the Ocean Pier!
   */
  private buildSunkenAnchor(): void {
    const ax = 17.5;
    const az = 24.5;
    const ay = getTerrainHeight(ax, az);
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x454e52, roughness: 0.88, metalness: 0.35 });

    const g = new THREE.Group();
    g.position.set(ax, ay + 0.18, az);
    g.rotation.set(0.28, 0.8, 1.15);

    const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.085, 1.75, 8), ironMat);
    g.add(shank);
    const stock = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.05, 8), ironMat);
    stock.rotation.z = Math.PI / 2;
    stock.position.y = 0.62;
    g.add(stock);
    const crown = new THREE.Mesh(new THREE.TorusGeometry(0.54, 0.065, 7, 14, Math.PI), ironMat);
    crown.rotation.z = Math.PI;
    crown.position.y = -0.35;
    g.add(crown);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 12), ironMat);
    ring.position.y = 0.96;
    g.add(ring);

    this.waterPropsGroup.add(g);
  }

  private buildBeachFrisbee(): THREE.Mesh {
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xff595e,
      roughness: 0.24,
      clearcoat: 0.8
    });
    const frisbee = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.18, 0.032, 16), mat);
    frisbee.castShadow = true;
    frisbee.position.set(38.0, 2.0, -7.8);
    frisbee.userData.dynamic = true;
    this.group.add(frisbee);
    return frisbee;
  }

  public update(
    elapsedTime: number,
    waveIntensity: number,
    sunDirection: THREE.Vector3,
    sunColor: THREE.Color,
    dt = 0.016,
    playerPos?: THREE.Vector3,
    playerVel?: THREE.Vector3
  ): void {
    for (let i = 0; i < this.causticMaterials.length; i++) {
      const u = this.causticMaterials[i].uniforms;
      u.uTime.value = elapsedTime;
      u.uSunDirection.value.copy(sunDirection);
      u.uSunColor.value.copy(sunColor);
    }

    for (let i = 0; i < this.buoys.length; i++) {
      const b = this.buoys[i];
      const h = sampleWaveHeight(b.x, b.z, elapsedTime, waveIntensity, getTerrainHeight(b.x, b.z));
      const hx = sampleWaveHeight(b.x + 0.5, b.z, elapsedTime, waveIntensity, -2.5);
      const hz = sampleWaveHeight(b.x, b.z + 0.5, elapsedTime, waveIntensity, -2.5);
      b.mesh.position.y = h - 0.05;
      b.mesh.rotation.z = -(hx - h) * 0.75;
      b.mesh.rotation.x = (hz - h) * 0.75;
    }

    // Dynamic buoyant interactive Pink/White Swim Ring — floats proudly flat on waves & glides when bumped!
    if (this.floatRingMesh) {
      if (!this.floatRingRiderActive) {
        if (playerPos && playerVel) {
          const dx = this.floatRingPos.x - playerPos.x;
          const dz = this.floatRingPos.z - playerPos.z;
          const d = Math.hypot(dx, dz);
          if (d < 1.05 && d > 0.02 && playerPos.y < 1.2) {
            const push = (1.05 - d) * 3.8;
            this.floatRingVel.x += (dx / d) * push * dt + playerVel.x * 0.35 * dt;
            this.floatRingVel.y += (dz / d) * push * dt + playerVel.z * 0.35 * dt;
          }
        }
        // Gentle orbital swell drift & water drag
        const rTerr = getTerrainHeight(this.floatRingPos.x, this.floatRingPos.z);
        const rh = sampleWaveHeight(this.floatRingPos.x, this.floatRingPos.z, elapsedTime, waveIntensity, rTerr);
        const rhx = sampleWaveHeight(this.floatRingPos.x + 0.55, this.floatRingPos.z, elapsedTime, waveIntensity, rTerr);
        const rhz = sampleWaveHeight(this.floatRingPos.x, this.floatRingPos.z + 0.55, elapsedTime, waveIntensity, rTerr);
        this.floatRingVel.x += -(rhx - rh) * 0.65 * dt;
        this.floatRingVel.y += -(rhz - rh) * 0.65 * dt;
        const damp = Math.exp(-1.6 * dt);
        this.floatRingVel.multiplyScalar(damp);
        this.floatRingPos.x = THREE.MathUtils.clamp(this.floatRingPos.x + this.floatRingVel.x * dt, -48.0, 48.0);
        this.floatRingPos.z = THREE.MathUtils.clamp(this.floatRingPos.z + this.floatRingVel.y * dt, 5.2, 42.0);
        this.floatRingPos.y = rh + 0.055;
        this.floatRingMesh.position.copy(this.floatRingPos);
        this.floatRingMesh.rotation.set((rhz - rh) * 0.85, elapsedTime * 0.22, -(rhx - rh) * 0.85);
      }
    }

    const dusk = 1.0 - THREE.MathUtils.smoothstep(sunDirection.y, 0.08, 0.45);
    if (this.bonfireFlame) {
      const f = 0.85 + 0.25 * Math.sin(elapsedTime * 11.5);
      this.bonfireFlame.scale.set(0.9 + 0.15 * Math.cos(elapsedTime * 8.0), f * (0.65 + dusk * 0.75), 0.9 + 0.15 * Math.sin(elapsedTime * 9.5));
    }
    if (this.bonfireLight) {
      this.bonfireLight.visible = dusk > 0.05;
      this.bonfireLight.intensity = dusk * 3.8 + Math.sin(elapsedTime * 13.0) * 0.18 * dusk;
    }
  }
}
