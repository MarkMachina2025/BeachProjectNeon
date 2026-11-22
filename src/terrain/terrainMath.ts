import * as THREE from 'three';

export interface CylinderCollider {
  x: number;
  z: number;
  radius: number;
  height: number;
}

export interface BoxCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

export interface OrientedBoxCollider {
  id?: string;
  cx: number;
  cz: number;
  halfW: number;
  halfL: number;
  cosY: number;
  sinY: number;
  minY: number;
  maxY: number;
}

export interface WalkableDeck {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Either constant height or linear ramp along Z/X */
  getY: (x: number, z: number) => number;
  surface: 'wood' | 'sand';
}

export const WORLD_COLLIDERS: CylinderCollider[] = [];
export const WORLD_BOX_COLLIDERS: BoxCollider[] = [];
export const WORLD_OBB_COLLIDERS: OrientedBoxCollider[] = [];
export const WALKABLE_DECKS: WalkableDeck[] = [];

export function clearColliders(): void {
  WORLD_COLLIDERS.length = 0;
  WORLD_BOX_COLLIDERS.length = 0;
  WORLD_OBB_COLLIDERS.length = 0;
  WALKABLE_DECKS.length = 0;
}

export function addCollider(x: number, z: number, radius: number, height = 3.0): void {
  WORLD_COLLIDERS.push({ x, z, radius, height });
}

export function addBoxCollider(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  minY: number,
  maxY: number
): void {
  WORLD_BOX_COLLIDERS.push({ minX, maxX, minZ, maxZ, minY, maxY });
}

export function addOrientedBoxCollider(
  cx: number,
  cz: number,
  halfW: number,
  halfL: number,
  yaw: number,
  minY: number,
  maxY: number,
  id?: string
): OrientedBoxCollider {
  const obb: OrientedBoxCollider = {
    id,
    cx,
    cz,
    halfW,
    halfL,
    cosY: Math.cos(yaw),
    sinY: Math.sin(yaw),
    minY,
    maxY
  };
  WORLD_OBB_COLLIDERS.push(obb);
  return obb;
}

export function updateOrientedBoxCollider(
  id: string,
  cx: number,
  cz: number,
  yaw: number,
  minY: number,
  maxY: number
): void {
  for (let i = 0; i < WORLD_OBB_COLLIDERS.length; i++) {
    const o = WORLD_OBB_COLLIDERS[i];
    if (o.id === id) {
      o.cx = cx;
      o.cz = cz;
      o.cosY = Math.cos(yaw);
      o.sinY = Math.sin(yaw);
      o.minY = minY;
      o.maxY = maxY;
      return;
    }
  }
}

export function addWalkableDeck(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  yOrFn: number | ((x: number, z: number) => number),
  surface: 'wood' | 'sand' = 'wood'
): void {
  WALKABLE_DECKS.push({
    minX,
    maxX,
    minZ,
    maxZ,
    getY: typeof yOrFn === 'number' ? () => yOrFn : yOrFn,
    surface
  });
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Large sweeping tropical resort bay heightfield (~230m wide x 200m deep playable area).
 * - Broad sunlit beach from Z = -4 to Z = -32
 * - Gentle coastal promenade ridge around Z = -25 (Boardwalk, Neon Tiki Surf Bar, Patio, Lifeguard Tower)
 * - Lush rolling coastal dunes behind Z = -34..-76
 * - Crystal shallow surf & swimming bay (Z = 0..+24) -> gradual deep diving reef (Z = +24..+125)
 */
export function getTerrainHeight(x: number, z: number): number {
  const bayCurve = 0.0014 * x * x - 1.25 * Math.sin(x * 0.036) - 0.55 * Math.cos(x * 0.075);
  const s = z - bayCurve;

  let h = 0;

  if (s < 0) {
    const d = -s;
    const beachSlope = d * 0.078 + 0.00055 * d * d;
    const duneEnvelope = smoothstep(28.0, 56.0, d);
    const dunes =
      duneEnvelope *
      (3.4 +
        1.9 * Math.sin(x * 0.055 + 0.7) * Math.cos(z * 0.068) +
        1.15 * Math.sin(x * 0.11 - z * 0.09) +
        0.50 * Math.cos(x * 0.21 + z * 0.16));
    // Sweeping far coastal backdrop hills behind Z = -55 so ocean never clips behind dunes on aerial views
    const backRidge =
      smoothstep(52.0, 108.0, d) *
      (13.5 + 3.2 * Math.sin(x * 0.042 + 1.1) + 1.8 * Math.cos(x * 0.088 - z * 0.04));
    h = beachSlope + dunes + backRidge;
  } else {
    const shallowSlope = -s * 0.068;
    const sandbar = 0.45 * Math.exp(-Math.pow((s - 20.0) / 8.0, 2));
    const dropoff = -13.2 * smoothstep(26.0, 86.0, s) - 4.8 * smoothstep(86.0, 165.0, s);
    const seabedMounds =
      smoothstep(12.0, 36.0, s) *
      (0.55 * Math.sin(x * 0.09 + z * 0.09) + 0.30 * Math.cos(x * 0.17 - z * 0.15));
    h = shallowSlope + sandbar + dropoff + seabedMounds;
  }

  // Sweeping flanking coastal headlands at |x| > 72
  const flankMask = smoothstep(70.0, 125.0, Math.abs(x)) * (1.0 - smoothstep(42.0, 96.0, s));
  const headland =
    flankMask *
    (7.2 + 2.2 * Math.sin(x * 0.09 + z * 0.11) + 1.0 * Math.cos(x * 0.20 - z * 0.17));
  h += headland;

  const micro =
    0.075 * Math.sin(x * 0.19 + z * 0.16) +
    0.036 * Math.cos(x * 0.42 - z * 0.35);
  h += micro;

  return h;
}

/**
 * Returns the highest walkable surface under (x, z) reachable from currentY (step-up <= 0.65m),
 * supporting the wooden boardwalk, 28m ocean pier, Tiki Surf Bar deck, and Lifeguard stairs!
 */
export function getWalkableSurface(
  x: number,
  z: number,
  currentY?: number
): { y: number; surface: 'sand' | 'wood' } {
  const terrainY = getTerrainHeight(x, z);
  let bestY = terrainY;
  let surface: 'sand' | 'wood' = 'sand';

  for (let i = 0; i < WALKABLE_DECKS.length; i++) {
    const d = WALKABLE_DECKS[i];
    if (x >= d.minX && x <= d.maxX && z >= d.minZ && z <= d.maxZ) {
      const deckY = d.getY(x, z);
      // Allow walking UNDER elevated piers if actor is well below the deck!
      if (currentY !== undefined && currentY < deckY - 0.72) continue;
      if (deckY > bestY) {
        bestY = deckY;
        surface = d.surface;
      }
    }
  }

  return { y: bestY, surface };
}

const _normTmp = new THREE.Vector3();

export function getTerrainNormal(x: number, z: number, target?: THREE.Vector3): THREE.Vector3 {
  const eps = 0.38;
  const hL = getTerrainHeight(x - eps, z);
  const hR = getTerrainHeight(x + eps, z);
  const hD = getTerrainHeight(x, z - eps);
  const hU = getTerrainHeight(x, z + eps);
  const out = target ?? _normTmp;
  return out.set(hL - hR, 2.0 * eps, hD - hU).normalize();
}

/**
 * Resolves horizontal collisions against static props, rocks, buildings, walls, and railings.
 */
export function resolveWorldCollisions(
  pos: THREE.Vector3,
  actorRadius: number,
  actorHeight = 1.75
): void {
  // 1. Cylinder colliders (palms, umbrellas, posts, tables, rocks, stools)
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

  // 2. Axis-aligned box colliders (Tiki bar counters/walls, railings, cabanas, picnic tables)
  for (let i = 0; i < WORLD_BOX_COLLIDERS.length; i++) {
    const b = WORLD_BOX_COLLIDERS[i];
    if (pos.y >= b.maxY - 0.08 || pos.y + actorHeight <= b.minY + 0.08) continue;
    const closestX = THREE.MathUtils.clamp(pos.x, b.minX, b.maxX);
    const closestZ = THREE.MathUtils.clamp(pos.z, b.minZ, b.maxZ);
    const dx = pos.x - closestX;
    const dz = pos.z - closestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq < actorRadius * actorRadius) {
      if (distSq > 1e-6) {
        const dist = Math.sqrt(distSq);
        const push = actorRadius - dist;
        pos.x += (dx / dist) * push;
        pos.z += (dz / dist) * push;
      } else {
        // Inside box: push out along nearest face
        const dL = Math.abs(pos.x - b.minX);
        const dR = Math.abs(b.maxX - pos.x);
        const dF = Math.abs(pos.z - b.minZ);
        const dB = Math.abs(b.maxZ - pos.z);
        const m = Math.min(dL, dR, dF, dB);
        if (m === dL) pos.x = b.minX - actorRadius;
        else if (m === dR) pos.x = b.maxX + actorRadius;
        else if (m === dF) pos.z = b.minZ - actorRadius;
        else pos.z = b.maxZ + actorRadius;
      }
    }
  }

  // 3. Oriented bounding boxes (boats, kayaks, swim raft pontoons, angled benches, coffee cart, driftwood logs)
  for (let i = 0; i < WORLD_OBB_COLLIDERS.length; i++) {
    const o = WORLD_OBB_COLLIDERS[i];
    if (pos.y >= o.maxY - 0.08 || pos.y + actorHeight <= o.minY + 0.08) continue;

    // World -> box-local XZ (inverse yaw rotation)
    const rx = pos.x - o.cx;
    const rz = pos.z - o.cz;
    const lx = rx * o.cosY - rz * o.sinY;
    const lz = rx * o.sinY + rz * o.cosY;

    const clx = THREE.MathUtils.clamp(lx, -o.halfW, o.halfW);
    const clz = THREE.MathUtils.clamp(lz, -o.halfL, o.halfL);
    const dlx = lx - clx;
    const dlz = lz - clz;
    const distSq = dlx * dlx + dlz * dlz;
    if (distSq < actorRadius * actorRadius) {
      let pushLx = 0;
      let pushLz = 0;
      if (distSq > 1e-6) {
        const dist = Math.sqrt(distSq);
        const push = actorRadius - dist;
        pushLx = (dlx / dist) * push;
        pushLz = (dlz / dist) * push;
      } else {
        const dL = Math.abs(lx + o.halfW);
        const dR = Math.abs(o.halfW - lx);
        const dF = Math.abs(lz + o.halfL);
        const dB = Math.abs(o.halfL - lz);
        const m = Math.min(dL, dR, dF, dB);
        if (m === dL) pushLx = -o.halfW - actorRadius - lx;
        else if (m === dR) pushLx = o.halfW + actorRadius - lx;
        else if (m === dF) pushLz = -o.halfL - actorRadius - lz;
        else pushLz = o.halfL + actorRadius - lz;
      }
      // Local push -> world XZ
      pos.x += pushLx * o.cosY + pushLz * o.sinY;
      pos.z += -pushLx * o.sinY + pushLz * o.cosY;
    }
  }

  // Expanded playable resort bay bounds (~220m wide x 195m deep)
  pos.x = THREE.MathUtils.clamp(pos.x, -108, 108);
  pos.z = THREE.MathUtils.clamp(pos.z, -70, 122);
}

/**
 * Matching GLSL terrain height function for Ocean depth, wet-sand swash, and Footprint RTT decay.
 */
export const TERRAIN_HEIGHT_GLSL = /* glsl */ `
float getTerrainHeightGLSL(vec2 xz) {
  float x = xz.x;
  float z = xz.y;
  float bayCurve = 0.0014 * x * x - 1.25 * sin(x * 0.036) - 0.55 * cos(x * 0.075);
  float s = z - bayCurve;
  float h = 0.0;

  if (s < 0.0) {
    float d = -s;
    float beachSlope = d * 0.078 + 0.00055 * d * d;
    float duneEnvelope = smoothstep(28.0, 56.0, d);
    float dunes = duneEnvelope * (
      3.4 +
      1.9 * sin(x * 0.055 + 0.7) * cos(z * 0.068) +
      1.15 * sin(x * 0.11 - z * 0.09) +
      0.50 * cos(x * 0.21 + z * 0.16)
    );
    float backRidge = smoothstep(52.0, 108.0, d) * (
      13.5 + 3.2 * sin(x * 0.042 + 1.1) + 1.8 * cos(x * 0.088 - z * 0.04)
    );
    h = beachSlope + dunes + backRidge;
  } else {
    float shallowSlope = -s * 0.068;
    float sd = (s - 20.0) / 8.0;
    float sandbar = 0.45 * exp(-sd * sd);
    float dropoff = -13.2 * smoothstep(26.0, 86.0, s) - 4.8 * smoothstep(86.0, 165.0, s);
    float seabedMounds = smoothstep(12.0, 36.0, s) * (
      0.55 * sin(x * 0.09 + z * 0.09) +
      0.30 * cos(x * 0.17 - z * 0.15)
    );
    h = shallowSlope + sandbar + dropoff + seabedMounds;
  }

  float flankMask = smoothstep(70.0, 125.0, abs(x)) * (1.0 - smoothstep(42.0, 96.0, s));
  float headland = flankMask * (
    7.2 + 2.2 * sin(x * 0.09 + z * 0.11) + 1.0 * cos(x * 0.20 - z * 0.17)
  );
  h += headland;

  float micro = 0.075 * sin(x * 0.19 + z * 0.16) + 0.036 * cos(x * 0.42 - z * 0.35);
  return h + micro;
}
`;
