import * as THREE from 'three';

/**
 * Self-contained procedural Web Audio API Coastal & Underwater Spatial Sound Engine:
 *  - Activates cleanly on first user interaction with zero pops/clicks
 *  - Above water: layered ocean wave swells synced to live wave cycle, gentle coastal wind,
 *    occasional stereo-panned distant seagulls, and granular sand/wet/wade footsteps
 *  - Underwater transition: smoothly sweeps a Biquad Low-Pass Filter from 18,000 Hz down
 *    to 320 Hz over ~250ms while crossfading in deep underwater current ambience, muffled
 *    swim-stroke whooshes, and crisp bubble burst chirps!
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private surfaceBus: GainNode | null = null;
  private surfaceLPF: BiquadFilterNode | null = null;

  private waveGain: GainNode | null = null;
  private waveFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private underwaterAmbGain: GainNode | null = null;

  private noiseBuffer: AudioBuffer | null = null;
  private pinkBuffer: AudioBuffer | null = null;

  private initialized = false;
  private muted = false;
  private seagullTimer = 5.5;
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

  /**
   * Call on first pointer or keyboard gesture to safely boot the AudioContext.
   */
  public unlock(): void {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      const ctx = new AudioCtx();
      this.ctx = ctx;

      this.masterGain = ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.masterGain.gain.exponentialRampToValueAtTime(this.muted ? 0.0001 : 0.78, ctx.currentTime + 0.35);
      this.masterGain.connect(ctx.destination);

      // Surface ambience bus routed through the aquatic Biquad Low-Pass Filter
      this.surfaceLPF = ctx.createBiquadFilter();
      this.surfaceLPF.type = 'lowpass';
      this.surfaceLPF.frequency.setValueAtTime(18000, ctx.currentTime);
      this.surfaceLPF.Q.setValueAtTime(0.72, ctx.currentTime);
      this.surfaceLPF.connect(this.masterGain);

      this.surfaceBus = ctx.createGain();
      this.surfaceBus.gain.setValueAtTime(1.0, ctx.currentTime);
      this.surfaceBus.connect(this.surfaceLPF);

      // Pre-generate seamless looping white & pink noise buffers
      this.noiseBuffer = this.createNoiseBuffer(ctx, 4.0, false);
      this.pinkBuffer = this.createNoiseBuffer(ctx, 5.0, true);

      // 1. Layered Ocean Wave Swell Bed
      const waveSrc = ctx.createBufferSource();
      waveSrc.buffer = this.pinkBuffer;
      waveSrc.loop = true;

      this.waveFilter = ctx.createBiquadFilter();
      this.waveFilter.type = 'bandpass';
      this.waveFilter.frequency.setValueAtTime(340, ctx.currentTime);
      this.waveFilter.Q.setValueAtTime(0.65, ctx.currentTime);

      this.waveGain = ctx.createGain();
      this.waveGain.gain.setValueAtTime(0.26, ctx.currentTime);

      waveSrc.connect(this.waveFilter);
      this.waveFilter.connect(this.waveGain);
      this.waveGain.connect(this.surfaceBus);
      waveSrc.start();

      // Secondary soft whitewash foam hiss layer
      const foamSrc = ctx.createBufferSource();
      foamSrc.buffer = this.noiseBuffer;
      foamSrc.loop = true;
      const foamHp = ctx.createBiquadFilter();
      foamHp.type = 'bandpass';
      foamHp.frequency.setValueAtTime(1450, ctx.currentTime);
      foamHp.Q.setValueAtTime(0.85, ctx.currentTime);
      const foamGain = ctx.createGain();
      foamGain.gain.setValueAtTime(0.05, ctx.currentTime);
      foamSrc.connect(foamHp);
      foamHp.connect(foamGain);
      foamGain.connect(this.surfaceBus);
      foamSrc.start();

      // 2. Gentle Coastal Wind Breeze
      const windSrc = ctx.createBufferSource();
      windSrc.buffer = this.pinkBuffer;
      windSrc.loop = true;
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.setValueAtTime(620, ctx.currentTime);
      windFilter.Q.setValueAtTime(1.6, ctx.currentTime);
      this.windGain = ctx.createGain();
      this.windGain.gain.setValueAtTime(0.08, ctx.currentTime);
      windSrc.connect(windFilter);
      windFilter.connect(this.windGain);
      this.windGain.connect(this.surfaceBus);
      windSrc.start();

      // 3. Underwater Deep Current Rumble Bed (crossfades in on submergence)
      const uwSrc = ctx.createBufferSource();
      uwSrc.buffer = this.pinkBuffer;
      uwSrc.loop = true;
      const uwFilter = ctx.createBiquadFilter();
      uwFilter.type = 'lowpass';
      uwFilter.frequency.setValueAtTime(210, ctx.currentTime);
      uwFilter.Q.setValueAtTime(1.2, ctx.currentTime);
      this.underwaterAmbGain = ctx.createGain();
      this.underwaterAmbGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      uwSrc.connect(uwFilter);
      uwFilter.connect(this.underwaterAmbGain);
      this.underwaterAmbGain.connect(this.masterGain);
      uwSrc.start();

      this.initialized = true;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    } catch {
      // Browser audio unavailable
    }
  }

  private createNoiseBuffer(ctx: AudioContext, seconds: number, pink: boolean): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        if (!pink) {
          data[i] = white * 0.5;
        } else {
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.96900 * b2 + white * 0.1538520;
          b3 = 0.86650 * b3 + white * 0.3104856;
          b4 = 0.55000 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.0168980;
          data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.095;
          b6 = white * 0.115926;
        }
      }
    }
    return buffer;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(this.muted ? 0.0001 : 0.78, now, 0.04);
    }
    return this.muted;
  }

  /**
   * Continuous per-frame modulation:
   *  - Syncs ocean wave swells with live wave cycle phase & proximity to shore
   *  - Sweeps Biquad LPF smoothly between 18,000 Hz (air) and 320 Hz (underwater) over ~250ms
   *  - Triggers occasional stereo-panned distant seagulls above water
   */
  public update(
    dt: number,
    elapsedTime: number,
    cameraSubmersion: number,
    swellPhase: number,
    waveIntensity: number,
    shoreProximity: number
  ): void {
    // Track effective cutoff even before audio unlock for clean telemetry
    const subT = THREE.MathUtils.clamp((cameraSubmersion + 0.06) / 0.24, 0, 1);
    const targetCutoff = THREE.MathUtils.lerp(18000, 320, subT);
    // ~250ms smooth exponential response (time constant ~0.085s reaches 95% in 250ms)
    this.currentCutoff = THREE.MathUtils.lerp(
      this.currentCutoff,
      targetCutoff,
      1.0 - Math.exp(-dt / 0.085)
    );

    if (!this.initialized || !this.ctx || !this.surfaceLPF || !this.waveGain || !this.waveFilter || !this.windGain || !this.underwaterAmbGain) {
      return;
    }

    const now = this.ctx.currentTime;

    // Smoothly sweep master surface low-pass filter (~250ms transition)
    this.surfaceLPF.frequency.setTargetAtTime(targetCutoff, now, 0.085);

    // Sync wave swell gain & filter brightness to live wave phase
    const shoreBoost = 0.55 + 0.45 * THREE.MathUtils.clamp(shoreProximity, 0, 1);
    const swellGain = (0.16 + 0.28 * Math.pow(swellPhase, 1.4)) * THREE.MathUtils.clamp(waveIntensity, 0.3, 1.8) * shoreBoost;
    const swellFreq = 220 + 520 * swellPhase;
    this.waveGain.gain.setTargetAtTime(swellGain, now, 0.12);
    this.waveFilter.frequency.setTargetAtTime(swellFreq, now, 0.12);

    // Gentle wind modulation
    const windPulse = 0.06 + 0.04 * Math.sin(elapsedTime * 0.37) * Math.cos(elapsedTime * 0.19);
    this.windGain.gain.setTargetAtTime(windPulse * (1.0 - subT * 0.85), now, 0.15);

    // Crossfade deep underwater current rumble
    const uwDepthBoost = THREE.MathUtils.clamp(cameraSubmersion * 0.12, 0, 0.35);
    this.underwaterAmbGain.gain.setTargetAtTime(
      subT > 0.02 ? (0.34 + uwDepthBoost) * subT : 0.0001,
      now,
      0.09
    );

    // Occasional distant seagulls above water
    if (subT < 0.25 && !this.muted) {
      this.seagullTimer -= dt;
      if (this.seagullTimer <= 0) {
        this.seagullTimer = 7.5 + Math.random() * 11.0;
        this.playSeagull();
      }
    }
  }

  /**
   * Granular sand footstep / wet sand crunch / shallow water wade splash.
   */
  public playFootstep(surface: 'dry' | 'wet' | 'wade', volume = 0.75): void {
    if (!this.initialized || !this.ctx || !this.noiseBuffer || !this.surfaceBus || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const startOff = Math.random() * 2.8;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    const gain = ctx.createGain();

    if (surface === 'dry') {
      // Soft granular sand crunch (mid-high bandpass with gentle envelope)
      bp.frequency.setValueAtTime(1650 + Math.random() * 550, now);
      bp.Q.setValueAtTime(1.1, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.16 * volume, now + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    } else if (surface === 'wet') {
      // Tighter damp-sand step
      bp.frequency.setValueAtTime(980 + Math.random() * 320, now);
      bp.Q.setValueAtTime(1.6, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.18 * volume, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.095);
    } else {
      // Shallow wading water slosh
      bp.frequency.setValueAtTime(1150 + Math.random() * 450, now);
      bp.frequency.exponentialRampToValueAtTime(480, now + 0.22);
      bp.Q.setValueAtTime(0.9, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.24 * volume, now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    }

    src.connect(bp);
    bp.connect(gain);
    gain.connect(this.surfaceBus);
    src.start(now, startOff, 0.28);
  }

  /**
   * Muffled underwater or surface swim-stroke whoosh.
   */
  public playSwimStroke(underwater: boolean, intensity = 0.8): void {
    if (!this.initialized || !this.ctx || !this.pinkBuffer || !this.masterGain || !this.surfaceBus || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.pinkBuffer;

    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(underwater ? 240 : 620, now);
    filt.frequency.exponentialRampToValueAtTime(underwater ? 130 : 320, now + 0.28);
    filt.Q.setValueAtTime(1.1, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime((underwater ? 0.28 : 0.22) * intensity, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);

    src.connect(filt);
    filt.connect(gain);
    gain.connect(underwater ? this.masterGain : this.surfaceBus);
    src.start(now, Math.random() * 3.0, 0.38);
  }

  /**
   * Crisp rising bubble burst chirps for diving & underwater strokes.
   */
  public playBubbleBurst(intensity = 0.7): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const count = 3 + Math.floor(Math.random() * 4);

    for (let i = 0; i < count; i++) {
      const delay = i * (0.03 + Math.random() * 0.045);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const baseF = 340 + Math.random() * 420;
      osc.frequency.setValueAtTime(baseF, now + delay);
      osc.frequency.exponentialRampToValueAtTime(baseF * 1.95, now + delay + 0.065);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.linearRampToValueAtTime(0.065 * intensity, now + delay + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.075);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + delay);
      osc.stop(now + delay + 0.085);
    }
  }

  /**
   * Waterline entry / surfacing splash whoosh.
   */
  public playSplash(intensity = 0.6): void {
    if (!this.initialized || !this.ctx || !this.noiseBuffer || !this.masterGain || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(1600, now);
    filt.frequency.exponentialRampToValueAtTime(240, now + 0.38);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.28 * intensity, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);

    src.connect(filt);
    filt.connect(gain);
    gain.connect(this.masterGain);
    src.start(now, Math.random() * 2.5, 0.45);
  }

  /**
   * Distant stereo-panned coastal seagull call.
   */
  private playSeagull(): void {
    if (!this.ctx || !this.surfaceBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const calls = Math.random() < 0.55 ? 2 : 1;
    const pan = (Math.random() - 0.5) * 1.5;

    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.setValueAtTime(pan, now);
      panner.connect(this.surfaceBus);
    }
    const dest = panner ?? this.surfaceBus;

    for (let c = 0; c < calls; c++) {
      const t0 = now + c * 0.34;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      const fStart = 1750 + Math.random() * 350;
      osc.frequency.setValueAtTime(fStart * 0.85, t0);
      osc.frequency.linearRampToValueAtTime(fStart * 1.15, t0 + 0.09);
      osc.frequency.exponentialRampToValueAtTime(fStart * 0.62, t0 + 0.27);

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(fStart, t0);
      bp.Q.setValueAtTime(3.2, t0);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.032, t0 + 0.045);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);

      osc.connect(bp);
      bp.connect(g);
      g.connect(dest);
      osc.start(t0);
      osc.stop(t0 + 0.30);
    }
  }
}
