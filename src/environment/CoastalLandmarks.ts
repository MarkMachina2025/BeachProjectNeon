import * as THREE from 'three';
import {
  addBoxCollider,
  addCollider,
  addOrientedBoxCollider,
  addWalkableDeck,
  getTerrainHeight,
  updateOrientedBoxCollider
} from '../terrain/terrainMath';
import { sampleWaveHeight } from '../ocean/wavePhysics';
import { mergeStaticGroupByMaterial } from '../utils/geometryBatcher';
import { loadPbrSet, makeWorldBoxGeo, makeWorldCylinderGeo } from '../utils/pbrMaterials';
import type { SoundEngine } from '../audio/SoundEngine';

export const WATER_SLIDE_LAUNCH = new THREE.Vector3(-22.0, 3.75, 2.38);

export function sampleWaterSlide(t: number, outPos: THREE.Vector3, outTan?: THREE.Vector3): void {
  const ct = THREE.MathUtils.clamp(t, 0, 1);
  const evalAt = (s: number, target: THREE.Vector3) => {
    const smoothS = s * s * (3.0 - 2.0 * s);
    const x = -22.0 + Math.sin(s * Math.PI) * 0.55;
    const y = 3.74 - 3.32 * smoothS;
    const z = THREE.MathUtils.lerp(2.38, 12.6, s);
    target.set(x, y, z);
  };
  evalAt(ct, outPos);
  if (outTan) {
    const eps = 0.004;
    const t0 = Math.max(0, ct - eps);
    const t1 = Math.min(1, ct + eps);
    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    evalAt(t0, p0);
    evalAt(t1, p1);
    outTan.subVectors(p1, p0).normalize();
  }
}

export interface TerraceTableSpot {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface PierSpot {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/**
 * Smoothly graded boardwalk elevation curve (averages terrain over +/-3.5m so planks
 * follow the coastal bay gracefully without jagged bumpy stair-steps or floating gaps).
 */
export function getBoardwalkY(x: number): number {
  const z = -25.0;
  const hAvg =
    (getTerrainHeight(x - 3.5, z) +
      getTerrainHeight(x - 1.5, z) * 2.0 +
      getTerrainHeight(x, z) * 3.0 +
      getTerrainHeight(x + 1.5, z) * 2.0 +
      getTerrainHeight(x + 3.5, z)) /
    9.0;
  const localH = getTerrainHeight(x, z);
  return Math.max(hAvg + 0.22, localH + 0.16);
}

function createSignTexture(title: string, subtitle: string, bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#38e2d8';
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, c.width - 20, c.height - 20);
  ctx.fillStyle = fg;
  ctx.font = 'bold 54px Inter, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, 256, 82);
  ctx.fillStyle = '#ffd166';
  ctx.font = 'bold 26px Inter, Segoe UI, sans-serif';
  ctx.fillText(subtitle, 256, 126);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function createArrowSignTexture(text: string, bg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 384;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, c.width - 12, c.height - 12);
  ctx.fillStyle = '#fff9f0';
  ctx.font = 'bold 34px Inter, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, 192, 60);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function createChalkboardTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 320;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1b2628';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#8b6844';
  ctx.lineWidth = 18;
  ctx.strokeRect(9, 9, c.width - 18, c.height - 18);

  ctx.fillStyle = '#ffd166';
  ctx.font = 'bold 34px Inter, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('TODAY AT NEON TIKI', 256, 62);

  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(54, 82);
  ctx.lineTo(458, 82);
  ctx.stroke();

  const items: Array<[string, string]> = [
    ['MANGO PASSION SMOOTHIE', '$6'],
    ['FRESH GREEN COCONUT', '$5'],
    ['ISLAND PINEAPPLE COOLER', '$7'],
    ['SURFBOARD RENTAL (1 HR)', '$15'],
    ['SNORKEL & FINS SET', '$10']
  ];
  ctx.font = '600 24px Inter, Segoe UI, sans-serif';
  items.forEach(([label, price], idx) => {
    const y = 124 + idx * 38;
    ctx.fillStyle = '#eef5f3';
    ctx.textAlign = 'left';
    ctx.fillText(label, 52, y);
    ctx.fillStyle = '#5eead4';
    ctx.textAlign = 'right';
    ctx.fillText(price, 460, y);
  });

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function createNetTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 128);
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.92)';
  ctx.lineWidth = 2.5;
  for (let x = 0; x <= 256; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, 6);
    ctx.lineTo(x, 122);
    ctx.stroke();
  }
  for (let y = 6; y <= 122; y += 14) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 8);
  ctx.fillRect(0, 120, 256, 8);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(5, 1);
  return tex;
}

/**
 * Handcrafted, Architecturally Cohesive Resort Landmarks & Living World Structures:
 *  1. Smoothly graded Wooden Boardwalk Promenade with continuous stringer beams
 *  2. Low-rise Cozy Wooden Dining Terraces (+0.26m above boardwalk, 1 crisp step, rear timber
 *     retaining walls, overhead shade pergolas & warm string lights!)
 *  3. Properly Engineered Lifeguard Watchtower (full side landing platform flush with balcony,
 *     open doorway in railing, solid stair stringers & white handrails — ZERO missing platform!)
 *  4. Upgraded Neon Tiki Surf Shop & Smoothie Bar (low-rise seamless 2-step deck, rear retaining
 *     wall, chalkboard menu, layered thatch roof, glass bottles, wooden surfboard rack)
 *  5. Detailed 28m Ocean Pier (framed dock lantern posts, ocean-view wooden benches, mooring bollards
 *     & coiled ropes, life-preserver box, AND a bobbing moored wooden rowboat on live waves!)
 *  6. World-Building Coastal Details: Outdoor Beach Rinse Shower with falling water stream,
 *     swaying tropical bunting flags, hand-painted coastal signpost, beach trash bins & flickering tiki torches!
 */
export class CoastalLandmarks {
  public readonly group = new THREE.Group();
  public readonly pierGroup = new THREE.Group();
  public readonly volleyballMesh: THREE.Mesh;
  public readonly soccerBallMesh: THREE.Mesh;
  public readonly barStoolSpots: Array<{ x: number; y: number; z: number; yaw: number }> = [];
  public readonly patioTerraceSpots: TerraceTableSpot[] = [];
  public readonly picnicTerraceSpots: TerraceTableSpot[] = [];
  public readonly pierFisherSpots: PierSpot[] = [];
  public readonly hammockSpots: Array<{ x: number; y: number; z: number; yaw: number }> = [];
  public readonly lifeguardSpot: { x: number; y: number; z: number; yaw: number };
  public readonly bartenderSpot: { x: number; y: number; z: number; yaw: number };
  public readonly surfRackBaseY: number;
  public readonly whalePlinthTop = new THREE.Vector3(14.8, 0, -21.8);
  public readonly rayPlinthTop = new THREE.Vector3(50.5, 0, -21.6);
  public readonly sharkPlinthTop = new THREE.Vector3(-49.5, 0, -21.6);
  public readonly coffeeCartDeckTop = new THREE.Vector3(-47.5, 0, -28.9);
  public readonly eastOverlookDeckTop = new THREE.Vector3(48.5, 0, -28.9);
  public readonly lifebuoyHookPos = new THREE.Vector3(-1.32, 0, -26.52);
  public readonly kayakLaunchPos = new THREE.Vector3(46.5, 0, -6.2);
  public readonly telescopePos = new THREE.Vector3(48.5, 0, -27.45);
  private bonfireSurge = 0;

  private readonly stringLightBulbs: THREE.MeshStandardMaterial[] = [];
  private readonly barLights: THREE.PointLight[] = [];
  private tikiSignMat: THREE.MeshStandardMaterial | null = null;
  private tikiDeckY = 0;
  private lastVolleyHalf = -1;
  private lastSoccerHalf = -1;
  private flameInstMesh: THREE.InstancedMesh | null = null;
  private readonly flameAnchors: THREE.Vector3[] = [];
  private showerInstMesh: THREE.InstancedMesh | null = null;
  private readonly showerDrops: Array<{ phase: number; ox: number; oz: number }> = [];
  private readonly instDummy = new THREE.Object3D();
  private mooredBoat: THREE.Group | null = null;
  private readonly boatPos = { x: 17.4, z: 11.2 };
  private liveBoatDeckY = 0.25;
  private swimRaft: THREE.Group | null = null;
  public readonly swimRaftPos = { x: -2.0, z: 21.5 };
  private liveRaftDeckY = 0.28;
  private microAtmosMat: THREE.ShaderMaterial | null = null;
  private lighthouseBeacon: THREE.Group | null = null;
  private lighthouseBeamMat: THREE.ShaderMaterial | null = null;
  private villaWindowMat: THREE.MeshStandardMaterial | null = null;
  private swimBuoyInst: THREE.InstancedMesh | null = null;
  private readonly swimBuoyCoords: Array<[number, number]> = [];

  private readonly maxHalos = 128;
  private haloCount = 0;
  private readonly haloPositions = new Float32Array(128 * 3);
  private readonly haloColors = new Float32Array(128 * 3);
  private readonly haloSizes = new Float32Array(128);
  private haloGeo!: THREE.BufferGeometry;
  private haloMat!: THREE.ShaderMaterial;

  private readonly woodMat: THREE.MeshStandardMaterial;
  private readonly darkWoodMat: THREE.MeshStandardMaterial;
  private readonly weatheredWoodMat: THREE.MeshStandardMaterial;
  private readonly paintWhiteMat: THREE.MeshStandardMaterial;
  private readonly paintTealMat: THREE.MeshStandardMaterial;
  private readonly coralStoneMat: THREE.MeshStandardMaterial;
  private readonly bambooMat: THREE.MeshStandardMaterial;
  private readonly ropeMat: THREE.MeshStandardMaterial;
  private readonly brassMat: THREE.MeshStandardMaterial;
  private readonly linenMaps: ReturnType<typeof loadPbrSet>;

  constructor(createDrinkFn: () => THREE.Group) {
    this.group.name = 'CoastalLandmarks';
    this.pierGroup.name = 'OceanPier';

    this.initLightHalos();

    // 100% Real Poly Haven CC0 1k PBR Material Suite (Diffuse + OpenGL Normal + Roughness)
    const oakPbr = loadPbrSet('oak_wood_planks', 1, 1);
    const weatheredPbr = loadPbrSet('weathered_brown_planks', 1, 1);
    const whitePbr = loadPbrSet('white_planks_clean', 1, 1);
    const coralPbr = loadPbrSet('coral_stone_wall', 1, 1);
    const bambooPbr = loadPbrSet('bamboo_wall_02', 1, 1);
    this.linenMaps = loadPbrSet('rough_linen', 2, 2);

    this.woodMat = new THREE.MeshStandardMaterial({
      map: oakPbr.map,
      normalMap: oakPbr.normalMap,
      roughnessMap: oakPbr.roughnessMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      color: 0xf0d6b2,
      roughness: 0.88
    });
    this.darkWoodMat = new THREE.MeshStandardMaterial({
      map: oakPbr.map,
      normalMap: oakPbr.normalMap,
      roughnessMap: oakPbr.roughnessMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
      color: 0x9b7754,
      roughness: 0.92
    });
    this.weatheredWoodMat = new THREE.MeshStandardMaterial({
      map: weatheredPbr.map,
      normalMap: weatheredPbr.normalMap,
      roughnessMap: weatheredPbr.roughnessMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
      color: 0xbba891,
      roughness: 0.94
    });
    this.paintWhiteMat = new THREE.MeshStandardMaterial({
      map: whitePbr.map,
      normalMap: whitePbr.normalMap,
      roughnessMap: whitePbr.roughnessMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      color: 0xf7f5f0,
      roughness: 0.82
    });
    this.paintTealMat = new THREE.MeshStandardMaterial({
      map: whitePbr.map,
      normalMap: whitePbr.normalMap,
      roughnessMap: whitePbr.roughnessMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      color: 0x359aab,
      roughness: 0.80
    });
    this.coralStoneMat = new THREE.MeshStandardMaterial({
      map: coralPbr.map,
      normalMap: coralPbr.normalMap,
      roughnessMap: coralPbr.roughnessMap,
      normalScale: new THREE.Vector2(1.05, 1.05),
      color: 0xe6dccb,
      roughness: 0.95
    });
    this.bambooMat = new THREE.MeshStandardMaterial({
      map: bambooPbr.map,
      normalMap: bambooPbr.normalMap,
      roughnessMap: bambooPbr.roughnessMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
      color: 0xe3cf9e,
      roughness: 0.80
    });
    this.ropeMat = new THREE.MeshStandardMaterial({
      map: this.linenMaps.map,
      normalMap: this.linenMaps.normalMap,
      roughnessMap: this.linenMaps.roughnessMap,
      normalScale: new THREE.Vector2(1.0, 1.0),
      color: 0xd9c59d,
      roughness: 0.96
    });
    this.brassMat = new THREE.MeshStandardMaterial({
      color: 0xd8a84a,
      roughness: 0.30,
      metalness: 0.84
    });

    this.buildBoardwalkPromenade();
    this.buildPatioTerraces();
    this.buildDuneRopeFence();
    this.buildOceanPier();
    this.bartenderSpot = this.buildTikiSurfBar(createDrinkFn);
    this.surfRackBaseY = this.buildSurfboardRack();
    this.lifeguardSpot = this.buildLifeguardTower();
    this.buildWaterSlide();
    this.volleyballMesh = this.buildVolleyballCourt();

    // Rich resort & coastal micro-landmarks
    this.buildBeachShower();
    this.buildWayfindingSignpost();
    this.buildBuntingFlags();
    this.buildTikiTorchesAndBins();
    this.buildWhaleStatuePlinth();
    this.buildHammockGrove();
    this.buildEastKayakCove();
    this.buildLifeguardRescuePost();
    this.buildOverlookTelescope();
    this.buildMicroAtmosphereParticles();
    this.soccerBallMesh = this.buildSoccerKickaboutBall();
    this.buildFloatingSwimRaft();

    // Realistic Coastal Reserve Perimeter Environment & Backcountry Architecture
    this.buildCoastalBorderFences();
    this.buildCoastalLighthouse();
    this.buildHillsideVillas();
    this.buildBeachCabanaAndEntryArch();
    this.buildSwimZoneBuoyLine();

    // Merge all static landmark geometry by material to eliminate hundreds of draw calls
    mergeStaticGroupByMaterial(this.group);
    mergeStaticGroupByMaterial(this.pierGroup);
  }

  private initLightHalos(): void {
    this.haloGeo = new THREE.BufferGeometry();
    this.haloGeo.setAttribute('position', new THREE.BufferAttribute(this.haloPositions, 3));
    this.haloGeo.setAttribute('aColor', new THREE.BufferAttribute(this.haloColors, 3));
    this.haloGeo.setAttribute('aSize', new THREE.BufferAttribute(this.haloSizes, 1));
    this.haloGeo.setDrawRange(0, 0);

    this.haloMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uDuskBoost: { value: 0.35 }
      },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        varying vec3 vColor;
        void main() {
          vColor = aColor;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * (340.0 / max(-mvPos.z, 1.0)), 6.0, 220.0);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uDuskBoost;
        varying vec3 vColor;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(p, p);
          if (r2 > 1.0) discard;
          float r = sqrt(r2);
          float core = exp(-r * r * 9.5);
          float halo = exp(-r * r * 2.6) * (1.0 - r);
          float alpha = (core * 0.52 + halo * 0.42) * uDuskBoost;
          gl_FragColor = vec4(vColor * (core * 1.4 + halo * 0.9), alpha);
        }
      `
    });

    const pts = new THREE.Points(this.haloGeo, this.haloMat);
    pts.frustumCulled = false;
    pts.userData.dynamic = true;
    this.group.add(pts);
  }

  public addLightHalo(pos: THREE.Vector3, scale: number, colorHex: number): void {
    if (this.haloCount >= this.maxHalos) return;
    const i = this.haloCount++;
    this.haloPositions[i * 3] = pos.x;
    this.haloPositions[i * 3 + 1] = pos.y;
    this.haloPositions[i * 3 + 2] = pos.z;

    const c = new THREE.Color(colorHex);
    this.haloColors[i * 3] = c.r;
    this.haloColors[i * 3 + 1] = c.g;
    this.haloColors[i * 3 + 2] = c.b;
    this.haloSizes[i] = scale;

    (this.haloGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.haloGeo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.haloGeo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    this.haloGeo.setDrawRange(0, this.haloCount);
  }

  private buildBoardwalkPromenade(): void {
    const startX = -62;
    const endX = 62;
    const step = 0.44;
    const count = Math.floor((endX - startX) / step) + 1;

    const plankGeo = makeWorldBoxGeo(0.37, 0.08, 3.15, 1.35, true);
    const instPlanks = new THREE.InstancedMesh(plankGeo, this.woodMat, count);
    instPlanks.receiveShadow = true;
    instPlanks.castShadow = false;

    const dummy = new THREE.Object3D();
    const plankCol = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const x = startX + i * step;
      const z = -25.0;
      const y = getBoardwalkY(x);
      const yNext = getBoardwalkY(x + 0.5);
      const roll = Math.atan2(yNext - y, 0.5);
      dummy.position.set(x, y - 0.04, z);
      dummy.rotation.set(0, 0, roll);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      instPlanks.setMatrixAt(i, dummy.matrix);
      // Natural sun-bleached golden coastal teak plank-to-plank variation (zero reddish/purple cast!)
      const h = ((i * 73) % 100) / 100;
      plankCol.setHSL(0.112 + (h - 0.5) * 0.015, 0.34 + (h - 0.5) * 0.08, 0.90 + (h - 0.5) * 0.12);
      instPlanks.setColorAt(i, plankCol);
    }
    instPlanks.instanceMatrix.needsUpdate = true;
    if (instPlanks.instanceColor) instPlanks.instanceColor.needsUpdate = true;
    this.group.add(instPlanks);

    const segLen = 4.0;
    const beamGeo = makeWorldBoxGeo(segLen + 0.06, 0.34, 0.16, 1.4);
    const subDeckGeo = makeWorldBoxGeo(segLen + 0.04, 0.06, 2.95, 1.8);
    for (let x = startX; x < endX; x += segLen) {
      const cx = x + segLen * 0.5;
      const y0 = getBoardwalkY(x);
      const y1 = getBoardwalkY(x + segLen);
      const cy = (y0 + y1) * 0.5;
      const slope = Math.atan2(y1 - y0, segLen);
      // Dark weathered timber sub-deck backing so bright white sand never peeks through plank seams
      const subDeck = new THREE.Mesh(subDeckGeo, this.darkWoodMat);
      subDeck.position.set(cx, cy - 0.105, -25.0);
      subDeck.rotation.z = slope;
      subDeck.receiveShadow = true;
      this.group.add(subDeck);
      for (const sz of [-26.42, -23.58]) {
        const beam = new THREE.Mesh(beamGeo, this.weatheredWoodMat);
        beam.position.set(cx, cy - 0.20, sz);
        beam.rotation.z = slope;
        beam.receiveShadow = true;
        this.group.add(beam);
      }
    }

    addWalkableDeck(startX - 0.3, endX + 0.3, -26.6, -23.4, (x) => getBoardwalkY(x), 'wood');
  }

  /**
   * Builds 4 cozy, natural low-rise resort wooden dining decks (+0.26m above boardwalk,
   * 1 neat entry step, timber rear retaining wall, perimeter railings, & shade pergolas!).
   */
  private buildPatioTerraces(): void {
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xfff0c8,
      emissive: 0xffb347,
      emissiveIntensity: 0.45
    });
    this.stringLightBulbs.push(bulbMat);

    const addResortDeck = (cx: number, width: number, depth: number, withPergola: boolean): number => {
      const zFront = -26.55;
      const cz = zFront - depth * 0.5;
      const bwY = getBoardwalkY(cx);
      // Sample rear & center terrain across deck width so rear dune slope NEVER pokes through planks!
      const zRearCheck = zFront - depth + 0.35;
      const midGround = getTerrainHeight(cx, cz);
      const maxGround = Math.max(
        midGround,
        getTerrainHeight(cx - width * 0.45, zRearCheck),
        getTerrainHeight(cx, zRearCheck),
        getTerrainHeight(cx + width * 0.45, zRearCheck)
      );
      const deckY = Math.max(bwY + 0.26, maxGround + 0.08);

      // Coral-stone masonry foundation plinth reaching cleanly into sand across sloped dunes!
      const stonePlinth = new THREE.Mesh(makeWorldBoxGeo(width - 0.12, 0.90, depth - 0.12, 1.45), this.coralStoneMat);
      stonePlinth.position.set(cx, deckY - 0.55, cz);
      stonePlinth.receiveShadow = true;
      stonePlinth.castShadow = true;
      this.group.add(stonePlinth);

      // Overhanging sunlit cedar deck slab + oak perimeter fascia cap
      const deckTop = new THREE.Mesh(makeWorldBoxGeo(width + 0.08, 0.12, depth + 0.08, 1.5), this.woodMat);
      deckTop.position.set(cx, deckY - 0.06, cz);
      deckTop.receiveShadow = true;
      deckTop.castShadow = true;
      this.group.add(deckTop);

      // Rear coral-stone retaining curb + timber top cap neatly holding back the dune slope
      const retainer = new THREE.Mesh(makeWorldBoxGeo(width + 0.18, 0.66, 0.22, 1.35), this.coralStoneMat);
      retainer.position.set(cx, deckY + 0.15, zFront - depth - 0.08);
      retainer.castShadow = true;
      retainer.receiveShadow = true;
      this.group.add(retainer);
      const retainerCap = new THREE.Mesh(makeWorldBoxGeo(width + 0.24, 0.07, 0.28, 1.4), this.darkWoodMat);
      retainerCap.position.set(cx, deckY + 0.50, zFront - depth - 0.08);
      retainerCap.castShadow = true;
      this.group.add(retainerCap);

      // Low rustic deck rails on left & right sides (leaving full front entry wide open!)
      for (const side of [-1, 1]) {
        const rx = cx + side * (width * 0.5 - 0.08);
        for (const rz of [zFront - 0.22, zFront - depth + 0.18]) {
          const post = new THREE.Mesh(makeWorldBoxGeo(0.11, 0.92, 0.11, 1.2), this.darkWoodMat);
          post.position.set(rx, deckY + 0.46, rz);
          post.castShadow = true;
          this.group.add(post);
          const pCap = new THREE.Mesh(makeWorldBoxGeo(0.15, 0.04, 0.15, 0.8), this.paintWhiteMat);
          pCap.position.set(rx, deckY + 0.94, rz);
          this.group.add(pCap);
        }
        const rail = new THREE.Mesh(makeWorldBoxGeo(0.08, 0.07, depth - 0.25, 1.3), this.woodMat);
        rail.position.set(rx, deckY + 0.86, cz);
        this.group.add(rail);
      }

      // Handcrafted architectural resort entry stairs (coral-stone risers + overhanging cedar bullnose treads + brass nosing + flanking cheek curbs!)
      const stepW = Math.min(width - 0.8, 3.0);
      const buildResortStep = (sy: number, sz: number, run: number, riserH: number) => {
        const riser = new THREE.Mesh(makeWorldBoxGeo(stepW - 0.08, riserH, run - 0.04, 1.25), this.coralStoneMat);
        riser.position.set(cx, sy - 0.05 - riserH * 0.5, sz - 0.02);
        riser.receiveShadow = true;
        riser.castShadow = true;
        this.group.add(riser);

        const tread = new THREE.Mesh(makeWorldBoxGeo(stepW + 0.04, 0.055, run + 0.04, 1.35), this.woodMat);
        tread.position.set(cx, sy - 0.0275, sz + 0.01);
        tread.receiveShadow = true;
        tread.castShadow = true;
        this.group.add(tread);

        const nosing = new THREE.Mesh(new THREE.BoxGeometry(stepW + 0.02, 0.016, 0.024), this.brassMat);
        nosing.position.set(cx, sy - 0.005, sz + run * 0.5 + 0.022);
        this.group.add(nosing);
      };

      if (deckY - bwY > 0.36) {
        const y1 = THREE.MathUtils.lerp(bwY, deckY, 0.34);
        const y2 = THREE.MathUtils.lerp(bwY, deckY, 0.68);
        buildResortStep(y1, zFront + 0.44, 0.36, 0.42);
        buildResortStep(y2, zFront + 0.14, 0.36, 0.52);
        for (const side of [-1, 1]) {
          const cheek = new THREE.Mesh(makeWorldBoxGeo(0.16, 0.58, 0.72, 1.1), this.coralStoneMat);
          cheek.position.set(cx + side * (stepW * 0.5 + 0.09), (bwY + deckY) * 0.5 - 0.14, zFront + 0.28);
          cheek.receiveShadow = true;
          this.group.add(cheek);
        }
      } else {
        const midStepY = (bwY + deckY) * 0.5;
        buildResortStep(midStepY, zFront + 0.20, 0.42, 0.34);
      }

      // Overhead timber shade pergola with sunlit slatted rafters, warm festoon lights & hanging bamboo wind chimes!
      if (withPergola) {
        const pH = 2.65;
        const colGeo = makeWorldBoxGeo(0.13, pH, 0.13, 1.2);
        for (const sx of [-width * 0.46, width * 0.46]) {
          for (const sz of [zFront - 0.25, zFront - depth + 0.25]) {
            const col = new THREE.Mesh(colGeo, this.darkWoodMat);
            col.position.set(cx + sx, deckY + pH * 0.5, sz);
            col.castShadow = true;
            this.group.add(col);
          }
        }
        for (const sz of [zFront - 0.25, zFront - depth + 0.25]) {
          const beam = new THREE.Mesh(makeWorldBoxGeo(width + 0.35, 0.16, 0.14, 1.4), this.darkWoodMat);
          beam.position.set(cx, deckY + pH + 0.04, sz);
          beam.castShadow = true;
          this.group.add(beam);
        }
        const slatCount = Math.max(6, Math.round(width / 0.65));
        for (let i = 0; i <= slatCount; i++) {
          const sx = cx - width * 0.48 + (i / slatCount) * width * 0.96;
          const slat = new THREE.Mesh(makeWorldBoxGeo(0.08, 0.11, depth + 0.25, 1.3), this.woodMat);
          slat.position.set(sx, deckY + pH + 0.16, cz);
          slat.castShadow = true;
          this.group.add(slat);
        }
        // Hanging handcrafted bamboo wind chimes on outer pergolas (visual anchor for real Koshi chime audio!)
        if (Math.abs(cx) > 40) {
          const chX = cx + (cx > 0 ? -width * 0.36 : width * 0.36);
          const chZ = zFront - 0.25;
          const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.03, 10), this.darkWoodMat);
          ring.position.set(chX, deckY + pH - 0.22, chZ);
          this.group.add(ring);
          for (let c = 0; c < 5; c++) {
            const ang = (c / 5) * Math.PI * 2;
            const len = 0.28 + (c % 3) * 0.07;
            const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, len, 6), this.bambooMat);
            tube.position.set(chX + Math.cos(ang) * 0.065, deckY + pH - 0.26 - len * 0.5, chZ + Math.sin(ang) * 0.065);
            this.group.add(tube);
          }
        }
        // Warm festoon bulbs draped along pergola front beam
        const bCount = Math.max(4, Math.round(width / 1.1));
        for (let b = 0; b <= bCount; b++) {
          const bx = cx - width * 0.42 + (b / bCount) * width * 0.84;
          const sag = Math.sin((b / bCount) * Math.PI) * 0.16;
          const by = deckY + pH - 0.08 - sag;
          const bz = zFront - 0.22;
          const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), bulbMat);
          bulb.position.set(bx, by, bz);
          this.group.add(bulb);
          this.addLightHalo(new THREE.Vector3(bx, by, bz), 1.4, 0xffbe66);
        }
      }

      addWalkableDeck(cx - width * 0.5, cx + width * 0.5, zFront - depth, zFront + 0.38, deckY, 'wood');
      return deckY;
    };

    // 0. West Coffee & Smoothie Cart Pergola Deck (x = -47.5)
    const coffeeY = addResortDeck(-47.5, 6.4, 4.4, true);
    this.coffeeCartDeckTop.set(-47.5, coffeeY, -28.9);

    // 1. West Picnic Terrace (x = -36.5)
    const westY = addResortDeck(-36.5, 6.0, 4.4, false);
    this.picnicTerraceSpots.push({ x: -36.5, y: westY, z: -28.75, yaw: Math.PI / 2 });

    // 2. Center Café Pergola Terrace (x = -9.6, between Surf Rack and Lifeguard Tower)
    const centerY = addResortDeck(-9.6, 5.2, 4.2, true);
    this.patioTerraceSpots.push({ x: -9.6, y: centerY, z: -28.65, yaw: 0.12 });

    // 3. East Café Pergola Terrace (x = +10.6, two cafe table sets between Lifeguard Tower & Pier)
    const eastY = addResortDeck(10.6, 8.6, 4.3, true);
    this.patioTerraceSpots.push({ x: 8.4, y: eastY, z: -28.7, yaw: -0.08 });
    this.patioTerraceSpots.push({ x: 12.9, y: eastY, z: -28.7, yaw: 0.14 });

    // 4. Far East Picnic Terrace (x = +33.0)
    const farEastY = addResortDeck(33.0, 6.0, 4.4, false);
    this.picnicTerraceSpots.push({ x: 33.0, y: farEastY, z: -28.75, yaw: Math.PI / 2 });

    // 5. East Lagoon Scenic Overlook Pergola Deck (x = +48.5)
    const eastOverlookY = addResortDeck(48.5, 7.4, 4.4, true);
    this.eastOverlookDeckTop.set(48.5, eastOverlookY, -28.9);
  }

  private buildDuneRopeFence(): void {
    const postGeo = new THREE.CylinderGeometry(0.068, 0.082, 1.25, 9);
    const segments: Array<[number, number]> = [
      [-62, -52.5],
      [-43.5, -40.5],
      [-32, -28],
      [2.8, 5.6],
      [15.8, 18.8],
      [25.5, 29.0],
      [37.2, 43.8],
      [53.2, 62]
    ];

    for (const [sX, eX] of segments) {
      const span = eX - sX;
      const steps = Math.max(1, Math.round(span / 4.2));
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= steps; k++) {
        const x = THREE.MathUtils.lerp(sX, eX, k / steps);
        const z = -27.4;
        const y = getTerrainHeight(x, z);
        const post = new THREE.Mesh(postGeo, this.darkWoodMat);
        post.position.set(x, y + 0.52, z);
        post.castShadow = true;
        post.receiveShadow = true;
        this.group.add(post);
        addCollider(x, z, 0.15, 1.1);
        pts.push(new THREE.Vector3(x, y + 0.96, z));
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const mid = a.clone().lerp(b, 0.5);
        mid.y -= 0.16;
        const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
        const rope = new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.022, 6, false), this.ropeMat);
        this.group.add(rope);
      }
    }
  }

  private buildOceanPier(): void {
    const pierX = 22.0;
    const halfW = 2.05;
    const deckY = 2.15;
    const rampStartZ = -23.5;
    const rampEndZ = -14.0;
    const pierEndZ = 24.0;
    const rampStartY = getBoardwalkY(pierX);

    const getPierY = (z: number) => {
      if (z <= rampEndZ) {
        const t = THREE.MathUtils.clamp((z - rampStartZ) / (rampEndZ - rampStartZ), 0, 1);
        return THREE.MathUtils.lerp(rampStartY, deckY, t);
      }
      return deckY;
    };

    const step = 0.38;
    const count = Math.floor((pierEndZ - rampStartZ) / step) + 1;
    const plankGeo = makeWorldBoxGeo(halfW * 2, 0.09, 0.32, 1.4);
    const instPlanks = new THREE.InstancedMesh(plankGeo, this.woodMat, count);
    instPlanks.castShadow = true;
    instPlanks.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const pCol = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const z = rampStartZ + i * step;
      const y = getPierY(z);
      const slope = z < rampEndZ ? Math.atan2(deckY - rampStartY, rampEndZ - rampStartZ) : 0;
      dummy.position.set(pierX, y - 0.045, z);
      dummy.rotation.set(-slope, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      instPlanks.setMatrixAt(i, dummy.matrix);
      const h = ((i * 59) % 100) / 100;
      pCol.setHSL(0.112 + (h - 0.5) * 0.015, 0.32 + (h - 0.5) * 0.08, 0.90 + (h - 0.5) * 0.12);
      instPlanks.setColorAt(i, pCol);
    }
    instPlanks.instanceMatrix.needsUpdate = true;
    if (instPlanks.instanceColor) instPlanks.instanceColor.needsUpdate = true;
    this.pierGroup.add(instPlanks);

    // Side structural stringers along the main pier AND sloped approach ramp (zero floating planks!)
    const pierLen = pierEndZ - rampEndZ;
    const stringerGeo = makeWorldBoxGeo(0.18, 0.26, pierLen, 1.5);
    const rampRun = rampEndZ - rampStartZ;
    const rampRise = deckY - rampStartY;
    const rampLen = Math.hypot(rampRun, rampRise) + 0.18;
    const rampSlope = Math.atan2(rampRise, rampRun);
    const rampStringerGeo = makeWorldBoxGeo(0.18, 0.28, rampLen, 1.4);
    const rampMidZ = (rampStartZ + rampEndZ) * 0.5;
    const rampMidY = (rampStartY + deckY) * 0.5;
    for (const side of [-1, 1]) {
      const beam = new THREE.Mesh(stringerGeo, this.weatheredWoodMat);
      beam.position.set(pierX + side * (halfW - 0.16), deckY - 0.18, (rampEndZ + pierEndZ) * 0.5);
      beam.castShadow = true;
      beam.receiveShadow = true;
      this.pierGroup.add(beam);

      // Sloped timber stringer supporting the entire landward approach ramp from boardwalk to pier
      const rampBeam = new THREE.Mesh(rampStringerGeo, this.weatheredWoodMat);
      rampBeam.position.set(pierX + side * (halfW - 0.16), rampMidY - 0.18, rampMidZ);
      rampBeam.rotation.x = -rampSlope;
      rampBeam.castShadow = true;
      rampBeam.receiveShadow = true;
      this.pierGroup.add(rampBeam);
    }

    // Center longitudinal keel beam + grounded timber support bents under the approach ramp
    const centerRampBeam = new THREE.Mesh(rampStringerGeo, this.darkWoodMat);
    centerRampBeam.position.set(pierX, rampMidY - 0.20, rampMidZ);
    centerRampBeam.rotation.x = -rampSlope;
    this.pierGroup.add(centerRampBeam);

    const crossBearerGeo = makeWorldBoxGeo(halfW * 2 - 0.08, 0.20, 0.20, 1.3);
    const rampPilingGeo = makeWorldCylinderGeo(0.13, 0.15, 3.6, 10, 1.3);

    const pilingGeo = makeWorldCylinderGeo(0.14, 0.16, 7.4, 10, 1.4);
    const postGeo = makeWorldCylinderGeo(0.078, 0.088, 1.08, 8, 1.1);
    const leftPosts: THREE.Vector3[] = [];
    const rightPosts: THREE.Vector3[] = [];
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x262c32, roughness: 0.45, metalness: 0.72 });
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xffe4a8,
      emissive: 0xffa93a,
      emissiveIntensity: 0.45
    });
    this.stringLightBulbs.push(bulbMat);

    // Grounded timber bents + descending handrail posts along the approach ramp (z = -22.2 .. -16.8)
    const rampPostZs = [-22.2, -19.5, -16.8];
    for (const rz of rampPostZs) {
      const ry = getPierY(rz);
      const crossBearer = new THREE.Mesh(crossBearerGeo, this.darkWoodMat);
      crossBearer.position.set(pierX, ry - 0.24, rz);
      crossBearer.castShadow = true;
      crossBearer.receiveShadow = true;
      this.pierGroup.add(crossBearer);

      for (const side of [-1, 1]) {
        const px = pierX + side * (halfW - 0.15);
        const piling = new THREE.Mesh(rampPilingGeo, this.darkWoodMat);
        piling.position.set(px, ry - 1.85, rz);
        piling.castShadow = true;
        piling.receiveShadow = true;
        this.pierGroup.add(piling);
        addCollider(px, rz, 0.24, 5.0);

        const railPost = new THREE.Mesh(postGeo, this.darkWoodMat);
        railPost.position.set(px, ry + 0.54, rz);
        railPost.castShadow = true;
        this.pierGroup.add(railPost);

        const topPt = new THREE.Vector3(px, ry + 0.94, rz);
        if (side < 0) leftPosts.push(topPt);
        else rightPosts.push(topPt);
      }
    }

    // Exact evenly spaced pilings reaching right to the pier tip (z = 23.8)
    const postZs = [-14.0, -9.8, -5.6, -1.4, 2.8, 7.0, 11.2, 15.4, 19.6, 23.8];
    for (let idx = 0; idx < postZs.length; idx++) {
      const z = postZs[idx];
      const y = getPierY(z);
      for (const side of [-1, 1]) {
        const px = pierX + side * (halfW - 0.15);
        const piling = new THREE.Mesh(pilingGeo, this.darkWoodMat);
        piling.position.set(px, y - 3.65, z);
        piling.castShadow = true;
        piling.receiveShadow = true;
        this.pierGroup.add(piling);
        addCollider(px, z, 0.22, 6.0);

        // Tall dock lantern post on every 3rd pair & pier end (properly framed iron lantern cap — ZERO floating orbs!)
        const isLanternPost = idx === 3 || idx === 6 || idx === postZs.length - 1;
        const postH = isLanternPost ? 1.55 : 1.08;
        const railPost = new THREE.Mesh(
          isLanternPost ? new THREE.CylinderGeometry(0.082, 0.092, postH, 8) : postGeo,
          this.darkWoodMat
        );
        railPost.position.set(px, y + postH * 0.5, z);
        railPost.castShadow = true;
        this.pierGroup.add(railPost);

        if (isLanternPost) {
          const basePlate = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.24), ironMat);
          basePlate.position.set(px, y + postH + 0.02, z);
          this.pierGroup.add(basePlate);
          const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.22, 8), bulbMat);
          glass.position.set(px, y + postH + 0.15, z);
          this.pierGroup.add(glass);
          this.addLightHalo(new THREE.Vector3(px, y + postH + 0.15, z), 2.1, 0xffb347);
          const cap = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.11, 4), ironMat);
          cap.rotation.y = Math.PI / 4;
          cap.position.set(px, y + postH + 0.30, z);
          this.pierGroup.add(cap);
        }

        const topPt = new THREE.Vector3(px, y + 0.94, z);
        if (side < 0) leftPosts.push(topPt);
        else rightPosts.push(topPt);
      }
    }

    for (const arr of [leftPosts, rightPosts]) {
      for (let i = 0; i < arr.length - 1; i++) {
        const a = arr[i];
        const b = arr[i + 1];
        const mid = a.clone().lerp(b, 0.5);
        mid.y -= 0.12;
        const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
        const rope = new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.028, 6, false), this.ropeMat);
        this.pierGroup.add(rope);
      }
    }

    // 2 Wooden Ocean-View Pier Benches neatly tucked along east side of pier
    for (const bz of [4.8, 13.4]) {
      const bench = new THREE.Group();
      bench.position.set(pierX + 1.38, deckY, bz);
      bench.rotation.y = -Math.PI / 2;
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.07, 0.48), this.woodMat);
      seat.position.y = 0.44;
      seat.castShadow = true;
      bench.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.38, 0.06), this.woodMat);
      back.position.set(0, 0.72, -0.22);
      back.rotation.x = -0.15;
      bench.add(back);
      for (const lx of [-0.66, 0.66]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.44, 0.42), this.darkWoodMat);
        leg.position.set(lx, 0.22, 0);
        bench.add(leg);
      }
      this.pierGroup.add(bench);
    }

    // Heavy dockside mooring bollards + coiled marine ropes + fishing bucket
    for (const [bx, bz] of [[pierX - 1.52, 8.8], [pierX - 1.52, 21.8], [pierX + 1.52, 21.8]]) {
      const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.42, 10), ironMat);
      bollard.position.set(bx, deckY + 0.21, bz);
      this.pierGroup.add(bollard);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 10), ironMat);
      cap.position.set(bx, deckY + 0.43, bz);
      this.pierGroup.add(cap);
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 7, 14), this.ropeMat);
      coil.rotation.x = Math.PI / 2;
      coil.position.set(bx + 0.32 * (bx < pierX ? 1 : -1), deckY + 0.035, bz + 0.25);
      this.pierGroup.add(coil);
    }

    // Red rescue life-ring mounted on pier rail post
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xe63946, roughness: 0.38 });
    const pierRing = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.065, 8, 16), ringMat);
    pierRing.position.set(pierX - halfW + 0.04, deckY + 0.62, 15.4);
    pierRing.rotation.y = Math.PI / 2;
    this.pierGroup.add(pierRing);

    // Moored wooden coastal rowboat bobbing right beside the Ocean Pier on live Gerstner waves!
    this.mooredBoat = this.buildMooredRowboat();
    this.mooredBoat.userData.dynamic = true;
    this.mooredBoat.position.set(this.boatPos.x, 0.0, this.boatPos.z);
    this.pierGroup.add(this.mooredBoat);

    // Shape-accurate dynamic OBB hull collision + climbable inner wood floor for the moored rowboat!
    addOrientedBoxCollider(this.boatPos.x, this.boatPos.z, 0.86, 2.02, 0.14, -0.95, 0.42, 'moored_rowboat');
    addWalkableDeck(
      this.boatPos.x - 0.72,
      this.boatPos.x + 0.72,
      this.boatPos.z - 1.65,
      this.boatPos.z + 1.65,
      () => this.liveBoatDeckY,
      'wood'
    );

    // Export 2 scenic fishing spots near the end of the pier for NPC fishermen!
    this.pierFisherSpots.push(
      { x: pierX - 1.32, y: deckY, z: 18.0, yaw: -Math.PI * 0.5 },
      { x: pierX + 1.25, y: deckY, z: 22.8, yaw: 0.18 }
    );

    addWalkableDeck(pierX - halfW, pierX + halfW, rampStartZ, pierEndZ, (_x, z) => getPierY(z), 'wood');
    // Low landward approach ramp side barriers (block under-ramp clipping), while elevated pier (z > -14)
    // keeps its railing collider at deck height so beachgoers & joggers can stroll cleanly under the high pier!
    addBoxCollider(pierX - halfW - 0.16, pierX - halfW + 0.16, rampStartZ + 0.6, rampEndZ, 0.0, deckY + 1.3);
    addBoxCollider(pierX + halfW - 0.16, pierX + halfW + 0.16, rampStartZ + 0.6, rampEndZ, 0.0, deckY + 1.3);
    addBoxCollider(pierX - halfW - 0.16, pierX - halfW + 0.16, rampEndZ, pierEndZ, deckY - 0.15, deckY + 1.3);
    addBoxCollider(pierX + halfW - 0.16, pierX + halfW + 0.16, rampEndZ, pierEndZ, deckY - 0.15, deckY + 1.3);
  }

  private buildMooredRowboat(): THREE.Group {
    const boat = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({
      map: this.paintWhiteMat.map,
      normalMap: this.paintWhiteMat.normalMap,
      roughnessMap: this.paintWhiteMat.roughnessMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      color: 0xf4f1ea,
      roughness: 0.68,
      side: THREE.DoubleSide
    });
    const trimMat = new THREE.MeshStandardMaterial({
      map: this.paintWhiteMat.map,
      normalMap: this.paintWhiteMat.normalMap,
      color: 0x1e748d,
      roughness: 0.55
    });

    // Sculpted double-ended buoyant wooden skiff hull sitting proudly on the waves
    const hullGeo = new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, Math.PI * 0.48, Math.PI * 0.52);
    hullGeo.scale(0.86, 0.56, 2.02);
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.position.y = 0.46;
    hull.castShadow = true;
    hull.receiveShadow = true;
    boat.add(hull);

    // Flat inner weathered wooden floorboards widened cleanly to seal bow & stern hull tips
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(0.77, 0.71, 0.06, 18), this.weatheredWoodMat);
    floor.scale.set(1.0, 1.0, 2.40);
    floor.position.y = 0.255;
    boat.add(floor);

    // Gunwale stripe & wooden bench thwarts + resting oars
    const gunwale = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.06, 8, 22), trimMat);
    gunwale.rotation.x = Math.PI / 2;
    gunwale.scale.set(0.92, 2.12, 1);
    gunwale.position.y = 0.48;
    boat.add(gunwale);

    for (const tz of [-0.65, 0.1, 0.85]) {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.05, 0.28), this.woodMat);
      bench.position.set(0, 0.36, tz);
      boat.add(bench);
    }

    for (const ox of [-0.30, 0.30]) {
      const oar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.92, 6), this.woodMat);
      oar.rotation.x = Math.PI / 2;
      oar.position.set(ox, 0.41, -0.1);
      boat.add(oar);
    }

    boat.rotation.y = 0.14;
    return boat;
  }

  private buildTikiSurfBar(createDrinkFn: () => THREE.Group): { x: number; y: number; z: number; yaw: number } {
    const cx = -22.0;
    const cz = -30.0;
    const bwY = getBoardwalkY(cx);
    // Sample entire rear & interior footprint so hillside sand NEVER buries bar deck or bartender feet!
    let maxGround = getTerrainHeight(cx, cz);
    for (const ox of [-4.5, -2.0, 0, 2.0, 4.5]) {
      for (const oz of [-3.0, -1.2, 0.6, 2.4]) {
        maxGround = Math.max(maxGround, getTerrainHeight(cx + ox, cz + oz));
      }
    }
    const deckY = Math.max(bwY + 0.34, maxGround + 0.14);
    this.tikiDeckY = deckY;
    const g = new THREE.Group();
    g.position.set(cx, deckY, cz);

    // Coral-stone masonry plinth foundation + overhanging sunlit cedar deck slab (zero stretched wood!)
    const stonePlinth = new THREE.Mesh(makeWorldBoxGeo(9.26, 2.08, 6.46, 1.45), this.coralStoneMat);
    stonePlinth.position.set(0, -1.16, 0.15);
    stonePlinth.receiveShadow = true;
    stonePlinth.castShadow = true;
    g.add(stonePlinth);

    const deckSlab = new THREE.Mesh(makeWorldBoxGeo(9.52, 0.13, 6.72, 1.5), this.woodMat);
    deckSlab.position.set(0, -0.065, 0.15);
    deckSlab.receiveShadow = true;
    deckSlab.castShadow = true;
    g.add(deckSlab);

    // Handcrafted resort entry stairs rising cleanly from boardwalk onto the Tiki Bar deck
    // (coral-stone risers + overhanging cedar bullnose treads + brass anti-slip nosing + stone cheek walls!)
    const stairWidth = 4.6;
    const rise = Math.max(0.1, deckY - bwY);
    const stepCount = Math.max(2, Math.min(5, Math.ceil(rise / 0.28)));
    const treadRun = 0.34;
    for (let i = 0; i < stepCount; i++) {
      const frac = (i + 1) / (stepCount + 1);
      const sy = THREE.MathUtils.lerp(bwY, deckY, frac);
      const sz = 3.18 + (stepCount - i) * treadRun;
      const stepH = Math.max(0.42, sy - bwY + 0.40);

      const riser = new THREE.Mesh(makeWorldBoxGeo(stairWidth - 0.08, stepH, treadRun + 0.02, 1.25), this.coralStoneMat);
      riser.position.set(0, sy - deckY - 0.055 - stepH * 0.5, sz - 0.02);
      riser.receiveShadow = true;
      riser.castShadow = true;
      g.add(riser);

      const tread = new THREE.Mesh(makeWorldBoxGeo(stairWidth + 0.06, 0.055, treadRun + 0.08, 1.35), this.woodMat);
      tread.position.set(0, sy - deckY - 0.0275, sz + 0.01);
      tread.receiveShadow = true;
      tread.castShadow = true;
      g.add(tread);

      const nosing = new THREE.Mesh(new THREE.BoxGeometry(stairWidth + 0.04, 0.016, 0.024), this.brassMat);
      nosing.position.set(0, sy - deckY - 0.005, sz + treadRun * 0.5 + 0.042);
      g.add(nosing);
    }
    for (const side of [-1, 1]) {
      const cheekLen = stepCount * treadRun + 0.32;
      const cheek = new THREE.Mesh(makeWorldBoxGeo(0.22, rise + 0.45, cheekLen, 1.25), this.coralStoneMat);
      cheek.position.set(side * (stairWidth * 0.5 + 0.12), -rise * 0.5 - 0.14, 3.35 + cheekLen * 0.5);
      cheek.receiveShadow = true;
      cheek.castShadow = true;
      g.add(cheek);
      const cheekCap = new THREE.Mesh(makeWorldBoxGeo(0.26, 0.06, cheekLen + 0.04, 1.2), this.darkWoodMat);
      cheekCap.position.set(side * (stairWidth * 0.5 + 0.12), 0.09, 3.35 + cheekLen * 0.5);
      g.add(cheekCap);
    }

    const zTopWalk = cz + 3.12;
    const zBotWalk = cz + 3.18 + (stepCount + 1) * treadRun;
    addWalkableDeck(
      cx - stairWidth * 0.5,
      cx + stairWidth * 0.5,
      zTopWalk,
      zBotWalk,
      (_x, z) => {
        const t = THREE.MathUtils.clamp((zBotWalk - z) / (zBotWalk - zTopWalk), 0, 1);
        return THREE.MathUtils.lerp(bwY, deckY, t);
      },
      'wood'
    );

    const colGeo = new THREE.CylinderGeometry(0.14, 0.16, 3.25, 10);
    for (const sx of [-4.2, 0, 4.2]) {
      for (const sz of [-2.75, 2.25]) {
        if (sx === 0 && sz > 0) continue;
        const col = new THREE.Mesh(colGeo, this.darkWoodMat);
        col.position.set(sx, 1.62, sz);
        col.castShadow = true;
        col.receiveShadow = true;
        g.add(col);
      }
    }

    const frontBeam = new THREE.Mesh(new THREE.BoxGeometry(8.9, 0.22, 0.24), this.darkWoodMat);
    frontBeam.position.set(0, 3.22, 2.25);
    g.add(frontBeam);
    const backBeam = new THREE.Mesh(new THREE.BoxGeometry(8.9, 0.22, 0.24), this.darkWoodMat);
    backBeam.position.set(0, 3.22, -2.75);
    g.add(backBeam);
    for (const sx of [-4.2, 4.2]) {
      const sideBeam = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 5.25), this.darkWoodMat);
      sideBeam.position.set(sx, 3.22, -0.25);
      g.add(sideBeam);
    }

    const backWall = new THREE.Mesh(makeWorldBoxGeo(8.6, 3.35, 0.24, 1.5), this.paintTealMat);
    backWall.position.set(0, 1.42, -2.68);
    backWall.castShadow = true;
    backWall.receiveShadow = true;
    g.add(backWall);

    const wainscot = new THREE.Mesh(makeWorldBoxGeo(8.66, 1.15, 0.28, 1.35), this.darkWoodMat);
    wainscot.position.set(0, 0.48, -2.66);
    wainscot.receiveShadow = true;
    g.add(wainscot);

    const menuTex = createChalkboardTexture();
    const menuBoard = new THREE.Mesh(
      new THREE.BoxGeometry(2.15, 1.32, 0.06),
      new THREE.MeshStandardMaterial({ map: menuTex, roughness: 0.82 })
    );
    menuBoard.position.set(2.55, 1.88, -2.53);
    g.add(menuBoard);

    const bottlePalettes = [
      { col: 0x2b6e4e, rough: 0.14 },
      { col: 0x9c5a21, rough: 0.16 },
      { col: 0x225a8c, rough: 0.14 },
      { col: 0xd9cbb8, rough: 0.22 },
      { col: 0x7c2d26, rough: 0.16 }
    ];
    const bottleBodyGeo = new THREE.CylinderGeometry(0.042, 0.046, 0.20, 10);
    const bottleNeckGeo = new THREE.CylinderGeometry(0.016, 0.036, 0.10, 8);
    const corkMat = new THREE.MeshStandardMaterial({ color: 0xc9a36b, roughness: 0.85 });

    for (const sy of [1.28, 1.92]) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.07, 0.34), this.woodMat);
      shelf.position.set(-1.35, sy, -2.42);
      shelf.receiveShadow = true;
      g.add(shelf);

      for (let b = 0; b < 9; b++) {
        const pal = bottlePalettes[(b + (sy > 1.5 ? 2 : 0)) % bottlePalettes.length];
        const bMat = new THREE.MeshPhysicalMaterial({
          color: pal.col,
          roughness: pal.rough,
          metalness: 0.05,
          clearcoat: 0.85
        });
        const bx = -3.35 + b * 0.48 + (sy > 1.5 ? 0.12 : 0);
        const body = new THREE.Mesh(bottleBodyGeo, bMat);
        body.position.set(bx, sy + 0.135, -2.40);
        g.add(body);
        const neck = new THREE.Mesh(bottleNeckGeo, bMat);
        neck.position.set(bx, sy + 0.275, -2.40);
        g.add(neck);
        const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.025, 6), corkMat);
        cork.position.set(bx, sy + 0.33, -2.40);
        g.add(cork);
      }
    }

    const counterBase = new THREE.Mesh(makeWorldBoxGeo(7.3, 1.04, 0.84, 1.15), this.bambooMat);
    counterBase.position.set(0, 0.52, 0.72);
    counterBase.castShadow = true;
    counterBase.receiveShadow = true;
    g.add(counterBase);

    const ribGeo = makeWorldCylinderGeo(0.028, 0.028, 1.02, 7, 0.9);
    for (let rx = -3.45; rx <= 3.45; rx += 0.38) {
      const rib = new THREE.Mesh(ribGeo, this.bambooMat);
      rib.position.set(rx, 0.52, 1.15);
      g.add(rib);
    }

    const footRail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.024, 7.2, 8),
      this.brassMat
    );
    footRail.rotation.z = Math.PI / 2;
    footRail.position.set(0, 0.22, 1.38);
    g.add(footRail);

    const counterTop = new THREE.Mesh(
      makeWorldBoxGeo(7.7, 0.09, 1.12, 1.35),
      new THREE.MeshStandardMaterial({
        map: this.woodMat.map,
        normalMap: this.woodMat.normalMap,
        roughnessMap: this.woodMat.roughnessMap,
        color: 0xf2d9b2,
        roughness: 0.42
      })
    );
    counterTop.position.set(0, 1.08, 0.78);
    counterTop.castShadow = true;
    counterTop.receiveShadow = true;
    g.add(counterTop);

    for (const dx of [-2.4, -1.1, 0.4, 1.9]) {
      const drink = createDrinkFn();
      drink.position.set(dx, 1.13, 0.92);
      g.add(drink);
    }

    const thatchLoader = new THREE.TextureLoader();
    const thatchDiff = thatchLoader.load('./textures/thatch_roof_angled_diff_1k.jpg');
    thatchDiff.wrapS = thatchDiff.wrapT = THREE.RepeatWrapping;
    thatchDiff.repeat.set(5, 2);
    thatchDiff.anisotropy = 8;
    thatchDiff.colorSpace = THREE.SRGBColorSpace;

    const thatchNor = thatchLoader.load('./textures/thatch_roof_angled_nor_gl_1k.jpg');
    thatchNor.wrapS = thatchNor.wrapT = THREE.RepeatWrapping;
    thatchNor.repeat.set(5, 2);
    thatchNor.anisotropy = 8;

    const thatchRough = thatchLoader.load('./textures/thatch_roof_angled_rough_1k.jpg');
    thatchRough.wrapS = thatchRough.wrapT = THREE.RepeatWrapping;
    thatchRough.repeat.set(5, 2);
    thatchRough.anisotropy = 8;

    const thatchMat = new THREE.MeshStandardMaterial({
      map: thatchDiff,
      normalMap: thatchNor,
      roughnessMap: thatchRough,
      normalScale: new THREE.Vector2(1.0, 1.0),
      color: 0xe6cf9e,
      roughness: 1.0,
      side: THREE.DoubleSide
    });
    const lowerThatchGeo = new THREE.ConeGeometry(7.1, 1.55, 4);
    lowerThatchGeo.rotateY(Math.PI / 4);
    lowerThatchGeo.scale(1.13, 1.0, 0.85);
    const lowerRoof = new THREE.Mesh(lowerThatchGeo, thatchMat);
    lowerRoof.position.set(0, 3.85, -0.25);
    lowerRoof.castShadow = true;
    lowerRoof.receiveShadow = true;
    g.add(lowerRoof);

    const upperThatchGeo = new THREE.ConeGeometry(5.2, 1.35, 4);
    upperThatchGeo.rotateY(Math.PI / 4);
    upperThatchGeo.scale(1.12, 1.0, 0.84);
    const upperRoof = new THREE.Mesh(upperThatchGeo, thatchMat);
    upperRoof.position.set(0, 4.55, -0.25);
    upperRoof.castShadow = true;
    g.add(upperRoof);

    const soffit = new THREE.Mesh(new THREE.BoxGeometry(8.9, 0.08, 5.4), this.darkWoodMat);
    soffit.position.set(0, 3.24, -0.25);
    g.add(soffit);

    const signTex = createSignTexture('NEON TIKI', 'SURF SHOP  •  COLD DRINKS', '#143042', '#ffffff');
    this.tikiSignMat = new THREE.MeshStandardMaterial({
      map: signTex,
      emissiveMap: signTex,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.55,
      roughness: 0.45
    });
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(3.8, 1.02, 0.14),
      this.tikiSignMat
    );
    sign.position.set(0, 2.74, 2.38);
    sign.castShadow = true;
    g.add(sign);
    this.addLightHalo(new THREE.Vector3(cx, deckY + 2.74, cz + 2.52), 2.5, 0x38e2d8);

    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xfff0c8,
      emissive: 0xffb347,
      emissiveIntensity: 0.55
    });
    this.stringLightBulbs.push(bulbMat);
    for (let i = -4; i <= 4; i++) {
      if (Math.abs(i) <= 1) continue;
      const bx = i * 0.98;
      const by = 2.94 - Math.cos(i * 0.55) * 0.10;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), bulbMat);
      bulb.position.set(bx, by, 2.38);
      g.add(bulb);
      this.addLightHalo(new THREE.Vector3(cx + bx, deckY + by, cz + 2.38), 1.6, 0xffbe66);
    }

    const barLight = new THREE.PointLight(0xffb864, 0.0, 14, 1.6);
    barLight.position.set(0, 2.5, 1.4);
    barLight.visible = false;
    g.add(barLight);
    this.barLights.push(barLight);

    for (const sx of [-2.4, -0.8, 0.8, 2.4]) {
      this.barStoolSpots.push({ x: cx + sx, y: deckY, z: cz + 1.85, yaw: Math.PI });
    }

    this.group.add(g);

    addWalkableDeck(cx - 4.7, cx + 4.7, cz - 3.2, cz + 3.45, deckY, 'wood');
    addBoxCollider(cx - 4.3, cx + 4.3, cz - 2.9, cz - 2.3, deckY, deckY + 3.2);
    addBoxCollider(cx - 3.8, cx + 3.8, cz + 0.3, cz + 1.25, deckY, deckY + 1.3);

    return { x: cx, y: deckY, z: cz - 0.65, yaw: 0 };
  }

  private buildSurfboardRack(): number {
    const rx = -15.0;
    const rz = -27.55;
    const baseY = Math.max(getBoardwalkY(rx) - 0.04, getTerrainHeight(rx, rz));

    const g = new THREE.Group();
    g.position.set(rx, baseY, rz);

    const baseDeck = new THREE.Mesh(new THREE.BoxGeometry(3.55, 0.24, 1.05), this.darkWoodMat);
    baseDeck.position.set(0, -0.02, 0);
    baseDeck.receiveShadow = true;
    baseDeck.castShadow = true;
    g.add(baseDeck);

    const postGeo = new THREE.BoxGeometry(0.10, 1.32, 0.10);
    for (const sx of [-1.62, 1.62]) {
      const post = new THREE.Mesh(postGeo, this.darkWoodMat);
      post.position.set(sx, 0.68, -0.34);
      post.castShadow = true;
      g.add(post);
    }
    const crossBar = new THREE.Mesh(new THREE.BoxGeometry(3.40, 0.09, 0.09), this.woodMat);
    crossBar.position.set(0, 1.18, -0.34);
    crossBar.castShadow = true;
    g.add(crossBar);

    const pegGeo = new THREE.CylinderGeometry(0.022, 0.024, 0.56, 7);
    for (const px of [-1.62, -0.81, 0.0, 0.81, 1.62]) {
      const peg = new THREE.Mesh(pegGeo, this.woodMat);
      peg.rotation.x = Math.PI / 2;
      peg.position.set(px, 1.18, -0.06);
      g.add(peg);
    }

    this.group.add(g);
    addBoxCollider(rx - 1.75, rx + 1.75, rz - 0.52, rz + 0.42, baseY - 0.2, baseY + 1.8);
    return baseY + 0.10;
  }

  /**
   * Properly engineered Lifeguard Watchtower:
   *  - Main cabin balcony (`x: -1.8..+1.8, z: -1.5..+2.28`) PLUS a seamlessly connected
   *    elevated side landing platform (`x: +1.8..+3.02, z: +0.65..+2.28`) supported by extra
   *    heavy stilts & railings!
   *  - Angled wooden stair stringers, white handrails & 8 treads rise from the boardwalk
   *    (`z = +4.05`) directly FLUSH onto the front edge of the side landing platform (`z = +2.22`)!
   *  - Walkable collision covers EVERY tread, the landing platform, AND the balcony seamlessly!
   */
  private buildLifeguardTower(): { x: number; y: number; z: number; yaw: number } {
    const cx = -2.0;
    const cz = -30.8;
    const baseY = getTerrainHeight(cx, cz);
    const cabinFloorY = baseY + 2.35;

    const g = new THREE.Group();
    g.position.set(cx, baseY, cz);

    const paintWhite = this.paintWhiteMat;
    const paintTeal = this.paintTealMat;
    const redRescue = new THREE.MeshStandardMaterial({ color: 0xe63946, roughness: 0.35 });

    // 4 main heavy stilts + 2 landing-platform stilts (6 stilts total — zero hovering platform!)
    const stiltGeo = makeWorldBoxGeo(0.20, 3.2, 0.20, 1.3);
    const stiltCoords: Array<[number, number]> = [
      [-1.35, -1.25], [1.35, -1.25],
      [-1.35, 1.95], [1.35, 1.95],
      [2.88, 0.72], [2.88, 2.08]
    ];
    for (const [sx, sz] of stiltCoords) {
      const stilt = new THREE.Mesh(stiltGeo, this.weatheredWoodMat);
      stilt.position.set(sx, 1.05, sz);
      stilt.castShadow = true;
      stilt.receiveShadow = true;
      g.add(stilt);
      addCollider(cx + sx, cz + sz, 0.18, 2.5);
    }

    // Diagonal structural X-bracing beams between main stilts
    const braceGeo = makeWorldBoxGeo(3.3, 0.10, 0.08, 1.3);
    for (const sz of [-1.25, 1.95]) {
      for (const dir of [-1, 1]) {
        const brace = new THREE.Mesh(braceGeo, this.darkWoodMat);
        brace.position.set(0, 1.20, sz);
        brace.rotation.z = dir * 0.62;
        g.add(brace);
      }
    }

    // Main balcony deck
    const deck = new THREE.Mesh(makeWorldBoxGeo(3.6, 0.18, 3.85, 1.45), this.woodMat);
    deck.position.set(0, 2.35, 0.35);
    deck.castShadow = true;
    deck.receiveShadow = true;
    g.add(deck);

    // Side landing platform seamlessly joined flush with the main balcony deck!
    const landingDeck = new THREE.Mesh(makeWorldBoxGeo(1.30, 0.18, 1.68, 1.45), this.woodMat);
    landingDeck.position.set(2.40, 2.35, 1.44);
    landingDeck.castShadow = true;
    landingDeck.receiveShadow = true;
    g.add(landingDeck);

    // Landing platform outer right & back coastal white safety railings with mid-rail & post caps
    const landBackRail = new THREE.Mesh(makeWorldBoxGeo(1.30, 0.09, 0.09, 1.1), paintWhite);
    landBackRail.position.set(2.40, 3.25, 0.66);
    g.add(landBackRail);
    const landBackMid = new THREE.Mesh(makeWorldBoxGeo(1.26, 0.055, 0.055, 1.1), paintWhite);
    landBackMid.position.set(2.40, 2.84, 0.66);
    g.add(landBackMid);
    const landRightRail = new THREE.Mesh(makeWorldBoxGeo(0.09, 0.09, 1.62, 1.1), paintWhite);
    landRightRail.position.set(2.98, 3.25, 1.44);
    g.add(landRightRail);
    const landRightMid = new THREE.Mesh(makeWorldBoxGeo(0.055, 0.055, 1.58, 1.1), paintWhite);
    landRightMid.position.set(2.98, 2.84, 1.44);
    g.add(landRightMid);
    for (const [rx, rz] of [[2.98, 0.66], [2.98, 2.22], [1.80, 0.66]]) {
      const rp = new THREE.Mesh(makeWorldBoxGeo(0.085, 0.94, 0.085, 1.0), paintWhite);
      rp.position.set(rx, 2.82, rz);
      g.add(rp);
      const cap = new THREE.Mesh(makeWorldBoxGeo(0.12, 0.035, 0.12, 0.8), this.darkWoodMat);
      cap.position.set(rx, 3.31, rz);
      g.add(cap);
    }

    // Cabin enclosure (real painted coastal teal wood planks + painted white corner trim)
    const lowerWall = new THREE.Mesh(makeWorldBoxGeo(2.7, 1.15, 2.25, 1.35), paintTeal);
    lowerWall.position.set(0, 2.98, -0.40);
    lowerWall.castShadow = true;
    lowerWall.receiveShadow = true;
    g.add(lowerWall);

    for (const sx of [-1.25, 1.25]) {
      for (const sz of [-1.42, 0.72]) {
        const p = new THREE.Mesh(makeWorldBoxGeo(0.11, 1.35, 0.11, 1.0), paintWhite);
        p.position.set(sx, 4.1, sz);
        g.add(p);
      }
    }
    const roof = new THREE.Mesh(makeWorldBoxGeo(3.45, 0.16, 3.65, 1.4), paintWhite);
    roof.position.set(0, 4.82, -0.05);
    roof.rotation.x = 0.12;
    roof.castShadow = true;
    g.add(roof);

    // Front balcony railing + posts + vertical balusters
    const rail = new THREE.Mesh(makeWorldBoxGeo(3.55, 0.09, 0.09, 1.1), paintWhite);
    rail.position.set(0, 3.25, 2.22);
    g.add(rail);
    const frontMidRail = new THREE.Mesh(makeWorldBoxGeo(3.50, 0.05, 0.05, 1.1), paintWhite);
    frontMidRail.position.set(0, 2.82, 2.22);
    g.add(frontMidRail);
    for (const sx of [-1.72, 0, 1.72]) {
      const rp = new THREE.Mesh(makeWorldBoxGeo(0.085, 0.94, 0.085, 1.0), paintWhite);
      rp.position.set(sx, 2.82, 2.22);
      g.add(rp);
      const cap = new THREE.Mesh(makeWorldBoxGeo(0.12, 0.035, 0.12, 0.8), this.darkWoodMat);
      cap.position.set(sx, 3.31, 2.22);
      g.add(cap);
    }

    const buoy = new THREE.Mesh(new THREE.CapsuleGeometry(0.10, 0.48, 6, 10), redRescue);
    buoy.rotation.z = Math.PI / 2;
    buoy.position.set(1.36, 2.95, 2.28);
    buoy.castShadow = true;
    g.add(buoy);

    const lifeRing = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.06, 8, 16), redRescue);
    lifeRing.position.set(-1.38, 3.05, 0.1);
    lifeRing.rotation.y = Math.PI / 2;
    g.add(lifeRing);

    // Engineered staircase terminating 100% FLUSH onto the front edge of the side landing platform!
    const stairX = 2.40;
    const stairZ0 = 4.35; // bottom resting solidly right beside boardwalk!
    const stairZ1 = 2.22; // top meeting landingDeck front edge seamlessly!
    const bwLocalY = getBoardwalkY(cx + stairX) - baseY;
    const stairY0 = Math.max(-0.18, bwLocalY);
    const stairY1 = 2.35;
    const stairRun = stairZ0 - stairZ1;
    const stairRise = stairY1 - stairY0;
    const stairLen = Math.hypot(stairRun, stairRise);
    const stairPitch = Math.atan2(stairRise, stairRun);

    // Handcrafted Coastal Lifeguard Staircase: notched oak stringers, sunlit cedar overhanging treads,
    // painted white kick-board risers, brushed brass anti-slip nosing & turned coastal white balusters!
    for (const side of [-0.56, 0.56]) {
      const stringer = new THREE.Mesh(makeWorldBoxGeo(0.10, 0.24, stairLen + 0.22, 1.25), this.darkWoodMat);
      stringer.position.set(stairX + side, (stairY0 + stairY1) * 0.5 - 0.10, (stairZ0 + stairZ1) * 0.5);
      stringer.rotation.x = stairPitch;
      stringer.castShadow = true;
      stringer.receiveShadow = true;
      g.add(stringer);

      const handRail = new THREE.Mesh(makeWorldBoxGeo(0.085, 0.075, stairLen + 0.18, 1.1), paintWhite);
      handRail.position.set(stairX + side, (stairY0 + stairY1) * 0.5 + 0.86, (stairZ0 + stairZ1) * 0.5);
      handRail.rotation.x = stairPitch;
      handRail.castShadow = true;
      g.add(handRail);

      const midRail = new THREE.Mesh(makeWorldBoxGeo(0.05, 0.05, stairLen + 0.10, 1.1), paintWhite);
      midRail.position.set(stairX + side, (stairY0 + stairY1) * 0.5 + 0.44, (stairZ0 + stairZ1) * 0.5);
      midRail.rotation.x = stairPitch;
      g.add(midRail);

      const botPost = new THREE.Mesh(makeWorldBoxGeo(0.10, 1.22, 0.10, 1.0), paintWhite);
      botPost.position.set(stairX + side, stairY0 + 0.36, stairZ0);
      botPost.castShadow = true;
      g.add(botPost);
      const botCap = new THREE.Mesh(makeWorldBoxGeo(0.13, 0.035, 0.13, 0.8), this.darkWoodMat);
      botCap.position.set(stairX + side, stairY0 + 0.985, stairZ0);
      g.add(botCap);

      const topPost = new THREE.Mesh(makeWorldBoxGeo(0.10, 1.05, 0.10, 1.0), paintWhite);
      topPost.position.set(stairX + side, stairY1 + 0.46, stairZ1);
      topPost.castShadow = true;
      g.add(topPost);
      const topCap = new THREE.Mesh(makeWorldBoxGeo(0.13, 0.035, 0.13, 0.8), this.darkWoodMat);
      topCap.position.set(stairX + side, stairY1 + 1.00, stairZ1);
      g.add(topCap);

      // Vertical balusters connecting stringer to handrail
      for (let b = 1; b <= 5; b++) {
        const bf = b / 6;
        const bal = new THREE.Mesh(makeWorldBoxGeo(0.04, 0.88, 0.04, 0.9), paintWhite);
        bal.position.set(
          stairX + side,
          THREE.MathUtils.lerp(stairY0, stairY1, bf) + 0.42,
          THREE.MathUtils.lerp(stairZ0, stairZ1, bf)
        );
        g.add(bal);
      }
    }

    const lgSteps = 8;
    const lgRiseStep = stairRise / lgSteps;
    for (let s = 0; s < lgSteps; s++) {
      const t = (s + 0.5) / lgSteps;
      const sy = THREE.MathUtils.lerp(stairY0, stairY1, t);
      const sz = THREE.MathUtils.lerp(stairZ0, stairZ1, t);

      // Sunlit overhanging cedar stair tread (real-meter UVs!)
      const tread = new THREE.Mesh(makeWorldBoxGeo(1.10, 0.058, 0.34, 1.2), this.woodMat);
      tread.position.set(stairX, sy, sz);
      tread.castShadow = true;
      tread.receiveShadow = true;
      g.add(tread);

      // Crisp painted white coastal kick-board riser closing step back cleanly
      const riser = new THREE.Mesh(makeWorldBoxGeo(1.04, lgRiseStep + 0.02, 0.04, 1.0), paintWhite);
      riser.position.set(stairX, sy - lgRiseStep * 0.5 - 0.01, sz - 0.145);
      riser.receiveShadow = true;
      g.add(riser);

      // Subtle brushed marine brass anti-slip edge nosing along front lip
      const nosing = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.015, 0.022), this.brassMat);
      nosing.position.set(stairX, sy + 0.026, sz + 0.165);
      g.add(nosing);
    }

    const lgSign = createSignTexture('LIFEGUARD', 'TOWER 01 • BAY WATCH', '#e63946', '#ffffff');
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.52, 0.08),
      new THREE.MeshStandardMaterial({ map: lgSign, roughness: 0.45 })
    );
    sign.position.set(0, 2.95, 2.26);
    g.add(sign);

    this.group.add(g);

    // Seamless walkable deck collision: Staircase -> Side Landing Platform -> Main Balcony!
    addWalkableDeck(
      cx + stairX - 0.62,
      cx + stairX + 0.62,
      cz + stairZ1,
      cz + stairZ0 + 0.25,
      (_x, z) => {
        const t = THREE.MathUtils.clamp((cz + stairZ0 - z) / stairRun, 0, 1);
        return baseY + THREE.MathUtils.lerp(stairY0, stairY1 + 0.09, t);
      },
      'wood'
    );
    addWalkableDeck(cx + 1.70, cx + 3.05, cz + 0.60, cz + 2.30, cabinFloorY + 0.09, 'wood');
    addWalkableDeck(cx - 1.80, cx + 1.82, cz - 1.55, cz + 2.30, cabinFloorY + 0.09, 'wood');
    addBoxCollider(cx - 1.35, cx + 1.35, cz - 1.50, cz + 0.72, cabinFloorY, cabinFloorY + 2.2);

    return { x: cx, y: cabinFloorY + 0.09, z: cz + 1.55, yaw: 0 };
  }

  /**
   * Outdoor Wooden Beach Rinse Shower beside the boardwalk with live animated water stream!
   */
  private buildBeachShower(): void {
    const sx = -18.2;
    const sz = -22.6;
    const sy = getTerrainHeight(sx, sz);

    const g = new THREE.Group();
    g.position.set(sx, sy, sz);

    // Slatted teak duckboard drainage pad resting on a coral-stone curb!
    const curb = new THREE.Mesh(makeWorldBoxGeo(1.26, 0.14, 1.26, 1.1), this.coralStoneMat);
    curb.position.y = -0.02;
    curb.receiveShadow = true;
    g.add(curb);
    const pad = new THREE.Mesh(makeWorldBoxGeo(1.14, 0.055, 1.14, 1.1), this.woodMat);
    pad.position.y = 0.075;
    pad.receiveShadow = true;
    g.add(pad);

    // Timber shower post + copper pipe + showerhead
    const post = new THREE.Mesh(makeWorldBoxGeo(0.14, 2.35, 0.14, 1.2), this.darkWoodMat);
    post.position.set(0, 1.16, -0.45);
    post.castShadow = true;
    g.add(post);

    const copperMat = new THREE.MeshStandardMaterial({ color: 0xb87344, roughness: 0.34, metalness: 0.78 });
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 2.22, 8), copperMat);
    pipe.position.set(0, 1.15, -0.35);
    g.add(pipe);

    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.42, 8), copperMat);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(0, 2.24, -0.15);
    g.add(arm);

    const head = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.09, 10), copperMat);
    head.position.set(0, 2.18, 0.04);
    g.add(head);

    // Live animated glistening shower droplets falling onto the teak pad (single InstancedMesh)
    const dropMat = new THREE.MeshStandardMaterial({
      color: 0xe6fbff,
      emissive: 0xc5f2ff,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.65,
      roughness: 0.2
    });
    const dropGeo = new THREE.CylinderGeometry(0.006, 0.008, 0.16, 5);
    const dropInst = new THREE.InstancedMesh(dropGeo, dropMat, 12);
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const rad = 0.02 + (i % 3) * 0.035;
      const ox = Math.cos(ang) * rad;
      const oz = 0.04 + Math.sin(ang) * rad;
      this.showerDrops.push({ phase: i / 12, ox, oz });
      this.instDummy.position.set(ox, 1.0, oz);
      this.instDummy.rotation.set(0, 0, 0);
      this.instDummy.scale.set(1, 1, 1);
      this.instDummy.updateMatrix();
      dropInst.setMatrixAt(i, this.instDummy.matrix);
    }
    dropInst.instanceMatrix.needsUpdate = true;
    dropInst.userData.dynamic = true;
    g.add(dropInst);
    this.showerInstMesh = dropInst;

    this.group.add(g);
    addCollider(sx, sz - 0.45, 0.22, 2.2);
  }

  /**
   * Engineered Waterfront Resort Water Slide:
   *  - Flush 1.72m timber deck (`x=-22.0`, `z=0.40..2.40`, `y=3.75`) anchored by 4 deep pilings
   *  - Full-width (`±0.86`) 13-tread rear staircase with handrails joining top posts seamlessly & bottom sand pad
   *  - Bolted front safety wing rails + vertical yellow grab-bar stanchions supporting overhead launch rail
   *  - Hermite S-curved turquoise fiberglass U-trough resting on 2 timber A-frame support bents into surf!
   */
  private buildWaterSlide(): void {
    const cx = WATER_SLIDE_LAUNCH.x; // -22.0
    const platY = WATER_SLIDE_LAUNCH.y; // 3.75
    const deckMinZ = 0.40;
    const deckMaxZ = 2.40;
    const halfW = 0.86;

    const g = new THREE.Group();

    const paintWhite = this.paintWhiteMat;

    // Glossy marine fiberglass chute texture (turquoise gelcoat with crisp white center racing stripes!)
    const flumeCv = document.createElement('canvas');
    flumeCv.width = 256;
    flumeCv.height = 512;
    const fCtx = flumeCv.getContext('2d')!;
    const grad = fCtx.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0.0, '#0a899c');
    grad.addColorStop(0.22, '#14bfd1');
    grad.addColorStop(0.5, '#2ad9e8');
    grad.addColorStop(0.78, '#14bfd1');
    grad.addColorStop(1.0, '#0a899c');
    fCtx.fillStyle = grad;
    fCtx.fillRect(0, 0, 256, 512);
    // Crisp white & aqua resort fiberglass racing stripes + subtle gelcoat seam lines
    fCtx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    fCtx.fillRect(42, 0, 10, 512);
    fCtx.fillRect(204, 0, 10, 512);
    fCtx.fillStyle = 'rgba(255, 255, 255, 0.30)';
    fCtx.fillRect(123, 0, 10, 512);
    fCtx.fillStyle = 'rgba(8, 72, 84, 0.22)';
    for (let y = 0; y < 512; y += 64) {
      fCtx.fillRect(0, y, 256, 3);
    }
    const flumeTex = new THREE.CanvasTexture(flumeCv);
    flumeTex.colorSpace = THREE.SRGBColorSpace;
    flumeTex.wrapS = THREE.ClampToEdgeWrapping;
    flumeTex.wrapT = THREE.RepeatWrapping;
    flumeTex.repeat.set(1, 3);
    flumeTex.anisotropy = 8;

    const chuteMat = new THREE.MeshPhysicalMaterial({
      map: flumeTex,
      roughness: 0.14,
      metalness: 0.04,
      clearcoat: 0.92,
      clearcoatRoughness: 0.10,
      side: THREE.DoubleSide
    });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xffbe2e, roughness: 0.32, metalness: 0.25 });

    // 4 heavy weathered timber corner stilts anchoring tower solidly into sand
    for (const sx of [cx - halfW, cx + halfW]) {
      for (const sz of [deckMinZ + 0.08, deckMaxZ - 0.08]) {
        const groundY = getTerrainHeight(sx, sz);
        const h = platY - groundY + 0.65;
        const post = new THREE.Mesh(makeWorldBoxGeo(0.16, h, 0.16, 1.3), this.weatheredWoodMat);
        post.position.set(sx, groundY - 0.35 + h * 0.5, sz);
        post.castShadow = true;
        post.receiveShadow = true;
        g.add(post);
        addCollider(sx, sz, 0.18, h);
      }
    }

    // Elevated top wooden launch platform (y = platY) + coastal white railings & post caps
    const platDeck = new THREE.Mesh(makeWorldBoxGeo(halfW * 2 + 0.16, 0.16, deckMaxZ - deckMinZ, 1.4), this.woodMat);
    platDeck.position.set(cx, platY - 0.08, (deckMinZ + deckMaxZ) * 0.5);
    platDeck.castShadow = true;
    platDeck.receiveShadow = true;
    g.add(platDeck);

    for (const side of [-1, 1]) {
      const rx = cx + side * halfW;
      const topRail = new THREE.Mesh(makeWorldBoxGeo(0.09, 0.09, deckMaxZ - deckMinZ, 1.1), paintWhite);
      topRail.position.set(rx, platY + 0.88, (deckMinZ + deckMaxZ) * 0.5);
      g.add(topRail);
      const midRail = new THREE.Mesh(makeWorldBoxGeo(0.06, 0.06, deckMaxZ - deckMinZ, 1.1), paintWhite);
      midRail.position.set(rx, platY + 0.44, (deckMinZ + deckMaxZ) * 0.5);
      g.add(midRail);
      for (const rz of [deckMinZ + 0.08, deckMaxZ - 0.08]) {
        const rp = new THREE.Mesh(makeWorldBoxGeo(0.095, 0.92, 0.095, 1.0), paintWhite);
        rp.position.set(rx, platY + 0.46, rz);
        g.add(rp);
        const cap = new THREE.Mesh(makeWorldBoxGeo(0.13, 0.035, 0.13, 0.8), this.darkWoodMat);
        cap.position.set(rx, platY + 0.94, rz);
        g.add(cap);
      }
      const wingW = 0.34;
      const wingRail = new THREE.Mesh(makeWorldBoxGeo(wingW, 0.08, 0.08, 1.0), paintWhite);
      wingRail.position.set(cx + side * (halfW - wingW * 0.5), platY + 0.88, deckMaxZ - 0.08);
      g.add(wingRail);
    }

    // Grounded vertical yellow safety grab-bar stanchions + overhead launch rail directly bolted to deck!
    for (const side of [-1, 1]) {
      const stanchion = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 1.18, 8), trimMat);
      stanchion.position.set(cx + side * 0.54, platY + 0.59, deckMaxZ - 0.08);
      stanchion.castShadow = true;
      g.add(stanchion);
    }
    const grabCrossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 1.16, 8), trimMat);
    grabCrossbar.rotation.z = Math.PI / 2;
    grabCrossbar.position.set(cx, platY + 1.18, deckMaxZ - 0.08);
    grabCrossbar.castShadow = true;
    g.add(grabCrossbar);

    // 13-tread rear wooden access stairs matching full tower width (±0.86) down onto a grounded sand landing pad
    const stairZ0 = -4.20;
    const stairZ1 = deckMinZ + 0.08;
    const stairY0 = getTerrainHeight(cx, stairZ0);
    const stairY1 = platY;
    const stairRun = stairZ1 - stairZ0;
    const stairRise = stairY1 - stairY0;
    const stairLen = Math.hypot(stairRun, stairRise);
    const stairPitch = Math.atan2(stairRise, stairRun);

    // Grounded coral-stone & sunlit cedar landing pad at bottom of Water Slide stairs
    const botStone = new THREE.Mesh(makeWorldBoxGeo(halfW * 2 + 0.28, 0.22, 0.96, 1.25), this.coralStoneMat);
    botStone.position.set(cx, stairY0 - 0.08, stairZ0 - 0.22);
    botStone.receiveShadow = true;
    g.add(botStone);
    const botPad = new THREE.Mesh(makeWorldBoxGeo(halfW * 2 + 0.22, 0.06, 0.90, 1.3), this.woodMat);
    botPad.position.set(cx, stairY0 + 0.05, stairZ0 - 0.22);
    botPad.receiveShadow = true;
    botPad.castShadow = true;
    g.add(botPad);

    for (const side of [-halfW, halfW]) {
      const sx = cx + side;
      const stringer = new THREE.Mesh(makeWorldBoxGeo(0.11, 0.24, stairLen + 0.14, 1.3), this.darkWoodMat);
      stringer.position.set(sx, (stairY0 + stairY1) * 0.5 - 0.11, (stairZ0 + stairZ1) * 0.5);
      stringer.rotation.x = -stairPitch;
      stringer.castShadow = true;
      stringer.receiveShadow = true;
      g.add(stringer);

      // Painted coastal white stair handrail + mid-rail + vertical balusters + capped newel post!
      const handRail = new THREE.Mesh(makeWorldBoxGeo(0.085, 0.08, stairLen + 0.10, 1.1), paintWhite);
      handRail.position.set(sx, (stairY0 + stairY1) * 0.5 + 0.88, (stairZ0 + stairZ1) * 0.5);
      handRail.rotation.x = -stairPitch;
      handRail.castShadow = true;
      g.add(handRail);

      const midRail = new THREE.Mesh(makeWorldBoxGeo(0.05, 0.05, stairLen + 0.06, 1.1), paintWhite);
      midRail.position.set(sx, (stairY0 + stairY1) * 0.5 + 0.44, (stairZ0 + stairZ1) * 0.5);
      midRail.rotation.x = -stairPitch;
      g.add(midRail);

      const botNewel = new THREE.Mesh(makeWorldBoxGeo(0.105, 1.00, 0.105, 1.0), paintWhite);
      botNewel.position.set(sx, stairY0 + 0.44, stairZ0);
      botNewel.castShadow = true;
      g.add(botNewel);
      const botCap = new THREE.Mesh(makeWorldBoxGeo(0.14, 0.035, 0.14, 0.8), this.darkWoodMat);
      botCap.position.set(sx, stairY0 + 0.96, stairZ0);
      g.add(botCap);

      for (let b = 1; b <= 7; b++) {
        const bf = b / 8;
        const bal = new THREE.Mesh(makeWorldBoxGeo(0.04, 0.90, 0.04, 0.9), paintWhite);
        bal.position.set(
          sx,
          THREE.MathUtils.lerp(stairY0, stairY1, bf) + 0.42,
          THREE.MathUtils.lerp(stairZ0, stairZ1, bf)
        );
        g.add(bal);
      }
    }

    const wsSteps = 13;
    const wsRiseStep = stairRise / wsSteps;
    for (let s = 0; s < wsSteps; s++) {
      const f = (s + 0.5) / wsSteps;
      const sy = THREE.MathUtils.lerp(stairY0, stairY1, f);
      const sz = THREE.MathUtils.lerp(stairZ0, stairZ1, f);

      const tread = new THREE.Mesh(makeWorldBoxGeo(halfW * 2 - 0.08, 0.06, 0.36, 1.25), this.woodMat);
      tread.position.set(cx, sy, sz);
      tread.castShadow = true;
      tread.receiveShadow = true;
      g.add(tread);

      const riser = new THREE.Mesh(makeWorldBoxGeo(halfW * 2 - 0.14, wsRiseStep + 0.02, 0.04, 1.0), paintWhite);
      riser.position.set(cx, sy - wsRiseStep * 0.5 - 0.01, sz + 0.155);
      riser.receiveShadow = true;
      g.add(riser);

      const nosing = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 - 0.10, 0.015, 0.022), this.brassMat);
      nosing.position.set(cx, sy + 0.027, sz - 0.175);
      g.add(nosing);
    }

    // Seamless walkable collision across sand pad, all 13 treads, and top launch deck
    addWalkableDeck(cx - halfW, cx + halfW, stairZ0 - 0.65, stairZ0 + 0.10, stairY0 + 0.05, 'wood');
    addWalkableDeck(
      cx - halfW,
      cx + halfW,
      stairZ0,
      stairZ1,
      (_x, z) => {
        const t = THREE.MathUtils.clamp((z - stairZ0) / stairRun, 0, 1);
        return THREE.MathUtils.lerp(stairY0, platY, t);
      },
      'wood'
    );
    addWalkableDeck(cx - halfW, cx + halfW, deckMinZ, deckMaxZ, platY, 'wood');

    // Procedural single-draw-call U-trough turquoise fiberglass chute along Hermite sampleWaterSlide(t)
    const segsU = 36;
    const profPts: Array<[number, number]> = [
      [-0.54, 0.40],
      [-0.44, 0.12],
      [-0.22, 0.00],
      [0.22, 0.00],
      [0.44, 0.12],
      [0.54, 0.40]
    ];
    const verts: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const pCenter = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i <= segsU; i++) {
      const t = i / segsU;
      sampleWaterSlide(t, pCenter, tan);
      right.crossVectors(tan, up).normalize();
      const perpUp = new THREE.Vector3().crossVectors(right, tan).normalize();
      for (let j = 0; j < profPts.length; j++) {
        const [px, py] = profPts[j];
        verts.push(
          pCenter.x + right.x * px + perpUp.x * py,
          pCenter.y + right.y * px + perpUp.y * py,
          pCenter.z + right.z * px + perpUp.z * py
        );
        uvs.push(j / (profPts.length - 1), t);
      }
    }
    const stride = profPts.length;
    for (let i = 0; i < segsU; i++) {
      for (let j = 0; j < stride - 1; j++) {
        const a = i * stride + j;
        const b = a + 1;
        const c = (i + 1) * stride + j;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const chuteGeo = new THREE.BufferGeometry();
    chuteGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    chuteGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    chuteGeo.setIndex(indices);
    chuteGeo.computeVertexNormals();

    const chuteMesh = new THREE.Mesh(chuteGeo, chuteMat);
    chuteMesh.castShadow = true;
    chuteMesh.receiveShadow = true;
    g.add(chuteMesh);

    // 2 Clean Twin-Leg Timber A-Frame Chute Support Bents (cradling beneath fiberglass trough, ZERO pipe poking!)
    const yAxis = new THREE.Vector3(0, 1, 0);
    for (const tSup of [0.34, 0.66]) {
      sampleWaterSlide(tSup, pCenter);
      const beamY = pCenter.y - 0.10;
      const cradle = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.14, 0.16), this.darkWoodMat);
      cradle.position.set(pCenter.x, beamY, pCenter.z);
      cradle.castShadow = true;
      g.add(cradle);

      for (const side of [-1, 1]) {
        const topPt = new THREE.Vector3(pCenter.x + side * 0.44, beamY - 0.02, pCenter.z);
        const bx = pCenter.x + side * 0.66;
        const bz = pCenter.z;
        const botPt = new THREE.Vector3(bx, getTerrainHeight(bx, bz) - 0.35, bz);
        const seg = new THREE.Vector3().subVectors(topPt, botPt);
        const len = seg.length();
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.13, len, 0.13), this.darkWoodMat);
        leg.position.copy(botPt).addScaledVector(seg, 0.5);
        leg.quaternion.setFromUnitVectors(yAxis, seg.clone().normalize());
        leg.castShadow = true;
        leg.receiveShadow = true;
        g.add(leg);
        addCollider(bx, bz, 0.18, len);
      }
    }

    this.group.add(g);
  }

  /**
   * Hand-painted wooden coastal signpost guiding beachgoers to Neon Tiki, Volleyball & Ocean Pier!
   */
  private buildWayfindingSignpost(): void {
    const sx = 3.2;
    const sz = -22.9;
    const sy = getTerrainHeight(sx, sz);

    const g = new THREE.Group();
    g.position.set(sx, sy, sz);

    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 2.55, 8), this.darkWoodMat);
    post.position.y = 1.24;
    post.castShadow = true;
    g.add(post);

    const boards: Array<{ label: string; bg: string; y: number; rotY: number; ox: number }> = [
      { label: '← NEON TIKI BAR', bg: '#16697a', y: 2.22, rotY: 0.05, ox: -0.36 },
      { label: 'OCEAN PIER →', bg: '#c85a32', y: 1.90, rotY: -0.05, ox: 0.36 },
      { label: 'BEACH VOLLEYBALL ↓', bg: '#2d7d63', y: 1.58, rotY: 0.02, ox: 0.12 }
    ];
    const faceGeo = new THREE.PlaneGeometry(1.16, 0.24);
    const backingGeo = new THREE.BoxGeometry(1.18, 0.26, 0.042);
    for (const b of boards) {
      const plankGroup = new THREE.Group();
      plankGroup.position.set(b.ox, b.y, 0.135);
      plankGroup.rotation.y = b.rotY;

      const backing = new THREE.Mesh(backingGeo, this.darkWoodMat);
      backing.castShadow = true;
      plankGroup.add(backing);

      const tex = createArrowSignTexture(b.label, b.bg);
      const front = new THREE.Mesh(
        faceGeo,
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.65 })
      );
      front.position.z = 0.023;
      plankGroup.add(front);

      g.add(plankGroup);
    }

    this.group.add(g);
    addCollider(sx, sz, 0.22, 2.4);
  }

  /**
   * Festive swaying tropical bunting pennant flags strung between Neon Tiki & the Center Café Pergola!
   */
  private buildBuntingFlags(): void {
    const palette = [0xff595e, 0xffca3a, 0x38e2d8, 0x8ac926, 0xff924c, 0xffffff];
    const flagMats = palette.map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.72, side: THREE.DoubleSide })
    );
    const flagGeo = new THREE.ConeGeometry(0.14, 0.30, 3);
    flagGeo.rotateX(Math.PI);

    const spans: Array<[THREE.Vector3, THREE.Vector3]> = [
      [
        new THREE.Vector3(-17.8, this.tikiDeckY + 3.15, -27.8),
        new THREE.Vector3(-12.0, getBoardwalkY(-9.6) + 2.85, -26.8)
      ],
      [
        new THREE.Vector3(-7.2, getBoardwalkY(-9.6) + 2.85, -26.8),
        new THREE.Vector3(-3.3, getTerrainHeight(-2.0, -30.8) + 4.35, -30.0)
      ]
    ];

    for (const [a, b] of spans) {
      const mid = a.clone().lerp(b, 0.5);
      mid.y -= 0.52;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const cord = new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.012, 5, false), this.ropeMat);
      this.group.add(cord);

      const flags = 9;
      for (let i = 1; i <= flags; i++) {
        const t = i / (flags + 1);
        const pt = curve.getPointAt(t);
        const flag = new THREE.Mesh(flagGeo, flagMats[i % flagMats.length]);
        flag.position.set(pt.x, pt.y - 0.16, pt.z);
        flag.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
        this.group.add(flag);
      }
    }
  }

  /**
   * Bamboo Tiki Torches flanking the boardwalk & pier + slatted timber beach trash bins!
   */
  private buildTikiTorchesAndBins(): void {
    const flameMat = new THREE.MeshStandardMaterial({
      color: 0xffd166,
      emissive: 0xff6b1a,
      emissiveIntensity: 1.4
    });

    const torchSpots: Array<[number, number]> = [
      [-27.8, -23.1],
      [-12.6, -23.1],
      [5.4, -23.1],
      [18.8, -23.1],
      [25.2, -23.1],
      [37.2, -23.1]
    ];
    for (const [tx, tz] of torchSpots) {
      const ty = getTerrainHeight(tx, tz);
      const tg = new THREE.Group();
      tg.position.set(tx, ty, tz);

      // Real Poly Haven woven bamboo shaft + brushed brass collar + oak oil canister cup!
      const pole = new THREE.Mesh(makeWorldCylinderGeo(0.034, 0.042, 1.95, 8, 0.9), this.bambooMat);
      pole.position.y = 0.96;
      pole.castShadow = true;
      tg.add(pole);

      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.044, 0.07, 8), this.brassMat);
      collar.position.y = 1.84;
      tg.add(collar);

      const cup = new THREE.Mesh(makeWorldCylinderGeo(0.095, 0.048, 0.24, 8, 0.6), this.darkWoodMat);
      cup.position.y = 1.98;
      tg.add(cup);

      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.012, 6, 12), this.brassMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 2.09;
      tg.add(rim);

      const flamePos = new THREE.Vector3(tx, ty + 2.20, tz);
      this.flameAnchors.push(flamePos);
      this.addLightHalo(flamePos, 1.9, 0xff7b28);

      this.group.add(tg);
      addCollider(tx, tz, 0.15, 2.0);
    }

    const flameInst = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.065, 0.22, 7),
      flameMat,
      this.flameAnchors.length
    );
    for (let i = 0; i < this.flameAnchors.length; i++) {
      this.instDummy.position.copy(this.flameAnchors[i]);
      this.instDummy.rotation.set(0, 0, 0);
      this.instDummy.scale.set(1, 1, 1);
      this.instDummy.updateMatrix();
      flameInst.setMatrixAt(i, this.instDummy.matrix);
    }
    flameInst.instanceMatrix.needsUpdate = true;
    flameInst.userData.dynamic = true;
    this.group.add(flameInst);
    this.flameInstMesh = flameInst;

    // Slatted wooden beach recycling/trash bins tucked neatly alongside boardwalk!
    const lidMat = new THREE.MeshStandardMaterial({ color: 0x2a6f7d, roughness: 0.55 });
    for (const [bx, bz] of [[-28.6, -26.8], [16.4, -26.8]]) {
      const by = getTerrainHeight(bx, bz);
      const bin = new THREE.Group();
      bin.position.set(bx, by, bz);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.24, 0.78, 10), this.darkWoodMat);
      body.position.y = 0.39;
      body.castShadow = true;
      body.receiveShadow = true;
      bin.add(body);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.04, 6, 12), lidMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.80;
      bin.add(rim);
      this.group.add(bin);
      addCollider(bx, bz, 0.34, 0.85);
    }
  }

  /**
   * Grounded two-tier coastal stone plinth at (14.8, y, -21.8) textured with Poly Haven cliff_side PBR,
   * supporting the photoscanned bronze_whale_statue landmark in the east promenade plaza.
   */
  private buildWhaleStatuePlinth(): void {
    const px = 14.8;
    const pz = -21.8;
    const groundY = getTerrainHeight(px, pz);

    // Base block extends 0.55m below sand using real Poly Haven coral_stone_wall PBR + meter-scaled UVs!
    const base = new THREE.Mesh(makeWorldBoxGeo(2.16, 1.48, 2.56, 1.35), this.coralStoneMat);
    base.position.set(px, groundY + 0.19, pz);
    base.castShadow = true;
    base.receiveShadow = true;
    this.group.add(base);

    const cap = new THREE.Mesh(makeWorldBoxGeo(2.36, 0.15, 2.76, 1.35), this.coralStoneMat);
    cap.position.set(px, groundY + 1.005, pz);
    cap.castShadow = true;
    cap.receiveShadow = true;
    this.group.add(cap);

    this.whalePlinthTop.set(px, groundY + 1.08, pz);
    addCollider(px, pz, 1.48, 2.65);

    // Matching East Lagoon Bronze Manta Ray Stone Pedestal (50.5, -21.6) & West Trailhead Shark Pedestal (-49.5, -21.6)
    const addSmallPlinth = (sx: number, sz: number, outTop: THREE.Vector3) => {
      const gy = getTerrainHeight(sx, sz);
      const b = new THREE.Mesh(makeWorldBoxGeo(1.64, 1.38, 1.64, 1.35), this.coralStoneMat);
      b.position.set(sx, gy + 0.15, sz);
      b.castShadow = true;
      b.receiveShadow = true;
      this.group.add(b);
      const c = new THREE.Mesh(makeWorldBoxGeo(1.82, 0.14, 1.82, 1.35), this.coralStoneMat);
      c.position.set(sx, gy + 0.91, sz);
      c.castShadow = true;
      c.receiveShadow = true;
      this.group.add(c);
      outTop.set(sx, gy + 0.98, sz);
      addCollider(sx, sz, 1.12, 2.2);
    };
    addSmallPlinth(50.5, -21.6, this.rayPlinthTop);
    addSmallPlinth(-49.5, -21.6, this.sharkPlinthTop);
  }

  /**
   * West Palm Hammock Grove: 2 curved striped woven beach hammocks slung between timber A-posts
   * right along the quiet western promenade dunes (x = -55.5 & -59.5, z = -29.8).
   */
  private buildHammockGrove(): void {
    const fabricColors = [0xe76f51, 0x2a9d8f];
    const specs: Array<[number, number, number]> = [
      [-55.2, -30.2, 0.12],
      [-59.4, -29.8, -0.14]
    ];

    specs.forEach(([hx, hz, yaw], idx) => {
      const gy = getTerrainHeight(hx, hz);
      const g = new THREE.Group();
      g.position.set(hx, gy, hz);
      g.rotation.y = yaw;

      // Two sturdy angled timber hammock posts sunk 0.45m below sand
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.10, 2.25, 8), this.darkWoodMat);
        post.position.set(side * 1.48, 0.72, 0);
        post.rotation.z = -side * 0.14;
        post.castShadow = true;
        post.receiveShadow = true;
        g.add(post);
      }

      // Curved catenary canvas sling spanning between posts
      const segX = 12;
      const segZ = 4;
      const geo = new THREE.PlaneGeometry(2.35, 0.92, segX, segZ);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const lx = pos.getX(i);
        const lz = pos.getZ(i);
        const u = lx / 1.175;
        const v = lz / 0.46;
        const sag = -0.34 * (1.0 - u * u);
        const cup = 0.08 * v * v;
        pos.setY(i, 1.02 + sag + cup);
      }
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        map: this.linenMaps.map,
        normalMap: this.linenMaps.normalMap,
        roughnessMap: this.linenMaps.roughnessMap,
        normalScale: new THREE.Vector2(0.85, 0.85),
        color: fabricColors[idx % fabricColors.length],
        roughness: 0.95,
        side: THREE.DoubleSide
      });
      const sling = new THREE.Mesh(geo, mat);
      sling.castShadow = true;
      sling.receiveShadow = true;
      g.add(sling);

      // Spreader bars & suspension ropes
      for (const side of [-1, 1]) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.94, 6), this.woodMat);
        bar.rotation.x = Math.PI / 2;
        bar.position.set(side * 1.18, 1.04, 0);
        g.add(bar);
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.48, 5), this.ropeMat);
        rope.rotation.z = Math.PI / 2 + side * 0.45;
        rope.position.set(side * 1.36, 1.18, 0);
        g.add(rope);
      }

      this.group.add(g);
      addCollider(hx, hz, 1.55, 1.5);
      this.hammockSpots.push({ x: hx, y: gy + 0.72, z: hz, yaw });
    });
  }

  /**
   * East Lagoon Kayak Launch Cove: rustic timber rack + 2 vibrant sculpted kayaks with crossed paddles
   * resting on the sunlit East Lagoon shore (x = +46.5, z = -6.2).
   */
  private buildEastKayakCove(): void {
    const cx = 46.5;
    const cz = -6.2;
    const gy = getTerrainHeight(cx, cz);
    const g = new THREE.Group();
    g.position.set(cx, gy, cz);
    g.rotation.y = -0.28;

    const kayakColors = [0xff6b35, 0x00b4d8];
    const grpYaw = -0.28;
    const cosG = Math.cos(grpYaw);
    const sinG = Math.sin(grpYaw);
    kayakColors.forEach((col, i) => {
      const kz = (i - 0.5) * 1.25;
      const wx = cx + kz * sinG;
      const wz = cz + kz * cosG;
      const localGy = getTerrainHeight(wx, wz) - gy;
      const kUnit = new THREE.Group();
      kUnit.position.set(0, localGy + 0.02, kz);
      kUnit.rotation.y = Math.PI * 0.5 + (i === 0 ? 0.08 : -0.10);

      const hullGeo = new THREE.SphereGeometry(1, 14, 9);
      hullGeo.scale(0.36, 0.18, 1.65);
      const hullMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.32, metalness: 0.08 });
      const hull = new THREE.Mesh(hullGeo, hullMat);
      hull.position.set(0, 0.18, 0);
      hull.castShadow = true;
      hull.receiveShadow = true;
      kUnit.add(hull);

      // Cockpit rim & paddle resting across kayak
      const cockpit = new THREE.Mesh(
        new THREE.TorusGeometry(0.24, 0.032, 6, 12),
        new THREE.MeshStandardMaterial({ color: 0x1d232a, roughness: 0.65 })
      );
      cockpit.rotation.x = Math.PI / 2;
      cockpit.scale.set(1.0, 1.45, 1.0);
      cockpit.position.set(0, 0.34, 0);
      kUnit.add(cockpit);

      const paddleShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 2.05, 6), this.darkWoodMat);
      paddleShaft.rotation.z = Math.PI / 2;
      paddleShaft.position.set(0, 0.38, 0.05);
      paddleShaft.rotation.y = 0.25;
      kUnit.add(paddleShaft);

      g.add(kUnit);
    });

    this.group.add(g);
    // Two tight shape-accurate OBB colliders matching each individual parked kayak hull (no air-wall!)
    kayakColors.forEach((_col, i) => {
      const kz = (i - 0.5) * 1.25;
      const wx = cx + kz * sinG;
      const wz = cz + kz * cosG;
      const localY = getTerrainHeight(wx, wz);
      const kYaw = grpYaw + Math.PI * 0.5 + (i === 0 ? 0.08 : -0.10);
      addOrientedBoxCollider(wx, wz, 0.36, 1.62, kYaw, localY - 0.2, localY + 0.48);
    });
    this.kayakLaunchPos.set(cx, gy, cz);
  }

  /**
   * Handcrafted weathered timber Lifeguard Rescue Post with brass hook beside Lifeguard Tower stairs
   * so the real Poly Haven weathered lifebuoy hangs vertically & authentically facing the beach!
   */
  private buildLifeguardRescuePost(): void {
    const px = -1.32;
    const pz = -26.62;
    const bwY = getBoardwalkY(px);
    const sandY = getTerrainHeight(px, pz);
    const topY = bwY + 1.48;
    const totalH = topY - (sandY - 0.35);

    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, totalH, 0.16), this.darkWoodMat);
    post.position.set(px, sandY - 0.35 + totalH * 0.5, pz);
    post.castShadow = true;
    post.receiveShadow = true;
    g.add(post);

    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.22), this.woodMat);
    cap.position.set(px, topY + 0.02, pz);
    cap.castShadow = true;
    g.add(cap);

    // Brass hook bracket on oceanward (+Z) face of the rescue post
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4a348, roughness: 0.32, metalness: 0.82 });
    const hookY = bwY + 1.18;
    const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 8), brassMat);
    peg.rotation.x = Math.PI / 2;
    peg.position.set(px, hookY, pz + 0.14);
    g.add(peg);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.028, 7, 6), brassMat);
    tip.position.set(px, hookY + 0.025, pz + 0.21);
    g.add(tip);

    this.lifebuoyHookPos.set(px, hookY - 0.66, pz + 0.17);
    this.group.add(g);
    addCollider(px, pz, 0.22, 1.8);
  }

  /**
   * Handcrafted brass Coastal Observation Telescope mounted on a timber pedestal at the
   * East Lagoon Scenic Overlook Deck (48.5, y, -27.45) — press [E] for 3x telephoto ocean view!
   */
  private buildOverlookTelescope(): void {
    const tx = 48.5;
    const tz = -27.45;
    const deckY = this.eastOverlookDeckTop.y;
    const g = new THREE.Group();
    g.position.set(tx, deckY, tz);

    const brassMat = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.28, metalness: 0.85 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x262d36, roughness: 0.42, metalness: 0.72 });

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.10, 10), darkMetal);
    base.position.y = 0.05;
    g.add(base);

    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 1.24, 10), darkMetal);
    stand.position.y = 0.68;
    stand.castShadow = true;
    g.add(stand);

    const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.10), brassMat);
    yoke.position.y = 1.32;
    g.add(yoke);

    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.05, 0.56, 12), brassMat);
    tube.rotation.x = Math.PI / 2 - 0.12;
    tube.position.set(0, 1.40, 0.06);
    tube.castShadow = true;
    g.add(tube);

    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.068, 0.068, 0.02, 10),
      new THREE.MeshStandardMaterial({ color: 0x38e2d8, roughness: 0.12, metalness: 0.9 })
    );
    lens.rotation.x = Math.PI / 2 - 0.12;
    lens.position.set(0, 1.43, 0.34);
    g.add(lens);

    this.group.add(g);
    this.telescopePos.set(tx, deckY, tz);
    addCollider(tx, tz, 0.28, 1.5);
  }

  public stokeBonfire(): void {
    this.bonfireSurge = 1.0;
  }

  /**
   * Single-draw GPU Points shader combining rising golden bonfire ember sparks (-38.5, -19.2)
   * and gentle curling espresso steam wisps above the West Coffee Cart (-47.5, -29.05)!
   */
  private buildMicroAtmosphereParticles(): void {
    const emberCount = 44;
    const steamCount = 20;
    const total = emberCount + steamCount;
    const positions = new Float32Array(total * 3);
    const seeds = new Float32Array(total * 3); // x: phase, y: speed, z: kind (0=ember, 1=steam)

    const fireY = getTerrainHeight(-38.5, -19.2) + 0.35;
    for (let i = 0; i < emberCount; i++) {
      const ang = (i / emberCount) * Math.PI * 2 * 3.7;
      const rad = 0.12 + ((i * 37) % 100) * 0.0045;
      positions[i * 3] = -38.5 + Math.cos(ang) * rad;
      positions[i * 3 + 1] = fireY;
      positions[i * 3 + 2] = -19.2 + Math.sin(ang) * rad;
      seeds[i * 3] = (i * 0.173) % 1.0;
      seeds[i * 3 + 1] = 0.36 + (i % 5) * 0.09;
      seeds[i * 3 + 2] = 0.0;
    }

    const steamBaseX = this.coffeeCartDeckTop.x - 0.18;
    const steamBaseY = this.coffeeCartDeckTop.y + 1.38;
    const steamBaseZ = this.coffeeCartDeckTop.z - 0.14;
    for (let i = 0; i < steamCount; i++) {
      const idx = emberCount + i;
      const ang = i * 1.9;
      positions[idx * 3] = steamBaseX + Math.cos(ang) * 0.08;
      positions[idx * 3 + 1] = steamBaseY;
      positions[idx * 3 + 2] = steamBaseZ + Math.sin(ang) * 0.08;
      seeds[idx * 3] = (i / steamCount);
      seeds[idx * 3 + 1] = 0.24 + (i % 4) * 0.04;
      seeds[idx * 3 + 2] = 1.0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));

    this.microAtmosMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uDusk: { value: 0 }
      },
      vertexShader: /* glsl */ `
        attribute vec3 aSeed;
        uniform float uTime;
        varying float vKind;
        varying float vLife;
        void main() {
          float life = fract(aSeed.x + uTime * aSeed.y);
          vKind = aSeed.z;
          vLife = life;
          vec3 p = position;
          if (aSeed.z < 0.5) {
            // Rising swirling golden bonfire sparks
            float swirl = uTime * 2.2 + aSeed.x * 18.0;
            p.x += sin(swirl) * (0.14 + life * 0.45);
            p.z += cos(swirl * 0.85) * (0.14 + life * 0.45);
            p.y += life * 2.75;
          } else {
            // Soft curling coffee steam wisps
            p.x += sin(uTime * 1.6 + aSeed.x * 12.0 + life * 4.0) * (0.04 + life * 0.16);
            p.z += cos(uTime * 1.3 + aSeed.x * 9.0) * (0.03 + life * 0.12);
            p.y += life * 0.92;
          }
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float baseSz = aSeed.z < 0.5 ? (16.0 - life * 10.0) : (26.0 + life * 22.0);
          gl_PointSize = clamp(baseSz * (12.0 / max(1.0, -mv.z)), 2.0, 26.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uDusk;
        varying float vKind;
        varying float vLife;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          if (d > 0.5) discard;
          float soft = smoothstep(0.5, 0.08, d);
          float fade = sin(vLife * 3.14159);
          if (vKind < 0.5) {
            vec3 col = mix(vec3(1.0, 0.72, 0.24), vec3(1.0, 0.34, 0.06), vLife);
            float alpha = soft * fade * (0.58 + uDusk * 0.38);
            gl_FragColor = vec4(col, alpha);
          } else {
            vec3 col = vec3(0.92, 0.95, 0.98);
            float alpha = soft * soft * fade * 0.22;
            gl_FragColor = vec4(col, alpha);
          }
        }
      `
    });

    const pts = new THREE.Points(geo, this.microAtmosMat);
    pts.userData.dynamic = true;
    pts.frustumCulled = false;
    this.group.add(pts);
  }

  /**
   * Animated East-Beach Soccer Ball kicked back & forth between 2 players at x=34.5..41.5, z=-12.6!
   */
  private buildSoccerKickaboutBall(): THREE.Mesh {
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 64;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = '#1d2128';
    for (let x = 8; x < 128; x += 24) {
      for (let y = 8; y < 64; y += 22) {
        ctx.beginPath();
        ctx.arc(x + ((y / 22) % 2) * 12, y, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.135, 12, 10),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.48 })
    );
    ball.castShadow = true;
    ball.userData.dynamic = true;
    ball.position.set(51.2, getTerrainHeight(51.2, -16.0) + 0.14, -16.0);
    this.group.add(ball);
    return ball;
  }

  /**
   * Floating Ocean Swim Raft anchored in the turquoise swim cove at (-2.0, y, 21.5).
   * Bobs & pitches on live Gerstner waves and exposes a dynamic walkable wood deck!
   */
  private buildFloatingSwimRaft(): void {
    const raft = new THREE.Group();
    raft.name = 'FloatingSwimRaft';

    // Slatted teak top deck (local top surface at y = +0.28) with meter-scaled wood_floor_deck UVs!
    const deck = new THREE.Mesh(makeWorldBoxGeo(3.6, 0.14, 3.6, 1.45), this.woodMat);
    deck.position.y = 0.21;
    deck.castShadow = true;
    deck.receiveShadow = true;
    raft.add(deck);

    // Perimeter oak rub-rail framing
    for (const side of [-1, 1]) {
      const railX = new THREE.Mesh(makeWorldBoxGeo(3.74, 0.18, 0.10, 1.3), this.darkWoodMat);
      railX.position.set(0, 0.20, side * 1.82);
      railX.castShadow = true;
      raft.add(railX);
      const railZ = new THREE.Mesh(makeWorldBoxGeo(0.10, 0.18, 3.64, 1.3), this.darkWoodMat);
      railZ.position.set(side * 1.82, 0.20, 0);
      railZ.castShadow = true;
      raft.add(railZ);
    }

    // Dual ocean-blue buoyancy pontoon floats tucked beneath the platform
    const floatMat = new THREE.MeshStandardMaterial({ color: 0x168aad, roughness: 0.42, metalness: 0.08 });
    const pontoonGeo = new THREE.CylinderGeometry(0.28, 0.28, 3.42, 10);
    pontoonGeo.rotateX(Math.PI / 2);
    for (const sx of [-1.32, 1.32]) {
      const pontoon = new THREE.Mesh(pontoonGeo, floatMat);
      pontoon.position.set(sx, -0.04, 0);
      raft.add(pontoon);
    }

    // Stainless boarding ladder on the shoreward (-z) edge descending into the water
    const steelMat = new THREE.MeshStandardMaterial({ color: 0xdbe4ec, roughness: 0.28, metalness: 0.82 });
    for (const lx of [-0.26, 0.26]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.45, 7), steelMat);
      rail.position.set(lx, -0.22, -1.86);
      raft.add(rail);
      const grip = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.022, 6, 10, Math.PI), steelMat);
      grip.rotation.y = Math.PI / 2;
      grip.position.set(lx, 0.50, -1.72);
      raft.add(grip);
    }
    for (const ry of [0.05, -0.32, -0.68]) {
      const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.52, 6), steelMat);
      rung.rotation.z = Math.PI / 2;
      rung.position.set(0, ry, -1.86);
      raft.add(rung);
    }

    // Corner mooring cleats & red rescue lifebuoy resting on corner deck
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.45, metalness: 0.72 });
    for (const cx of [-1.52, 1.52]) {
      for (const cz of [-1.52, 1.52]) {
        const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.06), ironMat);
        cleat.position.set(cx, 0.31, cz);
        raft.add(cleat);
      }
    }
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xe63946, roughness: 0.38 });
    const lifebuoy = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.068, 8, 16), ringMat);
    lifebuoy.rotation.x = Math.PI / 2;
    lifebuoy.position.set(1.18, 0.33, 1.18);
    raft.add(lifebuoy);

    mergeStaticGroupByMaterial(raft);
    raft.userData.dynamic = true;
    raft.position.set(this.swimRaftPos.x, 0.0, this.swimRaftPos.z);
    this.pierGroup.add(raft);
    this.swimRaft = raft;

    // Register dynamic walkable deck so the player can swim out, climb aboard & dive off!
    addWalkableDeck(
      this.swimRaftPos.x - 1.82,
      this.swimRaftPos.x + 1.82,
      this.swimRaftPos.z - 1.82,
      this.swimRaftPos.z + 1.82,
      () => this.liveRaftDeckY,
      'wood'
    );
    // Solid pontoon hull side-collider underneath the walkable deck so swimmers collide cleanly!
    addOrientedBoxCollider(this.swimRaftPos.x, this.swimRaftPos.z, 1.84, 1.84, 0, -1.1, 0.14, 'swim_raft_hull');
  }

  private buildVolleyballCourt(): THREE.Mesh {
    const cx = 5.0;
    const cz = -14.5;
    const postHalfW = 4.2;

    const g = new THREE.Group();
    const postGeo = new THREE.CylinderGeometry(0.065, 0.075, 2.75, 10);

    for (const side of [-1, 1]) {
      const px = cx + side * postHalfW;
      const py = getTerrainHeight(px, cz);
      const post = new THREE.Mesh(postGeo, this.darkWoodMat);
      post.position.set(px, py + 1.22, cz);
      post.castShadow = true;
      post.receiveShadow = true;
      g.add(post);
      addCollider(px, cz, 0.14, 2.6);
    }

    const netY = getTerrainHeight(cx, cz) + 1.98;
    const netMat = new THREE.MeshStandardMaterial({
      map: createNetTexture(),
      transparent: true,
      alphaTest: 0.12,
      roughness: 0.85,
      side: THREE.DoubleSide
    });
    const net = new THREE.Mesh(new THREE.PlaneGeometry(postHalfW * 2 - 0.12, 0.96), netMat);
    net.position.set(cx, netY, cz);
    net.castShadow = true;
    g.add(net);

    const lineMat = new THREE.MeshStandardMaterial({ color: 0xf7f5ef, roughness: 0.92 });
    const courtHalfL = 4.8;
    const drawSandLine = (x0: number, z0: number, x1: number, z1: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const x = THREE.MathUtils.lerp(x0, x1, t);
        const z = THREE.MathUtils.lerp(z0, z1, t);
        pts.push(new THREE.Vector3(x, getTerrainHeight(x, z) + 0.025, z));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.018, 5, false), lineMat);
      g.add(tube);
    };
    drawSandLine(cx - postHalfW, cz - courtHalfL, cx + postHalfW, cz - courtHalfL);
    drawSandLine(cx - postHalfW, cz + courtHalfL, cx + postHalfW, cz + courtHalfL);
    drawSandLine(cx - postHalfW, cz - courtHalfL, cx - postHalfW, cz + courtHalfL);
    drawSandLine(cx + postHalfW, cz - courtHalfL, cx + postHalfW, cz + courtHalfL);

    const ballMat = new THREE.MeshStandardMaterial({ color: 0xfff3c4, roughness: 0.42 });
    const vball = new THREE.Mesh(new THREE.SphereGeometry(0.145, 14, 12), ballMat);
    vball.castShadow = true;
    vball.position.set(cx, netY + 0.8, cz);
    vball.userData.dynamic = true;
    g.add(vball);

    this.group.add(g);
    return vball;
  }

  public update(
    elapsedTime: number,
    waveIntensity: number,
    sunDirection: THREE.Vector3,
    sound?: SoundEngine,
    cameraPos?: THREE.Vector3,
    cameraQuat?: THREE.Quaternion,
    showerActive = true
  ): void {
    const cycle = (elapsedTime * 0.58) % 2.0;
    const half = Math.floor(cycle);
    if (this.lastVolleyHalf !== -1 && half !== this.lastVolleyHalf) {
      sound?.playBallHit(this.volleyballMesh.position, cameraPos, 'volleyball', cameraQuat);
    }
    this.lastVolleyHalf = half;

    const goingBack = cycle < 1.0;
    const t = goingBack ? cycle : cycle - 1.0;
    const zStart = goingBack ? -11.4 : -17.6;
    const zEnd = goingBack ? -17.6 : -11.4;
    const xArc = 5.0 + Math.sin(elapsedTime * 0.9) * 1.1;
    const zArc = THREE.MathUtils.lerp(zStart, zEnd, t);
    const groundY = getTerrainHeight(xArc, zArc);
    const arcY = groundY + 1.65 + Math.sin(t * Math.PI) * 2.35;
    this.volleyballMesh.position.set(xArc, arcY, zArc);
    this.volleyballMesh.rotation.x += 0.06;
    this.volleyballMesh.rotation.z += 0.04;

    // Animate East-Beach Soccer Ball kickabout (x = 48.0 <-> 54.5, z = -16.0) on wide-open sand with synced kick SFX!
    const sCycle = (elapsedTime * 0.62) % 2.0;
    const sHalf = Math.floor(sCycle);
    if (this.lastSoccerHalf !== -1 && sHalf !== this.lastSoccerHalf) {
      sound?.playBallHit(this.soccerBallMesh.position, cameraPos, 'soccer', cameraQuat);
    }
    this.lastSoccerHalf = sHalf;
    const toEast = sCycle < 1.0;
    const st = toEast ? sCycle : sCycle - 1.0;
    const sx = THREE.MathUtils.lerp(toEast ? 48.0 : 54.5, toEast ? 54.5 : 48.0, st);
    const sz = -16.0 + Math.sin(st * Math.PI) * 0.65;
    const sGround = getTerrainHeight(sx, sz);
    const sArc = sGround + 0.14 + Math.sin(st * Math.PI) * 1.15;
    this.soccerBallMesh.position.set(sx, sArc, sz);
    this.soccerBallMesh.rotation.z += toEast ? -0.14 : 0.14;

    // Live wave bobbing + dynamic OBB hull & walkable floorboard sync for moored rowboat!
    if (this.mooredBoat) {
      const bx = this.boatPos.x;
      const bz = this.boatPos.z;
      const h = sampleWaveHeight(bx, bz, elapsedTime, waveIntensity, getTerrainHeight(bx, bz));
      const hx = sampleWaveHeight(bx + 0.7, bz, elapsedTime, waveIntensity, -2.0);
      const hz = sampleWaveHeight(bx, bz + 0.7, elapsedTime, waveIntensity, -2.0);
      const bYaw = 0.14 + Math.sin(elapsedTime * 0.45) * 0.06;
      this.mooredBoat.position.set(bx, h - 0.06, bz);
      this.mooredBoat.rotation.z = -(hx - h) * 0.65;
      this.mooredBoat.rotation.x = (hz - h) * 0.55;
      this.mooredBoat.rotation.y = bYaw;
      this.liveBoatDeckY = h + 0.18;
      updateOrientedBoxCollider('moored_rowboat', bx, bz, bYaw, h - 1.1, h + 0.12);
    }

    // Live wave bobbing & pitch + dynamic side-pontoon OBB sync for Floating Ocean Swim Raft (-2.0, 21.5)!
    if (this.swimRaft) {
      const rx = this.swimRaftPos.x;
      const rz = this.swimRaftPos.z;
      const rh = sampleWaveHeight(rx, rz, elapsedTime, waveIntensity, -3.5);
      const rhx = sampleWaveHeight(rx + 1.3, rz, elapsedTime, waveIntensity, -3.5);
      const rhz = sampleWaveHeight(rx, rz + 1.3, elapsedTime, waveIntensity, -3.5);
      const rYaw = Math.sin(elapsedTime * 0.28) * 0.04;
      this.swimRaft.position.set(rx, rh, rz);
      this.swimRaft.rotation.z = -(rhx - rh) * 0.28;
      this.swimRaft.rotation.x = (rhz - rh) * 0.28;
      this.swimRaft.rotation.y = rYaw;
      this.liveRaftDeckY = rh + 0.28;
      updateOrientedBoxCollider('swim_raft_hull', rx, rz, rYaw, rh - 0.95, rh + 0.16);
    }

    if (this.microAtmosMat) {
      const duskAtm = 1.0 - THREE.MathUtils.smoothstep(sunDirection.y, 0.08, 0.45);
      this.bonfireSurge = Math.max(0, this.bonfireSurge - 0.012);
      this.microAtmosMat.uniforms.uTime.value = elapsedTime;
      this.microAtmosMat.uniforms.uDusk.value = Math.min(1.8, duskAtm + this.bonfireSurge * 1.4);
    }

    // Live animated outdoor beach rinse shower droplets — ONLY spray when occupied by an NPC or the player!
    if (this.showerInstMesh) {
      this.showerInstMesh.visible = showerActive;
      if (showerActive) {
        for (let i = 0; i < this.showerDrops.length; i++) {
          const d = this.showerDrops[i];
          const frac = (elapsedTime * 1.85 + d.phase) % 1.0;
          const y = THREE.MathUtils.lerp(2.12, 0.10, frac * frac);
          this.instDummy.position.set(d.ox * (1.0 + frac * 1.4), y, d.oz + frac * 0.04);
          this.instDummy.rotation.set(0, 0, 0);
          this.instDummy.scale.set(1, 1, 1);
          this.instDummy.updateMatrix();
          this.showerInstMesh.setMatrixAt(i, this.instDummy.matrix);
        }
        this.showerInstMesh.instanceMatrix.needsUpdate = true;
      }
    }

    // Flickering bamboo tiki torch flames (single InstancedMesh)
    if (this.flameInstMesh) {
      for (let i = 0; i < this.flameAnchors.length; i++) {
        const flick = 0.85 + 0.25 * Math.sin(elapsedTime * 12.0 + i * 2.3);
        this.instDummy.position.copy(this.flameAnchors[i]);
        this.instDummy.rotation.set(0, 0, 0);
        this.instDummy.scale.set(
          0.9 + 0.15 * Math.cos(elapsedTime * 9.0 + i),
          flick,
          0.9 + 0.15 * Math.sin(elapsedTime * 11.0 + i)
        );
        this.instDummy.updateMatrix();
        this.flameInstMesh.setMatrixAt(i, this.instDummy.matrix);
      }
      this.flameInstMesh.instanceMatrix.needsUpdate = true;
    }

    const dusk = 1.0 - THREE.MathUtils.smoothstep(sunDirection.y, 0.08, 0.45);
    for (let i = 0; i < this.stringLightBulbs.length; i++) {
      this.stringLightBulbs[i].emissiveIntensity = 0.35 + dusk * 3.1;
    }
    if (this.tikiSignMat) {
      this.tikiSignMat.emissiveIntensity = 0.48 + dusk * 1.15;
    }
    if (this.haloMat) {
      this.haloMat.uniforms.uDuskBoost.value = 0.30 + dusk * 1.15;
    }
    if (this.villaWindowMat) {
      this.villaWindowMat.emissiveIntensity = 0.12 + dusk * 1.95;
    }
    if (this.lighthouseBeacon && this.lighthouseBeamMat) {
      this.lighthouseBeacon.rotation.y = elapsedTime * 0.55;
      this.lighthouseBeamMat.uniforms.uStrength.value = 0.06 + dusk * 0.36;
    }
    if (this.swimBuoyInst) {
      for (let i = 0; i < this.swimBuoyCoords.length; i++) {
        const [bx, bz] = this.swimBuoyCoords[i];
        const bh = sampleWaveHeight(bx, bz, elapsedTime, waveIntensity, -4.5);
        this.instDummy.position.set(bx, bh + 0.04, bz);
        this.instDummy.rotation.set(
          Math.sin(elapsedTime * 1.6 + i) * 0.16,
          0,
          Math.cos(elapsedTime * 1.4 + i) * 0.16
        );
        this.instDummy.scale.set(1, 1, 1);
        this.instDummy.updateMatrix();
        this.swimBuoyInst.setMatrixAt(i, this.instDummy.matrix);
      }
      this.swimBuoyInst.instanceMatrix.needsUpdate = true;
    }
    for (let i = 0; i < this.barLights.length; i++) {
      this.barLights[i].visible = dusk > 0.05;
      this.barLights[i].intensity = dusk * 2.6;
    }
  }

  /**
   * Realistic Coastal Reserve Perimeter Fencing:
   *  - Weathered split-rail cedar timber dune-conservation fence following exact terrain contours
   *    along the entire West cliff border, Rear ridge border, and East headland border!
   *  - Coral-stone trailhead portal walls capping both ends of the boardwalk (-62.5 & +62.5)
   *    with "COASTAL RESERVE • PROTECTED DUNES" carved wooden signage!
   */
  private buildCoastalBorderFences(): void {
    const buildFenceRun = (pts: Array<[number, number]>, addCollision = true) => {
      const yAxis = new THREE.Vector3(0, 1, 0);
      const postGeo = makeWorldBoxGeo(0.14, 1.38, 0.14, 1.1);
      const capGeo = makeWorldBoxGeo(0.18, 0.04, 0.18, 0.8);

      for (let i = 0; i < pts.length; i++) {
        const [px, pz] = pts[i];
        const py = getTerrainHeight(px, pz);
        const post = new THREE.Mesh(postGeo, this.weatheredWoodMat);
        post.position.set(px, py + 0.56, pz);
        post.castShadow = false;
        post.receiveShadow = true;
        this.group.add(post);

        const cap = new THREE.Mesh(capGeo, this.darkWoodMat);
        cap.position.set(px, py + 1.27, pz);
        this.group.add(cap);

        if (addCollision) addCollider(px, pz, 0.22, 1.3);

        if (i < pts.length - 1) {
          const [nx, nz] = pts[i + 1];
          const ny = getTerrainHeight(nx, nz);
          const a = new THREE.Vector3(px, py, pz);
          const b = new THREE.Vector3(nx, ny, nz);
          const seg = new THREE.Vector3().subVectors(b, a);
          const len = seg.length();
          if (len < 0.2) continue;
          const dir = seg.clone().normalize();
          const mid = a.clone().addScaledVector(seg, 0.5);

          // Twin split-rail horizontal weathered timber rails matching exact terrain slope!
          for (const railH of [0.58, 1.04]) {
            const railGeo = makeWorldBoxGeo(0.065, 0.11, len + 0.08, 1.4);
            const rail = new THREE.Mesh(railGeo, this.weatheredWoodMat);
            rail.position.set(mid.x, mid.y + railH, mid.z);
            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
            rail.quaternion.copy(q);
            rail.castShadow = false;
            rail.receiveShadow = true;
            this.group.add(rail);
          }

          // Subtle coastal dune wire/rope mid-line for authentic nature-reserve detailing
          const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 5), this.ropeMat);
          wire.position.set(mid.x, mid.y + 0.81, mid.z);
          wire.quaternion.setFromUnitVectors(yAxis, dir);
          this.group.add(wire);
        }
      }
    };

    // 1. West Cliffside Coastal Border Fence (x = -66..-71, z = -6..-55)
    const westPts: Array<[number, number]> = [];
    for (let z = -6; z >= -54; z -= 4.0) {
      const x = -65.5 - Math.max(0, (-z - 14) * 0.12);
      westPts.push([x, z]);
    }
    buildFenceRun(westPts, true);

    // 2. Rear Ridge Scenic Reserve Border Fence (x = -70..+70, z = -54..-56, leaving central Entry Archway open!)
    const rearWest: Array<[number, number]> = [];
    for (let x = -70; x <= -6; x += 4.0) {
      rearWest.push([x, -54.5 - Math.sin(x * 0.06) * 1.4]);
    }
    buildFenceRun(rearWest, false);

    const rearEast: Array<[number, number]> = [];
    for (let x = 6; x <= 70; x += 4.0) {
      rearEast.push([x, -54.5 - Math.sin(x * 0.06) * 1.4]);
    }
    buildFenceRun(rearEast, false);

    // 3. East Headland Coastal Border Fence (x = +66..+71, z = -6..-54)
    const eastPts: Array<[number, number]> = [];
    for (let z = -6; z >= -54; z -= 4.0) {
      const x = 65.5 + Math.max(0, (-z - 14) * 0.12);
      eastPts.push([x, z]);
    }
    buildFenceRun(eastPts, true);

    // 4. Coral-Stone Coastal Reserve Portal Walls & Carved Signs capping both ends of the Boardwalk (-62.8 & +62.8)
    const reserveSignTex = createSignTexture('COASTAL RESERVE', 'PROTECTED DUNES • STAY ON TRAIL', '#233b35', '#f7f4eb');
    const reserveSignMat = new THREE.MeshStandardMaterial({ map: reserveSignTex, roughness: 0.65 });
    for (const side of [-1, 1]) {
      const wx = side * 63.2;
      const wz = -25.0;
      const wy = getBoardwalkY(side * 62.0);
      const wall = new THREE.Mesh(makeWorldBoxGeo(0.56, 1.35, 3.6, 1.25), this.coralStoneMat);
      wall.position.set(wx, wy + 0.25, wz);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.group.add(wall);
      const cap = new THREE.Mesh(makeWorldBoxGeo(0.66, 0.09, 3.74, 1.2), this.darkWoodMat);
      cap.position.set(wx, wy + 0.96, wz);
      this.group.add(cap);

      // Two coral-stone end piers with warm dusk lanterns
      for (const pz of [wz - 1.65, wz + 1.65]) {
        const pier = new THREE.Mesh(makeWorldBoxGeo(0.68, 1.72, 0.68, 1.15), this.coralStoneMat);
        pier.position.set(wx, wy + 0.44, pz);
        pier.castShadow = true;
        this.group.add(pier);
        const pCap = new THREE.Mesh(makeWorldBoxGeo(0.76, 0.08, 0.76, 1.0), this.darkWoodMat);
        pCap.position.set(wx, wy + 1.32, pz);
        this.group.add(pCap);
      }

      // Coastal Reserve notice board facing inward along boardwalk
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.56, 1.65), reserveSignMat);
      sign.position.set(wx - side * 0.34, wy + 0.58, wz);
      this.group.add(sign);
      addBoxCollider(wx - 0.45, wx + 0.45, wz - 1.9, wz + 1.9, wy - 0.5, wy + 1.8);
    }
  }

  /**
   * Iconic East Headland Coastal Lighthouse (x = +78, z = -14) with coral-stone plinth,
   * whitewashed tapered tower, crimson coastal band, iron gallery, glass lantern room,
   * and live slow-rotating golden volumetric beacon beam sweeping across Neon Cove!
   */
  private buildCoastalLighthouse(): void {
    const lx = 78.0;
    const lz = -14.0;
    const baseY = getTerrainHeight(lx, lz);
    const g = new THREE.Group();
    g.position.set(lx, baseY, lz);

    const crimsonMat = new THREE.MeshStandardMaterial({
      map: this.paintWhiteMat.map,
      normalMap: this.paintWhiteMat.normalMap,
      color: 0xc9353f,
      roughness: 0.72
    });
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x222930, roughness: 0.42, metalness: 0.75 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xfff0c4,
      emissive: 0xffc154,
      emissiveIntensity: 0.85,
      roughness: 0.15
    });
    this.stringLightBulbs.push(glassMat);

    // Octagonal coral-stone coastal foundation plinth sunk cleanly into cliff
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 2.8, 8), this.coralStoneMat);
    plinth.position.y = 0.4;
    plinth.castShadow = false;
    plinth.receiveShadow = true;
    g.add(plinth);

    // Lower whitewashed tower shaft
    const lower = new THREE.Mesh(new THREE.CylinderGeometry(2.15, 2.65, 5.4, 14), this.paintWhiteMat);
    lower.position.y = 4.4;
    lower.castShadow = false;
    lower.receiveShadow = true;
    g.add(lower);

    // Signature crimson coastal band
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.92, 2.15, 2.8, 14), crimsonMat);
    band.position.y = 8.5;
    band.castShadow = false;
    g.add(band);

    // Upper whitewashed tower shaft
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(1.62, 1.92, 3.6, 14), this.paintWhiteMat);
    upper.position.y = 11.7;
    upper.castShadow = false;
    g.add(upper);

    // Iron gallery walkway & railing
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(2.12, 1.85, 0.34, 14), ironMat);
    gallery.position.y = 13.55;
    g.add(gallery);
    const rail = new THREE.Mesh(new THREE.TorusGeometry(2.02, 0.06, 6, 16), ironMat);
    rail.rotation.x = Math.PI / 2;
    rail.position.y = 14.32;
    g.add(rail);

    // Glowing glass lantern room + crimson domed cupola + brass finial
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.22, 1.28, 1.9, 12), glassMat);
    lantern.position.y = 14.65;
    g.add(lantern);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.32, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), crimsonMat);
    dome.position.y = 15.58;
    g.add(dome);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.15, 6), this.brassMat);
    spire.position.y = 17.35;
    g.add(spire);

    // Attached whitewashed lighthouse keeper's cottage beside the tower
    const cottage = new THREE.Mesh(makeWorldBoxGeo(4.8, 2.8, 4.0, 1.4), this.paintWhiteMat);
    cottage.position.set(-3.8, 1.2, -1.2);
    cottage.castShadow = true;
    g.add(cottage);
    const cRoof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 1.4, 4), crimsonMat);
    cRoof.rotation.y = Math.PI / 4;
    cRoof.scale.set(1.15, 1.0, 0.96);
    cRoof.position.set(-3.8, 3.25, -1.2);
    g.add(cRoof);

    // Soft gradient-faded golden volumetric Lighthouse Beacon Beam (zero polygonal end-cap octagon!)
    const beaconGrp = new THREE.Group();
    beaconGrp.position.set(0, 14.75, 0);
    beaconGrp.userData.dynamic = true;
    const beamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uStrength: { value: 0.08 }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vNormalV;
        varying vec3 vViewPos;
        void main() {
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mv.xyz;
          vNormalV = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uStrength;
        varying vec2 vUv;
        varying vec3 vNormalV;
        varying vec3 vViewPos;
        void main() {
          // Soft longitudinal fade from lantern core out into distance + soft cylindrical edge falloff
          float along = smoothstep(0.0, 0.14, vUv.y) * pow(1.0 - vUv.y, 1.65);
          vec3 V = normalize(vViewPos);
          float rim = pow(abs(dot(normalize(vNormalV), V)), 1.45);
          float a = along * rim * uStrength;
          if (a < 0.002) discard;
          gl_FragColor = vec4(vec3(1.0, 0.90, 0.62), a);
        }
      `
    });
    const beamGeo = new THREE.ConeGeometry(4.2, 34.0, 16, 1, true);
    beamGeo.translate(0, -17.0, 0);
    beamGeo.rotateX(Math.PI / 2);
    const beamBGeo = beamGeo.clone();
    beamBGeo.rotateY(Math.PI);
    const mergedBeam = new THREE.Mesh(
      (() => {
        const g1 = beamGeo.toNonIndexed();
        const g2 = beamBGeo.toNonIndexed();
        const p1 = g1.attributes.position.array as Float32Array;
        const p2 = g2.attributes.position.array as Float32Array;
        const n1 = g1.attributes.normal.array as Float32Array;
        const n2 = g2.attributes.normal.array as Float32Array;
        const u1 = g1.attributes.uv.array as Float32Array;
        const u2 = g2.attributes.uv.array as Float32Array;
        const pos = new Float32Array(p1.length + p2.length);
        pos.set(p1, 0); pos.set(p2, p1.length);
        const nor = new Float32Array(n1.length + n2.length);
        nor.set(n1, 0); nor.set(n2, n1.length);
        const uv = new Float32Array(u1.length + u2.length);
        uv.set(u1, 0); uv.set(u2, u1.length);
        const out = new THREE.BufferGeometry();
        out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        beamGeo.dispose(); beamBGeo.dispose(); g1.dispose(); g2.dispose();
        return out;
      })(),
      beamMat
    );
    beaconGrp.add(mergedBeam);
    g.add(beaconGrp);
    this.lighthouseBeacon = beaconGrp;
    this.lighthouseBeamMat = beamMat;

    this.addLightHalo(new THREE.Vector3(lx, baseY + 14.75, lz), 4.6, 0xffd275);
    this.group.add(g);
    addCollider(lx, lz, 3.4, 12.0);
  }

  /**
   * 3 Architectural Mediterranean Whitewashed Coastal Cliffside Villas / Beach Cottages
   * nestled naturally into the rear sunlit ridge (z = -58..-65) with terracotta roofs,
   * coral-stone plinths, shaded timber verandas, and warm glowing dusk windows!
   */
  private buildHillsideVillas(): void {
    const roofMat = new THREE.MeshStandardMaterial({
      map: this.coralStoneMat.map,
      normalMap: this.coralStoneMat.normalMap,
      color: 0xc26343,
      roughness: 0.84
    });
    const winMat = new THREE.MeshStandardMaterial({
      color: 0x2a4552,
      emissive: 0xffb85c,
      emissiveIntensity: 0.15,
      roughness: 0.22
    });
    this.villaWindowMat = winMat;

    const specs: Array<{ x: number; z: number; yaw: number; w: number; d: number; h: number }> = [
      { x: -32.0, z: -61.5, yaw: 0.16, w: 8.6, d: 6.0, h: 3.4 },
      { x: 14.0, z: -63.0, yaw: -0.08, w: 9.4, d: 6.4, h: 3.6 },
      { x: 50.0, z: -59.5, yaw: -0.24, w: 7.8, d: 5.6, h: 3.2 }
    ];

    for (const v of specs) {
      const gy = getTerrainHeight(v.x, v.z);
      const vg = new THREE.Group();
      vg.position.set(v.x, gy, v.z);
      vg.rotation.y = v.yaw;

      // Grounded coral-stone hillside terrace foundation
      const found = new THREE.Mesh(makeWorldBoxGeo(v.w + 1.4, 2.6, v.d + 2.2, 1.5), this.coralStoneMat);
      found.position.set(0, -0.7, 0.5);
      found.receiveShadow = true;
      vg.add(found);

      // Whitewashed coastal cottage main body (distant hillside ridge -> no shadow pass needed!)
      const body = new THREE.Mesh(makeWorldBoxGeo(v.w, v.h, v.d, 1.5), this.paintWhiteMat);
      body.position.set(0, 0.6 + v.h * 0.5, 0);
      body.castShadow = false;
      body.receiveShadow = true;
      vg.add(body);

      // Terracotta hipped roof
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(v.w, v.d) * 0.78, 2.05, 4), roofMat);
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(v.w / Math.max(v.w, v.d), 1.0, v.d / Math.max(v.w, v.d));
      roof.position.set(0, 0.6 + v.h + 0.98, 0);
      roof.castShadow = false;
      vg.add(roof);

      // Shaded ocean-facing veranda pergola beams
      for (const px of [-v.w * 0.42, 0, v.w * 0.42]) {
        const post = new THREE.Mesh(makeWorldBoxGeo(0.16, 2.6, 0.16, 1.1), this.darkWoodMat);
        post.position.set(px, 1.9, v.d * 0.5 + 1.15);
        vg.add(post);
      }
      const vBeam = new THREE.Mesh(makeWorldBoxGeo(v.w + 0.4, 0.18, 0.22, 1.3), this.darkWoodMat);
      vBeam.position.set(0, 3.15, v.d * 0.5 + 1.15);
      vg.add(vBeam);

      // 3 ocean-facing glowing windows with coastal teal shutters
      for (const wx of [-v.w * 0.28, 0, v.w * 0.28]) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.35, 0.10), winMat);
        win.position.set(wx, 2.25, v.d * 0.5 + 0.04);
        vg.add(win);
        for (const s of [-1, 1]) {
          const shut = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.38, 0.08), this.paintTealMat);
          shut.position.set(wx + s * 0.74, 2.25, v.d * 0.5 + 0.06);
          vg.add(shut);
        }
      }

      this.group.add(vg);
    }
  }

  /**
   * Handcrafted West Beach Changing Cabana (2 stalls at -54.5, -34.5) AND the Scenic
   * "WELCOME TO NEON COVE" Cedar Entry Archway straddling the central hillside trail (0, -34.2)!
   */
  private buildBeachCabanaAndEntryArch(): void {
    // 1. 2-Stall Coastal Beach Changing Cabana (-54.5, -34.5)
    const cx = -54.5;
    const cz = -34.5;
    const cy = getTerrainHeight(cx, cz);
    const cab = new THREE.Group();
    cab.position.set(cx, cy, cz);
    cab.rotation.y = 0.22;

    const plinth = new THREE.Mesh(makeWorldBoxGeo(3.8, 0.95, 2.4, 1.3), this.coralStoneMat);
    plinth.position.y = -0.32;
    plinth.receiveShadow = true;
    cab.add(plinth);
    const floor = new THREE.Mesh(makeWorldBoxGeo(3.9, 0.09, 2.5, 1.35), this.woodMat);
    floor.position.y = 0.16;
    floor.receiveShadow = true;
    cab.add(floor);

    const body = new THREE.Mesh(makeWorldBoxGeo(3.4, 2.35, 1.9, 1.3), this.paintWhiteMat);
    body.position.set(0, 1.38, -0.10);
    body.castShadow = true;
    body.receiveShadow = true;
    cab.add(body);

    const roof = new THREE.Mesh(makeWorldBoxGeo(4.1, 0.16, 2.8, 1.4), this.darkWoodMat);
    roof.position.set(0, 2.66, 0.06);
    roof.rotation.x = 0.12;
    roof.castShadow = true;
    cab.add(roof);

    // 2 slatted coastal-teal privacy stall doors with brushed brass handles
    for (const dx of [-0.78, 0.78]) {
      const door = new THREE.Mesh(makeWorldBoxGeo(0.95, 1.92, 0.08, 1.1), this.paintTealMat);
      door.position.set(dx, 1.18, 0.86);
      cab.add(door);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), this.brassMat);
      knob.position.set(dx + 0.32, 1.15, 0.93);
      cab.add(knob);
    }
    const cabSignTex = createSignTexture('BEACH CABANAS', 'CHANGING ROOMS • SHOWERS', '#1b4958', '#fffaf0');
    const cabSign = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.42, 0.06),
      new THREE.MeshStandardMaterial({ map: cabSignTex, roughness: 0.5 })
    );
    cabSign.position.set(0, 2.38, 0.90);
    cab.add(cabSign);
    this.group.add(cab);
    addBoxCollider(cx - 2.1, cx + 2.1, cz - 1.5, cz + 1.4, cy - 0.5, cy + 2.8);

    // 2. Scenic "WELCOME TO NEON COVE" Cedar Entry Archway straddling central dune path (0, -35.0)
    const ax = 0.0;
    const az = -35.0;
    const ay = getTerrainHeight(ax, az);
    const arch = new THREE.Group();
    arch.position.set(ax, ay, az);
    for (const sx of [-2.4, 2.4]) {
      const base = new THREE.Mesh(makeWorldBoxGeo(0.76, 1.15, 0.76, 1.1), this.coralStoneMat);
      base.position.set(sx, 0.35, 0);
      base.castShadow = true;
      base.receiveShadow = true;
      arch.add(base);
      const post = new THREE.Mesh(makeWorldBoxGeo(0.24, 3.65, 0.24, 1.2), this.darkWoodMat);
      post.position.set(sx, 2.55, 0);
      post.castShadow = true;
      arch.add(post);
      addCollider(ax + sx, az, 0.42, 3.8);
    }
    const lintel = new THREE.Mesh(makeWorldBoxGeo(5.8, 0.28, 0.32, 1.4), this.darkWoodMat);
    lintel.position.set(0, 4.25, 0);
    lintel.castShadow = true;
    arch.add(lintel);
    const archSignTex = createSignTexture('NEON COVE', 'COASTAL BEACH RESERVE', '#123645', '#fff8eb');
    const archSign = new THREE.Mesh(
      new THREE.BoxGeometry(3.8, 0.88, 0.10),
      new THREE.MeshStandardMaterial({ map: archSignTex, roughness: 0.48 })
    );
    archSign.position.set(0, 3.62, 0.0);
    arch.add(archSign);
    this.group.add(arch);
  }

  /**
   * Floating Marine Swim-Zone Safety Buoy Line (18 alternating white & bright coral-orange
   * marker buoys curving across the outer swim zone at z = 36..44 in a single InstancedMesh!).
   */
  private buildSwimZoneBuoyLine(): void {
    const count = 18;
    const geo = new THREE.SphereGeometry(0.24, 10, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.05 });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.userData.dynamic = true;
    const col = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const bx = THREE.MathUtils.lerp(-46, 46, t);
      const bz = 42.0 - Math.pow((t - 0.5) * 2.0, 2) * 7.5;
      this.swimBuoyCoords.push([bx, bz]);
      this.instDummy.position.set(bx, 0.05, bz);
      this.instDummy.rotation.set(0, 0, 0);
      this.instDummy.scale.set(1, 1, 1);
      this.instDummy.updateMatrix();
      inst.setMatrixAt(i, this.instDummy.matrix);
      col.setHex(i % 2 === 0 ? 0xff5a2c : 0xf8fafc);
      inst.setColorAt(i, col);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.frustumCulled = false;
    this.swimBuoyInst = inst;
    this.group.add(inst);
  }
}
