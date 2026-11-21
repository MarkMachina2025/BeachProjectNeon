import * as THREE from 'three';
import { HumanAnimState, HumanCharacter } from '../characters/HumanRig';
import { getTerrainHeight, getTerrainNormal, resolveWorldCollisions } from '../terrain/terrainMath';
import { sampleWaveHeight } from '../ocean/wavePhysics';
import { FootprintSystem } from '../terrain/FootprintSystem';
import { UnderwaterParticles } from '../ocean/UnderwaterParticles';
import { WaterInteractionSystem } from '../ocean/WaterInteractionSystem';
import { SoundEngine } from '../audio/SoundEngine';

export type LocomotionMode =
  | 'DRY SAND'
  | 'WET SAND'
  | 'WADING'
  | 'SWIMMING'
  | 'DIVING';

/**
 * Responsive 3rd-person / 1st-person player character & damped spring-arm camera controller.
 *  - Smooth locomotion state transitions: Dry/Wet Sand -> Progressive Wading -> Buoyant Surface Swim -> Diving
 *  - WASD directional movement/swim (aligned to camera pitch underwater), Shift sprint/fast-swim,
 *    Space jump/ascend/surface, C/Ctrl dive down, V toggle 1st/3rd person
 *  - Damped spring-arm orbit camera with terrain collision avoidance & zero jitter
 *  - Exact left/right foot-plant sand footprints + granular footstep & swim audio hooks
 */
export class PlayerController {
  public readonly character: HumanCharacter;
  public readonly position = new THREE.Vector3(0, 0, -10.5);
  public readonly velocity = new THREE.Vector3();
  public yaw = 0; // Character facing yaw (0 = +Z looking out to sea)
  public camYaw = 0; // Camera orbit yaw (0 = camera behind player looking toward +Z)
  public camPitch = 0.22; // Radians: positive = looking slightly down from above
  public camDistance = 4.4;
  public firstPerson = false;

  public mode: LocomotionMode = 'DRY SAND';
  public waterDepthAtPlayer = 0;
  public cameraSubmersion = 0; // > 0 when camera lens is below live wave surface

  private readonly keys = new Set<string>();
  private isGrounded = true;
  private isSwimming = false;
  private swimPitch = 0;
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private bubbleTimer = 0;
  private wakeRippleTimer = 0;
  private wasInWater = false;
  private wasCameraUnderwater = false;

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
    this.character = new HumanCharacter({
      gender: 'male',
      height: 1.78,
      skinHex: 0xd9a17a,
      hairHex: 0x2a1d15,
      hairStyle: 'surfer_waves',
      outfitStyle: 'boardshorts',
      primaryColor: 0x168aad,
      secondaryColor: 0x38e2d8,
      sunglasses: true
    });

    this.position.set(0, getTerrainHeight(0, -10.5), -10.5);
    this.character.root.position.copy(this.position);
    scene.add(this.character.root);

    this.bindInput(canvas);
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      this.keys.add(e.code);
      this.onFirstInteraction?.();

      if (e.code === 'Space' && document.activeElement === document.body) {
        e.preventDefault();
      }
      if (e.code === 'KeyV') {
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

    // Click canvas to request pointer lock (or fallback drag orbit cleanly)
    canvas.addEventListener('pointerdown', (e) => {
      this.onFirstInteraction?.();
      if (e.button === 0) {
        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        if (document.pointerLockElement !== canvas && canvas.requestPointerLock) {
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
    this.isSwimming = y < -0.5 || terrainH < -1.2;
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
    const waterDepth = Math.max(0, waveH - terrainH);
    this.waterDepthAtPlayer = waterDepth;

    // Input axes
    const moveFwd = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
                    (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const moveSide = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
                     (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const ascend = this.keys.has('Space');
    const dive = this.keys.has('KeyC') || this.keys.has('ControlLeft') || this.keys.has('ControlRight');

    // Hysteresis between grounded sand/wading and buoyant swimming
    if (!this.isSwimming) {
      if (waterDepth > 1.24 || (waterDepth > 0.92 && dive)) {
        this.isSwimming = true;
        this.isGrounded = false;
        sound.playSplash(0.45);
      }
    } else {
      if (waterDepth < 0.96 && this.position.y <= terrainH + 0.25 && !dive) {
        this.isSwimming = false;
        this.isGrounded = true;
      }
    }

    // Camera-aligned horizontal basis vectors (camera looks along (sin(camYaw), cos(camYaw)))
    this._forward.set(Math.sin(this.camYaw), 0, Math.cos(this.camYaw)).normalize();
    this._right.set(-Math.cos(this.camYaw), 0, Math.sin(this.camYaw)).normalize();

    let animState: HumanAnimState = 'idle';
    let speedNorm = 0;

    if (!this.isSwimming) {
      // ==================== LAND & PROGRESSIVE WADING ====================
      this._moveDir
        .set(0, 0, 0)
        .addScaledVector(this._forward, moveFwd)
        .addScaledVector(this._right, moveSide);
      const hasInput = this._moveDir.lengthSq() > 0.001;
      if (hasInput) this._moveDir.normalize();

      // Progressive water drag from ankles (0.12m) to chest (1.2m)
      const wadeFactor = THREE.MathUtils.clamp((waterDepth - 0.1) / 1.05, 0, 1);
      const baseMaxSpeed = sprint ? 6.4 : 3.45;
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

      const newGroundY = getTerrainHeight(this.position.x, this.position.z);
      if (this.position.y <= newGroundY) {
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

      // Determine locomotion state
      if (waterDepth > 0.14) {
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
      const isDiving = underwaterAmount > 0.28 || dive;

      // Full 3D camera-aligned look forward (pitch > 0 looks down, so -sin(camPitch) is Y)
      const cosP = Math.cos(this.camPitch);
      const lookFwdX = Math.sin(this.camYaw) * cosP;
      const lookFwdY = -Math.sin(this.camPitch);
      const lookFwdZ = Math.cos(this.camYaw) * cosP;

      this._moveDir.set(0, 0, 0);
      if (moveFwd !== 0) {
        this._moveDir.x += lookFwdX * moveFwd;
        this._moveDir.z += lookFwdZ * moveFwd;
        // Align vertical swim to camera pitch when underwater or actively diving down!
        if (isDiving || (lookFwdY < -0.25 && moveFwd > 0)) {
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

      // Gentle buoyant restoring force near the surface when not actively diving downward
      if (!dive && !(moveFwd > 0 && lookFwdY < -0.22)) {
        const buoyError = surfaceTargetY - this.position.y;
        if (buoyError > -0.35 && buoyError < 1.1) {
          this.velocity.y += buoyError * 3.2 * dt;
        } else if (this.position.y > surfaceTargetY) {
          // Gravity pulls player cleanly back into waves if surfacing
          this.velocity.y -= 9.5 * dt;
        } else {
          // Slight natural positive buoyancy deep underwater
          this.velocity.y += 0.35 * dt;
        }
      }

      this.position.addScaledVector(this.velocity, dt);
      resolveWorldCollisions(this.position, 0.42);

      // Clamp cleanly between seabed floor (+0.32m clearance) and wave surface crest
      const seabedY = getTerrainHeight(this.position.x, this.position.z);
      if (this.position.y < seabedY + 0.32) {
        this.position.y = seabedY + 0.32;
        if (this.velocity.y < 0) this.velocity.y = 0;
      }
      if (this.position.y > waveH - 0.82) {
        this.position.y = waveH - 0.82;
        if (this.velocity.y > 0) this.velocity.y *= 0.3;
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

    // Apply character transform with subtle terrain slope alignment on dry/wet sand
    this.character.root.position.copy(this.position);
    this.character.root.rotation.y = this.yaw;
    if (!this.isSwimming && this.isGrounded) {
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
    } else {
      this.character.root.rotation.x = THREE.MathUtils.lerp(
        this.character.root.rotation.x,
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

    // Stamp real player left/right footprints into the RTT sand buffer + dynamic water splashes!
    const inWaterNow = waterDepth > 0.08 && this.position.y < waveH + 0.15;
    if (inWaterNow && !this.wasInWater) {
      waterFX.spawnSplash(this.position.x, waveH, this.position.z, 0.95, 16, 1.55);
      sound.playSplash(0.55);
    }
    this.wasInWater = inWaterNow;

    // Continuous subtle contact wake ripples around ankles/waist while standing or moving in water
    if (inWaterNow) {
      this.wakeRippleTimer -= dt;
      const moveSpd = Math.hypot(this.velocity.x, this.velocity.z);
      const interval = moveSpd > 0.4 ? 0.28 : 0.82;
      if (this.wakeRippleTimer <= 0) {
        this.wakeRippleTimer = interval;
        waterFX.spawnRipple(this.position.x, this.position.z, moveSpd > 0.4 ? 0.72 : 0.42, moveSpd > 0.4 ? 1.35 : 0.95);
      }
    }

    if (footPlant && !this.isSwimming && this.isGrounded) {
      const footGround = getTerrainHeight(footPlant.worldPos.x, footPlant.worldPos.z);
      const footWaterDepth = Math.max(0, waveH - footGround);
      if (footWaterDepth < 0.85) {
        const isWet = footGround < waveH + 0.55;
        footprints.stamp(
          footPlant.worldPos.x,
          footPlant.worldPos.z,
          this.yaw,
          footPlant.foot === 'right',
          sprint ? 1.0 : 0.92,
          1.0
        );
        sound.playFootstep(footWaterDepth > 0.07 ? 'wade' : isWet ? 'wet' : 'dry', sprint ? 1.0 : 0.75);
        if (footWaterDepth > 0.06) {
          // Physical water-entry ripple ring + 3D glistening splash spray burst at the exact stepping foot!
          waterFX.spawnSplash(
            footPlant.worldPos.x,
            waveH,
            footPlant.worldPos.z,
            sprint ? 1.15 : 0.82,
            sprint ? 18 : 11,
            sprint ? 1.65 : 1.30
          );
          particles.emitBubbles(footPlant.worldPos, 4, 0.25, 0.65);
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
    const pivotY = this.isSwimming ? this.position.y + 1.24 : this.position.y + 1.56;
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
      sound.playSplash(nowUnderwater ? 0.65 : 0.45);
      if (nowUnderwater) {
        sound.playBubbleBurst(0.75);
      }
    }
  }
}
