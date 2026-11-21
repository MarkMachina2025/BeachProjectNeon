import * as THREE from 'three';
import { sampleWaveHeight } from './wavePhysics';
import { getTerrainHeight } from '../terrain/terrainMath';

interface RippleRing {
  active: boolean;
  x: number;
  z: number;
  age: number;
  maxAge: number;
  startRadius: number;
  endRadius: number;
  intensity: number;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

interface SplashDroplet {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  maxAge: number;
  size: number;
}

/**
 * Real-Time Physical Water-Entry Interaction System:
 *  1. Expanding concentric water ripple & aerated foam rings conforming to the live Gerstner
 *     wave surface whenever the player or NPCs step into water, wade, jump, or swim!
 *  2. Continuous subtle whitewater contact foam collars around ankles/legs/torsos piercing water.
 *  3. Ballistic 3D glistening water splash droplets & spray bursts arcing out of the surf!
 */
export class WaterInteractionSystem {
  public readonly group = new THREE.Group();

  private readonly rings: RippleRing[] = [];
  private ringCursor = 0;
  private readonly maxRings = 28;

  private readonly droplets: SplashDroplet[] = [];
  private dropletCursor = 0;
  private readonly maxDroplets = 240;
  private readonly dropletMesh: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();

  constructor() {
    this.group.name = 'WaterInteractions';

    // 1. Pool of dynamic expanding concentric ripple/foam rings
    const ringGeo = new THREE.PlaneGeometry(2, 2);
    ringGeo.rotateX(-Math.PI / 2);

    for (let i = 0; i < this.maxRings; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        uniforms: {
          uAgeNorm: { value: 1.0 },
          uIntensity: { value: 1.0 },
          uTime: { value: 0.0 }
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uAgeNorm;
          uniform float uIntensity;
          uniform float uTime;
          varying vec2 vUv;

          void main() {
            vec2 p = vUv * 2.0 - 1.0;
            float r = length(p);
            if (r > 1.0) discard;

            float angle = atan(p.y, p.x);
            float organic = sin(angle * 7.0 + uTime * 3.0) * 0.03 + cos(angle * 13.0 - uTime * 2.0) * 0.02;
            float rr = r + organic;

            // Primary expanding crest ring + trailing secondary concentric harmonic ripples
            float ring1 = exp(-pow((rr - 0.80) / 0.075, 2.0));
            float ring2 = exp(-pow((rr - 0.56) / 0.065, 2.0)) * 0.62;
            float ring3 = exp(-pow((rr - 0.34) / 0.06, 2.0)) * 0.35;
            float innerFoam = smoothstep(0.42, 0.05, rr) * (1.0 - uAgeNorm) * 0.55;

            float pattern = ring1 + ring2 + ring3 + innerFoam;
            float fadeIn = smoothstep(0.0, 0.12, uAgeNorm);
            float fadeOut = pow(clamp(1.0 - uAgeNorm, 0.0, 1.0), 1.45);
            float alpha = clamp(pattern * fadeIn * fadeOut * uIntensity * 0.88, 0.0, 0.92);

            if (alpha < 0.01) discard;
            vec3 foamCol = mix(vec3(0.76, 0.94, 0.98), vec3(0.98, 0.99, 1.0), clamp(ring1 + innerFoam, 0.0, 1.0));
            gl_FragColor = vec4(foamCol, alpha);
          }
        `
      });

      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.group.add(mesh);

      this.rings.push({
        active: false,
        x: 0,
        z: 0,
        age: 1,
        maxAge: 1.4,
        startRadius: 0.22,
        endRadius: 1.45,
        intensity: 1,
        mesh,
        material: mat
      });
    }

    // 2. Pool of ballistic 3D glistening water splash droplets
    const dropGeo = new THREE.SphereGeometry(1, 7, 6);
    const dropMat = new THREE.MeshPhysicalMaterial({
      color: 0xe6fbff,
      roughness: 0.08,
      metalness: 0.02,
      transparent: true,
      opacity: 0.78,
      depthWrite: false
    });

    this.dropletMesh = new THREE.InstancedMesh(dropGeo, dropMat, this.maxDroplets);
    this.dropletMesh.frustumCulled = false;
    this.dropletMesh.renderOrder = 5;

    for (let i = 0; i < this.maxDroplets; i++) {
      this.droplets.push({
        active: false,
        pos: new THREE.Vector3(0, -100, 0),
        vel: new THREE.Vector3(),
        age: 0,
        maxAge: 0.65,
        size: 0.025
      });
      this.dummy.position.set(0, -100, 0);
      this.dummy.scale.setScalar(0.0001);
      this.dummy.updateMatrix();
      this.dropletMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.dropletMesh.instanceMatrix.needsUpdate = true;
    this.group.add(this.dropletMesh);
  }

  /**
   * Spawn an expanding concentric ripple ring + optional upward 3D water spray burst!
   */
  public spawnSplash(
    x: number,
    y: number,
    z: number,
    intensity = 0.85,
    dropletCount = 12,
    endRadius = 1.45
  ): void {
    const ring = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % this.maxRings;
    ring.active = true;
    ring.x = x;
    ring.z = z;
    ring.age = 0;
    ring.maxAge = 1.15 + intensity * 0.65;
    ring.startRadius = 0.16;
    ring.endRadius = endRadius;
    ring.intensity = intensity;
    ring.mesh.visible = true;

    for (let i = 0; i < dropletCount; i++) {
      const d = this.droplets[this.dropletCursor];
      this.dropletCursor = (this.dropletCursor + 1) % this.maxDroplets;

      const ang = Math.random() * Math.PI * 2;
      const radialSpeed = (0.35 + Math.random() * 1.15) * intensity;
      const upSpeed = (1.1 + Math.random() * 2.15) * intensity;

      d.active = true;
      d.pos.set(
        x + Math.cos(ang) * 0.12,
        y + 0.03 + Math.random() * 0.08,
        z + Math.sin(ang) * 0.12
      );
      d.vel.set(Math.cos(ang) * radialSpeed, upSpeed, Math.sin(ang) * radialSpeed);
      d.age = 0;
      d.maxAge = 0.38 + Math.random() * 0.42;
      d.size = (0.015 + Math.random() * 0.028) * (0.75 + 0.4 * intensity);
    }
  }

  /**
   * Spawn a gentler continuous wake/collar ripple around a wading or swimming character.
   */
  public spawnRipple(x: number, z: number, intensity = 0.6, endRadius = 1.15): void {
    this.spawnSplash(x, 0, z, intensity, 0, endRadius);
  }

  public update(dt: number, elapsedTime: number, waveIntensity: number): void {
    // 1. Update expanding water-surface rings conforming to live wave height & slope
    for (let i = 0; i < this.maxRings; i++) {
      const r = this.rings[i];
      if (!r.active) continue;

      r.age += dt;
      if (r.age >= r.maxAge) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }

      const t = r.age / r.maxAge;
      const easeOut = 1.0 - Math.pow(1.0 - t, 2.2);
      const radius = THREE.MathUtils.lerp(r.startRadius, r.endRadius, easeOut);

      const terrainH = getTerrainHeight(r.x, r.z);
      const waveH = sampleWaveHeight(r.x, r.z, elapsedTime, waveIntensity, terrainH);
      const waveHx = sampleWaveHeight(r.x + 0.3, r.z, elapsedTime, waveIntensity, terrainH);
      const waveHz = sampleWaveHeight(r.x, r.z + 0.3, elapsedTime, waveIntensity, terrainH);

      r.mesh.position.set(r.x, waveH + 0.022, r.z);
      r.mesh.scale.set(radius, 1, radius);
      r.mesh.rotation.set((waveHz - waveH) * 1.4, 0, -(waveHx - waveH) * 1.4);

      r.material.uniforms.uAgeNorm.value = t;
      r.material.uniforms.uIntensity.value = r.intensity;
      r.material.uniforms.uTime.value = elapsedTime;
    }

    // 2. Update ballistic 3D water spray droplets
    let dirty = false;
    for (let i = 0; i < this.maxDroplets; i++) {
      const d = this.droplets[i];
      if (!d.active) continue;
      dirty = true;

      d.age += dt;
      d.vel.y -= 9.2 * dt;
      d.vel.x *= Math.exp(-1.4 * dt);
      d.vel.z *= Math.exp(-1.4 * dt);
      d.pos.addScaledVector(d.vel, dt);

      const surfY = sampleWaveHeight(d.pos.x, d.pos.z, elapsedTime, waveIntensity, -1.0);
      if (d.age >= d.maxAge || (d.vel.y < 0 && d.pos.y < surfY - 0.05)) {
        d.active = false;
        this.dummy.position.set(0, -100, 0);
        this.dummy.scale.setScalar(0.0001);
        this.dummy.updateMatrix();
        this.dropletMesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }

      const lifeFade = 1.0 - d.age / d.maxAge;
      const sc = d.size * (0.4 + 0.6 * lifeFade);
      this.dummy.position.copy(d.pos);
      // Stretch droplet slightly along vertical velocity for authentic spray arcs
      const stretch = 1.0 + Math.min(Math.abs(d.vel.y) * 0.35, 1.2);
      this.dummy.scale.set(sc, sc * stretch, sc);
      this.dummy.updateMatrix();
      this.dropletMesh.setMatrixAt(i, this.dummy.matrix);
    }

    if (dirty) {
      this.dropletMesh.instanceMatrix.needsUpdate = true;
    }
  }
}
