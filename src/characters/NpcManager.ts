import * as THREE from 'three';
import { HumanAppearance, HumanCharacter, HumanAnimState } from './HumanRig';
import { RestSpot } from '../environment/BeachProps';
import { getBoardwalkY, PierSpot, sampleWaterSlide, TerraceTableSpot } from '../environment/CoastalLandmarks';
import { getTerrainHeight, getTerrainNormal, getWalkableSurface, resolveWorldCollisions } from '../terrain/terrainMath';
import { sampleWaveHeight } from '../ocean/wavePhysics';
import { FootprintSystem } from '../terrain/FootprintSystem';
import { UnderwaterParticles } from '../ocean/UnderwaterParticles';
import { WaterInteractionSystem } from '../ocean/WaterInteractionSystem';
import type { WaterRippleSim } from '../ocean/WaterRippleSim';
import type { SoundEngine } from '../audio/SoundEngine';

type CitizenActivityType =
  | 'beach_shower'
  | 'ocean_swim'
  | 'tiki_bar'
  | 'coffee_cart'
  | 'bonfire'
  | 'pier_lookout'
  | 'monument'
  | 'cabana'
  | 'sand_stretch'
  | 'shell_hunt'
  | 'tiki_dance'
  | 'boardwalk_stroll';

interface ActivitySlot {
  id: number;
  type: CitizenActivityType;
  x: number;
  z: number;
  faceYaw: number;
  anim: HumanAnimState;
  minDur: number;
  maxDur: number;
  onWood?: boolean;
  inWater?: boolean;
  occupantId: number; // -1 when free
}

interface NpcAgent {
  character: HumanCharacter;
  role:
    | 'citizen'
    | 'sunbathe'
    | 'lounge'
    | 'chat'
    | 'walker'
    | 'kid_ball'
    | 'swimmer'
    | 'volleyball'
    | 'bartender'
    | 'bar_patron'
    | 'terrace_diner'
    | 'lifeguard'
    | 'pier_stroller'
    | 'boardwalk_stroller'
    | 'fisher'
    | 'frisbee'
    | 'slider'
    | 'pier_diver'
    | 'jogger'
    | 'yoga'
    | 'sandcastle_kid'
    | 'shower_user'
    | 'routine'
    | 'dancer'
    | 'shell_collector'
    | 'raft_lounger'
    | 'surfer'
    | 'kayaker'
    | 'hammock'
    | 'bonfire_guest'
    | 'soccer'
    | 'coffee_barista'
    | 'coffee_guest'
    | 'patrol_lifeguard'
    | 'snorkeler'
    | 'tube_floater'
    | 'sup_boarder';
  pos: THREE.Vector3;
  yaw: number;
  velX?: number;
  velZ?: number;
  hullPitch?: number;
  hullRoll?: number;
  waypoints?: THREE.Vector2[];
  waypointIndex?: number;
  walkSpeed?: number;
  rippleTimer?: number;
  homeX?: number;
  homeZ?: number;
  sideSign?: number;
  swimCenterX?: number;
  swimCenterZ?: number;
  swimRadiusX?: number;
  swimRadiusZ?: number;
  swimPhase?: number;
  strollPhase?: number;
  lastCycleStep?: number;
  dwellTimer?: number;
  dwellDuration?: number;
  socialTimer?: number;
  socialCooldown?: number;
  socialPartnerYaw?: number;
  paddleRef?: THREE.Object3D;
  // Autonomous Utility-AI citizen fields
  activitySlotId?: number;
  activityPhase?: 'travel' | 'engage';
  activityTimer?: number;
  lastActivityType?: CitizenActivityType;
  needHeat?: number;      // rises in sun -> drives ocean_swim
  needSandiness?: number; // rises after swim/sand -> drives beach_shower!
  needThirst?: number;    // drives tiki_bar / coffee_cart
  needSocial?: number;    // drives bonfire / tiki_dance / boardwalk_stroll
  needCuriosity?: number; // drives pier_lookout / monument / shell_hunt
  // Active Stuck-Detector fields (prevents ANY walking NPC from ever getting stuck!)
  stuckCheckTimer?: number;
  stuckLastX?: number;
  stuckLastZ?: number;
  stuckEscapeTimer?: number;
  stuckEscapeSign?: number;
  stuckStrikes?: number;
}

export interface NpcLandmarkAnchors {
  bartenderSpot: { x: number; y: number; z: number; yaw: number };
  lifeguardSpot: { x: number; y: number; z: number; yaw: number };
  barStoolSpots: Array<{ x: number; y: number; z: number; yaw: number }>;
  patioTerraceSpots: TerraceTableSpot[];
  picnicTerraceSpots: TerraceTableSpot[];
  pierFisherSpots: PierSpot[];
  waterBeachBall: THREE.Mesh;
  beachFrisbee: THREE.Mesh;
  hammockSpots?: Array<{ x: number; y: number; z: number; yaw: number }>;
  coffeeCartDeckTop?: THREE.Vector3;
  eastOverlookDeckTop?: THREE.Vector3;
  soccerBall?: THREE.Mesh;
}

/**
 * Populates Neon Cove with 48 lively, distinct human NPCs performing authentic coastal activities:
 *  - 2 Kids playing beach ball in surf + 2 Kids sculpting the sandcastle
 *  - 4 Adult Swimmers + 2 Pier Divers jumping & splashing off Ocean Pier + 3 Water Slide riders
 *  - 2 Beach Volleyball Players + 2 East-Beach Frisbee Players + 2 Shoreline Joggers + 2 Yoga Stretchers
 *  - 1 Bartender + 3 Bar Patrons + 5 Patio & Picnic Diners + 1 Rinse Shower user
 *  - 2 Surf Browsers, 1 Lifeguard, 2 Pier Fishermen, Pier/Boardwalk Strollers, Walkers, Sunbathers & Loungers
 */
export class NpcManager {
  public readonly group = new THREE.Group();
  public readonly landGroup = new THREE.Group();
  public readonly waterGroup = new THREE.Group();
  public readonly agents: NpcAgent[] = [];
  private readonly waterBeachBall: THREE.Mesh;
  private readonly beachFrisbee: THREE.Mesh;
  private lastBeachBallHalf = -1;
  private readonly _slidePos = new THREE.Vector3();
  private readonly _slideTan = new THREE.Vector3();
  private readonly _tmpNorm = new THREE.Vector3();
  private readonly _upVec = new THREE.Vector3(0, 1, 0);
  private readonly _alignQ = new THREE.Quaternion();
  private readonly _yawQ = new THREE.Quaternion();
  private patrolLifeguardAgent: NpcAgent | null = null;
  private lastLifeguardWhistleAt = -10;
  private readonly activitySlots: ActivitySlot[] = [];

  public getPatrolLifeguardPos(): THREE.Vector3 | null {
    return this.patrolLifeguardAgent ? this.patrolLifeguardAgent.pos : null;
  }

  public getPathingDiagnostics(): {
    citizenCount: number;
    travelingCount: number;
    engagingCount: number;
    showerOccupied: boolean;
    showerOccupantPos: [number, number, number] | null;
    maxStuckStrikes: number;
    offshoreWaterCount: number;
    kayakerCount: number;
    citizens: Array<{ idx: number; phase: string; slotType: string; x: number; z: number; speed: number; strikes: number }>;
  } {
    let citizenCount = 0;
    let travelingCount = 0;
    let engagingCount = 0;
    let maxStuckStrikes = 0;
    let offshoreWaterCount = 0;
    let kayakerCount = 0;
    let showerOccupantPos: [number, number, number] | null = null;
    const citizens: Array<{ idx: number; phase: string; slotType: string; x: number; z: number; speed: number; strikes: number }> = [];

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (a.role === 'kayaker') kayakerCount++;
      if (a.pos.z >= 14.0 && (a.role === 'swimmer' || a.role === 'snorkeler' || a.role === 'kayaker' || a.role === 'surfer' || a.role === 'sup_boarder' || a.role === 'tube_floater')) {
        offshoreWaterCount++;
      }
      if (a.role !== 'citizen') continue;
      citizenCount++;
      const slot = a.activitySlotId !== undefined && a.activitySlotId >= 0 ? this.activitySlots[a.activitySlotId] : null;
      if (a.activityPhase === 'travel') travelingCount++;
      else engagingCount++;
      if (slot?.type === 'beach_shower' && a.activityPhase === 'engage') {
        showerOccupantPos = [a.pos.x, a.pos.y, a.pos.z];
      }
      const strikes = a.stuckStrikes ?? 0;
      if (strikes > maxStuckStrikes) maxStuckStrikes = strikes;
      citizens.push({
        idx: i,
        phase: a.activityPhase ?? 'unknown',
        slotType: slot?.type ?? 'none',
        x: Number(a.pos.x.toFixed(2)),
        z: Number(a.pos.z.toFixed(2)),
        speed: Number(Math.hypot(a.velX ?? 0, a.velZ ?? 0).toFixed(2)),
        strikes
      });
    }
    return {
      citizenCount,
      travelingCount,
      engagingCount,
      showerOccupied: this.isShowerOccupied(),
      showerOccupantPos,
      maxStuckStrikes,
      offshoreWaterCount,
      kayakerCount,
      citizens
    };
  }

  public isShowerOccupied(): boolean {
    for (let i = 0; i < this.activitySlots.length; i++) {
      const s = this.activitySlots[i];
      if (s.type === 'beach_shower' && s.occupantId >= 0) {
        const ag = this.agents[s.occupantId];
        if (ag && ag.activityPhase === 'engage') return true;
      }
    }
    return false;
  }

  /**
   * Feeds the closest active water NPCs, kayaks, surfers, floaters, snorkelers & wading citizens
   * into the real-time GPU 2D Wave-Equation Ripple Simulation!
   */
  public feedWaterBodies(rippleSim: WaterRippleSim, playerPos: THREE.Vector3, elapsedTime: number, waveIntensity: number): void {
    const candidates: Array<{ distSq: number; x: number; z: number; vx: number; vz: number; radius: number; strength: number }> = [];
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      const dx = a.pos.x - playerPos.x;
      const dz = a.pos.z - playerPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 22.0 * 22.0) continue;

      const isCraft = a.role === 'kayaker' || a.role === 'surfer' || a.role === 'sup_boarder' || a.role === 'tube_floater';
      const isSwimmer = a.role === 'swimmer' || a.role === 'snorkeler' || a.role === 'kid_ball';
      let active = isCraft || isSwimmer;
      let rad = 0.34;
      let str = 0.85;

      if (isCraft) {
        rad = a.role === 'kayaker' ? 0.56 : 0.48;
        str = 1.10;
      } else if (!active) {
        const gH = getTerrainHeight(a.pos.x, a.pos.z);
        const wH = sampleWaveHeight(a.pos.x, a.pos.z, elapsedTime, waveIntensity, gH);
        const depth = wH - gH;
        if (depth > 0.06 && a.pos.y <= wH + 0.15) {
          active = true;
          rad = 0.30;
          str = THREE.MathUtils.clamp(0.35 + depth * 0.75, 0.35, 1.0);
        }
      }
      if (!active) continue;
      candidates.push({
        distSq: d2,
        x: a.pos.x,
        z: a.pos.z,
        vx: a.velX ?? 0,
        vz: a.velZ ?? 0,
        radius: rad,
        strength: str
      });
    }
    candidates.sort((a, b) => a.distSq - b.distSq);
    const maxN = Math.min(11, candidates.length);
    for (let i = 0; i < maxN; i++) {
      const c = candidates[i];
      rippleSim.addBody(c.x, c.z, c.vx, c.vz, c.radius, c.strength);
      if (i < 4) {
        rippleSim.setNearestNpcBody(i, c.x, c.z, c.radius, c.strength);
      }
    }
  }

  constructor(restSpots: RestSpot[], anchors: NpcLandmarkAnchors) {
    this.group.name = 'BeachNPCs';
    this.landGroup.name = 'BeachLandNPCs';
    this.waterGroup.name = 'BeachWaterNPCs';
    this.group.add(this.landGroup, this.waterGroup);
    this.waterBeachBall = anchors.waterBeachBall;
    this.beachFrisbee = anchors.beachFrisbee;

    const makeChar = (app: HumanAppearance, x: number, y: number, z: number, yaw: number, isWater = false, noShadow = false) => {
      const char = new HumanCharacter({ ...app, useWaterCaustics: isWater });
      char.root.position.set(x, y, z);
      char.root.rotation.y = yaw;
      if (noShadow) {
        char.root.traverse((o) => {
          if (o instanceof THREE.Mesh) o.castShadow = false;
        });
      }
      (isWater ? this.waterGroup : this.landGroup).add(char.root);
      return char;
    };

    const towels = restSpots.filter((s) => s.kind === 'towel');
    const chairs = restSpots.filter((s) => s.kind === 'chair');

    // 1. THREE Sunbathers on beach towels across the bay
    const sunbatherApps: HumanAppearance[] = [
      { gender: 'female', height: 1.68, skinHex: 0xe6b38f, hairHex: 0x3b2417, hairStyle: 'long_wavy', outfitStyle: 'bikini', primaryColor: 0xe85d56, secondaryColor: 0xe85d56, sunglasses: true },
      { gender: 'male', height: 1.80, skinHex: 0x8a5534, hairHex: 0x181412, hairStyle: 'short_crop', outfitStyle: 'boardshorts', primaryColor: 0x2299a8, secondaryColor: 0xf4d35e, sunglasses: true },
      { gender: 'female', height: 1.65, skinHex: 0xc98f66, hairHex: 0x201510, hairStyle: 'top_bun', outfitStyle: 'bikini', primaryColor: 0xf4a261, secondaryColor: 0xf4a261, sunglasses: true }
    ];
    const towelIndices = [1, 2, 4];
    for (let i = 0; i < sunbatherApps.length; i++) {
      const spot = towels[towelIndices[i]] ?? towels[i] ?? { position: new THREE.Vector3(-18 + i * 24, getTerrainHeight(-18 + i * 24, -14), -14), yaw: 0 };
      const pos = spot.position.clone();
      const char = makeChar(sunbatherApps[i], pos.x, pos.y, pos.z, spot.yaw, false, true);
      this.agents.push({ character: char, role: 'sunbathe', pos, yaw: spot.yaw });
    }

    // 2. TWO Reclining Loungers on wooden beach lounge chairs
    const loungerSpecs: Array<{ idx: number; app: HumanAppearance }> = [
      {
        idx: 1,
        app: { gender: 'female', height: 1.66, skinHex: 0xf1c7a6, hairHex: 0xd9a85b, hairStyle: 'top_bun', outfitStyle: 'onepiece', primaryColor: 0x1d6f8a, secondaryColor: 0xffffff, sunglasses: true, sunHat: true }
      },
      {
        idx: 3,
        app: { gender: 'male', height: 1.81, skinHex: 0xd49a73, hairHex: 0x452b18, hairStyle: 'surfer_waves', outfitStyle: 'boardshorts', primaryColor: 0xe76f51, secondaryColor: 0xffffff, sunglasses: true }
      }
    ];
    for (const ls of loungerSpecs) {
      const chairSpot = chairs[ls.idx] ?? chairs[0];
      if (!chairSpot) continue;
      const chairPos = chairSpot.position.clone();
      // Shift lounger slightly back toward backrest/pillow so pelvis & shoulders nestle onto cushion!
      chairPos.x -= Math.sin(chairSpot.yaw) * 0.08;
      chairPos.z -= Math.cos(chairSpot.yaw) * 0.08;
      const lounger = makeChar(ls.app, chairPos.x, chairPos.y, chairPos.z, chairSpot.yaw, false, true);
      this.agents.push({ character: lounger, role: 'lounge', pos: chairPos, yaw: chairSpot.yaw });
    }

    // 3. Chatting beach couple near shoreline + Surf Shop Browsers beside the Neon Tiki Surf Rack!
    const addChatPair = (
      ax: number, ay: number, az: number, appA: HumanAppearance,
      bx: number, by: number, bz: number, appB: HumanAppearance
    ) => {
      const pA = new THREE.Vector3(ax, ay, az);
      const pB = new THREE.Vector3(bx, by, bz);
      const yawA = Math.atan2(pB.x - pA.x, pB.z - pA.z);
      const yawB = Math.atan2(pA.x - pB.x, pA.z - pB.z);
      this.agents.push({ character: makeChar(appA, pA.x, pA.y, pA.z, yawA), role: 'chat', pos: pA, yaw: yawA });
      this.agents.push({ character: makeChar(appB, pB.x, pB.y, pB.z, yawB), role: 'chat', pos: pB, yaw: yawB });
    };

    // Shoreline couple
    addChatPair(
      -8.5, getTerrainHeight(-8.5, -5.2), -5.2,
      { gender: 'male', height: 1.82, skinHex: 0xd1956b, hairHex: 0x261a14, hairStyle: 'surfer_waves', outfitStyle: 'linen_shirt', primaryColor: 0x2b4c7e, secondaryColor: 0xf8f3e8 },
      -7.3, getTerrainHeight(-7.3, -4.8), -4.8,
      { gender: 'female', height: 1.70, skinHex: 0x623b24, hairHex: 0x141010, hairStyle: 'curly_crown', outfitStyle: 'bikini', primaryColor: 0xf4a236, secondaryColor: 0xf4a236, sunHat: true }
    );

    // Surf Shop Browsers chatting cleanly on the wooden boardwalk beside the Neon Tiki Surfboard Rack!
    addChatPair(
      -15.6, getBoardwalkY(-15.6), -25.4,
      { gender: 'male', height: 1.79, skinHex: 0xe6b48e, hairHex: 0xb8863e, hairStyle: 'surfer_waves', outfitStyle: 'rashguard', primaryColor: 0x0e7490, secondaryColor: 0x38e2d8, sunglasses: true },
      -14.3, getBoardwalkY(-14.3), -25.6,
      { gender: 'female', height: 1.68, skinHex: 0xb87c54, hairHex: 0x231712, hairStyle: 'ponytail', outfitStyle: 'bikini', primaryColor: 0x2a9d8f, secondaryColor: 0x2a9d8f }
    );

    // 4. Three Shoreline Walkers & Joggers (leaving realistic 27cm sand footprints!)
    const walkerApps: HumanAppearance[] = [
      { gender: 'female', height: 1.71, skinHex: 0xbc7c52, hairHex: 0x4f2c1a, hairStyle: 'ponytail', outfitStyle: 'onepiece', primaryColor: 0xdf586b, secondaryColor: 0xfff5ec },
      { gender: 'male', height: 1.78, skinHex: 0xedc09d, hairHex: 0x6b4b2c, hairStyle: 'short_crop', outfitStyle: 'boardshorts', primaryColor: 0x2f8f6b, secondaryColor: 0xffe08a },
      { gender: 'male', height: 1.76, skinHex: 0xa46842, hairHex: 0x1c1715, hairStyle: 'curly_crown', outfitStyle: 'rashguard', primaryColor: 0x1f5c99, secondaryColor: 0x35d6c8 }
    ];
    const patrolPaths: THREE.Vector2[][] = [
      [new THREE.Vector2(-32, -5.5), new THREE.Vector2(-12, -2.5), new THREE.Vector2(4, 2.2), new THREE.Vector2(14, -2.8), new THREE.Vector2(-6, -8.0), new THREE.Vector2(-24, -8.5)],
      [new THREE.Vector2(36, -5.0), new THREE.Vector2(15, -2.4), new THREE.Vector2(-4, 2.6), new THREE.Vector2(-18, -1.5), new THREE.Vector2(-8, -7.2), new THREE.Vector2(12, -7.8)],
      [new THREE.Vector2(-20, -9.2), new THREE.Vector2(-2, -4.5), new THREE.Vector2(11, -3.5), new THREE.Vector2(14, -8.8), new THREE.Vector2(-10, -10.5)]
    ];
    for (let i = 0; i < 3; i++) {
      const path = patrolPaths[i];
      const start = path[0];
      const next = path[1];
      const pos = new THREE.Vector3(start.x, getTerrainHeight(start.x, start.y), start.y);
      const yaw = Math.atan2(next.x - start.x, next.y - start.y);
      this.agents.push({
        character: makeChar(walkerApps[i], pos.x, pos.y, pos.z, yaw, true),
        role: 'walker',
        pos,
        yaw,
        waypoints: path,
        waypointIndex: 1,
        walkSpeed: i === 2 ? 2.65 : 1.42 + i * 0.12,
        rippleTimer: 0
      });
    }

    // 5. TWO ACTIVE KIDS PLAYING BEACH BALL IN THE SHALLOW SURF!
    const kidApps: HumanAppearance[] = [
      { gender: 'female', height: 1.38, skinHex: 0xdeab85, hairHex: 0x3b2314, hairStyle: 'ponytail', outfitStyle: 'onepiece', primaryColor: 0xff6b81, secondaryColor: 0xfff3d6 },
      { gender: 'male', height: 1.42, skinHex: 0x9c623d, hairHex: 0x181412, hairStyle: 'short_crop', outfitStyle: 'boardshorts', primaryColor: 0x2ec4b6, secondaryColor: 0xffbf69 }
    ];
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1;
      const hx = -6.0 + side * 2.5;
      const hz = 6.8 + side * 0.6;
      const pos = new THREE.Vector3(hx, getTerrainHeight(hx, hz), hz);
      const yaw = side < 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
      this.agents.push({
        character: makeChar(kidApps[k], pos.x, pos.y, pos.z, yaw, true),
        role: 'kid_ball',
        pos,
        yaw,
        homeX: hx,
        homeZ: hz,
        sideSign: side,
        rippleTimer: k * 0.35
      });
    }

    // 6. FOUR ADULT SWIMMERS DOING ACTIVE FREESTYLE LAPS IN THE BAY!
    const swimmerSpecs: Array<{ cx: number; cz: number; rx: number; rz: number; phase: number; app: HumanAppearance }> = [
      {
        cx: -10, cz: 17.5, rx: 7.5, rz: 3.4, phase: 0.2,
        app: { gender: 'male', height: 1.80, skinHex: 0xc98c63, hairHex: 0x221710, hairStyle: 'short_crop', outfitStyle: 'boardshorts', primaryColor: 0xff6b35, secondaryColor: 0xffffff }
      },
      {
        cx: 6.5, cz: 19.5, rx: 6.8, rz: 3.8, phase: 2.4,
        app: { gender: 'female', height: 1.72, skinHex: 0xeac0a0, hairHex: 0x5c361c, hairStyle: 'top_bun', outfitStyle: 'onepiece', primaryColor: 0x118ab2, secondaryColor: 0x38e2d8 }
      },
      {
        cx: 33.0, cz: 17.0, rx: 6.2, rz: 3.2, phase: 4.5,
        app: { gender: 'male', height: 1.77, skinHex: 0x73462a, hairHex: 0x14100f, hairStyle: 'curly_crown', outfitStyle: 'rashguard', primaryColor: 0x2a9d8f, secondaryColor: 0xe9c46a }
      },
      {
        cx: -27.5, cz: 16.5, rx: 5.8, rz: 3.1, phase: 1.3,
        app: { gender: 'female', height: 1.69, skinHex: 0xdda984, hairHex: 0x3b2214, hairStyle: 'ponytail', outfitStyle: 'onepiece', primaryColor: 0xe63946, secondaryColor: 0xffe5ec }
      }
    ];
    for (const sw of swimmerSpecs) {
      const pos = new THREE.Vector3(sw.cx + Math.cos(sw.phase) * sw.rx, -1.0, sw.cz + Math.sin(sw.phase) * sw.rz);
      this.agents.push({
        character: makeChar(sw.app, pos.x, pos.y, pos.z, 0, true),
        role: 'swimmer',
        pos,
        yaw: 0,
        swimCenterX: sw.cx,
        swimCenterZ: sw.cz,
        swimRadiusX: sw.rx,
        swimRadiusZ: sw.rz,
        swimPhase: sw.phase,
        rippleTimer: Math.random() * 0.5
      });
    }

    // 7. TWO BEACH VOLLEYBALL PLAYERS RALLYING ON THE SAND COURT (x=5, z=-14.5)
    const vbApps: HumanAppearance[] = [
      { gender: 'male', height: 1.84, skinHex: 0xd9a17a, hairHex: 0xc49548, hairStyle: 'surfer_waves', outfitStyle: 'boardshorts', primaryColor: 0xef476f, secondaryColor: 0xffffff, sunglasses: true },
      { gender: 'female', height: 1.73, skinHex: 0xb2744a, hairHex: 0x201510, hairStyle: 'ponytail', outfitStyle: 'bikini', primaryColor: 0x06d6a0, secondaryColor: 0x06d6a0 }
    ];
    for (let v = 0; v < 2; v++) {
      const side = v === 0 ? 1 : -1;
      const vx = 5.0;
      const vz = -14.5 + side * 3.0;
      const pos = new THREE.Vector3(vx, getTerrainHeight(vx, vz), vz);
      const yaw = side > 0 ? Math.PI : 0;
      this.agents.push({
        character: makeChar(vbApps[v], pos.x, pos.y, pos.z, yaw),
        role: 'volleyball',
        pos,
        yaw,
        homeX: vx,
        homeZ: vz,
        sideSign: side
      });
    }

    // 8. BARTENDER BEHIND THE NEON TIKI SURF BAR + 2 SEATED BAR PATRONS
    const bt = anchors.bartenderSpot;
    this.agents.push({
      character: makeChar(
        { gender: 'male', height: 1.79, skinHex: 0xbd7f54, hairHex: 0x1d1612, hairStyle: 'surfer_waves', outfitStyle: 'linen_shirt', primaryColor: 0x1b4965, secondaryColor: 0xffd166 },
        bt.x, bt.y, bt.z, bt.yaw, false, true
      ),
      role: 'bartender', pos: new THREE.Vector3(bt.x, bt.y, bt.z), yaw: bt.yaw
    });

    const patronApps: HumanAppearance[] = [
      { gender: 'female', height: 1.67, skinHex: 0xf0c6a4, hairHex: 0x7c4324, hairStyle: 'long_wavy', outfitStyle: 'bikini', primaryColor: 0x38b6ff, secondaryColor: 0x38b6ff, sunHat: true },
      { gender: 'male', height: 1.81, skinHex: 0x8d5836, hairHex: 0x161210, hairStyle: 'short_crop', outfitStyle: 'linen_shirt', primaryColor: 0x264653, secondaryColor: 0xf4a261, sunglasses: true },
      { gender: 'female', height: 1.71, skinHex: 0xcaa07a, hairHex: 0x2a1810, hairStyle: 'top_bun', outfitStyle: 'onepiece', primaryColor: 0xff6b6b, secondaryColor: 0xffe66d, sunglasses: true }
    ];
    for (const idx of [0, 2, 1]) {
      if (idx >= anchors.barStoolSpots.length) continue;
      const sp = anchors.barStoolSpots[idx];
      const pos = new THREE.Vector3(sp.x, sp.y, sp.z);
      const app = patronApps[idx === 0 ? 0 : idx === 2 ? 1 : 2];
      this.agents.push({
        character: makeChar(app, pos.x, pos.y, pos.z, sp.yaw, false, true),
        role: 'bar_patron', pos, yaw: sp.yaw
      });
    }

    // 9. FIVE SEATED PATIO & PICNIC TERRACE DINERS (exact measured chair/bench seats!)
    const patioDinerApps: HumanAppearance[] = [
      { gender: 'female', height: 1.68, skinHex: 0xe3b18c, hairHex: 0x2f1e14, hairStyle: 'long_wavy', outfitStyle: 'linen_shirt', primaryColor: 0xe76f51, secondaryColor: 0xfff8ed, sunglasses: true },
      { gender: 'male', height: 1.80, skinHex: 0x9c6540, hairHex: 0x171311, hairStyle: 'short_crop', outfitStyle: 'linen_shirt', primaryColor: 0x2a9d8f, secondaryColor: 0xf6f4ee },
      { gender: 'female', height: 1.70, skinHex: 0xf1c9a8, hairHex: 0xc28f42, hairStyle: 'ponytail', outfitStyle: 'onepiece', primaryColor: 0xf4a261, secondaryColor: 0xffffff, sunHat: true },
      { gender: 'male', height: 1.78, skinHex: 0xc88d65, hairHex: 0x2b1d14, hairStyle: 'curly_crown', outfitStyle: 'linen_shirt', primaryColor: 0x3a6ea5, secondaryColor: 0xfff4e0 },
      { gender: 'male', height: 1.77, skinHex: 0xb0744e, hairHex: 0x1c1410, hairStyle: 'surfer_waves', outfitStyle: 'linen_shirt', primaryColor: 0x219ebc, secondaryColor: 0xf8f9fa, sunglasses: true }
    ];

    // Place 2 diners facing each other on Center Patio Terrace (`patioTerraceSpots[0]`)
    if (anchors.patioTerraceSpots.length > 0) {
      const sp = anchors.patioTerraceSpots[0];
      const cosY = Math.cos(sp.yaw);
      const sinY = Math.sin(sp.yaw);
      const toW = (lx: number, lz: number): [number, number] => [
        sp.x + lx * cosY + lz * sinY,
        sp.z - lx * sinY + lz * cosY
      ];
      // Chair 1 center (-0.11, +0.58) facing -Z toward table; Chair 2 center (+0.07, -0.53) facing +Z
      const [c1x, c1z] = toW(-0.11, 0.56);
      const [c2x, c2z] = toW(0.07, -0.51);
      const yaw1 = sp.yaw + Math.PI;
      const yaw2 = sp.yaw;
      this.agents.push({
        character: makeChar(patioDinerApps[0], c1x, sp.y, c1z, yaw1, false, true),
        role: 'terrace_diner', pos: new THREE.Vector3(c1x, sp.y, c1z), yaw: yaw1
      });
      this.agents.push({
        character: makeChar(patioDinerApps[1], c2x, sp.y, c2z, yaw2, false, true),
        role: 'terrace_diner', pos: new THREE.Vector3(c2x, sp.y, c2z), yaw: yaw2
      });
    }

    // Place 1 diner on East Café Patio Terrace (`patioTerraceSpots[1]`)
    if (anchors.patioTerraceSpots.length > 1) {
      const sp = anchors.patioTerraceSpots[1];
      const cosY = Math.cos(sp.yaw);
      const sinY = Math.sin(sp.yaw);
      const c2x = sp.x + 0.07 * cosY - 0.51 * sinY;
      const c2z = sp.z - 0.07 * sinY - 0.51 * cosY;
      this.agents.push({
        character: makeChar(patioDinerApps[2], c2x, sp.y, c2z, sp.yaw, false, true),
        role: 'terrace_diner', pos: new THREE.Vector3(c2x, sp.y, c2z), yaw: sp.yaw
      });
    }

    // Place 1 extra diner on East Café Patio Terrace table 2 (`patioTerraceSpots[2]`)
    if (anchors.patioTerraceSpots.length > 2) {
      const sp = anchors.patioTerraceSpots[2];
      const cosY = Math.cos(sp.yaw);
      const sinY = Math.sin(sp.yaw);
      const c1x = sp.x + (-0.11) * cosY + 0.56 * sinY;
      const c1z = sp.z - (-0.11) * sinY + 0.56 * cosY;
      const yaw1 = sp.yaw + Math.PI;
      this.agents.push({
        character: makeChar(patioDinerApps[4], c1x, sp.y, c1z, yaw1, false, true),
        role: 'terrace_diner', pos: new THREE.Vector3(c1x, sp.y, c1z), yaw: yaw1
      });
    }

    // Place 1 diner seated on the West Picnic Terrace bench (`picnicTerraceSpots[0]`, rotated PI/2 -> benches at z +/- 0.84)
    if (anchors.picnicTerraceSpots.length > 0) {
      const sp = anchors.picnicTerraceSpots[0];
      const bx = sp.x - 0.35;
      const bz = sp.z - 0.84; // North bench facing south (+Z) toward the ocean & table!
      this.agents.push({
        character: makeChar(patioDinerApps[3], bx, sp.y, bz, 0, false, true),
        role: 'terrace_diner', pos: new THREE.Vector3(bx, sp.y, bz), yaw: 0
      });
    }

    // 10. LIFEGUARD #1 ON WATCHTOWER BALCONY (Full authentic Lifeguard Kit: cross, visor, whistle & rescue buoy!)
    const lg = anchors.lifeguardSpot;
    this.agents.push({
      character: makeChar(
        { gender: 'male', height: 1.83, skinHex: 0xd69b72, hairHex: 0xd4a448, hairStyle: 'short_crop', outfitStyle: 'rashguard', primaryColor: 0xe63946, secondaryColor: 0xffffff, sunglasses: true, isLifeguard: true, watch: true },
        lg.x, lg.y, lg.z, lg.yaw
      ),
      role: 'lifeguard', pos: new THREE.Vector3(lg.x, lg.y, lg.z), yaw: lg.yaw
    });

    // 11. STROLLER WALKING CLEANLY ALONG THE 28m WOODEN OCEAN PIER!
    const pierStart = new THREE.Vector3(22.0, getWalkableSurface(22.0, 2.0, 2.2).y, 2.0);
    this.agents.push({
      character: makeChar(
        { gender: 'female', height: 1.69, skinHex: 0xe2b18d, hairHex: 0x331f14, hairStyle: 'long_wavy', outfitStyle: 'linen_shirt', primaryColor: 0x2b6cb0, secondaryColor: 0xfff5eb, sunHat: true, sandals: true, necklace: true },
        pierStart.x, pierStart.y, pierStart.z, 0
      ),
      role: 'pier_stroller',
      pos: pierStart,
      yaw: 0,
      walkSpeed: 1.25
    });

    // 12. BOARDWALK PROMENADE STROLLER WALKING CLEANLY ALONG THE WOODEN BOARDWALK!
    const bwX = 2.0;
    const bwPos = new THREE.Vector3(bwX, getBoardwalkY(bwX), -24.7);
    this.agents.push({
      character: makeChar(
        { gender: 'female', height: 1.71, skinHex: 0x995e3b, hairHex: 0x161210, hairStyle: 'curly_crown', outfitStyle: 'linen_shirt', primaryColor: 0xffb703, secondaryColor: 0xffffff, sunglasses: true, sandals: true, necklace: true },
        bwPos.x, bwPos.y, bwPos.z, Math.PI * 0.5
      ),
      role: 'boardwalk_stroller',
      pos: bwPos,
      yaw: Math.PI * 0.5,
      strollPhase: 0.4
    });

    // 13. TWO PIER FISHERMEN CASTING FISHING RODS OFF THE 28m OCEAN PIER!
    const fisherApps: HumanAppearance[] = [
      { gender: 'male', height: 1.79, skinHex: 0xc98f66, hairHex: 0x453224, hairStyle: 'short_crop', outfitStyle: 'linen_shirt', primaryColor: 0x3b6e8c, secondaryColor: 0xf4efe6, sunHat: true, sandals: true, watch: true },
      { gender: 'male', height: 1.75, skinHex: 0x8e5736, hairHex: 0x1c1714, hairStyle: 'curly_crown', outfitStyle: 'rashguard', primaryColor: 0x2a6f5e, secondaryColor: 0xffd166, sunglasses: true, baseballCap: true, sandals: true }
    ];
    const rodMat = new THREE.MeshStandardMaterial({ color: 0x2c343b, roughness: 0.42 });
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xd8f3ff, transparent: true, opacity: 0.55 });
    for (let f = 0; f < anchors.pierFisherSpots.length && f < fisherApps.length; f++) {
      const sp = anchors.pierFisherSpots[f];
      const char = makeChar(fisherApps[f], sp.x, sp.y, sp.z, sp.yaw);
      // Attach sculpted fishing rod + taut fishing line extending down into the turquoise ocean!
      const rodGroup = new THREE.Group();
      rodGroup.position.set(0.22, 1.08, 0.28);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.018, 2.35, 6), rodMat);
      rod.rotation.x = Math.PI * 0.36;
      rod.position.set(0, 0.48, 0.96);
      rodGroup.add(rod);
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 3.2, 4), lineMat);
      line.position.set(0, -0.58, 2.02);
      rodGroup.add(line);
      char.root.add(rodGroup);

      this.agents.push({
        character: char,
        role: 'fisher',
        pos: new THREE.Vector3(sp.x, sp.y, sp.z),
        yaw: sp.yaw
      });
    }

    // 14. TWO EAST-BEACH FRISBEE PLAYERS TOSSING A SPINNING FRISBEE ON THE SUNLIT SAND!
    const frisbeeApps: HumanAppearance[] = [
      { gender: 'male', height: 1.80, skinHex: 0xdda780, hairHex: 0x6b4728, hairStyle: 'surfer_waves', outfitStyle: 'boardshorts', primaryColor: 0xff9f1c, secondaryColor: 0xffffff, sunglasses: true },
      { gender: 'female', height: 1.68, skinHex: 0xb87b52, hairHex: 0x1d1410, hairStyle: 'ponytail', outfitStyle: 'bikini', primaryColor: 0x3a86ff, secondaryColor: 0x3a86ff }
    ];
    for (let fr = 0; fr < 2; fr++) {
      const side = fr === 0 ? -1 : 1;
      const fx = 38.0 + side * 4.4;
      const fz = -7.8;
      const fPos = new THREE.Vector3(fx, getTerrainHeight(fx, fz), fz);
      const yaw = side < 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
      this.agents.push({
        character: makeChar(frisbeeApps[fr], fPos.x, fPos.y, fPos.z, yaw),
        role: 'frisbee',
        pos: fPos,
        yaw,
        homeX: fx,
        homeZ: fz,
        sideSign: side
      });
    }

    // 15. THREE WATER SLIDE RIDERS CLIMBING, SLIDING & SPLASHING INTO SURF!
    const sliderApps: HumanAppearance[] = [
      { gender: 'male', height: 1.72, skinHex: 0xdfa983, hairHex: 0x3b2416, hairStyle: 'surfer_waves', outfitStyle: 'boardshorts', primaryColor: 0xff595e, secondaryColor: 0xffca3a },
      { gender: 'female', height: 1.64, skinHex: 0xc28258, hairHex: 0x1b1410, hairStyle: 'ponytail', outfitStyle: 'onepiece', primaryColor: 0x3a86ff, secondaryColor: 0xffffff },
      { gender: 'male', height: 1.48, skinHex: 0x9b6440, hairHex: 0x161210, hairStyle: 'short_crop', outfitStyle: 'boardshorts', primaryColor: 0x06d6a0, secondaryColor: 0xffffff }
    ];
    for (let s = 0; s < 3; s++) {
      const sp = new THREE.Vector3(-22.0, getTerrainHeight(-22.0, -4.6), -4.6);
      this.agents.push({
        character: makeChar(sliderApps[s], sp.x, sp.y, sp.z, 0, true),
        role: 'slider',
        pos: sp,
        yaw: 0,
        strollPhase: s / 3,
        lastCycleStep: -1,
        rippleTimer: s * 0.25
      });
    }

    // 16. TWO PIER DIVERS RUNNING & JUMPING OFF OCEAN PIER INTO TURQUOISE SEA!
    const diverApps: HumanAppearance[] = [
      { gender: 'male', height: 1.81, skinHex: 0xd8a079, hairHex: 0x261a12, hairStyle: 'short_crop', outfitStyle: 'boardshorts', primaryColor: 0x00bbf9, secondaryColor: 0xffffff },
      { gender: 'female', height: 1.70, skinHex: 0xa46c44, hairHex: 0x181310, hairStyle: 'top_bun', outfitStyle: 'onepiece', primaryColor: 0xf15bb5, secondaryColor: 0xfff3d6 }
    ];
    for (let d = 0; d < 2; d++) {
      const side = d === 0 ? -1 : 1;
      const dx = side < 0 ? 20.85 : 22.65;
      const dp = new THREE.Vector3(dx, getWalkableSurface(dx, 2.0, 2.5).y, 2.0);
      this.agents.push({
        character: makeChar(diverApps[d], dp.x, dp.y, dp.z, 0, true),
        role: 'pier_diver',
        pos: dp,
        yaw: 0,
        sideSign: side,
        homeX: dx,
        strollPhase: d === 0 ? 0.12 : 0.62,
        lastCycleStep: -1,
        rippleTimer: d * 0.3
      });
    }

    // 17. TWO SHORELINE JOGGERS RUNNING ALONG WET WATERLINE!
    const joggerApps: HumanAppearance[] = [
      { gender: 'female', height: 1.69, skinHex: 0xefc2a0, hairHex: 0x7b4725, hairStyle: 'ponytail', outfitStyle: 'rashguard', primaryColor: 0xff6b6b, secondaryColor: 0xffffff },
      { gender: 'male', height: 1.82, skinHex: 0x855233, hairHex: 0x151210, hairStyle: 'short_crop', outfitStyle: 'boardshorts', primaryColor: 0x118ab2, secondaryColor: 0xffd166 }
    ];
    for (let j = 0; j < 2; j++) {
      const jx = j === 0 ? -24.0 : 28.0;
      const bayZ = 0.0014 * jx * jx - 1.25 * Math.sin(jx * 0.036) - 0.55 * Math.cos(jx * 0.075) - 1.8;
      const jp = new THREE.Vector3(jx, getTerrainHeight(jx, bayZ), bayZ);
      this.agents.push({
        character: makeChar(joggerApps[j], jp.x, jp.y, jp.z, j === 0 ? Math.PI * 0.5 : -Math.PI * 0.5),
        role: 'jogger',
        pos: jp,
        yaw: j === 0 ? Math.PI * 0.5 : -Math.PI * 0.5,
        strollPhase: j === 0 ? 0.15 : 0.65
      });
    }

    // 18. TWO EAST-BEACH YOGA STRETCHERS ON WOVEN MATS!
    const yogaApps: HumanAppearance[] = [
      { gender: 'female', height: 1.67, skinHex: 0xe6b591, hairHex: 0x2c1b12, hairStyle: 'top_bun', outfitStyle: 'onepiece', primaryColor: 0x2ec4b6, secondaryColor: 0xffffff },
      { gender: 'female', height: 1.71, skinHex: 0xb67b54, hairHex: 0x181310, hairStyle: 'long_wavy', outfitStyle: 'bikini', primaryColor: 0xe76f51, secondaryColor: 0xf4f1de }
    ];
    const yogaCoords: Array<[number, number, number]> = [
      [28.5, -16.5, 0.08],
      [30.5, -16.2, -0.06]
    ];
    for (let yg = 0; yg < 2; yg++) {
      const [yx, yz, yyaw] = yogaCoords[yg];
      const yp = new THREE.Vector3(yx, getTerrainHeight(yx, yz) + 0.025, yz);
      this.agents.push({
        character: makeChar(yogaApps[yg], yp.x, yp.y, yp.z, yyaw),
        role: 'yoga',
        pos: yp,
        yaw: yyaw
      });
    }

    // 19. TWO KIDS SCULPTING BESIDE THE SANDCASTLE (-11.6, -6.8)!
    const castleKids: Array<{ x: number; z: number; yaw: number; app: HumanAppearance }> = [
      {
        x: -10.55, z: -6.5, yaw: -Math.PI * 0.45,
        app: { gender: 'male', height: 1.32, skinHex: 0xe1ad86, hairHex: 0x4b2f1c, hairStyle: 'short_crop', outfitStyle: 'boardshorts', primaryColor: 0xffbe2e, secondaryColor: 0xffffff }
      },
      {
        x: -12.65, z: -6.6, yaw: Math.PI * 0.45,
        app: { gender: 'female', height: 1.36, skinHex: 0xc2865c, hairHex: 0x201510, hairStyle: 'ponytail', outfitStyle: 'onepiece', primaryColor: 0x4cc9f0, secondaryColor: 0xffd166 }
      }
    ];
    for (const ck of castleKids) {
      const cp = new THREE.Vector3(ck.x, getTerrainHeight(ck.x, ck.z), ck.z);
      this.agents.push({
        character: makeChar(ck.app, cp.x, cp.y, cp.z, ck.yaw),
        role: 'sandcastle_kid',
        pos: cp,
        yaw: ck.yaw
      });
    }

    // 20. ONE OUTDOOR BEACH RINSE SHOWER USER (-18.2, -22.54)!
    {
      const sx = -18.2;
      const sz = -22.54;
      const sp = new THREE.Vector3(sx, getTerrainHeight(sx, sz) + 0.07, sz);
      this.agents.push({
        character: makeChar(
          { gender: 'male', height: 1.78, skinHex: 0xd59b72, hairHex: 0x2a1b12, hairStyle: 'surfer_waves', outfitStyle: 'boardshorts', primaryColor: 0x2a9d8f, secondaryColor: 0xffffff },
          sp.x, sp.y, sp.z, 0
        ),
        role: 'shower_user',
        pos: sp,
        yaw: 0
      });
    }

    // 21. FOUR AUTONOMOUS MULTI-STAGE DAILY ROUTINE RESORT GUESTS (Tiki Bar <-> Whale Plaza <-> Pier <-> Shoreline!)
    const routineConfigs: Array<{ app: HumanAppearance; speed: number; dwell: number; pts: Array<[number, number]> }> = [
      {
        app: { gender: 'female', height: 1.68, skinHex: 0xebb995, hairHex: 0x5c371c, hairStyle: 'long_wavy', outfitStyle: 'bikini', primaryColor: 0xff6b6b, secondaryColor: 0xffffff, sunHat: true },
        speed: 1.32,
        dwell: 5.5,
        pts: [[-21.0, -24.7], [13.2, -22.2], [19.4, -22.5], [4.0, -7.2]]
      },
      {
        app: { gender: 'male', height: 1.81, skinHex: 0xb97c52, hairHex: 0x1c1410, hairStyle: 'short_crop', outfitStyle: 'linen_shirt', primaryColor: 0x264653, secondaryColor: 0xf6f1e6, sunglasses: true },
        speed: 1.38,
        dwell: 6.2,
        pts: [[-35.4, -18.5], [-23.2, -24.7], [-6.5, -24.7], [-15.8, -6.8]]
      },
      {
        app: { gender: 'female', height: 1.65, skinHex: 0x9c6542, hairHex: 0x181210, hairStyle: 'curly_crown', outfitStyle: 'onepiece', primaryColor: 0xf4a261, secondaryColor: 0xfff8ee },
        speed: 1.28,
        dwell: 5.8,
        pts: [[16.4, -21.8], [35.2, -18.5], [10.6, -14.8], [0.5, -24.7]]
      },
      {
        app: { gender: 'male', height: 1.77, skinHex: 0xdfa882, hairHex: 0x7b542c, hairStyle: 'surfer_waves', outfitStyle: 'boardshorts', primaryColor: 0x1982c4, secondaryColor: 0xffd166 },
        speed: 1.42,
        dwell: 5.0,
        pts: [[-44.5, -24.7], [-19.4, -24.7], [-2.5, -24.7], [-10.2, -9.2]]
      }
    ];
    for (let r = 0; r < routineConfigs.length; r++) {
      const cfg = routineConfigs[r];
      const [sx, sz] = cfg.pts[0];
      const surf = getWalkableSurface(sx, sz, getTerrainHeight(sx, sz) + 1.2);
      const rp = new THREE.Vector3(sx, surf.y, sz);
      this.agents.push({
        character: makeChar(cfg.app, rp.x, rp.y, rp.z, 0),
        role: 'routine',
        pos: rp,
        yaw: 0,
        waypoints: cfg.pts.map(([x, z]) => new THREE.Vector2(x, z)),
        waypointIndex: 1,
        walkSpeed: cfg.speed,
        dwellDuration: cfg.dwell,
        dwellTimer: r * 1.4,
        socialCooldown: 4.0 + r * 2.5
      });
    }

    // 22. TWO TIKI BAR PATIO DANCERS GROOVING TO THE TROPICAL MUSIC!
    const dancerSpecs: Array<{ x: number; z: number; yaw: number; app: HumanAppearance }> = [
      {
        x: -25.6, z: -24.9, yaw: Math.PI * 0.85,
        app: { gender: 'female', height: 1.66, skinHex: 0xd99e76, hairHex: 0x261810, hairStyle: 'ponytail', outfitStyle: 'bikini', primaryColor: 0xf72585, secondaryColor: 0xffd166 }
      },
      {
        x: -17.0, z: -24.8, yaw: -Math.PI * 0.82,
        app: { gender: 'male', height: 1.79, skinHex: 0x8f5b3a, hairHex: 0x141110, hairStyle: 'short_crop', outfitStyle: 'linen_shirt', primaryColor: 0x06d6a0, secondaryColor: 0xfff8ee, sunglasses: true }
      }
    ];
    for (const dn of dancerSpecs) {
      const dy = getBoardwalkY(dn.x);
      const dp = new THREE.Vector3(dn.x, dy, dn.z);
      this.agents.push({
        character: makeChar(dn.app, dp.x, dp.y, dp.z, dn.yaw),
        role: 'dancer',
        pos: dp,
        yaw: dn.yaw
      });
    }

    // 23. TWO SHORELINE SHELL COLLECTORS STROLLING WET SAND & PERIODICALLY CROUCHING TO INSPECT SHELLS!
    const collectorSpecs: Array<{ homeX: number; homeZ: number; phase: number; app: HumanAppearance }> = [
      {
        homeX: -27.5, homeZ: -4.2, phase: 0.4,
        app: { gender: 'female', height: 1.63, skinHex: 0xefc3a2, hairHex: 0x9b6a38, hairStyle: 'top_bun', outfitStyle: 'onepiece', primaryColor: 0x4cc9f0, secondaryColor: 0xffffff, sunHat: true }
      },
      {
        homeX: 24.0, homeZ: -3.9, phase: 3.1,
        app: { gender: 'male', height: 1.76, skinHex: 0xc68b61, hairHex: 0x241710, hairStyle: 'surfer_waves', outfitStyle: 'boardshorts', primaryColor: 0xe76f51, secondaryColor: 0xffffff }
      }
    ];
    for (const col of collectorSpecs) {
      const cp = new THREE.Vector3(col.homeX, getTerrainHeight(col.homeX, col.homeZ), col.homeZ);
      this.agents.push({
        character: makeChar(col.app, cp.x, cp.y, cp.z, Math.PI * 0.5),
        role: 'shell_collector',
        pos: cp,
        yaw: Math.PI * 0.5,
        homeX: col.homeX,
        homeZ: col.homeZ,
        strollPhase: col.phase
      });
    }

    // 24. TWO FLOATING OCEAN SWIM RAFT GUESTS (-2.0, 21.5) RIDING LIVE WAVE BOBBING!
    const raftSpecs: Array<{ x: number; z: number; yaw: number; side: number; app: HumanAppearance }> = [
      {
        // Seated cleanly on the seaward edge of the raft with feet dangling into the crystal water (zero deck clipping!)
        x: -2.65, z: 23.06, yaw: 0.0, side: -1,
        app: { gender: 'female', height: 1.67, skinHex: 0xd4966e, hairHex: 0x211510, hairStyle: 'long_wavy', outfitStyle: 'bikini', primaryColor: 0xffbe0b, secondaryColor: 0xffffff, sunglasses: true }
      },
      {
        x: -1.30, z: 21.65, yaw: Math.PI + 0.35, side: 1,
        app: { gender: 'male', height: 1.80, skinHex: 0xe6b48e, hairHex: 0x4e321e, hairStyle: 'short_crop', outfitStyle: 'boardshorts', primaryColor: 0x3a86ff, secondaryColor: 0xffffff }
      }
    ];
    for (const rf of raftSpecs) {
      const rp = new THREE.Vector3(rf.x, 0.28, rf.z);
      this.agents.push({
        character: makeChar(rf.app, rp.x, rp.y, rp.z, rf.yaw, true),
        role: 'raft_lounger',
        pos: rp,
        yaw: rf.yaw,
        homeX: rf.x,
        homeZ: rf.z,
        sideSign: rf.side
      });
    }

    // 25. TWO SCENIC OVERLOOK WALKERS (West Headland Fort Trail & East Whale Plaza Trail)!
    const overlookSpecs: Array<{ app: HumanAppearance; speed: number; pts: Array<[number, number]> }> = [
      {
        app: { gender: 'male', height: 1.78, skinHex: 0xa96f48, hairHex: 0x1a1410, hairStyle: 'short_crop', outfitStyle: 'rashguard', primaryColor: 0x2a9d8f, secondaryColor: 0x264653 },
        speed: 1.24,
        pts: [[-52.5, -34.0], [-56.0, -36.5], [-44.5, -34.5], [-41.0, -28.0]]
      },
      {
        app: { gender: 'female', height: 1.70, skinHex: 0xe5b38d, hairHex: 0x3a2416, hairStyle: 'ponytail', outfitStyle: 'linen_shirt', primaryColor: 0x457b9d, secondaryColor: 0xf1faee, sunHat: true },
        speed: 1.30,
        pts: [[17.5, -20.5], [30.5, -20.2], [43.5, -18.2], [27.5, -23.0]]
      }
    ];
    for (const ov of overlookSpecs) {
      const [ox, oz] = ov.pts[0];
      const op = new THREE.Vector3(ox, getTerrainHeight(ox, oz), oz);
      this.agents.push({
        character: makeChar(ov.app, op.x, op.y, op.z, 0),
        role: 'walker',
        pos: op,
        yaw: 0,
        waypoints: ov.pts.map(([x, z]) => new THREE.Vector2(x, z)),
        waypointIndex: 1,
        walkSpeed: ov.speed,
        socialCooldown: 6.0
      });
    }

    // 25. TWO Wave-Riding Surfers on sculpted colorful surfboards across West Swim Cove (NPCs 61–62)!
    const surferSpecs: Array<{ app: HumanAppearance; cx: number; cz: number; rx: number; rz: number; phase: number; boardCol: number }> = [
      {
        app: { gender: 'male', height: 1.80, skinHex: 0xc98a5b, hairHex: 0xd6a856, hairStyle: 'surfer_waves', outfitStyle: 'rashguard', primaryColor: 0x00b4d8, secondaryColor: 0x1d3557 },
        cx: -25.0, cz: 18.5, rx: 7.5, rz: 3.5, phase: 0.4, boardCol: 0x38e2d8
      },
      {
        app: { gender: 'female', height: 1.69, skinHex: 0xe2ae86, hairHex: 0x2d1e15, hairStyle: 'ponytail', outfitStyle: 'rashguard', primaryColor: 0xff6b6b, secondaryColor: 0xffe66d },
        cx: -14.5, cz: 22.0, rx: 6.5, rz: 3.0, phase: 3.1, boardCol: 0xff9f1c
      }
    ];
    for (const sf of surferSpecs) {
      const char = makeChar(sf.app, sf.cx, 0.0, sf.cz, 0, false, true);
      const boardGeo = new THREE.SphereGeometry(1, 12, 8);
      boardGeo.scale(0.30, 0.045, 1.15);
      const board = new THREE.Mesh(
        boardGeo,
        new THREE.MeshStandardMaterial({ color: sf.boardCol, roughness: 0.28, metalness: 0.08 })
      );
      board.position.set(0, -0.02, 0.05);
      board.castShadow = false;
      char.root.add(board);

      this.agents.push({
        character: char,
        role: 'surfer',
        pos: new THREE.Vector3(sf.cx, 0, sf.cz),
        yaw: 0,
        swimCenterX: sf.cx,
        swimCenterZ: sf.cz,
        swimRadiusX: sf.rx,
        swimRadiusZ: sf.rz,
        swimPhase: sf.phase,
        rippleTimer: 0.4
      });
    }

    // 26. FOUR Autonomous Coastal Kayakers touring across West Bay, Central Outer Channel & East Lighthouse Cove!
    const kayakerSpecs: Array<{ app: HumanAppearance; cx: number; cz: number; rx: number; rz: number; phase: number; hullCol: number }> = [
      {
        app: { gender: 'female', height: 1.68, skinHex: 0xb97c52, hairHex: 0x1b1512, hairStyle: 'top_bun', outfitStyle: 'rashguard', primaryColor: 0xffca3a, secondaryColor: 0x264653, sunglasses: true },
        cx: 36.0, cz: 22.5, rx: 10.5, rz: 5.5, phase: 0.7, hullCol: 0xff6b35
      },
      {
        app: { gender: 'male', height: 1.79, skinHex: 0xe6b58f, hairHex: 0x4a3120, hairStyle: 'short_crop', outfitStyle: 'rashguard', primaryColor: 0x2a9d8f, secondaryColor: 0x1d3557, sunglasses: true },
        cx: 48.0, cz: 36.0, rx: 11.0, rz: 6.2, phase: 3.6, hullCol: 0x00b4d8
      },
      {
        // Central Outer-Bay Touring Kayaker gliding well beyond the buoy line (z = 38..52)!
        app: { gender: 'male', height: 1.81, skinHex: 0xc98a5b, hairHex: 0x241710, hairStyle: 'surfer_waves', outfitStyle: 'rashguard', primaryColor: 0xf4a261, secondaryColor: 0x1d3557, baseballCap: true, sunglasses: true },
        cx: 2.0, cz: 45.0, rx: 18.0, rz: 6.5, phase: 1.9, hullCol: 0x2ec4b6
      },
      {
        // West Headland Outer-Cove Touring Kayaker cruising z = 28..42!
        app: { gender: 'female', height: 1.69, skinHex: 0xebbc98, hairHex: 0x6b3e22, hairStyle: 'ponytail', outfitStyle: 'rashguard', primaryColor: 0xe76f51, secondaryColor: 0xffffff, sunglasses: true },
        cx: -34.0, cz: 35.0, rx: 12.5, rz: 6.0, phase: 4.8, hullCol: 0xffbe0b
      }
    ];
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.42 });
    for (const ky of kayakerSpecs) {
      const char = makeChar(ky.app, ky.cx, 0.0, ky.cz, 0, false, true);
      // Higher-freeboard sculpted coastal touring kayak (shared rim & single-mesh hull to save draw calls!)
      const hullGeo = new THREE.SphereGeometry(1, 12, 8);
      hullGeo.scale(0.42, 0.25, 1.88);
      const hull = new THREE.Mesh(
        hullGeo,
        new THREE.MeshStandardMaterial({ color: ky.hullCol, roughness: 0.30, metalness: 0.07 })
      );
      hull.position.set(0, 0.42, 0.05);
      hull.castShadow = false;
      char.root.add(hull);

      // Single-draw-call double-blade kayak paddle mounted cleanly in front of torso
      const paddleGroup = new THREE.Group();
      paddleGroup.position.set(0, 0.96, 0.34);
      const paddle = new THREE.Mesh(new THREE.BoxGeometry(2.44, 0.11, 0.026), bladeMat);
      paddleGroup.add(paddle);
      char.root.add(paddleGroup);

      this.agents.push({
        character: char,
        role: 'kayaker',
        pos: new THREE.Vector3(ky.cx, 0, ky.cz),
        yaw: 0,
        hullPitch: 0,
        hullRoll: 0,
        swimCenterX: ky.cx,
        swimCenterZ: ky.cz,
        swimRadiusX: ky.rx,
        swimRadiusZ: ky.rz,
        swimPhase: ky.phase,
        rippleTimer: 0.3,
        paddleRef: paddleGroup
      });
    }

    // 27. TWO West Palm Hammock Loungers resting inside the woven canvas slings (NPCs 65–66)!
    const hammockApps: HumanAppearance[] = [
      { gender: 'female', height: 1.66, skinHex: 0xdca47d, hairHex: 0x2b1a10, hairStyle: 'long_wavy', outfitStyle: 'bikini', primaryColor: 0x48cae4, secondaryColor: 0xffffff, sunglasses: true },
      { gender: 'male', height: 1.77, skinHex: 0x9c6540, hairHex: 0x161210, hairStyle: 'curly_crown', outfitStyle: 'boardshorts', primaryColor: 0xffbe0b, secondaryColor: 0x264653, sunglasses: true }
    ];
    const hSpots = anchors.hammockSpots ?? [];
    for (let i = 0; i < Math.min(2, hSpots.length); i++) {
      const hs = hSpots[i];
      const yaw = hs.yaw + Math.PI * 0.5;
      const char = makeChar(hammockApps[i], hs.x, hs.y - 0.04, hs.z, yaw, false, true);
      this.agents.push({
        character: char,
        role: 'hammock',
        pos: new THREE.Vector3(hs.x, hs.y - 0.04, hs.z),
        yaw,
        homeX: hs.x,
        homeZ: hs.z,
        strollPhase: i * 1.9
      });
    }

    // 28. TWO Bonfire Sunset Circle Guests gathering around the Stone Fire Pit (NPCs 67–68)!
    const bonfireSpecs: Array<{ x: number; z: number; yaw: number; side: number; app: HumanAppearance }> = [
      {
        x: -39.5, z: -17.35, yaw: 2.55, side: -1,
        app: { gender: 'female', height: 1.67, skinHex: 0xe6b692, hairHex: 0x5c361d, hairStyle: 'long_wavy', outfitStyle: 'linen_shirt', primaryColor: 0xf4a261, secondaryColor: 0x2a9d8f }
      },
      {
        x: -37.0, z: -19.85, yaw: -0.95, side: 1,
        app: { gender: 'male', height: 1.81, skinHex: 0x8f5938, hairHex: 0x181310, hairStyle: 'short_crop', outfitStyle: 'linen_shirt', primaryColor: 0xe9c46a, secondaryColor: 0x264653 }
      }
    ];
    for (const bf of bonfireSpecs) {
      const by = getTerrainHeight(bf.x, bf.z);
      const char = makeChar(bf.app, bf.x, by, bf.z, bf.yaw);
      this.agents.push({
        character: char,
        role: 'bonfire_guest',
        pos: new THREE.Vector3(bf.x, by, bf.z),
        yaw: bf.yaw,
        sideSign: bf.side,
        strollPhase: bf.side > 0 ? 1.4 : 0.2
      });
    }

    // 29. TWO East-Beach Soccer Kickabout Players kicking the soccer ball at x=47.6..54.9, z=-16.0 (NPCs 69–70)!
    const soccerSpecs: Array<{ x: number; z: number; yaw: number; side: number; app: HumanAppearance }> = [
      {
        x: 47.6, z: -16.0, yaw: Math.PI * 0.5, side: -1,
        app: { gender: 'male', height: 1.80, skinHex: 0xc28358, hairHex: 0x1d1612, hairStyle: 'short_crop', outfitStyle: 'boardshorts', primaryColor: 0xe63946, secondaryColor: 0xf1faee }
      },
      {
        x: 54.9, z: -16.0, yaw: -Math.PI * 0.5, side: 1,
        app: { gender: 'female', height: 1.70, skinHex: 0xebbc98, hairHex: 0xc89548, hairStyle: 'ponytail', outfitStyle: 'rashguard', primaryColor: 0x1d3557, secondaryColor: 0xa8dadc }
      }
    ];
    for (const sc of soccerSpecs) {
      const sy = getTerrainHeight(sc.x, sc.z);
      const char = makeChar(sc.app, sc.x, sy, sc.z, sc.yaw);
      this.agents.push({
        character: char,
        role: 'soccer',
        pos: new THREE.Vector3(sc.x, sy, sc.z),
        yaw: sc.yaw,
        homeX: sc.x,
        homeZ: sc.z,
        sideSign: sc.side
      });
    }

    // 30. TWO West Coffee & Smoothie Cart Deck NPCs: Barista + Guest (NPCs 71–72)!
    const ccTop = anchors.coffeeCartDeckTop ?? new THREE.Vector3(-47.5, getBoardwalkY(-47.5) + 0.34, -29.0);
    const baristaApp: HumanAppearance = {
      gender: 'female', height: 1.68, skinHex: 0xcf9468, hairHex: 0x221610, hairStyle: 'top_bun',
      outfitStyle: 'linen_shirt', primaryColor: 0x2a9d8f, secondaryColor: 0xfefae0
    };
    const coffeeGuestApp: HumanAppearance = {
      gender: 'male', height: 1.78, skinHex: 0xecbe9a, hairHex: 0x4d3320, hairStyle: 'surfer_waves',
      outfitStyle: 'linen_shirt', primaryColor: 0xf4a261, secondaryColor: 0x264653, sunglasses: true
    };
    this.agents.push({
      character: makeChar(baristaApp, ccTop.x, ccTop.y, ccTop.z - 1.12, 0.0, false, true),
      role: 'coffee_barista',
      pos: new THREE.Vector3(ccTop.x, ccTop.y, ccTop.z - 1.12),
      yaw: 0.0
    });
    this.agents.push({
      character: makeChar(coffeeGuestApp, ccTop.x + 0.15, ccTop.y, ccTop.z + 1.08, Math.PI, false, true),
      role: 'coffee_guest',
      pos: new THREE.Vector3(ccTop.x + 0.15, ccTop.y, ccTop.z + 1.08),
      yaw: Math.PI
    });

    // 31. TWO Full-Promenade Routine Guests roaming the entire -56..+56 boardwalk (NPCs 73–74)!
    const expandedRoutines: Array<{ app: HumanAppearance; speed: number; dwell: number; pts: Array<[number, number]> }> = [
      {
        app: { gender: 'female', height: 1.67, skinHex: 0xb6774d, hairHex: 0x19130f, hairStyle: 'curly_crown', outfitStyle: 'linen_shirt', primaryColor: 0xff758f, secondaryColor: 0xffffff, sunHat: true },
        speed: 1.32, dwell: 4.5,
        pts: [[-54.0, -25.0], [-47.0, -25.0], [-22.0, -25.0], [8.5, -24.8], [48.5, -25.0], [22.0, -25.0]]
      },
      {
        app: { gender: 'male', height: 1.82, skinHex: 0xe3b18a, hairHex: 0x3b2618, hairStyle: 'short_crop', outfitStyle: 'linen_shirt', primaryColor: 0x48cae4, secondaryColor: 0x1d3557, sunglasses: true },
        speed: 1.28, dwell: 5.0,
        pts: [[54.0, -25.0], [48.5, -25.0], [12.0, -25.0], [-21.5, -25.0], [-47.5, -25.0], [-10.0, -25.0]]
      }
    ];
    for (const rt of expandedRoutines) {
      const [rx, rz] = rt.pts[0];
      const rp = new THREE.Vector3(rx, getBoardwalkY(rx), rz);
      this.agents.push({
        character: makeChar(rt.app, rp.x, rp.y, rp.z, 0),
        role: 'routine',
        pos: rp,
        yaw: 0,
        waypoints: rt.pts.map(([x, z]) => new THREE.Vector2(x, z)),
        waypointIndex: 1,
        walkSpeed: rt.speed,
        dwellTimer: 1.5,
        dwellDuration: rt.dwell,
        socialCooldown: 7.0
      });
    }

    // 32. TWO Bronze Monument & Trailhead Explorers admiring the Manta Ray & Shark sculptures (NPCs 75–76)!
    const monumentSpecs: Array<{ x: number; z: number; yaw: number; app: HumanAppearance }> = [
      {
        x: 50.5, z: -19.55, yaw: Math.PI,
        app: { gender: 'female', height: 1.66, skinHex: 0xebbd99, hairHex: 0x2c1b12, hairStyle: 'ponytail', outfitStyle: 'onepiece', primaryColor: 0x2ec4b6, secondaryColor: 0xffffff, sunglasses: true }
      },
      {
        x: -49.5, z: -19.55, yaw: Math.PI,
        app: { gender: 'male', height: 1.77, skinHex: 0xa46b45, hairHex: 0x1a1410, hairStyle: 'short_crop', outfitStyle: 'boardshorts', primaryColor: 0xff9f1c, secondaryColor: 0x1d3557 }
      }
    ];
    for (const ms of monumentSpecs) {
      const my = getTerrainHeight(ms.x, ms.z);
      this.agents.push({
        character: makeChar(ms.app, ms.x, my, ms.z, ms.yaw),
        role: 'chat',
        pos: new THREE.Vector3(ms.x, my, ms.z),
        yaw: ms.yaw
      });
    }

    // 33. AUTONOMOUS PATROL & ENGAGEMENT LIFEGUARD #2 (NPC #77 — patrols shore, scans bay, blows real whistle & greets player!)
    const patrolStartX = -8.5;
    const patrolStartZ = -4.2;
    const patrolStartY = getTerrainHeight(patrolStartX, patrolStartZ);
    const patrolChar = makeChar(
      {
        gender: 'female',
        height: 1.73,
        skinHex: 0xdead86,
        hairHex: 0x4b2f1c,
        hairStyle: 'ponytail',
        outfitStyle: 'rashguard',
        primaryColor: 0xe63946,
        secondaryColor: 0xffffff,
        sunglasses: true,
        isLifeguard: true,
        watch: true
      },
      patrolStartX,
      patrolStartY,
      patrolStartZ,
      0.0,
      false
    );
    const patrolAgent: NpcAgent = {
      character: patrolChar,
      role: 'patrol_lifeguard',
      pos: new THREE.Vector3(patrolStartX, patrolStartY, patrolStartZ),
      yaw: 0.0,
      waypoints: [
        new THREE.Vector2(-32.0, -3.6),
        new THREE.Vector2(-12.0, -3.2),
        new THREE.Vector2(8.0, -3.4),
        new THREE.Vector2(30.0, -3.8),
        new THREE.Vector2(14.0, -5.2),
        new THREE.Vector2(-16.0, -5.0)
      ],
      waypointIndex: 2,
      walkSpeed: 1.55,
      dwellTimer: 3.5,
      dwellDuration: 6.0,
      socialCooldown: 8.0
    };
    this.patrolLifeguardAgent = patrolAgent;
    this.agents.push(patrolAgent);

    // 34. FOUR OFFSHORE FREESTYLE LAP SWIMMERS well out in the turquoise bay (z = 16..30, NPCs 78–81)!
    const offshoreSwimmers: Array<{ app: HumanAppearance; cx: number; cz: number; rx: number; rz: number; phase: number }> = [
      {
        app: { gender: 'male', height: 1.81, skinHex: 0xd9a078, hairHex: 0x2a1d14, hairStyle: 'short_crop', outfitStyle: 'boardshorts', primaryColor: 0x0096c7, secondaryColor: 0xf4d35e },
        cx: -26.0, cz: 21.0, rx: 7.5, rz: 4.5, phase: 0.4
      },
      {
        app: { gender: 'female', height: 1.69, skinHex: 0x9b623f, hairHex: 0x161210, hairStyle: 'top_bun', outfitStyle: 'onepiece', primaryColor: 0xff595e, secondaryColor: 0xffffff },
        cx: -9.0, cz: 27.5, rx: 8.2, rz: 4.0, phase: 2.1
      },
      {
        app: { gender: 'male', height: 1.78, skinHex: 0xf0c4a0, hairHex: 0xc9934b, hairStyle: 'surfer_waves', outfitStyle: 'boardshorts', primaryColor: 0x2ec4b6, secondaryColor: 0x1d3557 },
        cx: 11.0, cz: 24.0, rx: 6.5, rz: 4.8, phase: 3.9
      },
      {
        app: { gender: 'female', height: 1.66, skinHex: 0xc98d64, hairHex: 0x241710, hairStyle: 'ponytail', outfitStyle: 'rashguard', primaryColor: 0xffb703, secondaryColor: 0x023047 },
        cx: 33.0, cz: 25.5, rx: 7.0, rz: 4.2, phase: 5.2
      }
    ];
    for (const sw of offshoreSwimmers) {
      const char = makeChar(sw.app, sw.cx, -1.0, sw.cz, 0, false, true);
      this.agents.push({
        character: char,
        role: 'swimmer',
        pos: new THREE.Vector3(sw.cx, -1.0, sw.cz),
        yaw: 0,
        swimCenterX: sw.cx,
        swimCenterZ: sw.cz,
        swimRadiusX: sw.rx,
        swimRadiusZ: sw.rz,
        swimPhase: sw.phase,
        rippleTimer: 0.4
      });
    }

    // 35. TWO OFFSHORE CORAL-REEF SNORKELERS wearing masks, snorkels & swim fins (z = 25..33, NPCs 82–83)!
    const snorkelerSpecs: Array<{ app: HumanAppearance; cx: number; cz: number; rx: number; rz: number; phase: number }> = [
      {
        app: { gender: 'female', height: 1.68, skinHex: 0xe6b48e, hairHex: 0x2f1d14, hairStyle: 'ponytail', outfitStyle: 'rashguard', primaryColor: 0x1e8ca0, secondaryColor: 0xffbe0b, snorkelGear: true },
        cx: -3.5, cz: 31.0, rx: 6.5, rz: 3.4, phase: 0.9
      },
      {
        app: { gender: 'male', height: 1.80, skinHex: 0xb87a52, hairHex: 0x1b1512, hairStyle: 'short_crop', outfitStyle: 'rashguard', primaryColor: 0x264653, secondaryColor: 0xff6b35, snorkelGear: true },
        cx: 15.5, cz: 29.0, rx: 5.8, rz: 3.6, phase: 3.7
      }
    ];
    for (const sn of snorkelerSpecs) {
      const char = makeChar(sn.app, sn.cx, -0.95, sn.cz, 0, false, true);
      this.agents.push({
        character: char,
        role: 'snorkeler',
        pos: new THREE.Vector3(sn.cx, -0.95, sn.cz),
        yaw: 0,
        swimCenterX: sn.cx,
        swimCenterZ: sn.cz,
        swimRadiusX: sn.rx,
        swimRadiusZ: sn.rz,
        swimPhase: sn.phase,
        rippleTimer: 0.5
      });
    }

    // 36. TWO OFFSHORE INFLATABLE DONUT-RING OCEAN FLOATERS bobbing peacefully on live swells (z = 17..23, NPCs 84–85)!
    const floaterSpecs: Array<{ app: HumanAppearance; cx: number; cz: number; phase: number; tubeCol: number }> = [
      {
        app: { gender: 'female', height: 1.66, skinHex: 0xedc09e, hairHex: 0xd19b4a, hairStyle: 'top_bun', outfitStyle: 'bikini', primaryColor: 0x2ec4b6, secondaryColor: 0xffffff, sunglasses: true },
        cx: -14.0, cz: 17.5, phase: 0.6, tubeCol: 0xff6b6b
      },
      {
        app: { gender: 'male', height: 1.79, skinHex: 0xc78b62, hairHex: 0x221712, hairStyle: 'short_crop', outfitStyle: 'boardshorts', primaryColor: 0xf4a261, secondaryColor: 0x264653, sunglasses: true },
        cx: 8.5, cz: 18.8, phase: 2.9, tubeCol: 0x38d9a9
      }
    ];
    // Note: Keep castShadow = false on distant offshore water-bathers' tubes/boards & share materials
    // so all 10 offshore swimmers/snorkelers/floaters/SUPs add minimal WebGL draw calls!
    const tubeMatA = new THREE.MeshStandardMaterial({ color: 0xff6b6b, roughness: 0.24, metalness: 0.04 });
    const tubeMatB = new THREE.MeshStandardMaterial({ color: 0x38d9a9, roughness: 0.24, metalness: 0.04 });
    for (let flIdx = 0; flIdx < floaterSpecs.length; flIdx++) {
      const fl = floaterSpecs[flIdx];
      // Floaters ride ON TOP of the water surface -> place in landGroup (culled from underwater refraction pre-pass!)
      const char = makeChar(fl.app, fl.cx, 0, fl.cz, 0.4, false, true);
      const tube = new THREE.Mesh(
        new THREE.TorusGeometry(0.56, 0.20, 8, 16),
        flIdx === 0 ? tubeMatA : tubeMatB
      );
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, 0.34, 0.02);
      tube.castShadow = false;
      char.root.add(tube);
      this.agents.push({
        character: char,
        role: 'tube_floater',
        pos: new THREE.Vector3(fl.cx, 0, fl.cz),
        yaw: 0.4,
        swimCenterX: fl.cx,
        swimCenterZ: fl.cz,
        swimPhase: fl.phase
      });
    }

    // 37. TWO OFFSHORE STAND-UP PADDLEBOARDERS (SUP) gliding smoothly across deeper turquoise water (z = 22..31, NPCs 86–87)!
    const supSpecs: Array<{ app: HumanAppearance; cx: number; cz: number; rx: number; rz: number; phase: number; boardCol: number }> = [
      {
        app: { gender: 'female', height: 1.70, skinHex: 0xdba37c, hairHex: 0x342115, hairStyle: 'ponytail', outfitStyle: 'onepiece', primaryColor: 0x219ebc, secondaryColor: 0xffffff, baseballCap: true, sunglasses: true },
        cx: -34.0, cz: 26.5, rx: 8.5, rz: 4.0, phase: 1.2, boardCol: 0xffe66d
      },
      {
        app: { gender: 'male', height: 1.82, skinHex: 0xa16742, hairHex: 0x191310, hairStyle: 'short_crop', outfitStyle: 'boardshorts', primaryColor: 0xe76f51, secondaryColor: 0xf4f1de, sunglasses: true },
        cx: 28.0, cz: 30.5, rx: 9.0, rz: 4.2, phase: 4.4, boardCol: 0x4cc9f0
      }
    ];
    for (const sp of supSpecs) {
      // Stand-Up Paddleboarders ride ABOVE the water surface -> place in landGroup (culled from underwater refraction pre-pass!)
      const char = makeChar(sp.app, sp.cx, 0, sp.cz, 0, false, true);
      const bGeo = new THREE.SphereGeometry(1, 14, 8);
      bGeo.scale(0.42, 0.06, 1.62);
      const board = new THREE.Mesh(
        bGeo,
        new THREE.MeshStandardMaterial({ color: sp.boardCol, roughness: 0.28, metalness: 0.05 })
      );
      board.position.set(0, -0.02, 0.04);
      board.castShadow = false;
      char.root.add(board);

      const supPaddle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 2.05, 6), bladeMat);
      supPaddle.position.set(0.28, 0.85, 0.26);
      supPaddle.rotation.x = 0.22;
      supPaddle.castShadow = false;
      char.root.add(supPaddle);

      this.agents.push({
        character: char,
        role: 'sup_boarder',
        pos: new THREE.Vector3(sp.cx, 0, sp.cz),
        yaw: 0,
        swimCenterX: sp.cx,
        swimCenterZ: sp.cz,
        swimRadiusX: sp.rx,
        swimRadiusZ: sp.rz,
        swimPhase: sp.phase,
        rippleTimer: 0.4,
        paddleRef: supPaddle
      });
    }

    // Initialize shared coastal Activity Slot Pool & upgrade free-roaming NPCs into
    // true Utility-Driven Autonomous Activity-Cycling Citizens (zero forever-showering / zero stuck NPCs!)
    this.initAutonomousActivityPool();
  }

  private initAutonomousActivityPool(): void {
    const slotDefs: Array<Omit<ActivitySlot, 'id' | 'occupantId'>> = [
      // 1. Outdoor Beach Shower (exact showerhead center (-18.2, -22.54) — 10–15s max, then leaves!)
      { type: 'beach_shower', x: -18.2, z: -22.54, faceYaw: 0.0, anim: 'rinse', minDur: 10, maxDur: 15 },
      // 2. Ocean Wade & Offshore Swim Zones (spread well out into waist/chest water z = 7..16!)
      { type: 'ocean_swim', x: -32.0, z: 9.5, faceYaw: 0.1, anim: 'tread', minDur: 16, maxDur: 26, inWater: true },
      { type: 'ocean_swim', x: -13.5, z: 11.2, faceYaw: -0.1, anim: 'tread', minDur: 16, maxDur: 26, inWater: true },
      { type: 'ocean_swim', x: 5.5, z: 10.8, faceYaw: 0.2, anim: 'tread', minDur: 16, maxDur: 26, inWater: true },
      { type: 'ocean_swim', x: 13.5, z: 9.2, faceYaw: -0.2, anim: 'tread', minDur: 14, maxDur: 24, inWater: true },
      { type: 'ocean_swim', x: 33.0, z: 10.2, faceYaw: 0.0, anim: 'tread', minDur: 16, maxDur: 25, inWater: true },
      { type: 'ocean_swim', x: 44.0, z: 9.0, faceYaw: -0.15, anim: 'tread', minDur: 15, maxDur: 24, inWater: true },
      // 3. Neon Tiki Bar Social & Ordering Spots
      { type: 'tiki_bar', x: -24.5, z: -25.2, faceYaw: Math.PI, anim: 'chat', minDur: 12, maxDur: 22, onWood: true },
      { type: 'tiki_bar', x: -21.8, z: -25.1, faceYaw: Math.PI, anim: 'chat', minDur: 12, maxDur: 22, onWood: true },
      { type: 'tiki_bar', x: -19.4, z: -25.2, faceYaw: Math.PI, anim: 'wave', minDur: 10, maxDur: 18, onWood: true },
      // 4. Tiki Music Dance Floor
      { type: 'tiki_dance', x: -25.8, z: -24.7, faceYaw: Math.PI * 0.85, anim: 'dance', minDur: 14, maxDur: 24, onWood: true },
      { type: 'tiki_dance', x: -16.8, z: -24.7, faceYaw: -Math.PI * 0.82, anim: 'dance', minDur: 14, maxDur: 24, onWood: true },
      // 5. West Coffee & Smoothie Cart Social Spots
      { type: 'coffee_cart', x: -46.8, z: -25.2, faceYaw: Math.PI, anim: 'chat', minDur: 12, maxDur: 20, onWood: true },
      { type: 'coffee_cart', x: -48.6, z: -25.2, faceYaw: Math.PI, anim: 'idle', minDur: 12, maxDur: 20, onWood: true },
      // 6. Bonfire Circle Hangout (extra magnetic at Golden Hour / Sunset!)
      { type: 'bonfire', x: -39.6, z: -17.3, faceYaw: 2.55, anim: 'chat', minDur: 14, maxDur: 26 },
      { type: 'bonfire', x: -36.8, z: -19.8, faceYaw: -0.95, anim: 'chat', minDur: 14, maxDur: 26 },
      { type: 'bonfire', x: -38.4, z: -16.8, faceYaw: Math.PI, anim: 'wave', minDur: 12, maxDur: 22 },
      { type: 'bonfire', x: -40.8, z: -19.2, faceYaw: Math.PI * 0.5, anim: 'chat', minDur: 14, maxDur: 24 },
      // 7. Ocean Pier Scenic Lookouts (walking up the grounded approach ramp!)
      { type: 'pier_lookout', x: 21.1, z: 3.5, faceYaw: -Math.PI * 0.45, anim: 'idle', minDur: 12, maxDur: 22, onWood: true },
      { type: 'pier_lookout', x: 22.9, z: 9.5, faceYaw: Math.PI * 0.45, anim: 'wave', minDur: 12, maxDur: 20, onWood: true },
      { type: 'pier_lookout', x: 21.3, z: 16.0, faceYaw: -Math.PI * 0.35, anim: 'idle', minDur: 12, maxDur: 22, onWood: true },
      // 8. Coastal Monument Sightseeing (Whale Tail, Bronze Manta Ray, Bronze Shark)
      { type: 'monument', x: 14.8, z: -19.2, faceYaw: Math.PI, anim: 'idle', minDur: 10, maxDur: 18 },
      { type: 'monument', x: 50.5, z: -19.0, faceYaw: Math.PI, anim: 'idle', minDur: 10, maxDur: 18 },
      { type: 'monument', x: -49.5, z: -19.0, faceYaw: Math.PI, anim: 'idle', minDur: 10, maxDur: 18 },
      // 9. Beach Changing Cabanas (clear open entrance approach east of the Palm Hammocks!)
      { type: 'cabana', x: -51.8, z: -32.2, faceYaw: -Math.PI * 0.65, anim: 'idle', minDur: 8, maxDur: 14 },
      { type: 'cabana', x: -50.6, z: -33.0, faceYaw: -Math.PI * 0.55, anim: 'idle', minDur: 8, maxDur: 14 },
      // 10. Open Sunlit Sand Stretch / Chill Spots
      { type: 'sand_stretch', x: -29.5, z: -12.5, faceYaw: 0.1, anim: 'yoga', minDur: 14, maxDur: 22 },
      { type: 'sand_stretch', x: -6.5, z: -11.8, faceYaw: -0.1, anim: 'idle', minDur: 12, maxDur: 20 },
      { type: 'sand_stretch', x: 35.5, z: -12.2, faceYaw: 0.15, anim: 'yoga', minDur: 14, maxDur: 22 },
      // 11. Shoreline Shell Hunting
      { type: 'shell_hunt', x: -27.5, z: -3.5, faceYaw: 0.4, anim: 'build_sand', minDur: 9, maxDur: 16 },
      { type: 'shell_hunt', x: -4.0, z: -3.8, faceYaw: -0.3, anim: 'build_sand', minDur: 9, maxDur: 16 },
      { type: 'shell_hunt', x: 12.5, z: -3.4, faceYaw: 0.2, anim: 'build_sand', minDur: 9, maxDur: 16 },
      { type: 'shell_hunt', x: 36.5, z: -3.6, faceYaw: -0.4, anim: 'build_sand', minDur: 9, maxDur: 16 },
      // 12. Boardwalk Promenade Scenic Stops
      { type: 'boardwalk_stroll', x: -35.0, z: -24.7, faceYaw: 0.0, anim: 'idle', minDur: 8, maxDur: 15, onWood: true },
      { type: 'boardwalk_stroll', x: -8.5, z: -24.7, faceYaw: 0.0, anim: 'chat', minDur: 8, maxDur: 15, onWood: true },
      { type: 'boardwalk_stroll', x: 8.5, z: -24.7, faceYaw: 0.0, anim: 'idle', minDur: 8, maxDur: 15, onWood: true },
      { type: 'boardwalk_stroll', x: 34.0, z: -24.7, faceYaw: 0.0, anim: 'idle', minDur: 8, maxDur: 15, onWood: true },
      { type: 'boardwalk_stroll', x: 48.0, z: -24.7, faceYaw: 0.0, anim: 'wave', minDur: 8, maxDur: 15, onWood: true }
    ];

    for (let i = 0; i < slotDefs.length; i++) {
      this.activitySlots.push({ ...slotDefs[i], id: i, occupantId: -1 });
    }

    // Upgrade hardcoded single-task beachgoers into genuinely autonomous activity-cycling Citizens!
    const promotableRoles = new Set<NpcAgent['role']>([
      'shower_user',
      'routine',
      'dancer',
      'shell_collector',
      'bonfire_guest',
      'coffee_guest',
      'boardwalk_stroller',
      'pier_stroller',
      'walker'
    ]);

    let citizenSeq = 0;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!promotableRoles.has(a.role)) continue;
      const wasShower = a.role === 'shower_user';
      a.role = 'citizen';
      a.walkSpeed = 1.28 + (citizenSeq % 5) * 0.07;
      a.needHeat = ((citizenSeq * 37) % 100) / 100;
      a.needSandiness = wasShower ? 0.95 : ((citizenSeq * 53) % 100) / 100;
      a.needThirst = ((citizenSeq * 71) % 100) / 100;
      a.needSocial = ((citizenSeq * 29) % 100) / 100;
      a.needCuriosity = ((citizenSeq * 61) % 100) / 100;
      a.stuckCheckTimer = 1.0;
      a.stuckLastX = a.pos.x;
      a.stuckLastZ = a.pos.z;
      a.stuckEscapeTimer = 0;
      a.stuckEscapeSign = citizenSeq % 2 === 0 ? 1 : -1;
      a.stuckStrikes = 0;
      a.socialCooldown = 5.0 + (citizenSeq % 6) * 2.0;

      if (wasShower) {
        // Start rinsing right under the shower for 11 seconds, then walk away autonomously!
        const shSlot = this.activitySlots[0];
        shSlot.occupantId = i;
        a.activitySlotId = shSlot.id;
        a.activityPhase = 'engage';
        a.activityTimer = 11.0;
        a.lastActivityType = 'beach_shower';
      } else {
        a.activitySlotId = -1;
        this.assignNextActivity(i, false);
      }
      citizenSeq++;
    }
  }

  private releaseCitizenSlot(agentIdx: number): void {
    const a = this.agents[agentIdx];
    if (a.activitySlotId !== undefined && a.activitySlotId >= 0) {
      const slot = this.activitySlots[a.activitySlotId];
      if (slot && slot.occupantId === agentIdx) {
        slot.occupantId = -1;
      }
      a.activitySlotId = -1;
    }
  }

  private assignNextActivity(agentIdx: number, isSunset: boolean): void {
    const a = this.agents[agentIdx];
    this.releaseCitizenSlot(agentIdx);

    let bestSlot: ActivitySlot | null = null;
    let bestScore = -1e9;

    for (let i = 0; i < this.activitySlots.length; i++) {
      const s = this.activitySlots[i];
      if (s.occupantId >= 0) continue; // Slot already reserved by another citizen!

      let score = Math.random() * 0.38;
      // Avoid immediately repeating the exact same activity type
      if (s.type === a.lastActivityType) score -= 1.25;

      // Utility-driven scoring from citizen's live dynamic needs & Time of Day!
      switch (s.type) {
        case 'beach_shower':
          score += (a.needSandiness ?? 0) * 1.65;
          break;
        case 'ocean_swim':
          score += (a.needHeat ?? 0) * (isSunset ? 0.25 : 1.35);
          break;
        case 'tiki_bar':
        case 'coffee_cart':
          score += (a.needThirst ?? 0) * 1.25 + (isSunset && s.type === 'tiki_bar' ? 0.55 : 0);
          break;
        case 'bonfire':
          score += (a.needSocial ?? 0) * 0.95 + (isSunset ? 1.15 : 0.15);
          break;
        case 'tiki_dance':
          score += (a.needSocial ?? 0) * 1.05 + (isSunset ? 0.65 : 0.1);
          break;
        case 'pier_lookout':
        case 'monument':
          score += (a.needCuriosity ?? 0) * 1.10 + (isSunset && s.type === 'pier_lookout' ? 0.45 : 0);
          break;
        case 'shell_hunt':
          score += (a.needCuriosity ?? 0) * 0.95;
          break;
        case 'sand_stretch':
        case 'cabana':
        case 'boardwalk_stroll':
          score += 0.45 + (a.needSocial ?? 0) * 0.45;
          break;
      }

      // Gentle distance preference so citizens roam naturally without endless cross-map marathons
      const dist = Math.hypot(s.x - a.pos.x, s.z - a.pos.z);
      score -= Math.min(dist / 85.0, 0.72);

      if (score > bestScore) {
        bestScore = score;
        bestSlot = s;
      }
    }

    if (bestSlot) {
      bestSlot.occupantId = agentIdx;
      a.activitySlotId = bestSlot.id;
      a.activityPhase = 'travel';
      a.activityTimer = bestSlot.minDur + Math.random() * (bestSlot.maxDur - bestSlot.minDur);
      a.stuckStrikes = 0;
      a.stuckCheckTimer = 1.2;
      a.stuckLastX = a.pos.x;
      a.stuckLastZ = a.pos.z;
    }
  }

  public update(
    dt: number,
    elapsedTime: number,
    waveIntensity: number,
    sunDirection: THREE.Vector3,
    sunColor: THREE.Color,
    footprints: FootprintSystem,
    particles: UnderwaterParticles,
    waterFX: WaterInteractionSystem,
    playerPos: THREE.Vector3,
    sound?: SoundEngine,
    cameraPos?: THREE.Vector3,
    cameraQuat?: THREE.Quaternion
  ): void {
    // Animate the shallow-water beach ball tossed cleanly between the 2 playing kids!
    const ballCycle = (elapsedTime * 0.46) % 2.0;
    const ballHalf = Math.floor(ballCycle);
    if (this.lastBeachBallHalf !== -1 && ballHalf !== this.lastBeachBallHalf) {
      sound?.playBallHit(this.waterBeachBall.position, cameraPos, 'beachball', cameraQuat);
    }
    this.lastBeachBallHalf = ballHalf;

    const toRight = ballCycle < 1.0;
    const bt = toRight ? ballCycle : ballCycle - 1.0;
    const kidLX = -8.5 + Math.sin(elapsedTime * 0.9) * 0.65;
    const kidLZ = 6.2 + Math.cos(elapsedTime * 0.7) * 0.7;
    const kidRX = -3.5 + Math.cos(elapsedTime * 0.85) * 0.65;
    const kidRZ = 7.4 + Math.sin(elapsedTime * 0.75) * 0.7;

    const bx = THREE.MathUtils.lerp(toRight ? kidLX : kidRX, toRight ? kidRX : kidLX, bt);
    const bz = THREE.MathUtils.lerp(toRight ? kidLZ : kidRZ, toRight ? kidRZ : kidLZ, bt);
    const bWave = sampleWaveHeight(bx, bz, elapsedTime, waveIntensity, getTerrainHeight(bx, bz));
    this.waterBeachBall.position.set(bx, bWave + 0.95 + Math.sin(bt * Math.PI) * 1.65, bz);
    this.waterBeachBall.rotation.x += dt * 3.5;
    this.waterBeachBall.rotation.z += dt * 2.2;

    // Animate east-beach spinning Frisbee tossed gracefully between the 2 frisbee players!
    const fCycle = (elapsedTime * 0.42) % 2.0;
    const fRight = fCycle < 1.0;
    const ft = fRight ? fCycle : fCycle - 1.0;
    const fx = THREE.MathUtils.lerp(fRight ? 33.8 : 42.2, fRight ? 42.2 : 33.8, ft);
    const fz = -7.8 + Math.sin(ft * Math.PI) * 1.1;
    const fy = getTerrainHeight(fx, fz) + 1.35 + Math.sin(ft * Math.PI) * 1.15;
    this.beachFrisbee.position.set(fx, fy, fz);
    this.beachFrisbee.rotation.y += dt * 16.0;
    this.beachFrisbee.rotation.z = (fRight ? -0.14 : 0.14) * Math.cos(ft * Math.PI);

    // Autonomous peer social interaction pauses: nearby traveling citizens pause, wave & chat!
    const isSocialRole = (a: NpcAgent) =>
      (a.role === 'citizen' && a.activityPhase === 'travel' && a.pos.z < 1.5) ||
      a.role === 'walker' ||
      a.role === 'routine' ||
      a.role === 'boardwalk_stroller';
    const isSunsetNow = sunDirection.y < 0.30;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if ((a.socialTimer ?? 0) > 0) a.socialTimer = Math.max(0, (a.socialTimer ?? 0) - dt);
      if ((a.socialCooldown ?? 0) > 0) a.socialCooldown = Math.max(0, (a.socialCooldown ?? 0) - dt);
    }
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!isSocialRole(a) || (a.socialTimer ?? 0) > 0 || (a.socialCooldown ?? 0) > 0 || (a.dwellTimer ?? 0) > 0) {
        continue;
      }
      for (let j = i + 1; j < this.agents.length; j++) {
        const b = this.agents[j];
        if (!isSocialRole(b) || (b.socialTimer ?? 0) > 0 || (b.socialCooldown ?? 0) > 0 || (b.dwellTimer ?? 0) > 0) {
          continue;
        }
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < 2.25 * 2.25 && distSq > 0.35 * 0.35) {
          a.socialTimer = 3.2;
          b.socialTimer = 3.2;
          a.socialCooldown = 18.0;
          b.socialCooldown = 18.0;
          a.socialPartnerYaw = Math.atan2(dx, dz);
          b.socialPartnerYaw = Math.atan2(-dx, -dz);
          break;
        }
      }
    }

    for (let i = 0; i < this.agents.length; i++) {
      const npc = this.agents[i];
      const prevNpcX = npc.pos.x;
      const prevNpcZ = npc.pos.z;
      const terrainH = getTerrainHeight(npc.pos.x, npc.pos.z);
      const waveH = sampleWaveHeight(npc.pos.x, npc.pos.z, elapsedTime, waveIntensity, terrainH);
      const waterDepth = Math.max(0, waveH - terrainH);

      let animState: HumanAnimState = 'idle';
      let speedNorm = 0;

      if ((npc.socialTimer ?? 0) > 0) {
        const targetYaw = npc.socialPartnerYaw ?? npc.yaw;
        let diff = targetYaw - npc.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        npc.yaw += diff * (1.0 - Math.exp(-6.5 * dt));
        animState = (npc.socialTimer ?? 0) > 2.0 ? 'wave' : 'chat';
        speedNorm = 0;
      } else if (npc.role === 'citizen') {
        // ==================== TRUE UTILITY-BASED AUTONOMOUS BEACH CITIZEN ====================
        // Slowly evolve live dynamic needs so every citizen naturally cycles through beach life!
        npc.needHeat = Math.min(1, (npc.needHeat ?? 0.3) + dt * (isSunsetNow ? 0.004 : 0.016));
        npc.needThirst = Math.min(1, (npc.needThirst ?? 0.3) + dt * 0.012);
        npc.needSocial = Math.min(1, (npc.needSocial ?? 0.3) + dt * 0.014);
        npc.needCuriosity = Math.min(1, (npc.needCuriosity ?? 0.3) + dt * 0.011);
        if (waterDepth > 0.15 || npc.pos.z > -18.0) {
          npc.needSandiness = Math.min(1, (npc.needSandiness ?? 0.2) + dt * 0.013);
        }

        const slot =
          npc.activitySlotId !== undefined && npc.activitySlotId >= 0
            ? this.activitySlots[npc.activitySlotId]
            : null;
        if (!slot) {
          this.assignNextActivity(i, isSunsetNow);
        } else if (npc.activityPhase === 'engage') {
          npc.activityTimer = (npc.activityTimer ?? 8.0) - dt;
          // Satisfy the corresponding need while engaged in this activity!
          if (slot.type === 'beach_shower') {
            npc.needSandiness = Math.max(0, (npc.needSandiness ?? 0) - dt * 0.16);
            npc.needHeat = Math.max(0, (npc.needHeat ?? 0) - dt * 0.08);
          } else if (slot.type === 'ocean_swim') {
            npc.needHeat = Math.max(0, (npc.needHeat ?? 0) - dt * 0.10);
            npc.needSandiness = Math.min(1, (npc.needSandiness ?? 0) + dt * 0.045);
          } else if (slot.type === 'tiki_bar' || slot.type === 'coffee_cart') {
            npc.needThirst = Math.max(0, (npc.needThirst ?? 0) - dt * 0.12);
          } else if (slot.type === 'bonfire' || slot.type === 'tiki_dance' || slot.type === 'boardwalk_stroll') {
            npc.needSocial = Math.max(0, (npc.needSocial ?? 0) - dt * 0.10);
          } else {
            npc.needCuriosity = Math.max(0, (npc.needCuriosity ?? 0) - dt * 0.10);
          }

          let diff = slot.faceYaw - npc.yaw;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          npc.yaw += diff * (1.0 - Math.exp(-5.0 * dt));

          if (slot.inWater) {
            const charScale = npc.character.appearance.height / 1.75;
            if (waterDepth > 0.85) {
              npc.pos.y = THREE.MathUtils.lerp(npc.pos.y, waveH - 1.06 * charScale, 1.0 - Math.exp(-6.0 * dt));
              animState = 'tread';
            } else {
              npc.pos.y = terrainH;
              animState = 'idle';
            }
            npc.rippleTimer = (npc.rippleTimer ?? 0) - dt;
            if (npc.rippleTimer <= 0) {
              npc.rippleTimer = 0.72;
              waterFX.spawnRipple(npc.pos.x, npc.pos.z, 0.44, 1.05);
            }
          } else if (slot.onWood) {
            const surf = getWalkableSurface(npc.pos.x, npc.pos.z, npc.pos.y + 1.0);
            npc.pos.y = surf.y;
            animState = slot.type === 'bonfire' && isSunsetNow ? 'dance' : slot.anim;
          } else {
            // Smoothly lock shower user right under the copper showerhead on the teak pad!
            if (slot.type === 'beach_shower') {
              npc.pos.x = THREE.MathUtils.lerp(npc.pos.x, slot.x, 1.0 - Math.exp(-8.0 * dt));
              npc.pos.z = THREE.MathUtils.lerp(npc.pos.z, slot.z, 1.0 - Math.exp(-8.0 * dt));
              npc.pos.y = getTerrainHeight(slot.x, slot.z) + 0.095;
            } else {
              npc.pos.y = terrainH;
            }
            animState = slot.type === 'bonfire' && isSunsetNow ? 'dance' : slot.anim;
            if (slot.type === 'beach_shower') {
              npc.rippleTimer = (npc.rippleTimer ?? 0) - dt;
              if (npc.rippleTimer <= 0) {
                npc.rippleTimer = 0.22;
                waterFX.spawnSplash(slot.x, npc.pos.y + 0.04, slot.z, 0.28, 4, 0.48);
              }
            }
          }
          speedNorm = 0;

          if ((npc.activityTimer ?? 0) <= 0) {
            npc.lastActivityType = slot.type;
            this.assignNextActivity(i, isSunsetNow);
          }
        } else {
          // ==================== CORRIDOR-AWARE ZERO-STUCK NAVIGATION ====================
          // The Ocean Pier spans x=19.8..24.2 from z=-23.5 all the way into the sea (z=+24)!
          // Route ALL cross-pier land trips cleanly across the open Boardwalk Promenade (z = -25.1)
          // so ZERO NPCs EVER wedge into the Pier Approach Ramp sides or Tiki Torches!
          let tx = slot.x;
          let tz = slot.z;
          const onPierNow = Math.abs(npc.pos.x - 22.0) < 2.25 && npc.pos.z > -23.3;
          const crossesPierWall =
            !onPierNow &&
            slot.type !== 'pier_lookout' &&
            ((npc.pos.x < 19.2 && slot.x > 24.8) || (npc.pos.x > 24.8 && slot.x < 19.2));

          if (slot.type === 'pier_lookout' && !onPierNow) {
            // Approach pier entrance cleanly via boardwalk centerline (22.0, -25.0)
            if (npc.pos.z > -23.6 || Math.abs(npc.pos.x - 22.0) > 1.35) {
              tx = Math.abs(npc.pos.x - 22.0) > 3.0 ? (npc.pos.x < 22.0 ? 17.5 : 26.5) : 22.0;
              tz = -25.0;
            }
          } else if (onPierNow && slot.type !== 'pier_lookout') {
            // Walk straight back down pier centerline onto open boardwalk before turning!
            tx = 22.0;
            tz = -25.2;
          } else if (crossesPierWall && npc.pos.z > -23.6) {
            // Step onto open boardwalk (-25.1) on our current side of the pier FIRST, then cross!
            tx = npc.pos.x < 22.0 ? 17.2 : 26.8;
            tz = -25.1;
          } else if (crossesPierWall && slot.z > -23.6) {
            // Walk across boardwalk past pier before stepping down onto the destination beach!
            tx = slot.x < 22.0 ? 17.2 : 26.8;
            tz = -25.1;
          }

          const dx = tx - npc.pos.x;
          const dz = tz - npc.pos.z;
          const dist = Math.hypot(dx, dz);
          const arrivalTol = slot.type === 'beach_shower' ? 0.32 : 0.68;

          if (dist < arrivalTol && tx === slot.x && tz === slot.z) {
            npc.activityPhase = 'engage';
            npc.stuckStrikes = 0;
            animState = slot.anim;
            speedNorm = 0;
          } else {
            let dirX = dx / Math.max(dist, 0.001);
            let dirZ = dz / Math.max(dist, 0.001);

            // Proactive smooth repulsion around known bottleneck landmarks (pier ramp corners, whale plinth, torches!)
            const obstacles: Array<[number, number, number]> = [
              [14.8, -21.8, 2.3],  // Whale statue plinth
              [19.4, -22.8, 1.7],  // Pier west entrance corner + torch
              [24.6, -22.8, 1.7],  // Pier east entrance corner + torch
              [-27.8, -23.1, 1.0], // Boardwalk torches
              [-12.6, -23.1, 1.0],
              [5.4, -23.1, 1.0],
              [37.2, -23.1, 1.0],
              [-38.5, -19.2, 1.9], // Bonfire stone ring
              [-55.2, -30.2, 2.3], // West Palm Hammock 1
              [-59.4, -29.8, 2.3]  // West Palm Hammock 2
            ];
            for (let oi = 0; oi < obstacles.length; oi++) {
              const [ox, oz, oRad] = obstacles[oi];
              const odx = npc.pos.x - ox;
              const odz = npc.pos.z - oz;
              const od2 = odx * odx + odz * odz;
              if (od2 < oRad * oRad && od2 > 0.001) {
                const od = Math.sqrt(od2);
                const repel = ((oRad - od) / oRad) * 1.9;
                dirX += (odx / od) * repel;
                dirZ += (odz / od) * repel;
              }
            }

            // Smooth avoidance around Player
            const pdx = npc.pos.x - playerPos.x;
            const pdz = npc.pos.z - playerPos.z;
            const pDist = Math.hypot(pdx, pdz);
            if (pDist < 1.55 && pDist > 0.01) {
              const push = (1.55 - pDist) * 1.35;
              dirX += (pdx / pDist) * push;
              dirZ += (pdz / pDist) * push;
            }

            // Smooth personal-space separation from nearby NPCs so crowds never pile up!
            for (let j = 0; j < this.agents.length; j += 2) {
              if (j === i) continue;
              const other = this.agents[j];
              const odx = npc.pos.x - other.pos.x;
              const odz = npc.pos.z - other.pos.z;
              const od2 = odx * odx + odz * odz;
              if (od2 < 1.05 * 1.05 && od2 > 0.001) {
                const od = Math.sqrt(od2);
                const sep = (1.05 - od) * 1.15;
                dirX += (odx / od) * sep;
                dirZ += (odz / od) * sep;
              }
            }

            // Active Stuck-Detector: if tangential escape active, steer cleanly around obstacle!
            if ((npc.stuckEscapeTimer ?? 0) > 0) {
              npc.stuckEscapeTimer = Math.max(0, (npc.stuckEscapeTimer ?? 0) - dt);
              const sign = npc.stuckEscapeSign ?? 1;
              const tangX = -dirZ * sign;
              const tangZ = dirX * sign;
              dirX = dirX * 0.15 + tangX * 1.05;
              dirZ = dirZ * 0.15 + tangZ * 1.05;
            }

            const dLen = Math.hypot(dirX, dirZ) || 1;
            const nx = dirX / dLen;
            const nz = dirZ / dLen;

            const drag = 1.0 - THREE.MathUtils.clamp(waterDepth * 0.45, 0, 0.45);
            const speed = (npc.walkSpeed ?? 1.32) * drag;

            npc.pos.x += nx * speed * dt;
            npc.pos.z += nz * speed * dt;
            npc.pos.x = THREE.MathUtils.clamp(npc.pos.x, -60.5, 60.5);
            npc.pos.z = THREE.MathUtils.clamp(npc.pos.z, -36.5, 18.0);
            resolveWorldCollisions(npc.pos, 0.36);

            const surf = getWalkableSurface(npc.pos.x, npc.pos.z, npc.pos.y + 0.95);
            const charScale = npc.character.appearance.height / 1.75;
            const curTerr = getTerrainHeight(npc.pos.x, npc.pos.z);
            const curWave = sampleWaveHeight(npc.pos.x, npc.pos.z, elapsedTime, waveIntensity, curTerr);
            const curWDepth = surf.surface === 'wood' ? 0 : Math.max(0, curWave - curTerr);

            if (curWDepth > 0.92 && surf.surface !== 'wood') {
              npc.pos.y = curWave - 1.06 * charScale;
              animState = 'swim_surface';
              speedNorm = 0.65;
            } else {
              npc.pos.y = surf.y;
              animState = curWDepth > 0.18 ? 'wade' : 'walk';
              speedNorm = speed / 2.55;
            }

            const desiredYaw = Math.atan2(nx, nz);
            let diff = desiredYaw - npc.yaw;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            npc.yaw += diff * (1.0 - Math.exp(-5.8 * dt));

            // Fast 0.8s Stuck-Detector — guarantees 0% stuck NPCs!
            npc.stuckCheckTimer = (npc.stuckCheckTimer ?? 0.8) - dt;
            if (npc.stuckCheckTimer <= 0) {
              npc.stuckCheckTimer = 0.8;
              const moved = Math.hypot(npc.pos.x - (npc.stuckLastX ?? npc.pos.x), npc.pos.z - (npc.stuckLastZ ?? npc.pos.z));
              npc.stuckLastX = npc.pos.x;
              npc.stuckLastZ = npc.pos.z;
              if (moved < 0.28) {
                npc.stuckStrikes = (npc.stuckStrikes ?? 0) + 1;
                npc.stuckEscapeSign = -(npc.stuckEscapeSign ?? 1);
                npc.stuckEscapeTimer = 1.25;
                if (npc.stuckStrikes >= 2) {
                  // Gracefully switch to a fresh open reachable activity!
                  this.assignNextActivity(i, isSunsetNow);
                }
              } else {
                npc.stuckStrikes = 0;
              }
            }
          }
        }
      } else if (npc.role === 'sunbathe') {
        animState = 'sunbathe';
        npc.pos.y = terrainH + 0.035;
      } else if (npc.role === 'lounge') {
        animState = 'lounge';
        npc.pos.y = terrainH + 0.015;
      } else if (npc.role === 'chat' || npc.role === 'bartender') {
        animState = 'chat';
      } else if (npc.role === 'fisher') {
        animState = 'idle';
      } else if (npc.role === 'frisbee') {
        const side = npc.sideSign ?? -1;
        const shiftZ = -7.8 + Math.sin(elapsedTime * 0.8 + side) * 0.95;
        npc.pos.z = THREE.MathUtils.lerp(npc.pos.z, shiftZ, 1.0 - Math.exp(-4.0 * dt));
        npc.pos.y = getTerrainHeight(npc.pos.x, npc.pos.z);
        animState = 'play_ball';
      } else if (npc.role === 'lifeguard') {
        animState = Math.sin(elapsedTime * 0.25) > -0.2 ? 'scan_horizon' : 'wave';
        npc.yaw = Math.sin(elapsedTime * 0.35) * 0.55;
      } else if (npc.role === 'bar_patron') {
        animState = 'sit_bar';
      } else if (npc.role === 'terrace_diner') {
        animState = 'sit_chair';
      } else if (npc.role === 'kid_ball') {
        const isLeft = (npc.sideSign ?? -1) < 0;
        const targetX = isLeft ? kidLX : kidRX;
        const targetZ = isLeft ? kidLZ : kidRZ;
        npc.pos.x = THREE.MathUtils.lerp(npc.pos.x, targetX, 1.0 - Math.exp(-4.5 * dt));
        npc.pos.z = THREE.MathUtils.lerp(npc.pos.z, targetZ, 1.0 - Math.exp(-4.5 * dt));
        npc.pos.y = getTerrainHeight(npc.pos.x, npc.pos.z);

        const desiredYaw = Math.atan2(bx - npc.pos.x, bz - npc.pos.z);
        let diff = desiredYaw - npc.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        npc.yaw += diff * (1.0 - Math.exp(-7.0 * dt));

        animState = 'play_ball';
        npc.rippleTimer = (npc.rippleTimer ?? 0) - dt;
        if (npc.rippleTimer <= 0 && waterDepth > 0.12) {
          npc.rippleTimer = 0.65 + Math.random() * 0.45;
          waterFX.spawnSplash(npc.pos.x, waveH, npc.pos.z, 0.68, 8, 1.25);
        }
      } else if (npc.role === 'swimmer') {
        const spd = 0.28;
        npc.swimPhase = (npc.swimPhase ?? 0) + dt * spd;
        const ph = npc.swimPhase;
        const cx = npc.swimCenterX ?? 0;
        const cz = npc.swimCenterZ ?? 18;
        const rx = npc.swimRadiusX ?? 7;
        const rz = npc.swimRadiusZ ?? 3.5;

        const nx = cx + Math.cos(ph) * rx;
        const nz = cz + Math.sin(ph) * rz;
        const vx = -Math.sin(ph) * rx * spd;
        const vz = Math.cos(ph) * rz * spd;

        const swWave = sampleWaveHeight(nx, nz, elapsedTime, waveIntensity, getTerrainHeight(nx, nz));
        const charScale = npc.character.appearance.height / 1.75;
        npc.pos.set(nx, swWave - 1.08 * charScale - 0.08, nz);
        npc.yaw = Math.atan2(vx, vz);
        animState = 'swim_surface';
        speedNorm = 0.72;

        npc.rippleTimer = (npc.rippleTimer ?? 0) - dt;
        if (npc.rippleTimer <= 0) {
          npc.rippleTimer = 0.48;
          waterFX.spawnSplash(nx, swWave, nz, 0.55, 5, 1.15);
          particles.emitBubbles(new THREE.Vector3(nx, swWave - 0.25, nz), 3, 0.35, 0.75);
        }
      } else if (npc.role === 'yoga') {
        animState = 'yoga';
      } else if (npc.role === 'rinse' as never || npc.role === 'shower_user') {
        animState = 'rinse';
      } else if (npc.role === 'sandcastle_kid') {
        animState = 'build_sand';
      } else if (npc.role === 'jogger') {
        const u = ((npc.strollPhase ?? 0) + elapsedTime * 0.032) % 1.0;
        const tri = u < 0.5 ? u * 2.0 : (1.0 - u) * 2.0;
        const dir = u < 0.5 ? 1 : -1;
        const jx = THREE.MathUtils.lerp(-46.0, 44.0, tri);
        const bayCurve = 0.0014 * jx * jx - 1.25 * Math.sin(jx * 0.036) - 0.55 * Math.cos(jx * 0.075);
        const jz = bayCurve - 1.8;
        const jy = getTerrainHeight(jx, jz);
        const prevX = npc.pos.x;
        const prevZ = npc.pos.z;
        npc.pos.set(jx, jy, jz);
        const dx = jx - prevX;
        const dz = jz - prevZ;
        if (dx * dx + dz * dz > 1e-6) {
          npc.yaw = Math.atan2(dx, dz);
        } else {
          npc.yaw = dir * Math.PI * 0.5;
        }
        animState = 'run';
        speedNorm = 0.92;
      } else if (npc.role === 'slider') {
        const u = ((npc.strollPhase ?? 0) + elapsedTime * 0.072) % 1.0;
        if (u < 0.36) {
          const f = u / 0.36;
          const sz = THREE.MathUtils.lerp(-4.6, 2.38, f);
          const sy = getWalkableSurface(-22.0, sz, 4.0).y;
          npc.pos.set(-22.0, sy, sz);
          npc.yaw = 0;
          animState = 'walk';
          speedNorm = 0.62;
          npc.lastCycleStep = 0;
        } else if (u < 0.56) {
          const st = (u - 0.36) / 0.20;
          sampleWaterSlide(st, this._slidePos, this._slideTan);
          npc.pos.copy(this._slidePos);
          npc.pos.y += 0.16;
          npc.yaw = Math.atan2(this._slideTan.x, this._slideTan.z);
          animState = 'slide';
          speedNorm = 1.0;
          npc.rippleTimer = (npc.rippleTimer ?? 0) - dt;
          if (npc.rippleTimer <= 0) {
            npc.rippleTimer = 0.12;
            particles.emitBubbles(npc.pos, 2, 0.2, 0.45);
          }
          npc.lastCycleStep = 1;
        } else if (u < 0.62) {
          const f = (u - 0.56) / 0.06;
          const sz = THREE.MathUtils.lerp(12.6, 14.4, f);
          const sg = getTerrainHeight(-22.0, sz);
          const sw = sampleWaveHeight(-22.0, sz, elapsedTime, waveIntensity, sg);
          npc.pos.set(-22.0, THREE.MathUtils.lerp(Math.max(sw - 0.55, sg), sg, f), sz);
          npc.yaw = 0;
          if (npc.lastCycleStep === 1) {
            npc.lastCycleStep = 2;
            waterFX.spawnSplash(npc.pos.x, sw, npc.pos.z, 1.35, 16, 1.7);
            particles.emitBubbles(new THREE.Vector3(npc.pos.x, sw - 0.25, npc.pos.z), 8, 0.45, 1.0);
          }
          animState = 'wade';
          speedNorm = 0.6;
        } else {
          const f = (u - 0.62) / 0.38;
          let rx: number;
          let rz: number;
          if (f < 0.14) {
            const p = f / 0.14;
            rx = THREE.MathUtils.lerp(-22.0, -24.2, p);
            rz = 14.4;
            npc.yaw = -Math.PI * 0.5;
          } else if (f < 0.88) {
            const p = (f - 0.14) / 0.74;
            rx = -24.2;
            rz = THREE.MathUtils.lerp(14.4, -4.6, p);
            npc.yaw = Math.PI;
          } else {
            const p = (f - 0.88) / 0.12;
            rx = THREE.MathUtils.lerp(-24.2, -22.0, p);
            rz = -4.6;
            npc.yaw = Math.PI * 0.5;
          }
          const rg = getTerrainHeight(rx, rz);
          const rw = sampleWaveHeight(rx, rz, elapsedTime, waveIntensity, rg);
          const rDepth = Math.max(0, rw - rg);
          npc.pos.set(rx, rg, rz);
          animState = rDepth > 0.22 ? 'wade' : 'walk';
          speedNorm = 0.62;
          npc.lastCycleStep = 3;
        }
      } else if (npc.role === 'pier_diver') {
        const u = ((npc.strollPhase ?? 0) + elapsedTime * 0.052) % 1.0;
        const laneX = npc.homeX ?? 20.85;
        const side = npc.sideSign ?? -1;
        if (u < 0.40) {
          const f = u / 0.40;
          const pz = THREE.MathUtils.lerp(-13.0, 23.8, f);
          const py = getWalkableSurface(laneX, pz, 2.5).y;
          npc.pos.set(laneX, py, pz);
          npc.yaw = 0;
          animState = u > 0.32 ? 'run' : 'walk';
          speedNorm = u > 0.32 ? 0.88 : 0.62;
          npc.lastCycleStep = 0;
        } else if (u < 0.46) {
          const tAir = (u - 0.40) / 0.06;
          const ax = laneX + side * 0.38 * tAir;
          const az = 23.8 + tAir * 3.8;
          const ay = 2.15 + 3.2 * tAir - 5.2 * tAir * tAir;
          npc.pos.set(ax, ay, az);
          npc.yaw = 0;
          animState = tAir < 0.35 ? 'jump' : 'fall';
          speedNorm = 1.0;
          npc.lastCycleStep = 1;
        } else if (u < 0.80) {
          const f = (u - 0.46) / 0.34;
          const startX = laneX + side * 0.38;
          const midX = 18.2;
          const midZ = 18.0;
          const endX = 17.5;
          const endZ = -1.0;
          let sx: number;
          let sz: number;
          if (f < 0.35) {
            const p = f / 0.35;
            sx = THREE.MathUtils.lerp(startX, midX, p);
            sz = THREE.MathUtils.lerp(27.6, midZ, p);
          } else {
            const p = (f - 0.35) / 0.65;
            sx = THREE.MathUtils.lerp(midX, endX, p);
            sz = THREE.MathUtils.lerp(midZ, endZ, p);
          }
          const dx = sx - npc.pos.x;
          const dz = sz - npc.pos.z;
          if (dx * dx + dz * dz > 1e-6) npc.yaw = Math.atan2(dx, dz);
          const sg = getTerrainHeight(sx, sz);
          const sw = sampleWaveHeight(sx, sz, elapsedTime, waveIntensity, sg);
          if (npc.lastCycleStep === 1) {
            npc.lastCycleStep = 2;
            waterFX.spawnSplash(sx, sw, sz, 1.55, 20, 1.9);
            particles.emitBubbles(new THREE.Vector3(sx, sw - 0.3, sz), 10, 0.5, 1.1);
          }
          const dDepth = Math.max(0, sw - sg);
          const charScale = npc.character.appearance.height / 1.75;
          if (dDepth > 0.78) {
            npc.pos.set(sx, sw - 1.08 * charScale - 0.08, sz);
            animState = 'swim_surface';
            speedNorm = 0.72;
          } else {
            npc.pos.set(sx, sg, sz);
            animState = dDepth > 0.20 ? 'wade' : 'walk';
            speedNorm = 0.58;
          }
        } else {
          const f = (u - 0.80) / 0.20;
          const wx = THREE.MathUtils.lerp(17.5, laneX, f);
          const wz = THREE.MathUtils.lerp(-1.0, -13.0, f);
          const dx = wx - npc.pos.x;
          const dz = wz - npc.pos.z;
          if (dx * dx + dz * dz > 1e-6) npc.yaw = Math.atan2(dx, dz);
          npc.pos.set(wx, getWalkableSurface(wx, wz, 2.5).y, wz);
          animState = 'walk';
          speedNorm = 0.6;
          npc.lastCycleStep = 3;
        }
      } else if (npc.role === 'volleyball') {
        const side = npc.sideSign ?? 1;
        const vCycle = (elapsedTime * 0.58) % 2.0;
        const targetX = 5.0 + Math.sin(elapsedTime * 0.9) * 1.1;
        npc.pos.x = THREE.MathUtils.lerp(npc.pos.x, targetX, 1.0 - Math.exp(-6.5 * dt));
        // Exact impact window synced 1:1 with CoastalLandmarks volleyball turnaround & trimmed SFX!
        const distToImpact =
          side > 0
            ? Math.min(vCycle, 2.0 - vCycle)
            : Math.abs(vCycle - 1.0);
        const hop = distToImpact < 0.24 ? Math.cos((distToImpact / 0.24) * Math.PI * 0.5) * 0.28 : 0;
        npc.pos.y = getTerrainHeight(npc.pos.x, npc.pos.z) + hop;
        animState = distToImpact < 0.34 ? 'play_ball' : 'idle';
        speedNorm = distToImpact < 0.34 ? 0.9 : 0;
      } else if (npc.role === 'pier_stroller') {
        const walkT = Math.sin(elapsedTime * 0.14);
        const targetZ = 10.5 + walkT * 11.5;
        const dz = targetZ - npc.pos.z;
        npc.pos.z = targetZ;
        npc.pos.y = getWalkableSurface(npc.pos.x, npc.pos.z, 2.2).y;
        const targetYaw = dz >= 0 ? 0 : Math.PI;
        let diff = targetYaw - npc.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        npc.yaw += diff * (1.0 - Math.exp(-5.0 * dt));
        animState = Math.abs(dz) > 0.002 ? 'walk' : 'idle';
        speedNorm = 0.55;
      } else if (npc.role === 'boardwalk_stroller') {
        // Leisurely walk along the wooden boardwalk promenade from -34 to +32!
        const ph = (npc.strollPhase ?? 0) + elapsedTime * 0.048;
        const targetX = -1.0 + Math.sin(ph) * 32.0;
        const dx = targetX - npc.pos.x;
        npc.pos.x = targetX;
        npc.pos.z = -24.65;
        npc.pos.y = getBoardwalkY(npc.pos.x);
        const targetYaw = dx >= 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
        let diff = targetYaw - npc.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        npc.yaw += diff * (1.0 - Math.exp(-5.0 * dt));
        animState = Math.abs(dx) > 0.002 ? 'walk' : 'idle';
        speedNorm = 0.58;
      } else if (npc.role === 'walker' && npc.waypoints) {
        const target = npc.waypoints[npc.waypointIndex ?? 0];
        const dx = target.x - npc.pos.x;
        const dz = target.y - npc.pos.z;
        const dist = Math.hypot(dx, dz);

        if (dist < 0.85) {
          npc.waypointIndex = ((npc.waypointIndex ?? 0) + 1) % npc.waypoints.length;
        }

        let avoidX = 0;
        let avoidZ = 0;
        const pdx = npc.pos.x - playerPos.x;
        const pdz = npc.pos.z - playerPos.z;
        const pDist = Math.hypot(pdx, pdz);
        if (pDist < 1.55 && pDist > 0.01) {
          const push = (1.55 - pDist) * 1.4;
          avoidX = (pdx / pDist) * push;
          avoidZ = (pdz / pDist) * push;
        }

        const dirX = dx / Math.max(dist, 0.001) + avoidX;
        const dirZ = dz / Math.max(dist, 0.001) + avoidZ;
        const dirLen = Math.hypot(dirX, dirZ) || 1;
        const nx = dirX / dirLen;
        const nz = dirZ / dirLen;

        const drag = 1.0 - THREE.MathUtils.clamp(waterDepth * 0.48, 0, 0.45);
        const speed = (npc.walkSpeed ?? 1.4) * drag;

        npc.pos.x += nx * speed * dt;
        npc.pos.z += nz * speed * dt;
        resolveWorldCollisions(npc.pos, 0.36);
        npc.pos.y = getTerrainHeight(npc.pos.x, npc.pos.z);

        const desiredYaw = Math.atan2(nx, nz);
        let diff = desiredYaw - npc.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        npc.yaw += diff * (1.0 - Math.exp(-5.5 * dt));

        animState = waterDepth > 0.24 ? 'wade' : speed > 2.2 ? 'run' : 'walk';
        speedNorm = speed / 2.6;
      } else if (npc.role === 'routine' && npc.waypoints) {
        if ((npc.dwellTimer ?? 0) > 0) {
          npc.dwellTimer = Math.max(0, (npc.dwellTimer ?? 0) - dt);
          animState = (npc.dwellTimer ?? 0) > (npc.dwellDuration ?? 5.0) * 0.72 ? 'wave' : 'chat';
          speedNorm = 0;
        } else {
          const target = npc.waypoints[npc.waypointIndex ?? 0];
          const dx = target.x - npc.pos.x;
          const dz = target.y - npc.pos.z;
          const dist = Math.hypot(dx, dz);

          if (dist < 0.95) {
            npc.waypointIndex = ((npc.waypointIndex ?? 0) + 1) % npc.waypoints.length;
            npc.dwellTimer = npc.dwellDuration ?? 5.5;
            animState = 'idle';
            speedNorm = 0;
          } else {
            let avoidX = 0;
            let avoidZ = 0;
            const pdx = npc.pos.x - playerPos.x;
            const pdz = npc.pos.z - playerPos.z;
            const pDist = Math.hypot(pdx, pdz);
            if (pDist < 1.55 && pDist > 0.01) {
              const push = (1.55 - pDist) * 1.4;
              avoidX = (pdx / pDist) * push;
              avoidZ = (pdz / pDist) * push;
            }
            const dirX = dx / dist + avoidX;
            const dirZ = dz / dist + avoidZ;
            const dirLen = Math.hypot(dirX, dirZ) || 1;
            const nx = dirX / dirLen;
            const nz = dirZ / dirLen;
            const speed = npc.walkSpeed ?? 1.32;

            npc.pos.x += nx * speed * dt;
            npc.pos.z += nz * speed * dt;
            resolveWorldCollisions(npc.pos, 0.36);
            const surf = getWalkableSurface(npc.pos.x, npc.pos.z, npc.pos.y + 0.85);
            npc.pos.y = surf.y;

            const desiredYaw = Math.atan2(nx, nz);
            let diff = desiredYaw - npc.yaw;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            npc.yaw += diff * (1.0 - Math.exp(-5.5 * dt));

            animState = waterDepth > 0.24 ? 'wade' : 'walk';
            speedNorm = speed / 2.6;
          }
        }
      } else if (npc.role === 'dancer') {
        animState = 'dance';
        npc.pos.y = getBoardwalkY(npc.pos.x);
      } else if (npc.role === 'shell_collector') {
        const cycle = (elapsedTime + (npc.strollPhase ?? 0) * 3.0) % 12.0;
        if (cycle < 3.4) {
          // Crouching gently on the wet sand to inspect a colorful shell
          animState = 'build_sand';
          speedNorm = 0;
          npc.pos.y = getTerrainHeight(npc.pos.x, npc.pos.z);
        } else {
          const walkT = elapsedTime * 0.14 + (npc.strollPhase ?? 0);
          const targetX = (npc.homeX ?? 0) + Math.sin(walkT) * 9.5;
          const bayZ = 0.0014 * targetX * targetX - 1.25 * Math.sin(targetX * 0.036) - 0.55 * Math.cos(targetX * 0.075) - 3.6;
          const dx = targetX - npc.pos.x;
          const dz = bayZ - npc.pos.z;
          const stepDist = Math.hypot(dx, dz);
          const maxStep = 1.15 * dt;
          if (stepDist > 0.02) {
            const frac = Math.min(1, maxStep / stepDist);
            npc.pos.x += dx * frac;
            npc.pos.z += dz * frac;
            const desiredYaw = Math.atan2(dx, dz);
            let diff = desiredYaw - npc.yaw;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            npc.yaw += diff * (1.0 - Math.exp(-5.0 * dt));
          }
          npc.pos.y = getTerrainHeight(npc.pos.x, npc.pos.z);
          animState = 'walk';
          speedNorm = 0.48;
        }
      } else if (npc.role === 'raft_lounger') {
        // Lock cleanly to the Floating Ocean Swim Raft deck (-2.0, 21.5) bobbing on live waves!
        const rx = npc.homeX ?? -2.0;
        const rz = npc.homeZ ?? 21.5;
        const raftWaveH = sampleWaveHeight(-2.0, 21.5, elapsedTime, waveIntensity, -3.5);
        npc.pos.set(rx, raftWaveH + 0.28, rz);
        if ((npc.sideSign ?? -1) < 0) {
          // Seated right on the raft edge dangling feet into the turquoise cove!
          animState = 'sit_chair';
          npc.pos.y = raftWaveH - 0.14;
        } else {
          // Standing swimmer waving to the beach every few seconds
          animState = Math.sin(elapsedTime * 0.45) > 0.25 ? 'wave' : 'idle';
        }
      } else if (npc.role === 'surfer') {
        const ang = elapsedTime * 0.34 + (npc.swimPhase ?? 0);
        const cx = npc.swimCenterX ?? -22.0;
        const cz = npc.swimCenterZ ?? 19.0;
        const rx = npc.swimRadiusX ?? 7.0;
        const rz = npc.swimRadiusZ ?? 3.4;
        const sx = cx + Math.cos(ang) * rx;
        const sz = cz + Math.sin(ang) * rz;
        const sh = sampleWaveHeight(sx, sz, elapsedTime, waveIntensity, -2.5);
        npc.pos.set(sx, sh + 0.04, sz);
        const vx = -Math.sin(ang) * rx;
        const vz = Math.cos(ang) * rz;
        npc.yaw = Math.atan2(vx, vz);
        animState = 'yoga';
        speedNorm = 0.2;
        npc.rippleTimer = (npc.rippleTimer ?? 0) - dt;
        if (npc.rippleTimer <= 0) {
          npc.rippleTimer = 0.55;
          waterFX.spawnSplash(sx, sh, sz, 0.52, 4, 0.95);
        }
      } else if (npc.role === 'kayaker') {
        const ang = elapsedTime * 0.22 + (npc.swimPhase ?? 0);
        const cx = npc.swimCenterX ?? 40.0;
        const cz = npc.swimCenterZ ?? 17.0;
        const rx = npc.swimRadiusX ?? 8.0;
        const rz = npc.swimRadiusZ ?? 3.8;
        const kx = cx + Math.cos(ang) * rx;
        const kz = cz + Math.sin(ang) * rz;
        const vx = -Math.sin(ang) * rx;
        const vz = Math.cos(ang) * rz;
        npc.yaw = Math.atan2(vx, vz);
        const fwdX = Math.sin(npc.yaw);
        const fwdZ = Math.cos(npc.yaw);
        const sideX = -fwdZ * 0.42;
        const sideZ = fwdX * 0.42;

        // TRUE 4-Point Multi-Hull Wave Buoyancy (bow, stern, port, starboard) — ZERO sinking in waves!
        const khCenter = sampleWaveHeight(kx, kz, elapsedTime, waveIntensity, -2.2);
        const khBow = sampleWaveHeight(kx + fwdX * 1.4, kz + fwdZ * 1.4, elapsedTime, waveIntensity, -2.2);
        const khStern = sampleWaveHeight(kx - fwdX * 1.4, kz - fwdZ * 1.4, elapsedTime, waveIntensity, -2.2);
        const khPort = sampleWaveHeight(kx + sideX, kz + sideZ, elapsedTime, waveIntensity, -2.2);
        const khStbd = sampleWaveHeight(kx - sideX, kz - sideZ, elapsedTime, waveIntensity, -2.2);
        const avgH = (khCenter * 2.0 + khBow + khStern + khPort + khStbd) / 6.0;
        const crestLift = Math.max(avgH, khCenter * 0.52 + Math.max(khBow, khStern) * 0.48);

        npc.pos.set(kx, crestLift - 0.18, kz);
        const targetPitch = THREE.MathUtils.clamp(-Math.atan2(khBow - khStern, 2.8) * 0.78, -0.30, 0.30);
        const targetRoll = THREE.MathUtils.clamp(Math.atan2(khPort - khStbd, 0.84) * 0.55, -0.24, 0.24);
        npc.hullPitch = THREE.MathUtils.lerp(npc.hullPitch ?? 0, targetPitch, 1.0 - Math.exp(-7.0 * dt));
        npc.hullRoll = THREE.MathUtils.lerp(npc.hullRoll ?? 0, targetRoll, 1.0 - Math.exp(-7.0 * dt));

        animState = 'sit_chair';
        speedNorm = 0;
        if (npc.paddleRef) {
          const stroke = Math.sin(elapsedTime * 2.6 + (npc.swimPhase ?? 0));
          npc.paddleRef.rotation.y = stroke * 0.55;
          npc.paddleRef.rotation.z = stroke * 0.34;
        }
        npc.rippleTimer = (npc.rippleTimer ?? 0) - dt;
        if (npc.rippleTimer <= 0) {
          npc.rippleTimer = 0.65;
          waterFX.spawnSplash(kx, crestLift, kz, 0.44, 4, 0.88);
        }
      } else if (npc.role === 'hammock') {
        animState = 'sunbathe';
        speedNorm = 0;
      } else if (npc.role === 'bonfire_guest') {
        const isSunset = sunDirection.y < 0.30;
        if (isSunset) {
          animState = (npc.sideSign ?? 1) < 0 ? 'dance' : (Math.sin(elapsedTime * 0.9) > 0.1 ? 'wave' : 'chat');
        } else {
          animState = (npc.sideSign ?? 1) < 0 ? 'chat' : 'idle';
        }
        npc.pos.y = getTerrainHeight(npc.pos.x, npc.pos.z);
        speedNorm = 0;
      } else if (npc.role === 'soccer') {
        const sCycle = (elapsedTime * 0.62) % 2.0;
        const nearKick = (npc.sideSign ?? -1) < 0 ? sCycle < 0.25 || sCycle > 1.78 : sCycle > 0.78 && sCycle < 1.25;
        const strafe = Math.sin(elapsedTime * 1.4 + (npc.sideSign ?? 1)) * 0.45;
        npc.pos.z = (npc.homeZ ?? -10.5) + strafe;
        npc.pos.y = getTerrainHeight(npc.pos.x, npc.pos.z);
        animState = nearKick ? 'play_ball' : 'idle';
        speedNorm = nearKick ? 0.85 : 0.0;
      } else if (npc.role === 'coffee_barista') {
        animState = Math.sin(elapsedTime * 0.65) > 0.45 ? 'wave' : 'chat';
        speedNorm = 0;
      } else if (npc.role === 'coffee_guest') {
        animState = Math.sin(elapsedTime * 0.55 + 1.1) > 0.25 ? 'chat' : 'idle';
        speedNorm = 0;
      } else if (npc.role === 'patrol_lifeguard' && npc.waypoints) {
        // Autonomous Patrol & Engagement Lifeguard #2:
        // Reacts dynamically to the player (greets nearby, whistles if swimming far past outer buoy line!),
        // otherwise patrols shoreline, stops to scan offshore swimmers, & blows real lifeguard whistle!
        const distPlayer = Math.hypot(npc.pos.x - playerPos.x, npc.pos.z - playerPos.z);
        const playerFarOut = playerPos.z > 39.5 && Math.abs(playerPos.x) < 48.0;

        if (playerFarOut && distPlayer < 48.0) {
          // Turn toward deep-water player & blow real warning whistle + wave back!
          const toP = Math.atan2(playerPos.x - npc.pos.x, playerPos.z - npc.pos.z);
          let diff = toP - npc.yaw;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          npc.yaw += diff * (1.0 - Math.exp(-6.0 * dt));
          animState = 'whistle_signal';
          speedNorm = 0;
          if (elapsedTime - this.lastLifeguardWhistleAt > 11.0) {
            this.lastLifeguardWhistleAt = elapsedTime;
            sound?.playLifeguardWhistle(npc.pos, cameraPos, cameraQuat);
          }
        } else if (distPlayer < 4.4) {
          // Warmly engage nearby beachgoer / player with a friendly wave!
          const toP = Math.atan2(playerPos.x - npc.pos.x, playerPos.z - npc.pos.z);
          let diff = toP - npc.yaw;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          npc.yaw += diff * (1.0 - Math.exp(-6.0 * dt));
          animState = distPlayer < 2.8 ? 'chat' : 'wave';
          speedNorm = 0;
        } else if ((npc.dwellTimer ?? 0) > 0) {
          npc.dwellTimer = Math.max(0, (npc.dwellTimer ?? 0) - dt);
          // Face seaward (+Z) to scan offshore swimmers & occasionally blow real patrol whistle!
          let diff = 0.0 - npc.yaw;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          npc.yaw += diff * (1.0 - Math.exp(-4.5 * dt));
          const inWhistleWindow = (npc.dwellTimer ?? 0) > 1.8 && (npc.dwellTimer ?? 0) < 3.4;
          animState = inWhistleWindow ? 'whistle_signal' : 'scan_horizon';
          speedNorm = 0;
          if (inWhistleWindow && elapsedTime - this.lastLifeguardWhistleAt > 26.0) {
            this.lastLifeguardWhistleAt = elapsedTime;
            sound?.playLifeguardWhistle(npc.pos, cameraPos, cameraQuat);
          }
        } else {
          const target = npc.waypoints[npc.waypointIndex ?? 0];
          const dx = target.x - npc.pos.x;
          const dz = target.y - npc.pos.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 1.0) {
            npc.waypointIndex = ((npc.waypointIndex ?? 0) + 1) % npc.waypoints.length;
            npc.dwellTimer = npc.dwellDuration ?? 6.0;
            animState = 'scan_horizon';
            speedNorm = 0;
          } else {
            const speed = npc.walkSpeed ?? 1.55;
            npc.pos.x += (dx / dist) * speed * dt;
            npc.pos.z += (dz / dist) * speed * dt;
            resolveWorldCollisions(npc.pos, 0.36);
            npc.pos.y = getTerrainHeight(npc.pos.x, npc.pos.z);
            const desiredYaw = Math.atan2(dx, dz);
            let diff = desiredYaw - npc.yaw;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            npc.yaw += diff * (1.0 - Math.exp(-5.5 * dt));
            animState = waterDepth > 0.20 ? 'wade' : 'walk';
            speedNorm = speed / 2.6;
          }
        }
      } else if (npc.role === 'snorkeler') {
        const ang = elapsedTime * 0.16 + (npc.swimPhase ?? 0);
        const cx = npc.swimCenterX ?? 0;
        const cz = npc.swimCenterZ ?? 30;
        const rx = npc.swimRadiusX ?? 6.0;
        const rz = npc.swimRadiusZ ?? 3.4;
        const sx = cx + Math.cos(ang) * rx;
        const sz = cz + Math.sin(ang) * rz;
        const sh = sampleWaveHeight(sx, sz, elapsedTime, waveIntensity, -4.0);
        npc.pos.set(sx, sh - 0.92, sz);
        const vx = -Math.sin(ang) * rx;
        const vz = Math.cos(ang) * rz;
        npc.yaw = Math.atan2(vx, vz);
        animState = 'snorkel_kick';
        speedNorm = 0.45;
        npc.rippleTimer = (npc.rippleTimer ?? 0) - dt;
        if (npc.rippleTimer <= 0) {
          npc.rippleTimer = 0.72;
          waterFX.spawnRipple(sx, sz, 0.42, 1.05);
          particles.emitBubbles(new THREE.Vector3(sx, sh - 0.35, sz), 3, 0.25, 0.65);
        }
      } else if (npc.role === 'tube_floater') {
        const cx = (npc.swimCenterX ?? 0) + Math.sin(elapsedTime * 0.24 + (npc.swimPhase ?? 0)) * 1.4;
        const cz = (npc.swimCenterZ ?? 18) + Math.cos(elapsedTime * 0.19 + (npc.swimPhase ?? 0)) * 1.1;
        const fh = sampleWaveHeight(cx, cz, elapsedTime, waveIntensity, -3.2);
        npc.pos.set(cx, fh - 0.34, cz);
        npc.yaw = 0.4 + Math.sin(elapsedTime * 0.32 + (npc.swimPhase ?? 0)) * 0.45;
        animState = 'float_tube';
        speedNorm = 0;
      } else if (npc.role === 'sup_boarder') {
        const ang = elapsedTime * 0.19 + (npc.swimPhase ?? 0);
        const cx = npc.swimCenterX ?? 26;
        const cz = npc.swimCenterZ ?? 29;
        const rx = npc.swimRadiusX ?? 8.5;
        const rz = npc.swimRadiusZ ?? 4.0;
        const bx = cx + Math.cos(ang) * rx;
        const bz = cz + Math.sin(ang) * rz;
        const bh = sampleWaveHeight(bx, bz, elapsedTime, waveIntensity, -3.8);
        npc.pos.set(bx, bh + 0.05, bz);
        const vx = -Math.sin(ang) * rx;
        const vz = Math.cos(ang) * rz;
        npc.yaw = Math.atan2(vx, vz);
        animState = 'sup_paddle';
        speedNorm = 0.45;
        if (npc.paddleRef) {
          const stroke = Math.sin(elapsedTime * 2.2 + (npc.swimPhase ?? 0));
          npc.paddleRef.rotation.x = 0.22 + stroke * 0.42;
          npc.paddleRef.position.z = 0.24 + stroke * 0.14;
        }
        npc.rippleTimer = (npc.rippleTimer ?? 0) - dt;
        if (npc.rippleTimer <= 0) {
          npc.rippleTimer = 0.68;
          waterFX.spawnRipple(bx, bz, 0.48, 1.25);
        }
      }

      // Record smooth horizontal velocity for real-time GPU WaterRippleSim wake injection
      const invDt = dt > 0.0001 ? 1.0 / dt : 0;
      npc.velX = THREE.MathUtils.clamp((npc.pos.x - prevNpcX) * invDt, -6, 6);
      npc.velZ = THREE.MathUtils.clamp((npc.pos.z - prevNpcZ) * invDt, -6, 6);

      npc.character.root.position.copy(npc.pos);
      if (npc.role === 'sunbathe' || npc.role === 'lounge') {
        getTerrainNormal(npc.pos.x, npc.pos.z, this._tmpNorm);
        this._alignQ.setFromUnitVectors(this._upVec, this._tmpNorm);
        this._yawQ.setFromAxisAngle(this._upVec, npc.yaw);
        npc.character.root.quaternion.copy(this._alignQ).multiply(this._yawQ);
      } else if (npc.role === 'hammock') {
        // Gentle hammock breeze sway aligned cleanly along the canvas sling!
        npc.character.root.rotation.set(0, npc.yaw, Math.sin(elapsedTime * 0.9 + (npc.strollPhase ?? 0)) * 0.06);
      } else if (npc.role === 'kayaker') {
        // Live 4-point wave pitch & roll on NPC kayaks!
        npc.character.root.rotation.set(npc.hullPitch ?? 0, npc.yaw, npc.hullRoll ?? 0);
      } else if (npc.role === 'surfer' || npc.role === 'sup_boarder' || npc.role === 'tube_floater') {
        const tilt = Math.sin(elapsedTime * 1.8 + (npc.swimPhase ?? 0)) * 0.07 * waveIntensity;
        npc.character.root.rotation.set(tilt * 0.6, npc.yaw, tilt);
      } else {
        npc.character.root.rotation.y = npc.yaw;
      }

      // Natural head-glance toward the player when strolling/standing nearby (< 7.5m)!
      let headLookYaw = 0;
      if (npc.role === 'citizen' || npc.role === 'patrol_lifeguard' || npc.role === 'bartender' || npc.role === 'coffee_barista' || npc.role === 'terrace_diner' || npc.role === 'bar_patron') {
        const toPx = playerPos.x - npc.pos.x;
        const toPz = playerPos.z - npc.pos.z;
        const distP = Math.hypot(toPx, toPz);
        if (distP < 7.5 && distP > 0.4) {
          let relYaw = Math.atan2(toPx, toPz) - npc.yaw;
          while (relYaw > Math.PI) relYaw -= Math.PI * 2;
          while (relYaw < -Math.PI) relYaw += Math.PI * 2;
          if (Math.abs(relYaw) < 1.15) {
            const weight = THREE.MathUtils.smoothstep(7.5 - distP, 0, 4.0);
            headLookYaw = THREE.MathUtils.clamp(relYaw * 0.55 * weight, -0.52, 0.52);
          }
        }
      }

      const { footPlant } = npc.character.updateAnimation(
        animState,
        dt,
        elapsedTime,
        speedNorm,
        0,
        waveH,
        sunDirection,
        sunColor,
        headLookYaw
      );

      if (footPlant && (npc.role === 'citizen' || npc.role === 'walker' || npc.role === 'jogger' || npc.role === 'routine' || npc.role === 'shell_collector' || npc.role === 'patrol_lifeguard')) {
        const footGroundH = getTerrainHeight(footPlant.worldPos.x, footPlant.worldPos.z);
        const footWaterDepth = Math.max(0, waveH - footGroundH);
        if (footWaterDepth < 0.75) {
          footprints.stamp(
            footPlant.worldPos.x,
            footPlant.worldPos.z,
            npc.yaw,
            footPlant.foot === 'right',
            footWaterDepth > 0.15 ? 0.72 : 0.90,
            0.96
          );
        }
        if (footWaterDepth > 0.04 && footWaterDepth < 1.0) {
          waterFX.spawnSplash(footPlant.worldPos.x, waveH, footPlant.worldPos.z, 0.55, 5, 1.05);
          particles.emitBubbles(footPlant.worldPos, 2, 0.20, 0.50);
        }
      }
    }
  }
}
