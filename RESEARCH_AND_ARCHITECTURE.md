# BeachProjectNeon — Phase 1 Research & Technical Architecture

## 1. Pre-Build Research Summary

### Proven Open-Source References & Shader Patterns
1. **Ocean & Underwater Optics:**
   - **[achrefelouafi/WaterThreeJS](https://github.com/achrefelouafi/WaterThreeJS):** Spectral multi-directional Gerstner wave field, Beer-Lambert depth color absorption, subsurface scattering on wave crests, shoreline/crest foam, underwater caustics, and procedural volumetric light shafts.
   - **[VictorZakharov/beautiful-water](https://github.com/VictorZakharov/beautiful-water):** Shallow coastal optical absorption, seabed caustics, foam lifecycle, and sun shafts.
   - **[martinRenou/threejs-caustics](https://github.com/martinRenou/threejs-caustics):** Dual-layer animated refracted caustic projection onto submerged surfaces.
2. **Dynamic Sand Deformation & Custom PBR Shaders:**
   - **[three-custom-shader-material](https://github.com/FarazzShah/THREE-CustomShaderMaterial) (`three-custom-shader-material/vanilla`):** Extends Three.js `MeshStandardMaterial` with custom vertex/fragment hooks (`csm_Position`, `csm_DiffuseColor`, `csm_Roughness`, `csm_FragNormal`) while preserving full PCF soft shadows, ACES tone mapping, and PMREM IBL environment lighting.
   - **RTT Ping-Pong Height/Normal Deformation:** Top-down orthographic `WebGLRenderTarget` (`1024×1024`) ping-pong buffer stamping left/right heel-to-toe footprint impressions with wave-swash smoothing and differential wet-vs-dry decay rates.
3. **Seamless GTA V-Style Waterline & Underwater Post-Processing:**
   - Single HDR `WebGLRenderTarget` + `DepthTexture` rendering pass feeding a unified full-screen optical post-process shader:
     - Evaluates the exact shared Gerstner wave height function at the camera's near-plane world coordinates per pixel, creating a physically undulating meniscus line as waves roll over the lens.
     - Reconstructs world/linear depth for Beer-Lambert exponential underwater fog, depth-weighted optical softening/blur, edge chromatic aberration, screen-space refraction ripple, and depth-occluded raymarched volumetric god rays.
4. **Human Character Architecture & Assets:**
   - Evaluated official Three.js / Khronos GLB samples (`Soldier.glb`, `Xbot.glb`, `Michelle.glb`, `CesiumMan.glb`). Because beach scenes require 8+ distinct human characters with varied skin tones, hairstyles, and summer swimwear/clothing—plus custom wading, swimming, diving, and sunbathing animations—we implement a **true rigged `THREE.SkinnedMesh` + 21-bone `THREE.Skeleton` anatomical humanoid generator** with smooth lofted organic body geometry, vertex-weighted joints, `AnimationMixer`/quaternion-blended procedural clips, world-space foot-bone tracking for exact footprint placement, and CSM underwater caustics + wetness shading (while keeping full `GLTFLoader` pipeline readiness).

---

## 2. Chosen Tech Stack
- **Core:** TypeScript + Vite 6 + Three.js (`three` WebGL2)
- **Shader Extension:** `three-custom-shader-material/vanilla`
- **Atmosphere:** `three/addons/objects/Sky.js` + `PMREMGenerator` dynamic IBL
- **Audio:** Zero-dependency procedural Web Audio API engine (`BiquadFilterNode` underwater sweep, stereo panning, wave-synced swells, granular footsteps, bubbles)

---

## 3. Module Architecture
```text
src/
  main.ts                        # Bootstrap, clamped dt loop, debug hooks
  ocean/
    wavePhysics.ts               # Shared 6-wave Gerstner math (CPU + GLSL sync)
    OceanSystem.ts               # Double-sided Gerstner ocean (Fresnel, SSS, foam, Snell's window)
    UnderwaterPostProcess.ts     # HDR + DepthTexture waterline meniscus, fog, blur, CA, god rays
    UnderwaterParticles.ts       # Sun-lit drifting plankton motes + 3D rising bubble streams
  terrain/
    terrainMath.ts               # Sculpted crescent bay, dunes, sandbar, seabed drop-off
    FootprintSystem.ts           # 1024x1024 ping-pong RTT footprint stamp & wet/dry wave fade
    CoastalTerrain.ts            # CSM PBR sand (grain, sun sparkle, wet-dry sheen, footprints, caustics)
  environment/
    AtmosphereSystem.ts          # Sky dome, sun disc, PMREM IBL, directional shadows, time-of-day
    CoastalFoliage.ts            # Animated swaying palm trees, dune grass, underwater kelp & coral
    BeachProps.ts                # Umbrellas, lounge chairs, towels, coolers, surfboards, boulders, shells, driftwood
  characters/
    HumanRig.ts                  # Rigged SkinnedMesh anatomical human (21 bones, swimwear, hair, caustics)
    NpcManager.ts                # 8 beach NPCs (sunbathing, lounging, chatting, shoreline walkers/waders)
  player/
    PlayerController.ts          # 3rd/1st person controller, spring-arm camera, sand/wade/swim/dive physics
  audio/
    SoundEngine.ts               # Procedural Web Audio API + 18kHz->320Hz underwater low-pass sweep
  ui/
    HudController.ts             # Minimal glassmorphic HUD (H to hide, time-of-day, waves, camera, audio)
```
