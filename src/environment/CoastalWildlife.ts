import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getTerrainHeight } from '../terrain/terrainMath';
import { sampleWaveHeight } from '../ocean/wavePhysics';
import { mergeStaticGroupByMaterial } from '../utils/geometryBatcher';

interface ReefFish {
  centerX: number;
  centerY: number;
  centerZ: number;
  radius: number;
  speed: number;
  phase: number;
  bobAmp: number;
  scale: number;
}

interface Sailboat {
  group: THREE.Group;
  baseX: number;
  z: number;
  speed: number;
  dir: number;
  span: number;
  phase: number;
}

interface SandCrab {
  homeX: number;
  homeZ: number;
  x: number;
  z: number;
  phase: number;
}

interface Butterfly {
  group: THREE.Group;
  wingL: THREE.Mesh;
  wingR: THREE.Mesh;
  cx: number;
  cz: number;
  phase: number;
}

/**
 * Rich Ambient Coastal, Horizon & Underwater Wildlife Ecosystem:
 *  1. 10 Soaring 3D Seagulls gliding & banking over the bay and ocean pier
 *  2. 3 Distant Sculpted Sailboats gliding & bobbing smoothly across the turquoise horizon!
 *  3. 36 Shimmering Tropical Reef Fish across 3 vibrant schools (pier pilings, sunken anchor, reef!)
 *  4. 1 Graceful Swimming Underwater Sea Turtle cruising above the coral reef!
 *  5. 6 Tiny Animated Beach Sand Crabs scuttling near driftwood & darting away from the player!
 *  6. 8 Fluttering Coastal Butterflies dancing above the lush sunlit dune shrubs!
 */
export class CoastalWildlife {
  public readonly skyGroup = new THREE.Group();
  public readonly fishGroup = new THREE.Group();
  public readonly horizonGroup = new THREE.Group();

  private readonly gulls: Array<{
    centerX: number;
    centerZ: number;
    radius: number;
    altitude: number;
    speed: number;
    phase: number;
    scale: number;
  }> = [];
  private gullInst: THREE.InstancedMesh | null = null;
  private gullFlapUniform = { value: 0 };
  private biplaneGroup: THREE.Group | null = null;
  private readonly sailboats: Sailboat[] = [];
  private readonly crabs: SandCrab[] = [];
  private readonly crabInst: THREE.InstancedMesh;
  private readonly butterflies: Butterfly[] = [];
  private readonly fishInst: THREE.InstancedMesh;
  private readonly fishList: ReefFish[] = [];
  private readonly dummy = new THREE.Object3D();

  private readonly turtles: Array<{
    group: THREE.Group;
    flipL: THREE.Mesh;
    flipR: THREE.Mesh;
    cx: number;
    cz: number;
    rx: number;
    rz: number;
    depthY: number;
    speed: number;
    phase: number;
  }> = [];
  private mantaGroup: THREE.Group | null = null;
  private mantaWingL: THREE.Mesh | null = null;
  private mantaWingR: THREE.Mesh | null = null;
  private readonly perchedGulls: Array<{ group: THREE.Group; baseYaw: number; phase: number }> = [];
  private fireflyMat: THREE.ShaderMaterial | null = null;
  private sprayMistMat: THREE.ShaderMaterial | null = null;

  constructor() {
    this.skyGroup.name = 'SoaringSeagullsAndButterflies';
    this.fishGroup.name = 'UnderwaterReefLife';
    this.horizonGroup.name = 'HorizonSailboats';

    this.buildSeagulls();
    this.buildPerchedPierGulls();
    this.buildSailboats();
    this.buildHorizonCatamaran();
    this.buildSkyBiplaneBanner();
    this.crabInst = this.buildSandCrabs();
    this.skyGroup.add(this.crabInst);
    this.buildButterflies();
    this.buildSunsetFireflies();
    this.buildShorelineSeaSpray();
    this.buildSeaTurtles();
    this.buildMantaRay();
    this.fishInst = this.buildReefFish();
    this.fishGroup.add(this.fishInst);
  }

  /**
   * Single-draw-call GPU-animated bird flock: 6 coastal seagulls + 2 scarlet/gold tropical macaws
   * gliding & flapping organically over the cove and palm canopy!
   */
  private buildSeagulls(): void {
    const body = new THREE.ConeGeometry(0.08, 0.58, 6);
    body.rotateX(Math.PI / 2);
    const wingL = new THREE.BoxGeometry(0.68, 0.025, 0.22);
    wingL.translate(-0.34, 0, 0);
    const wingR = new THREE.BoxGeometry(0.68, 0.025, 0.22);
    wingR.translate(0.34, 0, 0);
    const merged = mergeGeometries([body.toNonIndexed(), wingL.toNonIndexed(), wingR.toNonIndexed()], false)!;
    body.dispose();
    wingL.dispose();
    wingR.dispose();

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.gullFlapUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float wingDist = abs(transformed.x);
           if (wingDist > 0.09) {
             #ifdef USE_INSTANCING
               float phase = instanceMatrix[3][0] * 0.23 + instanceMatrix[3][2] * 0.17;
             #else
               float phase = 0.0;
             #endif
             float flap = sin(uTime * 5.8 + phase) * 0.34;
             transformed.y += flap * (wingDist - 0.08);
           }`
        );
    };
    mat.customProgramCacheKey = () => 'instanced-flapping-birds';

    const specs = [
      // 6 white coastal seagulls circling the bay & pier
      { cx: -42, cz: 10, r: 22, alt: 15.0, spd: 0.20, ph: 0.0, sc: 1.0, col: 0xf4f7fa },
      { cx: -14, cz: 26, r: 26, alt: 18.5, spd: 0.24, ph: 1.2, sc: 1.0, col: 0xeef3f7 },
      { cx: 12, cz: 16, r: 24, alt: 16.5, spd: 0.22, ph: 2.3, sc: 1.05, col: 0xf8fafc },
      { cx: 38, cz: 22, r: 28, alt: 20.0, spd: 0.19, ph: 3.4, sc: 1.0, col: 0xe8eff5 },
      { cx: 22, cz: 42, r: 30, alt: 22.0, spd: 0.21, ph: 4.6, sc: 1.1, col: 0xf5f8fa },
      { cx: -28, cz: 36, r: 26, alt: 19.0, spd: 0.25, ph: 5.5, sc: 0.95, col: 0xf0f4f8 },
      // 2 vibrant tropical scarlet & gold macaw parrots gliding across the palm dune canopy!
      { cx: -18, cz: -34, r: 24, alt: 10.5, spd: 0.30, ph: 0.8, sc: 0.88, col: 0xff4d4d },
      { cx: 20, cz: -36, r: 22, alt: 11.2, spd: -0.28, ph: 3.7, sc: 0.88, col: 0xffb703 }
    ];

    const inst = new THREE.InstancedMesh(merged, mat, specs.length);
    const col = new THREE.Color();
    specs.forEach((s, i) => {
      this.gulls.push({
        centerX: s.cx,
        centerZ: s.cz,
        radius: s.r,
        altitude: s.alt,
        speed: s.spd,
        phase: s.ph,
        scale: s.sc
      });
      col.setHex(s.col);
      inst.setColorAt(i, col);
    });
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.frustumCulled = false;
    this.gullInst = inst;
    this.skyGroup.add(inst);
  }

  /**
   * Distant vintage coastal biplane cruising lazily across the high turquoise horizon
   * towing a sunlit white sky-banner ("NEON COVE")!
   */
  private buildSkyBiplaneBanner(): void {
    const plane = new THREE.Group();
    const redMat = new THREE.MeshStandardMaterial({ color: 0xe63946, roughness: 0.42 });
    const wingMat = new THREE.MeshStandardMaterial({ color: 0xfff8eb, roughness: 0.55 });

    const fuse = new THREE.CylinderGeometry(0.18, 0.32, 3.2, 8);
    fuse.rotateZ(Math.PI / 2);
    plane.add(new THREE.Mesh(fuse, redMat));

    const topWing = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.08, 4.6), wingMat);
    topWing.position.set(0.35, 0.52, 0);
    plane.add(topWing);

    const botWing = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.08, 4.1), wingMat);
    botWing.position.set(0.28, -0.22, 0);
    plane.add(botWing);

    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.65, 0.08), redMat);
    tail.position.set(-1.45, 0.25, 0);
    plane.add(tail);

    // Tow line + sunlit white sky banner reading "NEON COVE"
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 128;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#fffdf8';
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = '#168aad';
    ctx.lineWidth = 10;
    ctx.strokeRect(8, 8, 496, 112);
    ctx.fillStyle = '#0f4c5c';
    ctx.font = '800 66px Inter, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NEON COVE', 256, 66);

    const banTex = new THREE.CanvasTexture(cv);
    banTex.colorSpace = THREE.SRGBColorSpace;
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(10.5, 2.2),
      new THREE.MeshBasicMaterial({ map: banTex, side: THREE.DoubleSide })
    );
    banner.position.set(-8.6, 0.0, 0);
    banner.rotation.y = Math.PI;
    plane.add(banner);

    const tow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 2.2, 4),
      wingMat
    );
    tow.rotation.z = Math.PI / 2;
    tow.position.set(-2.5, 0, 0);
    plane.add(tow);

    mergeStaticGroupByMaterial(plane);
    plane.scale.setScalar(1.35);
    this.biplaneGroup = plane;
    this.horizonGroup.add(plane);
  }

  private buildSailboats(): void {
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xf8f9fa, roughness: 0.42 });
    const sailMat = new THREE.MeshStandardMaterial({ color: 0xfffdf8, roughness: 0.75, side: THREE.DoubleSide });
    const mastMat = new THREE.MeshStandardMaterial({ color: 0xdbe3ea, roughness: 0.4, metalness: 0.5 });

    const specs: Array<{ baseX: number; z: number; speed: number; dir: number; span: number; stripe: number; sc: number }> = [
      { baseX: -20, z: 122, speed: 1.5, dir: 1, span: 150, stripe: 0x168aad, sc: 1.15 },
      { baseX: 48, z: 158, speed: 1.2, dir: -1, span: 170, stripe: 0xe63946, sc: 1.35 },
      { baseX: -75, z: 185, speed: 1.0, dir: 1, span: 190, stripe: 0xf4a261, sc: 1.45 }
    ];

    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      const boat = new THREE.Group();

      const hullGeo = new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, Math.PI * 0.46, Math.PI * 0.54);
      hullGeo.scale(1.15, 0.85, 3.6);
      const hull = new THREE.Mesh(hullGeo, hullMat);
      hull.position.y = 0.45;
      boat.add(hull);

      const stripeMat = new THREE.MeshStandardMaterial({ color: s.stripe, roughness: 0.45 });
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.22, 6.4), stripeMat);
      stripe.position.y = 0.52;
      boat.add(stripe);

      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 7.6, 6), mastMat);
      mast.position.set(0, 4.2, 0.2);
      boat.add(mast);

      // Triangular billowing mainsail
      const mainShape = new THREE.Shape();
      mainShape.moveTo(0, 0);
      mainShape.lineTo(0, 6.4);
      mainShape.lineTo(-3.2, 0.25);
      mainShape.closePath();
      const mainSail = new THREE.Mesh(new THREE.ShapeGeometry(mainShape), sailMat);
      mainSail.rotation.y = Math.PI / 2;
      mainSail.position.set(0, 1.35, 0.2);
      boat.add(mainSail);

      // Triangular foresail (jib)
      const jibShape = new THREE.Shape();
      jibShape.moveTo(0, 0);
      jibShape.lineTo(0, 5.4);
      jibShape.lineTo(2.4, 0.15);
      jibShape.closePath();
      const jibSail = new THREE.Mesh(new THREE.ShapeGeometry(jibShape), sailMat);
      jibSail.rotation.y = Math.PI / 2;
      jibSail.position.set(0, 1.25, 0.35);
      boat.add(jibSail);

      boat.scale.setScalar(s.sc);
      mergeStaticGroupByMaterial(boat);
      this.horizonGroup.add(boat);
      this.sailboats.push({
        group: boat,
        baseX: s.baseX,
        z: s.z,
        speed: s.speed,
        dir: s.dir,
        span: s.span,
        phase: i * 2.1
      });
    }
  }

  /**
   * 2 Pier-Perching Seagulls resting & gently scanning atop outer Ocean Pier mooring bollards.
   */
  private buildPerchedPierGulls(): void {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf7f9fb, roughness: 0.72 });
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x9aa9b8, roughness: 0.75 });
    const beakMat = new THREE.MeshStandardMaterial({ color: 0xf4a236, roughness: 0.45 });
    const spots: Array<[number, number, number, number]> = [
      [20.48, 2.58, 8.8, 0.75],
      [23.52, 2.58, 21.8, -1.1]
    ];
    spots.forEach(([x, y, z, yaw], i) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.y = yaw;

      const body = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), bodyMat);
      body.scale.set(0.85, 0.85, 1.55);
      body.position.set(0, 0.14, 0);
      g.add(body);

      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.SphereGeometry(0.085, 7, 5), wingMat);
        wing.scale.set(0.35, 0.72, 1.65);
        wing.position.set(side * 0.082, 0.15, -0.02);
        g.add(wing);

        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.10, 5), beakMat);
        leg.position.set(side * 0.032, 0.05, 0.0);
        g.add(leg);
      }

      const head = new THREE.Mesh(new THREE.SphereGeometry(0.068, 8, 6), bodyMat);
      head.position.set(0, 0.24, 0.11);
      g.add(head);

      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.075, 5), beakMat);
      beak.rotation.x = Math.PI / 2;
      beak.position.set(0, 0.23, 0.19);
      g.add(beak);

      mergeStaticGroupByMaterial(g);
      this.skyGroup.add(g);
      this.perchedGulls.push({ group: g, baseYaw: yaw, phase: i * 2.4 });
    });
  }

  /**
   * Sleek twin-hull Horizon Catamaran cruising smoothly across the distant turquoise sea.
   */
  private buildHorizonCatamaran(): void {
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xf6f8fa, roughness: 0.36 });
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x1d708a, roughness: 0.44 });
    const sailMat = new THREE.MeshStandardMaterial({
      color: 0xfff8ed,
      roughness: 0.72,
      side: THREE.DoubleSide
    });
    const mastMat = new THREE.MeshStandardMaterial({ color: 0xd0d8e0, roughness: 0.35, metalness: 0.6 });

    const cat = new THREE.Group();
    const hullGeo = new THREE.SphereGeometry(1, 10, 8, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55);
    hullGeo.scale(0.55, 0.65, 4.1);
    for (const sx of [-1.65, 1.65]) {
      const hull = new THREE.Mesh(hullGeo, hullMat);
      hull.position.set(sx, 0.45, 0);
      cat.add(hull);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.38, 4.4), deckMat);
    bridge.position.set(0, 0.85, -0.2);
    cat.add(bridge);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.75, 2.6), hullMat);
    cabin.position.set(0, 1.38, -0.35);
    cat.add(cabin);

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 8.6, 6), mastMat);
    mast.position.set(0, 5.2, 0.4);
    cat.add(mast);

    const mainShape = new THREE.Shape();
    mainShape.moveTo(0, 0);
    mainShape.lineTo(0, 7.2);
    mainShape.lineTo(-3.6, 0.3);
    mainShape.closePath();
    const mainSail = new THREE.Mesh(new THREE.ShapeGeometry(mainShape), sailMat);
    mainSail.rotation.y = Math.PI / 2;
    mainSail.position.set(0, 1.75, 0.4);
    cat.add(mainSail);

    const jibShape = new THREE.Shape();
    jibShape.moveTo(0, 0);
    jibShape.lineTo(0, 5.8);
    jibShape.lineTo(2.7, 0.2);
    jibShape.closePath();
    const jibSail = new THREE.Mesh(new THREE.ShapeGeometry(jibShape), sailMat);
    jibSail.rotation.y = Math.PI / 2;
    jibSail.position.set(0, 1.65, 0.55);
    cat.add(jibSail);

    cat.scale.setScalar(1.22);
    mergeStaticGroupByMaterial(cat);
    this.horizonGroup.add(cat);
    this.sailboats.push({
      group: cat,
      baseX: 12,
      z: 142,
      speed: 1.35,
      dir: -1,
      span: 165,
      phase: 4.3
    });
  }

  /**
   * Sunset Firefly Swarm: 140 warm golden-amber glowing fireflies drifting gently over the rear
   * lush dunes & palm groves (1 draw call, fades in smoothly during Golden Hour & Sunset!).
   */
  private buildSunsetFireflies(): void {
    const count = 140;
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const sizes = new Float32Array(count);

    let seed = 7331;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    for (let i = 0; i < count; i++) {
      const fx = (rand() - 0.5) * 134.0;
      const fz = -30.5 - rand() * 34.0;
      const fy = getTerrainHeight(fx, fz) + 0.65 + rand() * 2.3;
      positions[i * 3] = fx;
      positions[i * 3 + 1] = fy;
      positions[i * 3 + 2] = fz;
      phases[i] = rand() * Math.PI * 2;
      sizes[i] = 14.0 + rand() * 16.0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    this.fireflyMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uDusk: { value: 0 }
      },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        attribute float aSize;
        uniform float uTime;
        uniform float uDusk;
        varying float vPulse;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.55 + aPhase * 3.1) * 0.85;
          p.y += cos(uTime * 0.82 + aPhase * 2.3) * 0.42;
          p.z += sin(uTime * 0.48 + aPhase * 1.9) * 0.75;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float tw = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 2.8 + aPhase * 6.28), 2.0);
          vPulse = tw * uDusk;
          gl_PointSize = clamp((aSize * (0.7 + 0.5 * tw)) / max(1.0, -mv.z * 0.085), 2.0, 26.0) * step(0.01, uDusk);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vPulse;
        void main() {
          if (vPulse < 0.01) discard;
          vec2 d = gl_PointCoord - 0.5;
          float r2 = dot(d, d);
          if (r2 > 0.25) discard;
          float glow = exp(-r2 * 18.0);
          vec3 col = mix(vec3(1.0, 0.72, 0.22), vec3(1.0, 0.96, 0.68), glow);
          gl_FragColor = vec4(col * (1.15 * vPulse), glow * vPulse * 0.92);
        }
      `
    });

    const pts = new THREE.Points(geo, this.fireflyMat);
    pts.frustumCulled = false;
    this.skyGroup.add(pts);
  }

  /**
   * Shoreline Sea-Spray Mist: 90 soft translucent mist wisps drifting gently above the breaking
   * coastal surf zone (1 draw call, opacity modulated by waveIntensity).
   */
  private buildShorelineSeaSpray(): void {
    const count = 90;
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const sizes = new Float32Array(count);

    let seed = 9183;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    for (let i = 0; i < count; i++) {
      const sx = (rand() - 0.5) * 108.0;
      const bayZ = 0.0014 * sx * sx - 1.25 * Math.sin(sx * 0.036) - 0.55 * Math.cos(sx * 0.075);
      const sz = bayZ + 0.5 + rand() * 5.8;
      positions[i * 3] = sx;
      positions[i * 3 + 1] = 0.35 + rand() * 0.85;
      positions[i * 3 + 2] = sz;
      phases[i] = rand();
      sizes[i] = 48.0 + rand() * 54.0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    this.sprayMistMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uWaveIntensity: { value: 1.0 }
      },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        attribute float aSize;
        uniform float uTime;
        uniform float uWaveIntensity;
        varying float vAlpha;
        void main() {
          float life = fract(aPhase + uTime * 0.11);
          vec3 p = position;
          p.z -= life * 2.6;
          p.y += life * 0.95;
          p.x += sin(uTime * 0.35 + aPhase * 12.0) * 0.9;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float env = sin(life * 3.1415926);
          vAlpha = env * (0.045 + 0.045 * clamp(uWaveIntensity, 0.3, 1.8));
          gl_PointSize = clamp((aSize * (0.8 + 0.6 * life)) / max(1.5, -mv.z * 0.12), 4.0, 96.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r2 = dot(d, d);
          if (r2 > 0.25) discard;
          float soft = exp(-r2 * 10.5);
          gl_FragColor = vec4(0.95, 0.98, 1.0, soft * vAlpha);
        }
      `
    });

    const mist = new THREE.Points(geo, this.sprayMistMat);
    mist.frustumCulled = false;
    this.skyGroup.add(mist);
  }

  private buildSandCrabs(): THREE.InstancedMesh {
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xd96b43, roughness: 0.62 });

    // Merge shell + both claws into one single InstancedMesh geometry (18 draws -> 1 draw!)
    const shellGeo = new THREE.SphereGeometry(0.065, 8, 6).toNonIndexed();
    shellGeo.scale(1.25, 0.55, 0.95);
    shellGeo.translate(0, 0.04, 0);

    const clawL = new THREE.SphereGeometry(0.028, 6, 5).toNonIndexed();
    clawL.translate(-0.07, 0.04, 0.065);

    const clawR = new THREE.SphereGeometry(0.028, 6, 5).toNonIndexed();
    clawR.translate(0.07, 0.04, 0.065);

    const mergedCrabGeo = mergeGeometries([shellGeo, clawL, clawR], false)!;
    shellGeo.dispose();
    clawL.dispose();
    clawR.dispose();

    const spots: Array<[number, number]> = [
      [-33.5, -5.8], [-35.8, -6.4], [37.4, -6.2],
      [40.2, -6.9], [-13.2, -4.5], [14.8, -4.8]
    ];

    const inst = new THREE.InstancedMesh(mergedCrabGeo, shellMat, spots.length);
    for (let i = 0; i < spots.length; i++) {
      const [hx, hz] = spots[i];
      this.dummy.position.set(hx, getTerrainHeight(hx, hz) + 0.01, hz);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      inst.setMatrixAt(i, this.dummy.matrix);
      this.crabs.push({ homeX: hx, homeZ: hz, x: hx, z: hz, phase: i * 1.7 });
    }
    inst.instanceMatrix.needsUpdate = true;
    return inst;
  }

  private buildButterflies(): void {
    const colors = [0xffcf33, 0xff8fab, 0x72efdd, 0xffa62b];
    const wingGeo = new THREE.PlaneGeometry(0.085, 0.065);
    wingGeo.translate(0.042, 0, 0);

    for (let i = 0; i < 2; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: colors[i % colors.length],
        roughness: 0.5,
        side: THREE.DoubleSide
      });
      const g = new THREE.Group();
      const wingL = new THREE.Mesh(wingGeo, mat);
      wingL.rotation.y = Math.PI;
      const wingR = new THREE.Mesh(wingGeo, mat);
      g.add(wingL, wingR);

      const cx = -18 + i * 36;
      const cz = -32.5 - (i % 3) * 3.5;
      this.skyGroup.add(g);
      this.butterflies.push({ group: g, wingL, wingR, cx, cz, phase: i * 1.4 });
    }
  }

  private buildSeaTurtles(): void {
    const shellMat = new THREE.MeshStandardMaterial({ color: 0x3b6344, roughness: 0.58 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0x5c7c4e, roughness: 0.65 });
    const flipGeo = new THREE.BoxGeometry(0.62, 0.04, 0.20);
    flipGeo.translate(0.30, 0, 0);

    const specs = [
      { cx: -4.0, cz: 37.0, rx: 11.5, rz: 6.5, depthY: -2.45, speed: 0.16, phase: 0.0, scale: 1.0 },
      { cx: 13.5, cz: 31.5, rx: 9.0, rz: 5.2, depthY: -2.15, speed: -0.19, phase: 2.3, scale: 0.88 }
    ];

    for (const sp of specs) {
      const g = new THREE.Group();
      const shell = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 9), shellMat);
      shell.scale.set(0.95, 0.42, 1.32);
      g.add(shell);

      const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 9, 7), skinMat);
      head.position.set(0, -0.02, 0.62);
      head.scale.set(0.85, 0.8, 1.15);
      g.add(head);

      const flipL = new THREE.Mesh(flipGeo, skinMat);
      flipL.position.set(-0.34, -0.04, 0.24);
      flipL.rotation.y = Math.PI - 0.25;
      flipL.userData.dynamic = true;
      g.add(flipL);

      const flipR = new THREE.Mesh(flipGeo, skinMat);
      flipR.position.set(0.34, -0.04, 0.24);
      flipR.rotation.y = 0.25;
      flipR.userData.dynamic = true;
      g.add(flipR);

      for (const side of [-1, 1]) {
        const rear = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.035, 0.14), skinMat);
        rear.position.set(side * 0.24, -0.05, -0.48);
        rear.rotation.y = side * 0.5;
        g.add(rear);
      }

      mergeStaticGroupByMaterial(g);
      g.scale.setScalar(sp.scale);
      this.fishGroup.add(g);
      this.turtles.push({
        group: g,
        flipL,
        flipR,
        cx: sp.cx,
        cz: sp.cz,
        rx: sp.rx,
        rz: sp.rz,
        depthY: sp.depthY,
        speed: sp.speed,
        phase: sp.phase
      });
    }
  }

  private buildMantaRay(): void {
    const g = new THREE.Group();
    const topMat = new THREE.MeshStandardMaterial({ color: 0x1b344d, roughness: 0.36, metalness: 0.12 });
    const bellyMat = new THREE.MeshStandardMaterial({ color: 0xd9e8ec, roughness: 0.55 });

    // Sculpted diamond fuselage
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), topMat);
    body.scale.set(1.15, 0.22, 1.55);
    g.add(body);

    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.46, 10, 7), bellyMat);
    belly.scale.set(1.05, 0.16, 1.38);
    belly.position.y = -0.04;
    g.add(belly);

    // Swept pectoral wings (triangular extruded/scaled plates pivoting from body edge)
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0.68);
    wingShape.quadraticCurveTo(0.85, 0.42, 1.58, -0.10);
    wingShape.quadraticCurveTo(0.75, -0.48, 0, -0.68);
    wingShape.closePath();
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.045, bevelEnabled: false });
    wingGeo.rotateX(Math.PI / 2);
    wingGeo.translate(0, 0.02, 0);

    const wingR = new THREE.Mesh(wingGeo, topMat);
    wingR.position.set(0.32, 0, 0);
    wingR.userData.dynamic = true;
    g.add(wingR);

    const wingL = new THREE.Mesh(wingGeo, topMat);
    wingL.position.set(-0.32, 0, 0);
    wingL.scale.x = -1;
    wingL.userData.dynamic = true;
    g.add(wingL);

    // Cephalic horn fins & slender whip tail
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.34, 6), topMat);
      horn.rotation.x = Math.PI / 2;
      horn.position.set(side * 0.24, -0.02, 0.92);
      g.add(horn);
    }
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.035, 1.45, 6), topMat);
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(0, -0.01, -1.42);
    g.add(tail);

    mergeStaticGroupByMaterial(g);
    this.mantaGroup = g;
    this.mantaWingL = wingL;
    this.mantaWingR = wingR;
    this.fishGroup.add(g);
  }

  private buildReefFish(): THREE.InstancedMesh {
    const geo = new THREE.SphereGeometry(0.12, 8, 6);
    geo.scale(0.38, 0.85, 1.9);

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.28,
      metalness: 0.25
    });

    const fishCount = 36;
    const inst = new THREE.InstancedMesh(geo, mat, fishCount);
    const palette = [0xffcf33, 0x38d9f0, 0xff7b47, 0x52e6b0, 0xffa62b];
    const color = new THREE.Color();

    for (let i = 0; i < fishCount; i++) {
      const school = i < 12 ? 0 : i < 24 ? 1 : 2;
      const cx = school === 0 ? 22.0 : school === 1 ? -5.0 : 17.0;
      const cz = school === 0 ? 18.0 : school === 1 ? 36.0 : 25.5;
      const cy = school === 0 ? -1.45 - (i % 4) * 0.28 : school === 1 ? -3.1 - (i % 5) * 0.35 : -2.1 - (i % 4) * 0.26;

      this.fishList.push({
        centerX: cx + Math.sin(i * 3.1) * 3.0,
        centerY: cy,
        centerZ: cz + Math.cos(i * 2.7) * 3.0,
        radius: 2.0 + (i % 5) * 0.72,
        speed: 0.55 + (i % 4) * 0.14,
        phase: i * 0.65,
        bobAmp: 0.14 + (i % 3) * 0.06,
        scale: 0.78 + (i % 4) * 0.22
      });

      color.setHex(palette[i % palette.length]);
      inst.setColorAt(i, color);
    }

    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    return inst;
  }

  public update(
    elapsedTime: number,
    waveIntensity = 1.0,
    playerPos?: THREE.Vector3,
    sunDirection?: THREE.Vector3
  ): void {
    // Perched pier seagulls gently scanning the bay
    for (let i = 0; i < this.perchedGulls.length; i++) {
      const pg = this.perchedGulls[i];
      pg.group.rotation.y = pg.baseYaw + Math.sin(elapsedTime * 0.75 + pg.phase) * 0.42;
      pg.group.rotation.x = Math.sin(elapsedTime * 1.4 + pg.phase) * 0.05;
    }

    // Sunset Firefly Swarm & Shoreline Sea-Spray Mist shaders
    if (this.fireflyMat) {
      this.fireflyMat.uniforms.uTime.value = elapsedTime;
      const sunY = sunDirection ? sunDirection.y : 0.72;
      const dusk = 1.0 - THREE.MathUtils.smoothstep(sunY, 0.06, 0.34);
      this.fireflyMat.uniforms.uDusk.value = dusk;
    }
    if (this.sprayMistMat) {
      this.sprayMistMat.uniforms.uTime.value = elapsedTime;
      this.sprayMistMat.uniforms.uWaveIntensity.value = waveIntensity;
    }
    this.gullFlapUniform.value = elapsedTime;
    if (this.gullInst) {
      for (let i = 0; i < this.gulls.length; i++) {
        const g = this.gulls[i];
        const ang = elapsedTime * g.speed + g.phase;
        const x = g.centerX + Math.cos(ang) * g.radius;
        const z = g.centerZ + Math.sin(ang) * g.radius;
        const y = g.altitude + Math.sin(elapsedTime * 0.7 + g.phase) * 1.4;
        this.dummy.position.set(x, y, z);
        this.dummy.rotation.set(0, g.speed >= 0 ? -ang : -ang + Math.PI, g.speed >= 0 ? 0.22 : -0.22);
        this.dummy.scale.setScalar(g.scale);
        this.dummy.updateMatrix();
        this.gullInst.setMatrixAt(i, this.dummy.matrix);
      }
      this.gullInst.instanceMatrix.needsUpdate = true;
    }

    // Vintage biplane gliding serenely across the upper turquoise horizon towing the NEON COVE banner!
    if (this.biplaneGroup) {
      const cycle = ((elapsedTime * 0.011 + 0.35) % 1.0);
      const px = THREE.MathUtils.lerp(-185, 185, cycle);
      const py = 46 + Math.sin(elapsedTime * 0.45) * 2.2;
      const pz = 148 + Math.cos(elapsedTime * 0.12) * 10.0;
      this.biplaneGroup.position.set(px, py, pz);
      this.biplaneGroup.rotation.set(Math.sin(elapsedTime * 0.6) * 0.05, 0, Math.cos(elapsedTime * 0.45) * 0.04);
    }

    // Sailboats gliding serenely across the outer turquoise bay!
    for (let i = 0; i < this.sailboats.length; i++) {
      const s = this.sailboats[i];
      const x = s.baseX + Math.sin(elapsedTime * 0.012 * s.speed + s.phase) * s.span * 0.5 * s.dir;
      const vx = Math.cos(elapsedTime * 0.012 * s.speed + s.phase) * s.dir;
      const wH = sampleWaveHeight(x, s.z, elapsedTime, waveIntensity, -12.0);
      s.group.position.set(x, wH - 0.25, s.z);
      s.group.rotation.y = vx >= 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
      s.group.rotation.z = 0.08 + Math.sin(elapsedTime * 0.9 + s.phase) * 0.04;
    }

    // Tiny beach sand crabs scuttling sideways near driftwood (single InstancedMesh)
    for (let i = 0; i < this.crabs.length; i++) {
      const c = this.crabs[i];
      let targetX = c.homeX + Math.sin(elapsedTime * 0.75 + c.phase) * 1.15;
      let targetZ = c.homeZ + Math.cos(elapsedTime * 0.55 + c.phase) * 0.65;
      if (playerPos) {
        const dx = c.x - playerPos.x;
        const dz = c.z - playerPos.z;
        const d = Math.hypot(dx, dz);
        if (d < 3.2 && d > 0.05) {
          targetX += (dx / d) * 2.2;
          targetZ += (dz / d) * 2.2;
        }
      }
      c.x = THREE.MathUtils.lerp(c.x, targetX, 0.06);
      c.z = THREE.MathUtils.lerp(c.z, targetZ, 0.06);
      this.dummy.position.set(c.x, getTerrainHeight(c.x, c.z) + 0.01, c.z);
      this.dummy.rotation.set(0, Math.sin(elapsedTime * 1.5 + c.phase) * 0.6, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.crabInst.setMatrixAt(i, this.dummy.matrix);
    }
    this.crabInst.instanceMatrix.needsUpdate = true;

    // Coastal butterflies fluttering over dune flowers & shrubs
    for (let i = 0; i < this.butterflies.length; i++) {
      const b = this.butterflies[i];
      const bx = b.cx + Math.sin(elapsedTime * 0.9 + b.phase) * 2.2;
      const bz = b.cz + Math.cos(elapsedTime * 0.7 + b.phase * 1.3) * 1.6;
      const by = getTerrainHeight(bx, bz) + 0.85 + Math.sin(elapsedTime * 2.4 + b.phase) * 0.35;
      b.group.position.set(bx, by, bz);
      b.group.rotation.y = Math.atan2(Math.cos(elapsedTime * 0.9 + b.phase), -Math.sin(elapsedTime * 0.7 + b.phase * 1.3));
      const flap = Math.sin(elapsedTime * 18.0 + b.phase) * 0.85;
      b.wingL.rotation.z = -flap;
      b.wingR.rotation.z = flap;
    }

    // 2 Graceful Sea Turtles gliding smoothly above the coral reef!
    for (let i = 0; i < this.turtles.length; i++) {
      const t = this.turtles[i];
      const ta = elapsedTime * t.speed + t.phase;
      const tx = t.cx + Math.cos(ta) * t.rx;
      const tz = t.cz + Math.sin(ta) * t.rz;
      const ty = t.depthY + Math.sin(elapsedTime * 0.6 + t.phase) * 0.32;
      t.group.position.set(tx, ty, tz);
      const vx = -Math.sin(ta) * t.rx * t.speed;
      const vz = Math.cos(ta) * t.rz * t.speed;
      t.group.rotation.y = Math.atan2(vx, vz);
      const stroke = Math.sin(elapsedTime * 2.1 + t.phase) * 0.45;
      t.flipL.rotation.z = -stroke;
      t.flipR.rotation.z = stroke;
    }

    // Graceful Underwater Manta Ray sweeping across the deep outer coral reef!
    if (this.mantaGroup && this.mantaWingL && this.mantaWingR) {
      const ma = elapsedTime * 0.13 + 0.8;
      const mx = 5.0 + Math.cos(ma) * 16.0;
      const mz = 41.5 + Math.sin(ma) * 7.8;
      const my = -2.85 + Math.sin(elapsedTime * 0.48) * 0.38;
      this.mantaGroup.position.set(mx, my, mz);
      const mvx = -Math.sin(ma) * 16.0;
      const mvz = Math.cos(ma) * 7.8;
      this.mantaGroup.rotation.y = Math.atan2(mvx, mvz);
      this.mantaGroup.rotation.z = Math.sin(ma) * 0.10;
      const flap = Math.sin(elapsedTime * 1.65) * 0.28;
      this.mantaWingL.rotation.z = flap;
      this.mantaWingR.rotation.z = -flap;
    }

    for (let i = 0; i < this.fishList.length; i++) {
      const f = this.fishList[i];
      const ang = elapsedTime * f.speed + f.phase;
      const x = f.centerX + Math.cos(ang) * f.radius;
      const z = f.centerZ + Math.sin(ang) * f.radius;
      const y = f.centerY + Math.sin(elapsedTime * 1.8 + f.phase) * f.bobAmp;

      this.dummy.position.set(x, y, z);
      const wiggle = Math.sin(elapsedTime * 9.5 + f.phase) * 0.14;
      this.dummy.rotation.set(0, -ang + wiggle, 0);
      this.dummy.scale.setScalar(f.scale);
      this.dummy.updateMatrix();
      this.fishInst.setMatrixAt(i, this.dummy.matrix);
    }
    this.fishInst.instanceMatrix.needsUpdate = true;
  }
}
