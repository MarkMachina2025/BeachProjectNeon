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
 *  - 4-octave real photographic ocean normal maps (Three.js seamless water normals)
 *    blended on top of analytical 6-wave Gerstner displacement
 *  - True Screen-Space Refraction with wave-normal distortion, subtle dispersion &
 *    Beer-Lambert spectral depth absorption (crystal shallows -> turquoise -> deep sapphire)
 *  - Organic 5-octave domain-warped FBM frothy shorebreak & crest foam (ZERO polygonal/Voronoi tiles!)
 *  - Physically based Schlick Fresnel sky reflections, crisp GGX sun glitter, SSS crest glow
 *  - Authentic Underwater Snell's Window looking up through the waves
 */
export class OceanSystem {
  public readonly mesh: THREE.Mesh;
  public readonly material: THREE.ShaderMaterial;

  constructor() {
    const segX = 96;
    const segZ = 96;
    const geo = new THREE.PlaneGeometry(1, 1, segX, segZ);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const nx = pos.getX(i) * 2.0;
      const nz = pos.getZ(i) * 2.0;

      // Extra vertex density concentrated across the active shoreline & swimming bay (-70..+70, z=-10..+46)
      // so the water mesh physically bends & ripples smoothly around characters & kayaks!
      const x = Math.sign(nx) * (Math.abs(nx) * 95.0 + Math.pow(Math.abs(nx), 2.8) * 420.0);
      const z =
        nz < -0.55
          ? -26.0 + (nz + 1.0) * 52.0
          : nz < 0.35
            ? -2.6 + ((nz + 0.55) / 0.90) * 48.0
            : 45.4 + Math.pow((nz - 0.35) / 0.65, 2.2) * 380.0;

      pos.setXYZ(i, x, 0, z);
    }

    const normalMapA = loadWaterNormal('./textures/waternormals.jpg');
    const normalMapB = loadWaterNormal('./textures/water_normal_1.jpg');
    const normalMapC = loadWaterNormal('./textures/water_normal_2.jpg');

    const fallbackCanvas = document.createElement('canvas');
    fallbackCanvas.width = 2;
    fallbackCanvas.height = 2;
    const fctx = fallbackCanvas.getContext('2d');
    if (fctx) {
      fctx.fillStyle = '#4aa0d8';
      fctx.fillRect(0, 0, 2, 2);
    }
    const fallbackCube = new THREE.CubeTexture([
      fallbackCanvas,
      fallbackCanvas,
      fallbackCanvas,
      fallbackCanvas,
      fallbackCanvas,
      fallbackCanvas
    ]);
    fallbackCube.needsUpdate = true;

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
        uSkyCube: { value: fallbackCube },
        uHasSkyCube: { value: 0.0 },
        uNoise: { value: null },
        uHasNoise: { value: 0.0 },
        uUnderFog: { value: new THREE.Color(0x033845) },
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
        uFogDensity: { value: 0.0016 },
        tRippleMap: { value: null },
        uHasRipples: { value: 0.0 },
        uRippleCenter: { value: new THREE.Vector2(0, 8) },
        uRippleSize: { value: 40.0 },
        uRippleTexel: { value: 1.0 / 256.0 },
        uPlayerBody: { value: new THREE.Vector4(0, -500, 0.36, 0) },
        uPlayerVel: { value: new THREE.Vector2(0, 0) },
        uNearBodies: {
          value: [
            new THREE.Vector4(0, -500, 0.32, 0),
            new THREE.Vector4(0, -500, 0.32, 0),
            new THREE.Vector4(0, -500, 0.32, 0),
            new THREE.Vector4(0, -500, 0.32, 0)
          ]
        }
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uWaveIntensity;
        uniform sampler2D tRippleMap;
        uniform float uHasRipples;
        uniform vec2 uRippleCenter;
        uniform float uRippleSize;
        uniform vec4 uPlayerBody;
        uniform vec2 uPlayerVel;
        uniform vec4 uNearBodies[4];

        varying vec3 vWorldPos;
        varying vec3 vWaveNormal;
        varying float vCrest;
        varying float vTerrainH;
        varying float vViewDepth;
        varying float vBodyBend;

        ${TERRAIN_HEIGHT_GLSL}
        ${GERSTNER_GLSL}

        void main() {
          vec4 baseWorld = modelMatrix * vec4(position, 1.0);
          float terrainH = getTerrainHeightGLSL(baseWorld.xz);
          float shoal = waveShoalingFactorGLSL(terrainH);

          vec3 wNorm;
          float crest;
          vec3 disp = evalGerstnerDisplacement(baseWorld.xz, uTime, uWaveIntensity, shoal, wNorm, crest);

          // 1. Sample Real-Time GPGPU 2D Wave-Equation Heightfield for propagating ripples & V-wakes!
          float rippleDisp = 0.0;
          if (uHasRipples > 0.5) {
            vec2 ruv = (baseWorld.xz - uRippleCenter) / uRippleSize + 0.5;
            if (ruv.x > 0.02 && ruv.x < 0.98 && ruv.y > 0.02 && ruv.y < 0.98) {
              float edgeFade = smoothstep(0.02, 0.12, min(min(ruv.x, 1.0 - ruv.x), min(ruv.y, 1.0 - ruv.y)));
              rippleDisp = texture2D(tRippleMap, ruv).r * 0.070 * edgeFade;
            }
          }

          // 2. Smooth Natural Body-Water Meniscus & Gentle Bow Swell around Player & Near NPCs!
          float bodyBend = 0.0;
          if (uPlayerBody.w > 0.01) {
            vec2 toV = baseWorld.xz - uPlayerBody.xy;
            float d = length(toV);
            float rad = uPlayerBody.z;
            if (d < rad + 1.65) {
              float spd = length(uPlayerVel);
              vec2 fwd = spd > 0.08 ? (uPlayerVel / spd) : vec2(0.0, 1.0);
              vec2 uDir = d > 0.001 ? (toV / d) : fwd;
              float align = dot(uDir, fwd);

              // Subtle natural capillary meniscus + gentle bow-wave swell ahead & trough behind
              float meniscus = exp(-pow((d - rad * 1.02) / 0.28, 2.0)) * (0.016 + 0.014 * clamp(spd / 2.8, 0.0, 1.0));
              float bowPush = align * exp(-pow((d - rad * 1.24) / 0.52, 2.0)) * clamp(spd / 2.6, 0.0, 1.1) * 0.026;
              float centerDip = -exp(-pow(d / max(rad * 0.72, 0.12), 2.0)) * 0.016;
              bodyBend += (meniscus + bowPush + centerDip) * uPlayerBody.w;
            }
          }
          for (int i = 0; i < 4; i++) {
            vec4 nb = uNearBodies[i];
            if (nb.w <= 0.01) continue;
            float d = length(baseWorld.xz - nb.xy);
            if (d < nb.z + 1.05) {
              float meniscus = exp(-pow((d - nb.z * 1.02) / 0.26, 2.0)) * 0.015 * nb.w;
              float dip = -exp(-pow(d / max(nb.z * 0.70, 0.12), 2.0)) * 0.014 * nb.w;
              bodyBend += meniscus + dip;
            }
          }

          disp.y += (rippleDisp + bodyBend) * smoothstep(-0.04, 0.06, disp.y - terrainH);

          vec3 displaced = position + disp;
          vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
          vec4 viewPos = viewMatrix * worldPos;

          vWorldPos = worldPos.xyz;
          vWaveNormal = wNorm;
          // Keep vCrest strictly driven by real ocean swells (NO fake cyan SSS arc around body!)
          vCrest = crest;
          vTerrainH = getTerrainHeightGLSL(worldPos.xz);
          vViewDepth = -viewPos.z;
          vBodyBend = abs(bodyBend);

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
        uniform samplerCube uSkyCube;
        uniform float uHasSkyCube;
        uniform sampler2D uNoise;
        uniform float uHasNoise;
        uniform vec3 uUnderFog;
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
        uniform sampler2D tRippleMap;
        uniform float uHasRipples;
        uniform vec2 uRippleCenter;
        uniform float uRippleSize;
        uniform float uRippleTexel;
        uniform vec4 uPlayerBody;
        uniform vec2 uPlayerVel;
        uniform vec4 uNearBodies[4];

        varying vec3 vWorldPos;
        varying vec3 vWaveNormal;
        varying float vCrest;
        varying float vTerrainH;
        varying float vViewDepth;
        varying float vBodyBend;

        float linearizeDepth(float d) {
          float z = d * 2.0 - 1.0;
          return (2.0 * uNear * uFar) / max(uFar + uNear - z * (uFar - uNear), 0.0001);
        }

        float hash21(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.5);
          return fract(p.x * p.y);
        }

        float smoothNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0); // quintic C2 smooth interpolation
          return mix(
            mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
            mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }

        // Organic 5-octave rotated FBM for feathery, frothy natural coastal seafoam (zero tiles/cracks!)
        float fbmFoam(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          mat2 m = mat2(0.80, -0.60, 0.60, 0.80);
          for (int i = 0; i < 5; i++) {
            v += a * smoothNoise(p);
            p = m * p * 2.08 + vec2(11.3, -7.7);
            a *= 0.5;
          }
          return v;
        }

        // 4-octave real photographic normal-map perturbation
        vec3 sampleOceanNormal(vec3 baseN, vec2 xz, float time, float camDist) {
          float nearFade = smoothstep(260.0, 16.0, camDist);
          float microFade = smoothstep(90.0, 3.0, camDist);

          vec2 uv0 = xz * 0.028 + vec2(time * 0.018, -time * 0.032);
          vec2 uv1 = xz * 0.082 + vec2(-time * 0.026, -time * 0.044);
          vec2 uv2 = xz * 0.220 + vec2(time * 0.042, -time * 0.058);
          vec2 uv3 = xz * 0.540 + vec2(-time * 0.055, -time * 0.038);

          vec3 n0 = texture2D(uNormalMapA, uv0).xyz * 2.0 - 1.0;
          vec3 n1 = texture2D(uNormalMapB, uv1).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(uNormalMapC, uv2).xyz * 2.0 - 1.0;
          vec3 n3 = texture2D(uNormalMapA, uv3).xyz * 2.0 - 1.0;

          vec2 combined =
            n0.xy * 0.23 * nearFade +
            n1.xy * 0.19 * nearFade +
            n2.xy * 0.16 * microFade +
            n3.xy * 0.10 * microFade;

          combined *= (0.72 + 0.35 * clamp(uWaveIntensity, 0.25, 2.0));
          return normalize(baseN + vec3(combined.x, 0.0, combined.y));
        }

        vec3 sampleSkyReflection(vec3 dir, vec3 sunDir) {
          vec3 d = normalize(vec3(dir.x, max(dir.y, 0.015), dir.z));
          vec3 sky;
          if (uHasSkyCube > 0.5) {
            sky = textureCube(uSkyCube, d).rgb;
          } else {
            float up = clamp(d.y, 0.0, 1.0);
            sky = mix(uSkyHorizon, uSkyZenith, pow(up, 0.52));
            float sunDot = max(dot(d, sunDir), 0.0);
            sky += uSunColor * (pow(sunDot, 10.0) * 0.28 + pow(sunDot, 260.0) * 2.6);
          }
          return sky;
        }

        void main() {
          float waterDepth = vWorldPos.y - vTerrainH;
          if (waterDepth < -0.02) discard;

          vec3 toCam = cameraPosition - vWorldPos;
          float camDist = length(toCam);
          vec3 V = toCam / max(camDist, 0.0001);
          vec3 N = sampleOceanNormal(normalize(vWaveNormal), vWorldPos.xz, uTime, camDist);

          // Sample silky wide-kernel GPGPU 2D wave-equation ripple normals & wake-foam trail + gentle body meniscus!
          float wakeFoamField = 0.0;
          float meniscusFoam = 0.0;
          if (uHasRipples > 0.5) {
            vec2 ruv = (vWorldPos.xz - uRippleCenter) / uRippleSize + 0.5;
            if (ruv.x > 0.02 && ruv.x < 0.98 && ruv.y > 0.02 && ruv.y < 0.98) {
              float edgeFade = smoothstep(0.02, 0.12, min(min(ruv.x, 1.0 - ruv.x), min(ruv.y, 1.0 - ruv.y)));
              vec4 rCenter = texture2D(tRippleMap, ruv);
              float t2 = uRippleTexel * 2.0;
              float hL = texture2D(tRippleMap, ruv - vec2(t2, 0.0)).r;
              float hR = texture2D(tRippleMap, ruv + vec2(t2, 0.0)).r;
              float hD = texture2D(tRippleMap, ruv - vec2(0.0, t2)).r;
              float hU = texture2D(tRippleMap, ruv + vec2(0.0, t2)).r;
              vec2 rippleGrad = vec2(hL - hR, hD - hU) * 0.48 * edgeFade;
              N = normalize(N + vec3(rippleGrad.x, 0.0, rippleGrad.y));
              wakeFoamField = clamp(rCenter.b * edgeFade, 0.0, 1.0);
            }
          }

          // Ultra-gentle body-water meniscus normal curve & delicate contact shimmer (ZERO bright blue halo ring!)
          if (uPlayerBody.w > 0.01) {
            vec2 toP = vWorldPos.xz - uPlayerBody.xy;
            float dP = length(toP);
            float radP = uPlayerBody.z;
            if (dP < radP + 0.85 && dP > 0.01) {
              vec2 uRad = toP / dP;
              float ring = exp(-pow((dP - radP * 0.92) / 0.14, 2.0));
              float tiltSlope = (radP * 0.94 - dP) * exp(-pow((dP - radP * 0.94) / 0.28, 2.0)) * 0.30 * uPlayerBody.w;
              N = normalize(N + vec3(uRad.x * tiltSlope, 0.0, uRad.y * tiltSlope));
              float spdBoost = 0.20 + 0.65 * clamp(length(uPlayerVel) / 2.4, 0.0, 1.0);
              meniscusFoam = max(meniscusFoam, ring * spdBoost * uPlayerBody.w);
            }
          }
          for (int i = 0; i < 4; i++) {
            vec4 nb = uNearBodies[i];
            if (nb.w <= 0.01) continue;
            vec2 toB = vWorldPos.xz - nb.xy;
            float dB = length(toB);
            if (dB < nb.z + 0.65 && dB > 0.01) {
              vec2 uRad = toB / dB;
              float ring = exp(-pow((dB - nb.z * 0.94) / 0.14, 2.0));
              float tiltSlope = (nb.z * 0.94 - dB) * exp(-pow((dB - nb.z * 0.94) / 0.26, 2.0)) * 0.25 * nb.w;
              N = normalize(N + vec3(uRad.x * tiltSlope, 0.0, uRad.y * tiltSlope));
              meniscusFoam = max(meniscusFoam, ring * 0.34 * nb.w);
            }
          }

          // ==================== UNDERWATER UNDERSIDE (SNELL'S WINDOW) ====================
          if (!gl_FrontFacing) {
            vec3 Nu = -N;
            vec3 refr = refract(-V, Nu, 1.333);
            bool totalInternalRefl = (length(refr) < 0.001);

            vec3 deepReflect = mix(vec3(0.012, 0.13, 0.21), vec3(0.04, 0.28, 0.36), clamp(dot(Nu, V), 0.0, 1.0));
            vec3 col = deepReflect;

            if (!totalInternalRefl) {
              vec3 skyThrough = sampleSkyReflection(normalize(refr), uSunDirection);
              vec2 ruv = clamp(gl_FragCoord.xy / uResolution + Nu.xz * 0.04, 0.002, 0.998);
              vec3 aboveRefr = uHasRefraction > 0.5 ? texture2D(tRefractColor, ruv).rgb : skyThrough;
              vec3 above = mix(skyThrough, aboveRefr, uHasRefraction * 0.55);

              float cosTheta = clamp(dot(Nu, V), 0.0, 1.0);
              float snellWindow = smoothstep(0.64, 0.80, cosTheta);
              float rimGlow = exp(-pow((cosTheta - 0.72) / 0.075, 2.0)) * 0.48;

              vec3 Td = refract(-V, Nu, 1.333);
              float sunHit = pow(max(dot(normalize(Td + vec3(0.0, 1e-4, 0.0)), uSunDirection), 0.0), 220.0) * 5.0;

              col = mix(deepReflect, above * 0.95, snellWindow);
              col += vec3(0.20, 0.76, 0.82) * rimGlow;
              col += uSunColor * sunHit * (0.25 + 0.75 * snellWindow);
            }

            float fogAmt = 1.0 - exp(-camDist * 0.036);
            col = mix(col, uUnderFog, fogAmt);
            gl_FragColor = vec4(col, 0.95);
            return;
          }

          // ==================== ABOVE-WATER PHOTOREALISTIC SURFACE ====================
          vec3 L = normalize(uSunDirection);
          vec3 H = normalize(L + V);
          vec3 R = reflect(-V, N);
          R.y = max(R.y, 0.015);

          float ndv = max(dot(N, V), 0.0);
          float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

          vec2 screenUv = gl_FragCoord.xy / uResolution;
          float opticalDepth = max(waterDepth, 0.0);

          vec3 refractedBody;
          if (uHasRefraction > 0.5) {
            float distortStrength = clamp(opticalDepth * 0.026, 0.0025, 0.038) * smoothstep(95.0, 4.0, camDist);
            vec2 refrOffset = N.xz * distortStrength;
            vec2 refrUv = clamp(screenUv + refrOffset, 0.002, 0.998);

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

            vec2 caShift = refrOffset * 0.14;
            vec3 underScene = vec3(
              texture2D(tRefractColor, clamp(refrUv + caShift, 0.002, 0.998)).r,
              texture2D(tRefractColor, refrUv).g,
              texture2D(tRefractColor, clamp(refrUv - caShift, 0.002, 0.998)).b
            );

            // True Beer-Lambert optical absorption (crystal sunlit shallows -> emerald turquoise -> deep cobalt)
            vec3 transmittance = exp(-vec3(0.32, 0.068, 0.048) * effDepth);
            vec3 scatterShallow = vec3(0.036, 0.48, 0.54);
            vec3 scatterDeep    = vec3(0.008, 0.09, 0.21);
            vec3 scatterCol = mix(scatterShallow, scatterDeep, smoothstep(1.2, 11.0, effDepth));
            scatterCol *= (0.44 + 0.56 * max(L.y, 0.12));

            refractedBody = underScene * transmittance + scatterCol * (1.0 - transmittance);
          } else {
            vec3 shallowCol = vec3(0.04, 0.48, 0.50);
            vec3 deepCol = vec3(0.008, 0.095, 0.21);
            refractedBody = mix(shallowCol, deepCol, smoothstep(0.0, 9.5, opticalDepth));
          }

          // Subsurface scattering emerald-turquoise glow in sunlit wave crests
          float backLight = pow(max(dot(V, -L + N * 0.45), 0.0), 3.0);
          float sssFactor = clamp(vCrest * 1.35 + 0.18, 0.0, 1.35) * (0.35 + 0.65 * backLight);
          vec3 sssCol = vec3(0.03, 0.56, 0.54) * sssFactor * uSunColor * smoothstep(0.02, 0.25, L.y) * 0.50;

          vec3 skyRefl = sampleSkyReflection(R, L);
          float ndh = max(dot(N, H), 0.0);
          float specBroad = pow(ndh, 140.0) * 0.48;
          float specGlint = pow(ndh, 1100.0) * 7.2;
          vec3 sunSpec = uSunColor * (specBroad + specGlint) * smoothstep(0.0, 0.16, L.y);

          vec3 surfaceCol = mix(refractedBody + sssCol, skyRefl, clamp(fresnel * 0.94, 0.02, 0.96)) + sunSpec;

          // ==================== ORGANIC FEATHERY SEAFOAM (ZERO TILES / ZERO VORONOI) ====================
          vec2 flowUv = vWorldPos.xz * 0.58 + vec2(0.0, -uTime * 0.22);
          float warpX = fbmFoam(flowUv + vec2(2.3, 4.1)) - 0.5;
          float warpZ = fbmFoam(flowUv + vec2(7.9, 1.7)) - 0.5;
          vec2 warpedXZ = vWorldPos.xz + vec2(warpX, warpZ) * 1.35 + N.xz * 0.45;

          // Soft frothy clouds + delicate fine bubbly micro-speckle
          float froth = fbmFoam(warpedXZ * 1.25 + vec2(uTime * 0.05, -uTime * 0.18));
          float fineBubbles = smoothNoise(warpedXZ * 9.5 + vec2(-uTime * 0.12, -uTime * 0.32)) * 0.55 +
                              smoothNoise(warpedXZ * 22.0 + vec2(uTime * 0.18, -uTime * 0.26)) * 0.45;
          float organicFoam = clamp(froth * 0.72 + fineBubbles * 0.38, 0.0, 1.0);

          // Delicate translucent lacy edge where thin water laps onto dark wet sand
          float edgeRim = smoothstep(0.20, 0.015, waterDepth) * smoothstep(0.28, 0.65, organicFoam + 0.16);
          float laceFilaments = smoothstep(0.54, 0.82, fineBubbles) * smoothstep(0.95, 0.08, waterDepth) * 0.42;

          // Gentle rolling shorebreak foam wash (soft organic bands, fading gracefully into clear water)
          float swashBand = sin(waterDepth * 7.5 - uTime * 1.9 + froth * 3.2) * 0.5 + 0.5;
          float shoreFroth = smoothstep(0.85, 0.04, waterDepth) *
                             smoothstep(0.45, 0.77, froth * 0.65 + swashBand * 0.38) *
                             (0.48 + 0.52 * fineBubbles);

          // Subtle breaking whitecaps on larger swells out at sea
          float crestFoam = smoothstep(0.46, 0.78, vCrest * 0.74 + froth * 0.42) *
                            smoothstep(0.9, 3.2, waterDepth) *
                            clamp(uWaveIntensity * 0.72, 0.0, 1.2);

          // Gossamer lacy meniscus & translucent broken wake filigree (ZERO milky solid white paint smear!)
          float wakeFiligree = smoothstep(0.32, 0.78, organicFoam * 0.54 + fineBubbles * 0.62);
          float bodyContactFoam = meniscusFoam * wakeFiligree * 0.40;
          float wakeTrailFoam = smoothstep(0.11, 0.64, wakeFoamField) * wakeFiligree * 0.54;
          float interactiveFoam = max(bodyContactFoam, wakeTrailFoam);

          float totalFoam = clamp(
            max(max(edgeRim * 0.88, max(shoreFroth * 0.80, laceFilaments)), max(crestFoam * 0.64, interactiveFoam)),
            0.0,
            0.95
          );
          vec3 foamLit = vec3(0.94, 0.97, 0.99) * (0.52 + 0.48 * max(dot(N, L), 0.18)) * mix(vec3(1.0), uSunColor, 0.38);
          surfaceCol = mix(surfaceCol, foamLit, totalFoam);

          // Smooth horizon atmospheric fog
          float fogFactor = 1.0 - exp(-pow(camDist * uFogDensity, 1.7));
          surfaceCol = mix(surfaceCol, uFogColor, clamp(fogFactor, 0.0, 1.0));

          // Feathered glass-like water edge blending seamlessly into glossy wet sand
          float edgeFeather = smoothstep(-0.01, 0.085, waterDepth);
          float alpha = uHasRefraction > 0.5
            ? edgeFeather
            : clamp(max((1.0 - exp(-max(waterDepth, 0.0) * 1.45)) * 0.94 + fresnel * 0.35, totalFoam * 0.88), 0.0, 0.985) * edgeFeather;

          gl_FragColor = vec4(surfaceCol, alpha);
        }
      `
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 2;
    this.mesh.name = 'OceanSurface';
  }

  public setSharedMaps(skyCube: THREE.CubeTexture, noiseTex: THREE.DataTexture): void {
    const u = this.material.uniforms;
    u.uSkyCube.value = skyCube;
    u.uHasSkyCube.value = 1.0;
    u.uNoise.value = noiseTex;
    u.uHasNoise.value = 1.0;
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

  public setRippleMap(
    tex: THREE.Texture,
    center: THREE.Vector2,
    size: number,
    resolution: number,
    playerBody: THREE.Vector4,
    playerVel: THREE.Vector2,
    nearBodies: THREE.Vector4[]
  ): void {
    const u = this.material.uniforms;
    u.tRippleMap.value = tex;
    u.uHasRipples.value = 1.0;
    u.uRippleCenter.value.copy(center);
    u.uRippleSize.value = size;
    u.uRippleTexel.value = 1.0 / resolution;
    u.uPlayerBody.value.copy(playerBody);
    u.uPlayerVel.value.copy(playerVel);
    for (let i = 0; i < Math.min(4, nearBodies.length); i++) {
      (u.uNearBodies.value as THREE.Vector4[])[i].copy(nearBodies[i]);
    }
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
