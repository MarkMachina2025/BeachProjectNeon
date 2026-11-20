import * as THREE from 'three';

function createAtmosphericSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uSunDirection: { value: new THREE.Vector3(0.35, 0.72, 0.58).normalize() },
      uZenithColor: { value: new THREE.Color(0x0b4c9c) },
      uHorizonColor: { value: new THREE.Color(0x6bb8e6) },
      uSunColor: { value: new THREE.Color(0xfff3dc) },
      uTime: { value: 0 }
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(position);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDirection;
      uniform vec3 uZenithColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uSunColor;
      uniform float uTime;
      varying vec3 vWorldDir;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float noise2(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
          mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }

      float fbmClouds(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
        for (int i = 0; i < 4; i++) {
          v += a * noise2(p);
          p = m * p * 2.05;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 dir = normalize(vWorldDir);
        vec3 sunDir = normalize(uSunDirection);
        float y = clamp(dir.y, 0.0, 1.0);

        // Smooth Rayleigh sky dome gradient from coastal horizon to deep zenith
        vec3 sky = mix(uHorizonColor, uZenithColor, pow(y, 0.52));

        // Subtle warm Mie atmospheric haze halo toward the sun
        float sunCos = max(dot(dir, sunDir), 0.0);
        float mieGlow = pow(sunCos, 6.0) * 0.32 + pow(sunCos, 42.0) * 0.45;
        float lowSun = 1.0 - smoothstep(0.08, 0.52, sunDir.y);
        sky += uSunColor * mieGlow * (0.65 + 0.85 * lowSun);

        // Crisp glowing solar disc with soft corona
        float sunDisc = smoothstep(0.9991, 0.99965, dot(dir, sunDir));
        float sunCorona = pow(sunCos, 320.0) * 1.4;
        sky += uSunColor * (sunCorona + sunDisc * 4.2);

        // Delicate high-altitude sunlit coastal cirrus clouds
        if (dir.y > 0.03) {
          vec2 cloudUv = dir.xz / (dir.y + 0.18) * 1.15 + vec2(uTime * 0.004, -uTime * 0.002);
          float c1 = fbmClouds(cloudUv);
          float c2 = fbmClouds(cloudUv * 2.3 + vec2(4.1, -2.7));
          float cloudMask = smoothstep(0.56, 0.84, c1 * 0.72 + c2 * 0.35);
          cloudMask *= smoothstep(0.03, 0.22, dir.y) * smoothstep(0.96, 0.45, dir.y);
          vec3 cloudLit = mix(vec3(0.85, 0.90, 0.96), uSunColor * 1.22, 0.35 + 0.55 * pow(sunCos, 3.0) + 0.25 * lowSun);
          sky = mix(sky, cloudLit, cloudMask * 0.48);
        }

        // Below horizon dark coastal bounce for clean PMREM reflections
        if (dir.y < 0.0) {
          sky = mix(uHorizonColor * 0.65, vec3(0.04, 0.14, 0.22), clamp(-dir.y * 4.0, 0.0, 1.0));
        }

        gl_FragColor = vec4(sky, 1.0);
      }
    `
  });
}

/**
 * Calibrated physically inspired atmospheric sky dome with glowing sun disc,
 * high-altitude wispy clouds, dynamic PMREM environment reflections, soft directional
 * sunlight shadows that track the player without shimmer, and coastal horizon fog.
 */
export class AtmosphereSystem {
  public readonly sky: THREE.Mesh;
  public readonly sunLight: THREE.DirectionalLight;
  public readonly hemiLight: THREE.HemisphereLight;
  public readonly sunDirection = new THREE.Vector3(0.35, 0.72, 0.58).normalize();
  public readonly sunColor = new THREE.Color(0xfff4df);
  public readonly skyZenith = new THREE.Color(0x0b4c9c);
  public readonly skyHorizon = new THREE.Color(0x6bb8e6);
  public readonly fogColor = new THREE.Color(0x8bcbe8);

  private readonly skyMat: THREE.ShaderMaterial;
  private readonly envSkyMat: THREE.ShaderMaterial;
  private readonly pmremGenerator: THREE.PMREMGenerator;
  private readonly envScene: THREE.Scene;
  private envRenderTarget: THREE.WebGLRenderTarget | null = null;
  private lastEnvUpdateTime = -10;
  private envDirty = true;
  private readonly scene: THREE.Scene;

  private sunProgress = 48;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.scene = scene;

    const skyGeo = new THREE.SphereGeometry(520, 32, 20);
    this.skyMat = createAtmosphericSkyMaterial();
    this.sky = new THREE.Mesh(skyGeo, this.skyMat);
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    // Offscreen sky scene for clean PMREM IBL environment reflection capture
    this.pmremGenerator = new THREE.PMREMGenerator(renderer);
    this.pmremGenerator.compileEquirectangularShader();
    this.envScene = new THREE.Scene();
    this.envSkyMat = createAtmosphericSkyMaterial();
    const envMesh = new THREE.Mesh(new THREE.SphereGeometry(60, 24, 16), this.envSkyMat);
    this.envScene.add(envMesh);

    // Primary sunlight with crisp PCF soft shadows
    this.sunLight = new THREE.DirectionalLight(0xfff5e4, 2.4);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 160;
    const d = 42;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.00045;
    this.sunLight.shadow.normalBias = 0.025;
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    // Sky-to-warm-sand hemisphere bounce fill
    this.hemiLight = new THREE.HemisphereLight(0x7ac2f0, 0x9e7d52, 0.55);
    scene.add(this.hemiLight);

    // Subtle coastal horizon atmospheric fog
    scene.fog = new THREE.FogExp2(this.fogColor.getHex(), 0.0018);

    this.setSunProgress(this.sunProgress, true);
  }

  public getLabel(): string {
    if (this.sunProgress < 20) return 'Dawn';
    if (this.sunProgress < 38) return 'Morning';
    if (this.sunProgress < 64) return 'Midday';
    if (this.sunProgress < 84) return 'Golden Hour';
    return 'Sunset';
  }

  public setSunProgress(progress: number, immediateEnv = false): void {
    this.sunProgress = THREE.MathUtils.clamp(progress, 0, 100);
    const t = this.sunProgress / 100;

    const elevationDeg =
      t < 0.5
        ? THREE.MathUtils.lerp(11, 58, Math.sin(t * Math.PI))
        : THREE.MathUtils.lerp(58, 6.5, Math.pow((t - 0.5) * 2.0, 1.15));
    const azimuthDeg = THREE.MathUtils.lerp(-54, 46, t);

    const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
    const theta = THREE.MathUtils.degToRad(azimuthDeg);
    this.sunDirection.set(
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.cos(theta)
    ).normalize();

    const lowSun = 1.0 - THREE.MathUtils.smoothstep(elevationDeg, 6, 36);

    const middaySun = new THREE.Color(0xfff3da);
    const sunsetSun = new THREE.Color(0xff8942);
    this.sunColor.copy(middaySun).lerp(sunsetSun, lowSun * 0.94);

    this.sunLight.color.copy(this.sunColor);
    this.sunLight.intensity = THREE.MathUtils.lerp(2.45, 1.65, lowSun);

    // Rich calibrated linear-friendly coastal sky gradients
    const dayZenith = new THREE.Color(0x0b4b9e);
    const duskZenith = new THREE.Color(0x1b2c66);
    this.skyZenith.copy(dayZenith).lerp(duskZenith, lowSun * 0.88);

    const dayHorizon = new THREE.Color(0x6bbbe8);
    const duskHorizon = new THREE.Color(0xf08c54);
    this.skyHorizon.copy(dayHorizon).lerp(duskHorizon, lowSun * 0.94);

    const syncSky = (mat: THREE.ShaderMaterial) => {
      mat.uniforms.uSunDirection.value.copy(this.sunDirection);
      mat.uniforms.uZenithColor.value.copy(this.skyZenith);
      mat.uniforms.uHorizonColor.value.copy(this.skyHorizon);
      mat.uniforms.uSunColor.value.copy(this.sunColor);
    };
    syncSky(this.skyMat);
    syncSky(this.envSkyMat);

    this.fogColor.copy(this.skyHorizon).lerp(new THREE.Color(0x9bd3ef), 0.2 * (1 - lowSun));
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(this.fogColor);
      this.scene.fog.density = THREE.MathUtils.lerp(0.0017, 0.0029, lowSun);
    }

    this.hemiLight.color.copy(this.skyHorizon);
    this.hemiLight.groundColor.setHex(0xc8a472).lerp(new THREE.Color(0x7c543c), lowSun * 0.65);
    this.hemiLight.intensity = THREE.MathUtils.lerp(0.86, 0.58, lowSun);

    this.envDirty = true;
    if (immediateEnv) {
      this.refreshEnvironmentMap(0);
    }
  }

  public refreshEnvironmentMap(elapsedTime: number): void {
    if (!this.envDirty) return;
    if (elapsedTime - this.lastEnvUpdateTime < 0.14 && this.envRenderTarget) return;

    const nextRT = this.pmremGenerator.fromScene(this.envScene, 0.035);
    if (this.envRenderTarget) {
      this.envRenderTarget.dispose();
    }
    this.envRenderTarget = nextRT;
    this.scene.environment = nextRT.texture;
    this.scene.environmentIntensity = 0.62;
    this.lastEnvUpdateTime = elapsedTime;
    this.envDirty = false;
  }

  public update(elapsedTime: number, focusPos: THREE.Vector3): void {
    this.skyMat.uniforms.uTime.value = elapsedTime;
    this.refreshEnvironmentMap(elapsedTime);

    const snap = 0.5;
    const fx = Math.round(focusPos.x / snap) * snap;
    const fz = Math.round(focusPos.z / snap) * snap;
    const fy = Math.max(0, Math.round(focusPos.y / snap) * snap);

    this.sunLight.target.position.set(fx, fy, fz);
    this.sunLight.position
      .copy(this.sunDirection)
      .multiplyScalar(72)
      .add(this.sunLight.target.position);
  }

  public dispose(): void {
    this.envRenderTarget?.dispose();
    this.pmremGenerator.dispose();
    this.skyMat.dispose();
    this.envSkyMat.dispose();
  }
}
