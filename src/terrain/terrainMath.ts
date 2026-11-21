import * as THREE from 'three';

export interface CylinderCollider {
  x: number;
  z: number;
  radius: number;
  height: number;
}

export const WORLD_COLLIDERS: CylinderCollider[] = [];

export function clearColliders(): void {
  WORLD_COLLIDERS.length = 0;
}

export function addCollider(x: number, z: number, radius: number, height = 3.0): void {
  WORLD_COLLIDERS.push({ x, z, radius, height });
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Expanded (+50% larger) sculpted crescent coastal bay heightfield.
 * Playable sandy cove spans ~172m wide (X: [-86, +86]), deep golden beach & dunes
 * inland to Z = -64, and gradual sandbar -> deep diving reef out to Z = +118.
 * Matches TERRAIN_HEIGHT_GLSL below for exact water depth absorption & wet shoreline sync.
 */
export function getTerrainHeight(x: number, z: number): number {
  // Broad sweeping crescent cove curve (~50% wider bay)
  const bayCurve = 0.0022 * x * x - 1.35 * Math.sin(x * 0.044) - 0.65 * Math.cos(x * 0.09);
  const s = z - bayCurve; // signed distance seaward from nominal waterline

  let h = 0;

  if (s < 0) {
    // Expansive sunlit foreshore & wide golden beach rising into rolling coastal dunes
    const d = -s;
    const beachSlope = d * 0.088 + 0.00085 * d * d;
    const duneEnvelope = smoothstep(22.0, 48.0, d);
    const dunes =
      duneEnvelope *
      (2.9 +
        1.75 * Math.sin(x * 0.065 + 0.7) * Math.cos(z * 0.075) +
        1.05 * Math.sin(x * 0.13 - z * 0.10) +
        0.48 * Math.cos(x * 0.24 + z * 0.18));
    h = beachSlope + dunes;
  } else {
    // Seaward profile: broad crystal wading shallows -> gentle sandbar -> deep reef drop-off
    const shallowSlope = -s * 0.072;
    const sandbar = 0.48 * Math.exp(-Math.pow((s - 18.0) / 7.2, 2));
    const dropoff = -12.8 * smoothstep(23.0, 78.0, s) - 4.5 * smoothstep(78.0, 155.0, s);
    const seabedMounds =
      smoothstep(10.0, 32.0, s) *
      (0.52 * Math.sin(x * 0.10 + z * 0.095) + 0.30 * Math.cos(x * 0.19 - z * 0.16));
    h = shallowSlope + sandbar + dropoff + seabedMounds;
  }

  // Flanking coastal sandstone headlands at |x| > 54 framing the larger cove
  const flankMask = smoothstep(52.0, 96.0, Math.abs(x)) * (1.0 - smoothstep(36.0, 84.0, s));
  const headland =
    flankMask *
    (6.2 + 2.1 * Math.sin(x * 0.11 + z * 0.13) + 1.0 * Math.cos(x * 0.24 - z * 0.19));
  h += headland;

  // Fine natural coastal sand undulation
  const micro =
    0.085 * Math.sin(x * 0.21 + z * 0.17) +
    0.042 * Math.cos(x * 0.46 - z * 0.39);
  h += micro;

  return h;
}

const _normTmp = new THREE.Vector3();

export function getTerrainNormal(x: number, z: number, target?: THREE.Vector3): THREE.Vector3 {
  const eps = 0.35;
  const hL = getTerrainHeight(x - eps, z);
  const hR = getTerrainHeight(x + eps, z);
  const hD = getTerrainHeight(x, z - eps);
  const hU = getTerrainHeight(x, z + eps);
  const out = target ?? _normTmp;
  return out.set(hL - hR, 2.0 * eps, hD - hU).normalize();
}

/**
 * Resolves horizontal collisions against static beach props and coastal boulders.
 */
export function resolveWorldCollisions(
  pos: THREE.Vector3,
  actorRadius: number,
  actorHeight = 1.75
): void {
  for (let i = 0; i < WORLD_COLLIDERS.length; i++) {
    const c = WORLD_COLLIDERS[i];
    const groundY = getTerrainHeight(c.x, c.z);
    if (pos.y > groundY + c.height || pos.y + actorHeight < groundY - 0.5) continue;
    const dx = pos.x - c.x;
    const dz = pos.z - c.z;
    const minDist = c.radius + actorRadius;
    const distSq = dx * dx + dz * dz;
    if (distSq < minDist * minDist && distSq > 1e-6) {
      const dist = Math.sqrt(distSq);
      const push = minDist - dist;
      pos.x += (dx / dist) * push;
      pos.z += (dz / dist) * push;
    }
  }

  // Expanded (+50%) playable cove perimeter
  pos.x = THREE.MathUtils.clamp(pos.x, -84, 84);
  pos.z = THREE.MathUtils.clamp(pos.z, -62, 112);
}

/**
 * Matching GLSL terrain height function for Ocean depth absorption, shore foam,
 * waterline intersection, and Footprint RTT wave-wash decay.
 */
export const TERRAIN_HEIGHT_GLSL = /* glsl */ `
float getTerrainHeightGLSL(vec2 xz) {
  float x = xz.x;
  float z = xz.y;
  float bayCurve = 0.0022 * x * x - 1.35 * sin(x * 0.044) - 0.65 * cos(x * 0.09);
  float s = z - bayCurve;
  float h = 0.0;

  if (s < 0.0) {
    float d = -s;
    float beachSlope = d * 0.088 + 0.00085 * d * d;
    float duneEnvelope = smoothstep(22.0, 48.0, d);
    float dunes = duneEnvelope * (
      2.9 +
      1.75 * sin(x * 0.065 + 0.7) * cos(z * 0.075) +
      1.05 * sin(x * 0.13 - z * 0.10) +
      0.48 * cos(x * 0.24 + z * 0.18)
    );
    h = beachSlope + dunes;
  } else {
    float shallowSlope = -s * 0.072;
    float sd = (s - 18.0) / 7.2;
    float sandbar = 0.48 * exp(-sd * sd);
    float dropoff = -12.8 * smoothstep(23.0, 78.0, s) - 4.5 * smoothstep(78.0, 155.0, s);
    float seabedMounds = smoothstep(10.0, 32.0, s) * (
      0.52 * sin(x * 0.10 + z * 0.095) +
      0.30 * cos(x * 0.19 - z * 0.16)
    );
    h = shallowSlope + sandbar + dropoff + seabedMounds;
  }

  float flankMask = smoothstep(52.0, 96.0, abs(x)) * (1.0 - smoothstep(36.0, 84.0, s));
  float headland = flankMask * (
    6.2 + 2.1 * sin(x * 0.11 + z * 0.13) + 1.0 * cos(x * 0.24 - z * 0.19)
  );
  h += headland;

  float micro = 0.085 * sin(x * 0.21 + z * 0.17) + 0.042 * cos(x * 0.46 - z * 0.39);
  return h + micro;
}
`;
