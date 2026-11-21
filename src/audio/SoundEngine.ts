import * as THREE from 'three';

type AudioKey =
  | 'oceanBirds'
  | 'closeWaves'
  | 'sandSwish'
  | 'sandSteps'
  | 'waterSplash'
  | 'waterJump'
  | 'underwaterAmb'
  | 'underwaterBubbles';

const AUDIO_FILES: Record<AudioKey, string> = {
  oceanBirds: './audio/ocean_waves_birds.mp3',
  closeWaves: './audio/close_waves.mp3',
  sandSwish: './audio/sand_swish.mp3',
  sandSteps: './audio/sand_steps.mp3',
  waterSplash: './audio/water_splash.mp3',
  waterJump: './audio/water_jump.mp3',
  underwaterAmb: './audio/underwater_ambience.mp3',
  underwaterBubbles: './audio/underwater_bubbles.mp3'
};

/**
 * Sample-Based Spatial Web Audio API Engine using real recorded coastal & underwater audio:
 *  - Above water: real ocean waves + distant coastal birds loop, close shoreline surf swells
 *    modulated smoothly by live wave cycle & distance to shoreline, realistic granular sand
 *    footstep slices, and authentic seawater wading splashes.
 *  - Underwater transition: smoothly sweeps a Biquad Low-Pass Filter from 18,000 Hz down
 *    to 320 Hz over ~250ms while crossfading into real recorded underwater ambience,
 *    muffled swim strokes, and deep underwater bubble bursts!
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private surfaceBus: GainNode | null = null;
  private surfaceLPF: BiquadFilterNode | null = null;

  private oceanBirdsGain: GainNode | null = null;
  private closeWavesGain: GainNode | null = null;
  private underwaterAmbGain: GainNode | null = null;

  private readonly buffers = new Map<AudioKey, AudioBuffer>();
  private loadingStarted = false;
  private loopsStarted = false;

  private initialized = false;
  private muted = false;
  private currentCutoff = 18000;

  public get isMuted(): boolean {
    return this.muted;
  }

  public get isActive(): boolean {
    return this.initialized && this.ctx?.state === 'running';
  }

  public get lowPassFrequency(): number {
    return this.currentCutoff;
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
      this.masterGain.gain.exponentialRampToValueAtTime(
        this.muted ? 0.0001 : 0.85,
        ctx.currentTime + 0.45
      );
      this.masterGain.connect(ctx.destination);

      // Master surface aquatic Biquad Low-Pass Filter (18,000 Hz -> 320 Hz on dive)
      this.surfaceLPF = ctx.createBiquadFilter();
      this.surfaceLPF.type = 'lowpass';
      this.surfaceLPF.frequency.setValueAtTime(18000, ctx.currentTime);
      this.surfaceLPF.Q.setValueAtTime(0.75, ctx.currentTime);
      this.surfaceLPF.connect(this.masterGain);

      this.surfaceBus = ctx.createGain();
      this.surfaceBus.gain.setValueAtTime(1.0, ctx.currentTime);
      this.surfaceBus.connect(this.surfaceLPF);

      this.oceanBirdsGain = ctx.createGain();
      this.oceanBirdsGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.oceanBirdsGain.connect(this.surfaceBus);

      this.closeWavesGain = ctx.createGain();
      this.closeWavesGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.closeWavesGain.connect(this.surfaceBus);

      this.underwaterAmbGain = ctx.createGain();
      this.underwaterAmbGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.underwaterAmbGain.connect(this.masterGain);

      this.initialized = true;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      this.loadAllSamples(ctx);
    } catch {
      // Browser audio unavailable
    }
  }

  private async loadAllSamples(ctx: AudioContext): Promise<void> {
    if (this.loadingStarted) return;
    this.loadingStarted = true;

    const entries = Object.entries(AUDIO_FILES) as Array<[AudioKey, string]>;
    await Promise.all(
      entries.map(async ([key, url]) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return;
          const arr = await res.arrayBuffer();
          const decoded = await ctx.decodeAudioData(arr);
          this.buffers.set(key, decoded);
          if (key === 'oceanBirds' || key === 'closeWaves' || key === 'underwaterAmb') {
            this.tryStartAmbientLoops();
          }
        } catch {
          // Skip failed decode gracefully
        }
      })
    );
    this.tryStartAmbientLoops();
  }

  private tryStartAmbientLoops(): void {
    if (!this.ctx || this.loopsStarted) return;
    const oceanBuf = this.buffers.get('oceanBirds');
    const closeBuf = this.buffers.get('closeWaves');
    const uwBuf = this.buffers.get('underwaterAmb');
    if (!oceanBuf && !closeBuf && !uwBuf) return;

    this.loopsStarted = true;
    const now = this.ctx.currentTime;

    if (oceanBuf && this.oceanBirdsGain) {
      const src = this.ctx.createBufferSource();
      src.buffer = oceanBuf;
      src.loop = true;
      src.connect(this.oceanBirdsGain);
      src.start(now);
      this.oceanBirdsGain.gain.setTargetAtTime(0.38, now, 0.35);
    }

    if (closeBuf && this.closeWavesGain) {
      const src = this.ctx.createBufferSource();
      src.buffer = closeBuf;
      src.loop = true;
      src.connect(this.closeWavesGain);
      src.start(now);
      this.closeWavesGain.gain.setTargetAtTime(0.28, now, 0.35);
    }

    if (uwBuf && this.underwaterAmbGain) {
      const src = this.ctx.createBufferSource();
      src.buffer = uwBuf;
      src.loop = true;
      const uwLPF = this.ctx.createBiquadFilter();
      uwLPF.type = 'lowpass';
      uwLPF.frequency.setValueAtTime(420, now);
      src.connect(uwLPF);
      uwLPF.connect(this.underwaterAmbGain);
      src.start(now);
    }
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(this.muted ? 0.0001 : 0.85, now, 0.04);
    }
    return this.muted;
  }

  public update(
    dt: number,
    _elapsedTime: number,
    cameraSubmersion: number,
    swellPhase: number,
    waveIntensity: number,
    shoreProximity: number
  ): void {
    const subT = THREE.MathUtils.clamp((cameraSubmersion + 0.06) / 0.24, 0, 1);
    const targetCutoff = THREE.MathUtils.lerp(18000, 320, subT);
    // ~250ms smooth exponential response
    this.currentCutoff = THREE.MathUtils.lerp(
      this.currentCutoff,
      targetCutoff,
      1.0 - Math.exp(-dt / 0.085)
    );

    if (!this.initialized || !this.ctx || !this.surfaceLPF) return;

    const now = this.ctx.currentTime;
    this.surfaceLPF.frequency.setTargetAtTime(targetCutoff, now, 0.085);

    const wScale = THREE.MathUtils.clamp(waveIntensity, 0.35, 1.8);
    const prox = THREE.MathUtils.clamp(shoreProximity, 0, 1);

    if (this.oceanBirdsGain && this.loopsStarted) {
      this.oceanBirdsGain.gain.setTargetAtTime(0.34 * (1.0 - subT * 0.65), now, 0.14);
    }
    if (this.closeWavesGain && this.loopsStarted) {
      const swell = (0.18 + 0.34 * Math.pow(swellPhase, 1.25)) * wScale * (0.45 + 0.55 * prox);
      this.closeWavesGain.gain.setTargetAtTime(swell, now, 0.12);
    }
    if (this.underwaterAmbGain && this.loopsStarted) {
      const uwBoost = THREE.MathUtils.clamp(cameraSubmersion * 0.08, 0, 0.28);
      this.underwaterAmbGain.gain.setTargetAtTime(
        subT > 0.02 ? (0.44 + uwBoost) * subT : 0.0001,
        now,
        0.09
      );
    }
  }

  private playSampleSlice(
    key: AudioKey,
    dest: AudioNode,
    gainVal: number,
    duration: number,
    rateMin: number,
    rateMax: number,
    filterHz?: number
  ): void {
    if (!this.ctx || this.muted) return;
    const buf = this.buffers.get(key);
    if (!buf) return;

    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.setValueAtTime(
      rateMin + Math.random() * (rateMax - rateMin),
      now
    );

    const maxStart = Math.max(0, buf.duration - duration - 0.15);
    const offset = maxStart > 0.2 ? Math.random() * maxStart : 0;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(gainVal, now + 0.02);
    env.gain.setValueAtTime(gainVal, now + Math.max(0.03, duration * 0.55));
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    if (filterHz) {
      const lpf = this.ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.setValueAtTime(filterHz, now);
      src.connect(lpf);
      lpf.connect(env);
    } else {
      src.connect(env);
    }

    env.connect(dest);
    src.start(now, offset, duration + 0.04);
  }

  /**
   * Real recorded granular sand steps & authentic seawater wading splashes.
   */
  public playFootstep(surface: 'dry' | 'wet' | 'wade', volume = 0.75): void {
    if (!this.initialized || !this.surfaceBus || this.muted) return;
    if (surface === 'dry') {
      this.playSampleSlice('sandSwish', this.surfaceBus, 0.34 * volume, 0.22, 0.92, 1.12, 4200);
    } else if (surface === 'wet') {
      this.playSampleSlice('sandSteps', this.surfaceBus, 0.32 * volume, 0.18, 0.88, 1.08, 2200);
    } else {
      // Stepping & wading through shallow water: crisp seawater splash slice!
      this.playSampleSlice('waterSplash', this.surfaceBus, 0.42 * volume, 0.38, 0.90, 1.18);
    }
  }

  /**
   * Real water splash/plunge audio when entering water or breaching the surface.
   */
  public playSplash(intensity = 0.65): void {
    if (!this.initialized || !this.masterGain || !this.surfaceBus || this.muted) return;
    const key: AudioKey = intensity > 0.55 ? 'waterJump' : 'waterSplash';
    this.playSampleSlice(key, this.surfaceBus, 0.48 * intensity, 0.75, 0.92, 1.12);
  }

  /**
   * Muffled underwater or surface swim-stroke water movement.
   */
  public playSwimStroke(underwater: boolean, intensity = 0.8): void {
    if (!this.initialized || !this.masterGain || !this.surfaceBus || this.muted) return;
    const dest = underwater ? this.masterGain : this.surfaceBus;
    this.playSampleSlice(
      'waterSplash',
      dest,
      (underwater ? 0.36 : 0.32) * intensity,
      0.42,
      underwater ? 0.68 : 0.95,
      underwater ? 0.85 : 1.15,
      underwater ? 480 : 3200
    );
  }

  /**
   * Real recorded deep underwater bubble stream bursts.
   */
  public playBubbleBurst(intensity = 0.7): void {
    if (!this.initialized || !this.masterGain || this.muted) return;
    this.playSampleSlice('underwaterBubbles', this.masterGain, 0.40 * intensity, 0.52, 0.92, 1.16);
  }
}
