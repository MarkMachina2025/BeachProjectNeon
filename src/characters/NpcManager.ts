import * as THREE from 'three';
import { HumanAppearance, HumanCharacter, HumanAnimState } from './HumanRig';
import { RestSpot } from '../environment/BeachProps';
import { getTerrainHeight, resolveWorldCollisions } from '../terrain/terrainMath';
import { sampleWaveHeight } from '../ocean/wavePhysics';
import { FootprintSystem } from '../terrain/FootprintSystem';
import { UnderwaterParticles } from '../ocean/UnderwaterParticles';
import { WaterInteractionSystem } from '../ocean/WaterInteractionSystem';

interface NpcAgent {
  character: HumanCharacter;
  role: 'sunbathe' | 'lounge' | 'chat' | 'walker' | 'water_play';
  pos: THREE.Vector3;
  yaw: number;
  waypoints?: THREE.Vector2[];
  waypointIndex?: number;
  walkSpeed?: number;
  pauseTimer?: number;
  rippleTimer?: number;
}

/**
 * Manages 8 recognizable human NPCs with varied skin tones, hairstyles, summer swimwear,
 * and distinct coastal behaviors:
 *  - 2 sunbathing on beach towels
 *  - 1 reclining on a wooden lounge chair
 *  - 2 idling & chatting near the shoreline
 *  - 3 actively walking along the sandy shore & wading into shallow water
 *    (leaving real left/right footprints in the RTT sand deformation buffer!)
 */
export class NpcManager {
  public readonly group = new THREE.Group();
  public readonly agents: NpcAgent[] = [];

  constructor(restSpots: RestSpot[]) {
    this.group.name = 'BeachNPCs';

    const appearances: HumanAppearance[] = [
      // 0: Sunbather 1 (towel)
      {
        gender: 'female',
        height: 1.68,
        skinHex: 0xe6b38f,
        hairHex: 0x3b2417,
        hairStyle: 'long_wavy',
        outfitStyle: 'bikini',
        primaryColor: 0xe85d56,
        secondaryColor: 0xe85d56,
        sunglasses: true
      },
      // 1: Sunbather 2 (towel)
      {
        gender: 'male',
        height: 1.80,
        skinHex: 0x8a5534,
        hairHex: 0x181412,
        hairStyle: 'short_crop',
        outfitStyle: 'boardshorts',
        primaryColor: 0x2299a8,
        secondaryColor: 0xf4d35e,
        sunglasses: true
      },
      // 2: Lounge chair relaxer
      {
        gender: 'female',
        height: 1.66,
        skinHex: 0xf1c7a6,
        hairHex: 0xd9a85b,
        hairStyle: 'top_bun',
        outfitStyle: 'onepiece',
        primaryColor: 0x1d6f8a,
        secondaryColor: 0xffffff,
        sunglasses: true
      },
      // 3: Chatting near water A
      {
        gender: 'male',
        height: 1.82,
        skinHex: 0xd1956b,
        hairHex: 0x261a14,
        hairStyle: 'surfer_waves',
        outfitStyle: 'linen_shirt',
        primaryColor: 0x2b4c7e,
        secondaryColor: 0xf8f3e8
      },
      // 4: Chatting near water B
      {
        gender: 'female',
        height: 1.70,
        skinHex: 0x623b24,
        hairHex: 0x141010,
        hairStyle: 'curly_crown',
        outfitStyle: 'bikini',
        primaryColor: 0xf4a236,
        secondaryColor: 0xf4a236
      },
      // 5: Shoreline Walker & Wader 1
      {
        gender: 'female',
        height: 1.71,
        skinHex: 0xbc7c52,
        hairHex: 0x4f2c1a,
        hairStyle: 'ponytail',
        outfitStyle: 'onepiece',
        primaryColor: 0xdf586b,
        secondaryColor: 0xfff5ec
      },
      // 6: Shoreline Walker & Wader 2
      {
        gender: 'male',
        height: 1.78,
        skinHex: 0xedc09d,
        hairHex: 0x6b4b2c,
        hairStyle: 'short_crop',
        outfitStyle: 'boardshorts',
        primaryColor: 0x2f8f6b,
        secondaryColor: 0xffe08a
      },
      // 7: Shoreline Walker & Wader 3
      {
        gender: 'male',
        height: 1.76,
        skinHex: 0xa46842,
        hairHex: 0x1c1715,
        hairStyle: 'curly_crown',
        outfitStyle: 'rashguard',
        primaryColor: 0x1f5c99,
        secondaryColor: 0x35d6c8
      }
    ];

    const towels = restSpots.filter((s) => s.kind === 'towel');
    const chairs = restSpots.filter((s) => s.kind === 'chair');

    // Place 2 sunbathers on beach towels
    for (let i = 0; i < 2; i++) {
      const spot = towels[i] ?? { position: new THREE.Vector3(-12 + i * 16, getTerrainHeight(-12 + i * 16, -10), -10), yaw: 0 };
      const char = new HumanCharacter(appearances[i]);
      const pos = spot.position.clone();
      char.root.position.copy(pos);
      char.root.rotation.y = spot.yaw;
      this.group.add(char.root);
      this.agents.push({ character: char, role: 'sunbathe', pos, yaw: spot.yaw });
    }

    // Place 1 lounger on wooden reclining chair
    const chairSpot = chairs[0] ?? { position: new THREE.Vector3(9, getTerrainHeight(9, -11), -11), yaw: -0.2 };
    const lounger = new HumanCharacter(appearances[2]);
    const chairPos = chairSpot.position.clone();
    lounger.root.position.copy(chairPos);
    lounger.root.rotation.y = chairSpot.yaw;
    this.group.add(lounger.root);
    this.agents.push({ character: lounger, role: 'lounge', pos: chairPos, yaw: chairSpot.yaw });

    // Place 2 chatting NPCs near the water's edge
    const chatA = new THREE.Vector3(4.2, getTerrainHeight(4.2, -3.6), -3.6);
    const chatB = new THREE.Vector3(5.35, getTerrainHeight(5.35, -3.25), -3.25);
    const yawA = Math.atan2(chatB.x - chatA.x, chatB.z - chatA.z);
    const yawB = Math.atan2(chatA.x - chatB.x, chatA.z - chatB.z);

    const npcChatA = new HumanCharacter(appearances[3]);
    npcChatA.root.position.copy(chatA);
    npcChatA.root.rotation.y = yawA;
    this.group.add(npcChatA.root);
    this.agents.push({ character: npcChatA, role: 'chat', pos: chatA, yaw: yawA });

    const npcChatB = new HumanCharacter(appearances[4]);
    npcChatB.root.position.copy(chatB);
    npcChatB.root.rotation.y = yawB;
    this.group.add(npcChatB.root);
    this.agents.push({ character: npcChatB, role: 'chat', pos: chatB, yaw: yawB });

    // Place 3 active shoreline walkers & shallow-water waders across the expanded beach
    const patrolPaths: THREE.Vector2[][] = [
      [
        new THREE.Vector2(-24, -5.2),
        new THREE.Vector2(-9, -2.8),
        new THREE.Vector2(3, 2.2),
        new THREE.Vector2(15, 4.4),
        new THREE.Vector2(24, -2.5),
        new THREE.Vector2(12, -7.2),
        new THREE.Vector2(-8, -7.6)
      ],
      [
        new THREE.Vector2(26, -4.2),
        new THREE.Vector2(13, -2.0),
        new THREE.Vector2(-2, 3.2),
        new THREE.Vector2(-14, 4.8),
        new THREE.Vector2(-25, -1.6),
        new THREE.Vector2(-12, -6.2),
        new THREE.Vector2(8, -6.6)
      ],
      [
        new THREE.Vector2(-11, -8.5),
        new THREE.Vector2(-3, -3.6),
        new THREE.Vector2(5, 2.6),
        new THREE.Vector2(-4, 5.4),
        new THREE.Vector2(-16, 1.5),
        new THREE.Vector2(-19, -6.5)
      ]
    ];

    for (let i = 0; i < 3; i++) {
      const path = patrolPaths[i];
      const start = path[0];
      const pos = new THREE.Vector3(start.x, getTerrainHeight(start.x, start.y), start.y);
      const next = path[1];
      const yaw = Math.atan2(next.x - start.x, next.y - start.y);

      const walker = new HumanCharacter(appearances[5 + i]);
      walker.root.position.copy(pos);
      walker.root.rotation.y = yaw;
      this.group.add(walker.root);

      this.agents.push({
        character: walker,
        role: 'walker',
        pos,
        yaw,
        waypoints: path,
        waypointIndex: 1,
        walkSpeed: 1.35 + i * 0.14,
        pauseTimer: 0,
        rippleTimer: 0
      });
    }

    // Place 2 lively beachgoers playing/splashing in the shallow water near the beach ball & swim ring
    const waterPlaySpecs: Array<{ x: number; z: number; yaw: number; app: HumanAppearance }> = [
      {
        x: 5.4,
        z: 6.4,
        yaw: 0.75,
        app: {
          gender: 'female',
          height: 1.48,
          skinHex: 0xdeab85,
          hairHex: 0x3b2314,
          hairStyle: 'ponytail',
          outfitStyle: 'onepiece',
          primaryColor: 0xff6b81,
          secondaryColor: 0xfff3d6
        }
      },
      {
        x: -8.3,
        z: 7.9,
        yaw: -0.65,
        app: {
          gender: 'male',
          height: 1.52,
          skinHex: 0x9c623d,
          hairHex: 0x181412,
          hairStyle: 'short_crop',
          outfitStyle: 'boardshorts',
          primaryColor: 0x2ec4b6,
          secondaryColor: 0xffbf69
        }
      }
    ];

    for (const wp of waterPlaySpecs) {
      const pos = new THREE.Vector3(wp.x, getTerrainHeight(wp.x, wp.z), wp.z);
      const char = new HumanCharacter(wp.app);
      char.root.position.copy(pos);
      char.root.rotation.y = wp.yaw;
      this.group.add(char.root);
      this.agents.push({
        character: char,
        role: 'water_play',
        pos,
        yaw: wp.yaw,
        rippleTimer: Math.random() * 0.8
      });
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
    playerPos: THREE.Vector3
  ): void {
    for (let i = 0; i < this.agents.length; i++) {
      const npc = this.agents[i];
      const terrainH = getTerrainHeight(npc.pos.x, npc.pos.z);
      const waveH = sampleWaveHeight(npc.pos.x, npc.pos.z, elapsedTime, waveIntensity, terrainH);
      const waterDepth = Math.max(0, waveH - terrainH);

      let animState: HumanAnimState = 'idle';
      let speedNorm = 0;

      if (npc.role === 'sunbathe') {
        animState = 'sunbathe';
        npc.pos.y = terrainH;
      } else if (npc.role === 'lounge') {
        animState = 'lounge';
        npc.pos.y = terrainH;
      } else if (npc.role === 'chat') {
        animState = 'chat';
        npc.pos.y = terrainH;
      } else if (npc.role === 'water_play') {
        animState = 'tread';
        npc.pos.y = terrainH + Math.max(0, Math.sin(elapsedTime * 2.4 + i) * 0.08);
        npc.yaw += Math.sin(elapsedTime * 0.8 + i) * 0.35 * dt;
        npc.rippleTimer = (npc.rippleTimer ?? 0) - dt;
        if (npc.rippleTimer <= 0 && waterDepth > 0.15) {
          npc.rippleTimer = 0.75 + Math.random() * 0.55;
          waterFX.spawnSplash(npc.pos.x, waveH, npc.pos.z, 0.72, 7, 1.35);
        }
      } else if (npc.role === 'walker' && npc.waypoints) {
        const target = npc.waypoints[npc.waypointIndex ?? 0];
        const dx = target.x - npc.pos.x;
        const dz = target.y - npc.pos.z;
        const dist = Math.hypot(dx, dz);

        if (dist < 0.75) {
          npc.waypointIndex = ((npc.waypointIndex ?? 0) + 1) % npc.waypoints.length;
        }

        // Gently yield around the player so NPCs never clip through you
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

        // Progressive water drag while wading in shallow bay
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

        animState = waterDepth > 0.24 ? 'wade' : 'walk';
        speedNorm = speed / 2.0;
      }

      npc.character.root.position.copy(npc.pos);
      npc.character.root.rotation.y = npc.yaw;

      const { footPlant } = npc.character.updateAnimation(
        animState,
        dt,
        elapsedTime,
        speedNorm,
        0,
        waveH,
        sunDirection,
        sunColor
      );

      // Stamp real left/right footprints into the RTT sand buffer on foot-plant!
      if (footPlant && npc.role === 'walker') {
        const footGroundH = getTerrainHeight(footPlant.worldPos.x, footPlant.worldPos.z);
        const footWaterDepth = Math.max(0, waveH - footGroundH);
        if (footWaterDepth < 0.75) {
          const strength = footWaterDepth > 0.15 ? 0.75 : 0.92;
          footprints.stamp(
            footPlant.worldPos.x,
            footPlant.worldPos.z,
            npc.yaw,
            footPlant.foot === 'right',
            strength,
            0.96
          );
        }
        // Realistic wading water splash droplets, expanding concentric ripples & bubbles!
        if (footWaterDepth > 0.06 && footWaterDepth < 1.1) {
          waterFX.spawnSplash(footPlant.worldPos.x, waveH, footPlant.worldPos.z, 0.72, 9, 1.25);
          particles.emitBubbles(footPlant.worldPos, 3, 0.22, 0.55);
        }
      }
    }
  }
}
