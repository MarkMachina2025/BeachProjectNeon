import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { getTerrainHeight } from './terrainMath';
import { FOOTPRINT_BOUNDS, FootprintSystem } from './FootprintSystem';
import { GERSTNER_GLSL } from '../ocean/wavePhysics';
import { CAUSTICS_GLSL } from '../shaders/causticsChunk';

function loadTiledTexture(path: string, isSRGB: boolean): THREE.Texture {
  const loader = new THREE.TextureLoader();
  const tex = loader.load(path);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = isSRGB ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return tex;
}

/**
 * Expanded (+50% larger) high-resolution coastal bay & seabed terrain powered by
 * real Poly Haven CC0 photorealistic sand PBR textures (coast_sand_01 Diffuse, Normal, Roughness)
 * with dual-scale anti-tiling sampling, quartz micro-sparkle glints, dynamic wet-to-dry
 * shoreline sheen, real-time 2048x2048 RTT human footprints, and animated seabed caustics.
 */
export class CoastalTerrain {
  public readonly mesh: THREE.Mesh;
  public readonly material: CustomShaderMaterial;

  constructor(footprints: FootprintSystem) {
    const segX = 320;
    const segZ = 320;
    const geo = new THREE.PlaneGeometry(1, 1, segX, segZ);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const nx = pos.getX(i) * 2.0; // -1..1
      const nz = pos.getZ(i) * 2.0; // -1..1

      // Expanded +50% coverage: X in [-165, +165], Z in [-102, +205]
      const x = Math.sign(nx) * (Math.abs(nx) * 92.0 + Math.pow(Math.abs(nx), 2.35) * 76.0);
      const z =
        nz < 0
          ? -((-nz) * 58.0 + Math.pow(-nz, 2.15) * 44.0)
          : nz * 68.0 + Math.pow(nz, 2.1) * 138.0;

      const y = getTerrainHeight(x, z);
      pos.setXYZ(i, x, y, z);
    }

    geo.computeVertexNormals();

    const sandDiffuse = loadTiledTexture('./textures/sand_Diffuse.jpg', true);
    const sandNormal = loadTiledTexture('./textures/sand_nor_gl.jpg', false);
    const sandRough = loadTiledTexture('./textures/sand_Rough.jpg', false);

    this.material = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      roughness: 0.88,
      metalness: 0.0,
      uniforms: {
        uSandDiffuse: { value: sandDiffuse },
        uSandNormal: { value: sandNormal },
        uSandRough: { value: sandRough },
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
            displaced.y += (-fp.r * 0.055 + fp.g * 0.018);
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
        uniform sampler2D uSandDiffuse;
        uniform sampler2D uSandNormal;
        uniform sampler2D uSandRough;
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

          float shoal = waveShoalingFactorGLSL(wp.y);
          float waveH = evalWaveHeightApprox(wp.xz, uTime, uWaveIntensity, shoal);

          // Sample 2048x2048 RTT footprint height + sharp gradient normals
          float fpDepth = 0.0;
          float fpRim = 0.0;
          float fpWetMem = 0.0;
          vec2 fpGrad = vec2(0.0);

          if (vInFootZone > 0.5) {
            vec4 fp = texture2D(uFootprintMap, vFootUv);
            fpDepth = fp.r;
            fpRim = fp.g;
            fpWetMem = fp.b;

            vec2 dx = vec2(uFootTexel.x * 1.5, 0.0);
            vec2 dy = vec2(0.0, uFootTexel.y * 1.5);
            vec4 sL = texture2D(uFootprintMap, vFootUv - dx);
            vec4 sR = texture2D(uFootprintMap, vFootUv + dx);
            vec4 sD = texture2D(uFootprintMap, vFootUv - dy);
            vec4 sU = texture2D(uFootprintMap, vFootUv + dy);

            float hL = -sL.r + sL.g * 0.38;
            float hR = -sR.r + sR.g * 0.38;
            float hD = -sD.r + sD.g * 0.38;
            float hU = -sU.r + sU.g * 0.38;
            fpGrad = vec2(hR - hL, hU - hD);
          }

          // Dual-scale rotated Poly Haven CC0 sand PBR sampling (zero visible repetition!)
          float macroNoise = fbm(wp.xz * 0.065);
          vec2 uvA = wp.xz * 0.32;
          mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
          vec2 uvB = (rot * wp.xz) * 0.13 + vec2(3.7, 1.9);

          vec3 texColA = texture2D(uSandDiffuse, uvA).rgb;
          vec3 texColB = texture2D(uSandDiffuse, uvB).rgb;
          vec3 photoSand = mix(texColA, texColB, 0.44 + 0.18 * macroNoise);

          vec3 nMapA = texture2D(uSandNormal, uvA).xyz * 2.0 - 1.0;
          vec3 nMapB = texture2D(uSandNormal, uvB).xyz * 2.0 - 1.0;
          vec2 sandDetailN = mix(nMapA.xy, nMapB.xy, 0.42);

          float photoRough = mix(texture2D(uSandRough, uvA).r, texture2D(uSandRough, uvB).r, 0.45);

          // Warm golden-ivory coastal sand grading with real photo grain
          vec3 warmGolden = vec3(0.76, 0.61, 0.39);
          vec3 drySand = mix(photoSand, photoSand * warmGolden * 1.45, 0.52);
          drySand *= (0.88 + 0.22 * macroNoise);

          float seabedMask = smoothstep(0.15, -0.75, wp.y);
          float duneMask = smoothstep(1.6, 4.2, wp.y);

          // Dynamic wet-to-dry shoreline swash transition
          float swashHeight = waveH + 0.36 + 0.16 * macroNoise;
          float heightWet = smoothstep(swashHeight + 0.68, swashHeight - 0.14, wp.y);
          float wetness = clamp(max(heightWet, fpWetMem * 0.92), 0.0, 1.0);
          wetness *= smoothstep(1.65, 0.45, wp.y);

          vec3 wetSand = drySand * vec3(0.42, 0.38, 0.33);
          vec3 seabedSand = mix(drySand * vec3(0.82, 0.84, 0.72), vec3(0.18, 0.27, 0.24), smoothstep(-1.5, -11.0, wp.y));

          vec3 sandCol = mix(drySand, wetSand, wetness);
          sandCol = mix(sandCol, seabedSand, seabedMask * 0.72);

          // Coastal headland sandstone on steep flanks
          float slope = 1.0 - clamp(wNorm.y, 0.0, 1.0);
          float cliffMask = smoothstep(0.24, 0.52, slope) * smoothstep(0.9, 3.4, wp.y);
          vec3 rockCol = mix(vec3(0.22, 0.19, 0.15), vec3(0.34, 0.30, 0.24), macroNoise);
          sandCol = mix(sandCol, rockCol, cliffMask);

          // Footprint ambient occlusion & compacted damp sole shading
          float fpAO = 1.0 - fpDepth * 0.58;
          vec3 fpShade = mix(sandCol, sandCol * vec3(0.62, 0.56, 0.48), fpDepth * (1.0 - wetness * 0.4));
          sandCol = fpShade * fpAO + vec3(0.035, 0.028, 0.016) * fpRim * (1.0 - wetness);

          // Combine terrain normal + real Poly Haven sand normal map + seabed ripples + crisp RTT footprint gradients
          float ripplePhase = wp.z * 3.4 + sin(wp.x * 0.75 + macroNoise * 3.0) * 1.3;
          float rGradZ = cos(ripplePhase) * (seabedMask * 0.20 + duneMask * 0.08) * (1.0 - wetness * 0.7);
          float detailAmt = mix(0.34, 0.14, wetness);

          vec3 pertWorldNorm = normalize(
            wNorm +
            vec3(
              -fpGrad.x * 3.6 + sandDetailN.x * detailAmt,
              0.0,
              -fpGrad.y * 3.6 + sandDetailN.y * detailAmt + rGradZ
            )
          );

          csm_FragNormal = normalize((viewMatrix * vec4(pertWorldNorm, 0.0)).xyz);

          // Physically based roughness from real photo map transitioning smoothly to glossy wet shore
          float dryRough = clamp(0.76 + photoRough * 0.20, 0.74, 0.96);
          float baseRough = mix(dryRough, 0.095, smoothstep(0.16, 0.85, wetness));
          baseRough = mix(baseRough, 0.065, fpDepth * wetness * 0.8);
          baseRough = mix(baseRough, 0.86, cliffMask);
          csm_Roughness = clamp(baseRough, 0.06, 0.96);

          // Fine crystalline quartz sand sun-sparkle micro-glints
          vec3 viewDir = normalize(cameraPosition - wp);
          vec3 halfVec = normalize(uSunDirection + viewDir);
          vec2 cell = floor(wp.xz * 210.0);
          vec2 cellRnd = vec2(hash21(cell), hash21(cell + 17.3));
          vec3 facetNorm = normalize(pertWorldNorm + vec3((cellRnd.x - 0.5) * 0.65, 0.0, (cellRnd.y - 0.5) * 0.65));
          float glintSpec = pow(max(dot(facetNorm, halfVec), 0.0), 310.0);
          float glintMask = (1.0 - wetness) * (1.0 - cliffMask) * (1.0 - seabedMask) * smoothstep(18.0, 1.5, length(cameraPosition - wp));
          vec3 sparkle = uSunColor * glintSpec * glintMask * 0.90;

          // Subtle wet-sand Fresnel sky sheen
          float ndv = max(dot(pertWorldNorm, viewDir), 0.0);
          float wetSheen = pow(1.0 - ndv, 4.0) * wetness * 0.16 * smoothstep(-0.05, 0.25, wp.y);

          // Dual-layer animated underwater caustics on submerged seabed
          vec3 caustics = computeUnderwaterCaustics(wp, pertWorldNorm, uSunDirection, waveH, uTime);
          vec3 causticLight = caustics * uSunColor * 1.18;

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
