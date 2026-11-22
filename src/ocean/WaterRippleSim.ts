import * as THREE from 'three';

export interface WaterBodyImpulse {
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
  strength: number;
}

const MAX_BODIES = 12;

/**
 * Real-Time WebGL2 GPGPU 2D Shallow-Water Wave-Equation Simulation (Ping-Pong FBO):
 *  - Solves the discrete 2D damped wave equation + wake-foam advection on a 256x256
 *    half-float render target covering a 40m x 40m high-precision window around the player.
 *  - Texel-snapped UV reprojection keeps all propagating ripples, Kelvin V-wakes, and
 *    aerated foam trails 100% world-locked with zero smearing as the player moves.
 *  - Injects bow-wave pressure (positive bulge ahead of motion, trough behind) and
 *    concentric body ripples from the player, kayaks, surfers, and up to 11 closest water NPCs!
 */
export class WaterRippleSim {
  public readonly simSize = 40.0; // 40m x 40m local world window (~15.6cm/texel)
  public readonly resolution = 256;
  public readonly center = new THREE.Vector2(0, 8);

  private readonly rtA: THREE.WebGLRenderTarget;
  private readonly rtB: THREE.WebGLRenderTarget;
  private readIdx = 0;

  private readonly simScene: THREE.Scene;
  private readonly simCamera: THREE.OrthographicCamera;
  private readonly simMat: THREE.ShaderMaterial;

  private readonly bodyPosRad: THREE.Vector4[] = [];
  private readonly bodyVelStr: THREE.Vector4[] = [];
  private activeBodyCount = 0;

  // Player & 4 nearest bodies also exposed for crisp analytical vertex/fragment meniscus bending
  public readonly playerBodyUniform = new THREE.Vector4(0, 0, 0.36, 0); // x, z, radius, strength
  public readonly playerVelUniform = new THREE.Vector2(0, 0);
  public readonly nearBodiesUniform: THREE.Vector4[] = [
    new THREE.Vector4(0, -500, 0.32, 0),
    new THREE.Vector4(0, -500, 0.32, 0),
    new THREE.Vector4(0, -500, 0.32, 0),
    new THREE.Vector4(0, -500, 0.32, 0)
  ];

  private accumulator = 0;
  private initialized = false;

  constructor() {
    const rtOpts: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false
    };

    this.rtA = new THREE.WebGLRenderTarget(this.resolution, this.resolution, rtOpts);
    this.rtB = new THREE.WebGLRenderTarget(this.resolution, this.resolution, rtOpts);

    for (let i = 0; i < MAX_BODIES; i++) {
      this.bodyPosRad.push(new THREE.Vector4(0, -500, 0.35, 0));
      this.bodyVelStr.push(new THREE.Vector4(0, 0, 0, 0));
    }

    this.simScene = new THREE.Scene();
    this.simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.simMat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tPrev: { value: null },
        uTexelSize: { value: new THREE.Vector2(1 / this.resolution, 1 / this.resolution) },
        uSimCenter: { value: this.center },
        uSimSize: { value: this.simSize },
        uShiftUV: { value: new THREE.Vector2(0, 0) },
        uTime: { value: 0 },
        uBodyCount: { value: 0 },
        uBodyPosRad: { value: this.bodyPosRad },
        uBodyVelStr: { value: this.bodyVelStr }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;

        uniform sampler2D tPrev;
        uniform vec2 uTexelSize;
        uniform vec2 uSimCenter;
        uniform float uSimSize;
        uniform vec2 uShiftUV;
        uniform float uTime;
        uniform int uBodyCount;
        uniform vec4 uBodyPosRad[${MAX_BODIES}]; // xy = world xz, z = radius, w = strength
        uniform vec4 uBodyVelStr[${MAX_BODIES}]; // xy = vel xz, z = speed, w = unused

        varying vec2 vUv;

        vec4 samplePrevSafe(vec2 uv) {
          if (uv.x <= 0.004 || uv.x >= 0.996 || uv.y <= 0.004 || uv.y >= 0.996) {
            return vec4(0.0);
          }
          return texture2D(tPrev, uv);
        }

        void main() {
          // Reproject previous UV cleanly when the local 40m window shifts by whole texels
          vec2 prevUv = vUv + uShiftUV;
          vec4 cur = samplePrevSafe(prevUv);
          float h = cur.r;
          float hPrev = cur.g;
          float foam = cur.b;

          // 2D discrete wave equation (Verlet integration, stable c^2 <= 0.5)
          float hL = samplePrevSafe(prevUv - vec2(uTexelSize.x, 0.0)).r;
          float hR = samplePrevSafe(prevUv + vec2(uTexelSize.x, 0.0)).r;
          float hD = samplePrevSafe(prevUv - vec2(0.0, uTexelSize.y)).r;
          float hU = samplePrevSafe(prevUv + vec2(0.0, uTexelSize.y)).r;

          float avg = (hL + hR + hD + hU) * 0.25;
          float laplacian = avg - h;
          float newH = (2.0 * h - hPrev) + laplacian * 0.62;
          // Gentle spatial smoothing kills Nyquist checkerboard ringing so ripples stay silky smooth!
          newH = mix(newH, avg, 0.045);

          // Soft absorbing boundary sponge near window edges so waves never bounce back
          float edgeX = min(vUv.x, 1.0 - vUv.x);
          float edgeY = min(vUv.y, 1.0 - vUv.y);
          float edgeMask = smoothstep(0.0, 0.08, min(edgeX, edgeY));
          newH *= (0.980 * edgeMask);

          // Gently diffuse & decay aerated Kelvin V-wake foam (subtle wispy trail, never thick opaque milk!)
          float fL = samplePrevSafe(prevUv - vec2(uTexelSize.x, 0.0)).b;
          float fR = samplePrevSafe(prevUv + vec2(uTexelSize.x, 0.0)).b;
          float fD = samplePrevSafe(prevUv - vec2(0.0, uTexelSize.y)).b;
          float fU = samplePrevSafe(prevUv + vec2(0.0, uTexelSize.y)).b;
          float newFoam = mix(foam, (fL + fR + fD + fU) * 0.25, 0.16) * 0.974 * edgeMask;

          // World XZ position of this texel
          vec2 worldXZ = uSimCenter + (vUv - 0.5) * uSimSize;

          // Inject smooth physical body-water collision impulses (gentle bow swell + clean Kelvin V-wake!)
          for (int i = 0; i < ${MAX_BODIES}; i++) {
            if (i >= uBodyCount) break;
            vec4 bp = uBodyPosRad[i];
            if (bp.w <= 0.001) continue;
            vec4 bv = uBodyVelStr[i];

            vec2 toPix = worldXZ - bp.xy;
            float dist = length(toPix);
            float rad = max(bp.z, 0.20);
            float outer = rad * 3.4;
            if (dist < outer) {
              float spd = bv.z;
              vec2 dir = spd > 0.08 ? (bv.xy / spd) : vec2(0.0, 1.0);
              vec2 perp = vec2(-dir.y, dir.x);
              vec2 unitP = dist > 0.001 ? (toPix / dist) : dir;
              float align = dot(unitP, dir); // +1 ahead of body (bow), -1 behind (stern)
              float sideOff = abs(dot(toPix, perp));

              // 1. Soft Gaussian displacement & smooth outer ripple crest (zero sharp grid pinching!)
              float coreT = exp(-pow(dist / (rad * 0.98), 2.0));
              float rimT = exp(-pow((dist - rad * 1.32) / (rad * 0.70), 2.0));

              // 2. Gentle directional bow wave + twin trailing V-wake ripple crests behind moving body
              float moveFactor = clamp(spd / 2.6, 0.0, 1.30);
              float bowImpulse = align * rimT * moveFactor * 0.075 * bp.w;
              float behindMask = smoothstep(0.10, -0.45, align);
              float vWakeArm = exp(-pow((sideOff - rad * (0.48 + 0.52 * clamp(-align, 0.0, 1.0))) / (rad * 0.65), 2.0));
              float wakeRipple = behindMask * vWakeArm * moveFactor * 0.055 * bp.w;

              // 3. Ultra-delicate idle breathing ripple
              float idlePulse = sin(uTime * 3.2 + float(i) * 2.1) * 0.009 * bp.w;
              float bodyDip = (-coreT * (0.028 + 0.042 * moveFactor) + rimT * (0.018 + 0.030 * moveFactor)) * bp.w;

              newH += bowImpulse + bodyDip + wakeRipple + rimT * idlePulse;

              // 4. Delicate airy wake wisps behind moving body (zero solid white paint smear!)
              float trailRibbon = (coreT * 0.30 + behindMask * vWakeArm * 0.42) * moveFactor * 0.52 * bp.w;
              float idleRimFoam = rimT * 0.05 * bp.w;
              newFoam = max(newFoam, clamp(max(trailRibbon, idleRimFoam), 0.0, 0.62));
            }
          }

          // Strict stability clamp so wave equation can never explode
          newH = clamp(newH, -1.0, 1.0);
          newFoam = clamp(newFoam, 0.0, 1.0);

          gl_FragColor = vec4(newH, h, newFoam, 1.0);
        }
      `
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.simMat);
    quad.frustumCulled = false;
    this.simScene.add(quad);
  }

  public get texture(): THREE.Texture {
    return (this.readIdx === 0 ? this.rtA : this.rtB).texture;
  }

  public beginFrame(): void {
    this.activeBodyCount = 0;
    this.playerBodyUniform.w = 0;
    this.playerVelUniform.set(0, 0);
    for (let i = 0; i < this.nearBodiesUniform.length; i++) {
      this.nearBodiesUniform[i].set(0, -500, 0.32, 0);
    }
  }

  public addPlayerBody(
    x: number,
    z: number,
    vx: number,
    vz: number,
    radius: number,
    strength: number
  ): void {
    this.playerBodyUniform.set(x, z, radius, strength);
    this.playerVelUniform.set(vx, vz);
    this.addBody(x, z, vx, vz, radius, strength);
  }

  public addBody(
    x: number,
    z: number,
    vx: number,
    vz: number,
    radius: number,
    strength: number
  ): void {
    if (strength <= 0.01 || this.activeBodyCount >= MAX_BODIES) return;
    const idx = this.activeBodyCount++;
    const spd = Math.hypot(vx, vz);
    this.bodyPosRad[idx].set(x, z, radius, THREE.MathUtils.clamp(strength, 0, 1.6));
    this.bodyVelStr[idx].set(vx, vz, spd, 0);
  }

  public setNearestNpcBody(slot: number, x: number, z: number, radius: number, strength: number): void {
    if (slot < 0 || slot >= this.nearBodiesUniform.length) return;
    this.nearBodiesUniform[slot].set(x, z, radius, strength);
  }

  public step(renderer: THREE.WebGLRenderer, dt: number, elapsedTime: number, focusX: number, focusZ: number): void {
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    if (!this.initialized) {
      this.initialized = true;
      const texelWorld = this.simSize / this.resolution;
      this.center.set(
        Math.round(focusX / texelWorld) * texelWorld,
        Math.round(focusZ / texelWorld) * texelWorld
      );
      renderer.setRenderTarget(this.rtA);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      renderer.setRenderTarget(this.rtB);
      renderer.clear(true, false, false);
    }

    // Fixed 60 Hz substep (max 2 substeps/frame) keeps wave propagation speed framerate-independent!
    const fixedDt = 1 / 60;
    this.accumulator = Math.min(this.accumulator + Math.min(dt, 0.05), fixedDt * 2.2);

    const texelWorld = this.simSize / this.resolution;
    const targetCx = Math.round(focusX / texelWorld) * texelWorld;
    const targetCz = Math.round(focusZ / texelWorld) * texelWorld;

    let steps = 0;
    while (this.accumulator >= fixedDt * 0.5 && steps < 2) {
      this.accumulator -= fixedDt;
      steps++;

      // Apply center shift on first substep only
      let shiftU = 0;
      let shiftV = 0;
      if (steps === 1) {
        const dx = targetCx - this.center.x;
        const dz = targetCz - this.center.y;
        if (Math.abs(dx) > 1e-4 || Math.abs(dz) > 1e-4) {
          shiftU = dx / this.simSize;
          shiftV = dz / this.simSize;
          this.center.set(targetCx, targetCz);
        }
      }

      const readRT = this.readIdx === 0 ? this.rtA : this.rtB;
      const writeRT = this.readIdx === 0 ? this.rtB : this.rtA;

      this.simMat.uniforms.tPrev.value = readRT.texture;
      this.simMat.uniforms.uShiftUV.value.set(shiftU, shiftV);
      this.simMat.uniforms.uTime.value = elapsedTime;
      this.simMat.uniforms.uBodyCount.value = this.activeBodyCount;

      renderer.setRenderTarget(writeRT);
      renderer.render(this.simScene, this.simCamera);

      this.readIdx = 1 - this.readIdx;
    }

    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(prevTarget);
  }
}
