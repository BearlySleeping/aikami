// apps/frontend/client/src/lib/views/dev/audio/audio_view_model.dev.svelte.ts
//
// DevAudioViewModel — dev sandbox for testing BGM transitions, SFX playback,
// and the in-game music player (overlay, vibe matching, pause/skip/stop).
//
// Contract: C-150 Audio System, C-249 Music Tags

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { MusicSceneContext, Track } from '@aikami/types';
import { playSceneBgm, playSfxByName } from '$lib/services/audio/audio_asset_resolver';
import {
  buildMusicSceneContext,
  musicPlayerService,
} from '$lib/services/audio/music_player_service.svelte';
import { audioService, trackRegistryService } from '$services';

// ---------------------------------------------------------------------------
// Scene/vibe presets for testing vibe-matched skipping
// ---------------------------------------------------------------------------

export type DevScenePreset = {
  id: string;
  label: string;
  icon: string;
  scene: MusicSceneContext;
};

export const DEV_SCENE_PRESETS: readonly DevScenePreset[] = [
  {
    id: 'village',
    label: 'Village',
    icon: '🏘️',
    scene: {
      locationType: 'village',
      timeOfDay: 'afternoon',
      weather: 'clear',
      isInCombat: false,
      mood: 'neutral',
      lastNarrative: '',
    },
  },
  {
    id: 'forest',
    label: 'Forest',
    icon: '🌲',
    scene: {
      locationType: 'forest',
      timeOfDay: 'afternoon',
      weather: 'clear',
      isInCombat: false,
      mood: 'neutral',
      lastNarrative: '',
    },
  },
  {
    id: 'forest_night',
    label: 'Forest · Night',
    icon: '🌲🌙',
    scene: {
      locationType: 'forest',
      timeOfDay: 'night',
      weather: 'clear',
      isInCombat: false,
      mood: 'mysterious',
      lastNarrative: '',
    },
  },
  {
    id: 'dungeon',
    label: 'Dungeon',
    icon: '🏰',
    scene: {
      locationType: 'dungeon',
      timeOfDay: 'night',
      weather: 'clear',
      isInCombat: false,
      mood: 'mysterious',
      lastNarrative: '',
    },
  },
  {
    id: 'combat',
    label: 'Combat',
    icon: '⚔️',
    scene: {
      locationType: 'dungeon',
      timeOfDay: 'night',
      weather: 'clear',
      isInCombat: true,
      combatIntensity: 'medium',
      mood: 'tense',
      lastNarrative: '',
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type DevAudioViewModelInterface = BaseViewModelInterface & {
  /** Current master volume (0–1). */
  readonly masterVolume: number;
  /** Current BGM volume (0–1). */
  readonly bgmVolume: number;
  /** Current SFX volume (0–1). */
  readonly sfxVolume: number;
  /** Whether a BGM crossfade is in progress. */
  readonly isCrossfading: boolean;
  /** Last action feedback message. */
  readonly feedback: string;

  // ── Music player ──
  /** Whether the in-game music player overlay is visible. */
  readonly musicPlayerVisible: boolean;
  /** Title of the currently playing track, or a placeholder. */
  readonly currentTrackTitle: string;
  /** Human-readable vibe badge (e.g. "Exploration · Forest"). */
  readonly vibeLabel: string;
  /** Vibe tags for the current scene context. */
  readonly vibeTags: readonly string[];
  /** Whether BGM is actively playing (not paused). */
  readonly isPlaying: boolean;
  /** Whether BGM is paused. */
  readonly isPaused: boolean;
  /** Whether a different similar-vibe track exists to skip to. */
  readonly hasSimilarTracks: boolean;
  /** Tracks in the local music library (with tags). */
  readonly tracks: readonly Track[];
  /** Scene/vibe presets for testing vibe-matched skipping. */
  readonly scenePresets: readonly DevScenePreset[];

  playExploreBgm(): Promise<void>;
  playCombatBgm(): Promise<void>;
  playHitSfx(): Promise<void>;
  playPickupSfx(): Promise<void>;
  stopAll(): void;

  toggleMusicPlayer(): void;
  playTrack(track: Track): Promise<void>;
  pauseMusic(): void;
  resumeMusic(): Promise<void>;
  skipMusic(): Promise<void>;
  stopMusic(): void;
  /** Applies a scene/vibe preset for vibe-matched skipping tests. */
  setScenePreset(presetId: string): void;
  /** Restores the live game scene (map/time/weather) as the vibe source. */
  resetToLiveScene(): void;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type DevAudioViewModelOptions = BaseViewModelOptions;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class DevAudioViewModel
  extends BaseViewModel<DevAudioViewModelOptions>
  implements DevAudioViewModelInterface
{
  masterVolume = $state<number>(audioService.masterVolume);
  bgmVolume = $state<number>(audioService.bgmVolume);
  sfxVolume = $state<number>(audioService.sfxVolume);
  isCrossfading = $state<boolean>(false);
  feedback = $state<string>('Ready — press a button to test audio.');

  /** Polling interval for syncing display from audioService. */
  private _pollInterval: ReturnType<typeof setInterval> | undefined;

  get musicPlayerVisible(): boolean {
    return musicPlayerService.visible;
  }

  get currentTrackTitle(): string {
    return musicPlayerService.currentTrack?.title ?? 'No music playing';
  }

  get vibeLabel(): string {
    return musicPlayerService.vibeLabel;
  }

  get vibeTags(): readonly string[] {
    return musicPlayerService.vibeTags;
  }

  get isPlaying(): boolean {
    return musicPlayerService.isPlaying;
  }

  get isPaused(): boolean {
    return musicPlayerService.isPaused;
  }

  get hasSimilarTracks(): boolean {
    return musicPlayerService.hasSimilarTracks;
  }

  get tracks(): readonly Track[] {
    return trackRegistryService.tracks;
  }

  get scenePresets(): readonly DevScenePreset[] {
    return DEV_SCENE_PRESETS;
  }

  /** @inheritdoc */
  override async initialize(): Promise<void> {
    // Discover tracks + restore overlay visibility.
    await musicPlayerService.initialize();

    // Poll audioService every ~200ms to keep the display in sync
    this._pollInterval = setInterval(() => {
      this.masterVolume = audioService.masterVolume;
      this.bgmVolume = audioService.bgmVolume;
      this.sfxVolume = audioService.sfxVolume;
      this.isCrossfading = audioService.isCrossfading;
    }, 200);
    await super.initialize();
  }

  /** @inheritdoc */
  override async dispose(): Promise<void> {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = undefined;
    }
    await super.dispose();
  }

  /** @inheritdoc */
  async playExploreBgm(): Promise<void> {
    this.feedback = 'Crossfading to Exploration BGM…';
    await playSceneBgm('explore');
    this.feedback = 'Playing: Exploration BGM';
  }

  /** @inheritdoc */
  async playCombatBgm(): Promise<void> {
    this.feedback = 'Crossfading to Combat BGM…';
    await playSceneBgm('combat');
    this.feedback = 'Playing: Combat BGM';
  }

  /** @inheritdoc */
  async playHitSfx(): Promise<void> {
    this.feedback = 'Playing: Hit SFX';
    await playSfxByName('sfx_hit');
  }

  /** @inheritdoc */
  async playPickupSfx(): Promise<void> {
    this.feedback = 'Playing: Pickup SFX';
    await playSfxByName('sfx_pickup');
  }

  /** @inheritdoc */
  stopAll(): void {
    audioService.stopAll();
    this.feedback = 'All audio stopped.';
  }

  // ── Music player controls ──

  toggleMusicPlayer(): void {
    musicPlayerService.toggleVisible();
  }

  async playTrack(track: Track): Promise<void> {
    await musicPlayerService.playTrack(track);
  }

  pauseMusic(): void {
    musicPlayerService.pause();
  }

  async resumeMusic(): Promise<void> {
    await musicPlayerService.resume();
  }

  async skipMusic(): Promise<void> {
    await musicPlayerService.skip();
  }

  stopMusic(): void {
    musicPlayerService.stop();
  }

  setScenePreset(presetId: string): void {
    const preset = DEV_SCENE_PRESETS.find((p) => p.id === presetId);
    if (!preset) {
      return;
    }
    musicPlayerService.setSceneContext(preset.scene);
    this.feedback = `Vibe: ${preset.label} → tags [${musicPlayerService.vibeTags.join(', ')}]`;
  }

  resetToLiveScene(): void {
    musicPlayerService.setSceneContext(buildMusicSceneContext());
    this.feedback = `Live scene: ${musicPlayerService.vibeLabel}`;
  }
}

export const getDevAudioViewModel = (
  options: DevAudioViewModelOptions,
): DevAudioViewModelInterface => new DevAudioViewModel(options);
