import * as THREE from 'three';

type AudioKey =
  | 'oceanBirds'
  | 'closeWaves'
  | 'palmWind'
  | 'tropicalRain'
  | 'sandSteps'
  | 'underwaterAmb'
  | 'underwaterBubbles'
  | 'tikiMusic'
  | 'beachChatter'
  | 'volleyballHit'
  | 'beachballHit'
  | 'soccerKick'
  | 'bonfireCrackle'
  | 'tropicalBirds'
  | 'woodStep'
  | 'woodStep2'
  | 'stoneStep'
  | 'surfSplash'
  | 'plungeSplash'
  | 'ukuleleStrum1'
  | 'ukuleleStrum2'
  | 'drinkPour'
  | 'iceClink'
  | 'shellChime'
  | 'windChimes'
  | 'treasureCoins'
  | 'woodCreak'
  | 'bubblePop'
  | 'seagullCall1'
  | 'seagullCall2'
  | 'macawCall'
  | 'dolphinCall'
  | 'sunsetCrickets'
  | 'espressoBrew'
  | 'showerSpray'
  | 'biplaneProp'
  | 'cameraShutter'
  | 'buoyBell'
  | 'waterTreadLap'
  | 'pierWaterSlap'
  | 'rockSurfLap'
  | 'underwaterScubaBed'
  | 'underwaterExhale'
  | 'swimStroke1'
  | 'swimStroke2'
  | 'wadeSlosh'
  | 'ankleSplash'
  | 'surfaceEmerge'
  | 'deepWhaleCall'
  | 'lifeguardWhistle';

const AUDIO_FILES: Record<AudioKey, string> = {
  oceanBirds: './audio/ocean_waves_birds.mp3',
  closeWaves: './audio/close_waves.mp3',
  palmWind: './audio/palm_wind.mp3',
  tropicalRain: './audio/tropical_rain.mp3',
  sandSteps: './audio/sand_steps.mp3',
  underwaterAmb: './audio/underwater_ambience.mp3',
  underwaterBubbles: './audio/underwater_bubbles.mp3',
  tikiMusic: './audio/tiki_bar_music.mp3',
  beachChatter: './audio/beach_chatter.mp3',
  volleyballHit: './audio/volleyball_hit.mp3',
  beachballHit: './audio/beachball_hit.mp3',
  soccerKick: './audio/soccer_kick.mp3',
  bonfireCrackle: './audio/bonfire_crackle.mp3',
  tropicalBirds: './audio/tropical_birds.mp3',
  woodStep: './audio/wood_step.mp3',
  woodStep2: './audio/wood_step_2.mp3',
  stoneStep: './audio/stone_step.mp3',
  surfSplash: './audio/surf_splash.mp3',
  plungeSplash: './audio/plunge_splash.mp3',
  ukuleleStrum1: './audio/ukulele_strum_1.mp3',
  ukuleleStrum2: './audio/ukulele_strum_2.mp3',
  drinkPour: './audio/drink_pour.mp3',
  iceClink: './audio/ice_clink.mp3',
  shellChime: './audio/shell_chime.mp3',
  windChimes: './audio/wind_chimes.mp3',
  treasureCoins: './audio/treasure_coins.mp3',
  woodCreak: './audio/wood_creak.mp3',
  bubblePop: './audio/bubble_pop.mp3',
  seagullCall1: './audio/seagull_call_1.mp3',
  seagullCall2: './audio/seagull_call_2.mp3',
  macawCall: './audio/macaw_call.mp3',
  dolphinCall: './audio/dolphin_call.mp3',
  sunsetCrickets: './audio/sunset_crickets.mp3',
  espressoBrew: './audio/espresso_brew.mp3',
  showerSpray: './audio/shower_spray.mp3',
  biplaneProp: './audio/biplane_prop.mp3',
  cameraShutter: './audio/camera_shutter.mp3',
  buoyBell: './audio/buoy_bell.mp3',
  waterTreadLap: './audio/water_tread_lap.mp3',
  pierWaterSlap: './audio/pier_water_slap.mp3',
  rockSurfLap: './audio/rock_surf_lap.mp3',
  underwaterScubaBed: './audio/underwater_scuba_bed.mp3',
  underwaterExhale: './audio/underwater_exhale.mp3',
  swimStroke1: './audio/swim_stroke_1.mp3',
  swimStroke2: './audio/swim_stroke_2.mp3',
  wadeSlosh: './audio/wade_slosh.mp3',
  ankleSplash: './audio/ankle_splash.mp3',
  surfaceEmerge: './audio/surface_emerge.mp3',
  deepWhaleCall: './audio/deep_whale_call.mp3',
  lifeguardWhistle: './audio/lifeguard_whistle.mp3'
};

export interface ChannelStats {
  gain: number;
  rmsDb: number;
  peakDb: number;
}

export interface AudioBreakdown {
  volumePct: number;
  muted: boolean;
  lowPassHz: number;
  channels: Record<string, ChannelStats>;
}

/**
 * 100% Real-Recorded, Spatialized, Per-Channel Metered Coastal & Underwater Sound Engine:
 *  - ZERO synthesized oscillators and ZERO synthesized noise buffers anywhere!
 *  - 38 real field-recorded & studio-recorded MP3 clips spanning 13 live spatial ambient loops
 *    (ocean horizon, close surf, real canopy wind, real tropical rain, Tiki lounge, spatial crowd,
 *    bonfire crackle, tropical birds, Koshi wind chimes, evening sunset crickets, café espresso
 *    machine, outdoor beach shower spray, vintage biplane hum, & deep underwater ambience)
 *  - Dynamic organic wildlife & maritime one-shot call scheduler (overhead Herring Gulls, Scarlet
 *    Macaws over the palm dunes, Caribbean underwater dolphin vocalizations, East Channel Buoy
 *    metallic bell, and moored wooden rowboat hull creaks!)
 *  - Multi-sample real interactive SFX (wood/sand/wet/wade/stone footsteps, real ukulele strums,
 *    iced drink pour + ice clink, acoustic shell chime, wooden chest creak + coins, water bubble
 *    pop, dedicated soccer kick, Canon SLR camera shutter, splashes & plunges)
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private surfaceBus: GainNode | null = null;
  private surfaceLPF: BiquadFilterNode | null = null;
  private sfxBus: GainNode | null = null;

  private oceanBirdsGain: GainNode | null = null;
  private oceanBirdsPan: StereoPannerNode | null = null;
  private closeWavesGain: GainNode | null = null;
  private closeWavesPan: StereoPannerNode | null = null;
  private palmWindGain: GainNode | null = null;
  private palmWindFilter: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;
  private tikiMusicGain: GainNode | null = null;
  private tikiMusicFilter: BiquadFilterNode | null = null;
  private tikiMusicPan: StereoPannerNode | null = null;
  private beachChatterGain: GainNode | null = null;
  private beachChatterPan: StereoPannerNode | null = null;
  private bonfireCrackleGain: GainNode | null = null;
  private bonfireCracklePan: StereoPannerNode | null = null;
  private tropicalBirdsGain: GainNode | null = null;
  private tropicalBirdsPan: StereoPannerNode | null = null;
  private windChimesGain: GainNode | null = null;
  private windChimesPan: StereoPannerNode | null = null;
  private sunsetCricketsGain: GainNode | null = null;
  private espressoGain: GainNode | null = null;
  private espressoPan: StereoPannerNode | null = null;
  private showerGain: GainNode | null = null;
  private showerPan: StereoPannerNode | null = null;
  private biplaneGain: GainNode | null = null;
  private biplanePan: StereoPannerNode | null = null;
  private waterTreadGain: GainNode | null = null;
  private pierWaterGain: GainNode | null = null;
  private pierWaterPan: StereoPannerNode | null = null;
  private rockSurfGain: GainNode | null = null;
  private rockSurfPan: StereoPannerNode | null = null;
  private underwaterScubaGain: GainNode | null = null;
  private underwaterAmbGain: GainNode | null = null;

  private readonly _camRight = new THREE.Vector3(1, 0, 0);
  private readonly _tmpToSrc = new THREE.Vector3();

  private readonly channelAnalysers = new Map<
    string,
    { analyser: AnalyserNode; gainNode: GainNode; isMaster?: boolean; isSurface?: boolean }
  >();
  private readonly meterScratch = new Float32Array(2048);

  private readonly buffers = new Map<AudioKey, AudioBuffer>();
  private readonly bufferOnsets = new Map<AudioKey, number>();
  private rainLevel = 0;
  private loadingStarted = false;

  private oceanBirdsStarted = false;
  private closeWavesStarted = false;
  private palmWindStarted = false;
  private rainStarted = false;
  private underwaterStarted = false;
  private tikiMusicStarted = false;
  private beachChatterStarted = false;
  private bonfireStarted = false;
  private birdsStarted = false;
  private windChimesStarted = false;
  private cricketsStarted = false;
  private espressoStarted = false;
  private showerStarted = false;
  private biplaneStarted = false;
  private waterTreadStarted = false;
  private pierWaterStarted = false;
  private rockSurfStarted = false;
  private scubaBedStarted = false;

  private initialized = false;
  private muted = false;
  private volume = 0.35; // Comfortably balanced 35% default
  private currentCutoff = 18000;
  private lastSubT = 0;

  private lastStepTime = -10;
  private lastSplashTime = -10;
  private lastStrokeTime = -10;
  private lastBubbleTime = -10;
  private lastWhistleTime = -10;
  private lastEmergeTime = -10;
  private lastGullCallAt = 3.5;
  private lastMacawCallAt = 8.0;
  private lastDolphinCallAt = 4.0;
  private lastWhaleCallAt = 11.0;
  private lastBuoyBellAt = 5.0;
  private lastBoatCreakAt = 4.5;
  private ukuleleToggle = 0;
  private woodStepToggle = 0;
  private swimStrokeToggle = 0;
  private gullToggle = 0;
  private readonly lastBallHitByKind: Record<string, number> = {};

  public get isMuted(): boolean {
    return this.muted;
  }

  public get masterVolume(): number {
    return this.volume;
  }

  public get isActive(): boolean {
    return this.initialized && this.ctx?.state === 'running';
  }

  public get lowPassFrequency(): number {
    return this.currentCutoff;
  }

  public get ambientLoopsRunning(): {
    oceanBirds: boolean;
    closeWaves: boolean;
    underwater: boolean;
    palmWind: boolean;
    tikiMusic: boolean;
    beachChatter: boolean;
    bonfireCrackle: boolean;
    tropicalBirds: boolean;
    windChimes: boolean;
    sunsetCrickets: boolean;
    espressoBrew: boolean;
    showerSpray: boolean;
    biplaneProp: boolean;
    tropicalRain: boolean;
    waterTreadLap: boolean;
    pierWaterSlap: boolean;
    rockSurfLap: boolean;
    underwaterScubaBed: boolean;
  } {
    return {
      oceanBirds: this.oceanBirdsStarted,
      closeWaves: this.closeWavesStarted,
      underwater: this.underwaterStarted,
      palmWind: this.palmWindStarted,
      tikiMusic: this.tikiMusicStarted,
      beachChatter: this.beachChatterStarted,
      bonfireCrackle: this.bonfireStarted,
      tropicalBirds: this.birdsStarted,
      windChimes: this.windChimesStarted,
      sunsetCrickets: this.cricketsStarted,
      espressoBrew: this.espressoStarted,
      showerSpray: this.showerStarted,
      biplaneProp: this.biplaneStarted,
      tropicalRain: this.rainStarted,
      waterTreadLap: this.waterTreadStarted,
      pierWaterSlap: this.pierWaterStarted,
      rockSurfLap: this.rockSurfStarted,
      underwaterScubaBed: this.scubaBedStarted
    };
  }

  private get effectiveMasterGain(): number {
    if (this.muted) return 0.0001;
    // Calm, breathable headroom so every spatial sound shines without clutter
    return Math.max(0.0001, this.volume * 0.56);
  }

  private computeStereoPan(
    srcX: number,
    srcZ: number,
    cameraPos?: THREE.Vector3,
    cameraQuat?: THREE.Quaternion
  ): number {
    if (!cameraPos || !cameraQuat) return 0;
    this._camRight.set(1, 0, 0).applyQuaternion(cameraQuat);
    this._camRight.y = 0;
    const rLen = this._camRight.length();
    if (rLen < 1e-4) return 0;
    this._camRight.divideScalar(rLen);
    this._tmpToSrc.set(srcX - cameraPos.x, 0, srcZ - cameraPos.z);
    const dist = this._tmpToSrc.length();
    if (dist < 0.5) return 0;
    this._tmpToSrc.divideScalar(dist);
    return THREE.MathUtils.clamp(this._tmpToSrc.dot(this._camRight) * 0.78, -0.78, 0.78);
  }

  private wireChannelWithMeter(
    ctx: AudioContext,
    name: string,
    gainNode: GainNode,
    dest: AudioNode,
    fftSize = 1024,
    opts: { isMaster?: boolean; isSurface?: boolean } = {}
  ): void {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = 0.25;
    gainNode.connect(analyser);
    analyser.connect(dest);
    this.channelAnalysers.set(name, {
      analyser,
      gainNode,
      isMaster: opts.isMaster,
      isSurface: opts.isSurface
    });
  }

  public getChannelBreakdown(): AudioBreakdown {
    const channels: Record<string, ChannelStats> = {};
    const masterScale = this.effectiveMasterGain;
    const masterDbOffset = 20 * Math.log10(Math.max(masterScale, 1e-5));
    const uwAttenDb = -14.0 * THREE.MathUtils.clamp(this.lastSubT, 0, 1);

    for (const [name, entry] of this.channelAnalysers.entries()) {
      const len = Math.min(entry.analyser.fftSize, this.meterScratch.length);
      const view = this.meterScratch.subarray(0, len);
      entry.analyser.getFloatTimeDomainData(view);
      let sumSq = 0;
      let peak = 0;
      for (let i = 0; i < len; i++) {
        const v = view[i];
        sumSq += v * v;
        const av = Math.abs(v);
        if (av > peak) peak = av;
      }
      const rms = Math.sqrt(sumSq / len);
      const offsetDb = entry.isMaster ? 0 : masterDbOffset + (entry.isSurface ? uwAttenDb : 0);
      const rmsDb = rms <= 1e-5 ? -100 : Math.max(-100, 20 * Math.log10(rms) + offsetDb);
      const peakDb = peak <= 1e-5 ? -120 : Math.max(-120, 20 * Math.log10(peak) + offsetDb);
      channels[name] = {
        gain: Number(entry.gainNode.gain.value.toFixed(3)),
        rmsDb: Number(rmsDb.toFixed(2)),
        peakDb: Number(peakDb.toFixed(2))
      };
    }

    return {
      volumePct: Math.round(this.volume * 100),
      muted: this.muted,
      lowPassHz: Math.round(this.currentCutoff),
      channels
    };
  }

  public setVolume(norm: number): void {
    this.volume = THREE.MathUtils.clamp(norm, 0, 1);
    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(this.effectiveMasterGain, now, 0.05);
    }
  }

  public unlock(): void {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      const ctx = new AudioCtx();
      this.ctx = ctx;

      this.masterGain = ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.masterGain.gain.linearRampToValueAtTime(this.effectiveMasterGain, ctx.currentTime + 0.45);
      this.wireChannelWithMeter(ctx, 'master', this.masterGain, ctx.destination, 2048, { isMaster: true });

      // Master aquatic Biquad Low-Pass Filter (18,000 Hz -> 320 Hz when diving underwater)
      this.surfaceLPF = ctx.createBiquadFilter();
      this.surfaceLPF.type = 'lowpass';
      this.surfaceLPF.frequency.setValueAtTime(18000, ctx.currentTime);
      this.surfaceLPF.Q.setValueAtTime(0.65, ctx.currentTime);
      this.surfaceLPF.connect(this.masterGain);

      this.surfaceBus = ctx.createGain();
      this.surfaceBus.gain.setValueAtTime(1.0, ctx.currentTime);
      this.surfaceBus.connect(this.surfaceLPF);

      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.setValueAtTime(1.0, ctx.currentTime);
      this.wireChannelWithMeter(ctx, 'sfxBus', this.sfxBus, this.surfaceBus, 2048, { isSurface: true });

      this.oceanBirdsGain = ctx.createGain();
      this.oceanBirdsGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.oceanBirdsPan = ctx.createStereoPanner();
      this.oceanBirdsPan.connect(this.surfaceBus);
      this.wireChannelWithMeter(ctx, 'oceanBirds', this.oceanBirdsGain, this.oceanBirdsPan, 1024, { isSurface: true });

      this.closeWavesGain = ctx.createGain();
      this.closeWavesGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.closeWavesPan = ctx.createStereoPanner();
      this.closeWavesPan.connect(this.surfaceBus);
      this.wireChannelWithMeter(ctx, 'closeWaves', this.closeWavesGain, this.closeWavesPan, 1024, { isSurface: true });

      this.palmWindFilter = ctx.createBiquadFilter();
      this.palmWindFilter.type = 'lowpass';
      this.palmWindFilter.frequency.setValueAtTime(980, ctx.currentTime);
      this.palmWindGain = ctx.createGain();
      this.palmWindGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.palmWindFilter.connect(this.palmWindGain);
      this.wireChannelWithMeter(ctx, 'palmWind', this.palmWindGain, this.surfaceBus, 1024, { isSurface: true });

      this.rainGain = ctx.createGain();
      this.rainGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.rainGain.connect(this.surfaceBus);

      this.tikiMusicFilter = ctx.createBiquadFilter();
      this.tikiMusicFilter.type = 'lowpass';
      this.tikiMusicFilter.frequency.setValueAtTime(14000, ctx.currentTime);
      this.tikiMusicFilter.Q.setValueAtTime(0.6, ctx.currentTime);
      this.tikiMusicGain = ctx.createGain();
      this.tikiMusicGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.tikiMusicPan = ctx.createStereoPanner();
      this.tikiMusicFilter.connect(this.tikiMusicGain);
      this.tikiMusicPan.connect(this.surfaceBus);
      this.wireChannelWithMeter(ctx, 'tikiMusic', this.tikiMusicGain, this.tikiMusicPan, 1024, { isSurface: true });

      this.beachChatterGain = ctx.createGain();
      this.beachChatterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.beachChatterPan = ctx.createStereoPanner();
      this.beachChatterPan.connect(this.surfaceBus);
      this.wireChannelWithMeter(ctx, 'beachChatter', this.beachChatterGain, this.beachChatterPan, 1024, { isSurface: true });

      this.bonfireCrackleGain = ctx.createGain();
      this.bonfireCrackleGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.bonfireCracklePan = ctx.createStereoPanner();
      this.bonfireCracklePan.connect(this.surfaceBus);
      this.wireChannelWithMeter(ctx, 'bonfireCrackle', this.bonfireCrackleGain, this.bonfireCracklePan, 1024, { isSurface: true });

      this.tropicalBirdsGain = ctx.createGain();
      this.tropicalBirdsGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.tropicalBirdsPan = ctx.createStereoPanner();
      this.tropicalBirdsPan.connect(this.surfaceBus);
      this.wireChannelWithMeter(ctx, 'tropicalBirds', this.tropicalBirdsGain, this.tropicalBirdsPan, 1024, { isSurface: true });

      // New localized spatial coastal soundscape beds (100% real recordings!)
      this.windChimesGain = ctx.createGain();
      this.windChimesGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.windChimesPan = ctx.createStereoPanner();
      this.windChimesGain.connect(this.windChimesPan);
      this.windChimesPan.connect(this.surfaceBus);

      this.sunsetCricketsGain = ctx.createGain();
      this.sunsetCricketsGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.sunsetCricketsGain.connect(this.surfaceBus);

      this.espressoGain = ctx.createGain();
      this.espressoGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.espressoPan = ctx.createStereoPanner();
      this.espressoGain.connect(this.espressoPan);
      this.espressoPan.connect(this.surfaceBus);

      this.showerGain = ctx.createGain();
      this.showerGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.showerPan = ctx.createStereoPanner();
      this.showerGain.connect(this.showerPan);
      this.showerPan.connect(this.surfaceBus);

      this.biplaneGain = ctx.createGain();
      this.biplaneGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.biplanePan = ctx.createStereoPanner();
      this.biplaneGain.connect(this.biplanePan);
      this.biplanePan.connect(this.surfaceBus);

      // Rich Real In-Water, Pier-Slap, Rocky-Surf & Deep-Scuba Audio Beds!
      this.waterTreadGain = ctx.createGain();
      this.waterTreadGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.waterTreadGain.connect(this.surfaceBus);

      this.pierWaterGain = ctx.createGain();
      this.pierWaterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.pierWaterPan = ctx.createStereoPanner();
      this.pierWaterGain.connect(this.pierWaterPan);
      this.pierWaterPan.connect(this.surfaceBus);

      this.rockSurfGain = ctx.createGain();
      this.rockSurfGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.rockSurfPan = ctx.createStereoPanner();
      this.rockSurfGain.connect(this.rockSurfPan);
      this.rockSurfPan.connect(this.surfaceBus);

      this.underwaterScubaGain = ctx.createGain();
      this.underwaterScubaGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.underwaterScubaGain.connect(this.masterGain);

      this.underwaterAmbGain = ctx.createGain();
      this.underwaterAmbGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.wireChannelWithMeter(ctx, 'underwater', this.underwaterAmbGain, this.masterGain, 1024);

      this.initialized = true;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      this.loadAllSamples(ctx);
    } catch {
      // Browser audio unavailable
    }
  }

  public setWeatherRain(norm: number): void {
    this.rainLevel = THREE.MathUtils.clamp(norm, 0, 1);
  }

  /**
   * Scans channel 0 for the exact acoustic transient onset so ball hits, footsteps, chimes,
   * shutters, and splashes never suffer from MP3 leading-silence desync!
   */
  private findSampleOnsetSec(buf: AudioBuffer): number {
    const ch = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
    }
    if (peak < 1e-4) return 0;
    const thresh = peak * 0.14;
    for (let i = 0; i < ch.length; i++) {
      if (Math.abs(ch[i]) >= thresh) {
        return Math.max(0, i / buf.sampleRate - 0.005);
      }
    }
    return 0;
  }

  private async loadAllSamples(ctx: AudioContext): Promise<void> {
    if (this.loadingStarted) return;
    this.loadingStarted = true;

    const onsetKeys = new Set<AudioKey>([
      'volleyballHit',
      'beachballHit',
      'soccerKick',
      'woodStep',
      'woodStep2',
      'stoneStep',
      'surfSplash',
      'plungeSplash',
      'shellChime',
      'bubblePop',
      'cameraShutter',
      'ukuleleStrum1',
      'ukuleleStrum2',
      'drinkPour',
      'iceClink',
      'treasureCoins',
      'woodCreak',
      'buoyBell',
      'swimStroke1',
      'swimStroke2',
      'wadeSlosh',
      'surfaceEmerge',
      'underwaterExhale',
      'lifeguardWhistle'
    ]);

    const entries = Object.entries(AUDIO_FILES) as Array<[AudioKey, string]>;
    await Promise.all(
      entries.map(async ([key, url]) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return;
          const arr = await res.arrayBuffer();
          const decoded = await ctx.decodeAudioData(arr);
          this.buffers.set(key, decoded);
          if (onsetKeys.has(key)) {
            this.bufferOnsets.set(key, this.findSampleOnsetSec(decoded));
          }
          this.tryStartAmbientLoop(key);
        } catch {
          // Graceful skip
        }
      })
    );
  }

  private tryStartAmbientLoop(key: AudioKey): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    if (key === 'oceanBirds' && !this.oceanBirdsStarted && this.oceanBirdsGain) {
      const buf = this.buffers.get('oceanBirds');
      if (!buf) return;
      this.oceanBirdsStarted = true;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 5.5;
      src.loopEnd = Math.max(12.0, buf.duration - 1.5);
      const rolloff = this.ctx.createBiquadFilter();
      rolloff.type = 'lowpass';
      rolloff.frequency.setValueAtTime(1650, now);
      rolloff.Q.setValueAtTime(0.5, now);
      src.connect(rolloff);
      rolloff.connect(this.oceanBirdsGain);
      src.start(now, 5.5);
      this.oceanBirdsGain.gain.setTargetAtTime(0.06, now, 0.65);
    }

    if (key === 'closeWaves' && !this.closeWavesStarted && this.closeWavesGain) {
      const buf = this.buffers.get('closeWaves');
      if (!buf) return;
      this.closeWavesStarted = true;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 1.0;
      src.loopEnd = Math.max(8.0, buf.duration - 1.0);
      const rolloff = this.ctx.createBiquadFilter();
      rolloff.type = 'lowpass';
      rolloff.frequency.setValueAtTime(1150, now);
      rolloff.Q.setValueAtTime(0.5, now);
      src.connect(rolloff);
      rolloff.connect(this.closeWavesGain);
      src.start(now, 1.0);
      this.closeWavesGain.gain.setTargetAtTime(0.014, now, 0.55);
    }

    if (key === 'palmWind' && !this.palmWindStarted && this.palmWindFilter) {
      const buf = this.buffers.get('palmWind');
      if (!buf) return;
      this.palmWindStarted = true;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0.5;
      src.loopEnd = Math.max(4.0, buf.duration - 0.8);
      src.connect(this.palmWindFilter);
      src.start(now, 0.5);
    }

    if (key === 'tropicalRain' && !this.rainStarted && this.rainGain) {
      const buf = this.buffers.get('tropicalRain');
      if (!buf) return;
      this.rainStarted = true;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0.5;
      src.loopEnd = Math.max(4.0, buf.duration - 0.8);
      const rainHpf = this.ctx.createBiquadFilter();
      rainHpf.type = 'highpass';
      rainHpf.frequency.setValueAtTime(320, now);
      src.connect(rainHpf);
      rainHpf.connect(this.rainGain);
      src.start(now, 0.5);
    }

    if (key === 'tikiMusic' && !this.tikiMusicStarted && this.tikiMusicFilter) {
      const buf = this.buffers.get('tikiMusic');
      if (!buf) return;
      this.tikiMusicStarted = true;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0.2;
      src.loopEnd = Math.max(8.0, buf.duration - 0.3);
      src.connect(this.tikiMusicFilter);
      src.start(now, 0.2);
    }

    if (key === 'beachChatter' && !this.beachChatterStarted && this.beachChatterGain) {
      const buf = this.buffers.get('beachChatter');
      if (!buf) return;
      this.beachChatterStarted = true;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0.5;
      src.loopEnd = Math.max(8.0, buf.duration - 0.5);
      const hpf = this.ctx.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.setValueAtTime(250, now);
      const lpf = this.ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.setValueAtTime(5200, now);
      src.connect(hpf);
      hpf.connect(lpf);
      lpf.connect(this.beachChatterGain);
      src.start(now, 0.5);
      this.beachChatterGain.gain.setTargetAtTime(0.22, now, 0.45);
    }

    if (key === 'bonfireCrackle' && !this.bonfireStarted && this.bonfireCrackleGain) {
      const buf = this.buffers.get('bonfireCrackle');
      if (!buf) return;
      this.bonfireStarted = true;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0.3;
      src.loopEnd = Math.max(4.0, buf.duration - 0.3);
      src.connect(this.bonfireCrackleGain);
      src.start(now, 0.3);
    }

    if (key === 'tropicalBirds' && !this.birdsStarted && this.tropicalBirdsGain) {
      const buf = this.buffers.get('tropicalBirds');
      if (!buf) return;
      this.birdsStarted = true;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0.2;
      src.loopEnd = Math.max(2.0, buf.duration - 0.2);
      const birdHpf = this.ctx.createBiquadFilter();
      birdHpf.type = 'highpass';
      birdHpf.frequency.setValueAtTime(700, now);
      src.connect(birdHpf);
      birdHpf.connect(this.tropicalBirdsGain);
      src.start(now, 0.2);
    }

    if (key === 'windChimes' && !this.windChimesStarted && this.windChimesGain) {
      const buf = this.buffers.get('windChimes');
      if (!buf) return;
      this.windChimesStarted = true;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0.5;
      src.loopEnd = Math.max(4.0, buf.duration - 0.8);
      const hpf = this.ctx.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.setValueAtTime(420, now);
      src.connect(hpf);
      hpf.connect(this.windChimesGain);
      src.start(now, 0.5);
    }

    if (key === 'sunsetCrickets' && !this.cricketsStarted && this.sunsetCricketsGain) {
      const buf = this.buffers.get('sunsetCrickets');
      if (!buf) return;
      this.cricketsStarted = true;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0.4;
      src.loopEnd = Math.max(4.0, buf.duration - 0.8);
      const hpf = this.ctx.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.setValueAtTime(1200, now);
      src.connect(hpf);
      hpf.connect(this.sunsetCricketsGain);
      src.start(now, 0.4);
    }

    if (key === 'espressoBrew' && !this.espressoStarted && this.espressoGain) {
      const buf = this.buffers.get('espressoBrew');
      if (!buf) return;
      this.espressoStarted = true;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0.5;
      src.loopEnd = Math.max(4.0, buf.duration - 0.8);
      const lpf = this.ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.setValueAtTime(3400, now);
      src.connect(lpf);
      lpf.connect(this.espressoGain);
      src.start(now, 0.5);
    }

    if (key === 'showerSpray' && !this.showerStarted && this.showerGain) {
      const buf = this.buffers.get('showerSpray');
      if (!buf) return;
      this.showerStarted = true;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0.5;
      src.loopEnd = Math.max(4.0, buf.duration - 0.8);
      const lpf = this.ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.setValueAtTime(4200, now);
      src.connect(lpf);
      lpf.connect(this.showerGain);
      src.start(now, 0.5);
    }

    if (key === 'biplaneProp' && !this.biplaneStarted && this.biplaneGain) {
      const buf = this.buffers.get('biplaneProp');
      if (!buf) return;
      this.biplaneStarted = true;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0.5;
      src.loopEnd = Math.max(4.0, buf.duration - 0.8);
      const lpf = this.ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.setValueAtTime(620, now);
      src.connect(lpf);
      lpf.connect(this.biplaneGain);
      src.start(now, 0.5);
    }

    if (key === 'underwaterAmb' && !this.underwaterStarted && this.underwaterAmbGain) {
      const buf = this.buffers.get('underwaterAmb');
      if (!buf) return;
      this.underwaterStarted = true;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const uwLPF = this.ctx.createBiquadFilter();
      uwLPF.type = 'lowpass';
      uwLPF.frequency.setValueAtTime(950, now);
      src.connect(uwLPF);
      uwLPF.connect(this.underwaterAmbGain);
      src.start(now, 1.2);
    }

    if (key === 'waterTreadLap' && !this.waterTreadStarted && this.waterTreadGain) {
      const buf = this.buffers.get('waterTreadLap');
      if (!buf) return;
      this.waterTreadStarted = true;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0.5;
      src.loopEnd = Math.max(4.0, buf.duration - 0.8);
      const lpf = this.ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.setValueAtTime(2400, now);
      src.connect(lpf);
      lpf.connect(this.waterTreadGain);
      src.start(now, 0.5);
    }

    if (key === 'pierWaterSlap' && !this.pierWaterStarted && this.pierWaterGain) {
      const buf = this.buffers.get('pierWaterSlap');
      if (!buf) return;
      this.pierWaterStarted = true;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0.5;
      src.loopEnd = Math.max(4.0, buf.duration - 0.8);
      const lpf = this.ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.setValueAtTime(2200, now);
      src.connect(lpf);
      lpf.connect(this.pierWaterGain);
      src.start(now, 0.5);
    }

    if (key === 'rockSurfLap' && !this.rockSurfStarted && this.rockSurfGain) {
      const buf = this.buffers.get('rockSurfLap');
      if (!buf) return;
      this.rockSurfStarted = true;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0.5;
      src.loopEnd = Math.max(4.0, buf.duration - 0.8);
      const lpf = this.ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.setValueAtTime(1900, now);
      src.connect(lpf);
      lpf.connect(this.rockSurfGain);
      src.start(now, 0.5);
    }

    if (key === 'underwaterScubaBed' && !this.scubaBedStarted && this.underwaterScubaGain) {
      const buf = this.buffers.get('underwaterScubaBed');
      if (!buf) return;
      this.scubaBedStarted = true;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0.6;
      src.loopEnd = Math.max(4.0, buf.duration - 0.8);
      const lpf = this.ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.setValueAtTime(1150, now);
      src.connect(lpf);
      lpf.connect(this.underwaterScubaGain);
      src.start(now, 0.6);
    }
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(this.effectiveMasterGain, now, 0.04);
    }
    return this.muted;
  }

  public update(
    dt: number,
    elapsedTime: number,
    cameraSubmersion: number,
    swellPhase: number,
    waveIntensity: number,
    shoreProximity: number,
    cameraPos?: THREE.Vector3,
    cameraQuat?: THREE.Quaternion,
    sunElevY = 0.72,
    playerWaterDepth = 0.0,
    playerMoveSpeed = 0.0,
    showerActive = true
  ): void {
    const subT = THREE.MathUtils.clamp((cameraSubmersion + 0.06) / 0.24, 0, 1);
    this.lastSubT = subT;
    const targetCutoff = THREE.MathUtils.lerp(18000, 320, subT);
    this.currentCutoff = THREE.MathUtils.lerp(
      this.currentCutoff,
      targetCutoff,
      1.0 - Math.exp(-dt / 0.085)
    );

    if (!this.initialized || !this.ctx || !this.surfaceLPF) return;

    const now = this.ctx.currentTime;
    this.surfaceLPF.frequency.setTargetAtTime(targetCutoff, now, 0.085);

    const wScale = THREE.MathUtils.clamp(waveIntensity, 0.4, 1.85);
    const prox = THREE.MathUtils.clamp(shoreProximity, 0, 1);
    const duskT = 1.0 - THREE.MathUtils.smoothstep(sunElevY, 0.06, 0.34);

    // 1. Calm horizon ocean bed (warm & unobtrusive, gently panned toward seaward horizon)
    if (this.oceanBirdsGain && this.oceanBirdsStarted) {
      const oceanLevel = (0.084 + 0.126 * prox) * (0.76 + 0.24 * wScale) * (1.0 - subT * 0.78);
      this.oceanBirdsGain.gain.setTargetAtTime(oceanLevel, now, 0.20);
      if (this.oceanBirdsPan && cameraPos) {
        const pan = this.computeStereoPan(cameraPos.x, cameraPos.z + 30.0, cameraPos, cameraQuat);
        this.oceanBirdsPan.pan.setTargetAtTime(pan * 0.45, now, 0.20);
      }
    }

    // 2. Soft low-passed shoreline surf swells (strictly localized to water's edge)
    if (this.closeWavesGain && this.closeWavesStarted) {
      const swell = (0.096 + 0.106 * Math.pow(swellPhase, 1.25)) * wScale * (prox * prox);
      this.closeWavesGain.gain.setTargetAtTime(swell * (1.0 - subT * 0.72), now, 0.16);
      if (this.closeWavesPan && cameraPos) {
        const pan = this.computeStereoPan(cameraPos.x, 4.0, cameraPos, cameraQuat);
        this.closeWavesPan.pan.setTargetAtTime(pan * 0.55, now, 0.16);
      }
    }

    // 3. Real recorded coastal canopy wind breeze (subtle inland palm rustle)
    if (this.palmWindGain && this.palmWindFilter && this.palmWindStarted) {
      const gust = 0.5 + 0.5 * Math.sin(elapsedTime * 0.36) * Math.cos(elapsedTime * 0.21);
      const duneProx = cameraPos ? THREE.MathUtils.clamp((-cameraPos.z - 6.0) / 36.0, 0.10, 1.0) : 0.4;
      const windLevel = (0.022 + 0.034 * gust) * duneProx * (1.0 - subT * 0.94);
      this.palmWindGain.gain.setTargetAtTime(windLevel, now, 0.28);
      this.palmWindFilter.frequency.setTargetAtTime(680 + gust * 620, now, 0.30);
    }

    // 4. Real Neon Tiki Bar island lounge track (tight acoustic zone + directional stereo pan)
    if (this.tikiMusicGain && this.tikiMusicFilter && cameraPos) {
      const distBar = Math.hypot(cameraPos.x - -22.0, cameraPos.z - -29.5);
      const barProx = THREE.MathUtils.clamp(1.0 - (distBar - 5.5) / 24.5, 0, 1);
      const barGain = barProx * barProx * 0.56 * (1.0 - subT * 0.96);
      this.tikiMusicGain.gain.setTargetAtTime(barGain, now, 0.20);
      this.tikiMusicFilter.frequency.setTargetAtTime(THREE.MathUtils.lerp(1800, 15500, barProx), now, 0.20);
      if (this.tikiMusicPan) {
        this.tikiMusicPan.pan.setTargetAtTime(
          this.computeStereoPan(-22.0, -29.5, cameraPos, cameraQuat),
          now,
          0.14
        );
      }
    }

    // 5. Crisp spatial crowd chatter localized strictly to real gathering hubs
    if (this.beachChatterGain) {
      let socialProx = 0.06;
      let nearestX = -22.0;
      let nearestZ = -28.0;
      if (cameraPos) {
        const hubs: Array<[number, number, number]> = [
          [-22.0, -28.0, 18.0], // Neon Tiki Bar & Pergola
          [-47.5, -28.0, 14.0], // West Coffee & Smoothie Cart Deck
          [0.0, -21.0, 19.0],   // Boardwalk & Lifeguard Plaza
          [10.0, -14.0, 17.0],  // Volleyball & Central Camps
          [-34.0, -14.0, 16.0], // West Camps & Bonfire
          [48.5, -24.0, 15.0]   // East Overlook & Soccer Kickabout
        ];
        for (const [hx, hz, rad] of hubs) {
          const d = Math.hypot(cameraPos.x - hx, cameraPos.z - hz);
          const p = THREE.MathUtils.clamp(1.0 - d / rad, 0, 1);
          if (p > socialProx) {
            socialProx = p;
            nearestX = hx;
            nearestZ = hz;
          }
        }
      }
      const chatGain = (0.028 + 0.26 * socialProx * socialProx) * (1.0 - subT * 0.95);
      this.beachChatterGain.gain.setTargetAtTime(chatGain, now, 0.22);
      if (this.beachChatterPan && cameraPos) {
        this.beachChatterPan.pan.setTargetAtTime(
          this.computeStereoPan(nearestX, nearestZ, cameraPos, cameraQuat) * 0.65,
          now,
          0.18
        );
      }
    }

    // 6. Real crackling driftwood bonfire (tight cozy hearth radius around -38.5, -19.2)
    if (this.bonfireCrackleGain && this.bonfireStarted && cameraPos) {
      const distFire = Math.hypot(cameraPos.x - -38.5, cameraPos.z - -19.2);
      const fireProx = THREE.MathUtils.clamp(1.0 - (distFire - 2.0) / 15.5, 0, 1);
      const fireGain = fireProx * fireProx * 0.56 * (1.0 - subT * 0.96);
      this.bonfireCrackleGain.gain.setTargetAtTime(fireGain, now, 0.18);
      if (this.bonfireCracklePan) {
        this.bonfireCracklePan.pan.setTargetAtTime(
          this.computeStereoPan(-38.5, -19.2, cameraPos, cameraQuat),
          now,
          0.14
        );
      }
    }

    // 7. Gentle tropical palm-grove songbirds (soft natural breathing cadence inland)
    if (this.tropicalBirdsGain && this.birdsStarted && cameraPos) {
      const palmProx = THREE.MathUtils.clamp(1.0 - (cameraPos.z + 24.0) / 48.0, 0.08, 1.0);
      const birdPhrase = 0.52 + 0.48 * Math.sin(elapsedTime * 0.42) * Math.sin(elapsedTime * 0.17 + 1.1);
      const birdGain = (0.014 + 0.095 * palmProx * birdPhrase) * (1.0 - duskT * 0.65) * (1.0 - subT * 0.96);
      this.tropicalBirdsGain.gain.setTargetAtTime(birdGain, now, 0.24);
      if (this.tropicalBirdsPan) {
        this.tropicalBirdsPan.pan.setTargetAtTime(
          this.computeStereoPan(cameraPos.x + Math.sin(elapsedTime * 0.12) * 14.0, -40.0, cameraPos, cameraQuat) * 0.55,
          now,
          0.26
        );
      }
    }

    // 8. Real Koshi Bamboo/Acoustic Wind Chimes at East Lagoon Overlook (48.5,-28.9) & West Hammock Grove (-48.5,-13.5)
    if (this.windChimesGain && this.windChimesStarted && cameraPos) {
      const dEast = Math.hypot(cameraPos.x - 48.5, cameraPos.z - -28.9);
      const dWest = Math.hypot(cameraPos.x - -48.5, cameraPos.z - -13.5);
      const nearX = dEast <= dWest ? 48.5 : -48.5;
      const nearZ = dEast <= dWest ? -28.9 : -13.5;
      const dMin = Math.min(dEast, dWest);
      const chimeProx = THREE.MathUtils.clamp(1.0 - (dMin - 2.0) / 14.0, 0, 1);
      const breezeSwirl = 0.45 + 0.55 * Math.sin(elapsedTime * 0.31 + 0.6) ** 2;
      const chimeGain = chimeProx * chimeProx * 0.24 * breezeSwirl * (1.0 - subT * 0.96);
      this.windChimesGain.gain.setTargetAtTime(chimeGain, now, 0.25);
      if (this.windChimesPan) {
        this.windChimesPan.pan.setTargetAtTime(
          this.computeStereoPan(nearX, nearZ, cameraPos, cameraQuat),
          now,
          0.18
        );
      }
    }

    // 9. Real Evening Sunset Crickets Chorus (crossfades in naturally during Golden Hour & Sunset over the dunes!)
    if (this.sunsetCricketsGain && this.cricketsStarted && cameraPos) {
      const duneProx = THREE.MathUtils.clamp((-cameraPos.z + 4.0) / 38.0, 0.15, 1.0);
      const cricketGain = duskT * duneProx * 0.14 * (1.0 - subT * 0.96);
      this.sunsetCricketsGain.gain.setTargetAtTime(cricketGain, now, 0.35);
    }

    // 10. Real Café Espresso Machine Brewing/Steaming strictly at West Coffee Cart Deck (-47.5, -28.9)
    if (this.espressoGain && this.espressoStarted && cameraPos) {
      const dEsp = Math.hypot(cameraPos.x - -47.5, cameraPos.z - -28.9);
      const espProx = THREE.MathUtils.clamp(1.0 - (dEsp - 1.5) / 10.5, 0, 1);
      const espPulse = 0.45 + 0.55 * Math.max(0, Math.sin(elapsedTime * 0.22));
      this.espressoGain.gain.setTargetAtTime(espProx * espProx * 0.22 * espPulse * (1.0 - subT * 0.96), now, 0.22);
      if (this.espressoPan) {
        this.espressoPan.pan.setTargetAtTime(
          this.computeStereoPan(-47.5, -28.9, cameraPos, cameraQuat),
          now,
          0.16
        );
      }
    }

    // 11. Real Outdoor Beach Rinse Shower Water Spray strictly at (-18.2, -22.6) — ONLY runs when occupied!
    if (this.showerGain && this.showerStarted && cameraPos) {
      const dShow = Math.hypot(cameraPos.x - -18.2, cameraPos.z - -22.6);
      const showProx = THREE.MathUtils.clamp(1.0 - (dShow - 1.2) / 8.5, 0, 1);
      const activeMult = showerActive ? 1.0 : 0.0001;
      this.showerGain.gain.setTargetAtTime(showProx * showProx * 0.22 * activeMult * (1.0 - subT * 0.96), now, 0.24);
      if (this.showerPan) {
        this.showerPan.pan.setTargetAtTime(
          this.computeStereoPan(-18.2, -22.6, cameraPos, cameraQuat),
          now,
          0.14
        );
      }
    }

    // 12. Subtle Distant Vintage Biplane Propeller Hum tracking the live "NEON COVE" plane!
    if (this.biplaneGain && this.biplaneStarted && cameraPos) {
      const cycle = (elapsedTime * 0.011 + 0.35) % 1.0;
      const planeX = THREE.MathUtils.lerp(-185, 185, cycle);
      const planeZ = 148;
      const dPlane = Math.hypot(cameraPos.x - planeX, cameraPos.z - planeZ);
      const planeProx = THREE.MathUtils.clamp(1.0 - (dPlane - 120) / 105, 0, 1);
      this.biplaneGain.gain.setTargetAtTime(planeProx * planeProx * 0.032 * (1.0 - subT * 0.96), now, 0.35);
      if (this.biplanePan) {
        this.biplanePan.pan.setTargetAtTime(
          this.computeStereoPan(planeX, planeZ, cameraPos, cameraQuat) * 0.7,
          now,
          0.25
        );
      }
    }

    // 13. Calm deep underwater ambient bed + Real Ocean Scuba Diving Underwater Layer!
    if (this.underwaterAmbGain && this.underwaterStarted) {
      const uwBoost = THREE.MathUtils.clamp(cameraSubmersion * 0.04, 0, 0.12);
      this.underwaterAmbGain.gain.setTargetAtTime(
        subT > 0.02 ? (0.64 + uwBoost) * subT : 0.0001,
        now,
        0.10
      );
    }
    if (this.underwaterScubaGain && this.scubaBedStarted) {
      const scubaT = THREE.MathUtils.clamp((cameraSubmersion - 0.10) / 0.65, 0, 1);
      this.underwaterScubaGain.gain.setTargetAtTime(
        scubaT > 0.02 ? 0.28 * scubaT : 0.0001,
        now,
        0.16
      );
    }

    // 13b. Real Progressive In-Water Lapping & Leg-Drag Wake Swish
    // Starts smoothly right at 3cm ankle depth (no silent dead-zone!) and builds naturally with movement & depth
    if (this.waterTreadGain && this.waterTreadStarted) {
      const shallowEnter = THREE.MathUtils.clamp((playerWaterDepth - 0.03) / 0.28, 0, 1);
      const deepBuoy = THREE.MathUtils.clamp((playerWaterDepth - 0.35) / 0.65, 0, 1);
      const moveBoost = THREE.MathUtils.clamp(playerMoveSpeed / 3.0, 0, 1.15);
      const basePresence = shallowEnter * (0.22 + 0.55 * moveBoost) + deepBuoy * 0.45;
      const clampedPresence = THREE.MathUtils.clamp(basePresence, 0, 1.15) * (1.0 - subT * 0.92);
      const lapPulse = 0.78 + 0.22 * Math.sin(elapsedTime * 1.65);
      this.waterTreadGain.gain.setTargetAtTime(
        clampedPresence > 0.015 ? 0.26 * clampedPresence * lapPulse : 0.0001,
        now,
        0.12
      );
    }

    // 13c. Localized Real Pier Piling & Moored Boat Water-Slapping (strictly around Ocean Pier x=17..26, z=4..25!)
    if (this.pierWaterGain && this.pierWaterStarted && cameraPos) {
      const clampedZ = THREE.MathUtils.clamp(cameraPos.z, 4.0, 24.5);
      const dPier = Math.hypot(cameraPos.x - 21.0, cameraPos.z - clampedZ);
      const pierProx = THREE.MathUtils.clamp(1.0 - (dPier - 2.5) / 14.0, 0, 1);
      this.pierWaterGain.gain.setTargetAtTime(
        pierProx * pierProx * 0.11 * wScale * (1.0 - subT * 0.95),
        now,
        0.22
      );
      if (this.pierWaterPan) {
        this.pierWaterPan.pan.setTargetAtTime(
          this.computeStereoPan(21.0, clampedZ, cameraPos, cameraQuat),
          now,
          0.16
        );
      }
    }

    // 13d. Localized Real Rocky Headland Coastal Surf Lapping (strictly along West/East Headland cliffs |x|>44, z=-4..24!)
    if (this.rockSurfGain && this.rockSurfStarted && cameraPos) {
      const headX = cameraPos.x < 0 ? -60.0 : 60.0;
      const clampedZ = THREE.MathUtils.clamp(cameraPos.z, -4.0, 22.0);
      const dRock = Math.hypot(cameraPos.x - headX, cameraPos.z - clampedZ);
      const rockProx = THREE.MathUtils.clamp(1.0 - (dRock - 4.0) / 22.0, 0, 1);
      this.rockSurfGain.gain.setTargetAtTime(
        rockProx * rockProx * 0.14 * wScale * (1.0 - subT * 0.95),
        now,
        0.24
      );
      if (this.rockSurfPan) {
        this.rockSurfPan.pan.setTargetAtTime(
          this.computeStereoPan(headX, clampedZ, cameraPos, cameraQuat),
          now,
          0.18
        );
      }
    }

    // 14. Real Passing Sunshower Tropical Rainfall (silent unless Weather = Sunshower!)
    if (this.rainGain && this.rainStarted) {
      const rGain = this.rainLevel > 0.01 ? 0.36 * this.rainLevel * (1.0 - subT * 0.94) : 0.0001;
      this.rainGain.gain.setTargetAtTime(rGain, now, 0.28);
    }

    // 15. Dynamic Organic Real Wildlife & Maritime One-Shot Call Scheduler!
    this.updateAmbientWildlifeEvents(elapsedTime, cameraSubmersion, subT, cameraPos, cameraQuat);
  }

  private updateAmbientWildlifeEvents(
    elapsedTime: number,
    cameraSubmersion: number,
    subT: number,
    cameraPos?: THREE.Vector3,
    cameraQuat?: THREE.Quaternion
  ): void {
    if (!this.ctx || !this.sfxBus || !this.masterGain || this.muted || !cameraPos) return;

    // A) Occasional real European Herring Seagull cries panning overhead across the sunlit bay
    if (subT < 0.2 && elapsedTime - this.lastGullCallAt > 11.5) {
      this.lastGullCallAt = elapsedTime + Math.random() * 6.5;
      const key: AudioKey = this.gullToggle++ % 2 === 0 ? 'seagullCall1' : 'seagullCall2';
      const gullX = cameraPos.x + (Math.random() - 0.5) * 44;
      const gullZ = cameraPos.z + 12 + Math.random() * 26;
      const pan = this.computeStereoPan(gullX, gullZ, cameraPos, cameraQuat);
      this.playCleanSlice(key, this.sfxBus, 0.065, 0.2 + Math.random() * 2.2, 2.2, 0.95, 1.08, 4200, pan);
    }

    // B) Occasional real Scarlet Macaw calls when strolling near the rear palm dunes
    if (subT < 0.2 && cameraPos.z < -12 && elapsedTime - this.lastMacawCallAt > 16.0) {
      this.lastMacawCallAt = elapsedTime + Math.random() * 8.0;
      const macX = (Math.random() - 0.5) * 46;
      const macZ = -38;
      const pan = this.computeStereoPan(macX, macZ, cameraPos, cameraQuat);
      this.playCleanSlice('macawCall', this.sfxBus, 0.055, 0.15 + Math.random() * 1.1, 1.65, 0.96, 1.06, 3600, pan);
    }

    // C) Real Caribbean Underwater Dolphin vocalizations + Distant Deep-Ocean Whale Calls while diving in the reef!
    if (cameraSubmersion > 0.35 && elapsedTime - this.lastDolphinCallAt > 7.5) {
      this.lastDolphinCallAt = elapsedTime + Math.random() * 5.0;
      const pan = (Math.random() - 0.5) * 1.1;
      this.playCleanSlice(
        'dolphinCall',
        this.masterGain,
        0.13,
        0.4 + Math.random() * 5.5,
        2.8,
        0.92,
        1.05,
        2400,
        pan
      );
    }
    if (cameraSubmersion > 0.85 && elapsedTime - this.lastWhaleCallAt > 14.0) {
      this.lastWhaleCallAt = elapsedTime + Math.random() * 7.5;
      const pan = (Math.random() - 0.5) * 1.3;
      this.playCleanSlice('deepWhaleCall', this.masterGain, 0.14, 0.1, 3.6, 0.78, 0.92, 1450, pan);
    }

    // D) Real Distant Sea-Buoy Metallic Bell tolling softly near the bobbing East Channel Buoy (31.5, 19.5)
    const dBuoy = Math.hypot(cameraPos.x - 31.5, cameraPos.z - 19.5);
    if (subT < 0.2 && dBuoy < 32.0 && elapsedTime - this.lastBuoyBellAt > 9.5) {
      this.lastBuoyBellAt = elapsedTime + Math.random() * 5.0;
      const att = THREE.MathUtils.clamp(1.0 - dBuoy / 32.0, 0, 1);
      const pan = this.computeStereoPan(31.5, 19.5, cameraPos, cameraQuat);
      const onset = this.bufferOnsets.get('buoyBell') ?? 0.0;
      this.playCleanSlice('buoyBell', this.sfxBus, 0.09 * att * att, onset, 2.4, 0.52, 0.58, 1650, pan);
    }

    // E) Gentle real wooden boat hull creak near the Moored Rowboat & Ocean Pier (17.4, 11.2)
    const dBoat = Math.hypot(cameraPos.x - 17.4, cameraPos.z - 11.2);
    if (subT < 0.2 && dBoat < 14.0 && elapsedTime - this.lastBoatCreakAt > 7.5) {
      this.lastBoatCreakAt = elapsedTime + Math.random() * 4.5;
      const att = THREE.MathUtils.clamp(1.0 - dBoat / 14.0, 0, 1);
      const pan = this.computeStereoPan(17.4, 11.2, cameraPos, cameraQuat);
      const onset = this.bufferOnsets.get('woodCreak') ?? 0.0;
      this.playCleanSlice('woodCreak', this.sfxBus, 0.085 * att * att, onset, 1.25, 0.72, 0.86, 1300, pan);
    }
  }

  private playCleanSlice(
    key: AudioKey,
    dest: AudioNode,
    gainVal: number,
    startOffset: number,
    duration: number,
    rateMin: number,
    rateMax: number,
    lowPassHz?: number,
    pan?: number
  ): void {
    if (!this.ctx || this.muted || gainVal < 0.001) return;
    const buf = this.buffers.get(key);
    if (!buf) return;

    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.setValueAtTime(rateMin + Math.random() * (rateMax - rateMin), now);

    const actualDur = Math.min(duration, Math.max(0.08, buf.duration - 0.02));
    const safeOffset = Math.min(Math.max(0, startOffset), Math.max(0, buf.duration - actualDur));
    const fadeIn = Math.min(0.010, actualDur * 0.10);
    const fadeOutStart = Math.max(fadeIn + 0.015, actualDur * 0.65);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(gainVal, now + fadeIn);
    env.gain.setValueAtTime(gainVal, now + fadeOutStart);
    env.gain.exponentialRampToValueAtTime(0.0001, now + actualDur);

    let tail: AudioNode = src;
    if (lowPassHz) {
      const lpf = this.ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.setValueAtTime(lowPassHz, now);
      tail.connect(lpf);
      tail = lpf;
    }
    tail.connect(env);
    if (pan !== undefined && Math.abs(pan) > 0.01) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime(THREE.MathUtils.clamp(pan, -0.85, 0.85), now);
      env.connect(panner);
      panner.connect(dest);
    } else {
      env.connect(dest);
    }
    src.start(now, safeOffset, actualDur + 0.03);
  }

  public playFootstep(surface: 'dry' | 'wet' | 'ankle' | 'wade' | 'wood' | 'stone', volume = 0.75): void {
    if (!this.initialized || !this.ctx || !this.sfxBus || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastStepTime < 0.23) return;
    this.lastStepTime = now;

    if (surface === 'dry') {
      const off = 1.25 + Math.random() * 4.5;
      this.playCleanSlice('sandSteps', this.sfxBus, 0.20 * volume, off, 0.17, 1.00, 1.18, 2800);
    } else if (surface === 'wet') {
      const off = 0.6 + Math.random() * 4.8;
      this.playCleanSlice('sandSteps', this.sfxBus, 0.18 * volume, off, 0.15, 0.84, 0.98, 1700);
    } else if (surface === 'ankle') {
      // Crisp real shallow-water ankle splash in the very first patches of swash (0.015m..0.22m)!
      const key: AudioKey = this.buffers.has('ankleSplash') ? 'ankleSplash' : 'wadeSlosh';
      const baseOnset = this.bufferOnsets.get(key) ?? 0.08;
      // Rotate through 4 distinct clean splash bursts inside the real recording for natural variety
      const offsets = [baseOnset, baseOnset + 1.4, baseOnset + 3.1, baseOnset + 5.0];
      const off = offsets[this.woodStepToggle++ % offsets.length];
      this.playCleanSlice(key, this.sfxBus, 0.22 * volume, off, 0.26, 1.02, 1.24, 3400);
    } else if (surface === 'wood') {
      // Alternate between two distinct real wood plank recordings for natural non-repetitive steps!
      const useAlt = this.woodStepToggle++ % 2 === 1 && this.buffers.has('woodStep2');
      const key: AudioKey = useAlt ? 'woodStep2' : 'woodStep';
      const onset = this.bufferOnsets.get(key) ?? 0.0;
      this.playCleanSlice(
        key,
        this.sfxBus,
        (useAlt ? 0.17 : 0.22) * volume,
        onset,
        useAlt ? 0.16 : 0.18,
        useAlt ? 0.88 : 0.92,
        useAlt ? 1.06 : 1.12,
        1550
      );
    } else if (surface === 'stone') {
      const onset = this.bufferOnsets.get('stoneStep') ?? 0.0;
      this.playCleanSlice('stoneStep', this.sfxBus, 0.22 * volume, onset, 0.18, 0.90, 1.12, 2600);
    } else {
      // Dedicated real deeper calf/knee/thigh wading slosh (clean onset + rich low-mid water body)!
      const key: AudioKey = this.buffers.has('wadeSlosh') ? 'wadeSlosh' : 'ankleSplash';
      const onset = this.bufferOnsets.get(key) ?? 0.12;
      const off = onset + (this.woodStepToggle++ % 3) * 0.85;
      this.playCleanSlice(key, this.sfxBus, 0.26 * volume, off, 0.36, 0.86, 1.05, 2200);
    }
  }

  public playSplash(intensity = 0.6): void {
    if (!this.initialized || !this.ctx || !this.sfxBus || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastSplashTime < 0.70) return;
    this.lastSplashTime = now;

    const clamped = THREE.MathUtils.clamp(intensity, 0.25, 0.95);
    const onset = this.bufferOnsets.get('surfSplash') ?? 0.0;
    this.playCleanSlice('surfSplash', this.sfxBus, 0.34 * clamped, onset, 0.85, 0.92, 1.08, 3200);
  }

  public playPlungeSplash(intensity = 1.0): void {
    if (!this.initialized || !this.ctx || !this.sfxBus || this.muted) return;
    const clamped = THREE.MathUtils.clamp(intensity, 0.35, 1.25);
    const onset = this.bufferOnsets.get('plungeSplash') ?? 0.0;
    this.playCleanSlice('plungeSplash', this.sfxBus, 0.46 * clamped, onset, 1.45, 0.94, 1.06, 3600);
  }

  public playPaddleStroke(intensity = 0.65): void {
    if (!this.initialized || !this.ctx || !this.sfxBus || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastStrokeTime < 0.42) return;
    this.lastStrokeTime = now;
    const onset = this.bufferOnsets.get('surfSplash') ?? 0.08;
    this.playCleanSlice('surfSplash', this.sfxBus, 0.18 * intensity, onset + Math.random() * 0.15, 0.34, 0.82, 0.98, 1800);
  }

  /** Real acoustic chime recording when discovering a Golden Seashell! */
  public playCollectChime(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const onset = this.bufferOnsets.get('shellChime') ?? 0.0;
    this.playCleanSlice('shellChime', this.masterGain, 0.42, onset, 1.9, 0.98, 1.05, 6500);
  }

  /** Real acoustic Hawaiian ukulele chord strums (alternates 2 genuine recordings!) at the Bonfire Pit! */
  public playUkuleleChord(): void {
    if (!this.initialized || !this.ctx || !this.sfxBus || this.muted) return;
    const key: AudioKey = this.ukuleleToggle++ % 2 === 0 ? 'ukuleleStrum1' : 'ukuleleStrum2';
    const onset = this.bufferOnsets.get(key) ?? 0.0;
    this.playCleanSlice(key, this.sfxBus, 0.42, onset, 2.4, 0.97, 1.04, 5200);
  }

  /** Real cold iced drink pouring + real ice cube glass clink at Tiki Bar & West Coffee Cart! */
  public playDrinkSip(): void {
    if (!this.initialized || !this.ctx || !this.sfxBus || this.muted) return;
    const pourOnset = this.bufferOnsets.get('drinkPour') ?? 0.0;
    const iceOnset = this.bufferOnsets.get('iceClink') ?? 0.0;
    this.playCleanSlice('drinkPour', this.sfxBus, 0.38, pourOnset, 1.8, 0.96, 1.05, 5800);
    this.playCleanSlice('iceClink', this.sfxBus, 0.28, iceOnset, 1.1, 0.95, 1.08, 6500);
  }

  /** Real creaking wooden chest lid + rattling real coins + underwater bubbles! */
  public playTreasureOpen(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    this.playBubbleBurst(1.0);
    const creakOnset = this.bufferOnsets.get('woodCreak') ?? 0.0;
    const coinsOnset = this.bufferOnsets.get('treasureCoins') ?? 0.0;
    const chimeOnset = this.bufferOnsets.get('shellChime') ?? 0.0;
    this.playCleanSlice('woodCreak', this.masterGain, 0.28, creakOnset, 1.1, 0.82, 0.92, 1600);
    this.playCleanSlice('treasureCoins', this.masterGain, 0.44, coinsOnset, 2.0, 0.95, 1.05, 4800);
    this.playCleanSlice('shellChime', this.masterGain, 0.26, chimeOnset, 1.8, 1.04, 1.08, 5200);
  }

  /** Real recorded water bubble pop when pressing [F] underwater! */
  public playBubbleRing(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const onset = this.bufferOnsets.get('bubblePop') ?? 0.0;
    this.playCleanSlice('bubblePop', this.masterGain, 0.40, onset, 0.55, 0.86, 1.12, 2200);
  }

  /** Real mechanical Canon SLR camera shutter click for Photo Mode [P] & Brass Telescope [E]! */
  public playCameraShutter(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const onset = this.bufferOnsets.get('cameraShutter') ?? 0.0;
    this.playCleanSlice('cameraShutter', this.masterGain, 0.34, onset, 0.75, 0.98, 1.03, 7200);
  }

  /** Subtle real wooden settle creak when sitting on benches or hammocks! */
  public playWoodSettle(): void {
    if (!this.initialized || !this.ctx || !this.sfxBus || this.muted) return;
    const onset = this.bufferOnsets.get('woodCreak') ?? 0.0;
    this.playCleanSlice('woodCreak', this.sfxBus, 0.16, onset, 0.65, 0.92, 1.08, 1650);
  }

  public playBallHit(
    worldPos: THREE.Vector3,
    listenerPos?: THREE.Vector3,
    kind: 'volleyball' | 'beachball' | 'soccer' | 'player_ball' = 'volleyball',
    cameraQuat?: THREE.Quaternion
  ): void {
    if (!this.initialized || !this.ctx || !this.sfxBus || this.muted) return;
    const now = this.ctx.currentTime;
    const lastT = this.lastBallHitByKind[kind] ?? -10;
    if (now - lastT < 0.24) return;

    // Tight localized range + steep cubic distance rolloff + distance low-pass so balls never boom across the map!
    const maxDist = kind === 'volleyball' ? 20.0 : kind === 'player_ball' ? 22.0 : kind === 'beachball' ? 21.0 : 18.0;
    const dist = listenerPos ? worldPos.distanceTo(listenerPos) : 10.0;
    if (dist > maxDist) return;
    this.lastBallHitByKind[kind] = now;

    const atten = THREE.MathUtils.clamp(1.0 - dist / maxDist, 0, 1);
    const cubic = atten * atten * atten;
    const baseGain =
      kind === 'volleyball' ? 0.34 : kind === 'player_ball' ? 0.36 : kind === 'soccer' ? 0.32 : 0.42;
    const gain = cubic * baseGain;
    if (gain < 0.004) return;

    const sampleKey: AudioKey =
      kind === 'soccer'
        ? 'soccerKick'
        : kind === 'beachball' || kind === 'player_ball'
          ? 'beachballHit'
          : 'volleyballHit';
    const onset = this.bufferOnsets.get(sampleKey) ?? 0.0;
    const distLpf =
      kind === 'soccer'
        ? THREE.MathUtils.lerp(850, 3200, atten)
        : THREE.MathUtils.lerp(950, 6200, atten);
    const pan = listenerPos
      ? this.computeStereoPan(worldPos.x, worldPos.z, listenerPos, cameraQuat)
      : 0;

    this.playCleanSlice(
      sampleKey,
      this.sfxBus,
      gain,
      onset,
      kind === 'soccer' ? 0.32 : kind === 'beachball' || kind === 'player_ball' ? 0.24 : 0.28,
      kind === 'soccer' ? 0.92 : 0.94,
      kind === 'soccer' ? 1.08 : 1.08,
      distLpf,
      pan
    );
  }

  /** Real dedicated swimming strokes (alternating L/R real water strokes at surface + muffled scuba exhale submerged!) */
  public playSwimStroke(underwater: boolean, intensity = 0.7): void {
    if (!this.initialized || !this.ctx || !this.masterGain || !this.sfxBus || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastStrokeTime < 0.42) return;
    this.lastStrokeTime = now;

    if (underwater) {
      // Muffled deep underwater arm-pull + occasional real scuba/diver bubble exhale
      const key: AudioKey = this.buffers.has('swimStroke1') ? 'swimStroke1' : 'surfSplash';
      const onset = this.bufferOnsets.get(key) ?? 0.05;
      this.playCleanSlice(key, this.masterGain, 0.26 * intensity, onset, 0.48, 0.68, 0.84, 440);
      if (this.swimStrokeToggle++ % 2 === 0 && this.buffers.has('underwaterExhale')) {
        const exOnset = this.bufferOnsets.get('underwaterExhale') ?? 0.0;
        this.playCleanSlice('underwaterExhale', this.masterGain, 0.22 * intensity, exOnset, 0.55, 0.88, 1.06, 980);
      }
    } else {
      const key: AudioKey =
        this.swimStrokeToggle++ % 2 === 0 && this.buffers.has('swimStroke1')
          ? 'swimStroke1'
          : this.buffers.has('swimStroke2')
            ? 'swimStroke2'
            : 'surfSplash';
      const onset = this.bufferOnsets.get(key) ?? 0.04;
      const pan = this.swimStrokeToggle % 2 === 0 ? -0.24 : 0.24; // Subtle alternating L/R arm stereo feel!
      this.playCleanSlice(key, this.sfxBus, 0.28 * intensity, onset, 0.52, 0.90, 1.10, 2900, pan);
    }
  }

  /** Crisp real water surface-emerge splash the instant your head breaks back above the waves! */
  public playSurfaceEmerge(): void {
    if (!this.initialized || !this.ctx || !this.sfxBus || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastEmergeTime < 0.85) return;
    this.lastEmergeTime = now;
    const key: AudioKey = this.buffers.has('surfaceEmerge') ? 'surfaceEmerge' : 'surfSplash';
    const onset = this.bufferOnsets.get(key) ?? 0.0;
    this.playCleanSlice(key, this.sfxBus, 0.34, onset, 0.72, 0.94, 1.08, 3600);
  }

  /** Real spatialized lifeguard whistle blown by Autonomous Patrol Lifeguard #2! */
  public playLifeguardWhistle(
    worldPos: THREE.Vector3,
    listenerPos?: THREE.Vector3,
    cameraQuat?: THREE.Quaternion
  ): void {
    if (!this.initialized || !this.ctx || !this.sfxBus || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastWhistleTime < 4.5) return;
    const maxDist = 42.0;
    const dist = listenerPos ? worldPos.distanceTo(listenerPos) : 14.0;
    if (dist > maxDist) return;
    this.lastWhistleTime = now;

    const att = THREE.MathUtils.clamp(1.0 - dist / maxDist, 0, 1);
    const gain = att * att * 0.20;
    if (gain < 0.006) return;
    const onset = this.bufferOnsets.get('lifeguardWhistle') ?? 0.0;
    const pan = listenerPos
      ? this.computeStereoPan(worldPos.x, worldPos.z, listenerPos, cameraQuat)
      : 0;
    const lpf = THREE.MathUtils.lerp(1800, 5600, att);
    this.playCleanSlice('lifeguardWhistle', this.sfxBus, gain, onset, 0.92, 0.97, 1.04, lpf, pan);
  }

  public playBubbleBurst(intensity = 0.6): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastBubbleTime < 0.6) return;
    this.lastBubbleTime = now;

    this.playCleanSlice('underwaterBubbles', this.masterGain, 0.14 * intensity, 0.12, 0.42, 0.92, 1.12, 1500);
  }
}
