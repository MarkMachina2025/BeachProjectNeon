import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { addCollider, getTerrainHeight, getTerrainNormal } from '../terrain/terrainMath';
import { sampleWaveHeight } from '../ocean/wavePhysics';
import { CAUSTICS_GLSL } from '../shaders/causticsChunk';

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
  // Subtle woven linen noise
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
  // Center racing stringer & accent stripe
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
 * Cohesive grounded coastal props & formations:
 *  - Sculpted coastal boulders & underwater reef rocks (with wet-line + animated caustics)
 *  - Striped beach umbrellas, wooden lounge chairs, terrain-conforming beach towels
 *  - Hard-shell beach coolers, glossy surfboards, seashells, starfish, weathered driftwood
 *  - Bobbing marine buoy in the bay
 */
export class BeachProps {
  public readonly group = new THREE.Group();
  public readonly restSpots: RestSpot[] = [];

  private readonly causticMaterials: CustomShaderMaterial[] = [];
  private readonly buoys: Array<{ mesh: THREE.Object3D; x: number; z: number }> = [];

  constructor() {
    this.group.name = 'BeachProps';

    this.buildCoastalBoulders();
    this.buildBeachCamps();
    this.buildSurfboards();
    this.buildDriftwood();
    this.buildSeashells();
    this.buildFloatingBuoys();
  }

  private createRockMaterial(baseColorHex: number): CustomShaderMaterial {
    const mat = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      color: baseColorHex,
      roughness: 0.86,
      metalness: 0.02,
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

        float rockNoise(vec3 p) {
          return fract(sin(dot(floor(p), vec3(12.9898, 78.233, 45.164))) * 43758.5453);
        }

        void main() {
          vec3 n = normalize(vWorldNormal);
          // Natural wet-tide darkening band near y <= 0.45
          float wetBand = smoothstep(0.65, -0.05, vWorldPos.y);
          // Subtle warm coastal lichen/algae tint on upward faces near waterline
          float algae = smoothstep(0.35, -0.25, vWorldPos.y) * smoothstep(-1.4, -0.1, vWorldPos.y) * clamp(n.y, 0.0, 1.0);

          vec3 col = csm_DiffuseColor.rgb;
          float strata = sin(vWorldPos.y * 4.5 + vWorldPos.x * 0.7) * 0.07;
          col += vec3(strata);
          col = mix(col, col * vec3(0.46, 0.44, 0.42), wetBand * 0.72);
          col = mix(col, vec3(0.18, 0.28, 0.16), algae * 0.42);

          csm_DiffuseColor = vec4(col, 1.0);
          csm_Roughness = mix(0.86, 0.22, wetBand);

          vec3 caustics = computeUnderwaterCaustics(vWorldPos, n, uSunDirection, 0.08, uTime);
          csm_Emissive = caustics * uSunColor * 0.56;
        }
      `
    });
    this.causticMaterials.push(mat);
    return mat;
  }

  private createSculptedBoulderGeo(radius: number, seed: number): THREE.BufferGeometry {
    // Use indexed SphereGeometry so computeVertexNormals produces smooth organic coastal stone
    const geo = new THREE.SphereGeometry(radius, 24, 18);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n1 = Math.sin(v.x * 1.7 + seed) * Math.cos(v.y * 1.9 - seed * 0.7) * Math.sin(v.z * 1.5 + seed * 1.3);
      const n2 = Math.cos(v.x * 3.8 - seed) * Math.sin(v.z * 3.4 + seed * 0.5);
      const disp = 1.0 + n1 * 0.24 + n2 * 0.09;
      v.multiplyScalar(disp);
      // Flatten underside slightly so rock sits solidly embedded in sand
      if (v.y < 0) v.y *= 0.65;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    return geo;
  }

  private buildCoastalBoulders(): void {
    const rockMat = this.createRockMaterial(0x7c746a);
    const reefMat = this.createRockMaterial(0x63665f);

    // Coastal boulders framing left & right coves + picturesque shoreline outcrops
    const coastalRocks: Array<[number, number, number, number, number, number]> = [
      // [x, z, rx, ry, rz, seed]
      [-32, -4, 3.6, 2.3, 3.1, 1.2],
      [-28.5, -0.5, 2.2, 1.5, 2.0, 2.4],
      [-35, 3, 4.4, 2.8, 3.8, 3.1],
      [-26, 4.5, 1.6, 1.05, 1.4, 4.5],
      [31, -3, 3.9, 2.4, 3.3, 5.2],
      [27.5, 1.2, 2.1, 1.35, 1.9, 6.1],
      [34.5, 5.5, 4.8, 3.1, 4.0, 7.3],
      [24.5, 5.8, 1.45, 0.95, 1.3, 8.4],
      [-18.5, -18.5, 1.8, 1.15, 1.5, 9.2],
      [20.5, -17.5, 2.0, 1.25, 1.6, 10.1]
    ];

    for (const [x, z, rx, ry, rz, seed] of coastalRocks) {
      const geo = this.createSculptedBoulderGeo(1.0, seed);
      const rock = new THREE.Mesh(geo, rockMat);
      const h = getTerrainHeight(x, z);
      rock.position.set(x, h + ry * 0.34, z);
      rock.scale.set(rx, ry, rz);
      rock.rotation.y = seed * 1.7;
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.group.add(rock);
      addCollider(x, z, Math.max(rx, rz) * 0.85, ry * 1.4);
    }

    // Underwater reef boulders cleanly submerged along the deeper sandbar drop-off for dramatic diving & caustics
    const reefRocks: Array<[number, number, number, number, number, number]> = [
      [-12, 26, 2.2, 1.25, 2.0, 11.4],
      [-6, 30, 2.8, 1.6, 2.4, 12.8],
      [4, 28, 2.4, 1.35, 2.1, 13.5],
      [11, 33, 3.0, 1.85, 2.6, 14.2],
      [-1, 36, 3.4, 2.1, 3.0, 15.1],
      [-16, 34, 2.7, 1.7, 2.4, 16.3],
      [17, 29, 2.1, 1.2, 1.8, 17.6],
      [2, 24.5, 1.4, 0.8, 1.3, 18.2],
      [-9, 23.5, 1.3, 0.75, 1.2, 19.4]
    ];

    for (const [x, z, rx, ry, rz, seed] of reefRocks) {
      const geo = this.createSculptedBoulderGeo(1.0, seed);
      const rock = new THREE.Mesh(geo, reefMat);
      const h = getTerrainHeight(x, z);
      rock.position.set(x, h + ry * 0.26, z);
      rock.scale.set(rx, ry, rz);
      rock.rotation.y = seed * 2.1;
      rock.receiveShadow = true;
      this.group.add(rock);
      addCollider(x, z, Math.max(rx, rz) * 0.82, ry * 1.2);
    }
  }

  private buildBeachCamps(): void {
    const woodMat = new THREE.MeshStandardMaterial({ color: 0xb68452, roughness: 0.72 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0xd9e1e8, roughness: 0.28, metalness: 0.82 });

    const palettes: Array<{ a: string; b: string; cooler: number; towelA: string; towelB: string }> = [
      { a: '#e05344', b: '#fff8ee', cooler: 0x2692b8, towelA: '#2cb5b0', towelB: '#f7f1e3' },
      { a: '#218b9b', b: '#fffaf0', cooler: 0xe66a42, towelA: '#f2b84b', towelB: '#fff9ed' },
      { a: '#ebb038', b: '#fff8ec', cooler: 0x3b6ea5, towelA: '#df5f6e', towelB: '#fff6ee' },
      { a: '#2c4f7c', b: '#f7f4ec', cooler: 0x2da37a, towelA: '#4696c8', towelB: '#f5f5f5' }
    ];

    const campConfigs: Array<{ x: number; z: number; yaw: number; hasChair: boolean; hasTowel: boolean; hasCooler: boolean }> = [
      { x: -13.5, z: -10.5, yaw: 0.28, hasChair: true, hasTowel: true, hasCooler: true },
      { x: -5.5, z: -12.5, yaw: 0.10, hasChair: false, hasTowel: true, hasCooler: true },
      { x: 7.5, z: -11.5, yaw: -0.22, hasChair: true, hasTowel: true, hasCooler: true },
      { x: 15.8, z: -9.8, yaw: -0.35, hasChair: true, hasTowel: false, hasCooler: false }
    ];

    campConfigs.forEach((cfg, idx) => {
      const pal = palettes[idx % palettes.length];
      this.placeUmbrella(cfg.x, cfg.z, cfg.yaw, pal.a, pal.b, woodMat, metalMat);

      const cosY = Math.cos(cfg.yaw);
      const sinY = Math.sin(cfg.yaw);

      if (cfg.hasChair) {
        const cx = cfg.x + cosY * 1.55;
        const cz = cfg.z - sinY * 1.55 + 0.4;
        this.placeLoungeChair(cx, cz, cfg.yaw, pal.a, pal.b, woodMat);
        this.restSpots.push({
          position: new THREE.Vector3(cx, getTerrainHeight(cx, cz), cz),
          yaw: cfg.yaw,
          kind: 'chair'
        });
      }

      if (cfg.hasTowel) {
        const tx = cfg.x - cosY * 1.65;
        const tz = cfg.z + sinY * 1.65 + 0.55;
        this.placeBeachTowel(tx, tz, cfg.yaw + 0.08, pal.towelA, pal.towelB);
        this.restSpots.push({
          position: new THREE.Vector3(tx, getTerrainHeight(tx, tz), tz),
          yaw: cfg.yaw + 0.08,
          kind: 'towel'
        });
      }

      if (cfg.hasCooler) {
        const kx = cfg.x + sinY * 1.0 + cosY * 0.4;
        const kz = cfg.z - cosY * 1.1;
        this.placeCooler(kx, kz, cfg.yaw + 0.45, pal.cooler);
      }
    });
  }

  private placeUmbrella(
    x: number,
    z: number,
    yaw: number,
    colA: string,
    colB: string,
    woodMat: THREE.Material,
    metalMat: THREE.Material
  ): void {
    const group = new THREE.Group();
    const y = getTerrainHeight(x, z);
    group.position.set(x, y - 0.08, z);
    group.rotation.y = yaw;
    group.rotation.z = 0.11; // classic breezy coastal tilt toward sun

    // Wooden pole
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 2.55, 10), woodMat);
    pole.position.y = 1.25;
    pole.castShadow = true;
    pole.receiveShadow = true;
    group.add(pole);

    // Finial cap
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), woodMat);
    cap.position.y = 2.58;
    group.add(cap);

    // Octagonal curved canvas canopy with subtle striped texture
    const canopyTex = createStripedTexture(colA, colB, 16);
    const canopyMat = new THREE.MeshStandardMaterial({
      map: canopyTex,
      roughness: 0.82,
      side: THREE.DoubleSide
    });

    const canopyGeo = new THREE.ConeGeometry(1.55, 0.52, 8, 4, true);
    const pos = canopyGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const py = pos.getY(i);
      const px = pos.getX(i);
      const pz = pos.getZ(i);
      const r = Math.hypot(px, pz) / 1.55;
      // Gentle dome curve
      const dome = Math.sin(r * Math.PI * 0.5) * 0.14;
      pos.setY(i, py + dome);
    }
    canopyGeo.computeVertexNormals();

    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.y = 2.28;
    canopy.castShadow = true;
    canopy.receiveShadow = true;
    group.add(canopy);

    // Scalloped hanging valance rim flush with arched canopy edge
    const valanceGeo = new THREE.CylinderGeometry(1.54, 1.56, 0.18, 8, 1, true);
    const valance = new THREE.Mesh(valanceGeo, canopyMat);
    valance.position.y = 2.09;
    valance.castShadow = true;
    group.add(valance);

    // Underside metal ribs
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
    stripeA: string,
    stripeB: string,
    woodMat: THREE.Material
  ): void {
    const group = new THREE.Group();
    const y = getTerrainHeight(x, z);
    const n = getTerrainNormal(x, z);

    group.position.set(x, y, z);
    // Align chair base to terrain slope then rotate around local Y
    const alignQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    group.quaternion.copy(alignQ).multiply(yawQ);

    // Wooden frame rails
    const frameW = 0.72;
    const frameL = 1.92;
    const seatH = 0.34;

    for (const sx of [-frameW * 0.46, frameW * 0.46]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.06, frameL), woodMat);
      rail.position.set(sx, seatH, 0);
      rail.castShadow = true;
      rail.receiveShadow = true;
      group.add(rail);

      // 4 sturdy legs embedded slightly into sand
      for (const lz of [-0.72, 0.72]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.055, seatH + 0.08, 0.055), woodMat);
        leg.position.set(sx, (seatH - 0.04) * 0.5, lz);
        leg.castShadow = true;
        group.add(leg);
      }

      // Armrests
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.035, 0.78), woodMat);
      arm.position.set(sx, seatH + 0.22, -0.22);
      arm.castShadow = true;
      group.add(arm);
    }

    // Wooden horizontal slats (lower leg section)
    for (let s = 0; s < 7; s++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(frameW - 0.06, 0.024, 0.13), woodMat);
      slat.position.set(0, seatH + 0.025, 0.06 + s * 0.155);
      slat.castShadow = true;
      slat.receiveShadow = true;
      group.add(slat);
    }

    // Reclining backrest
    const backGroup = new THREE.Group();
    backGroup.position.set(0, seatH + 0.03, -0.14);
    backGroup.rotation.x = -0.52; // tilted back cleanly
    for (let s = 0; s < 5; s++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(frameW - 0.06, 0.024, 0.125), woodMat);
      slat.position.set(0, 0, -0.12 - s * 0.15);
      slat.castShadow = true;
      slat.receiveShadow = true;
      backGroup.add(slat);
    }

    // Soft striped cushion pad & headrest pillow
    const cushionMat = new THREE.MeshStandardMaterial({
      map: createStripedTexture(stripeA, stripeB, 6),
      roughness: 0.88
    });
    const backPad = new THREE.Mesh(new THREE.BoxGeometry(frameW - 0.12, 0.055, 0.76), cushionMat);
    backPad.position.set(0, 0.04, -0.44);
    backPad.castShadow = true;
    backPad.receiveShadow = true;
    backGroup.add(backPad);

    const pillow = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.36, 6, 10), cushionMat);
    pillow.rotation.z = Math.PI / 2;
    pillow.position.set(0, 0.11, -0.72);
    pillow.castShadow = true;
    backGroup.add(pillow);

    group.add(backGroup);

    const seatPad = new THREE.Mesh(new THREE.BoxGeometry(frameW - 0.12, 0.055, 1.06), cushionMat);
    seatPad.position.set(0, seatH + 0.065, 0.45);
    seatPad.castShadow = true;
    seatPad.receiveShadow = true;
    group.add(seatPad);

    this.group.add(group);
    addCollider(x, z, 0.65, 0.9);
  }

  private placeBeachTowel(x: number, z: number, yaw: number, colA: string, colB: string): void {
    const w = 1.05;
    const l = 2.05;
    const geo = new THREE.PlaneGeometry(w, l, 12, 20);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);

    // Conform every vertex directly to the sculpted sand contour!
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const lz = pos.getZ(i);
      const wx = x + lx * cosY + lz * sinY;
      const wz = z - lx * sinY + lz * cosY;
      const ripple = Math.sin(lx * 7.0 + lz * 5.0) * 0.008;
      const wy = getTerrainHeight(wx, wz) + 0.022 + ripple;
      pos.setXYZ(i, wx, wy, wz);
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      map: createStripedTexture(colA, colB, 10),
      roughness: 0.92,
      side: THREE.DoubleSide
    });
    const towel = new THREE.Mesh(geo, mat);
    towel.receiveShadow = true;
    towel.castShadow = true;
    this.group.add(towel);
  }

  private placeCooler(x: number, z: number, yaw: number, bodyHex: number): void {
    const group = new THREE.Group();
    const y = getTerrainHeight(x, z);
    const n = getTerrainNormal(x, z);
    group.position.set(x, y - 0.02, z);

    const alignQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    group.quaternion.copy(alignQ).multiply(yawQ);

    const bodyMat = new THREE.MeshStandardMaterial({ color: bodyHex, roughness: 0.32, metalness: 0.05 });
    const lidMat = new THREE.MeshStandardMaterial({ color: 0xf6f8fa, roughness: 0.28, metalness: 0.04 });
    const latchMat = new THREE.MeshStandardMaterial({ color: 0xdbe3ea, roughness: 0.25, metalness: 0.85 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.36, 0.38), bodyMat);
    body.position.y = 0.18;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.075, 0.41), lidMat);
    lid.position.y = 0.39;
    lid.castShadow = true;
    lid.receiveShadow = true;
    group.add(lid);

    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.03), latchMat);
    latch.position.set(0, 0.34, 0.205);
    group.add(latch);

    // Cold summer cup perched on cooler lid
    const cupMat = new THREE.MeshStandardMaterial({ color: 0xff6b57, roughness: 0.35 });
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.032, 0.13, 10), cupMat);
    cup.position.set(0.16, 0.49, 0.04);
    cup.castShadow = true;
    group.add(cup);

    this.group.add(group);
    addCollider(x, z, 0.38, 0.5);
  }

  private buildSurfboards(): void {
    const createBoardGeo = () => {
      // Sculpted elliptical-tapered fiberglass surfboard
      const geo = new THREE.SphereGeometry(1, 18, 22);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i);
        let y = pos.getY(i);
        let z = pos.getZ(i);
        // Scale to 0.54m wide, 2.25m tall, 0.07m thick
        const taper = 1.0 - Math.pow(Math.max(0, y), 1.8) * 0.32 - Math.pow(Math.max(0, -y), 2.0) * 0.22;
        x *= 0.27 * taper;
        const rocker = y * y * 0.055;
        z = z * 0.036 + rocker;
        y *= 1.12;
        pos.setXYZ(i, x, y, z);
      }
      geo.computeVertexNormals();
      return geo;
    };

    const boardGeo = createBoardGeo();
    const finGeo = new THREE.ConeGeometry(0.06, 0.16, 4);
    const finMat = new THREE.MeshStandardMaterial({ color: 0x1e252c, roughness: 0.35 });

    const boards: Array<{ x: number; z: number; yaw: number; upright: boolean; base: string; stripe: string }> = [
      { x: -10.4, z: -7.8, yaw: 0.35, upright: true, base: '#fef6e4', stripe: '#22b5b0' },
      { x: -9.6, z: -8.3, yaw: 0.62, upright: true, base: '#ffd166', stripe: '#ef476f' },
      { x: 11.4, z: -8.0, yaw: -0.42, upright: true, base: '#ffffff', stripe: '#118ab2' },
      { x: 3.6, z: -7.4, yaw: 0.85, upright: false, base: '#f78c6b', stripe: '#073b4c' }
    ];

    for (const b of boards) {
      const mat = new THREE.MeshPhysicalMaterial({
        map: createSurfboardTexture(b.base, b.stripe),
        roughness: 0.16,
        clearcoat: 0.85,
        clearcoatRoughness: 0.12
      });

      const board = new THREE.Mesh(boardGeo, mat);
      const y = getTerrainHeight(b.x, b.z);
      board.castShadow = true;
      board.receiveShadow = true;

      const fin = new THREE.Mesh(finGeo, finMat);
      fin.position.set(0, -0.78, -0.07);
      fin.rotation.x = -Math.PI * 0.45;
      board.add(fin);

      if (b.upright) {
        board.position.set(b.x, y + 0.82, b.z);
        board.rotation.set(-0.14, b.yaw, 0.08);
        addCollider(b.x, b.z, 0.32, 1.9);
      } else {
        board.position.set(b.x, y + 0.07, b.z);
        board.rotation.set(Math.PI / 2 - 0.08, b.yaw, 0.06);
        addCollider(b.x, b.z, 0.42, 0.35);
      }
      this.group.add(board);
    }
  }

  private buildDriftwood(): void {
    const driftMat = new THREE.MeshStandardMaterial({
      color: 0xa49684,
      roughness: 0.94,
      metalness: 0.0
    });

    const logs: Array<[number, number, number, number]> = [
      [-18.5, -5.2, 0.42, 3.2],
      [18.8, -5.8, -0.58, 3.6],
      [-2.8, -14.2, 1.25, 2.5],
      [22.0, -10.5, 0.15, 2.8]
    ];

    for (const [x, z, yaw, len] of logs) {
      const pts = [
        new THREE.Vector3(-len * 0.5, 0.02, 0),
        new THREE.Vector3(-len * 0.15, 0.14, 0.18),
        new THREE.Vector3(len * 0.2, 0.08, -0.14),
        new THREE.Vector3(len * 0.5, -0.04, 0.10)
      ];
      const curve = new THREE.CatmullRomCurve3(pts);
      const geo = new THREE.TubeGeometry(curve, 14, 0.16, 7, false);
      const mesh = new THREE.Mesh(geo, driftMat);
      const y = getTerrainHeight(x, z);
      mesh.position.set(x, y + 0.05, z);
      mesh.rotation.y = yaw;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      addCollider(x, z, len * 0.28, 0.45);
    }
  }

  private buildSeashells(): void {
    const shellGeo = new THREE.ConeGeometry(0.065, 0.13, 7);
    shellGeo.rotateZ(Math.PI / 2);

    const shellColors = [0xf7ede2, 0xf2c6b6, 0xead2ac, 0xd8a79c, 0xf4e4d7];
    const shellCount = 90;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.04 });
    const inst = new THREE.InstancedMesh(shellGeo, mat, shellCount);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    let s = 9182;
    const rnd = () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };

    for (let i = 0; i < shellCount; i++) {
      const x = (rnd() - 0.5) * 48;
      // Cluster near the high-tide wrack line
      const z = -5.8 + rnd() * 6.8 + 0.0042 * x * x;
      const y = getTerrainHeight(x, z);
      dummy.position.set(x, y + 0.022, z);
      dummy.rotation.set(rnd() * 0.6, rnd() * Math.PI * 2, rnd() * 0.4);
      const sc = 0.65 + rnd() * 1.05;
      dummy.scale.set(sc, sc * 0.6, sc);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      color.setHex(shellColors[i % shellColors.length]);
      inst.setColorAt(i, color);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.receiveShadow = true;
    this.group.add(inst);
  }

  private buildFloatingBuoys(): void {
    const buoyCoords: Array<[number, number]> = [
      [-14, 19],
      [15, 21]
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
      dome.castShadow = true;
      b.add(dome);

      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 8, 14), metalMat);
      ring.position.y = 0.68;
      b.add(ring);

      b.position.set(bx, 0, bz);
      this.group.add(b);
      this.buoys.push({ mesh: b, x: bx, z: bz });
    }
  }

  public update(
    elapsedTime: number,
    waveIntensity: number,
    sunDirection: THREE.Vector3,
    sunColor: THREE.Color
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
      b.mesh.position.y = h - 0.06;
      b.mesh.rotation.z = -(hx - h) * 0.75;
      b.mesh.rotation.x = (hz - h) * 0.75;
    }
  }
}
