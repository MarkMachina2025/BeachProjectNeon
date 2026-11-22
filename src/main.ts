import './style.css';
import * as THREE from 'three';
import { clearColliders, getTerrainHeight } from './terrain/terrainMath';
import { sampleWave } from './ocean/wavePhysics';
import { FootprintSystem } from './terrain/FootprintSystem';
import { CoastalTerrain } from './terrain/CoastalTerrain';
import { OceanSystem } from './ocean/OceanSystem';
import { WaterRippleSim } from './ocean/WaterRippleSim';
import { UnderwaterPostProcess } from './ocean/UnderwaterPostProcess';
import { UnderwaterParticles } from './ocean/UnderwaterParticles';
import { WaterInteractionSystem } from './ocean/WaterInteractionSystem';
import { AtmosphereSystem } from './environment/AtmosphereSystem';
import { CoastalFoliage } from './environment/CoastalFoliage';
import { BeachProps } from './environment/BeachProps';
import { CoastalLandmarks, getBoardwalkY } from './environment/CoastalLandmarks';
import { CoastalModels } from './environment/CoastalModels';
import { CoastalWildlife } from './environment/CoastalWildlife';
import { InteractiveWorld } from './environment/InteractiveWorld';
import { NpcManager } from './characters/NpcManager';
import { InteractiveSitSpot, PlayerController } from './player/PlayerController';
import { SoundEngine } from './audio/SoundEngine';
import { HudController } from './ui/HudController';

function bootstrap(): void {
  clearColliders();

  const canvas = document.getElementById('scene-canvas') as HTMLCanvasElement;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // Post-process FXAA 3.11 + SSAA handles full-screen anti-aliasing cleanly
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.12,
    720
  );

  // 1. Calibrated Atmospheric Sky Dome, Sun Shadows & PMREM IBL
  const atmosphere = new AtmosphereSystem(renderer, scene);

  // 2. Real-time 2048x2048 Ping-Pong RTT Sand Footprint System (30Hz throttled decay for high FPS)
  const footprints = new FootprintSystem(renderer);

  // 3. Expanded Sweeping Coastal Bay & Seabed Terrain (Poly Haven CC0 Sand PBR, zero shadow dots)
  const terrain = new CoastalTerrain(footprints);
  scene.add(terrain.mesh);

  // 4. Non-Overlapping Beach Camps, Surfboards, Driftwood & Floating Water Props
  const props = new BeachProps();
  scene.add(props.group);
  scene.add(props.waterPropsGroup);

  // 5. Walkable Coastal Landmarks (Boardwalk, 28m Ocean Pier, Neon Tiki Surf Bar, Lifeguard Tower, Water Slide, Volleyball Court)
  const landmarks = new CoastalLandmarks(() => props.createTropicalDrink());
  scene.add(landmarks.group);
  scene.add(landmarks.pierGroup);
  landmarks.addLightHalo(props.bonfireHaloPos, 2.4, 0xff7b28);

  // 6. Swaying Palm Groves & Underwater Reef Flora
  const foliage = new CoastalFoliage();
  scene.add(foliage.group);

  // 7. GPU-Instanced Photoscanned Poly Haven CC0 Models (15 real scans: individual centered flora, intact barrels, level patio tables, barstools, rocks, lanterns)
  const coastalModels = new CoastalModels(
    props.campAnchors,
    foliage.palmPositions,
    landmarks.barStoolSpots,
    landmarks.patioTerraceSpots,
    landmarks.picnicTerraceSpots,
    () => props.createTropicalDrink(),
    (pos) => landmarks.addLightHalo(pos, 1.35, 0xffba52),
    landmarks.whalePlinthTop,
    {
      rayPlinthTop: landmarks.rayPlinthTop,
      sharkPlinthTop: landmarks.sharkPlinthTop,
      coffeeCartDeckTop: landmarks.coffeeCartDeckTop,
      eastOverlookDeckTop: landmarks.eastOverlookDeckTop,
      lifebuoyHookPos: landmarks.lifebuoyHookPos
    }
  );
  scene.add(coastalModels.group);

  // 8. Ambient Wildlife (Seagulls, Distant Sailboats, Sand Crabs, Dune Butterflies, 2 Sea Turtles, Manta Ray & 36 Reef Fish!)
  const wildlife = new CoastalWildlife();
  scene.add(wildlife.skyGroup);
  scene.add(wildlife.fishGroup);
  scene.add(wildlife.horizonGroup);

  // 8b. Interactive World Showcase (10 Golden Shells, Kickable Beach Ball, Weather Rain, Leaping Dolphins, Shooting Stars)
  const interactiveWorld = new InteractiveWorld();
  scene.add(interactiveWorld.group);
  scene.add(interactiveWorld.waterGroup);

  // 9. Photorealistic Ocean Surface (4-octave real water normals, screen-space refraction, organic FBM surf)
  const ocean = new OceanSystem();
  scene.add(ocean.mesh);

  // 10. Underwater Plankton Motes, Rising 3D Bubbles & Dynamic Water-Entry Ripples/Splashes
  const particles = new UnderwaterParticles();
  scene.add(particles.group);

  const waterFX = new WaterInteractionSystem();
  scene.add(waterFX.group);

  // 11. 34 Living Beach NPCs (Kids playing ball, 4 Swimmers, Volleyball, 2 Pier Fishermen, 2 Frisbee Players, Bartender & Patrons, Patio/Picnic Diners, Surf Browsers, Lifeguard, Pier & Boardwalk Strollers, Walkers & Sunbathers!)
  const npcs = new NpcManager(props.restSpots, {
    bartenderSpot: landmarks.bartenderSpot,
    lifeguardSpot: landmarks.lifeguardSpot,
    barStoolSpots: landmarks.barStoolSpots,
    patioTerraceSpots: landmarks.patioTerraceSpots,
    picnicTerraceSpots: landmarks.picnicTerraceSpots,
    pierFisherSpots: landmarks.pierFisherSpots,
    waterBeachBall: props.waterBeachBall,
    beachFrisbee: props.beachFrisbee,
    hammockSpots: landmarks.hammockSpots,
    coffeeCartDeckTop: landmarks.coffeeCartDeckTop,
    eastOverlookDeckTop: landmarks.eastOverlookDeckTop,
    soccerBall: landmarks.soccerBallMesh
  });
  scene.add(npcs.group);

  // 12. Clean, Dynamics-Compressed Spatial Web Audio Engine (Real recorded coastal & underwater MP3s)
  const sound = new SoundEngine();

  // 13. Player Character & Damped Spring-Arm Camera Controller (Walkable Wood Decks + Swimming/Diving + Kayak + Sit/Lounge!)
  const player = new PlayerController(canvas, scene);
  const emptyCafeSeats: InteractiveSitSpot[] = [];
  if (landmarks.patioTerraceSpots.length > 1) {
    // East Café Table 1: chair c2 is occupied by NPC, so chair c1 (local -0.11, +0.56) is EMPTY!
    const sp = landmarks.patioTerraceSpots[1];
    const cosY = Math.cos(sp.yaw);
    const sinY = Math.sin(sp.yaw);
    emptyCafeSeats.push({
      label: 'Sit at Café Table',
      x: sp.x + -0.11 * cosY + 0.56 * sinY,
      y: sp.y,
      z: sp.z - -0.11 * sinY + 0.56 * cosY,
      yaw: sp.yaw + Math.PI,
      pose: 'sit_chair',
      exitBack: true
    });
  }
  if (landmarks.patioTerraceSpots.length > 2) {
    // East Café Table 2: chair c1 is occupied by NPC, so chair c2 (local +0.07, -0.51) is EMPTY!
    const sp = landmarks.patioTerraceSpots[2];
    const cosY = Math.cos(sp.yaw);
    const sinY = Math.sin(sp.yaw);
    emptyCafeSeats.push({
      label: 'Sit at Café Table',
      x: sp.x + 0.07 * cosY - 0.51 * sinY,
      y: sp.y,
      z: sp.z - 0.07 * sinY - 0.51 * cosY,
      yaw: sp.yaw,
      pose: 'sit_chair',
      exitBack: true
    });
  }

  const sitSpots: InteractiveSitSpot[] = [
    ...landmarks.hammockSpots.map((hs) => ({
      label: 'Relax in Hammock',
      x: hs.x,
      y: hs.y - 0.04,
      z: hs.z,
      yaw: hs.yaw + Math.PI * 0.5,
      pose: 'sunbathe' as const
    })),
    // Seated squarely ON TOP of forward-facing painted wooden bench slats (+Z toward ocean, feet flat on planks!)
    { label: 'Sit on Overlook Bench', x: 47.2, y: landmarks.eastOverlookDeckTop.y, z: -29.78, yaw: 0, pose: 'sit_chair' },
    { label: 'Sit on Overlook Bench', x: 50.2, y: landmarks.eastOverlookDeckTop.y, z: -29.78, yaw: 0, pose: 'sit_chair' },
    { label: 'Sit on Boardwalk Bench', x: -42.0, y: getBoardwalkY(-42.0), z: -25.55, yaw: 0, pose: 'sit_chair' },
    { label: 'Sit on Boardwalk Bench', x: 40.0, y: getBoardwalkY(40.0), z: -25.55, yaw: 0, pose: 'sit_chair' },
    // Ocean Pier benches looking West (-X) over the turquoise cove (dead-center on 23.38 bench seat, feet flat on 2.15 deck!)
    { label: 'Sit on Pier Bench', x: 23.30, y: 2.15, z: 4.8, yaw: -Math.PI * 0.5, pose: 'sit_chair' },
    { label: 'Sit on Pier Bench', x: 23.30, y: 2.15, z: 13.4, yaw: -Math.PI * 0.5, pose: 'sit_chair' },
    // Both front & rear benches on EVERY Picnic Terrace Table (dead-center on z ± 0.84 wooden bench planks, backward stand-up exit!)
    ...landmarks.picnicTerraceSpots.flatMap((sp) => [
      { label: 'Sit at Picnic Table', x: sp.x + 0.35, y: sp.y, z: sp.z + 0.84, yaw: Math.PI, pose: 'sit_chair' as const, exitBack: true },
      { label: 'Sit at Picnic Table', x: sp.x - 0.35, y: sp.y, z: sp.z + 0.84, yaw: Math.PI, pose: 'sit_chair' as const, exitBack: true },
      { label: 'Sit at Picnic Table', x: sp.x + 0.42, y: sp.y, z: sp.z - 0.84, yaw: 0, pose: 'sit_chair' as const, exitBack: true }
    ]),
    // Empty Café Patio Terrace chairs (exact unoccupied chair coordinates, backward stand-up exit!)
    ...emptyCafeSeats
  ];
  player.setInteractiveSpots(
    sitSpots,
    landmarks.kayakLaunchPos,
    landmarks.telescopePos,
    interactiveWorld.treasurePos
  );
  player.floatRingRef = {
    pos: props.floatRingPos,
    mesh: props.floatRingMesh,
    setRiderActive: (v: boolean) => {
      props.floatRingRiderActive = v;
    }
  };
  player.kickBallPosRef = interactiveWorld.kickBallPos;
  player.isTreasureOpened = () => interactiveWorld.treasureOpened;
  player.onVolleyBeachBall = () => {
    interactiveWorld.kickBeachBall(player.position, 9.6, sound, camera.position, camera.quaternion);
  };
  player.onOrderDrink = (venue) => {
    hud.showDiscoveryToast(
      venue === 'tiki'
        ? '🍹 Served Chilled Mango Passion Smoothie — 12s Tropical Speed Boost!'
        : '☕ Served Iced Coconut Espresso — 12s Coastal Energy Boost!'
    );
  };
  player.onBonfireStrum = () => {
    landmarks.stokeBonfire();
    hud.showDiscoveryToast('🎸 Strumming Hawaiian Ukulele by the crackling Bonfire!');
  };
  player.onOpenTreasure = () => {
    if (interactiveWorld.openSunkenTreasure(particles, sound)) {
      hud.showDiscoveryToast('💎 Unlocked the Sunken Reef Treasure Chest!');
    }
  };
  player.onBlowBubbleRing = (origin, forward) => {
    interactiveWorld.blowBubbleRing(origin, forward, sound);
  };
  player.onTelescopeChange = (active) => {
    hud.setTelescopeActive(active);
  };

  // 14. Multi-Stage Refraction + Underwater Optics + Volumetric God Rays + FXAA 3.11 Pipeline
  const postProcess = new UnderwaterPostProcess(renderer, window.innerWidth, window.innerHeight);
  ocean.setSharedMaps(atmosphere.skyCubeTexture, terrain.noiseTexture);
  postProcess.setNoiseTexture(terrain.noiseTexture);

  // Inland-only groups culled during the half-res water refraction pre-pass for huge FPS gain!
  const cullInRefraction: THREE.Object3D[] = [
    landmarks.group,
    props.group,
    coastalModels.group,
    wildlife.skyGroup,
    wildlife.horizonGroup,
    interactiveWorld.group,
    interactiveWorld.waterGroup,
    foliage.palmsGroup,
    npcs.landGroup
  ];

  let waveIntensity = 1.0;
  let dayCycleActive = false;
  let sunProgressVal = 48;

  // 15. Real-Time GPGPU 2D Shallow-Water Wave-Equation Ripple & Body-Collision Simulation
  const waterRippleSim = new WaterRippleSim();

  // 15b. Minimal Glassmorphic HUD
  const hud = new HudController({
    onSunChange: (progress) => {
      sunProgressVal = progress;
      atmosphere.setSunProgress(progress);
      hud.setSunLabel(atmosphere.getClockLabel());
    },
    onWaveChange: (intensity) => {
      waveIntensity = intensity;
    },
    onVolumeChange: (vol) => {
      sound.setVolume(vol);
    },
    onToggleCamera: () => player.togglePerspective(),
    onToggleMute: () => sound.toggleMute(),
    onToggleAA: () => postProcess.toggleAntiAliasing(window.innerWidth, window.innerHeight),
    onToggleMouseLock: () => player.toggleMouseLock(),
    onEnterCove: (startAtSunset) => {
      sound.unlock();
      if (startAtSunset) {
        sunProgressVal = 92;
        atmosphere.setSunProgress(92, true);
        hud.syncSun(92, atmosphere.getClockLabel());
      }
      player.enterPlayMode(false);
    },
    onWeatherChange: (mode) => {
      interactiveWorld.setWeather(mode, sound);
      if (mode === 'breeze') waveIntensity = 1.45;
      else if (mode === 'mist') waveIntensity = 0.75;
      else waveIntensity = 1.0;
      hud.syncWaveIntensity(waveIntensity);
    },
    onToggleDayCycle: () => {
      dayCycleActive = !dayCycleActive;
      return dayCycleActive;
    },
    onSavePostcard: () => {
      const sunDirNow = atmosphere.sunDirection;
      const sunColNow = atmosphere.sunColor;
      postProcess.render(
        renderer,
        scene,
        camera,
        ocean,
        elapsedTime,
        waveIntensity,
        sunDirNow,
        sunColNow,
        cullInRefraction,
        player.surfaceWetness,
        atmosphere.fogColor
      );
      const a = document.createElement('a');
      a.download = 'NeonCove_Postcard.png';
      a.href = canvas.toDataURL('image/png');
      a.click();
      sound.playCameraShutter();
      hud.showDiscoveryToast('📷 Saved NeonCove_Postcard.png');
    },
    onTeleport: (spotId) => {
      sound.unlock();
      const spots: Record<string, [number, number, number, number, number]> = {
        bay: [0, getTerrainHeight(0, -10.5), -10.5, 0.0, 0.16],
        tiki: [-22.0, getTerrainHeight(-22.0, -22.5), -22.5, Math.PI, 0.14],
        coffee: [-47.5, getTerrainHeight(-47.5, -22.5), -22.5, Math.PI, 0.14],
        fort: [-52.0, getTerrainHeight(-52.0, -33.5), -33.5, -2.2, 0.12],
        slide: [-22.0, 3.76, 1.85, 0.0, 0.22],
        raft: [-2.0, 0.48, 21.5, Math.PI, 0.14],
        east: [48.5, getTerrainHeight(48.5, -21.0), -21.0, 0.35, 0.14],
        reef: [2.0, -2.0, 35.0, 0.15, 0.08]
      };
      const sp = spots[spotId];
      if (sp) player.teleportTo(sp[0], sp[1], sp[2], sp[3], sp[4]);
    }
  });
  hud.syncSun(48, atmosphere.getClockLabel());
  hud.setMouseLockLabel(player.mouseLockEnabled);
  hud.setShellCount(0, interactiveWorld.shells.length, interactiveWorld.shells);

  interactiveWorld.onShellCollected = (shell, count, total) => {
    hud.setShellCount(count, total, interactiveWorld.shells);
    hud.showDiscoveryToast(
      count === total
        ? `✦ ALL ${total} GOLDEN SHELLS DISCOVERED! Master of Neon Cove!`
        : `✦ Discovered Golden Shell — ${shell.name} (${count}/${total})`
    );
  };

  player.patrolLifeguardPosGetter = () => npcs.getPatrolLifeguardPos();
  player.onOutfitChanged = (label) => {
    hud.showDiscoveryToast(`🏖️ Changed into ${label}!`);
  };
  player.onChatLifeguard = () => {
    const waveMeters = (0.45 * waveIntensity).toFixed(1);
    const nearShell = interactiveWorld.getNearestUncollectedShell(player.position);
    const shellHint = nearShell
      ? `Tip: Check ${nearShell.name} for a hidden shell!`
      : 'All 10 Golden Shells found — legend of the bay!';
    hud.showDiscoveryToast(
      `🛟 Patrol Lifeguard: Swell ${waveMeters}m • Water 26°C • Swim safely inside the red/white buoys! ${shellHint}`
    );
  };

  const compassLandmarks: Array<{ name: string; x: number; z: number }> = [
    { name: 'West Stone Fort', x: -58.5, z: -40.5 },
    { name: 'Beach Cabanas', x: -54.5, z: -34.5 },
    { name: 'Palm Hammocks', x: -57.3, z: -30.0 },
    { name: 'Coffee Cart', x: -47.5, z: -29.0 },
    { name: 'Bonfire Ring', x: -38.5, z: -19.2 },
    { name: 'Neon Tiki Bar', x: -22.0, z: -29.5 },
    { name: 'Water Slide', x: -22.0, z: 3.5 },
    { name: 'Entry Archway', x: 0.0, z: -35.0 },
    { name: 'Lifeguard Tower', x: -2.0, z: -30.0 },
    { name: 'Swim Raft', x: -2.0, z: 21.5 },
    { name: 'Volleyball Court', x: 5.0, z: -14.5 },
    { name: 'Ocean Pier', x: 22.0, z: 12.0 },
    { name: 'Kayak Cove', x: 46.5, z: -6.2 },
    { name: 'East Overlook', x: 48.5, z: -29.0 },
    { name: 'East Lighthouse', x: 78.0, z: -14.0 }
  ];

  player.onFirstInteraction = () => {
    sound.unlock();
    hud.dismissPointerHint();
  };

  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    postProcess.setSize(w, h);
  });

  let lastTime = performance.now();
  let elapsedTime = 0;
  let hudAccum = 0;
  let smoothedFps = 60;

  const animate = (now: number) => {
    requestAnimationFrame(animate);

    const rawDt = (now - lastTime) * 0.001;
    lastTime = now;
    if (rawDt > 0.0005 && rawDt < 0.5) {
      smoothedFps = THREE.MathUtils.lerp(smoothedFps, 1 / rawDt, 0.08);
    }
    const dt = Math.min(Math.max(rawDt, 0.0001), 0.05);
    elapsedTime += dt;

    if (dayCycleActive) {
      sunProgressVal = (sunProgressVal + dt * 2.8) % 100;
      atmosphere.setSunProgress(sunProgressVal);
    }

    const sunDir = atmosphere.sunDirection;
    const sunCol = atmosphere.sunColor;

    player.update(
      dt,
      elapsedTime,
      waveIntensity,
      camera,
      sunDir,
      sunCol,
      footprints,
      particles,
      waterFX,
      sound
    );

    npcs.update(
      dt,
      elapsedTime,
      waveIntensity,
      sunDir,
      sunCol,
      footprints,
      particles,
      waterFX,
      player.position,
      sound,
      camera.position,
      camera.quaternion
    );

    footprints.update(renderer, dt, elapsedTime, waveIntensity);
    terrain.update(
      footprints.texture,
      elapsedTime,
      waveIntensity,
      sunDir,
      sunCol,
      atmosphere.sunLight.intensity
    );
    const pTerrH = getTerrainHeight(player.position.x, player.position.z);
    const pWaveH = sampleWave(player.position.x, player.position.z, elapsedTime, waveIntensity, pTerrH).height;
    const playerWaterDepth =
      player.mode === 'BOARDWALK' ? 0 : Math.max(0, pWaveH - Math.min(player.position.y, pTerrH));

    // Step Real-Time GPU 2D Wave-Equation Ripple & Body-Water Collision Simulation!
    waterRippleSim.beginFrame();
    if (player.mode === 'KAYAKING') {
      waterRippleSim.addPlayerBody(
        player.position.x,
        player.position.z,
        player.velocity.x,
        player.velocity.z,
        0.48,
        1.05
      );
    } else if (playerWaterDepth > 0.02 && player.position.y <= pWaveH + 0.18) {
      const isSwimmer = player.mode === 'SWIMMING' || player.mode === 'DIVING';
      const pStrength = isSwimmer
        ? THREE.MathUtils.clamp(0.42 + playerWaterDepth * 0.45, 0.42, 0.92)
        : THREE.MathUtils.clamp(0.28 + playerWaterDepth * 0.55, 0.28, 0.68);
      const pRad = isSwimmer ? 0.30 : 0.22;
      waterRippleSim.addPlayerBody(
        player.position.x,
        player.position.z,
        player.velocity.x,
        player.velocity.z,
        pRad,
        pStrength
      );
    }
    npcs.feedWaterBodies(waterRippleSim, player.position, elapsedTime, waveIntensity);
    waterRippleSim.step(renderer, dt, elapsedTime, player.position.x, Math.max(player.position.z, 2.0));
    ocean.setRippleMap(
      waterRippleSim.texture,
      waterRippleSim.center,
      waterRippleSim.simSize,
      waterRippleSim.resolution,
      waterRippleSim.playerBodyUniform,
      waterRippleSim.playerVelUniform,
      waterRippleSim.nearBodiesUniform
    );

    ocean.update(
      elapsedTime,
      waveIntensity,
      sunDir,
      sunCol,
      atmosphere.skyZenith,
      atmosphere.skyHorizon,
      atmosphere.fogColor
    );
    const showerActiveNow = npcs.isShowerOccupied() || player.isUsingShower;
    foliage.update(elapsedTime, waveIntensity, sunDir, sunCol);
    props.update(elapsedTime, waveIntensity, sunDir, sunCol, dt, player.position, player.velocity);
    landmarks.update(elapsedTime, waveIntensity, sunDir, sound, camera.position, camera.quaternion, showerActiveNow);
    coastalModels.update(sunDir, elapsedTime, waveIntensity);
    wildlife.update(elapsedTime, waveIntensity, player.position, sunDir);
    interactiveWorld.update(
      dt,
      elapsedTime,
      waveIntensity,
      sunDir,
      player.position,
      camera.position,
      camera.quaternion,
      waterFX,
      particles,
      sound
    );
    atmosphere.update(elapsedTime, player.position);
    particles.update(dt, elapsedTime, camera.position, waveIntensity, sunDir, sunCol);
    waterFX.update(dt, elapsedTime, waveIntensity);

    const camTerrain = getTerrainHeight(camera.position.x, camera.position.z);
    const waveInfo = sampleWave(camera.position.x, camera.position.z, elapsedTime, waveIntensity, camTerrain);
    const shoreProx = 1.0 - THREE.MathUtils.clamp(Math.abs(camera.position.z) / 56.0, 0, 1);
    sound.update(
      dt,
      elapsedTime,
      player.cameraSubmersion,
      waveInfo.swellPhase,
      waveIntensity,
      shoreProx,
      camera.position,
      camera.quaternion,
      sunDir.y,
      playerWaterDepth,
      player.waterMoveSpeed,
      showerActiveNow
    );

    // Subtle atmospheric fog boost during Coastal Mist weather!
    const fogObj = scene.fog as THREE.FogExp2 | null;
    if (fogObj) {
      const targetFog = interactiveWorld.weather === 'mist' ? 0.0046 : 0.00145;
      fogObj.density = THREE.MathUtils.lerp(fogObj.density, targetFog, 1.0 - Math.exp(-2.2 * dt));
    }

    postProcess.render(
      renderer,
      scene,
      camera,
      ocean,
      elapsedTime,
      waveIntensity,
      sunDir,
      sunCol,
      cullInRefraction,
      player.surfaceWetness,
      atmosphere.fogColor
    );

    hudAccum += dt;
    if (hudAccum >= 0.065) {
      hudAccum = 0;
      if (player.welcomeMode) {
        hud.updateLoadingProgress(coastalModels.loadedCount, 38);
      }
      const groundH = getTerrainHeight(player.position.x, player.position.z);
      hud.updateTelemetry(player.mode, groundH, player.cameraSubmersion, footprints.stampCount);
      hud.setActionPrompt(player.nearbyPrompt);
      hud.setSpeedBoostActive(player.speedBoostTimer);
      if (dayCycleActive) hud.syncSun(Math.round(sunProgressVal), atmosphere.getClockLabel());

      // Live Top-Center Compass & Nearest Landmark/Golden Shell Radar
      const headingDeg = (180 - THREE.MathUtils.radToDeg(player.camYaw) + 360) % 360;
      let nearestLm = compassLandmarks[0];
      let bestLmD2 = Infinity;
      for (let i = 0; i < compassLandmarks.length; i++) {
        const lm = compassLandmarks[i];
        const d2 = (lm.x - player.position.x) ** 2 + (lm.z - player.position.z) ** 2;
        if (d2 < bestLmD2) {
          bestLmD2 = d2;
          nearestLm = lm;
        }
      }
      const nearShell = interactiveWorld.getNearestUncollectedShell(player.position);
      const shellStr = nearShell
        ? `✦ ${Math.round(Math.hypot(nearShell.pos.x - player.position.x, nearShell.pos.z - player.position.z))}m`
        : '✦ All Found!';
      hud.updateCompass(headingDeg, `${nearestLm.name} (${Math.round(Math.sqrt(bestLmD2))}m)`, shellStr);
    }
  };

  requestAnimationFrame(animate);

  (window as unknown as Record<string, unknown>).__BEACH_DEMO__ = {
    getState: () => ({
      playerPos: player.position.toArray(),
      cameraPos: camera.position.toArray(),
      mode: player.mode,
      cameraSubmersion: player.cameraSubmersion,
      footprintStamps: footprints.stampCount,
      npcCount: npcs.agents.length,
      loadedModels: coastalModels.loadedCount,
      fps: Math.round(smoothedFps),
      drawCalls: postProcess.lastFrameDrawCalls,
      triangles: postProcess.lastFrameTriangles,
      lowPassHz: Math.round(sound.lowPassFrequency),
      audioActive: sound.isActive,
      ambientLoops: sound.ambientLoopsRunning,
      sunLabel: atmosphere.getLabel(),
      waveIntensity
    }),
    getAudioBreakdown: () => sound.getChannelBreakdown(),
    getNpcTelemetry: () => npcs.getPathingDiagnostics(),
    getPlayerPrompt: () => player.nearbyPrompt,
    setWeather: (mode: 'clear' | 'breeze' | 'mist') => {
      interactiveWorld.setWeather(mode, sound);
      waveIntensity = mode === 'breeze' ? 1.45 : mode === 'mist' ? 0.75 : 1.0;
      hud.syncWaveIntensity(waveIntensity);
    },
    teleport: (x: number, y: number, z: number, yaw = 0, pitch = 0.18) => {
      hud.dismissWelcome();
      player.teleportTo(x, y, z, yaw, pitch);
    },
    setSun: (progress: number) => {
      sunProgressVal = progress;
      atmosphere.setSunProgress(progress, true);
      hud.syncSun(progress, atmosphere.getClockLabel());
    },
    setWaveIntensity: (intensity: number) => {
      waveIntensity = intensity;
    },
    toggleFirstPerson: () => {
      hud.dismissWelcome();
      player.enterPlayMode(true);
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
    unlockAudio: () => {
      hud.dismissWelcome();
      player.enterPlayMode(true);
      sound.unlock();
    }
  };
}

bootstrap();
