import { LocomotionMode } from '../player/PlayerController';

export interface HudCallbacks {
  onSunChange: (progress: number) => void;
  onWaveChange: (intensity: number) => void;
  onToggleCamera: () => boolean;
  onToggleMute: () => boolean;
  onToggleAA: () => boolean;
}

/**
 * Minimal unobtrusive glassmorphic HUD with H-key immersion toggle,
 * live locomotion telemetry, sun angle slider/presets, wave intensity,
 * camera perspective, and spatial audio mute controls.
 */
export class HudController {
  private readonly hudRoot = document.getElementById('hud-root')!;
  private readonly hiddenPill = document.getElementById('hud-hidden-pill')!;
  private readonly pointerHint = document.getElementById('pointer-hint')!;

  private readonly stateEl = document.getElementById('hud-state')!;
  private readonly depthEl = document.getElementById('hud-depth')!;
  private readonly printsEl = document.getElementById('hud-prints')!;

  private readonly sunSlider = document.getElementById('sun-slider') as HTMLInputElement;
  private readonly sunLabel = document.getElementById('sun-label')!;
  private readonly waveSlider = document.getElementById('wave-slider') as HTMLInputElement;
  private readonly waveLabel = document.getElementById('wave-label')!;
  private readonly btnCamera = document.getElementById('btn-camera')!;
  private readonly btnAudio = document.getElementById('btn-audio')!;
  private readonly btnAA = document.getElementById('btn-aa')!;
  private readonly chips = Array.from(document.querySelectorAll<HTMLButtonElement>('.chip'));

  private isHidden = false;
  private hintDismissed = false;

  constructor(private readonly callbacks: HudCallbacks) {
    // Prevent HUD clicks from triggering canvas pointer lock
    this.hudRoot.addEventListener('pointerdown', (e) => e.stopPropagation());

    this.sunSlider.addEventListener('input', () => {
      const val = Number(this.sunSlider.value);
      this.syncSunChips(val);
      this.callbacks.onSunChange(val);
    });

    for (const chip of this.chips) {
      chip.addEventListener('click', () => {
        const val = Number(chip.dataset.sun ?? 48);
        this.sunSlider.value = String(val);
        this.syncSunChips(val);
        this.callbacks.onSunChange(val);
      });
    }

    this.waveSlider.addEventListener('input', () => {
      const intensity = Number(this.waveSlider.value) / 100;
      this.waveLabel.textContent = `${intensity.toFixed(2)}×`;
      this.callbacks.onWaveChange(intensity);
    });

    this.btnCamera.addEventListener('click', () => {
      const isFirst = this.callbacks.onToggleCamera();
      this.setCameraLabel(isFirst);
    });

    this.btnAudio.addEventListener('click', () => {
      const muted = this.callbacks.onToggleMute();
      this.setAudioLabel(muted);
    });

    this.btnAA.addEventListener('click', () => {
      const enabled = this.callbacks.onToggleAA();
      this.btnAA.textContent = enabled ? 'AA: FXAA + SSAA' : 'AA: Off';
    });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'KeyH') {
        this.toggleHudVisibility();
      } else if (e.code === 'KeyM') {
        const muted = this.callbacks.onToggleMute();
        this.setAudioLabel(muted);
      } else if (e.code === 'KeyV') {
        // PlayerController handles toggle; sync label on next microtask
        queueMicrotask(() => {
          const isFirst = this.btnCamera.textContent?.includes('3rd') ?? false;
          this.setCameraLabel(isFirst);
        });
      }
    });
  }

  private syncSunChips(val: number): void {
    let closest: HTMLButtonElement | null = null;
    let bestDiff = Infinity;
    for (const c of this.chips) {
      const diff = Math.abs(Number(c.dataset.sun ?? 0) - val);
      if (diff < bestDiff) {
        bestDiff = diff;
        closest = c;
      }
    }
    for (const c of this.chips) {
      c.classList.toggle('active', c === closest && bestDiff <= 10);
    }
  }

  public setSunLabel(label: string): void {
    this.sunLabel.textContent = label;
  }

  public setCameraLabel(firstPerson: boolean): void {
    this.btnCamera.textContent = firstPerson ? '1st Person (V)' : '3rd Person (V)';
  }

  public setAudioLabel(muted: boolean): void {
    this.btnAudio.textContent = muted ? 'Audio: Muted (M)' : 'Audio: On (M)';
  }

  public dismissPointerHint(): void {
    if (this.hintDismissed) return;
    this.hintDismissed = true;
    this.pointerHint.classList.add('dismissed');
  }

  public toggleHudVisibility(): void {
    this.isHidden = !this.isHidden;
    this.hudRoot.classList.toggle('hud-hidden', this.isHidden);
    this.hiddenPill.classList.toggle('hidden', !this.isHidden);
  }

  public updateTelemetry(
    mode: LocomotionMode,
    elevationOrDepth: number,
    cameraSubmersion: number,
    footprintCount: number
  ): void {
    this.stateEl.textContent = mode;
    if (cameraSubmersion > 0.04) {
      this.depthEl.textContent = `DEPTH -${cameraSubmersion.toFixed(1)}m`;
    } else if (elevationOrDepth < -0.05) {
      this.depthEl.textContent = `WATER ${Math.abs(elevationOrDepth).toFixed(1)}m`;
    } else {
      this.depthEl.textContent = `ELEV +${Math.max(0, elevationOrDepth).toFixed(1)}m`;
    }
    this.printsEl.textContent = `PRINTS ${footprintCount}`;
  }
}
