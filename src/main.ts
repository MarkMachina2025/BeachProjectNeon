import './style.css';
import * as THREE from 'three';
import { clearColliders, getTerrainHeight } from './terrain/terrainMath';
import { sampleWave } from './ocean/wavePhysics';
import { FootprintSystem } from './terrain/FootprintSystem';
import { CoastalTerrain } from './terrain/CoastalTerrain';
import { OceanSystem } from './ocean/OceanSystem';
import { UnderwaterPostProcess } from './ocean/UnderwaterPostProcess';
import { UnderwaterParticles } from './ocean/UnderwaterParticles';
import { AtmosphereSystem } from './environment/AtmosphereSystem';
import { CoastalFoliage } from './environment/CoastalFoliage';
import { BeachProps } from './environment/BeachProps';
import { NpcManager } from './characters/NpcManager';
import { PlayerController } from './player/PlayerController';
import { SoundEngine } from './audio/SoundEngine';
import { HudController } from './ui/HudController';

function bootstrap(): void {
  clearColliders();

  const canvas = document.getElementById('scene-canvas') as HTMLCanvasElement;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Post-processing pass owns final ACES Filmic tone mapping & sRGB encoding from HDR RT
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.12,
    650
  );

  // 1. Physically based Atmosphere, Sky Dome, Sun Shadows & PMREM IBL
  const atmosphere = new AtmosphereSystem(renderer, scene);

  // 2. Real-time 1024x1024 Ping-Pong RTT Sand Footprint Deformation System
  const footprints = new FootprintSystem(renderer);

  // 3. Coastal Terrain with CSM PBR Sand, Sparkle, Wet-Dry Shoreline, Footprints & Caustics
  const terrain = new CoastalTerrain(footprints);
  scene.add(terrain.mesh);

  // 4. Sculpted Coastal Boulders, Reef Rocks & Beach Scene Dressing Props
  const props = new BeachProps();
  scene.add(props.group);

  // 5. Swaying Palm Trees, Dune Grass & Underwater Reef Flora
  const foliage = new CoastalFoliage();
  scene.add(foliage.group);

  // 6. Gerstner Ocean Surface (Above-Water Fresnel/SSS/Foam + Underwater Snell's Window)
  const ocean = new OceanSystem();
  scene.add(ocean.mesh);

  // 7. Underwater Suspended Plankton Motes & Rising 3D Bubble Streams
  const particles = new UnderwaterParticles();
  scene.add(particles.group);

  // 8. 8 Human Beach NPCs (Sunbathers, Lounger, Chatting Pair, 3 Shoreline Walkers/Waders)
  const npcs = new NpcManager(props.restSpots);
  scene.add(npcs.group);

  // 9. Web Audio API Spatial Coastal & Underwater Sound Engine
  const sound = new SoundEngine();

  // 10. Player Character & Damped Spring-Arm Orbit Camera Controller
  const player = new PlayerController(canvas, scene);

  // 11. HDR + DepthTexture Waterline Meniscus, Underwater Fog/Blur/CA & Volumetric God Rays
  const postProcess = new UnderwaterPostProcess(renderer, window.innerWidth, window.innerHeight);

  // State parameters
  let waveIntensity = 1.0;

  // 12. Minimal Glassmorphic HUD
  const hud = new HudController({
    onSunChange: (progress) => {
      atmosphere.setSunProgress(progress);
      hud.setSunLabel(atmosphere.getLabel());
    },
    onWaveChange: (intensity) => {
      waveIntensity = intensity;
    },
    onToggleCamera: () => player.togglePerspective(),
    onToggleMute: () => sound.toggleMute(),
    onToggleAA: () => postProcess.toggleAntiAliasing(window.innerWidth, window.innerHeight)
  });
  hud.setSunLabel(atmosphere.getLabel());

  player.onFirstInteraction = () => {
    sound.unlock();
    hud.dismissPointerHint();
  };

  // Handle window resizing cleanly
  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    postProcess.setSize(w, h);
  });

  // Main animation loop with strict delta-time clamping (prevents physics/wave explosions on tab switches)
  let lastTime = performance.now();
  let elapsedTime = 0;
  let hudAccum = 0;

  const animate = (now: number) => {
    requestAnimationFrame(animate);

    const rawDt = (now - lastTime) * 0.001;
    lastTime = now;
    // Clamp dt to [0.0001, 0.05] (max 50ms step)
    const dt = Math.min(Math.max(rawDt, 0.0001), 0.05);
    elapsedTime += dt;

    const sunDir = atmosphere.sunDirection;
    const sunCol = atmosphere.sunColor;

    // Update player physics, animation, footprints & spring-arm camera
    player.update(
      dt,
      elapsedTime,
      waveIntensity,
      camera,
      sunDir,
      sunCol,
      footprints,
      particles,
      sound
    );

    // Update 8 NPCs (sunbathing, lounging, chatting, shoreline walking/wading + footprints)
    npcs.update(
      dt,
      elapsedTime,
      waveIntensity,
      sunDir,
      sunCol,
      footprints,
      particles,
      player.position
    );

    // Update RTT sand footprint decay & wave-wash smoothing + stamp newly queued prints
    footprints.update(renderer, dt, elapsedTime, waveIntensity);

    // Update terrain, ocean, foliage, props, atmosphere, underwater particles
    terrain.update(footprints.texture, elapsedTime, waveIntensity, sunDir, sunCol);
    ocean.update(
      elapsedTime,
      waveIntensity,
      sunDir,
      sunCol,
      atmosphere.skyZenith,
      atmosphere.skyHorizon,
      atmosphere.fogColor
    );
    foliage.update(elapsedTime, waveIntensity, sunDir, sunCol);
    props.update(elapsedTime, waveIntensity, sunDir, sunCol);
    atmosphere.update(elapsedTime, player.position);
    particles.update(dt, elapsedTime, camera.position, waveIntensity, sunDir, sunCol);

    // Update Web Audio spatial engine (synced to wave cycle & camera submergence)
    const camTerrain = getTerrainHeight(camera.position.x, camera.position.z);
    const waveInfo = sampleWave(camera.position.x, camera.position.z, elapsedTime, waveIntensity, camTerrain);
    const shoreProx = 1.0 - THREE.MathUtils.clamp(Math.abs(camera.position.z) / 36.0, 0, 1);
    sound.update(dt, elapsedTime, player.cameraSubmersion, waveInfo.swellPhase, waveIntensity, shoreProx);

    // Render HDR scene + seamless GTA-style waterline meniscus + underwater god rays & optics
    postProcess.render(renderer, scene, camera, elapsedTime, waveIntensity, sunDir, sunCol);

    // Refresh HUD telemetry cleanly at ~15Hz
    hudAccum += dt;
    if (hudAccum >= 0.065) {
      hudAccum = 0;
      const groundH = getTerrainHeight(player.position.x, player.position.z);
      hud.updateTelemetry(player.mode, groundH, player.cameraSubmersion, footprints.stampCount);
    }
  };

  requestAnimationFrame(animate);

  // Expose lightweight debug & verification hook for interactive testing
  (window as unknown as Record<string, unknown>).__BEACH_DEMO__ = {
    getState: () => ({
      playerPos: player.position.toArray(),
      cameraPos: camera.position.toArray(),
      mode: player.mode,
      cameraSubmersion: player.cameraSubmersion,
      footprintStamps: footprints.stampCount,
      npcCount: npcs.agents.length,
      lowPassHz: Math.round(sound.lowPassFrequency),
      audioActive: sound.isActive,
      sunLabel: atmosphere.getLabel(),
      waveIntensity
    }),
    teleport: (x: number, y: number, z: number, yaw = 0, pitch = 0.18) => {
      player.teleportTo(x, y, z, yaw, pitch);
    },
    setSun: (progress: number) => {
      atmosphere.setSunProgress(progress, true);
      hud.setSunLabel(atmosphere.getLabel());
    },
    setWaveIntensity: (intensity: number) => {
      waveIntensity = intensity;
    },
    toggleFirstPerson: () => {
      const fp = player.togglePerspective();
      hud.setCameraLabel(fp);
      return fp;
    },
    emitTestBubbles: () => {
      particles.emitBubbles(
        new THREE.Vector3(player.position.x, player.position.y + 0.8, player.position.z + 1.2),
        18,
        0.7,
        0.95
      );
    },
    unlockAudio: () => sound.unlock()
  };
}

bootstrap();
