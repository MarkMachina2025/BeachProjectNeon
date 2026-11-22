import { LocomotionMode } from '../player/PlayerController';
import type { GoldenShell, WeatherMode } from '../environment/InteractiveWorld';

export interface HudCallbacks {
  onSunChange: (progress: number) => void;
  onWaveChange: (intensity: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleCamera: () => boolean;
  onToggleMute: () => boolean;
  onToggleAA: () => boolean;
  onToggleMouseLock: () => boolean;
  onEnterCove: (startAtSunset: boolean) => void;
  onTeleport?: (spotId: string) => void;
  onWeatherChange?: (mode: WeatherMode) => void;
  onToggleDayCycle?: () => boolean;
  onSavePostcard?: () => void;
}

/**
 * Minimal, unobtrusive glassmorphic HUD + Live Aerial Loading/Welcome Screen:
 *  - Clean unobstructed top-left viewport (no legacy telemetry clutter!)
 *  - Bottom-right Golden Seashell counter pill + clickable Golden Shell Field Guide drawer
 *  - Top-center Compass & Nearest Landmark/Shell radar strip
 *  - Top-right collapsible controls card with Mouse Lock toggle, Weather, Quick Travel, Day Cycle & Photo Mode
 */
export class HudController {
  private readonly hudRoot = document.getElementById('hud-root')!;
  private readonly hiddenPill = document.getElementById('hud-hidden-pill')!;
  private readonly pointerHint = document.getElementById('pointer-hint')!;

  // Loading & Welcome overlay
  private readonly welcomeOverlay = document.getElementById('welcome-overlay');
  private readonly loadingBlock = document.getElementById('loading-block');
  private readonly loadingStatus = document.getElementById('loading-status');
  private readonly loadingPct = document.getElementById('loading-pct');
  private readonly loadingFill = document.getElementById('loading-fill');
  private readonly welcomeReady = document.getElementById('welcome-ready');
  private readonly btnEnterCove = document.getElementById('btn-enter-cove');
  private readonly btnEnterSunset = document.getElementById('btn-enter-sunset');
  private readonly btnWelcomeLock = document.getElementById('btn-welcome-lock');

  // Compass & Boost
  private readonly compassHeadingEl = document.getElementById('compass-heading');
  private readonly compassLandmarkEl = document.getElementById('compass-landmark');
  private readonly compassShellEl = document.getElementById('compass-shell');
  private readonly boostPill = document.getElementById('boost-pill');

  // Bottom-right Golden Shell counter & Field Guide drawer
  private readonly shellsCard = document.getElementById('hud-shells-card');
  private readonly shellsEl = document.getElementById('hud-shells');
  private readonly shellGuide = document.getElementById('shell-guide');
  private readonly shellGuideList = document.getElementById('shell-guide-list');
  private readonly btnGuideClose = document.getElementById('btn-guide-close');

  // Top-right collapsible controls
  private readonly controlsCard = document.getElementById('hud-controls');
  private readonly btnCollapse = document.getElementById('btn-collapse');
  private readonly sunSlider = document.getElementById('sun-slider') as HTMLInputElement;
  private readonly sunLabel = document.getElementById('sun-label')!;
  private readonly waveSlider = document.getElementById('wave-slider') as HTMLInputElement;
  private readonly waveLabel = document.getElementById('wave-label')!;
  private readonly volumeSlider = document.getElementById('volume-slider') as HTMLInputElement;
  private readonly volumeLabel = document.getElementById('volume-label')!;
  private readonly weatherLabel = document.getElementById('weather-label');
  private readonly btnCamera = document.getElementById('btn-camera')!;
  private readonly btnMouseLock = document.getElementById('btn-mouselock');
  private readonly btnAudio = document.getElementById('btn-audio')!;
  private readonly btnCycle = document.getElementById('btn-cycle');
  private readonly btnPhoto = document.getElementById('btn-photo');
  private readonly btnSnap = document.getElementById('btn-snap');
  private readonly btnPhotoExit = document.getElementById('btn-photo-exit');
  private readonly photoBar = document.getElementById('photo-bar');
  private readonly toastEl = document.getElementById('discovery-toast');
  private readonly telescopeOverlay = document.getElementById('telescope-overlay');
  private readonly btnAA = document.getElementById('btn-aa')!;
  private readonly chips = Array.from(document.querySelectorAll<HTMLButtonElement>('.chip[data-sun]'));
  private readonly tpChips = Array.from(document.querySelectorAll<HTMLButtonElement>('.tp-chip[data-tp]'));
  private readonly weatherChips = Array.from(document.querySelectorAll<HTMLButtonElement>('.weather-chip[data-weather]'));
  private readonly actionPrompt = document.getElementById('action-prompt');

  private isHidden = true; // Starts hidden while Welcome Screen is showing
  private isPhotoMode = false;
  private isWelcomeOpen = true;
  private isGuideOpen = false;
  private hintDismissed = false;
  private toastTimer = 0;

  constructor(private readonly callbacks: HudCallbacks) {
    this.hudRoot.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.welcomeOverlay?.addEventListener('pointerdown', (e) => e.stopPropagation());

    this.btnEnterCove?.addEventListener('click', () => {
      this.dismissWelcome();
      this.callbacks.onEnterCove(false);
    });
    this.btnEnterSunset?.addEventListener('click', () => {
      this.dismissWelcome();
      this.callbacks.onEnterCove(true);
    });
    this.btnWelcomeLock?.addEventListener('click', () => {
      const locked = this.callbacks.onToggleMouseLock();
      this.setMouseLockLabel(locked);
    });

    this.btnCollapse?.addEventListener('click', () => {
      if (!this.controlsCard) return;
      const collapsed = this.controlsCard.classList.toggle('collapsed');
      if (this.btnCollapse) this.btnCollapse.textContent = collapsed ? '▸' : '▾';
    });

    this.shellsCard?.addEventListener('click', () => {
      this.isGuideOpen = !this.isGuideOpen;
      this.shellGuide?.classList.toggle('hidden', !this.isGuideOpen);
    });
    this.btnGuideClose?.addEventListener('click', () => {
      this.isGuideOpen = false;
      this.shellGuide?.classList.add('hidden');
    });

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

    for (const tp of this.tpChips) {
      tp.addEventListener('click', () => {
        const id = tp.dataset.tp;
        if (id) this.callbacks.onTeleport?.(id);
      });
    }

    for (const wc of this.weatherChips) {
      wc.addEventListener('click', () => {
        const mode = wc.dataset.weather as WeatherMode | undefined;
        if (!mode) return;
        for (const c of this.weatherChips) c.classList.toggle('active', c === wc);
        if (this.weatherLabel) this.weatherLabel.textContent = wc.textContent ?? mode;
        this.callbacks.onWeatherChange?.(mode);
      });
    }

    this.waveSlider.addEventListener('input', () => {
      const intensity = Number(this.waveSlider.value) / 100;
      this.waveLabel.textContent = `${intensity.toFixed(2)}×`;
      this.callbacks.onWaveChange(intensity);
    });

    this.volumeSlider.addEventListener('input', () => {
      const pct = Number(this.volumeSlider.value);
      this.volumeLabel.textContent = `${pct}%`;
      this.callbacks.onVolumeChange(pct / 100);
    });

    this.btnCamera.addEventListener('click', () => {
      const isFirst = this.callbacks.onToggleCamera();
      this.setCameraLabel(isFirst);
    });

    this.btnMouseLock?.addEventListener('click', () => {
      const locked = this.callbacks.onToggleMouseLock();
      this.setMouseLockLabel(locked);
    });

    this.btnAudio.addEventListener('click', () => {
      const muted = this.callbacks.onToggleMute();
      this.setAudioLabel(muted);
    });

    this.btnCycle?.addEventListener('click', () => {
      const playing = this.callbacks.onToggleDayCycle?.() ?? false;
      this.setDayCycleActive(playing);
    });

    this.btnPhoto?.addEventListener('click', () => this.togglePhotoMode());
    this.btnPhotoExit?.addEventListener('click', () => this.togglePhotoMode(false));
    this.btnSnap?.addEventListener('click', () => this.callbacks.onSavePostcard?.());
    this.photoBar?.addEventListener('pointerdown', (e) => e.stopPropagation());

    this.btnAA.addEventListener('click', () => {
      const enabled = this.callbacks.onToggleAA();
      this.btnAA.textContent = enabled ? 'AA: FXAA + SSAA' : 'AA: Off';
    });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (this.isWelcomeOpen) return;
      if (e.code === 'KeyH') {
        this.toggleHudVisibility();
      } else if (e.code === 'KeyP') {
        this.togglePhotoMode();
      } else if (e.code === 'KeyL') {
        const locked = this.callbacks.onToggleMouseLock();
        this.setMouseLockLabel(locked);
      } else if (e.code === 'KeyT') {
        const playing = this.callbacks.onToggleDayCycle?.() ?? false;
        this.setDayCycleActive(playing);
      } else if (e.code === 'KeyM') {
        const muted = this.callbacks.onToggleMute();
        this.setAudioLabel(muted);
      } else if (e.code === 'KeyV') {
        queueMicrotask(() => {
          const isFirst = this.btnCamera.textContent?.includes('3rd') ?? false;
          this.setCameraLabel(isFirst);
        });
      }
    });
  }

  public updateLoadingProgress(loaded: number, total: number): void {
    const pct = Math.min(100, Math.round((loaded / Math.max(1, total)) * 100));
    if (this.loadingFill) this.loadingFill.style.width = `${Math.max(8, pct)}%`;
    if (this.loadingPct) this.loadingPct.textContent = `${pct}%`;
    if (this.loadingStatus) {
      this.loadingStatus.textContent =
        pct >= 100 ? 'Bay ready!' : `Streaming coastal assets (${loaded}/${total})…`;
    }
    if (pct >= 100) {
      this.loadingBlock?.classList.add('hidden');
      this.welcomeReady?.classList.remove('hidden');
    }
  }

  public dismissWelcome(): void {
    if (!this.isWelcomeOpen) return;
    this.isWelcomeOpen = false;
    this.welcomeOverlay?.classList.add('dismissed');
    this.isHidden = false;
    this.hudRoot.classList.remove('hud-hidden');
    if (!this.hintDismissed) {
      this.pointerHint.classList.remove('dismissed');
    }
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

  public syncSun(progress: number, label: string): void {
    this.sunSlider.value = String(progress);
    this.syncSunChips(progress);
    this.sunLabel.textContent = label;
  }

  public setCameraLabel(firstPerson: boolean): void {
    this.btnCamera.textContent = firstPerson ? '1st Person (V)' : '3rd Person (V)';
  }

  public setMouseLockLabel(enabled: boolean): void {
    if (this.btnMouseLock) {
      this.btnMouseLock.textContent = enabled ? 'Mouse Lock: On (L)' : 'Drag Orbit (L)';
      this.btnMouseLock.classList.toggle('active', enabled);
    }
    if (this.btnWelcomeLock) {
      this.btnWelcomeLock.textContent = enabled ? 'Mouse Lock: On' : 'Drag Orbit: Free';
    }
    if (!enabled) this.dismissPointerHint();
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
    this.hiddenPill.classList.toggle('hidden', !this.isHidden || this.isPhotoMode);
  }

  public togglePhotoMode(force?: boolean): void {
    this.isPhotoMode = force !== undefined ? force : !this.isPhotoMode;
    this.isHidden = this.isPhotoMode;
    this.hudRoot.classList.toggle('hud-hidden', this.isPhotoMode);
    this.hiddenPill.classList.add('hidden');
    this.photoBar?.classList.toggle('hidden', !this.isPhotoMode);
    if (this.isPhotoMode) this.dismissPointerHint();
  }

  public setDayCycleActive(active: boolean): void {
    this.btnCycle?.classList.toggle('active', active);
    if (this.btnCycle) this.btnCycle.textContent = active ? 'Cycle: On (T)' : 'Day Cycle (T)';
  }

  public setTelescopeActive(active: boolean): void {
    this.telescopeOverlay?.classList.toggle('hidden', !active);
  }

  public setSpeedBoostActive(remainingSec: number): void {
    if (!this.boostPill) return;
    if (remainingSec > 0.1) {
      this.boostPill.classList.remove('hidden');
      this.boostPill.textContent = `⚡ ${Math.ceil(remainingSec)}s`;
    } else {
      this.boostPill.classList.add('hidden');
    }
  }

  public syncWaveIntensity(intensity: number): void {
    const pct = Math.round(Math.max(25, Math.min(200, intensity * 100)));
    if (this.waveSlider) this.waveSlider.value = String(pct);
    if (this.waveLabel) this.waveLabel.textContent = `${intensity.toFixed(2)}×`;
  }

  public setShellCount(collected: number, total: number, shells?: GoldenShell[]): void {
    if (this.shellsEl) this.shellsEl.textContent = `${collected}/${total}`;
    if (shells && this.shellGuideList) {
      this.shellGuideList.innerHTML = shells
        .map(
          (s) =>
            `<li class="shell-guide-item ${s.collected ? 'found' : ''}">` +
            `<strong>${s.collected ? '✓ ' : '✦ '}${s.name}</strong>` +
            `<span>${s.collected ? 'Discovered!' : s.clue}</span>` +
            `</li>`
        )
        .join('');
    }
  }

  public showDiscoveryToast(msg: string): void {
    if (!this.toastEl) return;
    this.toastEl.textContent = msg;
    this.toastEl.classList.remove('hidden');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl?.classList.add('hidden');
    }, 3800);
  }

  public updateCompass(headingDeg: number, landmarkText: string, nearestShellText: string): void {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const norm = ((headingDeg % 360) + 360) % 360;
    const card = dirs[Math.round(norm / 45) % 8];
    if (this.compassHeadingEl) this.compassHeadingEl.textContent = `${card} · ${Math.round(norm)}°`;
    if (this.compassLandmarkEl) this.compassLandmarkEl.textContent = landmarkText;
    if (this.compassShellEl) this.compassShellEl.textContent = nearestShellText;
  }

  public setActionPrompt(text: string): void {
    if (!this.actionPrompt) return;
    if (!text) {
      this.actionPrompt.classList.add('hidden');
    } else {
      this.actionPrompt.classList.remove('hidden');
      this.actionPrompt.textContent = text;
    }
  }

  public updateTelemetry(
    _mode: LocomotionMode,
    _elevationOrDepth: number,
    _cameraSubmersion: number,
    _footprintCount: number
  ): void {
    // Top-left legacy telemetry intentionally removed for an unobstructed scenic ocean view!
  }
}
