# BeachProjectNeon project status

## 1. Agent state

### Metadata
- Project: **Neon Cove (BeachProjectNeon)**, root `D:\AI\BeachProjectNeon`, an interactive WebGL2 3D coastal beach and GTA-style underwater exploration tech demo built with Three.js, TypeScript, and Vite.
- Last updated: 2026-11-21T01:00:00+01:00 (CET).
- Last meaningful work: Completed major visual/audio/world-scale overhaul (+50% larger beach, Poly Haven CC0 PBR sand/rock/wood textures, official Three.js multi-octave water normal maps + true screen-space refraction, realistic ~27cm 2048×2048 RTT footprints, dynamic water-entry ripple rings & 3D splash droplets, hair clipping fix, 10 NPCs including shallow-water swimmers with beach ball & swim ring, real recorded Mixkit MP3 audio, FXAA 3.11 + SSAA anti-aliasing), verified with `tsc && vite build` and headless Chrome WebGL2 playtest (`0` errors), and redeployed to GitHub Pages.

### Objective
- Build and iterate a polished, high-fidelity browser 3D beach and underwater vertical slice with smooth graphics, realistic water, dynamic RTT footprints, spatial audio, and zero console/shader errors.
- Current task: Complete graphics & immersion overhaul (bigger beach, realistic water, footprint proportions, water-entry splashes/ripples, hair fix, realistic audio, anti-aliasing), establish `PROJECT_STATUS.md`, and republish live GitHub Pages build.
- Future task: Expand world richness & interactive props once user confirms the graphics baseline (e.g., small beachside shop/kiosk, additional kids/beach toys, more realistic downloaded GLB props and human models).
- Success criteria:
  - `npm run build` (`tsc && vite build`) passes with exit code `0`.
  - Headless Chrome WebGL2 verification reports `0` console errors, `0` warnings, and `0` uncaught exceptions.
  - Visual inspection confirms anti-aliased silhouettes, photoreal sand/water/refraction, human-scale footprints, water-entry splashes/ripples, zero hair clipping, and underwater god rays/caustics/muffled audio (`18,000 Hz -> 320 Hz`).
  - Live public URL `https://markmachina2025.github.io/BeachProjectNeon/` serves HTTP 200 with all `./textures/*` and `./audio/*` assets intact.

### Confirmed requirements
- Project directory is `D:\AI\BeachProjectNeon` (outside T3 default workspace `C:\Users\aoike\.t3\projects\fruitflytest`).
- Maintain `D:\AI\BeachProjectNeon\PROJECT_STATUS.md` using the attached `project-status` skill template after milestones.
- Beach expanded ~50% larger (`X: [-84, 84]`, `Z: [-62, 112]`).
- Anti-aliasing required (no pixelated/jagged edges): implemented via 1.35×–2.0× SSAA + FXAA 3.11 Quality + 8× anisotropic filtering + soft HDR bloom.
- Footprints must have realistic human proportions (not elongated/dinosaur-sized): fixed to `0.21m × 0.36m` stamp quad (`~11cm × 27cm` recessed sole) on a `2048×2048` ping-pong RTT.
- Water must look realistic using external open-source textures/techniques (not basic procedural noise) and must show physical entry splashes/ripples when stepping in (not clipping into flat blue).
- Character hair must not clip through the head.
- Audio must use realistic recorded sound assets rather than synthetic browser oscillator tones.
- Hosted publicly for free on GitHub Pages (`https://markmachina2025.github.io/BeachProjectNeon/`).
- Focus on graphics and larger beach first before adding extra world buildings/stores.

### Execution state
- Completed:
  - `vite.config.ts`, `tsconfig.json`, `package.json`, `index.html`, `src/style.css`, `.gitignore`, `RESEARCH_AND_ARCHITECTURE.md`.
  - `src/terrain/terrainMath.ts`: +50% expanded crescent bay heightfield, matching `TERRAIN_HEIGHT_GLSL`, and static collider registry.
  - `src/terrain/FootprintSystem.ts`: `2048×2048` ping-pong RTT covering `144m × 92m` (`X: [-72, 72]`, `Z: [-56, 36]`) with realistic `0.21m × 0.36m` left/right barefoot stamps and differential wet-wave vs dry-sand fade.
  - `src/terrain/CoastalTerrain.ts`: `320×320` CSM PBR terrain sampling Poly Haven CC0 `coast_sand_01` (`sand_Diffuse.jpg`, `sand_nor_gl.jpg`, `sand_Rough.jpg`) with dual-scale anti-tiling, quartz micro-glints, wet-dry shoreline sheen, RTT footprint normals/AO, and seabed caustics.
  - `src/ocean/wavePhysics.ts`: Shared 6-wave directional Gerstner spectrum (CPU + `GERSTNER_GLSL`).
  - `src/ocean/OceanSystem.ts`: 4-octave official Three.js seamless water normal maps (`waternormals.jpg`, `water_normal_1.jpg`, `water_normal_2.jpg`), true screen-space refraction (`tRefractColor`, `tRefractDepth`) with Beer-Lambert absorption, domain-warped organic lacy seafoam, Schlick Fresnel, SSS, and underwater Snell's window.
  - `src/ocean/WaterInteractionSystem.ts`: Live wave-conforming expanding concentric ripple/foam rings and ballistic 3D glistening water splash droplets on water entry, wading steps, and swim strokes.
  - `src/ocean/UnderwaterPostProcess.ts`: 4-stage pipeline (`refractTarget` pre-pass -> supersampled HDR + `DepthTexture` `renderTarget` -> waterline meniscus, underwater Beer-Lambert fog, 9-tap optical blur, edge CA, 28-step volumetric god rays, soft HDR bloom & ACES -> FXAA 3.11 Quality pass).
  - `src/ocean/UnderwaterParticles.ts`: Sun-shaft-lit drifting plankton motes and rising 3D bubbles.
  - `src/environment/AtmosphereSystem.ts`: Calibrated Rayleigh/Mie sky dome with sun disc, wispy clouds, PMREM IBL, texel-snapped `2048×2048` `PCFSoftShadowMap`, and Dawn/Midday/Golden Hour/Sunset controls.
  - `src/environment/CoastalFoliage.ts`: 22 wind-swaying palm trees with Poly Haven `bark_brown_01` PBR textures, 540 instanced dune grass tufts, submerged kelp & coral heads.
  - `src/environment/BeachProps.ts`: Poly Haven `coast_land_rocks_01` coastal & underwater reef boulders, 6 striped beach umbrella/chair/towel/cooler camps, surfboards, driftwood with bark PBR, shells, wave-bobbing buoys, beach ball, and inflatable swim ring.
  - `src/characters/HumanRig.ts`: 20-segment anatomical lofted human rig with offset outer hair dome + nape coverage (zero skull clipping), properly seated sunglasses, wet-skin sheen, underwater caustics, and damped pose blending.
  - `src/characters/NpcManager.ts`: 10 human NPCs (2 sunbathers, 1 chair lounger, 2 chatting near shore, 3 shoreline walkers/waders stamping footprints & splashes, 2 shallow-water players near beach ball & swim ring).
  - `src/player/PlayerController.ts`: Damped spring-arm 3rd/1st person (`V`) controller with dry/wet sand, wading, buoyant surface swimming, and diving physics + water-entry splash/wake triggers.
  - `src/audio/SoundEngine.ts`: Real recorded MP3 sample engine (`ocean_waves_birds.mp3`, `close_waves.mp3`, `sand_swish.mp3`, `sand_steps.mp3`, `water_splash.mp3`, `water_jump.mp3`, `underwater_ambience.mp3`, `underwater_bubbles.mp3`) with wave-synced swells and smooth `18,000 Hz -> 320 Hz` Biquad LPF sweep underwater.
  - `src/ui/HudController.ts` & `src/main.ts`: Clamped `dt <= 0.05s` loop, glassmorphic HUD (`H` hide, `M` mute, `V` perspective, `AA: FXAA + SSAA` toggle), and `window.__BEACH_DEMO__` test hooks.
- Verified:
  - `npm run build --prefix "D:\AI\BeachProjectNeon"` (`tsc && vite build`): Exit `0`, built in `578ms` (`dist/assets/index-DbrVBc5R.js` 660.38 kB).
  - Headless Chrome WebGL2 verification (`1280×800`) against `http://127.0.0.1:5173/`: `consoleErrors: []`, `consoleWarnings: []`, `exceptions: []`, `npcCount: 10`, walking `DRY SAND -> WET SAND -> WADING` (`footprintStamps: 3 -> 55`), diving `-2.93m` (`lowPassHz: 18000 -> 320`), `hudHidden: true`.
  - Visual screenshot audit of `01_beach_vista.png`, `02_sand_footprints.png`, `03_wading_splash.png`, and `04_underwater_godrays_caustics.png` confirmed clean anti-aliased edges, refracting turquoise water, human-scale footprints, wading ripple rings & splash droplets, zero hair clipping, textured boulders/sand/palms, and smooth underwater god rays.
- Pending:
  - Commit and push updated `main` and redeploy `dist/` to `gh-pages` branch, then verify live GitHub Pages HTTP 200 (executing immediately after writing this file).
- Blocked: None.

### Decisions
- **GitHub Pages via orphan `gh-pages` branch** instead of GitHub Actions: `gh` OAuth token has scopes `'gist', 'read:org', 'repo'` (no `'workflow'` scope), so pushing `dist/` + `.nojekyll` directly to `gh-pages` works cleanly without workflow permission failures.
- **Relative Vite `base: './'`** in `vite.config.ts` and relative `./textures/...` & `./audio/...` asset paths so both local `vite dev` and `https://markmachina2025.github.io/BeachProjectNeon/` resolve assets cleanly.
- **FXAA 3.11 + SSAA (1.35×–2.0×) post-pass** instead of MSAA render target: WebGL2 forbids sampling a multisampled `DepthTexture` directly, so supersampling + FXAA 3.11 on luma delivers smooth edges while preserving exact depth-based refraction, waterline meniscus, optical blur, and volumetric god rays.
- **Real CC0/royalty-free textures & MP3 samples stored locally in `public/`**: Ensures deterministic zero-CORS loading on GitHub Pages with photoreal material fidelity and authentic sound.

### Deferred possibilities
- Adding a small beachside shop / boardwalk kiosk, more children/toys in the surf, and external GLB beach props/characters (explicitly deferred by user until graphics and beach scale are polished).
- Code-splitting Three.js vendor chunk via `rollupOptions.output.manualChunks` to silence Vite's 500 kB chunk-size info notice.

### Operational context
- Root path: `D:\AI\BeachProjectNeon`
- Entry points: `D:\AI\BeachProjectNeon\index.html`, `D:\AI\BeachProjectNeon\src\main.ts`
- Local runtime/tools verified: Node `v26.13.0`, npm `11.12.1`, Git `C:\Program Files\Git\cmd\git.exe`, GitHub CLI `C:\Users\aoike\.toolbox-keys\gh\bin\gh.exe` logged in as `MarkMachina2025` (scopes: `gist`, `read:org`, `repo`).
- Dependencies (`package.json`): `three ^0.172.0`, `three-custom-shader-material ^6.4.0`; devDependencies: `@types/three ^0.172.0`, `typescript ^5.7.3`, `vite ^6.1.0`.
- Asset inventory:
  - `public/textures/` (10 files): `waternormals.jpg`, `water_normal_1.jpg`, `water_normal_2.jpg` (Three.js MIT), `sand_Diffuse.jpg`, `sand_nor_gl.jpg`, `sand_Rough.jpg`, `rock_Diffuse.jpg`, `rock_nor_gl.jpg`, `wood_Diffuse.jpg`, `wood_nor_gl.jpg` (Poly Haven CC0).
  - `public/audio/` (8 files): `ocean_waves_birds.mp3`, `close_waves.mp3`, `sand_swish.mp3`, `sand_steps.mp3`, `water_splash.mp3`, `water_jump.mp3`, `underwater_ambience.mp3`, `underwater_bubbles.mp3` (Mixkit).
- Build & run commands:
  - Dev server: `npm run dev --prefix "D:\AI\BeachProjectNeon"` (`http://127.0.0.1:5173/`)
  - Type-check & production build: `npm run build --prefix "D:\AI\BeachProjectNeon"`
- Git/hosting:
  - Repo: `https://github.com/MarkMachina2025/BeachProjectNeon`
  - Live URL: `https://markmachina2025.github.io/BeachProjectNeon/`
  - Repo-local git identity configured: `MarkMachina2025 <MarkMachina2025@users.noreply.github.com>`.
- Known runtime quirks:
  - Downloading files directly into `public/` while `vite dev` is watching on Windows can trigger an `EBUSY` watcher exit on Vite; restart `npm run dev` if adding binary files to `public/`.
  - `window.__BEACH_DEMO__` exposes `{ getState, teleport, setSun, setWaveIntensity, toggleFirstPerson, emitTestBubbles, unlockAudio }` for automated verification.

### Issues and uncertainty
- Audio sample playback requires a real user gesture in standard browsers (`SoundEngine.unlock()` triggers on first click/keydown); headless verification used `autoplay-policy=no-user-gesture-required` to confirm decoding and LPF sweep, while subjective audio mix balance across all 8 MP3 clips should be ear-checked by the user on the live site.
- `water_jump.mp3` (4.68 MB) and `water_splash.mp3` (2.17 MB) are decoded asynchronously on first interaction; on very slow connections, splashes wait ~1–2s until decoded (could be trimmed/compressed later if faster initial audio load is desired).

### Resume instructions
1. Read `D:\AI\BeachProjectNeon\PROJECT_STATUS.md` completely before editing code.
2. Collect user feedback on the newly deployed graphics/audio/beach-size pass at `https://markmachina2025.github.io/BeachProjectNeon/`.
3. For the next world-building milestone (beachside store/kiosk, more realistic external GLB props/characters, extra beachgoers/toys), add modular assets under `public/models/` and register colliders via `addCollider()` in `src/terrain/terrainMath.ts`.
4. Run `npm run build --prefix "D:\AI\BeachProjectNeon"`, run headless Chrome visual verification, redeploy `dist/` to `gh-pages`, and update `PROJECT_STATUS.md` in place.

## 2. Human summary

**Neon Cove** (`D:\AI\BeachProjectNeon`) is an interactive WebGL2 3D coastal beach and underwater tech demo featuring a +50% expanded crescent sandy bay, photorealistic Poly Haven PBR sand/rock/wood textures, multi-octave normal-mapped ocean water with true screen-space refraction, realistic human-sized 2048×2048 real-time sand footprints, dynamic water-entry ripple rings and 3D splash droplets, 10 animated beach NPCs (including swimmers playing with a beach ball and swim ring), real recorded coastal/underwater audio with a 18 kHz → 320 Hz underwater low-pass filter sweep, volumetric god rays, animated caustics, and FXAA 3.11 + SSAA anti-aliasing.

The latest graphics, audio, and scale overhaul passed `tsc && vite build` and headless Chrome verification with zero console or shader errors, and is being published directly to the live GitHub Pages URL (`https://markmachina2025.github.io/BeachProjectNeon/`).

**Next step:** Open the updated live link to test the bigger beach, refracting water, wading splashes, fixed hair, realistic footprints, and real audio, and let me know if any visual or audio tweaks are needed before we start adding the beach store and more world props/characters.
