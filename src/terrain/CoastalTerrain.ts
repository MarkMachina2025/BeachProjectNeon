import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { getTerrainHeight } from './terrainMath';
import { FOOTPRINT_BOUNDS, FootprintSystem } from './FootprintSystem';
import { GERSTNER_GLSL } from '../ocean/wavePhysics';
import { CAUSTICS_GLSL } from '../shaders/causticsChunk';

/**
 * High-resolution coastal bay & seabed terrain with physically based sand
 * rendered via three-custom-shader-material (extending MeshStandardMaterial):
 *  - Procedural multi-scale sand grain normal perturbation & ripples
 *  - View-dependent quartz sparkle / micro-glint in sunlight
 *  - Dynamic wet-to-dry shoreline transition (darker albedo, low roughness, sheen)
 *  - Real-time RTT footprint displacement, gradient normal perturbation & AO
 *  - Dual-layer animated underwater caustics on the submerged seabed
 */
export class CoastalTerrain {
  public readonly mesh: THREE.Mesh;
  public readonly material: CustomShaderMaterial;

  constructor(footprints: FootprintSystem) {
    // High-density mesh covering X: [-110, 110], Z: [-70, 145]
    // Non-linearly concentrate vertices around the playable beach & shoreline!
    const segX = 280;
    const segZ = 280;
    const geo = new THREE.PlaneGeometry(1, 1, segX, segZ);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      // Normalized [-1, 1]
      const nx = pos.getX(i) * 2.0;
      const nz = pos.getZ(i) * 2.0;

      // Focus resolution near playable bay center (|x| < 48, z in [-36, 32])
      const x = Math.sign(nx) * (Math.abs(nx) * 62.0 + Math.pow(Math.abs(nx), 2.4) * 58.0);
      const z =
        nz < 0
          ? -((-nz) * 38.0 + Math.pow(-nz, 2.2) * 32.0)
          : nz * 48.0 + Math.pow(nz, 2.15) * 98.0;

      const y = getTerrainHeight(x, z);
      pos.setXYZ(i, x, y, z);
    }

    geo.computeVertexNormals();

    this.material = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      roughness: 0.88,
      metalness: 0.0,
      uniforms: {
        uFootprintMap: { value: footprints.texture },
        uFootBoundsMin: { value: new THREE.Vector2(FOOTPRINT_BOUNDS.minX, FOOTPRINT_BOUNDS.minZ) },
        uFootBoundsSize: { value: new THREE.Vector2(FOOTPRINT_BOUNDS.width, FOOTPRINT_BOUNDS.depth) },
        uFootTexel: { value: new THREE.Vector2(1 / FOOTPRINT_BOUNDS.resolution, 1 / FOOTPRINT_BOUNDS.resolution) },
        uTime: { value: 0 },
        uWaveIntensity: { value: 1.0 },
        uSunDirection: { value: new THREE.Vector3(0.35, 0.72, 0.58).normalize() },
        uSunColor: { value: new THREE.Color(0xfff4dd) }
      },
      vertexShader: /* glsl */ `
        uniform sampler2D uFootprintMap;
        uniform vec2 uFootBoundsMin;
        uniform vec2 uFootBoundsSize;

        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying vec2 vFootUv;
        varying float vInFootZone;

        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vec2 fUv = (wp.xz - uFootBoundsMin) / uFootBoundsSize;
          float inZone = step(0.002, fUv.x) * step(fUv.x, 0.998) *
                         step(0.002, fUv.y) * step(fUv.y, 0.998);

          vec3 displaced = position;
          if (inZone > 0.5) {
            vec4 fp = texture2D(uFootprintMap, fUv);
            // Subtle real geometric depression + pushed-up rim
            displaced.y += (-fp.r * 0.075 + fp.g * 0.024);
          }

          csm_Position = displaced;
          vec4 finalWp = modelMatrix * vec4(displaced, 1.0);
          vWorldPos = finalWp.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vFootUv = fUv;
          vInFootZone = inZone;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uFootprintMap;
        uniform vec2 uFootBoundsMin;
        uniform vec2 uFootBoundsSize;
        uniform vec2 uFootTexel;
        uniform float uTime;
        uniform float uWaveIntensity;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;

        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying vec2 vFootUv;
        varying float vInFootZone;

        ${GERSTNER_GLSL}
        ${CAUSTICS_GLSL}

        float hash21(vec2 p) {
          p = fract(p * vec2(234.34, 435.345));
          p += dot(p, p + 34.23);
          return fract(p.x * p.y);
        }

        float valueNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
          for (int i = 0; i < 4; i++) {
            v += a * valueNoise(p);
            p = m * p * 2.05;
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec3 wp = vWorldPos;
          vec3 wNorm = normalize(vWorldNormal);

          // Live wave height at this sand point for dynamic wet-to-dry swash line
          float shoal = waveShoalingFactorGLSL(wp.y);
          float waveH = evalWaveHeightApprox(wp.xz, uTime, uWaveIntensity, shoal);

          // Sample RTT footprint map + finite-difference height gradient for crisp normal deformation
          float fpDepth = 0.0;
          float fpRim = 0.0;
          float fpWetMem = 0.0;
          vec2 fpGrad = vec2(0.0);

          if (vInFootZone > 0.5) {
            vec4 fp = texture2D(uFootprintMap, vFootUv);
            fpDepth = fp.r;
            fpRim = fp.g;
            fpWetMem = fp.b;

            vec2 dx = vec2(uFootTexel.x * 1.4, 0.0);
            vec2 dy = vec2(0.0, uFootTexel.y * 1.4);
            vec4 sL = texture2D(uFootprintMap, vFootUv - dx);
            vec4 sR = texture2D(uFootprintMap, vFootUv + dx);
            vec4 sD = texture2D(uFootprintMap, vFootUv - dy);
            vec4 sU = texture2D(uFootprintMap, vFootUv + dy);

            float hL = -sL.r + sL.g * 0.35;
            float hR = -sR.r + sR.g * 0.35;
            float hD = -sD.r + sD.g * 0.35;
            float hU = -sU.r + sU.g * 0.35;
            fpGrad = vec2(hR - hL, hU - hD);
          }

          // Multi-scale organic sand variation, wind ripples (dry) & wave ripples (seabed)
          float macroNoise = fbm(wp.xz * 0.085);
          float medNoise = fbm(wp.xz * 0.65);
          float grain = valueNoise(wp.xz * 26.0) * 0.6 + valueNoise(wp.xz * 64.0) * 0.4;

          // Subtle coastal sand ripples
          float ripplePhase = wp.z * 3.8 + sin(wp.x * 0.9 + macroNoise * 3.2) * 1.4;
          float ripple = sin(ripplePhase) * 0.5 + 0.5;
          float seabedMask = smoothstep(0.15, -0.75, wp.y);
          float duneMask = smoothstep(1.3, 3.2, wp.y);

          // Dynamic wet-to-dry shoreline envelope (combines wave swash + capillary rise + RTT wet memory)
          float swashHeight = waveH + 0.34 + 0.14 * macroNoise;
          float heightWet = smoothstep(swashHeight + 0.62, swashHeight - 0.14, wp.y);
          float wetness = clamp(max(heightWet, fpWetMem * 0.92), 0.0, 1.0);
          // Smoothly cap wetness inland on high dry dunes
          wetness *= smoothstep(1.55, 0.45, wp.y);

          // Base coastal sand palette in LINEAR RGB (rich golden beach -> glossy dark wet shore -> sunlit seabed)
          vec3 drySandLight = vec3(0.56, 0.43, 0.25);
          vec3 drySandWarm  = vec3(0.45, 0.33, 0.18);
          vec3 drySand = mix(drySandWarm, drySandLight, macroNoise * 0.72 + medNoise * 0.28);
          drySand *= (0.91 + 0.16 * grain);

          vec3 wetSand = drySand * vec3(0.36, 0.32, 0.28);
          vec3 seabedSand = mix(vec3(0.42, 0.38, 0.26), vec3(0.18, 0.24, 0.22), smoothstep(-1.5, -10.0, wp.y));

          vec3 sandCol = mix(drySand, wetSand, wetness);
          sandCol = mix(sandCol, seabedSand, seabedMask * 0.78);

          // Rocky cliff / headland sandstone shading on steep flanks
          float slope = 1.0 - clamp(wNorm.y, 0.0, 1.0);
          float cliffMask = smoothstep(0.24, 0.52, slope) * smoothstep(0.8, 3.0, wp.y);
          vec3 rockCol = mix(vec3(0.22, 0.19, 0.15), vec3(0.32, 0.28, 0.22), medNoise);
          sandCol = mix(sandCol, rockCol, cliffMask);

          // Subtle dry-dune grass tinting on very top inland crests
          float duneTint = duneMask * smoothstep(0.42, 0.78, macroNoise) * (1.0 - cliffMask);
          sandCol = mix(sandCol, vec3(0.38, 0.35, 0.20), duneTint * 0.24);

          // Footprint ambient occlusion + slightly damper compacted bottom sand
          float fpAO = 1.0 - fpDepth * 0.58;
          vec3 fpShade = mix(sandCol, sandCol * vec3(0.64, 0.58, 0.50), fpDepth * (1.0 - wetness * 0.42));
          sandCol = fpShade * fpAO + vec3(0.04, 0.032, 0.018) * fpRim * (1.0 - wetness);

          // Perturb surface normal with sand micro-grain, ripples, and crisp RTT footprint gradients
          float gEps = 0.03;
          float gX = valueNoise((wp.xz + vec2(gEps, 0.0)) * 34.0) - valueNoise((wp.xz - vec2(gEps, 0.0)) * 34.0);
          float gZ = valueNoise((wp.xz + vec2(0.0, gEps)) * 34.0) - valueNoise((wp.xz - vec2(0.0, gEps)) * 34.0);
          float rGradZ = cos(ripplePhase) * (seabedMask * 0.18 + duneMask * 0.08) * (1.0 - wetness * 0.7);

          vec3 pertWorldNorm = normalize(
            wNorm +
            vec3(
              -fpGrad.x * 3.45 + gX * 0.28 * (1.0 - wetness * 0.6),
              0.0,
              -fpGrad.y * 3.45 + gZ * 0.28 * (1.0 - wetness * 0.6) + rGradZ
            )
          );

          // Feed perturbed normal into CSM lighting (csm_FragNormal is in view space!)
          csm_FragNormal = normalize((viewMatrix * vec4(pertWorldNorm, 0.0)).xyz);

          // Physically based roughness: dry matte sand (~0.90) -> wet glossy sheen (~0.10)
          float baseRough = mix(0.90, 0.10, smoothstep(0.16, 0.86, wetness));
          // Slightly wetter sheen pooled inside wet footprints
          baseRough = mix(baseRough, 0.07, fpDepth * wetness * 0.78);
          baseRough = mix(baseRough, 0.85, cliffMask);
          csm_Roughness = clamp(baseRough, 0.07, 0.96);

          // Fine crystalline quartz sand sun-sparkle / micro-glint in bright dry sunlight
          vec3 viewDir = normalize(cameraPosition - wp);
          vec3 halfVec = normalize(uSunDirection + viewDir);
          vec2 cell = floor(wp.xz * 185.0);
          vec2 cellRnd = vec2(hash21(cell), hash21(cell + 17.3));
          vec3 facetNorm = normalize(pertWorldNorm + vec3((cellRnd.x - 0.5) * 0.65, 0.0, (cellRnd.y - 0.5) * 0.65));
          float glintSpec = pow(max(dot(facetNorm, halfVec), 0.0), 280.0);
          float glintMask = (1.0 - wetness) * (1.0 - cliffMask) * (1.0 - seabedMask) * smoothstep(20.0, 1.5, length(cameraPosition - wp));
          vec3 sparkle = uSunColor * glintSpec * glintMask * 0.95;

          // Subtle wet-sand Fresnel sky sheen boost right at the shoreline
          float ndv = max(dot(pertWorldNorm, viewDir), 0.0);
          float wetSheen = pow(1.0 - ndv, 4.0) * wetness * 0.18 * smoothstep(-0.05, 0.25, wp.y);

          // Dual-layer animated underwater caustics on submerged seabed
          vec3 caustics = computeUnderwaterCaustics(wp, pertWorldNorm, uSunDirection, waveH, uTime);
          vec3 causticLight = caustics * uSunColor * 1.15;

          csm_DiffuseColor = vec4(sandCol + vec3(wetSheen), 1.0);
          csm_Emissive = sparkle + causticLight;
        }
      `
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'CoastalTerrain';
  }

  public update(
    footprintTexture: THREE.Texture,
    elapsedTime: number,
    waveIntensity: number,
    sunDirection: THREE.Vector3,
    sunColor: THREE.Color
  ): void {
    const u = this.material.uniforms;
    u.uFootprintMap.value = footprintTexture;
    u.uTime.value = elapsedTime;
    u.uWaveIntensity.value = waveIntensity;
    u.uSunDirection.value.copy(sunDirection);
    u.uSunColor.value.copy(sunColor);
  }
}
