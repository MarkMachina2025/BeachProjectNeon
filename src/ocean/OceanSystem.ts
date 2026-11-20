import * as THREE from 'three';
import { GERSTNER_GLSL } from './wavePhysics';
import { TERRAIN_HEIGHT_GLSL } from '../terrain/terrainMath';

/**
 * Physically inspired coastal ocean surface:
 *  - Multi-directional 6-wave Gerstner vertex displacement with coastal shoaling
 *  - High-frequency animated normal detail (dual scrolling capillary ripples)
 *  - Above-water: Schlick Fresnel reflections, GGX sun specular sparkle,
 *    Beer-Lambert depth color absorption (crystal emerald shallows -> deep ocean blue),
 *    subsurface scattering glow in backlit wave crests, organic shoreline & crest foam
 *  - Underwater underside: Snell's Window (refracted sky/sun disk inside critical angle,
 *    deep aquatic total internal reflection outside critical angle)
 */
export class OceanSystem {
  public readonly mesh: THREE.Mesh;
  public readonly material: THREE.ShaderMaterial;

  constructor() {
    // Concentrate grid density in the playable bay & shoreline, stretching out to horizon
    const segX = 240;
    const segZ = 240;
    const geo = new THREE.PlaneGeometry(1, 1, segX, segZ);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const nx = pos.getX(i) * 2.0; // -1..1
      const nz = pos.getZ(i) * 2.0; // -1..1

      const x = Math.sign(nx) * (Math.abs(nx) * 65.0 + Math.pow(Math.abs(nx), 2.5) * 340.0);
      // Starts slightly inland (-16m) so waves can wash up the beach, extending 420m seaward
      const z =
        nz < -0.5
          ? -16.0 + (nz + 1.0) * 32.0
          : (nz + 0.5) * 52.0 + Math.pow(Math.max(0, nz + 0.5), 2.4) * 220.0;

      pos.setXYZ(i, x, 0, z);
    }

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uWaveIntensity: { value: 1.0 },
        uSunDirection: { value: new THREE.Vector3(0.35, 0.72, 0.58).normalize() },
        uSunColor: { value: new THREE.Color(0xfff4dd) },
        uSkyZenith: { value: new THREE.Color(0x1f6bb8) },
        uSkyHorizon: { value: new THREE.Color(0xa6d8f0) },
        uFogColor: { value: new THREE.Color(0xb4dcf0) },
        uFogDensity: { value: 0.0022 }
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uWaveIntensity;

        varying vec3 vWorldPos;
        varying vec3 vWaveNormal;
        varying float vCrest;
        varying float vTerrainH;

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

          vWorldPos = worldPos.xyz;
          vWaveNormal = wNorm;
          vCrest = crest;
          vTerrainH = getTerrainHeightGLSL(worldPos.xz);

          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: /* glsl */ `
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

        float hash21(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.5);
          return fract(p.x * p.y);
        }

        float vNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
            mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }

        float fbmFoam(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * vNoise(p);
            p = p * 2.12 + vec2(13.4, -7.1);
            a *= 0.5;
          }
          return v;
        }

        // Dual-layer animated capillary ripple normal perturbation
        vec3 addCapillaryNormals(vec3 baseN, vec2 xz, float time, float distFade) {
          vec2 uv1 = xz * 0.85 + vec2(time * 0.24, -time * 0.36);
          vec2 uv2 = xz * 1.95 + vec2(-time * 0.31, -time * 0.22);
          float e = 0.08;

          float h1x = vNoise(uv1 + vec2(e, 0.0)) - vNoise(uv1 - vec2(e, 0.0));
          float h1z = vNoise(uv1 + vec2(0.0, e)) - vNoise(uv1 - vec2(0.0, e));
          float h2x = vNoise(uv2 + vec2(e, 0.0)) - vNoise(uv2 - vec2(e, 0.0));
          float h2z = vNoise(uv2 + vec2(0.0, e)) - vNoise(uv2 - vec2(0.0, e));

          vec3 detail = vec3(h1x * 0.26 + h2x * 0.14, 0.0, h1z * 0.26 + h2z * 0.14) * distFade;
          return normalize(baseN + detail);
        }

        vec3 sampleSkyGradient(vec3 dir, vec3 sunDir) {
          float up = clamp(dir.y, 0.0, 1.0);
          vec3 sky = mix(uSkyHorizon, uSkyZenith, pow(up, 0.55));
          float sunDot = max(dot(dir, sunDir), 0.0);
          sky += uSunColor * (pow(sunDot, 16.0) * 0.24 + pow(sunDot, 360.0) * 2.2);
          return sky;
        }

        void main() {
          float waterDepth = vWorldPos.y - vTerrainH;
          if (waterDepth < -0.025) discard;

          vec3 toCam = cameraPosition - vWorldPos;
          float camDist = length(toCam);
          vec3 V = toCam / max(camDist, 0.0001);
          float distFade = smoothstep(180.0, 12.0, camDist);
          vec3 N = addCapillaryNormals(normalize(vWaveNormal), vWorldPos.xz, uTime, distFade);

          // ==================== UNDERWATER UNDERSIDE (SNELL'S WINDOW) ====================
          if (!gl_FrontFacing) {
            vec3 Nu = -N;
            // Snell's law: water (n=1.333) to air (n=1.0)
            vec3 refr = refract(-V, Nu, 1.333);
            bool totalInternalRefl = (length(refr) < 0.001);

            vec3 deepReflect = mix(vec3(0.015, 0.14, 0.22), vec3(0.04, 0.28, 0.36), clamp(dot(Nu, V), 0.0, 1.0));
            vec3 col = deepReflect;

            if (!totalInternalRefl) {
              vec3 skyThrough = sampleSkyGradient(normalize(refr), uSunDirection);
              float cosTheta = clamp(dot(Nu, V), 0.0, 1.0);
              float snellWindow = smoothstep(0.64, 0.80, cosTheta);
              // Bright turquoise caustic rim around Snell's window edge
              float rimGlow = exp(-pow((cosTheta - 0.72) / 0.08, 2.0)) * 0.45;
              col = mix(deepReflect, skyThrough * vec3(0.86, 0.98, 1.02), snellWindow);
              col += vec3(0.18, 0.72, 0.78) * rimGlow;
            }

            // Distance underwater attenuation on ceiling
            float fogAmt = 1.0 - exp(-camDist * 0.038);
            col = mix(col, vec3(0.02, 0.22, 0.32), fogAmt);
            gl_FragColor = vec4(col, 0.94);
            return;
          }

          // ==================== ABOVE-WATER SURFACE ====================
          vec3 L = normalize(uSunDirection);
          vec3 H = normalize(L + V);
          vec3 R = reflect(-V, N);
          R.y = max(R.y, 0.015);

          // Schlick Fresnel for seawater (IOR 1.333 -> F0 = 0.02)
          float ndv = max(dot(N, V), 0.0);
          float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

          // Beer-Lambert optical water body color from crystal shallows to deep cobalt-teal
          vec3 shallowCol = vec3(0.06, 0.56, 0.58);
          vec3 midCol     = vec3(0.02, 0.31, 0.44);
          vec3 deepCol    = vec3(0.008, 0.095, 0.21);

          float dShallow = smoothstep(0.0, 2.8, waterDepth);
          float dDeep    = smoothstep(2.0, 13.0, waterDepth);
          vec3 waterBody = mix(shallowCol, midCol, dShallow);
          waterBody = mix(waterBody, deepCol, dDeep);

          // Subsurface scattering turquoise glow through backlit wave crests
          float backLight = pow(max(dot(V, -L + N * 0.45), 0.0), 3.2);
          float sssFactor = clamp(vCrest * 1.45 + 0.25, 0.0, 1.4) * (0.4 + 0.6 * backLight);
          vec3 sssCol = vec3(0.04, 0.64, 0.62) * sssFactor * uSunColor * smoothstep(0.02, 0.25, L.y) * 0.55;

          // Sky reflection
          vec3 skyRefl = sampleSkyGradient(R, L);

          // Crisp GGX-style dual specular sun sparkle
          float ndh = max(dot(N, H), 0.0);
          float specBroad = pow(ndh, 96.0) * 0.38;
          float specSharp = pow(ndh, 720.0) * 2.85;
          vec3 sunSpec = uSunColor * (specBroad + specSharp) * smoothstep(0.0, 0.16, L.y);

          vec3 surfaceCol = mix(waterBody + sssCol, skyRefl, clamp(fresnel * 0.92, 0.0, 0.95)) + sunSpec;

          // Organic shoreline swash foam + whitecap crest foam
          float foamNoise = fbmFoam(vWorldPos.xz * 0.52 + vec2(0.0, -uTime * 0.28));
          float fineBubble = vNoise(vWorldPos.xz * 3.4 + vec2(uTime * 0.35, -uTime * 0.5));

          // Rhythmic lacy shorebreak bands where water meets sloping sand
          float shoreWave = sin(waterDepth * 14.0 - uTime * 2.4 + foamNoise * 4.5) * 0.5 + 0.5;
          float shoreFoam = smoothstep(0.58, 0.02, waterDepth) * smoothstep(0.32, 0.72, foamNoise + shoreWave * 0.38);
          float thinEdgeFoam = smoothstep(0.14, 0.0, waterDepth) * smoothstep(0.25, 0.65, fineBubble + 0.28);

          // Deep-water wave crest whitecaps scaled by wave intensity
          float crestFoam = smoothstep(0.36, 0.72, vCrest * 0.75 + foamNoise * 0.48) *
                            smoothstep(0.6, 2.5, waterDepth) *
                            clamp(uWaveIntensity * 0.75, 0.0, 1.2);

          float totalFoam = clamp(max(max(shoreFoam, thinEdgeFoam), crestFoam * 0.65), 0.0, 1.0);
          vec3 foamLit = (vec3(0.95, 0.97, 0.99) * (0.45 + 0.55 * max(dot(N, L), 0.15))) * mix(vec3(1.0), uSunColor, 0.45);
          surfaceCol = mix(surfaceCol, foamLit, totalFoam * 0.88);

          // Realistic distance horizon fog blending seamlessly into Sky dome
          float fogFactor = 1.0 - exp(-pow(camDist * uFogDensity, 1.75));
          surfaceCol = mix(surfaceCol, uFogColor, clamp(fogFactor, 0.0, 1.0));

          // Physical shoreline transparency: crystal-clear shallow edge transitioning to rich depth opacity
          float depthAlpha = 1.0 - exp(-max(waterDepth, 0.0) * 1.45);
          float alpha = clamp(max(depthAlpha * 0.94 + fresnel * 0.35, totalFoam * 0.92), 0.0, 0.985);
          alpha *= smoothstep(-0.02, 0.045, waterDepth);

          gl_FragColor = vec4(surfaceCol, alpha);
        }
      `
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 2;
    this.mesh.name = 'OceanSurface';
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
