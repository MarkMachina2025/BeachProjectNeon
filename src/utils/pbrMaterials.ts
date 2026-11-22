import * as THREE from 'three';

const texLoader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();

export function loadTiledTex(
  path: string,
  isColor: boolean,
  repeatX = 1,
  repeatY = 1
): THREE.Texture {
  const key = `${path}|${isColor ? 1 : 0}|${repeatX}|${repeatY}`;
  const cached = texCache.get(key);
  if (cached) return cached;

  const tex = texLoader.load(path);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 8;
  if (isColor) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  texCache.set(key, tex);
  return tex;
}

export interface PbrTextureSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

export function loadPbrSet(
  id:
    | 'wood_floor_deck'
    | 'oak_wood_planks'
    | 'white_planks_clean'
    | 'coral_stone_wall'
    | 'bamboo_wall_02'
    | 'sparse_grass'
    | 'rough_linen'
    | 'weathered_brown_planks'
    | 'terry_cloth',
  repeatX = 1,
  repeatY = 1
): PbrTextureSet {
  const base = `./textures/pbr/${id}`;
  return {
    map: loadTiledTex(`${base}_diff.jpg`, true, repeatX, repeatY),
    normalMap: loadTiledTex(`${base}_nor.jpg`, false, repeatX, repeatY),
    roughnessMap: loadTiledTex(`${base}_rough.jpg`, false, repeatX, repeatY)
  };
}

/**
 * Creates a BoxGeometry whose UVs on ALL 6 faces are scaled proportionally to real-world
 * physical meters (divided by `tileMeters`), eliminating stretched/smeared wood or stone
 * textures on stairs, risers, stringers, handrails, terrace walls, posts, and decks!
 */
export function makeWorldBoxGeo(
  w: number,
  h: number,
  d: number,
  tileMeters = 1.6,
  rotateTopPlanks = false
): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // Three.js BoxGeometry face order (4 verts per face):
  // 0: +X (depth x height), 1: -X (depth x height)
  // 2: +Y (width x depth),  3: -Y (width x depth)
  // 4: +Z (width x height), 5: -Z (width x height)
  const faceScales: Array<[number, number, boolean]> = [
    [d / tileMeters, h / tileMeters, false],
    [d / tileMeters, h / tileMeters, false],
    [w / tileMeters, d / tileMeters, rotateTopPlanks],
    [w / tileMeters, d / tileMeters, rotateTopPlanks],
    [w / tileMeters, h / tileMeters, false],
    [w / tileMeters, h / tileMeters, false]
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv, swap] = faceScales[f];
    const base = f * 4;
    for (let v = 0; v < 4; v++) {
      const u = uv.getX(base + v);
      const vv = uv.getY(base + v);
      if (swap) {
        uv.setXY(base + v, vv * sv, u * su);
      } else {
        uv.setXY(base + v, u * su, vv * sv);
      }
    }
  }
  uv.needsUpdate = true;
  return geo;
}

/**
 * Scales CylinderGeometry UVs proportionally to circumference & height so pilings, posts,
 * bamboo stalks, and handrail stanchions never smear vertically.
 */
export function makeWorldCylinderGeo(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  radialSegments = 10,
  tileMeters = 1.2
): THREE.CylinderGeometry {
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const circum = Math.PI * (radiusTop + radiusBottom);
  const su = Math.max(0.5, circum / tileMeters);
  const sv = Math.max(0.5, height / tileMeters);
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  uv.needsUpdate = true;
  return geo;
}
