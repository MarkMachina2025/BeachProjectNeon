import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  addCollider,
  addOrientedBoxCollider,
  getTerrainHeight,
  getTerrainNormal,
  updateOrientedBoxCollider
} from '../terrain/terrainMath';
import { getBoardwalkY, TerraceTableSpot } from './CoastalLandmarks';
import { sampleWaveHeight } from '../ocean/wavePhysics';
import { mergeStaticGroupByMaterial } from '../utils/geometryBatcher';

export interface CampAnchor {
  x: number;
  z: number;
  yaw: number;
  sideTablePos: THREE.Vector3;
  towelPos?: THREE.Vector3;
}

interface InstancePlacement {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  sx: number;
  sy: number;
  sz: number;
}

interface CenteredVariant {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  height: number;
  maxHalfFootprint: number;
}

function seededRand(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * High-Performance GPU-Instanced Poly Haven CC0 Photoscanned 3D World Asset Manager:
 *  - Splits multi-variant Poly Haven plant & barrel packs into INDIVIDUAL centered single-object
 *    variants so every shrub, fern, iceplant, rooibos bush, and barrel sits individually grounded
 *    on exact local terrain height (ZERO straight-line packs, ZERO floating slopes, ZERO broken debris!)
 *  - Brightens dark photogrammetry foliage & forces alphaTest cutout (ZERO black dune blobs!)
 *  - Forces clean matte natural rock shading (roughness >= 0.88, low envMapIntensity)
 *  - Places patio dining sets & picnic tables 100% level on carpenter-built boardwalk terraces
 *  - Scales Tiki Bar stools to authentic barstool height (~0.585m) matching seated patrons!
 */
export class CoastalModels {
  public readonly group = new THREE.Group();
  private readonly loader = new GLTFLoader();
  private readonly lanternGlowMat = new THREE.MeshStandardMaterial({
    color: 0xffe4a8,
    emissive: 0xffa63a,
    emissiveIntensity: 0.35,
    roughness: 0.4
  });
  private loadedModels = 0;
  private readonly onLanternPlaced?: (pos: THREE.Vector3) => void;
  private readonly whalePlinthTop: THREE.Vector3;
  private readonly rayPlinthTop: THREE.Vector3;
  private readonly sharkPlinthTop: THREE.Vector3;
  private readonly coffeeCartDeckTop: THREE.Vector3;
  private readonly eastOverlookDeckTop: THREE.Vector3;
  private readonly lifebuoyHookPos: THREE.Vector3;
  private floatingBuoy: THREE.Group | null = null;
  private readonly floatingBuoyPos = { x: 12.5, z: 27.5 };

  constructor(
    camps: CampAnchor[],
    palmCoords: Array<[number, number]>,
    barStoolSpots: Array<{ x: number; y: number; z: number; yaw: number }>,
    patioTerraceSpots: TerraceTableSpot[],
    picnicTerraceSpots: TerraceTableSpot[],
    createTropicalDrinkFn: () => THREE.Group,
    onLanternPlaced?: (pos: THREE.Vector3) => void,
    whalePlinthTop?: THREE.Vector3,
    extraAnchors?: {
      rayPlinthTop?: THREE.Vector3;
      sharkPlinthTop?: THREE.Vector3;
      coffeeCartDeckTop?: THREE.Vector3;
      eastOverlookDeckTop?: THREE.Vector3;
      lifebuoyHookPos?: THREE.Vector3;
    }
  ) {
    this.group.name = 'PhotoscannedCoastalModels';
    this.onLanternPlaced = onLanternPlaced;
    this.whalePlinthTop = whalePlinthTop ?? new THREE.Vector3(14.8, getTerrainHeight(14.8, -21.8) + 1.08, -21.8);
    this.rayPlinthTop = extraAnchors?.rayPlinthTop ?? new THREE.Vector3(50.5, getTerrainHeight(50.5, -21.6) + 0.98, -21.6);
    this.sharkPlinthTop = extraAnchors?.sharkPlinthTop ?? new THREE.Vector3(-49.5, getTerrainHeight(-49.5, -21.6) + 0.98, -21.6);
    this.coffeeCartDeckTop = extraAnchors?.coffeeCartDeckTop ?? new THREE.Vector3(-47.5, getBoardwalkY(-47.5) + 0.28, -28.9);
    this.eastOverlookDeckTop = extraAnchors?.eastOverlookDeckTop ?? new THREE.Vector3(48.5, getBoardwalkY(48.5) + 0.28, -28.9);
    this.lifebuoyHookPos = extraAnchors?.lifebuoyHookPos ?? new THREE.Vector3(-1.32, getBoardwalkY(-1.32) + 0.52, -26.45);
    this.populateWorld(
      camps,
      palmCoords,
      barStoolSpots,
      patioTerraceSpots,
      picnicTerraceSpots,
      createTropicalDrinkFn
    );
  }

  public get loadedCount(): number {
    return this.loadedModels;
  }

  private loadModel(
    id: string,
    opts: { isMatteRock?: boolean; clearRoughnessMap?: boolean; rockTint?: number; isFoliage?: boolean; noShadow?: boolean } = {}
  ): Promise<THREE.Group | null> {
    const url = `./models/${id}/${id}_1k.gltf`;
    return new Promise((resolve) => {
      this.loader.load(
        url,
        (gltf) => {
          const root = gltf.scene;
          root.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = !opts.isFoliage && !opts.noShadow;
              child.receiveShadow = true;
              const mats = Array.isArray(child.material) ? child.material : [child.material];
              for (const m of mats) {
                if (m instanceof THREE.MeshStandardMaterial) {
                  if (m.map) m.map.anisotropy = 8;
                  if (m.normalMap) m.normalMap.anisotropy = 8;
                  if (opts.isMatteRock) {
                    // Natural dry sunlit coastal limestone/granite (NEVER glossy dark chrome!)
                    if (opts.clearRoughnessMap) m.roughnessMap = null;
                    if (opts.rockTint !== undefined) m.color.setHex(opts.rockTint);
                    m.roughness = Math.max(m.roughness, 0.90);
                    m.metalness = 0.0;
                    m.envMapIntensity = 0.16;
                    m.needsUpdate = true;
                  }
                  if (opts.isFoliage) {
                    // Crisp cutout foliage with sunlit coastal green bounce (eliminates dark black clumps!)
                    m.side = THREE.DoubleSide;
                    m.transparent = false;
                    m.alphaTest = 0.28;
                    m.roughness = 0.80;
                    m.metalness = 0.0;
                    m.envMapIntensity = 0.50;
                    m.color.setHex(0xe8f5dc);
                    m.emissive.setHex(0x14200c);
                    m.emissiveIntensity = 0.28;
                    m.needsUpdate = true;
                  }
                }
              }
            }
          });
          this.loadedModels++;
          resolve(root);
        },
        undefined,
        () => resolve(null)
      );
    });
  }

  /**
   * Splits a multi-variant GLTF pack (e.g. shrub_02 with 4 shrubs lined up in a row)
   * into clean individual centered variants (each centered at local x=0, z=0, bottom y=0)!
   */
  private extractCenteredVariants(
    template: THREE.Group,
    nameFilter?: (name: string) => boolean
  ): CenteredVariant[] {
    template.updateMatrixWorld(true);
    const variants: CenteredVariant[] = [];

    template.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const fullName = `${child.name} ${child.parent?.name || ''}`;
      if (nameFilter && !nameFilter(fullName)) return;

      const geo = child.geometry.clone();
      geo.applyMatrix4(child.matrixWorld);
      geo.computeBoundingBox();
      if (!geo.boundingBox) return;

      const cx = (geo.boundingBox.min.x + geo.boundingBox.max.x) * 0.5;
      const cz = (geo.boundingBox.min.z + geo.boundingBox.max.z) * 0.5;
      const minY = geo.boundingBox.min.y;
      const height = Math.max(0.01, geo.boundingBox.max.y - minY);
      const halfX = (geo.boundingBox.max.x - geo.boundingBox.min.x) * 0.5;
      const halfZ = (geo.boundingBox.max.z - geo.boundingBox.min.z) * 0.5;
      const maxHalfFootprint = Math.max(halfX, halfZ);
      geo.translate(-cx, -minY, -cz);
      geo.computeBoundingSphere();

      variants.push({ geometry: geo, material: child.material, height, maxHalfFootprint });
    });

    return variants;
  }

  /**
   * Batches placements evenly across individual centered variants using GPU InstancedMesh!
   * When splitEastWest is true, splits placements into West (x < 0) and East (x >= 0) chunks
   * so camera frustum culling discards off-side hillside flora cleanly.
   */
  private placeVariantInstancedBatch(
    variants: CenteredVariant[],
    placements: InstancePlacement[],
    castShadow = false,
    splitEastWest = false
  ): void {
    if (variants.length === 0 || placements.length === 0) return;

    const groups = splitEastWest
      ? [placements.filter((p) => p.x < 0), placements.filter((p) => p.x >= 0)]
      : [placements];

    const dummy = new THREE.Object3D();
    for (const grp of groups) {
      if (grp.length === 0) continue;
      const buckets: InstancePlacement[][] = variants.map(() => []);
      for (let i = 0; i < grp.length; i++) {
        buckets[i % variants.length].push(grp[i]);
      }

      for (let v = 0; v < variants.length; v++) {
        const list = buckets[v];
        if (list.length === 0) continue;

        const { geometry, material } = variants[v];
        const inst = new THREE.InstancedMesh(geometry, material, list.length);
        inst.castShadow = castShadow;
        inst.receiveShadow = true;

        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          dummy.position.set(p.x, p.y, p.z);
          dummy.rotation.set(p.rx, p.ry, p.rz);
          dummy.scale.set(p.sx, p.sy, p.sz);
          dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix);
        }
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        this.group.add(inst);
      }
    }
  }

  /**
   * Places small downloaded plants by EXACT target world height in meters (variant.height normalized),
   * round-robin across variants, West/East split for frustum culling.
   */
  private placeHeightNormalizedBatch(
    variants: CenteredVariant[],
    spots: Array<{ x: number; y: number; z: number; ry: number; rx: number; rz: number; h: number }>,
    splitEastWest = true
  ): void {
    if (variants.length === 0 || spots.length === 0) return;
    const per: InstancePlacement[][] = variants.map(() => []);
    spots.forEach((s, i) => {
      const v = variants[i % variants.length];
      const k = s.h / v.height;
      per[i % variants.length].push({ x: s.x, y: s.y, z: s.z, rx: s.rx, ry: s.ry, rz: s.rz, sx: k, sy: k, sz: k });
    });
    for (let v = 0; v < variants.length; v++) {
      this.placeVariantInstancedBatch([variants[v]], per[v], false, splitEastWest);
    }
  }

  /** Clones an entire multi-mesh template (pot + soil + plant stay assembled), bottom-grounded at y. */
  private placeWholeClone(
    template: THREE.Group,
    x: number,
    y: number,
    z: number,
    yaw: number,
    targetH: number,
    opts: { keepSeparateForCulling?: boolean; tiltX?: number; tiltZ?: number } = {}
  ): THREE.Group {
    const clone = template.clone(true);
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.scale.set(1, 1, 1);
    clone.updateMatrixWorld(true);
    const raw = new THREE.Box3().setFromObject(clone);
    const rawH = Math.max(0.001, raw.max.y - raw.min.y);
    const k = targetH / rawH;
    clone.scale.setScalar(k);
    clone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(clone);
    const cx = (box.min.x + box.max.x) * 0.5;
    const cz = (box.min.z + box.max.z) * 0.5;
    clone.position.set(-cx, -box.min.y, -cz);
    const wrapper = new THREE.Group();
    wrapper.add(clone);
    wrapper.position.set(x, y, z);
    wrapper.rotation.set(opts.tiltX ?? 0, yaw, opts.tiltZ ?? 0);
    if (opts.keepSeparateForCulling) {
      mergeStaticGroupByMaterial(wrapper);
      wrapper.userData.dynamic = true;
    }
    this.group.add(wrapper);
    return wrapper;
  }

  private placeInstancedBatch(
    template: THREE.Group,
    placements: InstancePlacement[],
    castShadow = false,
    splitEastWest = false
  ): void {
    if (placements.length === 0) return;
    const variants = this.extractCenteredVariants(template);
    if (variants.length === 0) return;
    const groups = splitEastWest
      ? [placements.filter((p) => p.x < 0), placements.filter((p) => p.x >= 0)]
      : [placements];

    // For single-mesh templates (rocks, shells), place placements on all sub-meshes per side
    const dummy = new THREE.Object3D();
    for (const grp of groups) {
      if (grp.length === 0) continue;
      for (const v of variants) {
        const inst = new THREE.InstancedMesh(v.geometry, v.material, grp.length);
        inst.castShadow = castShadow;
        inst.receiveShadow = true;
        for (let i = 0; i < grp.length; i++) {
          const p = grp[i];
          dummy.position.set(p.x, p.y, p.z);
          dummy.rotation.set(p.rx, p.ry, p.rz);
          dummy.scale.set(p.sx, p.sy, p.sz);
          dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix);
        }
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        this.group.add(inst);
      }
    }
  }

  private placeSingleGrounded(
    template: THREE.Group,
    x: number,
    z: number,
    yaw: number,
    scale: number | [number, number, number],
    sink = 0.03,
    fixedY?: number
  ): { obj: THREE.Group; topY: number } {
    const clone = template.clone(true);
    if (Array.isArray(scale)) clone.scale.set(scale[0], scale[1], scale[2]);
    else clone.scale.setScalar(scale);

    clone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(clone);
    const minY = isFinite(box.min.y) ? box.min.y : 0;
    const height = isFinite(box.max.y - box.min.y) ? box.max.y - box.min.y : 0.6;

    const baseY = fixedY !== undefined ? fixedY : getTerrainHeight(x, z) - sink;
    const wrapper = new THREE.Group();
    wrapper.position.set(x, baseY, z);
    wrapper.rotation.y = yaw;
    clone.position.y -= minY;
    wrapper.add(clone);
    this.group.add(wrapper);

    return { obj: wrapper, topY: baseY + height };
  }

  private async populateWorld(
    camps: CampAnchor[],
    palmCoords: Array<[number, number]>,
    barStoolSpots: Array<{ x: number; y: number; z: number; yaw: number }>,
    patioTerraceSpots: TerraceTableSpot[],
    picnicTerraceSpots: TerraceTableSpot[],
    createTropicalDrinkFn: () => THREE.Group
  ): Promise<void> {
    const rand = seededRand(8841);

    const [
      rock09,
      rock07,
      sideTable,
      patioSet,
      picnicTable,
      lambisShell,
      shrub02,
      fern02,
      iceplant,
      rooibosBush,
      boombox,
      lantern,
      crate,
      barrels,
      stool,
      stoneFirePit,
      fort,
      anthurium,
      calathea,
      sorrel,
      shrub03,
      empodium,
      pottedPlant,
      chalkboard,
      whaleStatue,
      woodenBucket,
      woodenCrate02,
      coffeeCart,
      paintedBench,
      rayStatue,
      sharkStatue,
      ukulele,
      planterBox,
      realLifebuoy,
      oceanBuoy,
      gazania,
      ursinia,
      bananas
    ] = await Promise.all([
      this.loadModel('rock_09', { isMatteRock: true, clearRoughnessMap: true, rockTint: 0xe6ded2 }),
      this.loadModel('rock_07', { isMatteRock: true, clearRoughnessMap: true, rockTint: 0xded4c6 }),
      this.loadModel('small_wooden_table_01', { noShadow: true }),
      this.loadModel('outdoor_table_chair_set_01', { noShadow: true }),
      this.loadModel('wooden_picnic_table', { noShadow: true }),
      this.loadModel('lambis_shell', { noShadow: true }),
      this.loadModel('shrub_02', { isFoliage: true }),
      this.loadModel('fern_02', { isFoliage: true }),
      this.loadModel('crystalline_iceplant', { isFoliage: true }),
      this.loadModel('wild_rooibos_bush', { isFoliage: true }),
      this.loadModel('portable_cassette_player', { noShadow: true }),
      this.loadModel('wooden_lantern_01', { noShadow: true }),
      this.loadModel('wooden_crate_01', { noShadow: true }),
      this.loadModel('wooden_barrels_01', { noShadow: true }),
      this.loadModel('wooden_stool_01', { noShadow: true }),
      this.loadModel('stone_fire_pit', { isMatteRock: true, noShadow: true }),
      this.loadModel('modular_fort_01', { isMatteRock: true, noShadow: true }),
      this.loadModel('anthurium_botany_01', { isFoliage: true, noShadow: true }),
      this.loadModel('calathea_orbifolia_01', { isFoliage: true, noShadow: true }),
      this.loadModel('shrub_sorrel_01', { isFoliage: true, noShadow: true }),
      this.loadModel('shrub_03', { isFoliage: true, noShadow: true }),
      this.loadModel('flower_empodium', { isFoliage: true, noShadow: true }),
      this.loadModel('potted_plant_04', { noShadow: true }),
      this.loadModel('standing_chalkboard_01', { noShadow: true }),
      this.loadModel('bronze_whale_statue', { noShadow: true }),
      this.loadModel('wooden_bucket_01', { noShadow: true }),
      this.loadModel('wooden_crate_02', { noShadow: true }),
      this.loadModel('CoffeeCart_01', { noShadow: true }),
      this.loadModel('painted_wooden_bench', { noShadow: true }),
      this.loadModel('bronze_ray_statue', { noShadow: true }),
      this.loadModel('bronze_shark_statue', { noShadow: true }),
      this.loadModel('Ukulele_01', { noShadow: true }),
      this.loadModel('planter_box_01', { noShadow: true }),
      this.loadModel('lifebuoy', { noShadow: true }),
      this.loadModel('ocean_buoy', { noShadow: true }),
      this.loadModel('flower_gazania', { isFoliage: true, noShadow: true }),
      this.loadModel('flower_ursinia', { isFoliage: true, noShadow: true }),
      this.loadModel('bananas', { noShadow: true })
    ]);

    // 1. SIDE TABLES + CHILLED TROPICAL DRINKS cleanly next to every beach umbrella camp
    if (sideTable) {
      for (const camp of camps) {
        const tx = camp.sideTablePos.x;
        const tz = camp.sideTablePos.z;
        const { topY } = this.placeSingleGrounded(sideTable, tx, tz, camp.yaw + 0.12, 0.80, 0.03);
        addCollider(tx, tz, 0.34, 0.65);

        const d1 = createTropicalDrinkFn();
        d1.position.set(tx - 0.11, topY - 0.008, tz + 0.05);
        this.group.add(d1);

        const d2 = createTropicalDrinkFn();
        d2.position.set(tx + 0.12, topY - 0.008, tz - 0.06);
        d2.rotation.y = 1.5;
        this.group.add(d2);
      }
    }

    // 2. VINTAGE BOOMBOX resting flush on sand beside sunbather's towel
    if (boombox && camps.length > 2 && camps[2].towelPos) {
      const tp = camps[2].towelPos;
      this.placeSingleGrounded(boombox, tp.x + 0.72, tp.z - 0.38, 0.45, 1.45, 0.005);
    }

    // 3. TIKI SURF BAR STOOLS (3 occupied barstools matching seated patrons cleanly!)
    if (stool) {
      for (const s of barStoolSpots.slice(0, 3)) {
        this.placeSingleGrounded(stool, s.x, s.z, s.yaw, [1.04, 1.34, 1.04], 0.0, s.y);
        addCollider(s.x, s.z, 0.25, 0.65);
      }
    }

    // INTACT UPRIGHT WOODEN BARRELS ONLY (discarding the 17 broken stave debris pieces!)
    if (barrels) {
      const intactBarrels = this.extractCenteredVariants(barrels, (name) =>
        name.includes('barrel01') || name.includes('barrel02')
      );
      if (intactBarrels.length > 0) {
        const barrelSpots: Array<[number, number, number, number]> = [
          [-27.4, -29.2, 0.35, 1.02],
          [25.4, -27.2, 0.8, 0.95]
        ];
        const barrelPlacements: InstancePlacement[] = barrelSpots.map(([bx, bz, yaw, sc]) => {
          addCollider(bx, bz, 0.42, 0.95);
          return {
            x: bx,
            y: getTerrainHeight(bx, bz) - 0.03,
            z: bz,
            rx: 0,
            ry: yaw,
            rz: 0,
            sx: sc,
            sy: sc,
            sz: sc
          };
        });
        this.placeVariantInstancedBatch(intactBarrels, barrelPlacements, false);
      }
    }

    if (crate) {
      this.placeSingleGrounded(crate, -27.2, -27.2, 0.22, 0.88, 0.02);
      addCollider(-27.2, -27.2, 0.44, 0.6);
    }

    // BATCH A: Real photoscanned Poly Haven stone fire pit around Western Bonfire Ring (-38.5, -19.2)
    if (stoneFirePit) {
      const fx = -38.5;
      const fz = -19.2;
      const fn = getTerrainNormal(fx, fz);
      const lowEdgeY = Math.min(
        getTerrainHeight(fx, fz + 0.9),
        getTerrainHeight(fx, fz - 0.9),
        getTerrainHeight(fx, fz)
      );
      this.placeInstancedBatch(
        stoneFirePit,
        [
          {
            x: fx,
            y: lowEdgeY - 0.08,
            z: fz,
            rx: fn.z * 0.6,
            ry: 0.35,
            rz: -fn.x * 0.6,
            sx: 1.45,
            sy: 1.45,
            sz: 1.45
          }
        ],
        true
      );
    }

    // 4. LEVEL BOARDWALK PATIO DINING SETS (exact tabletop coordinates on carpenter-built decks!)
    if (patioSet) {
      patioTerraceSpots.forEach((sp, idx) => {
        this.placeSingleGrounded(patioSet, sp.x, sp.z, sp.yaw, 1.0, 0.0, sp.y);
        addCollider(sp.x, sp.z, 0.58, 0.85);

        // Measured exact table center in GLTF local space: (-0.08, 0.726, +0.07)
        const cosY = Math.cos(sp.yaw);
        const sinY = Math.sin(sp.yaw);
        const toWorld = (lx: number, lz: number): [number, number] => [
          sp.x + lx * cosY + lz * sinY,
          sp.z - lx * sinY + lz * cosY
        ];
        const tableY = sp.y + 0.728;

        const [tx, tz] = toWorld(-0.08, 0.07);
        const [d1x, d1z] = toWorld(-0.22, 0.16);
        const [d2x, d2z] = toWorld(0.08, -0.04);

        const d1 = createTropicalDrinkFn();
        d1.position.set(d1x, tableY, d1z);
        this.group.add(d1);

        const d2 = createTropicalDrinkFn();
        d2.position.set(d2x, tableY, d2z);
        d2.rotation.y = 1.4;
        this.group.add(d2);

        if (lantern && idx === 0) {
          this.placeLanternAt(lantern, tx, tableY, tz, 0.54);
        } else {
          const candle = new THREE.Mesh(new THREE.SphereGeometry(0.036, 7, 6), this.lanternGlowMat);
          candle.position.set(tx, tableY + 0.06, tz);
          this.group.add(candle);
          this.onLanternPlaced?.(new THREE.Vector3(tx, tableY + 0.09, tz));
        }
      });
    }

    // LEVEL BOARDWALK PICNIC TERRACE TABLES (benches parallel to boardwalk facing ocean!)
    if (picnicTable) {
      for (const sp of picnicTerraceSpots) {
        const sc = 0.96;
        this.placeSingleGrounded(picnicTable, sp.x, sp.z, sp.yaw, sc, 0.0, sp.y);
        addCollider(sp.x, sp.z, 0.92, 0.80);

        const tableY = sp.y + 0.704 * sc;
        const d1 = createTropicalDrinkFn();
        d1.position.set(sp.x - 0.35, tableY, sp.z + 0.16);
        this.group.add(d1);

        const d2 = createTropicalDrinkFn();
        d2.position.set(sp.x + 0.42, tableY, sp.z - 0.12);
        d2.rotation.y = 2.1;
        this.group.add(d2);

        // Warm dusk table candle orb (reuses shared lanternGlowMat for zero extra mesh tris!)
        const candle = new THREE.Mesh(new THREE.SphereGeometry(0.036, 7, 6), this.lanternGlowMat);
        candle.position.set(sp.x, tableY + 0.06, sp.z);
        this.group.add(candle);
        this.onLanternPlaced?.(new THREE.Vector3(sp.x, tableY + 0.09, sp.z));
      }
    }

    // 5. GPU-INSTANCED SOLID 360-DEG COASTAL BOULDER & CLIFF STACKS (rock_09 & rock_07, world-meter scaled, West/East split)
    const rock09Vars = rock09 ? this.extractCenteredVariants(rock09) : [];
    const rock07Vars = rock07 ? this.extractCenteredVariants(rock07) : [];
    const rock09RawH = rock09Vars[0]?.height ?? 0.03;
    const rock07RawH = rock07Vars[0]?.height ?? 0.14;
    const rock09RawFoot = rock09Vars[0]?.maxHalfFootprint ?? 0.07;
    const rock07RawFoot = rock07Vars[0]?.maxHalfFootprint ?? 0.16;

    const minRockFootprintY = (cx: number, cz: number, rad: number): number => {
      let minH = getTerrainHeight(cx, cz);
      for (let i = 0; i < 8; i++) {
        const ang = (i * Math.PI) / 4;
        minH = Math.min(minH, getTerrainHeight(cx + Math.cos(ang) * rad, cz + Math.sin(ang) * rad));
      }
      return minH;
    };

    const rock09Inner: InstancePlacement[] = [];
    const rock09Outer: InstancePlacement[] = [];
    const rock07Inner: InstancePlacement[] = [];
    const rock07Outer: InstancePlacement[] = [];

    // [x, z, targetHeightMeters, yaw, useRock07, syExtraMultiplier]
    const headlandRocks: Array<[number, number, number, number, boolean, number]> = [
      // West Headland (clear of expanded boardwalk at x=-62, z=-25 and clear of hillside palms!)
      [-53, -3, 1.95, 0.95, false, 1.25],
      [-60, -11, 3.4, 0.50, true, 0.95],
      [-71, -17, 4.7, 1.85, true, 0.95],
      [-64, -6, 2.6, 1.55, false, 1.25],
      // East Headland (mirrored)
      [53, -3, 1.95, -0.95, false, 1.25],
      [60, -11, 3.4, -0.50, true, 0.95],
      [71, -17, 4.7, -1.85, true, 0.95],
      [64, -6, 2.6, -1.55, false, 1.25]
    ];

    for (const [rx, rz, targetH, yaw, use07, syMult] of headlandRocks) {
      const rawH = use07 ? rock07RawH : rock09RawH;
      const rawFoot = use07 ? rock07RawFoot : rock09RawFoot;
      const unitScale = targetH / rawH;
      const sampleRad = Math.min(6.0, rawFoot * unitScale * 0.72);
      const y = minRockFootprintY(rx, rz, sampleRad) - targetH * 0.24;
      const p: InstancePlacement = {
        x: rx,
        y,
        z: rz,
        rx: 0,
        ry: yaw,
        rz: 0,
        sx: unitScale,
        sy: unitScale * syMult,
        sz: unitScale * 0.92
      };
      const isOuter = Math.abs(rx) >= 50 || rz < -30;
      if (use07) {
        if (isOuter) rock07Outer.push(p);
        else rock07Inner.push(p);
      } else {
        if (isOuter) rock09Outer.push(p);
        else rock09Inner.push(p);
      }
      addCollider(rx, rz, targetH * 0.65, targetH * syMult);
    }

    if (rock09Vars.length > 0) {
      this.placeVariantInstancedBatch(rock09Vars, [...rock09Inner, ...rock09Outer], false, true);
    }
    if (rock07Vars.length > 0) {
      this.placeVariantInstancedBatch(rock07Vars, [...rock07Inner, ...rock07Outer], false, true);
    }

    // 5b. HISTORIC WEST HEADLAND STONE WATCHTOWER + CURTAIN WALL (Poly Haven modular_fort_01)
    if (fort) {
      const placeNamedSubtree = (
        nodeName: string,
        x: number,
        z: number,
        yaw: number,
        scale: number,
        footprintRadius: number,
        sink: number
      ): { baseY: number; topY: number } | null => {
        let raw: THREE.Object3D | undefined = fort.getObjectByName(nodeName);
        if (!raw) {
          fort.traverse((o) => {
            if (!raw && o.name === nodeName) raw = o;
          });
        }
        if (!raw) return null;
        const clone = raw.clone(true);
        clone.position.set(0, 0, 0);
        clone.rotation.set(0, 0, 0);
        clone.scale.setScalar(scale);
        clone.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(clone);
        const cx = (box.min.x + box.max.x) * 0.5;
        const cz = (box.min.z + box.max.z) * 0.5;
        clone.position.set(-cx, -box.min.y, -cz);
        const wrapper = new THREE.Group();
        wrapper.name = `Fort_${nodeName}`;
        wrapper.add(clone);
        const baseY = minRockFootprintY(x, z, footprintRadius) - sink;
        wrapper.position.set(x, baseY, z);
        wrapper.rotation.y = yaw;
        this.group.add(wrapper);
        return { baseY, topY: baseY + (box.max.y - box.min.y) };
      };

      const tower = placeNamedSubtree('modular_fort_01_tower_round', -58.5, -40.5, 0.35, 0.44, 3.5, 1.15);
      if (tower) {
        addCollider(-58.5, -40.5, 3.6, 5.8);
        // Warm dusk parapet torches on the oceanward (south-east) rim facing the cove
        const rimR = 2.9;
        for (const ang of [Math.PI * 0.25 + 0.42, Math.PI * 0.25 - 0.42]) {
          const lx = -58.5 + Math.cos(ang) * rimR;
          const lz = -40.5 + Math.sin(ang) * rimR;
          const ly = tower.topY - 0.15;
          const candle = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), this.lanternGlowMat);
          candle.position.set(lx, ly, lz);
          this.group.add(candle);
          this.onLanternPlaced?.(new THREE.Vector3(lx, ly, lz));
        }
      }
      const wall = placeNamedSubtree('modular_fort_01_wall_thick_straight_01', -63.8, -42.8, 1.12, 0.44, 3.2, 1.1);
      if (wall) addCollider(-63.8, -42.8, 2.5, 3.5);
    }

    // 6. INDIVIDUAL CENTERED DUNE VEGETATION (filtered to lightweight sub-variants for 240 FPS triangle budget!)
    const shrubVariants = shrub02 ? this.extractCenteredVariants(shrub02, (n) => /shrub_02_[bd]/.test(n)) : [];
    const fernVariants = fern02 ? this.extractCenteredVariants(fern02, (n) => /fern_02_[ad]/.test(n)) : [];
    const iceVariants = iceplant ? this.extractCenteredVariants(iceplant, (n) => /crystalline_iceplant_[f-h]/.test(n)) : [];
    const bushVariants = rooibosBush ? this.extractCenteredVariants(rooibosBush, (n) => /wild_rooibos_bush_[de]/.test(n)) : [];

    const shrubList: InstancePlacement[] = [];
    const fernList: InstancePlacement[] = [];
    const iceList: InstancePlacement[] = [];
    const bushList: InstancePlacement[] = [];

    const isClearDuneSpot = (gx: number, gz: number): boolean => {
      if (gz > -29.8) return false; // Stay cleanly behind boardwalk & fence
      // Keep Tiki Bar, Coffee Cart, Hammocks, Surfboard Rack, Lifeguard Tower, and all 6 wooden decks 100% clear!
      if (gx > -62.0 && gx < -52.0 && gz > -32.2) return false; // West Hammock Grove
      if (gx > -51.5 && gx < -43.5 && gz > -32.6) return false; // West Coffee Cart Deck
      if (gx > -40.5 && gx < -32.5 && gz > -32.6) return false; // West picnic terrace
      if (gx > -28.0 && gx < -12.5 && gz > -34.5) return false; // Tiki Bar + Surf Rack
      if (gx > -12.8 && gx < 2.2 && gz > -33.6) return false;   // Center Patio + Lifeguard Tower
      if (gx > 5.5 && gx < 16.0 && gz > -32.6) return false;    // East Café Terrace
      if (gx > 29.0 && gx < 37.0 && gz > -32.6) return false;   // Far East Picnic Terrace
      if (gx > 44.0 && gx < 53.0 && gz > -32.6) return false;   // East Lagoon Overlook Deck
      if (gx > -68 && gx < -53 && gz > -47 && gz < -35) return false; // West headland stone fort
      return true;
    };

    const ecoCenters: Array<[number, number, number]> = [];
    for (const [px, pz] of palmCoords) {
      if (pz <= -32) ecoCenters.push([px, pz, 4.6]);
    }
    for (let x = -74; x <= 74; x += 9.5) {
      ecoCenters.push([x + (rand() - 0.5) * 3.0, -34.5 - rand() * 14.0, 5.4]);
      // Lush second-tier coastal hillside vegetation behind Z = -48..-70 (no bald desert wall!)
      ecoCenters.push([x + (rand() - 0.5) * 4.5, -51.0 - rand() * 20.0, 6.8]);
    }

    const addIndividual = (
      list: InstancePlacement[],
      cx: number,
      cz: number,
      radius: number,
      scMin: number,
      scMax: number,
      sink: number
    ) => {
      const ang = rand() * Math.PI * 2;
      const dist = 0.6 + rand() * radius;
      const gx = cx + Math.cos(ang) * dist;
      const gz = cz + Math.sin(ang) * dist;
      if (!isClearDuneSpot(gx, gz)) return;

      const gy = getTerrainHeight(gx, gz) - sink;
      const sc = scMin + rand() * (scMax - scMin);
      const n = getTerrainNormal(gx, gz);
      list.push({
        x: gx,
        y: gy,
        z: gz,
        rx: n.z * 0.42,
        ry: rand() * Math.PI * 2,
        rz: -n.x * 0.42,
        sx: sc,
        sy: sc,
        sz: sc
      });
    };

    for (const [cx, cz, radius] of ecoCenters) {
      // Natural clustered coastal botanical pockets around every palm & dune crest
      addIndividual(shrubList, cx, cz, radius, 0.95, 1.55, 0.08);
      addIndividual(shrubList, cx, cz, radius, 0.80, 1.30, 0.08);
      addIndividual(fernList, cx, cz, radius, 1.05, 1.85, 0.07);
      addIndividual(fernList, cx, cz, radius, 0.95, 1.65, 0.07);
      addIndividual(fernList, cx, cz, radius, 0.85, 1.45, 0.07);
      if (rand() > 0.35) addIndividual(bushList, cx, cz, radius, 0.90, 1.45, 0.08);
      addIndividual(iceList, cx, cz, radius, 1.25, 2.05, 0.05);
      addIndividual(iceList, cx, cz, radius, 1.15, 1.85, 0.05);
    }

    const sampleCap = <T>(arr: T[], maxLen: number): T[] => {
      if (arr.length <= maxLen) return arr;
      const out: T[] = [];
      for (let i = 0; i < maxLen; i++) {
        out.push(arr[Math.floor((i * arr.length) / maxLen)]);
      }
      return out;
    };

    // Old heavy multi-plant packs trimmed & unsplit for minimal draw calls while keeping all species represented
    this.placeVariantInstancedBatch(shrubVariants, sampleCap(shrubList, 1), false, false);
    this.placeVariantInstancedBatch(fernVariants, sampleCap(fernList, 2), false, false);
    this.placeVariantInstancedBatch(iceVariants, sampleCap(iceList, 2), false, false);
    this.placeVariantInstancedBatch(bushVariants, sampleCap(bushList, 1), false, false);

    // 6b. DENSE DOWNLOADED TROPICAL FLORA (Poly Haven CC0) scaled to exact world heights in meters
    type HSpot = { x: number; y: number; z: number; ry: number; rx: number; rz: number; h: number };
    const floraCenters: Array<[number, number, number]> = [
      ...ecoCenters,
      [-66, -34, 5.0], [-74, -44, 5.5], [66, -34, 5.0], [74, -44, 5.5],
      [-46, -40, 4.5], [46, -40, 4.5], [0, -42, 6.0], [-22, -40, 5.0], [22, -40, 5.0]
    ];
    const scatter = (count: number, hMin: number, hMax: number, sink: number, maxTries = count * 8): HSpot[] => {
      const out: HSpot[] = [];
      for (let t = 0; t < maxTries && out.length < count; t++) {
        const [cx, cz, radius] = floraCenters[Math.floor(rand() * floraCenters.length)];
        const ang = rand() * Math.PI * 2;
        const dist = 0.5 + rand() * radius;
        const gx = cx + Math.cos(ang) * dist;
        const gz = cz + Math.sin(ang) * dist;
        if (!isClearDuneSpot(gx, gz)) continue;
        // keep clear of every palm trunk base
        let nearPalm = false;
        for (const [px, pz] of palmCoords) {
          if ((px - gx) * (px - gx) + (pz - gz) * (pz - gz) < 0.9) { nearPalm = true; break; }
        }
        if (nearPalm) continue;
        const n = getTerrainNormal(gx, gz);
        out.push({
          x: gx,
          y: getTerrainHeight(gx, gz) - sink,
          z: gz,
          rx: n.z * 0.35,
          ry: rand() * Math.PI * 2,
          rz: -n.x * 0.35,
          h: hMin + rand() * (hMax - hMin)
        });
      }
      return out;
    };

    if (sorrel) {
      const v = this.extractCenteredVariants(
        sorrel,
        (n) => /shrub_sorrel_01_[ab]/.test(n)
      );
      this.placeHeightNormalizedBatch(v, scatter(16, 1.05, 1.75, 0.04), false);
    }
    if (empodium) {
      const v = this.extractCenteredVariants(empodium, (n) => /flower_empodium_[ab]/.test(n));
      this.placeHeightNormalizedBatch(v, scatter(12, 0.80, 1.35, 0.03), false);
    }
    if (shrub03) {
      const v = this.extractCenteredVariants(shrub03, (n) => /shrub_03_[ab]/.test(n));
      this.placeHeightNormalizedBatch(v, scatter(7, 1.45, 2.35, 0.06), false);
    }
    if (calathea) {
      const v = this.extractCenteredVariants(
        calathea,
        (n) => /calathea_orbifolia_01_d/.test(n)
      );
      this.placeHeightNormalizedBatch(v, scatter(5, 1.25, 1.90, 0.05), false);
    }

    // Tiki Bar deck (barStoolSpots carry the exact deck Y)
    const tikiDeckY = barStoolSpots.length > 0 ? barStoolSpots[0].y : getTerrainHeight(-22, -30) + 0.4;
    if (anthurium) {
      const v = this.extractCenteredVariants(anthurium, (n) => n.includes('anthurium_botany_05_e'));
      const tikiBorder: Array<[number, number, number]> = [
        [-27.55, -28.4, 1.08],
        [-16.45, -29.0, 1.02]
      ];
      this.placeHeightNormalizedBatch(
        v,
        tikiBorder.map(([x, z, h]) => ({ x, y: getTerrainHeight(x, z) - 0.04, z, rx: 0, ry: rand() * Math.PI * 2, rz: 0, h })),
        false
      );
    }
    if (pottedPlant) {
      // Flanking the Tiki Bar entrance stairs, standing on the deck's front corners
      this.placeWholeClone(pottedPlant, -25.15, tikiDeckY, -27.05, 0.4, 0.72);
      this.placeWholeClone(pottedPlant, -18.85, tikiDeckY, -27.05, -0.6, 0.72);
    }

    // 6c. RESORT LANDMARKS & DOCK PROPS (standing_chalkboard_01, bronze_whale_statue, wooden_bucket_01, wooden_crate_02)
    if (chalkboard) {
      const cbX = -18.45;
      const cbZ = -26.05;
      const cbY = getBoardwalkY(cbX);
      this.placeWholeClone(chalkboard, cbX, cbY, cbZ, 0.28, 1.38);
      addCollider(cbX, cbZ, 0.48, 1.4);
    }
    if (whaleStatue) {
      this.placeWholeClone(
        whaleStatue,
        this.whalePlinthTop.x,
        this.whalePlinthTop.y - 0.015,
        this.whalePlinthTop.z,
        -0.35,
        1.65
      );
    }
    if (woodenCrate02) {
      // Pier fishing supply crate along east edge of pier deck (y = 2.15, narrow X=0.45m, long Z=0.99m)
      this.placeWholeClone(woodenCrate02, 23.42, 2.15, 0.15, 0.04, 0.40);
      addCollider(23.42, 0.15, 0.38, 0.5);
      // Tiki Bar west deck back corner supply crate (clear of counter & columns)
      this.placeWholeClone(woodenCrate02, -26.05, tikiDeckY, -31.15, 0.06, 0.40);
    }
    if (woodenBucket) {
      // Pier fisherman's wooden bait bucket beside supply crate
      this.placeWholeClone(woodenBucket, 23.40, 2.15, 1.12, 0.65, 0.36);
      // Tiki Bar west deck ice/lime bucket beside supply crate
      this.placeWholeClone(woodenBucket, -26.0, tikiDeckY, -30.15, 1.25, 0.35);
    }

    // 6d. WAVE-2 EXPANDED RESORT ASSETS (CoffeeCart_01, Painted Benches, Manta Ray & Shark Monuments, Ukulele, Planters, Lifebuoy, Channel Buoy, Gazania & Ursinia Wildflowers, Tropical Bananas)
    if (coffeeCart) {
      // Strip stray floor power-cord & outlet triangles sticking past local x < -0.71 in Top_Cart!
      coffeeCart.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const g = child.geometry as THREE.BufferGeometry;
        const pos = g.attributes.position as THREE.BufferAttribute | undefined;
        if (!pos) return;
        if (g.index) {
          const idx = g.index;
          const kept: number[] = [];
          for (let i = 0; i < idx.count; i += 3) {
            const a = idx.getX(i);
            const b = idx.getX(i + 1);
            const c = idx.getX(i + 2);
            if (pos.getX(a) >= -0.70 && pos.getX(b) >= -0.70 && pos.getX(c) >= -0.70) {
              kept.push(a, b, c);
            }
          }
          if (kept.length !== idx.count) {
            g.setIndex(kept);
            g.computeBoundingBox();
            g.computeBoundingSphere();
          }
        }
      });
      const cc = this.coffeeCartDeckTop;
      this.placeWholeClone(coffeeCart, cc.x, cc.y, cc.z - 0.15, 0.06, 1.68);
      addOrientedBoxCollider(cc.x, cc.z - 0.15, 0.78, 0.42, 0.06, cc.y, cc.y + 1.75);
      this.onLanternPlaced?.(new THREE.Vector3(cc.x, cc.y + 1.52, cc.z + 0.1));
    }
    if (planterBox) {
      // Framing West Coffee Cart Deck & East Lagoon Overlook Deck (batched by mergeStaticGroupByMaterial)
      this.placeWholeClone(planterBox, -50.15, this.coffeeCartDeckTop.y, -27.25, 0.0, 0.56);
      this.placeWholeClone(planterBox, 45.35, this.eastOverlookDeckTop.y, -27.25, 0.0, 0.56);
    }
    if (paintedBench) {
      // 4 ultra-light (630t) coastal benches facing the ocean (+Z -> yaw = 0) with tight OBB colliders!
      const benchSpots: Array<[number, number, number, number]> = [
        [47.2, this.eastOverlookDeckTop.y, -29.85, 0],
        [50.2, this.eastOverlookDeckTop.y, -29.85, 0],
        [-42.0, getBoardwalkY(-42.0), -25.62, 0],
        [40.0, getBoardwalkY(40.0), -25.62, 0]
      ];
      for (const [bx, by, bz, yaw] of benchSpots) {
        this.placeWholeClone(paintedBench, bx, by, bz, yaw, 0.94);
        addOrientedBoxCollider(bx, bz, 0.60, 0.28, yaw, by, by + 0.95);
      }
    }
    if (rayStatue) {
      this.placeWholeClone(
        rayStatue,
        this.rayPlinthTop.x,
        this.rayPlinthTop.y - 0.015,
        this.rayPlinthTop.z,
        -0.55,
        1.28
      );
    }
    if (sharkStatue) {
      this.placeWholeClone(
        sharkStatue,
        this.sharkPlinthTop.x,
        this.sharkPlinthTop.y - 0.015,
        this.sharkPlinthTop.z,
        0.55,
        1.10
      );
    }
    if (ukulele) {
      // Acoustic ukulele leaning cleanly against the front sunlit bark of the Bonfire driftwood log (zero clipping!)
      const ux = -37.20;
      const uz = -16.68;
      this.placeWholeClone(ukulele, ux, getTerrainHeight(ux, uz) - 0.01, uz, 0.18, 0.56, {
        tiltX: 0.34,
        tiltZ: -0.10
      });
    }
    if (realLifebuoy) {
      // Real weathered nautical lifebuoy hanging vertically on the handcrafted Lifeguard Rescue Post hook!
      const hp = this.lifebuoyHookPos;
      this.placeWholeClone(realLifebuoy, hp.x, hp.y, hp.z, 0.04, 0.78);
    }
    if (oceanBuoy) {
      // Real photoscanned nautical channel buoy floating & bobbing on live waves with solid hull collision!
      this.floatingBuoy = this.placeWholeClone(
        oceanBuoy,
        this.floatingBuoyPos.x,
        -0.75,
        this.floatingBuoyPos.z,
        0.4,
        2.35,
        { keepSeparateForCulling: true }
      );
      addOrientedBoxCollider(this.floatingBuoyPos.x, this.floatingBuoyPos.z, 0.58, 0.58, 0.4, -1.2, 1.8, 'channel_buoy');
    }
    if (bananas) {
      const banVars = this.extractCenteredVariants(bananas, (n) => n.includes('bananas_a'));
      if (banVars.length > 0) {
        this.placeHeightNormalizedBatch(
          banVars,
          [
            { x: -20.75, y: tikiDeckY + 1.13, z: -29.12, rx: 0, ry: 0.5, rz: 0, h: 0.13 },
            { x: this.coffeeCartDeckTop.x + 0.34, y: this.coffeeCartDeckTop.y + 1.045, z: this.coffeeCartDeckTop.z - 0.16, rx: 0, ry: -0.4, rz: 0, h: 0.12 }
          ],
          false
        );
      }
    }
    if (gazania) {
      const v = this.extractCenteredVariants(gazania, (n) => /flower_gazania_a_LOD0/.test(n));
      const planterBlooms: HSpot[] = [
        { x: -50.32, y: this.coffeeCartDeckTop.y + 0.34, z: -27.25, rx: 0, ry: 0.4, rz: 0, h: 0.48 },
        { x: -49.94, y: this.coffeeCartDeckTop.y + 0.34, z: -27.24, rx: 0, ry: 2.2, rz: 0, h: 0.44 },
        { x: 45.16, y: this.eastOverlookDeckTop.y + 0.34, z: -27.25, rx: 0, ry: 1.1, rz: 0, h: 0.48 },
        { x: 45.54, y: this.eastOverlookDeckTop.y + 0.34, z: -27.24, rx: 0, ry: 3.0, rz: 0, h: 0.44 }
      ];
      this.placeHeightNormalizedBatch(v, [...scatter(12, 0.45, 0.80, 0.02), ...planterBlooms], false);
    }
    if (ursinia) {
      const v = this.extractCenteredVariants(ursinia, (n) => /flower_ursinia_e_LOD0/.test(n));
      this.placeHeightNormalizedBatch(v, scatter(2, 0.42, 0.72, 0.02), false);
    }

    // 7. Real photoscanned conch shell tucked naturally beside west driftwood log
    if (lambisShell) {
      const shellPlacements: InstancePlacement[] = [
        [-34.2, -6.5, 0.62]
      ].map(([sx, sz, sc]) => ({
        x: sx,
        y: getTerrainHeight(sx, sz) - 0.012,
        z: sz,
        rx: 0,
        ry: rand() * Math.PI * 2,
        rz: 0,
        sx: sc,
        sy: sc,
        sz: sc
      }));
      this.placeInstancedBatch(lambisShell, shellPlacements, false);
    }

    // Batch all single-placed tables, stools, drinks, crates & lanterns by material
    mergeStaticGroupByMaterial(this.group);
  }

  private placeLanternAt(
    template: THREE.Group,
    x: number,
    y: number,
    z: number,
    scale: number
  ): void {
    const clone = template.clone(true);
    clone.scale.setScalar(scale);
    clone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(clone);
    const minY = isFinite(box.min.y) ? box.min.y : 0;
    clone.position.set(x, y - minY, z);
    this.group.add(clone);

    // Warm emissive lantern candle glow (zero PointLight shader overhead across the entire terrain!)
    const candle = new THREE.Mesh(new THREE.SphereGeometry(0.045 * scale, 7, 6), this.lanternGlowMat);
    candle.position.set(x, y + 0.16 * scale, z);
    this.group.add(candle);
    this.onLanternPlaced?.(new THREE.Vector3(x, y + 0.16 * scale, z));
  }

  public update(sunDirection: THREE.Vector3, elapsedTime = 0, waveIntensity = 1.0): void {
    const dusk = 1.0 - THREE.MathUtils.smoothstep(sunDirection.y, 0.08, 0.42);
    this.lanternGlowMat.emissiveIntensity = 0.35 + dusk * 3.2;

    if (this.floatingBuoy) {
      const bx = this.floatingBuoyPos.x;
      const bz = this.floatingBuoyPos.z;
      const h = sampleWaveHeight(bx, bz, elapsedTime, waveIntensity, -4.0);
      const hx = sampleWaveHeight(bx + 0.8, bz, elapsedTime, waveIntensity, -4.0);
      const hz = sampleWaveHeight(bx, bz + 0.8, elapsedTime, waveIntensity, -4.0);
      this.floatingBuoy.position.set(bx, h - 0.85, bz);
      this.floatingBuoy.rotation.z = -(hx - h) * 0.45;
      this.floatingBuoy.rotation.x = (hz - h) * 0.45;
      updateOrientedBoxCollider('channel_buoy', bx, bz, 0.4, h - 1.2, h + 1.65);
    }
  }
}
