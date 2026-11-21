import * as THREE from 'three';
import { GERSTNER_GLSL } from './wavePhysics';
import { TERRAIN_HEIGHT_GLSL } from '../terrain/terrainMath';

function loadWaterNormal(path: string): THREE.Texture {
  const tex = new THREE.TextureLoader().load(path);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/**
 * Next-Gen Photorealistic Coastal Ocean Surface:
 *  - Official Three.js seamless photographic ocean normal maps (4 counter-scrolling multi-scale octaves)
 *    blended on top of analytical 6-wave Gerstner displacement
 *  - TRUE Screen-Space Refraction (samples pre-rendered opaque seabed, boulders, coral & wading legs
 *    with wave-normal distortion + chromatic dispersion + Beer-Lambert optical absorption!)
 *  - High-frequency lacy cellular shorebreak & whitecap seafoam
 *  - Physically based Schlick Fresnel sky reflections, GGX sun sparkle glitter path, SSS crest glow
 *  - Authentic Underwater Snell's Window looking up through the waves
 */
export class OceanSystem {
  public readonly mesh: THREE.Mesh;
  public readonly material: THREE.ShaderMaterial;

  constructor() {
    // High-density mesh covering the +50% larger bay & extending cleanly to the horizon
    const segX = 280;
    const segZ = 280;
    const geo = new THREE.PlaneGeometry(1, 1, segX, segZ);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const nx = pos.getX(i) * 2.0; // -1..1
      const nz = pos.getZ(i) * 2.0; // -1..1

      const x = Math.sign(nx) * (Math.abs(nx) * 95.0 + Math.pow(Math.abs(nx), 2.4) * 380.0);
      const z =
        nz < -0.5
          ? -24.0 + (nz + 1.0) * 48.0
          : (nz + 0.5) * 76.0 + Math.pow(Math.max(0, nz + 0.5), 2.35) * 260.0;

      pos.setXYZ(i, x, 0, z);
    }

    const normalMapA = loadWaterNormal('./textures/waternormals.jpg');
    const normalMapB = loadWaterNormal('./textures/water_normal_1.jpg');
    const normalMapC = loadWaterNormal('./textures/water_normal_2.jpg');

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      uniforms: {
        uNormalMapA: { value: normalMapA },
        uNormalMapB: { value: normalMapB },
        uNormalMapC: { value: normalMapC },
        tRefractColor: { value: null },
        tRefractDepth: { value: null },
        uHasRefraction: { value: 0.0 },
        uResolution: { value: new THREE.Vector2(1280, 800) },
        uNear: { value: 0.12 },
        uFar: { value: 650.0 },
        uTime: { value: 0 },
        uWaveIntensity: { value: 1.0 },
        uSunDirection: { value: new THREE.Vector3(0.35, 0.72, 0.58).normalize() },
        uSunColor: { value: new THREE.Color(0xfff4dd) },
        uSkyZenith: { value: new THREE.Color(0x0b4b9e) },
        uSkyHorizon: { value: new THREE.Color(0x6bbbe8) },
        uFogColor: { value: new THREE.Color(0x8bcbe8) },
        uFogDensity: { value: 0.0016 }
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uWaveIntensity;

        varying vec3 vWorldPos;
        varying vec3 vWaveNormal;
        varying float vCrest;
        varying float vTerrainH;
        varying float vViewDepth;

        ${TERRAIN_HEIGHT_GLSL}
        ${GERSTNER_GLSL}

        void main() {
          vec4 baseWorld = modelMatrix * vec4(position, 1.0);
          float terrainH = getTerrainHeightGLSL(baseWorld.xz);
          float shoal = waveShoalingFactorGLSL(terrainH);

          vec3 wNorm;
          float crest;
          vec3 disp = evalGerstnerDisplacement(baseWorld.xz, uTime, uWaveIntensity, shoal, wNorm, crest);

          vec3 displaced = position + disp;
          vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
          vec4 viewPos = viewMatrix * worldPos;

          vWorldPos = worldPos.xyz;
          vWaveNormal = wNorm;
          vCrest = crest;
          vTerrainH = getTerrainHeightGLSL(worldPos.xz);
          vViewDepth = -viewPos.z;

          gl_Position = projectionMatrix * viewPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uNormalMapA;
        uniform sampler2D uNormalMapB;
        uniform sampler2D uNormalMapC;
        uniform sampler2D tRefractColor;
        uniform sampler2D tRefractDepth;
        uniform float uHasRefraction;
        uniform vec2 uResolution;
        uniform float uNear;
        uniform float uFar;
        uniform float uTime;
        uniform float uWaveIntensity;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        uniform vec3 uSkyZenith;
        uniform vec3 uSkyHorizon;
        uniform vec3 uFogColor;
        uniform float uFogDensity;

        varying vec3 vWorldPos;
        varying vec3 vWaveNormal;
        varying float vCrest;
        varying float vTerrainH;
        varying float vViewDepth;

        float linearizeDepth(float d) {
          float z = d * 2.0 - 1.0;
          return (2.0 * uNear * uFar) / max(uFar + uNear - z * (uFar - uNear), 0.0001);
        }

        float hash21(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.5);
          return fract(p.x * p.y);
        }

        // Crisp cellular/lacy seafoam pattern (avoids blurry low-res blobs)
        float voronoiFoam(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float d1 = 8.0;
          float d2 = 8.0;
          for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
              vec2 g = vec2(float(x), float(y));
              vec2 o = vec2(hash21(i + g), hash21(i + g + vec2(19.7, 41.3)));
              vec2 r = g + (0.2 + 0.6 * o) - f;
              float d = dot(r, r);
              if (d < d1) { d2 = d1; d1 = d; }
              else if (d < d2) { d2 = d; }
            }
          }
          return smoothstep(0.02, 0.24, sqrt(d2) - sqrt(d1));
        }

        // 4-octave real photographic normal-map perturbation (broad swells -> fine glittering capillary ripples)
        vec3 sampleOceanNormal(vec3 baseN, vec2 xz, float time, float camDist) {
          float nearFade = smoothstep(260.0, 18.0, camDist);
          float microFade = smoothstep(85.0, 4.0, camDist);

          vec2 uv0 = xz * 0.028 + vec2(time * 0.018, -time * 0.032);
          vec2 uv1 = xz * 0.075 + vec2(-time * 0.026, -time * 0.044);
          vec2 uv2 = xz * 0.195 + vec2(time * 0.042, -time * 0.058);
          vec2 uv3 = xz * 0.480 + vec2(-time * 0.055, -time * 0.038);

          vec3 n0 = texture2D(uNormalMapA, uv0).xyz * 2.0 - 1.0;
          vec3 n1 = texture2D(uNormalMapB, uv1).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(uNormalMapC, uv2).xyz * 2.0 - 1.0;
          vec3 n3 = texture2D(uNormalMapA, uv3).xyz * 2.0 - 1.0;

          // Tangent-space XY mapped onto world XZ
          vec2 combined =
            n0.xy * 0.24 * nearFade +
            n1.xy * 0.20 * nearFade +
            n2.xy * 0.16 * microFade +
            n3.xy * 0.09 * microFade;

          combined *= (0.72 + 0.35 * clamp(uWaveIntensity, 0.25, 2.0));
          return normalize(baseN + vec3(combined.x, 0.0, combined.y));
        }

        vec3 sampleSkyReflection(vec3 dir, vec3 sunDir) {
          float up = clamp(dir.y, 0.0, 1.0);
          vec3 sky = mix(uSkyHorizon, uSkyZenith, pow(up, 0.52));
          float sunDot = max(dot(dir, sunDir), 0.0);
          sky += uSunColor * (pow(sunDot, 10.0) * 0.28 + pow(sunDot, 260.0) * 2.6);
          return sky;
        }

        void main() {
          float waterDepth = vWorldPos.y - vTerrainH;
          if (waterDepth < -0.025) discard;

          vec3 toCam = cameraPosition - vWorldPos;
          float camDist = length(toCam);
          vec3 V = toCam / max(camDist, 0.0001);
          vec3 N = sampleOceanNormal(normalize(vWaveNormal), vWorldPos.xz, uTime, camDist);

          // ==================== UNDERWATER UNDERSIDE (SNELL'S WINDOW) ====================
          if (!gl_FrontFacing) {
            vec3 Nu = -N;
            vec3 refr = refract(-V, Nu, 1.333);
            bool totalInternalRefl = (length(refr) < 0.001);

            vec3 deepReflect = mix(vec3(0.012, 0.13, 0.21), vec3(0.04, 0.28, 0.36), clamp(dot(Nu, V), 0.0, 1.0));
            vec3 col = deepReflect;

            if (!totalInternalRefl) {
              vec3 skyThrough = sampleSkyReflection(normalize(refr), uSunDirection);
              float cosTheta = clamp(dot(Nu, V), 0.0, 1.0);
              float snellWindow = smoothstep(0.64, 0.80, cosTheta);
              float rimGlow = exp(-pow((cosTheta - 0.72) / 0.075, 2.0)) * 0.48;
              col = mix(deepReflect, skyThrough * vec3(0.88, 0.98, 1.02), snellWindow);
              col += vec3(0.20, 0.76, 0.82) * rimGlow;
            }

            float fogAmt = 1.0 - exp(-camDist * 0.036);
            col = mix(col, vec3(0.018, 0.21, 0.31), fogAmt);
            gl_FragColor = vec4(col, 0.95);
            return;
          }

          // ==================== ABOVE-WATER PHOTOREALISTIC SURFACE ====================
          vec3 L = normalize(uSunDirection);
          vec3 H = normalize(L + V);
          vec3 R = reflect(-V, N);
          R.y = max(R.y, 0.015);

          // Schlick Fresnel (IOR 1.333 -> F0 = 0.02)
          float ndv = max(dot(N, V), 0.0);
          float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

          // Screen-space UV for true optical refraction of seabed, rocks & submerged legs!
          vec2 screenUv = gl_FragCoord.xy / uResolution;
          float opticalDepth = max(waterDepth, 0.0);

          vec3 refractedBody;
          if (uHasRefraction > 0.5) {
            float distortStrength = clamp(opticalDepth * 0.022, 0.002, 0.036) * smoothstep(95.0, 6.0, camDist);
            vec2 refrOffset = N.xz * distortStrength;
            vec2 refrUv = clamp(screenUv + refrOffset, 0.002, 0.998);

            // Prevent sampling objects in FRONT of the water (e.g. player's dry upper torso!)
            float bgRawDepth = texture2D(tRefractDepth, refrUv).r;
            float bgLinear = linearizeDepth(bgRawDepth);
            float rayWaterDist = bgLinear - vViewDepth;
            if (rayWaterDist < -0.05) {
              refrUv = screenUv;
              bgRawDepth = texture2D(tRefractDepth, screenUv).r;
              bgLinear = linearizeDepth(bgRawDepth);
              rayWaterDist = max(bgLinear - vViewDepth, opticalDepth);
            }
            float effDepth = clamp(max(rayWaterDist, opticalDepth * 0.7), 0.0, 22.0);

            // Subtle chromatic refraction on submerged seabed & legs
            vec2 caShift = refrOffset * 0.16;
            vec3 underScene = vec3(
              texture2D(tRefractColor, clamp(refrUv + caShift, 0.002, 0.998)).r,
              texture2D(tRefractColor, refrUv).g,
              texture2D(tRefractColor, clamp(refrUv - caShift, 0.002, 0.998)).b
            );

            // True Beer-Lambert spectral absorption (red dies fast, emerald/turquoise lingers, cobalt deep)
            vec3 transmittance = exp(-vec3(0.46, 0.15, 0.095) * effDepth);
            vec3 scatterShallow = vec3(0.035, 0.42, 0.46);
            vec3 scatterDeep    = vec3(0.008, 0.09, 0.21);
            vec3 scatterCol = mix(scatterShallow, scatterDeep, smoothstep(1.2, 11.0, effDepth));
            scatterCol *= (0.42 + 0.58 * max(L.y, 0.12));

            refractedBody = underScene * transmittance + scatterCol * (1.0 - transmittance);
          } else {
            vec3 shallowCol = vec3(0.04, 0.48, 0.50);
            vec3 deepCol = vec3(0.008, 0.095, 0.21);
            refractedBody = mix(shallowCol, deepCol, smoothstep(0.0, 9.5, opticalDepth));
          }

          // Subsurface scattering emerald-turquoise glow in sunlit wave crests
          float backLight = pow(max(dot(V, -L + N * 0.45), 0.0), 3.0);
          float sssFactor = clamp(vCrest * 1.35 + 0.18, 0.0, 1.35) * (0.35 + 0.65 * backLight);
          vec3 sssCol = vec3(0.03, 0.56, 0.54) * sssFactor * uSunColor * smoothstep(0.02, 0.25, L.y) * 0.52;

          // Sky reflection + realistic crisp GGX sun glitter path
          vec3 skyRefl = sampleSkyReflection(R, L);
          float ndh = max(dot(N, H), 0.0);
          float specBroad = pow(ndh, 110.0) * 0.34;
          float specGlint = pow(ndh, 920.0) * 3.85;
          vec3 sunSpec = uSunColor * (specBroad + specGlint) * smoothstep(0.0, 0.16, L.y);

          vec3 surfaceCol = mix(refractedBody + sssCol, skyRefl, clamp(fresnel * 0.94, 0.02, 0.96)) + sunSpec;

          // High-resolution organic bubbly coastal seafoam (domain-warped FBM + fine cellular micro-bubbles)
          vec2 warp = vec2(
            sin(vWorldPos.x * 1.9 + uTime * 0.6) * cos(vWorldPos.z * 2.1 - uTime * 0.5),
            cos(vWorldPos.x * 2.3 - uTime * 0.5) * sin(vWorldPos.z * 1.7 + uTime * 0.4)
          ) * 0.35 + N.xz * 0.55;

          vec2 foamUv1 = vWorldPos.xz * 3.1 + warp + vec2(uTime * 0.08, -uTime * 0.28);
          vec2 foamUv2 = vWorldPos.xz * 7.4 - warp * 0.6 + vec2(-uTime * 0.14, -uTime * 0.42);
          float lace1 = 1.0 - voronoiFoam(foamUv1);
          float lace2 = 1.0 - voronoiFoam(foamUv2);
          float foamNoise = clamp(lace1 * 0.55 + lace2 * 0.60, 0.0, 1.0);
          float macroBreak = 0.5 + 0.5 * sin(vWorldPos.x * 0.55 + sin(vWorldPos.z * 0.45 - uTime * 0.9) * 2.0);

          // Delicate frothy shoreline swash rim + organic lacy surf tendrils
          float surfLine = smoothstep(0.24, 0.0, waterDepth) * smoothstep(0.24, 0.72, foamNoise + 0.22);
          float waveBand = sin(waterDepth * 10.5 - uTime * 2.1 + macroBreak * 2.6) * 0.5 + 0.5;
          float shoreLace = smoothstep(0.95, 0.08, waterDepth) * smoothstep(0.42, 0.86, foamNoise * 0.62 + waveBand * 0.46 * macroBreak);
          float crestFoam = smoothstep(0.44, 0.80, vCrest * 0.76 + foamNoise * 0.44) *
                            smoothstep(0.8, 3.0, waterDepth) *
                            clamp(uWaveIntensity * 0.75, 0.0, 1.25);

          float totalFoam = clamp(max(max(surfLine * 0.92, shoreLace * 0.82), crestFoam * 0.68), 0.0, 1.0);
          vec3 foamLit = vec3(0.94, 0.96, 0.98) * (0.48 + 0.52 * max(dot(N, L), 0.15)) * mix(vec3(1.0), uSunColor, 0.42);
          surfaceCol = mix(surfaceCol, foamLit, totalFoam * 0.86);

          // Smooth horizon atmospheric fog
          float fogFactor = 1.0 - exp(-pow(camDist * uFogDensity, 1.7));
          surfaceCol = mix(surfaceCol, uFogColor, clamp(fogFactor, 0.0, 1.0));

          // Feather cleanly right at the 0..5cm shore contact line (refracted body handles opacity smoothly!)
          float edgeFeather = smoothstep(-0.015, 0.065, waterDepth);
          float alpha = uHasRefraction > 0.5
            ? edgeFeather
            : clamp(max((1.0 - exp(-max(waterDepth, 0.0) * 1.45)) * 0.94 + fresnel * 0.35, totalFoam * 0.92), 0.0, 0.985) * edgeFeather;

          gl_FragColor = vec4(surfaceCol, alpha);
        }
      `
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 2;
    this.mesh.name = 'OceanSurface';
  }

  public setRefractionTextures(
    colorTex: THREE.Texture | null,
    depthTex: THREE.Texture | null,
    width: number,
    height: number
  ): void {
    const u = this.material.uniforms;
    u.tRefractColor.value = colorTex;
    u.tRefractDepth.value = depthTex;
    u.uHasRefraction.value = colorTex && depthTex ? 1.0 : 0.0;
    u.uResolution.value.set(width, height);
  }

  public update(
    elapsedTime: number,
    waveIntensity: number,
    sunDirection: THREE.Vector3,
    sunColor: THREE.Color,
    skyZenith: THREE.Color,
    skyHorizon: THREE.Color,
    fogColor: THREE.Color
  ): void {
    const u = this.material.uniforms;
    u.uTime.value = elapsedTime;
    u.uWaveIntensity.value = waveIntensity;
    u.uSunDirection.value.copy(sunDirection);
    u.uSunColor.value.copy(sunColor);
    u.uSkyZenith.value.copy(skyZenith);
    u.uSkyHorizon.value.copy(skyHorizon);
    u.uFogColor.value.copy(fogColor);
  }
}
