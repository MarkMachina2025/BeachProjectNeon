import * as THREE from 'three';
import { getTerrainHeight } from './terrainMath';
import { FOOTPRINT_BOUNDS, FootprintSystem } from './FootprintSystem';
import { GERSTNER_GLSL } from '../ocean/wavePhysics';
import { CAUSTICS_GLSL } from '../shaders/causticsChunk';
import { makeGrainTexture, makeNoiseTexture } from '../utils/proceduralNoise';
import { loadTiledTex } from '../utils/pbrMaterials';

/**
 * Photorealistic Coastal Silica Sand, Grassy Dunes & Seabed Terrain:
 *  - Dual-frequency procedural FBM noise + normal-mapped fine sand grain (zero photo tiling!)
 *  - Sunlit warm pale silica beach palette with shell flecks, wind ripples & seabed tide ridges
 *  - Dual-tier shoreline wetness + glassy specular swash sheen as waves recede
 *  - Shadow-masked two-scale quartz micro-glints that glitter in direct sun & vanish cleanly in shade
 *  - 2048x2048 RTT human footprint vertex displacement, compacted darkening & steep rim normals
 *  - Direct optical wave-interference caustics & aquatic light absorption on submerged seabed
 */
export class CoastalTerrain {
  public readonly mesh: THREE.Mesh;
  public readonly material: THREE.MeshStandardMaterial;
  public readonly noiseTexture: THREE.DataTexture;
  public readonly grainTexture: THREE.DataTexture;

  private readonly uniforms: {
    uNoise: { value: THREE.DataTexture };
    uGrain: { value: THREE.DataTexture };
    uGrassDiff: { value: THREE.Texture };
    uGrassNor: { value: THREE.Texture };
    uRockDiff: { value: THREE.Texture };
    uFootprintMap: { value: THREE.Texture };
    uFootBoundsMin: { value: THREE.Vector2 };
    uFootBoundsSize: { value: THREE.Vector2 };
    uFootTexel: { value: THREE.Vector2 };
    uTime: { value: number };
    uWaveIntensity: { value: number };
    uSunDirection: { value: THREE.Vector3 };
    uSunColor: { value: THREE.Color };
    uSunPower: { value: number };
  };

  constructor(footprints: FootprintSystem) {
    // 80x80 vertex grid paired with fine normal grain & shadow-masked micro-glints
    const segX = 80;
    const segZ = 80;
    const geo = new THREE.PlaneGeometry(1, 1, segX, segZ);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const nx = pos.getX(i) * 2.0;
      const nz = pos.getZ(i) * 2.0;

      // Covers X: [-210, +210], Z: [-115, +225]
      const x = Math.sign(nx) * (Math.abs(nx) * 116.0 + Math.pow(Math.abs(nx), 2.35) * 94.0);
      const z =
        nz < 0
          ? -((-nz) * 68.0 + Math.pow(-nz, 2.1) * 48.0)
          : nz * 78.0 + Math.pow(nz, 2.1) * 148.0;

      const y = getTerrainHeight(x, z);
      pos.setXYZ(i, x, y, z);
    }
    geo.computeVertexNormals();

    this.noiseTexture = makeNoiseTexture(256);
    this.grainTexture = makeGrainTexture(256);
    const grassDiff = loadTiledTex('./textures/pbr/sparse_grass_diff.jpg', true, 1, 1);
    const grassNor = loadTiledTex('./textures/pbr/sparse_grass_nor.jpg', false, 1, 1);
    const rockDiff = loadTiledTex('./textures/pbr/coral_stone_wall_diff.jpg', true, 1, 1);

    this.uniforms = {
      uNoise: { value: this.noiseTexture },
      uGrain: { value: this.grainTexture },
      uGrassDiff: { value: grassDiff },
      uGrassNor: { value: grassNor },
      uRockDiff: { value: rockDiff },
      uFootprintMap: { value: footprints.texture },
      uFootBoundsMin: { value: new THREE.Vector2(FOOTPRINT_BOUNDS.minX, FOOTPRINT_BOUNDS.minZ) },
      uFootBoundsSize: { value: new THREE.Vector2(FOOTPRINT_BOUNDS.width, FOOTPRINT_BOUNDS.depth) },
      uFootTexel: { value: new THREE.Vector2(1 / FOOTPRINT_BOUNDS.resolution, 1 / FOOTPRINT_BOUNDS.resolution) },
      uTime: { value: 0 },
      uWaveIntensity: { value: 1.0 },
      uSunDirection: { value: new THREE.Vector3(0.35, 0.72, 0.58).normalize() },
      uSunColor: { value: new THREE.Color(0xfff4dd) },
      uSunPower: { value: 2.45 }
    };

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0.0,
      envMapIntensity: 0.85
    });

    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          uniform sampler2D uFootprintMap;
          uniform vec2 uFootBoundsMin;
          uniform vec2 uFootBoundsSize;
          varying vec3 vWPos;
          varying vec3 vWNorm;
          varying vec2 vFootUv;
          varying float vInFootZone;
          `
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          #include <begin_vertex>
          {
            vec4 wpInit = modelMatrix * vec4(transformed, 1.0);
            vec2 fUv = (wpInit.xz - uFootBoundsMin) / uFootBoundsSize;
            float inZone = step(0.002, fUv.x) * step(fUv.x, 0.998) *
                           step(0.002, fUv.y) * step(fUv.y, 0.998);
            if (inZone > 0.5) {
              vec4 fp = texture2D(uFootprintMap, fUv);
              transformed.y += (-fp.r * 0.048 + fp.g * 0.015);
            }
            vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
            vWNorm = normalize(mat3(modelMatrix) * objectNormal);
            vFootUv = fUv;
            vInFootZone = inZone;
          }
          `
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          uniform sampler2D uNoise;
          uniform sampler2D uGrain;
          uniform sampler2D uGrassDiff;
          uniform sampler2D uGrassNor;
          uniform sampler2D uRockDiff;
          uniform sampler2D uFootprintMap;
          uniform vec2 uFootTexel;
          uniform float uTime;
          uniform float uWaveIntensity;
          uniform vec3 uSunDirection;
          uniform vec3 uSunColor;
          uniform float uSunPower;

          varying vec3 vWPos;
          varying vec3 vWNorm;
          varying vec2 vFootUv;
          varying float vInFootZone;

          ${GERSTNER_GLSL}
          ${CAUSTICS_GLSL}

          vec3 gNw;
          float gWet;
          float gSheen;
          float gSandMask;
          float gGrassMask;
          float gCamD;
          float gWaveH;
          float gFpDepth;
          vec2 gFpGrad;
          vec4 gGr;
          vec4 gGr2;
          vec4 gNz;
          `
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
          #include <map_fragment>
          {
            vec3 wp = vWPos;
            vec3 wNorm = normalize(vWNorm);
            gCamD = length(cameraPosition - wp);

            vec4 nz = texture2D(uNoise, wp.xz * 0.021);
            vec4 nz2 = texture2D(uNoise, wp.xz * 0.17);
            gGr = texture2D(uGrain, wp.xz * 2.3);
            gGr2 = texture2D(uGrain, wp.xz * 0.37);
            gNz = nz;

            // Sunlit pale silica sand with grain relief & tiny shell/mineral flecks
            vec3 sand = mix(vec3(0.60, 0.48, 0.31), vec3(0.81, 0.69, 0.49), nz.r * 0.55 + nz2.g * 0.45);
            sand *= 0.88 + 0.24 * gGr.b;
            sand *= 1.0 - 0.20 * smoothstep(0.82, 0.96, gGr.a) * smoothstep(34.0, 4.0, gCamD);

            // Live + receding swash water film for damp shoreline band & glassy mirror sheen
            float shoal = waveShoalingFactorGLSL(wp.y);
            float w0 = evalWaveHeightApprox(wp.xz, uTime, uWaveIntensity, shoal);
            float w1 = evalWaveHeightApprox(wp.xz, uTime - 0.75, uWaveIntensity, shoal);
            float w2 = evalWaveHeightApprox(wp.xz, uTime - 1.55, uWaveIntensity, shoal);
            gWaveH = w0;
            float waterRecent = max(w0, max(w1, w2));

            float highWater = (0.04 + 0.055 * uWaveIntensity) * 0.85;
            float edgeN = (nz2.r - 0.5) * 0.08;
            gWet = 1.0 - smoothstep(highWater + 0.12, highWater + 0.62, wp.y + edgeN);
            gSheen = 1.0 - smoothstep(0.0, 0.10, wp.y - waterRecent + edgeN * 0.35);
            gSheen = max(gSheen, 0.28 * gWet) * smoothstep(-0.18, 0.02, wp.y);

            // RTT 2048x2048 footprints + gradient
            gFpDepth = 0.0;
            float fpRim = 0.0;
            float fpWetMem = 0.0;
            gFpGrad = vec2(0.0);
            if (vInFootZone > 0.5 && gCamD < 80.0) {
              vec4 fp = texture2D(uFootprintMap, vFootUv);
              gFpDepth = fp.r;
              fpRim = fp.g;
              fpWetMem = fp.b;

              vec2 dx = vec2(uFootTexel.x * 1.5, 0.0);
              vec2 dy = vec2(0.0, uFootTexel.y * 1.5);
              vec4 sL = texture2D(uFootprintMap, vFootUv - dx);
              vec4 sR = texture2D(uFootprintMap, vFootUv + dx);
              vec4 sD = texture2D(uFootprintMap, vFootUv - dy);
              vec4 sU = texture2D(uFootprintMap, vFootUv + dy);
              float hL = -sL.r + sL.g * 0.35;
              float hR = -sR.r + sR.g * 0.35;
              float hD = -sD.r + sD.g * 0.35;
              float hU = -sU.r + sU.g * 0.35;
              gFpGrad = vec2(hR - hL, hU - hD);
            }
            float combWet = clamp(max(gWet, fpWetMem * 0.90) * smoothstep(1.55, 0.35, wp.y), 0.0, 1.0);
            gWet = combWet;

            sand = mix(sand, sand * vec3(0.50, 0.47, 0.44), combWet);
            sand *= 1.0 - 0.42 * clamp(gFpDepth, 0.0, 1.0);
            sand *= 1.0 + 0.10 * clamp(fpRim, 0.0, 1.0);
            // Deeper seabed seagrass/algae mottling
            sand = mix(sand, sand * vec3(0.52, 0.70, 0.48), smoothstep(0.48, 0.74, nz.a) * smoothstep(-1.4, -5.0, wp.y) * 0.82);

            // Lush photorealistic Poly Haven coastal dune grass (dual-scale anti-tiling world UVs!)
            vec2 gUv1 = wp.xz * 0.22;
            vec2 gUv2 = vec2(wp.x * 0.068 - wp.z * 0.048, wp.x * 0.048 + wp.z * 0.068);
            vec3 grassTex = mix(texture2D(uGrassDiff, gUv1).rgb, texture2D(uGrassDiff, gUv2).rgb, 0.45);
            vec3 grassTint = mix(vec3(0.56, 1.18, 0.44), vec3(0.92, 1.32, 0.58), nz.g * 0.55 + nz2.r * 0.45);
            vec3 grassCol = grassTex * grassTint * (0.90 + 0.22 * gGr2.b);
            float hillLush = smoothstep(-34.0, -54.0, wp.z) * 0.26;
            float headTopGreen = smoothstep(46.0, 66.0, abs(wp.x)) * smoothstep(2.4, 5.2, wp.y) * 0.65;
            float gm = max(
              smoothstep(-26.5, -34.0, wp.z) * smoothstep(1.65, 3.8, wp.y) * smoothstep(0.16, 0.46, nz2.g + 0.28 * nz.r + hillLush),
              headTopGreen * smoothstep(0.22, 0.54, nz2.g + 0.22 * nz.r)
            );
            gGrassMask = gm;

            // Stratified weathered coastal limestone & headland bedrock with real stone detail
            float strata = sin(wp.y * 2.4 + nz.r * 4.5) * 0.5 + 0.5;
            vec3 rockTex = texture2D(uRockDiff, wp.xz * 0.16 + vec2(0.0, wp.y * 0.24)).rgb;
            vec3 rockCol = rockTex * mix(vec3(0.58, 0.55, 0.48), vec3(0.95, 0.88, 0.76), nz2.r * 0.50 + strata * 0.30 + nz.g * 0.20);
            rockCol = mix(rockCol, rockCol * 0.50, 1.0 - smoothstep(0.1, 0.9, wp.y));
            float slope = 1.0 - clamp(wNorm.y, 0.0, 1.0);
            float cliffMask = max(smoothstep(48.0, 66.0, abs(wp.x)) * smoothstep(0.3, 2.2, wp.y), smoothstep(0.20, 0.44, slope) * smoothstep(1.0, 3.0, wp.y));
            float rm = cliffMask * smoothstep(0.20, 0.50, 0.48 + (nz2.r - 0.5) * 0.32) * (1.0 - gm * 0.55);

            gSandMask = (1.0 - gm) * (1.0 - rm);
            vec3 col = mix(sand, grassCol, gm);
            col = mix(col, rockCol, rm);
            diffuseColor.rgb = col;
          }
          `
        )
        .replace(
          '#include <roughnessmap_fragment>',
          /* glsl */ `
          #include <roughnessmap_fragment>
          {
            float r = mix(0.95, 0.42, gWet);
            r = mix(r, 0.08, gSheen * gSandMask);
            r = mix(r, 0.94, smoothstep(-0.02, -0.22, vWPos.y));
            r = mix(r, 0.88, clamp(gFpDepth * 1.5, 0.0, 1.0));
            roughnessFactor = mix(0.90, r, gSandMask);
          }
          `
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `
          #include <normal_fragment_maps>
          {
            vec3 nW = inverseTransformDirection(normal, viewMatrix);
            float nearF = smoothstep(45.0, 3.0, gCamD);
            vec2 gn = (gGr.xy - 0.5) * 1.05 * nearF + (gGr2.xy - 0.5) * 0.48;
            float dry = (1.0 - gWet) * gSandMask * smoothstep(0.0, 0.25, vWPos.y);

            // Wind ripples on dry dunes & tide ripples on sandy seabed
            float rp = vWPos.x * 0.5 + vWPos.z * 9.0 + gNz.r * 16.0;
            float ripple = cos(rp) * 0.082 * dry * smoothstep(60.0, 10.0, gCamD) * smoothstep(0.35, 0.60, gNz.g + 0.1);
            float rs = vWPos.z * 15.0 + vWPos.x * 1.3 + gNz.g * 22.0;
            ripple += cos(rs) * 0.22 * smoothstep(-0.22, -1.10, vWPos.y) * gSandMask * smoothstep(55.0, 8.0, gCamD);

            nW.xz += gn * (1.0 - 0.75 * gSheen) * mix(1.4, 1.0, gSandMask);
            if (gGrassMask > 0.02) {
              vec3 grassN = texture2D(uGrassNor, vWPos.xz * 0.22).xyz * 2.0 - 1.0;
              nW.xz += grassN.xy * 0.55 * gGrassMask * smoothstep(95.0, 14.0, gCamD);
            }
            nW.z += ripple;
            nW.xz -= gFpGrad * 1.85;
            nW = normalize(nW);
            gNw = nW;
            normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
          }
          `
        )
        .replace(
          '#include <lights_fragment_end>',
          /* glsl */ `
          #include <lights_fragment_end>
          {
            // Shadow-masked dual-scale quartz micro-glints on dry/damp sunlit silica grains
            vec3 Vw = normalize(cameraPosition - vWPos);
            vec3 Hw = normalize(normalize(uSunDirection) + Vw);
            float sp = 0.0;
            for (int i = 0; i < 2; i++) {
              float S = i == 0 ? 260.0 : 95.0;
              vec2 cell = floor(vWPos.xz * S);
              vec4 r = texture2D(uGrain, (cell + 0.5) / 256.0);
              vec4 r2 = texture2D(uGrain, (cell.yx + 37.5) / 256.0);
              vec3 fn = normalize(gNw + vec3(r.a - 0.5, 0.0, r2.a - 0.5) * 1.45);
              sp += pow(max(dot(fn, Hw), 0.0), 700.0) * step(0.78, r2.b + r.a * 0.3);
            }
            float expect = dot(diffuseColor.rgb * uSunColor, vec3(0.333)) * uSunPower * 0.318 * max(dot(gNw, normalize(uSunDirection)), 0.08);
            float lit = clamp(dot(reflectedLight.directDiffuse, vec3(0.333)) / max(expect, 1e-3), 0.0, 1.0);
            float above = smoothstep(-0.05, 0.03, vWPos.y);
            reflectedLight.directSpecular += uSunColor * uSunPower * sp * 3.4 * lit * gSandMask * above * (1.0 - 0.55 * gWet) * exp(-gCamD / 22.0);

            // Optical wave-interference seabed caustics
            if (vWPos.y < gWaveH) {
              vec3 caustics = computeUnderwaterCaustics(vWPos, gNw, uSunDirection, gWaveH, uTime);
              reflectedLight.directDiffuse += diffuseColor.rgb * 0.318 * caustics * uSunColor * max(uSunPower, 0.8) * 1.45;
            }
          }
          `
        );
    };
    mat.customProgramCacheKey = () => 'neon-cove-silica-sand-v2';
    this.material = mat;

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
    sunColor: THREE.Color,
    sunPower = 2.45
  ): void {
    this.uniforms.uFootprintMap.value = footprintTexture;
    this.uniforms.uTime.value = elapsedTime;
    this.uniforms.uWaveIntensity.value = waveIntensity;
    this.uniforms.uSunDirection.value.copy(sunDirection);
    this.uniforms.uSunColor.value.copy(sunColor);
    this.uniforms.uSunPower.value = sunPower;
  }
}
