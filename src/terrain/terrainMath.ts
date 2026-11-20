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
 * Deterministic sculpted crescent bay heightfield.
 * -z: inland beach & dunes | 0: shoreline | +z: shallow sandbar & seabed drop-off
 * Matches TERRAIN_HEIGHT_GLSL below so water depth absorption, shore foam, and
 * wet-sand transition align seamlessly with the 3D terrain mesh.
 */
export function getTerrainHeight(x: number, z: number): number {
  // Crescent cove shoreline curve (pushes seaward on flanks)
  const bayCurve = 0.0042 * x * x - 1.15 * Math.sin(x * 0.065) - 0.55 * Math.cos(x * 0.13);
  const s = z - bayCurve; // signed distance seaward from nominal waterline

  let h = 0;

  if (s < 0) {
    // Beach slope inland: gentle foreshore rising into sculpted rolling dunes
    const d = -s;
    const beachSlope = d * 0.105 + 0.0014 * d * d;
    const duneEnvelope = smoothstep(14.0, 34.0, d);
    const dunes =
      duneEnvelope *
      (2.4 +
        1.55 * Math.sin(x * 0.085 + 0.7) * Math.cos(z * 0.095) +
        0.95 * Math.sin(x * 0.17 - z * 0.12) +
        0.45 * Math.cos(x * 0.29 + z * 0.21));
    h = beachSlope + dunes;
  } else {
    // Seaward profile: smooth wading slope -> gentle sandbar -> deep seabed drop-off
    const shallowSlope = -s * 0.082;
    const sandbar = 0.42 * Math.exp(-Math.pow((s - 13.5) / 5.4, 2));
    const dropoff = -11.8 * smoothstep(17.0, 62.0, s) - 4.0 * smoothstep(62.0, 125.0, s);
    // Subtle organic seabed undulations & reef mounds
    const seabedMounds =
      smoothstep(8.0, 26.0, s) *
      (0.45 * Math.sin(x * 0.12 + z * 0.11) + 0.28 * Math.cos(x * 0.21 - z * 0.18));
    h = shallowSlope + sandbar + dropoff + seabedMounds;
  }

  // Flanking coastal headlands at |x| > 36
  const flankMask = smoothstep(34.0, 66.0, Math.abs(x)) * (1.0 - smoothstep(26.0, 62.0, s));
  const headland =
    flankMask *
    (5.2 + 1.8 * Math.sin(x * 0.14 + z * 0.16) + 0.9 * Math.cos(x * 0.28 - z * 0.22));
  h += headland;

  // Fine natural beach micro-undulation
  const micro =
    0.09 * Math.sin(x * 0.24 + z * 0.19) +
    0.045 * Math.cos(x * 0.51 - z * 0.43);
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

  // Keep actor inside playable cove perimeter
  pos.x = THREE.MathUtils.clamp(pos.x, -56, 56);
  pos.z = THREE.MathUtils.clamp(pos.z, -42, 78);
}

/**
 * Matching GLSL terrain height function so the Ocean shader and Footprint RTT
 * decay shader know the exact seabed/beach elevation at any world (x, z).
 */
export const TERRAIN_HEIGHT_GLSL = /* glsl */ `
float getTerrainHeightGLSL(vec2 xz) {
  float x = xz.x;
  float z = xz.y;
  float bayCurve = 0.0042 * x * x - 1.15 * sin(x * 0.065) - 0.55 * cos(x * 0.13);
  float s = z - bayCurve;
  float h = 0.0;

  if (s < 0.0) {
    float d = -s;
    float beachSlope = d * 0.105 + 0.0014 * d * d;
    float duneEnvelope = smoothstep(14.0, 34.0, d);
    float dunes = duneEnvelope * (
      2.4 +
      1.55 * sin(x * 0.085 + 0.7) * cos(z * 0.095) +
      0.95 * sin(x * 0.17 - z * 0.12) +
      0.45 * cos(x * 0.29 + z * 0.21)
    );
    h = beachSlope + dunes;
  } else {
    float shallowSlope = -s * 0.082;
    float sd = (s - 13.5) / 5.4;
    float sandbar = 0.42 * exp(-sd * sd);
    float dropoff = -11.8 * smoothstep(17.0, 62.0, s) - 4.0 * smoothstep(62.0, 125.0, s);
    float seabedMounds = smoothstep(8.0, 26.0, s) * (
      0.45 * sin(x * 0.12 + z * 0.11) +
      0.28 * cos(x * 0.21 - z * 0.18)
    );
    h = shallowSlope + sandbar + dropoff + seabedMounds;
  }

  float flankMask = smoothstep(34.0, 66.0, abs(x)) * (1.0 - smoothstep(26.0, 62.0, s));
  float headland = flankMask * (
    5.2 + 1.8 * sin(x * 0.14 + z * 0.16) + 0.9 * cos(x * 0.28 - z * 0.22)
  );
  h += headland;

  float micro = 0.09 * sin(x * 0.24 + z * 0.19) + 0.045 * cos(x * 0.51 - z * 0.43);
  return h + micro;
}
`;
