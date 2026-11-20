import * as THREE from 'three';
import { GERSTNER_GLSL } from './wavePhysics';
import { TERRAIN_HEIGHT_GLSL } from '../terrain/terrainMath';

/**
 * High-Fidelity Multi-Stage Post-Processing & Anti-Aliasing Pipeline:
 *  Stage 1 (sceneRT): Supersampled HDR + DepthTexture 3D scene render
 *  Stage 2 (compositeRT): Seamless GTA V-style Gerstner waterline meniscus, Beer-Lambert
 *    underwater fog, depth-weighted optical softening, edge chromatic aberration, silky
 *    volumetric god rays, subtle HDR bloom/halation, ACES Filmic tone mapping & sRGB + Luma
 *  Stage 3 (FXAA 3.11 Quality Pass): Full edge-span search & sub-pixel anti-aliasing
 *    eliminating jagged staircase edges across characters, props, shoreline, and horizon!
 */
export class UnderwaterPostProcess {
  public readonly renderTarget: THREE.WebGLRenderTarget;
  private readonly compositeTarget: THREE.WebGLRenderTarget;

  private readonly postScene: THREE.Scene;
  private readonly fxaaScene: THREE.Scene;
  private readonly postCamera: THREE.OrthographicCamera;
  private readonly postMaterial: THREE.ShaderMaterial;
  private readonly fxaaMaterial: THREE.ShaderMaterial;

  private readonly invProj = new THREE.Matrix4();
  private readonly camWorld = new THREE.Matrix4();

  private aaEnabled = true;
  private supersampleScale = 1.35; // Crisp supersampling on 1x displays (clamped safely to max 2.0 total DPR)

  constructor(renderer: THREE.WebGLRenderer, width: number, height: number) {
    const { rtW, rtH } = this.computeTargetSize(width, height);

    const depthTexture = new THREE.DepthTexture(rtW, rtH);
    depthTexture.type = THREE.UnsignedIntType;
    depthTexture.format = THREE.DepthFormat;

    const useHalfFloat =
      renderer.capabilities.isWebGL2 &&
      renderer.extensions.has('EXT_color_buffer_float');

    this.renderTarget = new THREE.WebGLRenderTarget(rtW, rtH, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: useHalfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: true,
      depthTexture
    });

    this.compositeTarget = new THREE.WebGLRenderTarget(rtW, rtH, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false
    });

    this.postScene = new THREE.Scene();
    this.fxaaScene = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.postMaterial = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.renderTarget.texture },
        tDepth: { value: depthTexture },
        uResolution: { value: new THREE.Vector2(rtW, rtH) },
        uTime: { value: 0 },
        uWaveIntensity: { value: 1.0 },
        uCameraPos: { value: new THREE.Vector3() },
        uInvProjection: { value: new THREE.Matrix4() },
        uCameraWorld: { value: new THREE.Matrix4() },
        uNear: { value: 0.12 },
        uFar: { value: 650.0 },
        uSunDirection: { value: new THREE.Vector3(0.35, 0.72, 0.58).normalize() },
        uSunColor: { value: new THREE.Color(0xfff4dd) },
        uExposure: { value: 0.84 }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor;
        uniform sampler2D tDepth;
        uniform vec2 uResolution;
        uniform float uTime;
        uniform float uWaveIntensity;
        uniform vec3 uCameraPos;
        uniform mat4 uInvProjection;
        uniform mat4 uCameraWorld;
        uniform float uNear;
        uniform float uFar;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        uniform float uExposure;

        varying vec2 vUv;

        ${TERRAIN_HEIGHT_GLSL}
        ${GERSTNER_GLSL}

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

        vec3 getWorldPosFromDepth(vec2 uv, float rawDepth, out float linearDist, out vec3 rayDirWorld) {
          vec4 ndc = vec4(uv * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
          vec4 viewPos = uInvProjection * ndc;
          viewPos /= viewPos.w;
          linearDist = length(viewPos.xyz);

          vec4 farNdc = vec4(uv * 2.0 - 1.0, 1.0, 1.0);
          vec4 farView = uInvProjection * farNdc;
          farView /= farView.w;
          vec3 rayDirView = normalize(farView.xyz);
          rayDirWorld = normalize((uCameraWorld * vec4(rayDirView, 0.0)).xyz);

          return (uCameraWorld * viewPos).xyz;
        }

        // Silky, banding-free volumetric underwater sun shafts
        vec3 computeGodRays(vec3 camPos, vec3 rayDir, float maxDist, vec3 sunDir, float time) {
          float sunElev = smoothstep(0.04, 0.34, sunDir.y);
          if (sunElev <= 0.001) return vec3(0.0);

          float marchDist = min(maxDist, 36.0);
          const int STEPS = 28;
          float stepLen = marchDist / float(STEPS);

          // Ultra-smooth spatial blue-noise-like offset (no visible pattern or grain)
          float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          float t = (0.35 + dither * 0.35) * stepLen;

          vec3 refrSun = normalize(vec3(sunDir.x * 0.72, max(sunDir.y, 0.24), sunDir.z * 0.72));
          float cosAngle = dot(rayDir, refrSun);
          float phase = 0.38 + 1.32 * pow(clamp(cosAngle * 0.5 + 0.5, 0.0, 1.0), 3.4);

          float accum = 0.0;
          for (int i = 0; i < STEPS; i++) {
            vec3 p = camPos + rayDir * t;
            float depthBelow = max(0.0, 0.15 - p.y);
            if (p.y < 0.2) {
              vec2 surfXZ = p.xz + refrSun.xz * (depthBelow / max(refrSun.y, 0.25));
              float n1 = vNoise(surfXZ * 0.38 + vec2(time * 0.15, -time * 0.22));
              float n2 = vNoise(surfXZ * 0.82 + vec2(-time * 0.19, -time * 0.13));
              float beam = smoothstep(0.46, 0.88, n1 * 0.60 + n2 * 0.52);
              beam = pow(beam, 1.85);

              float depthAtten = exp(-depthBelow * 0.135);
              float distAtten = exp(-t * 0.044);
              accum += beam * depthAtten * distAtten * stepLen;
            }
            t += stepLen;
          }

          vec3 shaftTint = mix(vec3(0.22, 0.90, 0.96), uSunColor * vec3(0.84, 1.04, 1.08), 0.45);
          return shaftTint * accum * phase * sunElev * 0.32;
        }

        // Soft 8-tap highlight bloom/halation for silky sunlit ocean glints & underwater rays
        vec3 sampleSoftBloom(vec2 uv) {
          vec2 px = 2.4 / uResolution;
          vec3 acc = vec3(0.0);
          vec2 dirs[8];
          dirs[0] = vec2( 1.0,  0.0);
          dirs[1] = vec2(-1.0,  0.0);
          dirs[2] = vec2( 0.0,  1.0);
          dirs[3] = vec2( 0.0, -1.0);
          dirs[4] = vec2( 0.707,  0.707);
          dirs[5] = vec2(-0.707,  0.707);
          dirs[6] = vec2( 0.707, -0.707);
          dirs[7] = vec2(-0.707, -0.707);

          for (int i = 0; i < 8; i++) {
            vec3 s = texture2D(tColor, clamp(uv + dirs[i] * px, 0.001, 0.999)).rgb;
            vec3 bright = max(s - vec3(1.15), vec3(0.0));
            acc += bright;
          }
          return acc * (0.125 * 0.24);
        }

        vec3 acesFilm(vec3 x) {
          float a = 2.51;
          float b = 0.03;
          float c = 2.43;
          float d = 0.59;
          float e = 0.14;
          return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }

        void main() {
          // 1. Evaluate lens near-plane world position for exact Gerstner wave waterline meniscus
          vec4 nearNdc = vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
          vec4 nearView = uInvProjection * nearNdc;
          nearView /= nearView.w;
          vec3 lensWorldPos = (uCameraWorld * nearView).xyz;

          float terrainAtCam = getTerrainHeightGLSL(lensWorldPos.xz);
          float shoalAtCam = waveShoalingFactorGLSL(terrainAtCam);
          float waveAtLens = evalWaveHeightApprox(lensWorldPos.xz, uTime, uWaveIntensity, shoalAtCam);

          float submergence = waveAtLens - lensWorldPos.y;
          float underwaterMask = smoothstep(-0.020, 0.024, submergence);

          // Meniscus surface-tension band right along the wave crossing the camera lens
          float meniscusBand = exp(-pow(submergence / 0.018, 2.0));
          float meniscusDistort = sin(submergence * 130.0) * meniscusBand * 0.008;

          // Gentle underwater refraction ripple
          vec2 rippleOffset = vec2(
            sin(vUv.y * 26.0 + uTime * 2.2) * cos(vUv.x * 18.0 - uTime * 1.5),
            cos(vUv.x * 22.0 + uTime * 1.9) * sin(vUv.y * 20.0 + uTime * 1.4)
          ) * 0.0020 * underwaterMask;

          // Subtle coastal heat-haze shimmer near distant horizon above water
          float rawDepthBase = texture2D(tDepth, vUv).r;
          float baseDist;
          vec3 rayDirWorld;
          vec3 baseWorldPos = getWorldPosFromDepth(vUv, rawDepthBase, baseDist, rayDirWorld);

          float horizonHazeMask = (1.0 - underwaterMask) *
            smoothstep(50.0, 185.0, baseDist) *
            exp(-pow((rayDirWorld.y - 0.01) / 0.055, 2.0));
          vec2 heatShimmer = vec2(
            sin(vUv.y * 85.0 + uTime * 4.2),
            cos(vUv.x * 70.0 - uTime * 3.5)
          ) * 0.00042 * horizonHazeMask;

          vec2 sampleUv = clamp(vUv + rippleOffset + vec2(0.0, meniscusDistort) + heatShimmer, 0.001, 0.999);

          float rawDepth = texture2D(tDepth, sampleUv).r;
          float linearDist;
          vec3 rayDirSample;
          vec3 worldPos = getWorldPosFromDepth(sampleUv, rawDepth, linearDist, rayDirSample);
          float sceneDist = (rawDepth >= 0.9999) ? 140.0 : linearDist;

          vec3 color;

          if (underwaterMask > 0.001) {
            vec2 fromCenter = sampleUv - 0.5;
            float edgeFactor = dot(fromCenter, fromCenter) * 2.2;
            vec2 caOffset = fromCenter * (0.0032 + edgeFactor * 0.0038) * underwaterMask;

            // Smooth 9-tap distance-weighted optical blur underwater
            float blurRadius = clamp((sceneDist - 1.8) / 26.0, 0.0, 1.0) * 2.6 * underwaterMask;
            vec2 px = blurRadius / uResolution;

            vec3 cCenter = vec3(
              texture2D(tColor, clamp(sampleUv + caOffset, 0.001, 0.999)).r,
              texture2D(tColor, sampleUv).g,
              texture2D(tColor, clamp(sampleUv - caOffset, 0.001, 0.999)).b
            );
            vec3 cBlur = cCenter * 0.28;
            cBlur += texture2D(tColor, clamp(sampleUv + vec2(px.x, 0.0), 0.001, 0.999)).rgb * 0.11;
            cBlur += texture2D(tColor, clamp(sampleUv - vec2(px.x, 0.0), 0.001, 0.999)).rgb * 0.11;
            cBlur += texture2D(tColor, clamp(sampleUv + vec2(0.0, px.y), 0.001, 0.999)).rgb * 0.11;
            cBlur += texture2D(tColor, clamp(sampleUv - vec2(0.0, px.y), 0.001, 0.999)).rgb * 0.11;
            cBlur += texture2D(tColor, clamp(sampleUv + vec2(px.x, px.y), 0.001, 0.999)).rgb * 0.07;
            cBlur += texture2D(tColor, clamp(sampleUv + vec2(-px.x, px.y), 0.001, 0.999)).rgb * 0.07;
            cBlur += texture2D(tColor, clamp(sampleUv + vec2(px.x, -px.y), 0.001, 0.999)).rgb * 0.07;
            cBlur += texture2D(tColor, clamp(sampleUv + vec2(-px.x, -px.y), 0.001, 0.999)).rgb * 0.07;

            vec3 uwCol = mix(cCenter, cBlur, clamp(blurRadius * 0.58, 0.0, 0.88));

            // Exponential Beer-Lambert optical absorption
            float camDepth = max(0.0, waveAtLens - uCameraPos.y);
            float sunElev = smoothstep(0.02, 0.35, uSunDirection.y);
            vec3 absorption = exp(-vec3(0.21, 0.064, 0.040) * min(sceneDist, 42.0));
            uwCol *= mix(vec3(1.0), absorption, 0.82);

            vec3 shallowFog = vec3(0.048, 0.45, 0.55) * (0.40 + 0.60 * sunElev);
            vec3 deepFog    = vec3(0.009, 0.125, 0.25) * (0.35 + 0.65 * sunElev);
            float deepT = clamp(camDepth / 10.5 - rayDirSample.y * 0.35, 0.0, 1.0);
            vec3 uwFogCol = mix(shallowFog, deepFog, deepT);

            float fogDensity = 0.040 + camDepth * 0.0034;
            float fogFactor = 1.0 - exp(-sceneDist * fogDensity);
            uwCol = mix(uwCol, uwFogCol, clamp(fogFactor, 0.0, 0.95));

            vec3 godRays = computeGodRays(uCameraPos, rayDirSample, sceneDist, uSunDirection, uTime);
            uwCol += godRays;

            vec3 aboveCol = texture2D(tColor, sampleUv).rgb;
            color = mix(aboveCol, uwCol, underwaterMask);
          } else {
            color = texture2D(tColor, sampleUv).rgb;
          }

          // Subtle HDR sun-glint bloom / atmospheric softness
          color += sampleSoftBloom(sampleUv);

          // Meniscus surface-tension gleam
          float meniscusHighlight = meniscusBand * smoothstep(-0.35, 0.35, waveAtLens - uCameraPos.y + 0.32);
          color = mix(color, color * 1.16 + vec3(0.16, 0.42, 0.48) * 0.45, meniscusHighlight * 0.58);

          // ACES Filmic tone mapping + sRGB gamma encoding
          color *= uExposure;
          color = acesFilm(color);
          color = pow(color, vec3(1.0 / 2.2));

          // Gentle cinematic edge vignette
          vec2 vigUv = vUv * (1.0 - vUv.yx);
          float vig = pow(clamp(vigUv.x * vigUv.y * 16.0, 0.0, 1.0), 0.12 + 0.14 * underwaterMask);
          color *= mix(0.86, 1.0, vig);

          // Store perceptual luma in alpha for FXAA 3.11 edge detection pass
          float luma = dot(color, vec3(0.299, 0.587, 0.114));
          gl_FragColor = vec4(color, luma);
        }
      `
    });

    const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMaterial);
    this.postScene.add(postQuad);

    // ==================== STAGE 3: FXAA 3.11 QUALITY ANTI-ALIASING PASS ====================
    this.fxaaMaterial = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tInput: { value: this.compositeTarget.texture },
        uTexelSize: { value: new THREE.Vector2(1 / rtW, 1 / rtH) },
        uEnabled: { value: 1.0 }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tInput;
        uniform vec2 uTexelSize;
        uniform float uEnabled;
        varying vec2 vUv;

        // High-quality FXAA 3.11 (NVIDIA edge-span search + sub-pixel anti-aliasing)
        const float EDGE_THRESHOLD_MIN = 0.0312;
        const float EDGE_THRESHOLD_MAX = 0.095;
        const float SUBPIX_QUALITY = 0.78;

        void main() {
          vec4 centerSample = texture2D(tInput, vUv);
          if (uEnabled < 0.5) {
            gl_FragColor = vec4(centerSample.rgb, 1.0);
            return;
          }

          float lumaM  = centerSample.a;
          float lumaN  = texture2D(tInput, vUv + vec2( 0.0,  uTexelSize.y)).a;
          float lumaS  = texture2D(tInput, vUv + vec2( 0.0, -uTexelSize.y)).a;
          float lumaE  = texture2D(tInput, vUv + vec2( uTexelSize.x,  0.0)).a;
          float lumaW  = texture2D(tInput, vUv + vec2(-uTexelSize.x,  0.0)).a;

          float lumaMin = min(lumaM, min(min(lumaN, lumaS), min(lumaE, lumaW)));
          float lumaMax = max(lumaM, max(max(lumaN, lumaS), max(lumaE, lumaW)));
          float lumaRange = lumaMax - lumaMin;

          // Skip flat regions cleanly
          if (lumaRange < max(EDGE_THRESHOLD_MIN, lumaMax * EDGE_THRESHOLD_MAX)) {
            gl_FragColor = vec4(centerSample.rgb, 1.0);
            return;
          }

          float lumaNW = texture2D(tInput, vUv + vec2(-uTexelSize.x,  uTexelSize.y)).a;
          float lumaNE = texture2D(tInput, vUv + vec2( uTexelSize.x,  uTexelSize.y)).a;
          float lumaSW = texture2D(tInput, vUv + vec2(-uTexelSize.x, -uTexelSize.y)).a;
          float lumaSE = texture2D(tInput, vUv + vec2( uTexelSize.x, -uTexelSize.y)).a;

          float lumaNS = lumaN + lumaS;
          float lumaEW = lumaE + lumaW;
          float lumaCornersN = lumaNW + lumaNE;
          float lumaCornersS = lumaSW + lumaSE;
          float lumaCornersE = lumaNE + lumaSE;
          float lumaCornersW = lumaNW + lumaSW;

          // Determine local edge orientation (horizontal vs vertical)
          float edgeHorz =
            abs(-2.0 * lumaW + lumaCornersW) +
            abs(-2.0 * lumaM + lumaNS) * 2.0 +
            abs(-2.0 * lumaE + lumaCornersE);
          float edgeVert =
            abs(-2.0 * lumaN + lumaCornersN) +
            abs(-2.0 * lumaM + lumaEW) * 2.0 +
            abs(-2.0 * lumaS + lumaCornersS);
          bool isHorizontal = (edgeHorz >= edgeVert);

          float luma1 = isHorizontal ? lumaS : lumaW;
          float luma2 = isHorizontal ? lumaN : lumaE;
          float grad1 = luma1 - lumaM;
          float grad2 = luma2 - lumaM;
          bool is1Steepest = abs(grad1) >= abs(grad2);
          float gradScaled = 0.25 * max(abs(grad1), abs(grad2));

          float stepLen = isHorizontal ? uTexelSize.y : uTexelSize.x;
          float lumaLocalAvg = 0.0;
          if (is1Steepest) {
            stepLen = -stepLen;
            lumaLocalAvg = 0.5 * (luma1 + lumaM);
          } else {
            lumaLocalAvg = 0.5 * (luma2 + lumaM);
          }

          vec2 curUv = vUv;
          if (isHorizontal) curUv.y += stepLen * 0.5;
          else curUv.x += stepLen * 0.5;

          // Search along the detected silhouette edge up to 10 pixels in both directions
          vec2 offset = isHorizontal ? vec2(uTexelSize.x, 0.0) : vec2(0.0, uTexelSize.y);
          vec2 uv1 = curUv - offset;
          vec2 uv2 = curUv + offset;

          float lumaEnd1 = texture2D(tInput, uv1).a - lumaLocalAvg;
          float lumaEnd2 = texture2D(tInput, uv2).a - lumaLocalAvg;
          bool reached1 = abs(lumaEnd1) >= gradScaled;
          bool reached2 = abs(lumaEnd2) >= gradScaled;
          bool reachedBoth = reached1 && reached2;

          if (!reached1) uv1 -= offset;
          if (!reached2) uv2 += offset;

          if (!reachedBoth) {
            for (int i = 0; i < 9; i++) {
              float mult = (i < 4) ? 1.0 : ((i < 7) ? 1.5 : 2.0);
              if (!reached1) {
                lumaEnd1 = texture2D(tInput, uv1).a - lumaLocalAvg;
                reached1 = abs(lumaEnd1) >= gradScaled;
              }
              if (!reached2) {
                lumaEnd2 = texture2D(tInput, uv2).a - lumaLocalAvg;
                reached2 = abs(lumaEnd2) >= gradScaled;
              }
              if (reached1 && reached2) break;
              if (!reached1) uv1 -= offset * mult;
              if (!reached2) uv2 += offset * mult;
            }
          }

          float dist1 = isHorizontal ? (vUv.x - uv1.x) : (vUv.y - uv1.y);
          float dist2 = isHorizontal ? (uv2.x - vUv.x) : (uv2.y - vUv.y);
          bool dir1 = dist1 < dist2;
          float distFinal = min(dist1, dist2);
          float edgeThickness = max(dist1 + dist2, 1e-5);
          float pixelOffset = -distFinal / edgeThickness + 0.5;

          bool isLumaCenterSmaller = lumaM < lumaLocalAvg;
          bool correctVar = ((dir1 ? lumaEnd1 : lumaEnd2) < 0.0) != isLumaCenterSmaller;
          float finalOffset = correctVar ? pixelOffset : 0.0;

          // Sub-pixel aliasing removal (smooths fine shimmering on distant palm fronds & sand)
          float lumaAvg = (1.0 / 12.0) * (2.0 * (lumaNS + lumaEW) + lumaCornersN + lumaCornersS);
          float subPix1 = clamp(abs(lumaAvg - lumaM) / lumaRange, 0.0, 1.0);
          float subPix2 = (-2.0 * subPix1 + 3.0) * subPix1 * subPix1;
          float subPixOffset = subPix2 * subPix2 * SUBPIX_QUALITY;

          finalOffset = max(finalOffset, subPixOffset);

          vec2 finalUv = vUv;
          if (isHorizontal) finalUv.y += finalOffset * stepLen;
          else finalUv.x += finalOffset * stepLen;

          vec3 finalCol = texture2D(tInput, clamp(finalUv, 0.0005, 0.9995)).rgb;
          gl_FragColor = vec4(finalCol, 1.0);
        }
      `
    });

    const fxaaQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fxaaMaterial);
    this.fxaaScene.add(fxaaQuad);
  }

  private computeTargetSize(width: number, height: number): { rtW: number; rtH: number } {
    const baseDpr = window.devicePixelRatio || 1;
    const effectiveScale = this.aaEnabled
      ? Math.min(Math.max(baseDpr, this.supersampleScale), 2.0)
      : Math.min(baseDpr, 1.5);
    return {
      rtW: Math.max(1, Math.floor(width * effectiveScale)),
      rtH: Math.max(1, Math.floor(height * effectiveScale))
    };
  }

  public get antiAliasingEnabled(): boolean {
    return this.aaEnabled;
  }

  public toggleAntiAliasing(width: number, height: number): boolean {
    this.aaEnabled = !this.aaEnabled;
    this.fxaaMaterial.uniforms.uEnabled.value = this.aaEnabled ? 1.0 : 0.0;
    this.setSize(width, height);
    return this.aaEnabled;
  }

  public setSize(width: number, height: number): void {
    const { rtW, rtH } = this.computeTargetSize(width, height);
    this.renderTarget.setSize(rtW, rtH);
    this.compositeTarget.setSize(rtW, rtH);
    this.postMaterial.uniforms.uResolution.value.set(rtW, rtH);
    this.fxaaMaterial.uniforms.uTexelSize.value.set(1 / rtW, 1 / rtH);
  }

  public render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    elapsedTime: number,
    waveIntensity: number,
    sunDirection: THREE.Vector3,
    sunColor: THREE.Color
  ): void {
    // Stage 1: Render supersampled 3D scene into HDR color + depth target
    renderer.setRenderTarget(this.renderTarget);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);

    // Stage 2: Waterline meniscus, underwater optics, volumetric god rays, bloom & ACES -> compositeTarget
    camera.updateMatrixWorld();
    this.invProj.copy(camera.projectionMatrixInverse);
    this.camWorld.copy(camera.matrixWorld);

    const u = this.postMaterial.uniforms;
    u.uTime.value = elapsedTime;
    u.uWaveIntensity.value = waveIntensity;
    u.uCameraPos.value.copy(camera.position);
    u.uInvProjection.value.copy(this.invProj);
    u.uCameraWorld.value.copy(this.camWorld);
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uSunDirection.value.copy(sunDirection);
    u.uSunColor.value.copy(sunColor);

    renderer.setRenderTarget(this.compositeTarget);
    renderer.render(this.postScene, this.postCamera);

    // Stage 3: FXAA 3.11 edge smoothing & sub-pixel AA directly to screen
    renderer.setRenderTarget(null);
    renderer.render(this.fxaaScene, this.postCamera);
  }

  public dispose(): void {
    this.renderTarget.depthTexture?.dispose();
    this.renderTarget.dispose();
    this.compositeTarget.dispose();
    this.postMaterial.dispose();
    this.fxaaMaterial.dispose();
  }
}
