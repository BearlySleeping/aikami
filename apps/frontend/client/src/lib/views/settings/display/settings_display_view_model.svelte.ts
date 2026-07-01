// apps/frontend/client/src/lib/views/settings/display/settings_display_view_model.svelte.ts
//
// SettingsDisplayViewModel — display settings wired to the Tauri window API.
// Falls back gracefully when running in a browser (dev mode).
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResolutionPreset = {
  readonly label: string;
  readonly width: number;
  readonly height: number;
};

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type SettingsDisplayViewModelInterface = BaseViewModelInterface & {
  /** Whether the window is currently in fullscreen mode. */
  readonly isFullscreen: boolean;
  /** Whether the Tauri window API is available. */
  readonly isTauri: boolean;
  /** Current window width in logical pixels. */
  readonly width: number;
  /** Current window height in logical pixels. */
  readonly height: number;
  /** Available resolution presets. */
  readonly resolutionPresets: readonly ResolutionPreset[];
  /** Currently selected resolution preset label, or 'Custom'. */
  readonly selectedPreset: string;

  /** Toggles fullscreen mode. */
  toggleFullscreen(): Promise<void>;
  /** Applies a resolution preset. */
  setResolution(preset: ResolutionPreset): Promise<void>;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type SettingsDisplayViewModelOptions = BaseViewModelOptions;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RESOLUTION_PRESETS: readonly ResolutionPreset[] = [
  { label: '1280 × 720 (HD)', width: 1280, height: 720 },
  { label: '1920 × 1080 (Full HD)', width: 1920, height: 1080 },
  { label: '2560 × 1440 (QHD)', width: 2560, height: 1440 },
] as const;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class SettingsDisplayViewModel
  extends BaseViewModel<SettingsDisplayViewModelOptions>
  implements SettingsDisplayViewModelInterface
{
  isFullscreen = $state<boolean>(false);
  isTauri = $state<boolean>(false);
  width = $state<number>(0);
  height = $state<number>(0);
  selectedPreset = $state<string>('Custom');

  get resolutionPresets(): readonly ResolutionPreset[] {
    return RESOLUTION_PRESETS;
  }

  override async initialize(): Promise<void> {
    this.isTauri = '__TAURI_INTERNALS__' in window;

    if (this.isTauri) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        this.isFullscreen = await win.isFullscreen();
        const size = await win.innerSize();
        this.width = size.width;
        this.height = size.height;
        this.updateSelectedPreset(this.width, this.height);
      } catch (error) {
        this.debug('Failed to read Tauri window state', { error: String(error) });
      }
    }

    await super.initialize();
  }

  async toggleFullscreen(): Promise<void> {
    if (!this.isTauri) {
      return;
    }

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      const nextState = !this.isFullscreen;
      await win.setFullscreen(nextState);
      this.isFullscreen = await win.isFullscreen();
    } catch (error) {
      this.debug('toggleFullscreen:error', { error: String(error) });
    }
  }

  async setResolution(preset: ResolutionPreset): Promise<void> {
    this.selectedPreset = preset.label;

    if (!this.isTauri) {
      return;
    }

    try {
      const { LogicalSize, getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      await win.setSize(new LogicalSize(preset.width, preset.height));
      const size = await win.innerSize();
      this.width = size.width;
      this.height = size.height;
    } catch (error) {
      this.debug('setResolution:error', { error: String(error) });
    }
  }

  /** Checks whether width/height matches a known preset and updates selectedPreset. */
  private updateSelectedPreset(w: number, h: number): void {
    const match = RESOLUTION_PRESETS.find((p) => p.width === w && p.height === h);
    this.selectedPreset = match ? match.label : 'Custom';
  }
}

export const getSettingsDisplayViewModel = (
  options: SettingsDisplayViewModelOptions,
): SettingsDisplayViewModelInterface => new SettingsDisplayViewModel(options);
