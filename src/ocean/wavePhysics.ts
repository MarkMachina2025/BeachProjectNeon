import * as THREE from 'three';

export interface GerstnerWaveSpec {
  dirX: number;
  dirZ: number;
  steepness: number;
  wavelength: number;
  speedScale: number;
}

/**
 * 6-component directional Gerstner wave spectrum rolling shoreward (-Z)
 * with realistic coastal refraction and cross-swell chop.
 * Identical constants are compiled into both CPU physics and GLSL shaders
 * so player buoyancy, camera waterline meniscus, wet-sand wash, and ocean
 * surface vertices match accurately.
 */
export const GERSTNER_WAVES: readonly GerstnerWaveSpec[] = [
  { dirX: 0.14, dirZ: -0.99, steepness: 0.22, wavelength: 24.0, speedScale: 1.0 },
  { dirX: -0.26, dirZ: -0.965, steepness: 0.16, wavelength: 15.5, speedScale: 1.06 },
  { dirX: 0.42, dirZ: -0.907, steepness: 0.12, wavelength: 9.8, speedScale: 1.12 },
  { dirX: -0.55, dirZ: -0.835, steepness: 0.09, wavelength: 6.2, speedScale: 1.18 },
  { dirX: 0.72, dirZ: -0.694, steepness: 0.06, wavelength: 3.9, speedScale: 1.24 },
  { dirX: -0.18, dirZ: -0.984, steepness: 0.05, wavelength: 2.5, speedScale: 1.3 }
];

const GRAVITY = 9.81;

export interface WaveSample {
  height: number;
  normal: THREE.Vector3;
  foam: number;
  swellPhase: number;
}

/**
 * Smooth coastal shoaling factor: waves calm slightly on very shallow wet sand
 * while gently steepening in the surf zone.
 */
export function waveShoalingFactor(terrainHeight: number): number {
  const depth = -terrainHeight;
  if (depth <= -0.6) return 0.18;
  const t = THREE.MathUtils.clamp((depth + 0.6) / 2.8, 0, 1);
  return 0.22 + 0.78 * (t * t * (3 - 2 * t));
}

const _normalOut = new THREE.Vector3();

/**
 * Evaluates the Gerstner wave height and surface normal at world (x, z).
 * Uses a 1-step horizontal pre-offset so vertical height closely tracks the
 * laterally displaced GPU Gerstner mesh.
 */
export function sampleWaveHeight(
  x: number,
  z: number,
  time: number,
  intensity = 1.0,
  terrainHeight = -3.0
): number {
  const shoal = waveShoalingFactor(terrainHeight);
  const scale = intensity * shoal;

  let dx = 0;
  let dz = 0;
  for (let i = 0; i < GERSTNER_WAVES.length; i++) {
    const w = GERSTNER_WAVES[i];
    const k = (Math.PI * 2) / w.wavelength;
    const c = Math.sqrt(GRAVITY / k) * w.speedScale;
    const a = (w.steepness * scale * 0.42) / k;
    const f = k * (w.dirX * x + w.dirZ * z - c * time);
    const cosF = Math.cos(f);
    dx += w.dirX * (a * cosF);
    dz += w.dirZ * (a * cosF);
  }

  // Re-evaluate at pre-displaced horizontal position for accurate vertical lookup
  const px = x - dx * 0.75;
  const pz = z - dz * 0.75;
  let y = 0;
  for (let i = 0; i < GERSTNER_WAVES.length; i++) {
    const w = GERSTNER_WAVES[i];
    const k = (Math.PI * 2) / w.wavelength;
    const c = Math.sqrt(GRAVITY / k) * w.speedScale;
    const a = (w.steepness * scale * 0.42) / k;
    const f = k * (w.dirX * px + w.dirZ * pz - c * time);
    y += a * Math.sin(f);
  }

  // Gentle rhythmic shore swash tide pulse
  const swash = Math.sin(time * 0.58 + x * 0.045) * 0.085 * intensity;
  return y + swash;
}

export function sampleWave(
  x: number,
  z: number,
  time: number,
  intensity = 1.0,
  terrainHeight = -3.0,
  outNormal?: THREE.Vector3
): WaveSample {
  const eps = 0.22;
  const h = sampleWaveHeight(x, z, time, intensity, terrainHeight);
  const hx = sampleWaveHeight(x + eps, z, time, intensity, terrainHeight);
  const hz = sampleWaveHeight(x, z + eps, time, intensity, terrainHeight);

  const normal = outNormal ?? _normalOut;
  normal.set(-(hx - h) / eps, 1.0, -(hz - h) / eps).normalize();

  // Primary swell phase (0..1) for audio wave-swell synchronization
  const primary = GERSTNER_WAVES[0];
  const k0 = (Math.PI * 2) / primary.wavelength;
  const c0 = Math.sqrt(GRAVITY / k0) * primary.speedScale;
  const f0 = k0 * (primary.dirX * x + primary.dirZ * z - c0 * time);
  const swellPhase = 0.5 + 0.5 * Math.sin(f0);
  const foam = THREE.MathUtils.clamp((h * 2.2 + (1.0 - normal.y) * 4.5), 0, 1);

  return { height: h, normal, foam, swellPhase };
}

/**
 * Shared GLSL snippet defining the exact same 6-wave Gerstner displacement
 * and height query for OceanSystem, Terrain wet-swash, and UnderwaterPostProcess.
 */
export const GERSTNER_GLSL = /* glsl */ `
const int NUM_WAVES = 6;

void getWaveParams(int i, out vec2 dir, out float steep, out float wavelength, out float speedScale) {
  if (i == 0) { dir = vec2(0.14, -0.99);  steep = 0.22; wavelength = 24.0; speedScale = 1.00; }
  else if (i == 1) { dir = vec2(-0.26, -0.965); steep = 0.16; wavelength = 15.5; speedScale = 1.06; }
  else if (i == 2) { dir = vec2(0.42, -0.907);  steep = 0.12; wavelength = 9.8;  speedScale = 1.12; }
  else if (i == 3) { dir = vec2(-0.55, -0.835); steep = 0.09; wavelength = 6.2;  speedScale = 1.18; }
  else if (i == 4) { dir = vec2(0.72, -0.694);  steep = 0.06; wavelength = 3.9;  speedScale = 1.24; }
  else             { dir = vec2(-0.18, -0.984); steep = 0.05; wavelength = 2.5;  speedScale = 1.30; }
}

float waveShoalingFactorGLSL(float terrainHeight) {
  float depth = -terrainHeight;
  float t = clamp((depth + 0.6) / 2.8, 0.0, 1.0);
  return 0.22 + 0.78 * (t * t * (3.0 - 2.0 * t));
}

vec3 evalGerstnerDisplacement(
  vec2 xz,
  float time,
  float intensity,
  float shoal,
  out vec3 outNormal,
  out float outCrest
) {
  float scale = intensity * shoal;
  vec3 disp = vec3(0.0);
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  float crest = 0.0;

  for (int i = 0; i < NUM_WAVES; i++) {
    vec2 d;
    float steep;
    float wl;
    float sScale;
    getWaveParams(i, d, steep, wl, sScale);
    float k = 6.28318530718 / wl;
    float c = sqrt(9.81 / k) * sScale;
    float f = k * (dot(d, xz) - c * time);
    float a = (steep * scale * 0.42) / k;
    float q = steep * scale * 0.42;

    float cosF = cos(f);
    float sinF = sin(f);

    disp.x += d.x * (a * cosF);
    disp.y += a * sinF;
    disp.z += d.y * (a * cosF);

    tangent += vec3(
      -d.x * d.x * (q * sinF),
      d.x * (q * cosF),
      -d.x * d.y * (q * sinF)
    );
    binormal += vec3(
      -d.x * d.y * (q * sinF),
      d.y * (q * cosF),
      -d.y * d.y * (q * sinF)
    );

    crest += max(0.0, sinF) * steep * scale;
  }

  float swash = sin(time * 0.58 + xz.x * 0.045) * 0.085 * intensity;
  disp.y += swash;

  outNormal = normalize(cross(binormal, tangent));
  outCrest = crest;
  return disp;
}

float evalWaveHeightApprox(vec2 xz, float time, float intensity, float shoal) {
  float scale = intensity * shoal;
  vec2 dOff = vec2(0.0);
  for (int i = 0; i < NUM_WAVES; i++) {
    vec2 d;
    float steep;
    float wl;
    float sScale;
    getWaveParams(i, d, steep, wl, sScale);
    float k = 6.28318530718 / wl;
    float c = sqrt(9.81 / k) * sScale;
    float f = k * (dot(d, xz) - c * time);
    float a = (steep * scale * 0.42) / k;
    dOff += d * (a * cos(f));
  }
  vec2 p = xz - dOff * 0.75;
  float y = 0.0;
  for (int i = 0; i < NUM_WAVES; i++) {
    vec2 d;
    float steep;
    float wl;
    float sScale;
    getWaveParams(i, d, steep, wl, sScale);
    float k = 6.28318530718 / wl;
    float c = sqrt(9.81 / k) * sScale;
    float f = k * (dot(d, p) - c * time);
    float a = (steep * scale * 0.42) / k;
    y += a * sin(f);
  }
  float swash = sin(time * 0.58 + xz.x * 0.045) * 0.085 * intensity;
  return y + swash;
}
`;
