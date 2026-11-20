import * as THREE from 'three';
import { sampleWaveHeight } from './wavePhysics';
import { getTerrainHeight } from '../terrain/terrainMath';

interface BubbleState {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  maxAge: number;
  size: number;
  wobblePhase: number;
}

/**
 * Underwater particle systems:
 *  1. Suspended plankton / silt motes drifting organically in a volume around the camera,
 *     brightly illuminated when catching underwater sun shafts and fading out above water.
 *  2. Rising 3D bubble streams emitted during dives, swim strokes, and splashes, rising
 *     with buoyant wobble and popping cleanly at the live wave surface.
 */
export class UnderwaterParticles {
  public readonly group = new THREE.Group();

  // Plankton / silt motes
  private readonly motePoints: THREE.Points;
  private readonly moteMaterial: THREE.ShaderMaterial;

  // 3D Rising Bubbles (InstancedMesh of iridescent translucent spheres)
  private readonly bubbleMesh: THREE.InstancedMesh;
  private readonly bubbles: BubbleState[] = [];
  private readonly maxBubbles = 260;
  private bubbleCursor = 0;
  private readonly dummy = new THREE.Object3D();

  constructor() {
    this.group.name = 'UnderwaterParticles';

    // 1. Drifting plankton / silt motes
    const moteCount = 520;
    const positions = new Float32Array(moteCount * 3);
    const seeds = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 26.0;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 14.0;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 26.0;
      seeds[i * 3 + 0] = Math.random();
      seeds[i * 3 + 1] = Math.random();
      seeds[i * 3 + 2] = 0.5 + Math.random() * 1.1;
    }

    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    moteGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));

    this.moteMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uSunDirection: { value: new THREE.Vector3(0.35, 0.72, 0.58).normalize() },
        uSunColor: { value: new THREE.Color(0xfff4dd) },
        uWaterHeight: { value: 0 }
      },
      vertexShader: /* glsl */ `
        attribute vec3 aSeed;
        uniform float uTime;
        uniform vec3 uCenter;
        uniform vec3 uSunDirection;
        uniform float uWaterHeight;

        varying float vAlpha;
        varying float vShaft;

        void main() {
          vec3 box = vec3(26.0, 14.0, 26.0);
          vec3 drift = vec3(
            sin(uTime * 0.35 + aSeed.x * 6.28) * 0.65,
            cos(uTime * 0.24 + aSeed.y * 6.28) * 0.45,
            sin(uTime * 0.29 + aSeed.z * 6.28) * 0.65
          );

          // Wrap motes seamlessly around camera world position
          vec3 rel = mod(position + drift - uCenter + box * 0.5, box) - box * 0.5;
          vec3 wp = uCenter + rel;

          // Only visible underwater!
          float subMask = smoothstep(0.05, -0.35, wp.y - uWaterHeight);
          float dist = length(rel);
          float distFade = smoothstep(13.0, 3.5, dist) * smoothstep(0.4, 1.2, dist);

          // Sun-shaft illumination sparkle
          float shaftWave = sin(wp.x * 0.65 + wp.z * 0.55 - uTime * 0.55) * 0.5 + 0.5;
          vShaft = pow(shaftWave, 2.2) * exp(-max(0.0, -wp.y) * 0.12) * smoothstep(0.05, 0.3, uSunDirection.y);
          vAlpha = subMask * distFade * (0.28 + 0.72 * vShaft);

          vec4 mvPos = modelViewMatrix * vec4(wp, 1.0);
          gl_PointSize = clamp((16.0 * aSeed.z) / max(-mvPos.z, 0.5), 1.5, 6.5);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunColor;
        varying float vAlpha;
        varying float vShaft;

        void main() {
          if (vAlpha <= 0.01) discard;
          vec2 c = gl_PointCoord - 0.5;
          float r = length(c);
          if (r > 0.5) discard;
          float soft = pow(1.0 - r * 2.0, 1.8);
          vec3 col = mix(vec3(0.42, 0.85, 0.90), uSunColor * 1.15, vShaft * 0.65);
          gl_FragColor = vec4(col, soft * vAlpha * 0.68);
        }
      `
    });

    this.motePoints = new THREE.Points(moteGeo, this.moteMaterial);
    this.motePoints.frustumCulled = false;
    this.group.add(this.motePoints);

    // 2. 3D Rising Bubbles
    const bubbleGeo = new THREE.SphereGeometry(1, 10, 8);
    const bubbleMat = new THREE.MeshPhysicalMaterial({
      color: 0xdffbff,
      roughness: 0.06,
      metalness: 0.05,
      transmission: 0.72,
      transparent: true,
      opacity: 0.68,
      ior: 1.33,
      depthWrite: false
    });

    this.bubbleMesh = new THREE.InstancedMesh(bubbleGeo, bubbleMat, this.maxBubbles);
    this.bubbleMesh.frustumCulled = false;
    this.bubbleMesh.renderOrder = 3;

    for (let i = 0; i < this.maxBubbles; i++) {
      this.bubbles.push({
        active: false,
        pos: new THREE.Vector3(0, -100, 0),
        vel: new THREE.Vector3(),
        age: 0,
        maxAge: 2.0,
        size: 0.02,
        wobblePhase: Math.random() * Math.PI * 2
      });
      this.dummy.position.set(0, -100, 0);
      this.dummy.scale.setScalar(0.0001);
      this.dummy.updateMatrix();
      this.bubbleMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.bubbleMesh.instanceMatrix.needsUpdate = true;
    this.group.add(this.bubbleMesh);
  }

  /**
   * Emit a burst or stream of 3D rising bubbles at a submerged world position.
   */
  public emitBubbles(
    origin: THREE.Vector3,
    count: number,
    spread = 0.25,
    baseSpeed = 0.75
  ): void {
    for (let i = 0; i < count; i++) {
      const b = this.bubbles[this.bubbleCursor];
      this.bubbleCursor = (this.bubbleCursor + 1) % this.maxBubbles;

      b.active = true;
      b.pos.set(
        origin.x + (Math.random() - 0.5) * spread,
        origin.y + (Math.random() - 0.5) * spread * 0.6,
        origin.z + (Math.random() - 0.5) * spread
      );
      b.vel.set(
        (Math.random() - 0.5) * 0.45,
        baseSpeed * (0.7 + Math.random() * 0.75),
        (Math.random() - 0.5) * 0.45
      );
      b.age = 0;
      b.maxAge = 1.6 + Math.random() * 2.4;
      b.size = 0.012 + Math.random() * 0.036;
      b.wobblePhase = Math.random() * Math.PI * 2;
    }
  }

  public update(
    dt: number,
    elapsedTime: number,
    cameraPos: THREE.Vector3,
    waveIntensity: number,
    sunDirection: THREE.Vector3,
    sunColor: THREE.Color
  ): void {
    const camWaveH = sampleWaveHeight(
      cameraPos.x,
      cameraPos.z,
      elapsedTime,
      waveIntensity,
      getTerrainHeight(cameraPos.x, cameraPos.z)
    );

    this.moteMaterial.uniforms.uTime.value = elapsedTime;
    this.moteMaterial.uniforms.uCenter.value.copy(cameraPos);
    this.moteMaterial.uniforms.uSunDirection.value.copy(sunDirection);
    this.moteMaterial.uniforms.uSunColor.value.copy(sunColor);
    this.moteMaterial.uniforms.uWaterHeight.value = camWaveH;

    // Update rising 3D bubbles
    let anyDirty = false;
    for (let i = 0; i < this.maxBubbles; i++) {
      const b = this.bubbles[i];
      if (!b.active) continue;
      anyDirty = true;

      b.age += dt;
      // Buoyant upward acceleration + lateral drag
      b.vel.y = Math.min(b.vel.y + 1.45 * dt, 1.95);
      b.vel.x *= Math.exp(-2.4 * dt);
      b.vel.z *= Math.exp(-2.4 * dt);

      const wobbleX = Math.sin(elapsedTime * 5.2 + b.wobblePhase) * 0.22;
      const wobbleZ = Math.cos(elapsedTime * 4.7 + b.wobblePhase) * 0.22;

      b.pos.x += (b.vel.x + wobbleX) * dt;
      b.pos.y += b.vel.y * dt;
      b.pos.z += (b.vel.z + wobbleZ) * dt;

      const surfaceY = sampleWaveHeight(b.pos.x, b.pos.z, elapsedTime, waveIntensity, -4.0);
      if (b.age >= b.maxAge || b.pos.y >= surfaceY - 0.02) {
        b.active = false;
        this.dummy.position.set(0, -100, 0);
        this.dummy.scale.setScalar(0.0001);
        this.dummy.updateMatrix();
        this.bubbleMesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }

      const lifeT = b.age / b.maxAge;
      const pulse = 1.0 + 0.14 * Math.sin(elapsedTime * 9.0 + b.wobblePhase);
      const scale = b.size * (0.65 + 0.55 * Math.min(lifeT * 3.0, 1.0)) * pulse;
      this.dummy.position.copy(b.pos);
      this.dummy.scale.set(scale, scale * 0.88, scale);
      this.dummy.updateMatrix();
      this.bubbleMesh.setMatrixAt(i, this.dummy.matrix);
    }

    if (anyDirty) {
      this.bubbleMesh.instanceMatrix.needsUpdate = true;
    }
  }
}
