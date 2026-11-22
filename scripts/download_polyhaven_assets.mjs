#!/usr/bin/env node
/**
 * Poly Haven CC0 Asset Downloader (`scripts/download_polyhaven_assets.mjs`)
 *
 * Downloads:
 *  - 1k PBR JPG texture sets (`diff`, `nor_gl`, `rough`) into `public/textures/`
 *  - 1k GLTF models (`.gltf`, `.bin`, `textures/*`) into `public/models/<id>/`
 *  - Inspects each `.gltf` JSON to log exact sub-mesh names and triangle counts
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const TEXTURE_DIR = 'D:\\AI\\BeachProjectNeon\\public\\textures';
const MODEL_DIR = 'D:\\AI\\BeachProjectNeon\\public\\models';

const TEXTURES = ['thatch_roof_angled', 'palm_tree_bark', 'cliff_side'];
const MODELS = [
  'stone_fire_pit',
  'rock_face_01',
  'rock_face_02',
  'modular_fort_01',
  'anthurium_botany_01',
  'calathea_orbifolia_01',
  'shrub_sorrel_01',
  'shrub_03',
  'flower_empodium',
  'potted_plant_04',
  'standing_chalkboard_01',
  'bronze_whale_statue',
  'wooden_bucket_01',
  'wooden_crate_02',
  // Wave-2 Verified Lightweight Resort & Botanical Models (all CC0 1k GLTF)
  'CoffeeCart_01',
  'painted_wooden_bench',
  'Ukulele_01',
  'bronze_ray_statue',
  'bronze_shark_statue',
  'planter_box_01',
  'lifebuoy',
  'ocean_buoy',
  'flower_gazania',
  'flower_ursinia',
  'bananas',
];

async function downloadFile(url, outPath) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  try {
    const stat = await fs.stat(outPath);
    if (stat.size > 0) return { bytes: stat.size, cached: true };
  } catch {
    // download needed
  }
  const res = await fetch(url, { headers: { 'User-Agent': 'NeonCoveAssetPipeline/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buf);
  return { bytes: buf.length, cached: false };
}

function summarizeGltf(gltfJson) {
  const accessors = gltfJson.accessors || [];
  const meshes = gltfJson.meshes || [];
  const nodes = gltfJson.nodes || [];
  let totalTris = 0;
  const submeshes = meshes.map((m) => {
    let tris = 0;
    for (const prim of m.primitives || []) {
      const acc = prim.indices !== undefined ? accessors[prim.indices] : accessors[prim.attributes?.POSITION];
      if (acc?.count) tris += Math.round(acc.count / 3);
    }
    totalTris += tris;
    return `${m.name || 'mesh'}(${tris}t)`;
  });
  const nodeNames = nodes.map((n) => n.name).filter(Boolean);
  return { totalTris, submeshes, nodeNames };
}

async function main() {
  await fs.mkdir(TEXTURE_DIR, { recursive: true });
  await fs.mkdir(MODEL_DIR, { recursive: true });

  console.log('=== DOWNLOADING 1K PBR TEXTURES ===');
  for (const id of TEXTURES) {
    const filesMeta = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
    const gltf1k = filesMeta.gltf?.['1k']?.gltf;
    const include = gltf1k?.include || {};
    const wantedSuffixes = ['_diff_1k.jpg', '_nor_gl_1k.jpg', '_rough_1k.jpg'];
    let count = 0;
    for (const [rel, info] of Object.entries(include)) {
      if (wantedSuffixes.some((s) => rel.endsWith(s)) && info?.url) {
        const base = path.basename(rel);
        const r = await downloadFile(info.url, path.join(TEXTURE_DIR, base));
        console.log(`  [TEX] ${base} (${Math.round(r.bytes / 1024)} KB${r.cached ? ' cached' : ''})`);
        count++;
      }
    }
    // Fallback if gltf include omitted roughness/nor_gl
    if (count < 3) {
      for (const [mapKey, suf] of [
        ['Diffuse', 'diff'],
        ['nor_gl', 'nor_gl'],
        ['Rough', 'rough'],
      ]) {
        const entry = filesMeta[mapKey]?.['1k']?.jpg;
        if (entry?.url) {
          const outName = `${id}_${suf}_1k.jpg`;
          const r = await downloadFile(entry.url, path.join(TEXTURE_DIR, outName));
          console.log(`  [TEX-FB] ${outName} (${Math.round(r.bytes / 1024)} KB${r.cached ? ' cached' : ''})`);
        }
      }
    }
  }

  console.log('\n=== DOWNLOADING & INSPECTING 1K GLTF MODELS ===');
  const manifest = {};
  for (const id of MODELS) {
    const filesMeta = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
    const gltf1k = filesMeta.gltf?.['1k']?.gltf;
    if (!gltf1k?.url) {
      throw new Error(`Missing 1k gltf for ${id}`);
    }
    const dir = path.join(MODEL_DIR, id);
    const gltfPath = path.join(dir, `${id}_1k.gltf`);
    const mainDl = await downloadFile(gltf1k.url, gltfPath);
    let totalBytes = mainDl.bytes;

    for (const [rel, info] of Object.entries(gltf1k.include || {})) {
      if (!info?.url) continue;
      const r = await downloadFile(info.url, path.join(dir, rel));
      totalBytes += r.bytes;
    }

    const gltfJson = JSON.parse(await fs.readFile(gltfPath, 'utf8'));
    const info = summarizeGltf(gltfJson);
    manifest[id] = { totalKB: Math.round(totalBytes / 1024), ...info };
    console.log(
      `  [GLTF] ${id.padEnd(24)} ${String(manifest[id].totalKB).padStart(5)} KB | totalTris=${String(info.totalTris).padStart(6)} | meshes=${info.submeshes.length} [${info.submeshes.slice(0, 6).join(', ')}${info.submeshes.length > 6 ? ', ...' : ''}]`
    );
  }

  console.log('\n[ASSETS] All Poly Haven textures & 1k GLTF models ready.');
}

main().catch((e) => {
  console.error('[ASSETS] ERROR:', e);
  process.exit(1);
});
