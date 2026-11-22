import * as THREE from 'three';
import { HumanAnimState, HumanCharacter } from '../characters/HumanRig';
import { getTerrainHeight, getTerrainNormal, getWalkableSurface, resolveWorldCollisions } from '../terrain/terrainMath';
import { sampleWaveHeight } from '../ocean/wavePhysics';
import { FootprintSystem } from '../terrain/FootprintSystem';
import { UnderwaterParticles } from '../ocean/UnderwaterParticles';
import { WaterInteractionSystem } from '../ocean/WaterInteractionSystem';
import { SoundEngine } from '../audio/SoundEngine';
import { sampleWaterSlide, WATER_SLIDE_LAUNCH } from '../environment/CoastalLandmarks';

export type LocomotionMode =
  | 'DRY SAND'
  | 'WET SAND'
  | 'BOARDWALK'
  | 'JUMPING'
  | 'FALLING'
  | 'SLIDING'
  | 'KAYAKING'
  | 'RELAXING'
  | 'WADING'
  | 'SWIMMING'
  | 'DIVING';

export interface InteractiveSitSpot {
  label: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pose: 'sit_chair' | 'sunbathe';
  exitBack?: boolean;
}

/**
 * Responsive 3rd-person / 1st-person player character & damped spring-arm camera controller.
 *  - Smooth locomotion state transitions: Dry/Wet Sand -> Progressive Wading -> Buoyant Surface Swim -> Diving
 *  - WASD directional movement/swim (aligned to camera pitch underwater), Shift sprint/fast-swim,
 *    Space jump/ascend/surface, C/Ctrl dive down, V toggle 1st/3rd person
 *  - Damped spring-arm orbit camera with terrain collision avoidance & zero jitter
 *  - Exact left/right foot-plant sand footprints + granular footstep & swim audio hooks
 */
export class PlayerController {
  public character: HumanCharacter;
  public readonly position = new THREE.Vector3(0, 0, -10.5);
  public readonly velocity = new THREE.Vector3();
  public yaw = 0; // Character facing yaw (0 = +Z looking out to sea)
  public camYaw = 0; // Camera orbit yaw (0 = camera behind player looking toward +Z)
  public camPitch = 0.22; // Radians: positive = looking slightly down from above
  public camDistance = 4.4;
  public firstPerson = false;

  public mode: LocomotionMode = 'DRY SAND';
  public waterDepthAtPlayer = 0;
  public waterMoveSpeed = 0;
  public isUsingShower = false;
  public cameraSubmersion = 0; // > 0 when camera lens is below live wave surface
  public surfaceWetness = 0;   // 0..1 lens water droplets when surfacing from underwater dive
  public nearbyPrompt = '';    // Contextual [E] interaction hint (e.g. Water Slide)

  private readonly keys = new Set<string>();
  private readonly sceneRef: THREE.Scene;
  private isGrounded = true;
  private isSwimming = false;
  private isSliding = false;
  private isKayaking = false;
  public isFloatingRing = false;
  private isUsingTelescope = false;
  public floatRingRef?: { pos: THREE.Vector3; mesh: THREE.Mesh; setRiderActive: (v: boolean) => void };
  private activeSitSpot: InteractiveSitSpot | null = null;
  private interactJustPressed = false;
  private bubbleRingJustPressed = false;
  private slideT = 0;
  private slideCooldown = 0;
  private swimPitch = 0;
  private kayakSpeed = 0;
  private kayakPitch = 0;
  private kayakRoll = 0;
  private showerTimer = 0;
  private wetDripTimer = 0;
  private wetBodyTimer = 0;
  private outfitPresetIndex = 0;
  public speedBoostTimer = 0;
  public mouseLockEnabled = true;
  public welcomeMode = true;
  private swoopT = 1.0;
  private readonly swoopFromPos = new THREE.Vector3();
  private readonly swoopFromLook = new THREE.Vector3();
  private playerKayakGroup!: THREE.Group;
  private playerKayakPaddle!: THREE.Object3D;
  private sitSpots: InteractiveSitSpot[] = [];
  private kayakLaunchPos = new THREE.Vector3(46.5, 0, -6.2);
  private telescopePos = new THREE.Vector3(48.5, 0, -27.45);
  private treasurePos = new THREE.Vector3(17.0, -3.0, 24.4);
  public isTreasureOpened?: () => boolean;
  public onVolleyBeachBall?: () => void;
  public onOrderDrink?: (venue: 'tiki' | 'coffee') => void;
  public onBonfireStrum?: () => void;
  public onOpenTreasure?: () => void;
  public onBlowBubbleRing?: (origin: THREE.Vector3, forward: THREE.Vector3) => void;
  public onTelescopeChange?: (active: boolean) => void;
  public onOutfitChanged?: (label: string) => void;
  public patrolLifeguardPosGetter?: () => THREE.Vector3 | null;
  public onChatLifeguard?: () => void;
  public kickBallPosRef?: THREE.Vector3;
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private bubbleTimer = 0;
  private wakeRippleTimer = 0;
  private wasInWater = false;
  private wasCameraUnderwater = false;
  private groundSurface: 'sand' | 'wood' = 'sand';

  private readonly smoothedCamPos = new THREE.Vector3();
  private readonly smoothedLookAt = new THREE.Vector3();
  private camInitialized = false;

  private readonly _forward = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _moveDir = new THREE.Vector3();
  private readonly _up = new THREE.Vector3(0, 1, 0);
  private readonly _slopeNorm = new THREE.Vector3();
  private readonly _bubbleOrigin = new THREE.Vector3();

  public onFirstInteraction?: () => void;

  constructor(canvas: HTMLCanvasElement, scene: THREE.Scene) {
    this.sceneRef = scene;
    this.character = new HumanCharacter({
      gender: 'male',
      height: 1.78,
      skinHex: 0xd9a17a,
      hairHex: 0x2a1d15,
      hairStyle: 'surfer_waves',
      outfitStyle: 'boardshorts',
      primaryColor: 0x168aad,
      secondaryColor: 0x38e2d8,
      sunglasses: true,
      watch: true,
      useWaterCaustics: true
    });

    this.position.set(0, getTerrainHeight(0, -10.5), -10.5);
    this.character.root.position.copy(this.position);
    scene.add(this.character.root);

    this.buildPlayerKayakMesh();
    try {
      const saved = window.localStorage.getItem('neoncove_mouselock');
      if (saved === '0') this.mouseLockEnabled = false;
    } catch {
      // ignore storage errors
    }
    this.bindInput(canvas);
  }

  public setMouseLockEnabled(enabled: boolean): boolean {
    this.mouseLockEnabled = enabled;
    if (!enabled && document.pointerLockElement) {
      document.exitPointerLock?.();
    }
    try {
      window.localStorage.setItem('neoncove_mouselock', enabled ? '1' : '0');
    } catch {
      // ignore
    }
    return this.mouseLockEnabled;
  }

  public toggleMouseLock(): boolean {
    return this.setMouseLockEnabled(!this.mouseLockEnabled);
  }

  public enterPlayMode(instant = false): void {
    if (!this.welcomeMode) return;
    this.welcomeMode = false;
    if (instant) {
      this.swoopT = 1.0;
      this.camInitialized = false;
    } else {
      this.swoopFromPos.copy(this.smoothedCamPos);
      this.swoopFromLook.copy(this.smoothedLookAt);
      this.swoopT = 0.0;
    }
  }

  private buildPlayerKayakMesh(): void {
    const g = new THREE.Group();
    // Sculpted high-freeboard touring coastal kayak hull (single clean hull — ZERO deck Z-fighting!)
    const hullGeo = new THREE.SphereGeometry(1, 16, 10);
    hullGeo.scale(0.42, 0.25, 1.90);
    const hull = new THREE.Mesh(
      hullGeo,
      new THREE.MeshStandardMaterial({ color: 0xff6b35, roughness: 0.28, metalness: 0.08 })
    );
    hull.position.set(0, 0.42, 0.05);
    g.add(hull);

    // Raised black spray-skirt cockpit coaming rim
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.28, 0.038, 7, 14),
      new THREE.MeshStandardMaterial({ color: 0x1e242b, roughness: 0.60 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(1.0, 1.48, 1.0);
    rim.position.set(0, 0.63, 0.05);
    g.add(rim);

    // Sleek 3-part coastal double-blade paddle (carbon shaft + contoured bright twin blades!)
    const paddleGroup = new THREE.Group();
    paddleGroup.position.set(0, 0.96, 0.34);
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.017, 0.017, 2.04, 7),
      new THREE.MeshStandardMaterial({ color: 0x222830, roughness: 0.42, metalness: 0.25 })
    );
    shaft.rotation.z = Math.PI / 2;
    paddleGroup.add(shaft);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.32 });
    const bladeGeo = new THREE.BoxGeometry(0.42, 0.145, 0.018);
    for (const side of [-1, 1]) {
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.position.set(side * 1.16, 0, 0);
      blade.rotation.x = side * 0.22;
      paddleGroup.add(blade);
    }
    g.add(paddleGroup);

    g.visible = false;
    this.playerKayakGroup = g;
    this.playerKayakPaddle = paddleGroup;
    this.character.root.add(g);
  }

  private cycleBeachOutfit(): void {
    const presets: Array<{ label: string; app: ConstructorParameters<typeof HumanCharacter>[0] }> = [
      {
        label: 'Ocean Surfer Boardshorts',
        app: { gender: 'male', height: 1.78, skinHex: 0xd9a17a, hairHex: 0x2a1d15, hairStyle: 'surfer_waves', outfitStyle: 'boardshorts', primaryColor: 0x168aad, secondaryColor: 0x38e2d8, sunglasses: true, watch: true, useWaterCaustics: true }
      },
      {
        label: 'Coral Reef Rashguard + Snorkel',
        app: { gender: 'male', height: 1.78, skinHex: 0xd9a17a, hairHex: 0x2a1d15, hairStyle: 'surfer_waves', outfitStyle: 'rashguard', primaryColor: 0x1b4965, secondaryColor: 0x00d9c0, snorkelGear: true, watch: true, useWaterCaustics: true }
      },
      {
        label: 'Sunset Linen Resort Shirt',
        app: { gender: 'male', height: 1.78, skinHex: 0xd9a17a, hairHex: 0x2a1d15, hairStyle: 'surfer_waves', outfitStyle: 'linen_shirt', primaryColor: 0x264653, secondaryColor: 0xfff3d6, sunglasses: true, sandals: true, necklace: true, useWaterCaustics: true }
      },
      {
        label: 'Neon Cove Rescue Lifeguard Kit',
        app: { gender: 'male', height: 1.78, skinHex: 0xd9a17a, hairHex: 0x2a1d15, hairStyle: 'surfer_waves', outfitStyle: 'boardshorts', primaryColor: 0xd62828, secondaryColor: 0xffd166, isLifeguard: true, sunglasses: true, useWaterCaustics: true }
      }
    ];
    this.outfitPresetIndex = (this.outfitPresetIndex + 1) % presets.length;
    const chosen = presets[this.outfitPresetIndex];
    const oldRoot = this.character.root;
    this.sceneRef.remove(oldRoot);
    this.character = new HumanCharacter(chosen.app);
    this.character.root.position.copy(this.position);
    this.character.root.rotation.y = this.yaw;
    this.character.root.visible = !this.firstPerson;
    this.character.root.add(this.playerKayakGroup);
    this.sceneRef.add(this.character.root);
    this.onOutfitChanged?.(chosen.label);
  }

  public setInteractiveSpots(
    sitSpots: InteractiveSitSpot[],
    kayakLaunchPos: THREE.Vector3,
    telescopePos?: THREE.Vector3,
    treasurePos?: THREE.Vector3
  ): void {
    this.sitSpots = sitSpots;
    this.kayakLaunchPos.copy(kayakLaunchPos);
    if (telescopePos) this.telescopePos.copy(telescopePos);
    if (treasurePos) this.treasurePos.copy(treasurePos);
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'KeyE' && !e.repeat) {
        this.interactJustPressed = true;
      }
      if (e.code === 'KeyF' && !e.repeat) {
        this.bubbleRingJustPressed = true;
      }
      this.keys.add(e.code);
      if (!this.welcomeMode) this.onFirstInteraction?.();

      if (e.code === 'Space' && document.activeElement === document.body) {
        e.preventDefault();
      }
      if (e.code === 'KeyV' && !this.welcomeMode) {
        this.togglePerspective();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.isDragging = false;
    });

    // Click canvas to request pointer lock (only when Mouse Lock toggle is ON & not on Welcome Screen!)
    canvas.addEventListener('pointerdown', (e) => {
      if (this.welcomeMode) return;
      this.onFirstInteraction?.();
      if (e.button === 0) {
        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        if (this.mouseLockEnabled && document.pointerLockElement !== canvas && canvas.requestPointerLock) {
          try {
            const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
            if (p && typeof p.catch === 'function') p.catch(() => {});
          } catch {
            // Pointer lock may be declined in automated/headless contexts; drag orbit still works
          }
        }
      }
    });

    window.addEventListener('pointerup', () => {
      this.isDragging = false;
    });

    window.addEventListener('mousemove', (e) => {
      const sensitivity = 0.0026;
      if (document.pointerLockElement === canvas) {
        this.camYaw -= e.movementX * sensitivity;
        this.camPitch = THREE.MathUtils.clamp(
          this.camPitch + e.movementY * sensitivity,
          -1.15,
          1.28
        );
      } else if (this.isDragging) {
        const dx = e.clientX - this.lastMouseX;
        const dy = e.clientY - this.lastMouseY;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        this.camYaw -= dx * 0.0045;
        this.camPitch = THREE.MathUtils.clamp(
          this.camPitch + dy * 0.0045,
          -1.15,
          1.28
        );
      }
    });

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.camDistance = THREE.MathUtils.clamp(this.camDistance + e.deltaY * 0.0035, 2.2, 8.5);
      },
      { passive: false }
    );
  }

  public togglePerspective(): boolean {
    this.firstPerson = !this.firstPerson;
    this.character.root.visible = !this.firstPerson;
    return this.firstPerson;
  }

  /**
   * Programmatic teleport helper (also useful for testing/verification).
   */
  public teleportTo(x: number, y: number, z: number, yaw = 0, pitch = 0.15): void {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.camYaw = yaw;
    this.camPitch = pitch;
    const terrainH = getTerrainHeight(x, z);
    const walkable = getWalkableSurface(x, z, y + 0.55);
    const onWoodDeck = walkable.surface === 'wood' && y >= walkable.y - 0.35;
    this.groundSurface = walkable.surface;
    this.isGrounded = y <= walkable.y + 0.08;
    this.isSwimming = !onWoodDeck && (y < -0.5 || (terrainH < -1.2 && y <= 0.35));
    this.surfaceWetness = 0;
    this.wasCameraUnderwater = false;
    this.welcomeMode = false;
    this.swoopT = 1.0;
    this.isSliding = false;
    this.isKayaking = false;
    if (this.isFloatingRing) {
      this.isFloatingRing = false;
      this.floatRingRef?.setRiderActive(false);
    }
    this.isUsingShower = false;
    this.showerTimer = 0;
    if (this.isUsingTelescope) {
      this.isUsingTelescope = false;
      this.onTelescopeChange?.(false);
    }
    this.activeSitSpot = null;
    this.interactJustPressed = false;
    this.bubbleRingJustPressed = false;
    this.nearbyPrompt = '';
    this.kayakSpeed = 0;
    if (this.playerKayakGroup) this.playerKayakGroup.visible = false;
    this.slideT = 0;
    this.slideCooldown = 0;
    this.camInitialized = false;
  }

  public update(
    dt: number,
    elapsedTime: number,
    waveIntensity: number,
    camera: THREE.PerspectiveCamera,
    sunDirection: THREE.Vector3,
    sunColor: THREE.Color,
    footprints: FootprintSystem,
    particles: UnderwaterParticles,
    waterFX: WaterInteractionSystem,
    sound: SoundEngine
  ): void {
    const terrainH = getTerrainHeight(this.position.x, this.position.z);
    const waveH = sampleWaveHeight(this.position.x, this.position.z, elapsedTime, waveIntensity, terrainH);
    const waveHPrev = sampleWaveHeight(this.position.x, this.position.z, elapsedTime - 0.05, waveIntensity, terrainH);
    const waveVy = THREE.MathUtils.clamp((waveH - waveHPrev) / 0.05, -2.5, 2.5);
    const waveHx = sampleWaveHeight(this.position.x + 0.45, this.position.z, elapsedTime, waveIntensity, terrainH);
    const waveHz = sampleWaveHeight(this.position.x, this.position.z + 0.45, elapsedTime, waveIntensity, terrainH);
    // Horizontal Gerstner orbital wave surge pushes player gently with incoming swells!
    const surgeX = -(waveHx - waveH) * 1.45;
    const surgeZ = -(waveHz - waveH) * 1.85;

    const onElevatedWood = this.groundSurface === 'wood' && this.position.y > waveH + 0.35;
    const waterDepth = onElevatedWood ? 0 : Math.max(0, waveH - terrainH);
    this.waterDepthAtPlayer = waterDepth;

    this.slideCooldown = Math.max(0, this.slideCooldown - dt);

    // Input axes
    const moveFwd = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
                    (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const moveSide = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
                     (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const ascend = this.keys.has('Space');
    const dive = this.keys.has('KeyC') || this.keys.has('ControlLeft') || this.keys.has('ControlRight');

    const interactNow = this.interactJustPressed;
    this.interactJustPressed = false;
    const bubbleNow = this.bubbleRingJustPressed;
    this.bubbleRingJustPressed = false;
    this.speedBoostTimer = Math.max(0, this.speedBoostTimer - dt);

    if (this.welcomeMode) {
      // Idle gentle wave on beach while live aerial showcase camera sweeps over Neon Cove!
      this.nearbyPrompt = '';
      this.character.root.position.copy(this.position);
      this.character.root.rotation.y = this.yaw;
      this.character.updateAnimation('idle', dt, elapsedTime, 0, 0, waveH, sunDirection, sunColor);
      this.updateCamera(dt, elapsedTime, waveIntensity, camera, sound);
      return;
    }

    // Contextual [E] & [F] interaction detection!
    this.nearbyPrompt = '';
    if (this.isUsingTelescope) {
      this.nearbyPrompt = 'Mouse to Scan Horizon • Press E or Move to Exit Telescope';
      if (interactNow || moveFwd !== 0 || moveSide !== 0) {
        this.isUsingTelescope = false;
        this.onTelescopeChange?.(false);
      }
    } else if (this.isKayaking) {
      this.nearbyPrompt = 'Press E to Disembark Kayak';
      if (interactNow) {
        this.isKayaking = false;
        this.kayakSpeed = 0;
        this.playerKayakGroup.visible = false;
        // If close to shore, step onto sand; otherwise enter swim cleanly
        const curDepth = waveH - terrainH;
        if (curDepth < 0.75) {
          this.isSwimming = false;
          this.isGrounded = true;
          this.position.y = Math.max(terrainH, waveH);
        } else {
          this.isSwimming = true;
          this.isGrounded = false;
          this.position.y = waveH - 1.05;
        }
        sound.playSplash(0.55);
      }
    } else if (this.isFloatingRing && this.floatRingRef) {
      this.nearbyPrompt = 'WASD to Drift • Press E or Space to Exit Swim Ring';
      if (interactNow || ascend) {
        this.isFloatingRing = false;
        this.floatRingRef.setRiderActive(false);
        this.isSwimming = true;
        this.isGrounded = false;
        this.position.y = waveH - 1.05;
        sound.playSplash(0.45);
      }
    } else if (this.activeSitSpot) {
      this.nearbyPrompt = 'Move or Press E to Stand Up';
      if (interactNow || moveFwd !== 0 || moveSide !== 0 || ascend) {
        const exitYaw = this.activeSitSpot.yaw;
        const exitDir = this.activeSitSpot.exitBack ? -1 : 1;
        this.activeSitSpot = null;
        // Step cleanly onto open walkable deck (forward from benches, backward away from picnic/café tables!)
        this.position.x += Math.sin(exitYaw) * 0.50 * exitDir;
        this.position.z += Math.cos(exitYaw) * 0.50 * exitDir;
        this.position.y = getWalkableSurface(this.position.x, this.position.z, this.position.y + 0.8).y;
        this.isGrounded = true;
      }
    } else if (this.isSwimming) {
      // Check Interactive Pink/White Swim Ring nearby!
      const ringDist = this.floatRingRef
        ? Math.hypot(this.position.x - this.floatRingRef.pos.x, this.position.z - this.floatRingRef.pos.z)
        : 999;
      // Underwater Sunken Treasure Chest & [F] Bubble Ring!
      const distChest = this.position.distanceTo(this.treasurePos);
      if (distChest < 3.4 && !this.isTreasureOpened?.()) {
        this.nearbyPrompt = 'Press E to Open Sunken Treasure Chest';
        if (interactNow) {
          this.onOpenTreasure?.();
        }
      } else if (ringDist < 2.2 && this.cameraSubmersion < 0.15 && this.floatRingRef) {
        this.nearbyPrompt = 'Press E to Float on Swim Ring';
        if (interactNow) {
          this.isFloatingRing = true;
          this.isSwimming = false;
          this.floatRingRef.setRiderActive(true);
          this.position.set(this.floatRingRef.pos.x, waveH - 0.34, this.floatRingRef.pos.z);
          sound.playSplash(0.42);
        }
      } else if (this.cameraSubmersion > 0.25) {
        this.nearbyPrompt = 'Press F to Blow Bubble Ring';
      }
      if (bubbleNow && this.cameraSubmersion > 0.15) {
        const fwd = new THREE.Vector3();
        camera.getWorldDirection(fwd);
        this.onBlowBubbleRing?.(camera.position.clone().add(new THREE.Vector3(0, -0.15, 0)), fwd);
      }
    } else if (!this.isSliding && this.slideCooldown <= 0) {
      const dxS = Math.abs(this.position.x - WATER_SLIDE_LAUNCH.x);
      const dzS = this.position.z - WATER_SLIDE_LAUNCH.z;
      const dyS = Math.abs(this.position.y - WATER_SLIDE_LAUNCH.y);
      const distToSlide = Math.hypot(this.position.x - WATER_SLIDE_LAUNCH.x, this.position.z - WATER_SLIDE_LAUNCH.z);
      if (distToSlide < 3.5 && dyS < 2.4) {
        this.nearbyPrompt = 'Press E to Ride Water Slide';
      }
      const walkTrigger = dxS < 1.15 && Math.abs(dzS) < 0.72 && dyS < 0.85 && (moveFwd > 0 || dzS > -0.25);
      const keyTrigger = interactNow && distToSlide < 3.5 && dyS < 2.4;
      if (walkTrigger || keyTrigger) {
        this.isSliding = true;
        this.slideT = 0;
        this.isGrounded = false;
        this.nearbyPrompt = '';
        sound.playSplash(0.45);
      } else if (Math.hypot(this.position.x - this.telescopePos.x, this.position.z - this.telescopePos.z) < 1.45) {
        this.nearbyPrompt = 'Press E to Look Through Brass Telescope (3× Zoom)';
        if (interactNow) {
          this.isUsingTelescope = true;
          this.camYaw = 0.0;
          this.camPitch = 0.05;
          sound.playCameraShutter();
          this.onTelescopeChange?.(true);
        }
      } else if (Math.hypot(this.position.x - -22.0, this.position.z - -28.0) < 3.2) {
        this.nearbyPrompt = 'Press E to Order Tropical Smoothie (+Speed Boost)';
        if (interactNow) {
          this.speedBoostTimer = 12.0;
          sound.playDrinkSip();
          this.onOrderDrink?.('tiki');
        }
      } else if (Math.hypot(this.position.x - -47.5, this.position.z - -28.0) < 2.8) {
        this.nearbyPrompt = 'Press E to Order Iced Coconut Espresso (+Speed Boost)';
        if (interactNow) {
          this.speedBoostTimer = 12.0;
          sound.playDrinkSip();
          this.onOrderDrink?.('coffee');
        }
      } else if (
        this.patrolLifeguardPosGetter?.() &&
        Math.hypot(
          this.position.x - this.patrolLifeguardPosGetter()!.x,
          this.position.z - this.patrolLifeguardPosGetter()!.z
        ) < 3.4
      ) {
        this.nearbyPrompt = 'Press E to Ask Patrol Lifeguard for Bay Report';
        if (interactNow) {
          this.onChatLifeguard?.();
        }
      } else if (Math.hypot(this.position.x - -18.2, this.position.z - -22.6) < 2.25) {
        this.nearbyPrompt = this.isUsingShower ? 'Move or Press E to Stop Showering' : 'Press E to Rinse Under Beach Shower';
        if (interactNow) {
          this.isUsingShower = !this.isUsingShower;
          this.showerTimer = this.isUsingShower ? 9.0 : 0;
          if (this.isUsingShower) {
            this.position.set(-18.2, getTerrainHeight(-18.2, -22.54) + 0.095, -22.54);
            this.velocity.set(0, 0, 0);
            this.yaw = 0;
          }
        }
      } else if (Math.hypot(this.position.x - -54.5, this.position.z - -32.8) < 3.4) {
        this.nearbyPrompt = 'Press E to Change Beach Outfit at Cabana';
        if (interactNow) {
          this.cycleBeachOutfit();
          sound.playWoodSettle();
        }
      } else if (Math.hypot(this.position.x - -38.5, this.position.z - -19.2) < 3.3) {
        this.nearbyPrompt = 'Press E to Strum Ukulele & Stoke Bonfire';
        if (interactNow) {
          sound.playUkuleleChord();
          this.onBonfireStrum?.();
        }
      } else {
        // Check Inflatable Swim Ring when wading up to it in shallow/waist water!
        const wadeRingDist = this.floatRingRef
          ? Math.hypot(this.position.x - this.floatRingRef.pos.x, this.position.z - this.floatRingRef.pos.z)
          : 999;
        // Check Kayak Launch Cove
        const distKayak = Math.hypot(this.position.x - this.kayakLaunchPos.x, this.position.z - this.kayakLaunchPos.z);
        if (wadeRingDist < 2.6 && this.floatRingRef) {
          this.nearbyPrompt = 'Press E to Float on Swim Ring';
          if (interactNow) {
            this.isFloatingRing = true;
            this.isSwimming = false;
            this.isGrounded = false;
            this.floatRingRef.setRiderActive(true);
            this.position.set(this.floatRingRef.pos.x, waveH - 0.34, this.floatRingRef.pos.z);
            sound.playSplash(0.42);
          }
        } else if (distKayak < 4.2) {
          this.nearbyPrompt = 'Press E to Launch Coastal Kayak';
          if (interactNow) {
            this.isKayaking = true;
            this.isSwimming = false;
            this.isGrounded = false;
            this.kayakSpeed = 1.6;
            this.position.set(this.kayakLaunchPos.x, 0.0, 5.2);
            this.yaw = 0.0;
            this.camYaw = 0.0;
            this.playerKayakGroup.visible = true;
            waterFX.spawnSplash(this.position.x, 0.1, this.position.z, 1.1, 14, 1.4);
            sound.playSplash(0.75);
          }
        } else if (
          this.kickBallPosRef &&
          Math.hypot(this.position.x - this.kickBallPosRef.x, this.position.z - this.kickBallPosRef.z) < 2.2
        ) {
          this.nearbyPrompt = 'Press E to Volley Beach Ball';
          if (interactNow) {
            this.onVolleyBeachBall?.();
          }
        } else {
          // Check nearby Hammocks / Painted Benches for relaxing!
          let bestSit: InteractiveSitSpot | null = null;
          let bestD = 2.05;
          for (let i = 0; i < this.sitSpots.length; i++) {
            const s = this.sitSpots[i];
            const d = Math.hypot(this.position.x - s.x, this.position.z - s.z);
            if (d < bestD && Math.abs(this.position.y - s.y) < 1.35) {
              bestD = d;
              bestSit = s;
            }
          }
          if (bestSit) {
            this.nearbyPrompt = `Press E to ${bestSit.label}`;
            if (interactNow) {
              this.activeSitSpot = bestSit;
              this.velocity.set(0, 0, 0);
              this.position.set(bestSit.x, bestSit.y, bestSit.z);
              this.yaw = bestSit.yaw;
              this.isGrounded = true;
              sound.playWoodSettle();
            }
          }
        }
      }
    }

    // True airborne falling -> splashdown plunge -> buoyant wave swimming transition!
    // Stepping/jumping off elevated Pier or Lifeguard Tower runs full airborne parabolic gravity first!
    if (!this.isSwimming && !this.isSliding && !this.isKayaking && !this.isFloatingRing && !this.activeSitSpot && !this.isUsingTelescope) {
      const canEnterWater =
        (this.isGrounded && waterDepth > 0.92) ||
        (!onElevatedWood && waterDepth > 0.85 && this.position.y <= waveH - 0.32) ||
        (waterDepth > 0.72 && this.position.y <= waveH - 0.10 && dive);
      if (canEnterWater) {
        const impactSpeed = -this.velocity.y;
        this.isSwimming = true;
        this.isGrounded = false;
        if (impactSpeed > 2.2) {
          // Real momentum plunge below surface + dramatic splash + rising bubbles!
          this.velocity.y = Math.max(-6.2, this.velocity.y * 0.56);
          const splashScale = THREE.MathUtils.clamp(impactSpeed / 4.2, 0.85, 2.2);
          waterFX.spawnSplash(this.position.x, waveH, this.position.z, splashScale, 24, 2.1);
          this._bubbleOrigin.set(this.position.x, waveH - 0.35, this.position.z);
          particles.emitBubbles(this._bubbleOrigin, 12, 0.55, 1.35);
          sound.playPlungeSplash(THREE.MathUtils.clamp(impactSpeed / 5.5, 0.7, 1.25));
          this.surfaceWetness = 1.0;
        } else {
          this.velocity.y = Math.max(this.velocity.y, waveVy * 0.8 + 0.45);
          sound.playSplash(0.45);
        }
      }
    } else if (this.isSwimming) {
      if (waterDepth < 0.74 && this.position.y <= terrainH + 0.25 && !dive) {
        this.isSwimming = false;
        this.isGrounded = true;
      }
    }

    // Camera-aligned horizontal basis vectors (camera looks along (sin(camYaw), cos(camYaw)))
    this._forward.set(Math.sin(this.camYaw), 0, Math.cos(this.camYaw)).normalize();
    this._right.set(-Math.cos(this.camYaw), 0, Math.sin(this.camYaw)).normalize();

    let animState: HumanAnimState = 'idle';
    let speedNorm = 0;

    if (this.isSliding) {
      // ==================== INTERACTIVE WATER SLIDE CHUTE RIDE ====================
      this.slideT = Math.min(1.0, this.slideT + dt * 0.44);
      const slideTan = new THREE.Vector3();
      sampleWaterSlide(this.slideT, this.position, slideTan);
      this.position.y += 0.16;
      this.yaw = Math.atan2(slideTan.x, slideTan.z);
      this.velocity.copy(slideTan).multiplyScalar(6.5);
      this.mode = 'SLIDING';
      animState = 'slide';
      speedNorm = 1.0;

      this.wakeRippleTimer -= dt;
      if (this.wakeRippleTimer <= 0) {
        this.wakeRippleTimer = 0.08;
        particles.emitBubbles(this.position, 2, 0.25, 0.55);
      }

      if (this.slideT >= 1.0) {
        this.isSliding = false;
        this.slideCooldown = 2.2;
        this.isGrounded = false;
        this.velocity.set(slideTan.x * 5.2, -1.2, slideTan.z * 5.2);
        waterFX.spawnSplash(this.position.x, waveH, this.position.z, 1.65, 22, 1.9);
        sound.playPlungeSplash(0.95);
      }
    } else if (this.isKayaking) {
      // ==================== DRIVABLE COASTAL KAYAK MODE ====================
      const turnRate = 1.85;
      this.yaw -= moveSide * turnRate * dt;
      const maxKayak = sprint ? 8.4 : 5.4;
      const targetSpd = moveFwd > 0 ? maxKayak : moveFwd < 0 ? -2.4 : 0;
      this.kayakSpeed = THREE.MathUtils.lerp(this.kayakSpeed, targetSpd, 1.0 - Math.exp(-(moveFwd !== 0 ? 3.5 : 1.6) * dt));

      const kDirX = Math.sin(this.yaw);
      const kDirZ = Math.cos(this.yaw);
      this.position.x += (kDirX * this.kayakSpeed + surgeX * 0.45) * dt;
      this.position.z += (kDirZ * this.kayakSpeed + surgeZ * 0.45) * dt;
      // Keep kayak gracefully afloat (z >= 2.8) and collide cleanly with pier/raft/buoy/rowboat!
      this.position.z = Math.max(2.8, this.position.z);
      resolveWorldCollisions(this.position, 0.72);
      // TRUE 4-Point Multi-Hull Buoyancy (bow, stern, port, starboard) so waves NEVER sink the kayak!
      const pX = this.position.x;
      const pZ = this.position.z;
      const bowX = pX + kDirX * 1.45;
      const bowZ = pZ + kDirZ * 1.45;
      const sternX = pX - kDirX * 1.45;
      const sternZ = pZ - kDirZ * 1.45;
      const sideX = -kDirZ * 0.42;
      const sideZ = kDirX * 0.42;
      const khCenter = sampleWaveHeight(pX, pZ, elapsedTime, waveIntensity, getTerrainHeight(pX, pZ));
      const khBow = sampleWaveHeight(bowX, bowZ, elapsedTime, waveIntensity, getTerrainHeight(bowX, bowZ));
      const khStern = sampleWaveHeight(sternX, sternZ, elapsedTime, waveIntensity, getTerrainHeight(sternX, sternZ));
      const khPort = sampleWaveHeight(pX + sideX, pZ + sideZ, elapsedTime, waveIntensity, getTerrainHeight(pX + sideX, pZ + sideZ));
      const khStbd = sampleWaveHeight(pX - sideX, pZ - sideZ, elapsedTime, waveIntensity, getTerrainHeight(pX - sideX, pZ - sideZ));
      const avgWave = (khCenter * 2.0 + khBow + khStern + khPort + khStbd) / 6.0;
      const crestLift = Math.max(avgWave, khCenter * 0.52 + Math.max(khBow, khStern) * 0.48);
      // Hull spans local y=0.17..0.67 -> offset -0.18 keeps waterline neatly at hull chine with proud dry freeboard!
      this.position.y = crestLift - 0.18;
      const targetPitch = THREE.MathUtils.clamp(-Math.atan2(khBow - khStern, 2.90) * 0.78, -0.32, 0.32);
      const targetRoll = THREE.MathUtils.clamp(Math.atan2(khPort - khStbd, 0.84) * 0.55, -0.26, 0.26);
      this.kayakPitch = THREE.MathUtils.lerp(this.kayakPitch, targetPitch, 1.0 - Math.exp(-7.5 * dt));
      this.kayakRoll = THREE.MathUtils.lerp(this.kayakRoll, targetRoll, 1.0 - Math.exp(-7.5 * dt));
      this.velocity.set(kDirX * this.kayakSpeed, 0, kDirZ * this.kayakSpeed);
      this.mode = 'KAYAKING';
      animState = 'sit_chair';
      speedNorm = Math.abs(this.kayakSpeed) / maxKayak;

      const strokeFreq = Math.abs(this.kayakSpeed) > 0.4 ? (sprint ? 5.2 : 3.4) : 0.8;
      const stroke = Math.sin(elapsedTime * strokeFreq);
      this.playerKayakPaddle.rotation.y = stroke * (Math.abs(this.kayakSpeed) > 0.4 ? 0.62 : 0.12);
      this.playerKayakPaddle.rotation.z = stroke * (Math.abs(this.kayakSpeed) > 0.4 ? 0.38 : 0.08);

      this.wakeRippleTimer -= dt;
      if (this.wakeRippleTimer <= 0 && Math.abs(this.kayakSpeed) > 0.7) {
        this.wakeRippleTimer = sprint ? 0.24 : 0.38;
        waterFX.spawnSplash(this.position.x - kDirX * 0.8, crestLift, this.position.z - kDirZ * 0.8, 0.58, 5, 1.0);
        sound.playPaddleStroke(sprint ? 0.9 : 0.65);
      }
    } else if (this.isUsingShower) {
      // ==================== INTERACTIVE OUTDOOR BEACH SHOWER ====================
      this.showerTimer -= dt;
      if (this.showerTimer <= 0 || moveFwd !== 0 || moveSide !== 0 || ascend) {
        this.isUsingShower = false;
        this.showerTimer = 0;
      } else {
        this.velocity.set(0, 0, 0);
        this.mode = 'WET SAND';
        animState = 'rinse';
        speedNorm = 0;
        this.wetBodyTimer = 7.0;
        this.wakeRippleTimer -= dt;
        if (this.wakeRippleTimer <= 0) {
          this.wakeRippleTimer = 0.16;
          waterFX.spawnSplash(this.position.x, this.position.y + 0.04, this.position.z, 0.38, 6, 0.65);
        }
      }
    } else if (this.isFloatingRing && this.floatRingRef) {
      // ==================== INTERACTIVE FLOATING INFLATABLE SWIM RING ====================
      this._moveDir
        .set(0, 0, 0)
        .addScaledVector(this._forward, moveFwd)
        .addScaledVector(this._right, moveSide);
      if (this._moveDir.lengthSq() > 0.001) this._moveDir.normalize();
      const targetVx = this._moveDir.x * 2.2 + surgeX * 0.45;
      const targetVz = this._moveDir.z * 2.2 + surgeZ * 0.45;
      this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, targetVx, 1.0 - Math.exp(-3.2 * dt));
      this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, targetVz, 1.0 - Math.exp(-3.2 * dt));
      this.position.x = THREE.MathUtils.clamp(this.position.x + this.velocity.x * dt, -52.0, 52.0);
      this.position.z = THREE.MathUtils.clamp(this.position.z + this.velocity.z * dt, 4.5, 44.0);
      resolveWorldCollisions(this.position, 0.56);
      const rTerr = getTerrainHeight(this.position.x, this.position.z);
      const rh = sampleWaveHeight(this.position.x, this.position.z, elapsedTime, waveIntensity, rTerr);
      const rhx = sampleWaveHeight(this.position.x + 0.5, this.position.z, elapsedTime, waveIntensity, rTerr);
      const rhz = sampleWaveHeight(this.position.x, this.position.z + 0.5, elapsedTime, waveIntensity, rTerr);
      this.position.y = rh - 0.34;
      this.floatRingRef.pos.set(this.position.x, rh + 0.055, this.position.z);
      this.floatRingRef.mesh.position.copy(this.floatRingRef.pos);
      this.floatRingRef.mesh.rotation.set((rhz - rh) * 0.85, this.yaw, -(rhx - rh) * 0.85);
      this.mode = 'RELAXING';
      animState = 'float_tube';
      speedNorm = 0;
    } else if (this.activeSitSpot) {
      // ==================== INTERACTIVE HAMMOCK / BENCH RELAXATION ====================
      this.position.set(this.activeSitSpot.x, this.activeSitSpot.y, this.activeSitSpot.z);
      this.yaw = this.activeSitSpot.yaw;
      this.velocity.set(0, 0, 0);
      this.mode = 'RELAXING';
      animState = this.activeSitSpot.pose;
      speedNorm = 0;
    } else if (!this.isSwimming) {
      // ==================== LAND & PROGRESSIVE WADING ====================
      this._moveDir
        .set(0, 0, 0)
        .addScaledVector(this._forward, moveFwd)
        .addScaledVector(this._right, moveSide);
      const hasInput = this._moveDir.lengthSq() > 0.001;
      if (hasInput) this._moveDir.normalize();

      // Progressive water drag from ankles (0.12m) to chest (1.2m) + optional Tropical Drink Speed Boost!
      const wadeFactor = THREE.MathUtils.clamp((waterDepth - 0.1) / 1.05, 0, 1);
      const boostMult = this.speedBoostTimer > 0 ? 1.28 : 1.0;
      const baseMaxSpeed = (sprint ? 6.4 : 3.45) * boostMult;
      const maxSpeed = baseMaxSpeed * (1.0 - wadeFactor * 0.56);

      const accel = this.isGrounded ? 15.0 : 5.0;
      const targetVx = hasInput ? this._moveDir.x * maxSpeed : 0;
      const targetVz = hasInput ? this._moveDir.z * maxSpeed : 0;

      const damp = 1.0 - Math.exp(-accel * dt);
      this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, targetVx, damp);
      this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, targetVz, damp);

      // Jump on sand / shallow water
      if (ascend && this.isGrounded && wadeFactor < 0.55) {
        this.velocity.y = 5.4 * (1.0 - wadeFactor * 0.35);
        this.isGrounded = false;
      }

      // Gravity
      this.velocity.y -= 16.5 * dt;

      this.position.x += this.velocity.x * dt;
      this.position.y += this.velocity.y * dt;
      this.position.z += this.velocity.z * dt;

      resolveWorldCollisions(this.position, 0.38);

      const walkable = getWalkableSurface(this.position.x, this.position.z, this.position.y + 0.55);
      const newGroundY = walkable.y;
      this.groundSurface = walkable.surface;

      if (this.position.y <= newGroundY + 0.02) {
        this.position.y = newGroundY;
        this.velocity.y = 0;
        this.isGrounded = true;
      } else {
        this.isGrounded = false;
      }

      // Smooth character yaw toward travel direction (or camera forward in 1st person)
      const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      if (this.firstPerson) {
        this.yaw = this.camYaw;
      } else if (horizSpeed > 0.25) {
        const targetYaw = Math.atan2(this.velocity.x, this.velocity.z);
        let diff = targetYaw - this.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.yaw += diff * (1.0 - Math.exp(-10.5 * dt));
      }

      // Determine locomotion state (explicit airborne JUMPING / FALLING animations off Pier/Tower!)
      if (!this.isGrounded) {
        if (this.velocity.y > 0.6) {
          this.mode = 'JUMPING';
          animState = 'jump';
        } else {
          this.mode = 'FALLING';
          animState = 'fall';
        }
      } else if (this.groundSurface === 'wood') {
        this.mode = 'BOARDWALK';
        if (horizSpeed > 4.2) animState = 'run';
        else if (horizSpeed > 0.22) animState = 'walk';
        else animState = 'idle';
      } else if (waterDepth > 0.14) {
        this.mode = 'WADING';
        animState = horizSpeed > 0.22 ? 'wade' : 'idle';
      } else {
        this.mode = newGroundY < waveH + 0.52 ? 'WET SAND' : 'DRY SAND';
        if (horizSpeed > 4.2) animState = 'run';
        else if (horizSpeed > 0.22) animState = 'walk';
        else animState = 'idle';
      }
      speedNorm = THREE.MathUtils.clamp(horizSpeed / 6.0, 0, 1);
      this.swimPitch = THREE.MathUtils.lerp(this.swimPitch, 0, 1.0 - Math.exp(-8 * dt));
    } else {
      // ==================== BUOYANT SURFACE SWIMMING & DIVING ====================
      const surfaceTargetY = waveH - 1.12; // Natural floating chest/chin height at wave surface
      const underwaterAmount = surfaceTargetY - this.position.y;
      const isUnderSurface = underwaterAmount > 0.42;

      // Full 3D camera-aligned look forward (pitch > 0 looks down, so -sin(camPitch) is Y)
      const cosP = Math.cos(this.camPitch);
      const lookFwdX = Math.sin(this.camYaw) * cosP;
      const lookFwdY = -Math.sin(this.camPitch);
      const lookFwdZ = Math.cos(this.camYaw) * cosP;

      // 3rd-person orbit cameras naturally tilt downward (~15°..25°): NEVER dive down on W in 3rd-person!
      const wantsPitchDive = this.firstPerson && moveFwd > 0 && lookFwdY < -0.58;
      const wantsDive = dive || wantsPitchDive;

      this._moveDir.set(0, 0, 0);
      if (moveFwd !== 0) {
        this._moveDir.x += lookFwdX * moveFwd;
        this._moveDir.z += lookFwdZ * moveFwd;
        // Align vertical swim to camera pitch ONLY when deeply submerged in 1st-person or diving
        if ((isUnderSurface && this.firstPerson) || wantsDive) {
          this._moveDir.y += lookFwdY * moveFwd;
        }
      }
      if (moveSide !== 0) {
        this._moveDir.x += this._right.x * moveSide;
        this._moveDir.z += this._right.z * moveSide;
      }
      if (ascend) this._moveDir.y += 1.0;
      if (dive) this._moveDir.y -= 1.05;

      const hasInput = this._moveDir.lengthSq() > 0.001;
      if (hasInput) this._moveDir.normalize();

      const maxSwimSpeed = sprint ? 5.2 : 3.2;
      const swimAccel = 7.2;
      const aquaticDrag = 3.8;

      if (hasInput) {
        this.velocity.x = THREE.MathUtils.lerp(
          this.velocity.x,
          this._moveDir.x * maxSwimSpeed,
          1.0 - Math.exp(-swimAccel * dt)
        );
        this.velocity.y = THREE.MathUtils.lerp(
          this.velocity.y,
          this._moveDir.y * maxSwimSpeed,
          1.0 - Math.exp(-swimAccel * dt)
        );
        this.velocity.z = THREE.MathUtils.lerp(
          this.velocity.z,
          this._moveDir.z * maxSwimSpeed,
          1.0 - Math.exp(-swimAccel * dt)
        );
      } else {
        const dragExp = Math.exp(-aquaticDrag * dt);
        this.velocity.multiplyScalar(dragExp);
      }

      // Critically-damped physical wave buoyancy & orbital swell surge!
      // In 3rd-person (and at surface unless C/Ctrl pressed), lock cleanly onto buoyant wave surface!
      const isSurfaceFloating = !wantsDive && (!isUnderSurface || (!this.firstPerson && !dive));
      if (isSurfaceFloating) {
        const buoyError = surfaceTargetY - this.position.y;
        if (buoyError > -0.65 && buoyError < 1.65) {
          // Strong critically-damped spring matching live wave vertical velocity (waveVy)
          const springAccel = buoyError * 24.0 + (waveVy - this.velocity.y) * 7.5;
          this.velocity.y += springAccel * dt;
          // Subtle horizontal orbital surge rocking the swimmer naturally with swells
          this.velocity.x += surgeX * 0.55 * dt;
          this.velocity.z += surgeZ * 0.55 * dt;
        } else if (this.position.y > surfaceTargetY) {
          this.velocity.y -= 10.5 * dt;
        } else {
          // Gentle positive buoyancy deep underwater
          this.velocity.y += 0.42 * dt;
        }
      }

      this.position.addScaledVector(this.velocity, dt);
      resolveWorldCollisions(this.position, 0.42);

      // Clamp cleanly between seabed floor (+0.28m clearance) and live wave surface crest
      const seabedY = getTerrainHeight(this.position.x, this.position.z);
      const liveWaveAtNewPos = sampleWaveHeight(this.position.x, this.position.z, elapsedTime, waveIntensity, seabedY);
      if (this.position.y < seabedY + 0.28) {
        this.position.y = seabedY + 0.28;
        if (this.velocity.y < 0) this.velocity.y = 0;
      }
      if (this.position.y > liveWaveAtNewPos - 0.78 && this.velocity.y >= 0) {
        this.position.y = liveWaveAtNewPos - 0.78;
        if (this.velocity.y > waveVy) this.velocity.y = waveVy;
      }

      // Smooth facing yaw & pitch while swimming
      const hSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      const totalSpeed = this.velocity.length();
      if (this.firstPerson) {
        this.yaw = this.camYaw;
      } else if (hSpeed > 0.25) {
        const targetYaw = Math.atan2(this.velocity.x, this.velocity.z);
        let diff = targetYaw - this.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.yaw += diff * (1.0 - Math.exp(-7.5 * dt));
      }

      const targetSwimPitch =
        totalSpeed > 0.35 ? Math.atan2(this.velocity.y, Math.max(hSpeed, 0.5)) : 0;
      this.swimPitch = THREE.MathUtils.lerp(this.swimPitch, targetSwimPitch, 1.0 - Math.exp(-7.0 * dt));

      const submergedDepth = waveH - (this.position.y + 1.25);
      if (submergedDepth > 0.25) {
        this.mode = 'DIVING';
        animState = totalSpeed > 0.4 ? 'swim_underwater' : 'tread';
      } else {
        this.mode = 'SWIMMING';
        animState = totalSpeed > 0.45 ? 'swim_surface' : 'tread';
      }
      speedNorm = THREE.MathUtils.clamp(totalSpeed / 5.2, 0, 1);

      // Continuous rising 3D bubbles while diving & swimming underwater
      if (submergedDepth > 0.1) {
        this.bubbleTimer -= dt;
        const rate = totalSpeed > 1.5 ? 0.09 : 0.28;
        if (this.bubbleTimer <= 0) {
          this.bubbleTimer = rate;
          this._bubbleOrigin.set(
            this.position.x + Math.sin(this.yaw) * 0.25,
            this.position.y + 1.22,
            this.position.z + Math.cos(this.yaw) * 0.25
          );
          particles.emitBubbles(this._bubbleOrigin, totalSpeed > 1.8 ? 4 : 2, 0.3, 0.85);
          if (Math.random() < 0.35) sound.playBubbleBurst(0.35);
        }
      }
    }

    // Apply character transform with subtle terrain slope alignment OR live kayak pitch/roll on ocean swells!
    this.character.root.position.copy(this.position);
    this.character.root.rotation.y = this.yaw;
    if (this.isKayaking) {
      this.character.root.rotation.x = this.kayakPitch;
      this.character.root.rotation.z = this.kayakRoll;
    } else if (!this.isSwimming && this.isGrounded) {
      getTerrainNormal(this.position.x, this.position.z, this._slopeNorm);
      const slopeTiltX = THREE.MathUtils.clamp(
        (this._slopeNorm.z * Math.cos(this.yaw) + this._slopeNorm.x * Math.sin(this.yaw)) * 0.28,
        -0.15,
        0.15
      );
      this.character.root.rotation.x = THREE.MathUtils.lerp(
        this.character.root.rotation.x,
        slopeTiltX,
        1.0 - Math.exp(-8 * dt)
      );
      this.character.root.rotation.z = THREE.MathUtils.lerp(
        this.character.root.rotation.z,
        0,
        1.0 - Math.exp(-8 * dt)
      );
    } else {
      this.character.root.rotation.x = THREE.MathUtils.lerp(
        this.character.root.rotation.x,
        0,
        1.0 - Math.exp(-8 * dt)
      );
      this.character.root.rotation.z = THREE.MathUtils.lerp(
        this.character.root.rotation.z,
        0,
        1.0 - Math.exp(-8 * dt)
      );
    }

    const { footPlant, swimStroke } = this.character.updateAnimation(
      animState,
      dt,
      elapsedTime,
      speedNorm,
      this.swimPitch,
      waveH,
      sunDirection,
      sunColor
    );

    const moveSpd = Math.hypot(this.velocity.x, this.velocity.z);
    this.waterMoveSpeed = moveSpd;

    // Seamless 4-Zone Water Entry Detection: fires right at the VERY FIRST shallow swash patches (0.015m+)!
    const inWaterNow =
      !onElevatedWood &&
      !this.isSliding &&
      this.position.y <= waveH + 0.12 &&
      (this.wasInWater ? waterDepth > 0.010 : waterDepth > 0.022);
    if (inWaterNow) {
      this.wetBodyTimer = Math.max(this.wetBodyTimer, waterDepth > 0.25 ? 8.0 : 3.5);
    } else if (this.wetBodyTimer > 0) {
      // Shed glistening sun-lit water droplets while drying off on dry sand after leaving the ocean!
      this.wetBodyTimer = Math.max(0, this.wetBodyTimer - dt);
      this.wetDripTimer -= dt;
      if (this.wetDripTimer <= 0 && !this.firstPerson) {
        this.wetDripTimer = 0.28 + Math.random() * 0.25;
        waterFX.spawnSplash(this.position.x, this.position.y + 0.45, this.position.z, 0.18, 2, 0.25);
      }
    }

    if (inWaterNow && !this.wasInWater && moveSpd > 0.35) {
      // Gentle crisp ankle entry splash the exact moment your toes touch the first patch of water!
      waterFX.spawnSplash(this.position.x, waveH, this.position.z, 0.42, 7, 0.85);
      sound.playFootstep('ankle', THREE.MathUtils.clamp(0.45 + moveSpd * 0.12, 0.45, 0.95));
    }
    this.wasInWater = inWaterNow;

    // Continuous subtle contact wake ripples around ankles/waist while standing or moving in water
    if (inWaterNow) {
      this.wakeRippleTimer -= dt;
      const interval = moveSpd > 0.4 ? 0.30 : 0.85;
      if (this.wakeRippleTimer <= 0) {
        this.wakeRippleTimer = interval;
        waterFX.spawnRipple(this.position.x, this.position.z, moveSpd > 0.4 ? 0.62 : 0.35, moveSpd > 0.4 ? 1.25 : 0.85);
      }
    }

    if (footPlant && !this.isSwimming && this.isGrounded) {
      if (this.groundSurface === 'wood') {
        // Walking on wooden boardwalk, ocean pier, Tiki deck, or lifeguard stairs!
        sound.playFootstep('wood', sprint ? 1.0 : 0.72);
      } else if (this.position.x < -46 && this.position.z < -31) {
        // Gravel & coral-stone path climbing toward the West Stone Watchtower Fort!
        sound.playFootstep('stone', sprint ? 0.95 : 0.72);
      } else {
        const footGround = getTerrainHeight(footPlant.worldPos.x, footPlant.worldPos.z);
        const footWaveH = sampleWaveHeight(footPlant.worldPos.x, footPlant.worldPos.z, elapsedTime, waveIntensity, footGround);
        const footWaterDepth = Math.max(0, footWaveH - footGround);
        if (footWaterDepth < 0.92) {
          const isWet = footGround < footWaveH + 0.55;
          footprints.stamp(
            footPlant.worldPos.x,
            footPlant.worldPos.z,
            this.yaw,
            footPlant.foot === 'right',
            sprint ? 1.0 : 0.92,
            1.0
          );
          const stepSurface: 'dry' | 'wet' | 'ankle' | 'wade' =
            footWaterDepth > 0.22
              ? 'wade'
              : footWaterDepth > 0.015
                ? 'ankle'
                : isWet
                  ? 'wet'
                  : 'dry';
          const depthVol =
            stepSurface === 'ankle'
              ? THREE.MathUtils.clamp(0.45 + footWaterDepth * 2.2, 0.48, 0.95) * (sprint ? 1.15 : 0.88)
              : stepSurface === 'wade'
                ? THREE.MathUtils.clamp(0.65 + footWaterDepth * 0.5, 0.68, 1.05) * (sprint ? 1.12 : 0.88)
                : sprint
                  ? 1.0
                  : 0.72;
          sound.playFootstep(stepSurface, depthVol);
          if (footWaterDepth > 0.015) {
            const spScale = THREE.MathUtils.clamp(0.32 + footWaterDepth * 1.4, 0.34, sprint ? 1.05 : 0.78);
            waterFX.spawnSplash(
              footPlant.worldPos.x,
              footWaveH,
              footPlant.worldPos.z,
              spScale,
              footWaterDepth > 0.14 ? (sprint ? 12 : 8) : 5,
              footWaterDepth > 0.14 ? (sprint ? 1.45 : 1.15) : 0.75
            );
            if (footWaterDepth > 0.10) {
              particles.emitBubbles(footPlant.worldPos, 3, 0.22, 0.55);
            }
          }
        }
      }
    }

    if (swimStroke && this.isSwimming) {
      const underwater = this.cameraSubmersion > 0.02;
      sound.playSwimStroke(underwater, sprint ? 1.0 : 0.7);
      if (!underwater) {
        waterFX.spawnSplash(this.position.x, waveH, this.position.z, sprint ? 1.05 : 0.78, sprint ? 14 : 9, 1.55);
      }
      this._bubbleOrigin.set(
        this.position.x,
        Math.min(waveH - 0.15, this.position.y + 1.0),
        this.position.z
      );
      particles.emitBubbles(this._bubbleOrigin, sprint ? 7 : 4, 0.45, 0.95);
    }

    // ==================== DAMPED SPRING-ARM CAMERA WITH TERRAIN COLLISION ====================
    this.updateCamera(dt, elapsedTime, waveIntensity, camera, sound);
  }

  private updateCamera(
    dt: number,
    elapsedTime: number,
    waveIntensity: number,
    camera: THREE.PerspectiveCamera,
    sound: SoundEngine
  ): void {
    // Smooth FOV zoom for the Brass Observation Telescope (58° -> 20° telephoto!)
    const targetFov = this.isUsingTelescope ? 20 : 58;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 1.0 - Math.exp(-7.5 * dt));
      camera.updateProjectionMatrix();
    }

    if (this.welcomeMode) {
      // Sweeping elevated aerial showcase orbit over the alive sunlit beach & turquoise bay!
      const t = elapsedTime * 0.13;
      const wx = Math.sin(t) * 26.0;
      const wy = 13.8 + Math.sin(elapsedTime * 0.22) * 1.2;
      const wz = -4.0 + Math.cos(t) * 10.5;
      const lx = Math.sin(t * 0.8 + 0.5) * 14.0;
      const ly = 1.6;
      const lz = 12.0 + Math.cos(t * 0.7) * 8.0;
      this.smoothedCamPos.set(wx, wy, wz);
      this.smoothedLookAt.set(lx, ly, lz);
      this.camInitialized = true;
      camera.position.copy(this.smoothedCamPos);
      camera.lookAt(this.smoothedLookAt);
      this.cameraSubmersion = 0;
      return;
    }

    if (this.isUsingTelescope) {
      const cosP = Math.cos(this.camPitch);
      const dirX = Math.sin(this.camYaw) * cosP;
      const dirY = -Math.sin(this.camPitch);
      const dirZ = Math.cos(this.camYaw) * cosP;
      const eye = new THREE.Vector3(this.telescopePos.x, this.telescopePos.y + 1.46, this.telescopePos.z + 0.36);
      const look = eye.clone().add(new THREE.Vector3(dirX * 30, dirY * 30, dirZ * 30));
      this.smoothedCamPos.copy(eye);
      this.smoothedLookAt.copy(look);
      camera.position.copy(eye);
      camera.lookAt(look);
      this.cameraSubmersion = 0;
      return;
    }

    const pivotY = this.isSwimming
      ? this.position.y + 1.24
      : this.isSliding
        ? this.position.y + 1.02
        : this.position.y + 1.56;
    const pivot = new THREE.Vector3(this.position.x, pivotY, this.position.z);

    let desiredPos: THREE.Vector3;
    let desiredLook: THREE.Vector3;

    const cosP = Math.cos(this.camPitch);
    const sinP = Math.sin(this.camPitch);
    const dirX = Math.sin(this.camYaw) * cosP;
    const dirY = -sinP;
    const dirZ = Math.cos(this.camYaw) * cosP;

    if (this.firstPerson) {
      desiredPos = new THREE.Vector3(this.position.x, pivotY + 0.08, this.position.z);
      desiredLook = desiredPos.clone().add(new THREE.Vector3(dirX, dirY, dirZ).multiplyScalar(10));
    } else {
      // Spring-arm behind player along -dir
      let armLen = this.camDistance;
      // Ray-march 6 samples along spring-arm to prevent clipping into terrain or seabed!
      for (let i = 1; i <= 6; i++) {
        const t = (i / 6) * this.camDistance;
        const sx = pivot.x - dirX * t;
        const sy = pivot.y - dirY * t;
        const sz = pivot.z - dirZ * t;
        const minClearY = getTerrainHeight(sx, sz) + 0.34;
        if (sy < minClearY) {
          armLen = Math.min(armLen, Math.max(1.15, t - 0.25));
        }
      }

      desiredPos = new THREE.Vector3(
        pivot.x - dirX * armLen,
        pivot.y - dirY * armLen,
        pivot.z - dirZ * armLen
      );
      const groundAtCam = getTerrainHeight(desiredPos.x, desiredPos.z) + 0.32;
      if (desiredPos.y < groundAtCam) desiredPos.y = groundAtCam;

      // Slight forward look-ahead for cinematic framing
      desiredLook = new THREE.Vector3(
        pivot.x + dirX * 2.2,
        pivot.y + dirY * 1.4,
        pivot.z + dirZ * 2.2
      );
    }

    if (!this.camInitialized) {
      this.smoothedCamPos.copy(desiredPos);
      this.smoothedLookAt.copy(desiredLook);
      this.camInitialized = true;
    } else if (this.swoopT < 1.0) {
      // Cinematic 1.15s cubic ease-out swoop from aerial welcome orbit down into playable avatar!
      this.swoopT = Math.min(1.0, this.swoopT + dt / 1.15);
      const ease = 1.0 - Math.pow(1.0 - this.swoopT, 3);
      this.smoothedCamPos.lerpVectors(this.swoopFromPos, desiredPos, ease);
      this.smoothedLookAt.lerpVectors(this.swoopFromLook, desiredLook, ease);
    } else {
      const kPos = 1.0 - Math.exp(-(this.firstPerson ? 24.0 : 12.5) * dt);
      const kLook = 1.0 - Math.exp(-(this.firstPerson ? 28.0 : 15.0) * dt);
      this.smoothedCamPos.lerp(desiredPos, kPos);
      this.smoothedLookAt.lerp(desiredLook, kLook);
    }

    // Final hard floor safety so camera never intersects sand even during rapid damping
    const safeY = getTerrainHeight(this.smoothedCamPos.x, this.smoothedCamPos.z) + 0.24;
    if (this.smoothedCamPos.y < safeY) this.smoothedCamPos.y = safeY;

    camera.position.copy(this.smoothedCamPos);
    camera.lookAt(this.smoothedLookAt);

    // Measure exact wave height at camera world position for seamless underwater audio & splash
    const camTerrainH = getTerrainHeight(camera.position.x, camera.position.z);
    const camWaveH = sampleWaveHeight(
      camera.position.x,
      camera.position.z,
      elapsedTime,
      waveIntensity,
      camTerrainH
    );
    this.cameraSubmersion = camWaveH - camera.position.y;

    const nowUnderwater = this.cameraSubmersion > 0.04;
    if (nowUnderwater !== this.wasCameraUnderwater) {
      this.wasCameraUnderwater = nowUnderwater;
      if (nowUnderwater) {
        sound.playSplash(0.65);
        sound.playBubbleBurst(0.75);
      } else {
        // Real water surface-emerge splash + glistening lens droplets when breaking above waves!
        sound.playSurfaceEmerge();
        this.surfaceWetness = 1.0;
      }
    }
    if (nowUnderwater) {
      this.surfaceWetness = 0.0;
    } else if (this.surfaceWetness > 0) {
      this.surfaceWetness = Math.max(0, this.surfaceWetness - dt * 0.48);
    }
  }
}
