import * as THREE from 'three';
import { TERRAIN_HEIGHT_GLSL } from './terrainMath';
import { GERSTNER_GLSL } from '../ocean/wavePhysics';

/**
 * Expanded (+50%) playable beach & shallow wading footprint deformation zone.
 * Uses 2048x2048 RTT resolution so anatomically accurate ~27cm human footprints
 * render crisp, detailed, and realistic across the entire wide beach!
 */
export const FOOTPRINT_BOUNDS = {
  minX: -72,
  maxX: 72,
  minZ: -56,
  maxZ: 36,
  width: 144,
  depth: 92,
  resolution: 2048
};

interface QueuedStamp {
  x: number;
  z: number;
  yaw: number;
  isRight: boolean;
  strength: number;
  scale: number;
}

/**
 * Real-time Render-to-Texture (RTT) 2048x2048 ping-pong sand deformation system.
 * - Realistic human foot proportions (~11cm wide x ~27cm long bare impression)
 * - R = recessed footprint cavity, G = displaced outer sand ridge, B = wave-wetness memory
 * - Wet/wave-washed shoreline footprints smooth & fade rapidly; dry prints persist long.
 */
export class FootprintSystem {
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private readTarget: THREE.WebGLRenderTarget;
  private writeTarget: THREE.WebGLRenderTarget;

  private decayScene: THREE.Scene;
  private decayCamera: THREE.OrthographicCamera;
  private decayMaterial: THREE.ShaderMaterial;

  private stampScene: THREE.Scene;
  private stampCamera: THREE.OrthographicCamera;
  private stampMesh: THREE.Mesh;
  private stampMaterial: THREE.ShaderMaterial;

  private queue: QueuedStamp[] = [];
  private totalStamps = 0;

  constructor(renderer: THREE.WebGLRenderer) {
    const supportsHalfFloat =
      renderer.capabilities.isWebGL2 &&
      renderer.extensions.has('EXT_color_buffer_float');

    const rtOpts: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      format: THREE.RGBAFormat,
      type: supportsHalfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false
    };

    this.rtA = new THREE.WebGLRenderTarget(
      FOOTPRINT_BOUNDS.resolution,
      FOOTPRINT_BOUNDS.resolution,
      rtOpts
    );
    this.rtB = new THREE.WebGLRenderTarget(
      FOOTPRINT_BOUNDS.resolution,
      FOOTPRINT_BOUNDS.resolution,
      rtOpts
    );

    this.readTarget = this.rtA;
    this.writeTarget = this.rtB;

    const prevTarget = renderer.getRenderTarget();
    const prevClearColor = new THREE.Color();
    renderer.getClearColor(prevClearColor);
    const prevClearAlpha = renderer.getClearAlpha();

    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.rtA);
    renderer.clear();
    renderer.setRenderTarget(this.rtB);
    renderer.clear();

    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClearColor, prevClearAlpha);

    // Ping-pong wave-wash smoothing & decay pass
    this.decayScene = new THREE.Scene();
    this.decayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.decayMaterial = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPrevMap: { value: this.readTarget.texture },
        uTexelSize: { value: new THREE.Vector2(1 / FOOTPRINT_BOUNDS.resolution, 1 / FOOTPRINT_BOUNDS.resolution) },
        uBoundsMin: { value: new THREE.Vector2(FOOTPRINT_BOUNDS.minX, FOOTPRINT_BOUNDS.minZ) },
        uBoundsSize: { value: new THREE.Vector2(FOOTPRINT_BOUNDS.width, FOOTPRINT_BOUNDS.depth) },
        uTime: { value: 0 },
        uDt: { value: 0.016 },
        uWaveIntensity: { value: 1.0 }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uPrevMap;
        uniform vec2 uTexelSize;
        uniform vec2 uBoundsMin;
        uniform vec2 uBoundsSize;
        uniform float uTime;
        uniform float uDt;
        uniform float uWaveIntensity;
        varying vec2 vUv;

        ${TERRAIN_HEIGHT_GLSL}
        ${GERSTNER_GLSL}

        void main() {
          vec4 cur = texture2D(uPrevMap, vUv);

          vec2 worldXZ = uBoundsMin + vUv * uBoundsSize;
          float terrainH = getTerrainHeightGLSL(worldXZ);
          float shoal = waveShoalingFactorGLSL(terrainH);
          float waveH = evalWaveHeightApprox(worldXZ, uTime, uWaveIntensity, shoal);

          float washDepth = waveH - terrainH;
          float washedNow = smoothstep(-0.04, 0.14, washDepth);
          float dampZone = smoothstep(0.68, 0.08, terrainH);

          vec4 nL = texture2D(uPrevMap, vUv - vec2(uTexelSize.x, 0.0));
          vec4 nR = texture2D(uPrevMap, vUv + vec2(uTexelSize.x, 0.0));
          vec4 nD = texture2D(uPrevMap, vUv - vec2(0.0, uTexelSize.y));
          vec4 nU = texture2D(uPrevMap, vUv + vec2(0.0, uTexelSize.y));
          vec4 avg = (nL + nR + nD + nU) * 0.25;

          // Smooth prints quickly when waves wash over them; barely blur on dry sand
          float diffuseRate = (washedNow * 4.2 + dampZone * 0.18) * uDt;
          vec2 rg = mix(cur.rg, avg.rg, clamp(diffuseRate, 0.0, 0.55));

          // Fast fade when washed by waves (~4-7s), moderate in damp sand, persistent in dry sand (~140s)
          float decayRate = 0.007 + dampZone * 0.032 + washedNow * 0.38;
          rg *= exp(-decayRate * uDt);
          rg = max(rg - vec2(0.00015 * uDt), vec2(0.0));

          float wetMem = max(cur.b * exp(-0.055 * uDt), washedNow);
          gl_FragColor = vec4(rg, wetMem, 1.0);
        }
      `
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.decayMaterial);
    this.decayScene.add(quad);

    // Orthographic stamp scene mapped directly to world X/Z bounds
    this.stampScene = new THREE.Scene();
    this.stampCamera = new THREE.OrthographicCamera(
      FOOTPRINT_BOUNDS.minX,
      FOOTPRINT_BOUNDS.maxX,
      FOOTPRINT_BOUNDS.maxZ,
      FOOTPRINT_BOUNDS.minZ,
      -5,
      5
    );
    this.stampCamera.position.set(0, 0, 2);

    this.stampMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      uniforms: {
        uIsRight: { value: 1.0 },
        uStrength: { value: 1.0 }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uIsRight;
        uniform float uStrength;
        varying vec2 vUv;

        float sdEllipse(vec2 p, vec2 c, vec2 r) {
          vec2 q = (p - c) / r;
          return (length(q) - 1.0) * min(r.x, r.y);
        }

        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          p.x *= (uIsRight > 0.5 ? 1.0 : -1.0);

          // Compact anatomical human barefoot proportions (heel -> narrow arch -> ball -> 5 toes)
          float dHeel = sdEllipse(p, vec2(0.04, -0.48), vec2(0.30, 0.30));
          float dMid  = sdEllipse(p, vec2(0.11, -0.06), vec2(0.22, 0.31));
          float dBall = sdEllipse(p, vec2(-0.02, 0.28), vec2(0.37, 0.27));

          float k = 0.20;
          float h1 = clamp(0.5 + 0.5 * (dMid - dHeel) / k, 0.0, 1.0);
          float dSole = mix(dMid, dHeel, h1) - k * h1 * (1.0 - h1);
          float h2 = clamp(0.5 + 0.5 * (dBall - dSole) / k, 0.0, 1.0);
          dSole = mix(dBall, dSole, h2) - k * h2 * (1.0 - h2);

          float dArch = sdEllipse(p, vec2(-0.34, -0.06), vec2(0.21, 0.26));
          dSole = max(dSole, -dArch * 0.72);

          float dToe1 = sdEllipse(p, vec2(-0.23, 0.68), vec2(0.13, 0.13));
          float dToe2 = sdEllipse(p, vec2(-0.04, 0.72), vec2(0.09, 0.10));
          float dToe3 = sdEllipse(p, vec2(0.12, 0.68),  vec2(0.08, 0.09));
          float dToe4 = sdEllipse(p, vec2(0.24, 0.61),  vec2(0.072, 0.08));
          float dToe5 = sdEllipse(p, vec2(0.34, 0.52),  vec2(0.064, 0.07));
          float dToes = min(min(min(dToe1, dToe2), min(dToe3, dToe4)), dToe5);

          float dFoot = min(dSole, dToes);

          float cavity = smoothstep(0.07, -0.13, dFoot);
          float heelWeight = 0.84 + 0.24 * smoothstep(-0.12, -0.60, p.y);
          float ballWeight = 0.86 + 0.20 * smoothstep(0.0, 0.42, p.y);
          float depthVal = clamp(cavity * max(heelWeight, ballWeight) * uStrength, 0.0, 1.0);

          float rim = exp(-pow((dFoot - 0.14) / 0.14, 2.0)) * 0.68 * uStrength;

          float boxFade = smoothstep(1.0, 0.84, max(abs(p.x), abs(p.y)));
          depthVal *= boxFade;
          rim *= boxFade;

          if (depthVal < 0.002 && rim < 0.002) discard;
          gl_FragColor = vec4(depthVal, rim, 0.0, 1.0);
        }
      `
    });

    // Realistic adult human foot stamp quad: 0.21m wide x 0.36m long (recessed sole = ~11cm x 27cm!)
    const stampGeo = new THREE.PlaneGeometry(0.21, 0.36);
    this.stampMesh = new THREE.Mesh(stampGeo, this.stampMaterial);
    this.stampScene.add(this.stampMesh);
  }

  public get texture(): THREE.Texture {
    return this.readTarget.texture;
  }

  public get stampCount(): number {
    return this.totalStamps;
  }

  public stamp(
    x: number,
    z: number,
    yaw: number,
    isRight: boolean,
    strength = 0.92,
    scale = 1.0
  ): void {
    if (
      x < FOOTPRINT_BOUNDS.minX + 1 ||
      x > FOOTPRINT_BOUNDS.maxX - 1 ||
      z < FOOTPRINT_BOUNDS.minZ + 1 ||
      z > FOOTPRINT_BOUNDS.maxZ - 1
    ) {
      return;
    }
    this.queue.push({ x, z, yaw, isRight, strength, scale });
    this.totalStamps++;
  }

  public update(
    renderer: THREE.WebGLRenderer,
    dt: number,
    elapsedTime: number,
    waveIntensity: number
  ): void {
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;

    this.decayMaterial.uniforms.uPrevMap.value = this.readTarget.texture;
    this.decayMaterial.uniforms.uTime.value = elapsedTime;
    this.decayMaterial.uniforms.uDt.value = dt;
    this.decayMaterial.uniforms.uWaveIntensity.value = waveIntensity;

    renderer.autoClear = false;
    renderer.setRenderTarget(this.writeTarget);
    renderer.render(this.decayScene, this.decayCamera);

    if (this.queue.length > 0) {
      for (let i = 0; i < this.queue.length; i++) {
        const s = this.queue[i];
        this.stampMesh.position.set(s.x, s.z, 0);
        this.stampMesh.rotation.set(0, 0, -s.yaw);
        this.stampMesh.scale.set(s.scale, s.scale, 1);
        this.stampMaterial.uniforms.uIsRight.value = s.isRight ? 1.0 : 0.0;
        this.stampMaterial.uniforms.uStrength.value = s.strength;
        renderer.render(this.stampScene, this.stampCamera);
      }
      this.queue.length = 0;
    }

    const tmp = this.readTarget;
    this.readTarget = this.writeTarget;
    this.writeTarget = tmp;

    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(prevTarget);
  }

  public dispose(): void {
    this.rtA.dispose();
    this.rtB.dispose();
    this.decayMaterial.dispose();
    this.stampMaterial.dispose();
  }
}
