import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getTerrainHeight } from '../terrain/terrainMath';
import { sampleWaveHeight } from '../ocean/wavePhysics';
import type { SoundEngine } from '../audio/SoundEngine';
import type { WaterInteractionSystem } from '../ocean/WaterInteractionSystem';
import type { UnderwaterParticles } from '../ocean/UnderwaterParticles';

export type WeatherMode = 'clear' | 'breeze' | 'mist' | 'rain';

export interface GoldenShell {
  id: number;
  name: string;
  clue: string;
  pos: THREE.Vector3;
  collected: boolean;
  phase: number;
}

/**
 * Interactive Showcase & Living World Systems (tightly batched to ~6 total draw calls!):
 *  1. 10 Collectible Shimmering Golden Pearls/Shells across landmarks & underwater reefs
 *  2. Real-physics Player-Kickable Striped Beach Ball (sand bounce, spin, ocean wave buoyancy & splashes!)
 *  3. Dynamic Coastal Weather & Passing Sunshower GPU Rainfall Curtain
 *  4. Pair of Leaping Coastal Dolphins arcing over the outer turquoise surf + splash bursts
 *  5. Occasional Twilight Shooting Stars streaking across the sunset sky
 */
export class InteractiveWorld {
  public readonly group = new THREE.Group();
  public readonly waterGroup = new THREE.Group();

  // 1. Golden Shells Scavenger Hunt (1 InstancedMesh + 1 burst Points)
  public readonly shells: GoldenShell[] = [];
  private shellInst!: THREE.InstancedMesh;
  private shellBurstMat!: THREE.ShaderMaterial;
  private shellBurstPos!: THREE.BufferAttribute;
  private shellBurstVel: Float32Array = new Float32Array(28 * 3);
  private shellBurstAge = 99;
  private readonly shellDummy = new THREE.Object3D();
  public onShellCollected?: (shell: GoldenShell, totalCollected: number, total: number) => void;

  // 2. Player-Kickable Physics Beach Ball
  public readonly kickBallMesh: THREE.Mesh;
  public readonly kickBallPos = new THREE.Vector3(-6.8, 0, -7.2);
  private readonly kickBallVel = new THREE.Vector3(0, 0, 0);
  private kickCooldown = 0;

  // 3. Weather Rain Curtain (hidden unless weather === 'rain')
  public weather: WeatherMode = 'clear';
  private rainMesh!: THREE.Points;
  private rainMat!: THREE.ShaderMaterial;
  private rainStrength = 0;

  // 4. Pair of Leaping Outer-Bay Dolphins
  private readonly dolphins: Array<{ group: THREE.Mesh; phase: number; laneX: number; laneZ: number; lastBreach: number }> = [];

  // 5. Twilight Shooting Star
  private shootingStar!: THREE.Line;
  private shootingStarMat!: THREE.LineBasicMaterial;

  // 6. Bioluminescent Deep-Reef Jellyfish (single InstancedMesh = 1 draw call!)
  private jellyInst!: THREE.InstancedMesh;
  private jellyMat!: THREE.MeshStandardMaterial;
  private readonly jellies: Array<{ cx: number; cy: number; cz: number; phase: number; sc: number }> = [];

  // 7. Interactive Underwater Sunken Treasure Chest beside Sunken Anchor (17.0, y, 24.4)
  public readonly treasurePos = new THREE.Vector3(17.0, 0, 24.4);
  public treasureOpened = false;
  private treasureLid!: THREE.Group;
  private treasureLidAngle = 0;

  // 8. Player-Blown Rising 3D Underwater Bubble Rings ([F] underwater!)
  private readonly bubbleRings: Array<{ mesh: THREE.Mesh; vel: THREE.Vector3; age: number; active: boolean }> = [];

  // 9. Ethereal Sunlit Coastal Rainbow Arc (visible during Passing Sunshower!)
  private rainbowMesh!: THREE.Mesh;
  private rainbowMat!: THREE.ShaderMaterial;

  constructor() {
    this.group.name = 'InteractiveWorld';
    this.waterGroup.name = 'InteractiveWaterLife';

    this.buildGoldenShells();
    this.kickBallMesh = this.buildKickableBeachBall();
    this.buildWeatherRain();
    this.buildLeapingDolphins();
    this.buildShootingStar();
    this.buildReefJellyfish();
    this.buildSunkenTreasureChest();
    this.buildBubbleRingPool();
    this.buildSunshowerRainbow();
  }

  public get collectedCount(): number {
    let n = 0;
    for (let i = 0; i < this.shells.length; i++) {
      if (this.shells[i].collected) n++;
    }
    return n;
  }

  public getNearestUncollectedShell(from: THREE.Vector3): GoldenShell | null {
    let best: GoldenShell | null = null;
    let bestD2 = Infinity;
    for (let i = 0; i < this.shells.length; i++) {
      const s = this.shells[i];
      if (s.collected) continue;
      const dx = s.pos.x - from.x;
      const dz = s.pos.z - from.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = s;
      }
    }
    return best;
  }

  private buildGoldenShells(): void {
    const spots: Array<{ name: string; clue: string; x: number; z: number; yOverride?: number }> = [
      { name: 'West Stone Fort Trail', clue: 'Climb the hillside path below the round stone watchtower', x: -53.8, z: -36.5 },
      { name: 'West Palm Hammock Grove', clue: 'Tucked near the twin woven hammocks on the far west dunes', x: -57.2, z: -27.5 },
      { name: 'Bonfire Sunset Ring', clue: 'Warming beside the western stone fire pit & ukulele log', x: -40.8, z: -18.5 },
      { name: 'Neon Tiki Promenade', clue: 'Shimmering right in front of the Neon Tiki Surf Bar steps', x: -22.0, z: -23.4 },
      { name: 'Central Shore Cove', clue: 'Resting along the sunlit central waterline near spawn', x: -1.5, z: -6.5 },
      { name: 'Ocean Pier Overlook', clue: 'Walk all the way out to the end of the 28m wooden Ocean Pier', x: 22.0, z: 22.2, yOverride: 2.85 },
      { name: 'Floating Swim Raft', clue: 'Swim or kayak out to the bobbing teak Swim Raft', x: -2.0, z: 21.5, yOverride: 0.95 },
      { name: 'East Lagoon Overlook', clue: 'Near the bronze Manta Ray monument & brass telescope deck', x: 52.8, z: -21.8 },
      { name: 'Sunken Anchor Wreck', clue: 'Dive beneath the turquoise waters off the East Pier tip', x: 17.0, z: 25.5, yOverride: -2.05 },
      { name: 'Deep Coral Reef Sanctuary', clue: 'Dive deep over the glowing coral heads & sea turtles', x: -2.5, z: 36.5, yOverride: -2.65 }
    ];

    // Sculpted iridescent golden pearl nested in a fluted shell cradle (merged to 1 geo!)
    const shellHalf = new THREE.SphereGeometry(0.24, 8, 6, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55);
    shellHalf.scale(1.15, 0.72, 1.0);
    const pearl = new THREE.SphereGeometry(0.14, 8, 6);
    pearl.translate(0, 0.08, 0);
    const halo = new THREE.TorusGeometry(0.27, 0.018, 5, 14);
    halo.rotateX(Math.PI / 2);
    halo.translate(0, 0.04, 0);
    const merged = mergeGeometries([shellHalf.toNonIndexed(), pearl.toNonIndexed(), halo.toNonIndexed()], false)!;
    shellHalf.dispose();
    pearl.dispose();
    halo.dispose();

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffe07a,
      emissive: 0xffa62b,
      emissiveIntensity: 0.72,
      roughness: 0.22,
      metalness: 0.72
    });

    this.shellInst = new THREE.InstancedMesh(merged, mat, spots.length);
    this.shellInst.castShadow = false;
    this.shellInst.frustumCulled = false;

    spots.forEach((sp, i) => {
      const y = sp.yOverride !== undefined ? sp.yOverride : getTerrainHeight(sp.x, sp.z) + 0.42;
      this.shells.push({
        id: i,
        name: sp.name,
        clue: sp.clue,
        pos: new THREE.Vector3(sp.x, y, sp.z),
        collected: false,
        phase: i * 0.85
      });
      this.shellDummy.position.set(sp.x, y, sp.z);
      this.shellDummy.updateMatrix();
      this.shellInst.setMatrixAt(i, this.shellDummy.matrix);
    });
    this.shellInst.instanceMatrix.needsUpdate = true;
    this.group.add(this.shellInst);

    // Golden sparkle burst Points when collecting a shell
    const burstGeo = new THREE.BufferGeometry();
    const posArr = new Float32Array(28 * 3);
    this.shellBurstPos = new THREE.BufferAttribute(posArr, 3);
    burstGeo.setAttribute('position', this.shellBurstPos);
    this.shellBurstMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uAlpha: { value: 0 } },
      vertexShader: /* glsl */ `
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(24.0 * (10.0 / max(1.0, -mv.z)), 3.0, 28.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.05, d) * uAlpha;
          gl_FragColor = vec4(1.0, 0.88, 0.38, a);
        }
      `
    });
    const burstPts = new THREE.Points(burstGeo, this.shellBurstMat);
    burstPts.frustumCulled = false;
    this.group.add(burstPts);
  }

  private triggerShellBurst(origin: THREE.Vector3): void {
    this.shellBurstAge = 0;
    const arr = this.shellBurstPos.array as Float32Array;
    for (let i = 0; i < 28; i++) {
      arr[i * 3] = origin.x;
      arr[i * 3 + 1] = origin.y;
      arr[i * 3 + 2] = origin.z;
      const a = (i / 28) * Math.PI * 2 + Math.random() * 0.4;
      const spd = 1.4 + Math.random() * 2.4;
      this.shellBurstVel[i * 3] = Math.cos(a) * spd;
      this.shellBurstVel[i * 3 + 1] = 1.6 + Math.random() * 2.6;
      this.shellBurstVel[i * 3 + 2] = Math.sin(a) * spd;
    }
    this.shellBurstPos.needsUpdate = true;
  }

  private buildKickableBeachBall(): THREE.Mesh {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 128;
    const ctx = cv.getContext('2d')!;
    const stripes = ['#ff595e', '#ffffff', '#1982c4', '#ffffff', '#ffca3a', '#ffffff'];
    const w = cv.width / stripes.length;
    stripes.forEach((col, idx) => {
      ctx.fillStyle = col;
      ctx.fillRect(idx * w, 0, w + 1, cv.height);
    });
    ctx.fillStyle = '#38e2d8';
    ctx.fillRect(0, 0, cv.width, 14);
    ctx.fillRect(0, cv.height - 14, cv.width, 14);

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 14, 10),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.28, metalness: 0.04 })
    );
    mesh.castShadow = true;
    const gy = getTerrainHeight(this.kickBallPos.x, this.kickBallPos.z);
    this.kickBallPos.y = gy + 0.24;
    mesh.position.copy(this.kickBallPos);
    this.group.add(mesh);
    return mesh;
  }

  public kickBeachBall(fromPos: THREE.Vector3, power = 7.8, sound?: SoundEngine, cameraPos?: THREE.Vector3, cameraQuat?: THREE.Quaternion): void {
    const dx = this.kickBallPos.x - fromPos.x;
    const dz = this.kickBallPos.z - fromPos.z;
    const len = Math.hypot(dx, dz) || 1;
    this.kickBallVel.set((dx / len) * power, 3.6 + power * 0.25, (dz / len) * power);
    this.kickCooldown = 0.28;
    sound?.playBallHit(this.kickBallPos, cameraPos, 'player_ball', cameraQuat);
  }

  private buildWeatherRain(): void {
    const count = 420;
    const offsets = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      offsets[i * 3] = (Math.random() - 0.5) * 34;
      offsets[i * 3 + 1] = Math.random() * 18;
      offsets[i * 3 + 2] = (Math.random() - 0.5) * 34;
      seeds[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(offsets, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    this.rainMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uStrength: { value: 0 }
      },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime;
        uniform vec3 uCenter;
        varying float vAlpha;
        void main() {
          float fall = fract(aSeed - uTime * 0.85);
          vec3 p = position;
          p.x += uCenter.x + (1.0 - fall) * 1.4;
          p.z += uCenter.z + (1.0 - fall) * 0.5;
          p.y = max(0.2, uCenter.y - 2.0 + fall * 18.0);
          vAlpha = smoothstep(0.0, 0.15, fall) * smoothstep(1.0, 0.78, fall);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp(12.0 * (10.0 / max(1.0, -mv.z)), 1.5, 10.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uStrength;
        varying float vAlpha;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          // Elongated vertical raindrop streak
          if (abs(uv.x) > 0.14 || abs(uv.y) > 0.48) discard;
          float a = (1.0 - abs(uv.x) / 0.14) * (1.0 - abs(uv.y) / 0.48) * vAlpha * uStrength * 0.55;
          gl_FragColor = vec4(0.84, 0.93, 1.0, a);
        }
      `
    });
    this.rainMesh = new THREE.Points(geo, this.rainMat);
    this.rainMesh.visible = false;
    this.rainMesh.frustumCulled = false;
    this.group.add(this.rainMesh);
  }

  private buildLeapingDolphins(): void {
    const body = new THREE.SphereGeometry(0.32, 10, 8);
    body.scale(0.85, 0.9, 3.1);
    const snout = new THREE.ConeGeometry(0.14, 0.48, 7);
    snout.rotateX(Math.PI / 2);
    snout.translate(0, -0.02, 1.08);
    const dorsal = new THREE.ConeGeometry(0.12, 0.42, 5);
    dorsal.rotateX(-0.35);
    dorsal.translate(0, 0.34, -0.05);
    const fluke = new THREE.BoxGeometry(0.68, 0.045, 0.28);
    fluke.translate(0, 0.0, -0.96);

    const merged = mergeGeometries(
      [body.toNonIndexed(), snout.toNonIndexed(), dorsal.toNonIndexed(), fluke.toNonIndexed()],
      false
    )!;
    body.dispose();
    snout.dispose();
    dorsal.dispose();
    fluke.dispose();

    const mat = new THREE.MeshStandardMaterial({
      color: 0x5c7c96,
      roughness: 0.22,
      metalness: 0.18
    });

    const specs = [
      { phase: 0.0, laneX: -12.0, laneZ: 54.0 },
      { phase: 0.48, laneX: -7.5, laneZ: 57.5 }
    ];
    for (const sp of specs) {
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = false;
      this.waterGroup.add(m);
      this.dolphins.push({ group: m, phase: sp.phase, laneX: sp.laneX, laneZ: sp.laneZ, lastBreach: -1 });
    }
  }

  private buildShootingStar(): void {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(-12, 3.5, 0)
    ]);
    this.shootingStarMat = new THREE.LineBasicMaterial({
      color: 0xfff6d6,
      transparent: true,
      opacity: 0
    });
    this.shootingStar = new THREE.Line(geo, this.shootingStarMat);
    this.shootingStar.visible = false;
    this.group.add(this.shootingStar);
  }

  private buildReefJellyfish(): void {
    const bell = new THREE.SphereGeometry(0.24, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.62);
    bell.scale(1.0, 0.85, 1.0);
    const parts: THREE.BufferGeometry[] = [bell.toNonIndexed()];
    bell.dispose();
    for (let t = 0; t < 4; t++) {
      const a = (t / 4) * Math.PI * 2;
      const tent = new THREE.CylinderGeometry(0.016, 0.004, 0.56, 4);
      tent.translate(Math.cos(a) * 0.09, -0.28, Math.sin(a) * 0.09);
      parts.push(tent.toNonIndexed());
      tent.dispose();
    }
    const merged = mergeGeometries(parts, false)!;
    for (const p of parts) p.dispose();

    this.jellyMat = new THREE.MeshStandardMaterial({
      color: 0xbef8ff,
      emissive: 0x5eead4,
      emissiveIntensity: 0.75,
      transparent: true,
      opacity: 0.74,
      roughness: 0.2
    });
    const spots = [
      { cx: -6.5, cy: -2.5, cz: 34.0, ph: 0.2, sc: 1.05, col: 0x72efdd },
      { cx: 1.5, cy: -2.9, cz: 40.5, ph: 1.5, sc: 0.92, col: 0xff8fab },
      { cx: 9.5, cy: -2.3, cz: 33.0, ph: 2.8, sc: 1.12, col: 0x90e0ef },
      { cx: -12.0, cy: -3.1, cz: 43.0, ph: 4.1, sc: 0.88, col: 0xc77dff },
      { cx: 15.5, cy: -2.6, cz: 38.5, ph: 5.0, sc: 1.0, col: 0x72efdd },
      { cx: -1.0, cy: -3.3, cz: 46.5, ph: 3.4, sc: 1.15, col: 0xffb3c6 }
    ];
    this.jellyInst = new THREE.InstancedMesh(merged, this.jellyMat, spots.length);
    const col = new THREE.Color();
    spots.forEach((s, i) => {
      this.jellies.push({ cx: s.cx, cy: s.cy, cz: s.cz, phase: s.ph, sc: s.sc });
      col.setHex(s.col);
      this.jellyInst.setColorAt(i, col);
    });
    if (this.jellyInst.instanceColor) this.jellyInst.instanceColor.needsUpdate = true;
    this.waterGroup.add(this.jellyInst);
  }

  private buildSunkenTreasureChest(): void {
    const tx = 17.0;
    const tz = 24.4;
    const ty = getTerrainHeight(tx, tz) + 0.02;
    this.treasurePos.set(tx, ty, tz);

    const g = new THREE.Group();
    g.position.set(tx, ty, tz);
    g.rotation.y = -0.45;

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x4f3522, roughness: 0.85 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.34, metalness: 0.82 });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xffd75e,
      emissive: 0xffaa22,
      emissiveIntensity: 0.9,
      roughness: 0.22,
      metalness: 0.85
    });

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.44, 0.56), woodMat);
    base.position.y = 0.22;
    g.add(base);

    const band = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.08, 0.60), brassMat);
    band.position.y = 0.38;
    g.add(band);

    const goldPile = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), goldMat);
    goldPile.scale.set(1.25, 0.45, 0.72);
    goldPile.position.y = 0.42;
    g.add(goldPile);

    // Hinged lid pivoting cleanly along rear edge (-Z)
    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, 0.44, -0.28);
    const lidGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.92, 8, 1, false, 0, Math.PI);
    lidGeo.rotateZ(Math.PI / 2);
    const lid = new THREE.Mesh(lidGeo, woodMat);
    lid.position.set(0, 0, 0.28);
    lidPivot.add(lid);
    this.treasureLid = lidPivot;
    g.add(lidPivot);

    this.waterGroup.add(g);
  }

  public openSunkenTreasure(particles: UnderwaterParticles, sound?: SoundEngine): boolean {
    if (this.treasureOpened) return false;
    this.treasureOpened = true;
    this.triggerShellBurst(new THREE.Vector3(this.treasurePos.x, this.treasurePos.y + 0.5, this.treasurePos.z));
    particles.emitBubbles(new THREE.Vector3(this.treasurePos.x, this.treasurePos.y + 0.45, this.treasurePos.z), 22, 0.6, 1.4);
    sound?.playTreasureOpen();
    return true;
  }

  private buildBubbleRingPool(): void {
    const geo = new THREE.TorusGeometry(0.24, 0.032, 6, 16);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xdffbff,
      emissive: 0x72efdd,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.62,
      roughness: 0.1
    });
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      this.waterGroup.add(m);
      this.bubbleRings.push({ mesh: m, vel: new THREE.Vector3(), age: 99, active: false });
    }
  }

  public blowBubbleRing(origin: THREE.Vector3, forward: THREE.Vector3, sound?: SoundEngine): void {
    let slot = this.bubbleRings.find((r) => !r.active) ?? this.bubbleRings[0];
    slot.active = true;
    slot.age = 0;
    slot.mesh.visible = true;
    slot.mesh.position.copy(origin).addScaledVector(forward, 0.65);
    slot.mesh.scale.setScalar(0.55);
    slot.vel.set(forward.x * 1.1, 0.85, forward.z * 1.1);
    sound?.playBubbleRing();
  }

  private buildSunshowerRainbow(): void {
    const geo = new THREE.PlaneGeometry(170, 56);
    this.rainbowMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          vec2 p = vec2((vUv.x - 0.5) * 2.0, vUv.y);
          float r = length(p);
          float band = smoothstep(0.68, 0.78, r) * (1.0 - smoothstep(0.88, 0.98, r));
          float t = clamp((r - 0.72) / 0.22, 0.0, 1.0);
          vec3 col = 0.55 + 0.45 * cos(6.28318 * (t * 0.82 + vec3(0.0, 0.33, 0.67)));
          float fade = smoothstep(0.0, 0.18, vUv.y) * band * uOpacity * 0.42;
          if (fade < 0.004) discard;
          gl_FragColor = vec4(col, fade);
        }
      `
    });
    this.rainbowMesh = new THREE.Mesh(geo, this.rainbowMat);
    this.rainbowMesh.position.set(12, 22, 165);
    this.rainbowMesh.visible = false;
    this.group.add(this.rainbowMesh);
  }

  public setWeather(mode: WeatherMode, sound?: SoundEngine): void {
    this.weather = mode;
    sound?.setWeatherRain(mode === 'rain' ? 1.0 : 0.0);
  }

  public update(
    dt: number,
    elapsedTime: number,
    waveIntensity: number,
    sunDirection: THREE.Vector3,
    playerPos: THREE.Vector3,
    cameraPos: THREE.Vector3,
    cameraQuat: THREE.Quaternion,
    waterFX: WaterInteractionSystem,
    particles: UnderwaterParticles,
    sound?: SoundEngine
  ): void {
    // 1. Update shimmering Golden Shells + check collection
    for (let i = 0; i < this.shells.length; i++) {
      const s = this.shells[i];
      if (s.collected) {
        this.shellDummy.position.set(0, -100, 0);
        this.shellDummy.scale.setScalar(0.001);
        this.shellDummy.updateMatrix();
        this.shellInst.setMatrixAt(i, this.shellDummy.matrix);
        continue;
      }
      const bob = Math.sin(elapsedTime * 2.2 + s.phase) * 0.10;
      const dist = playerPos.distanceTo(s.pos);
      if (dist < 2.25) {
        s.collected = true;
        this.triggerShellBurst(s.pos);
        sound?.playCollectChime();
        this.onShellCollected?.(s, this.collectedCount, this.shells.length);
        this.shellDummy.position.set(0, -100, 0);
        this.shellDummy.scale.setScalar(0.001);
      } else {
        this.shellDummy.position.set(s.pos.x, s.pos.y + bob, s.pos.z);
        this.shellDummy.rotation.set(0.18, elapsedTime * 1.4 + s.phase, 0);
        this.shellDummy.scale.setScalar(1.0);
      }
      this.shellDummy.updateMatrix();
      this.shellInst.setMatrixAt(i, this.shellDummy.matrix);
    }
    this.shellInst.instanceMatrix.needsUpdate = true;

    if (this.shellBurstAge < 1.1) {
      this.shellBurstAge += dt;
      const arr = this.shellBurstPos.array as Float32Array;
      for (let i = 0; i < 28; i++) {
        this.shellBurstVel[i * 3 + 1] -= 5.2 * dt;
        arr[i * 3] += this.shellBurstVel[i * 3] * dt;
        arr[i * 3 + 1] += this.shellBurstVel[i * 3 + 1] * dt;
        arr[i * 3 + 2] += this.shellBurstVel[i * 3 + 2] * dt;
      }
      this.shellBurstPos.needsUpdate = true;
      this.shellBurstMat.uniforms.uAlpha.value = Math.max(0, 1.0 - this.shellBurstAge / 1.1);
    } else {
      this.shellBurstMat.uniforms.uAlpha.value = 0;
    }

    // 2. Player-Kickable Beach Ball Physics (sand bounce + live wave buoyancy!)
    this.kickCooldown = Math.max(0, this.kickCooldown - dt);
    const dxP = this.kickBallPos.x - playerPos.x;
    const dzP = this.kickBallPos.z - playerPos.z;
    const dyP = Math.abs(this.kickBallPos.y - (playerPos.y + 0.55));
    const distP = Math.hypot(dxP, dzP);
    if (distP < 0.78 && dyP < 1.1 && this.kickCooldown <= 0) {
      this.kickBeachBall(playerPos, 6.4, sound, cameraPos, cameraQuat);
    }

    const ballTerrain = getTerrainHeight(this.kickBallPos.x, this.kickBallPos.z);
    const ballWave = sampleWaveHeight(this.kickBallPos.x, this.kickBallPos.z, elapsedTime, waveIntensity, ballTerrain);
    const inWater = ballWave > ballTerrain + 0.14 && this.kickBallPos.y <= ballWave + 0.25;

    if (inWater) {
      const sub = ballWave + 0.14 - this.kickBallPos.y;
      this.kickBallVel.y += sub * 18.0 * dt;
      this.kickBallVel.multiplyScalar(Math.exp(-2.2 * dt));
      // Gentle shoreward wave drift so ball never floats out to the horizon forever
      if (this.kickBallPos.z > 22) this.kickBallVel.z -= 1.4 * dt;
    } else {
      this.kickBallVel.y -= 13.5 * dt;
    }

    this.kickBallPos.addScaledVector(this.kickBallVel, dt);
    const newGround = getTerrainHeight(this.kickBallPos.x, this.kickBallPos.z);
    if (this.kickBallPos.y < newGround + 0.24) {
      this.kickBallPos.y = newGround + 0.24;
      if (this.kickBallVel.y < -1.2) {
        this.kickBallVel.y = -this.kickBallVel.y * 0.62;
        if (ballWave > newGround + 0.1) {
          waterFX.spawnSplash(this.kickBallPos.x, ballWave, this.kickBallPos.z, 0.65, 8, 1.2);
        } else {
          sound?.playBallHit(this.kickBallPos, cameraPos, 'player_ball', cameraQuat);
        }
      } else {
        this.kickBallVel.y = 0;
      }
      this.kickBallVel.x *= Math.exp(-2.4 * dt);
      this.kickBallVel.z *= Math.exp(-2.4 * dt);
    }

    // Keep playable within the scenic bay
    this.kickBallPos.x = THREE.MathUtils.clamp(this.kickBallPos.x, -56, 56);
    this.kickBallPos.z = THREE.MathUtils.clamp(this.kickBallPos.z, -24, 34);
    this.kickBallMesh.position.copy(this.kickBallPos);
    this.kickBallMesh.rotation.x += this.kickBallVel.z * dt * 2.5;
    this.kickBallMesh.rotation.z -= this.kickBallVel.x * dt * 2.5;

    // 3. Weather Rain Curtain update
    const targetRain = this.weather === 'rain' ? 1.0 : 0.0;
    this.rainStrength = THREE.MathUtils.lerp(this.rainStrength, targetRain, 1.0 - Math.exp(-3.0 * dt));
    this.rainMesh.visible = this.rainStrength > 0.02;
    if (this.rainMesh.visible) {
      this.rainMat.uniforms.uTime.value = elapsedTime;
      this.rainMat.uniforms.uCenter.value.copy(cameraPos);
      this.rainMat.uniforms.uStrength.value = this.rainStrength;
    }

    // 4. Pair of Leaping Coastal Dolphins arcing over the outer turquoise surf!
    for (let i = 0; i < this.dolphins.length; i++) {
      const d = this.dolphins[i];
      const loopAng = elapsedTime * 0.15 + d.phase;
      const x = d.laneX + Math.sin(loopAng) * 24.0;
      const z = d.laneZ + Math.cos(loopAng * 0.7) * 5.5;
      const leapCycle = (elapsedTime * 0.36 + d.phase * 1.4) % 1.0;
      // Graceful parabolic breach for 42% of cycle, cruising shallow underwater for 58%
      const wH = sampleWaveHeight(x, z, elapsedTime, waveIntensity, -8.0);
      let y = wH - 0.85;
      let pitch = 0;
      if (leapCycle < 0.42) {
        const u = leapCycle / 0.42;
        y = wH - 0.55 + Math.sin(u * Math.PI) * 2.55;
        pitch = -Math.cos(u * Math.PI) * 0.78;
        const step = u < 0.15 ? 1 : u > 0.85 ? 2 : 0;
        if (step > 0 && d.lastBreach !== step) {
          d.lastBreach = step;
          waterFX.spawnSplash(x, wH, z, 1.25, 12, 1.5);
          particles.emitBubbles(new THREE.Vector3(x, wH - 0.3, z), 6, 0.4, 0.9);
        }
      } else {
        d.lastBreach = 0;
      }
      const vx = Math.cos(loopAng) * 24.0 * 0.15;
      const vz = -Math.sin(loopAng * 0.7) * 5.5 * 0.15 * 0.7;
      d.group.position.set(x, y, z);
      d.group.rotation.set(pitch, Math.atan2(vx, vz), 0);
    }

    // 5. Occasional Twilight Shooting Star when sun sinks low!
    const isTwilight = sunDirection.y < 0.18;
    const starCycle = (elapsedTime * 0.11) % 1.0;
    if (isTwilight && starCycle < 0.14) {
      const u = starCycle / 0.14;
      this.shootingStar.visible = true;
      this.shootingStar.position.set(
        THREE.MathUtils.lerp(-65, 65, u),
        THREE.MathUtils.lerp(118, 86, u),
        175
      );
      this.shootingStarMat.opacity = Math.sin(u * Math.PI) * 0.88;
    } else {
      this.shootingStar.visible = false;
    }

    // 6. Bioluminescent Deep-Reef Jellyfish pulsing smoothly over the coral reef
    const duskGlow = 1.0 - THREE.MathUtils.smoothstep(sunDirection.y, 0.08, 0.42);
    this.jellyMat.emissiveIntensity = 0.55 + duskGlow * 1.15;
    for (let i = 0; i < this.jellies.length; i++) {
      const j = this.jellies[i];
      const pulse = Math.sin(elapsedTime * 2.1 + j.phase);
      const jx = j.cx + Math.sin(elapsedTime * 0.28 + j.phase) * 1.4;
      const jz = j.cz + Math.cos(elapsedTime * 0.24 + j.phase) * 1.2;
      const jy = j.cy + pulse * 0.26;
      this.shellDummy.position.set(jx, jy, jz);
      this.shellDummy.rotation.set(Math.sin(elapsedTime * 0.7 + j.phase) * 0.12, elapsedTime * 0.2, 0);
      this.shellDummy.scale.set(j.sc * (1.0 - pulse * 0.12), j.sc * (1.0 + pulse * 0.14), j.sc * (1.0 - pulse * 0.12));
      this.shellDummy.updateMatrix();
      this.jellyInst.setMatrixAt(i, this.shellDummy.matrix);
    }
    this.jellyInst.instanceMatrix.needsUpdate = true;

    // 7. Smooth Sunken Treasure Chest hinged lid opening
    if (this.treasureOpened && this.treasureLidAngle < 1.35) {
      this.treasureLidAngle = Math.min(1.35, this.treasureLidAngle + dt * 2.4);
      this.treasureLid.rotation.x = -this.treasureLidAngle;
    }

    // 8. Rising player-blown 3D Underwater Bubble Rings
    for (let i = 0; i < this.bubbleRings.length; i++) {
      const br = this.bubbleRings[i];
      if (!br.active) continue;
      br.age += dt;
      br.mesh.position.addScaledVector(br.vel, dt);
      br.vel.x *= Math.exp(-1.5 * dt);
      br.vel.z *= Math.exp(-1.5 * dt);
      const grow = 0.55 + br.age * 0.72;
      br.mesh.scale.set(grow, 1.0, grow);
      br.mesh.rotation.z = Math.sin(elapsedTime * 4.5 + i) * 0.14;
      if (br.age > 3.2 || br.mesh.position.y > -0.15) {
        br.active = false;
        br.mesh.visible = false;
      }
    }

    // 9. Ethereal Sunlit Rainbow Arc during Passing Sunshower weather
    const showRainbow = this.rainStrength > 0.15 && sunDirection.y > 0.14;
    this.rainbowMesh.visible = showRainbow;
    if (showRainbow) {
      this.rainbowMat.uniforms.uOpacity.value = this.rainStrength * THREE.MathUtils.clamp((sunDirection.y - 0.14) * 3.0, 0, 1);
    }
  }
}
