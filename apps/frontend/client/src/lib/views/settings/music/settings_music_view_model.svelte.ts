// apps/frontend/client/src/lib/views/settings/music/settings_music_view_model.svelte.ts
//
// SettingsMusicViewModel — music settings tab with provider selector,
// track library browser, tag filters, scene-type overrides, volume
// controls, and mute/preview functionality.
//
// Contract: C-249

import {
  CROSSFADE_DURATION_DEFAULT_MS,
  CROSSFADE_DURATION_MAX_MS,
  CROSSFADE_DURATION_MIN_MS,
  GENRE_TAGS,
  INTENSITY_TAGS,
  MOOD_TAGS,
  MUSIC_PROVIDERS,
  SCENE_TYPE_LABELS,
  SCENE_TYPES,
  type SceneType,
  TRACK_PREVIEW_DURATION_SECONDS,
} from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { MusicProviderType, SceneTrackOverride, Track } from '@aikami/types';
import { assetStore, audioService, trackRegistryService } from '$services';

// ---------------------------------------------------------------------------
// Filter tag type
// ---------------------------------------------------------------------------

export type FilterTag = {
  label: string;
  active: boolean;
};

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type SettingsMusicViewModelInterface = BaseViewModelInterface & {
  /** Current music provider. */
  readonly provider: MusicProviderType;
  /** All available music provider options. */
  readonly providers: ReadonlyArray<{
    id: string;
    label: string;
    enabled: boolean;
    comingSoon: boolean;
  }>;
  /** All registered tracks. */
  readonly tracks: Track[];
  /** Whether the track registry is loaded. */
  readonly isReady: boolean;
  /** Active genre filter tags. */
  readonly genreFilters: FilterTag[];
  /** Active intensity filter tags. */
  readonly intensityFilters: FilterTag[];
  /** Active mood filter tags. */
  readonly moodFilters: FilterTag[];
  /** Filtered tracks based on active tag filters. */
  readonly filteredTracks: Track[];
  /** Currently previewing track ID (null if not previewing). */
  readonly previewingTrackId: string | null;
  /** Preview countdown remaining (seconds). */
  readonly previewSecondsRemaining: number;
  /** Whether the audio is muted. */
  readonly isMuted: boolean;
  /** Music volume (0–1). */
  readonly musicVolume: number;
  /** Crossfade duration in milliseconds. */
  readonly crossfadeDurationMs: number;
  /** Per-scene-type track override assignments. */
  readonly sceneOverrides: Record<SceneType, string | 'auto'>;
  /** Scene type label + track options for dropdowns. */
  readonly sceneTypes: ReadonlyArray<{ id: SceneType; label: string }>;
  /** Track options for scene-type dropdowns (includes 'Auto' option). */
  readonly trackOptions: ReadonlyArray<{ value: string; label: string }>;
  /** Feedback message for user actions. */
  readonly feedback: string;

  /** Set the music provider. */
  setProvider(provider: MusicProviderType): void;
  /** Toggle a genre filter tag. */
  toggleGenreFilter(label: string): void;
  /** Toggle an intensity filter tag. */
  toggleIntensityFilter(label: string): void;
  /** Toggle a mood filter tag. */
  toggleMoodFilter(label: string): void;
  /** Clear all tag filters. */
  clearFilters(): void;
  /** Preview a track (15-second crossfade). */
  previewTrack(trackId: string): Promise<void>;
  /** Stop preview and restore previous BGM. */
  stopPreview(): Promise<void>;
  /** Set the scene override for a scene type. */
  setSceneOverride(sceneType: SceneType, trackId: string): void;
  /** Set music volume. */
  setMusicVolume(volume: number): void;
  /** Set crossfade duration. */
  setCrossfadeDuration(ms: number): void;
  /** Toggle mute. */
  toggleMute(): void;
  /** Rescan local tracks from asset manifest. */
  rescanTracks(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type SettingsMusicViewModelOptions = BaseViewModelOptions;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class SettingsMusicViewModel
  extends BaseViewModel<SettingsMusicViewModelOptions>
  implements SettingsMusicViewModelInterface
{
  provider = $state<MusicProviderType>('local');
  tracks = $state<Track[]>([]);
  isReady = $state<boolean>(false);
  genreFilters = $state<FilterTag[]>(GENRE_TAGS.map((label) => ({ label, active: false })));
  intensityFilters = $state<FilterTag[]>(INTENSITY_TAGS.map((label) => ({ label, active: false })));
  moodFilters = $state<FilterTag[]>(MOOD_TAGS.map((label) => ({ label, active: false })));
  previewingTrackId = $state<string | null>(null);
  previewSecondsRemaining = $state<number>(0);
  isMuted = $state<boolean>(false);
  musicVolume = $state<number>(audioService.bgmVolume);
  crossfadeDurationMs = $state<number>(CROSSFADE_DURATION_DEFAULT_MS);
  sceneOverrides = $state<Record<SceneType, string | 'auto'>>(
    {} as Record<SceneType, string | 'auto'>,
  );
  feedback = $state<string>('');

  readonly providers = MUSIC_PROVIDERS;
  readonly sceneTypes = SCENE_TYPES.map((id) => ({
    id,
    label: SCENE_TYPE_LABELS[id],
  }));

  private _previewTimer: ReturnType<typeof setInterval> | undefined;
  private _previousTrackUrl: string | null = null;

  // ── Derived ──

  get filteredTracks(): Track[] {
    const activeGenres = this.genreFilters.filter((f) => f.active).map((f) => f.label);
    const activeIntensities = this.intensityFilters.filter((f) => f.active).map((f) => f.label);
    const activeMoods = this.moodFilters.filter((f) => f.active).map((f) => f.label);

    const hasFilters =
      activeGenres.length > 0 || activeIntensities.length > 0 || activeMoods.length > 0;
    if (!hasFilters) {
      return this.tracks;
    }

    return this.tracks.filter((track) => {
      const tagSet = new Set(track.tags.map((t) => t.toLowerCase()));

      const matchesGenre = activeGenres.length === 0 || activeGenres.some((g) => tagSet.has(g));
      const matchesIntensity =
        activeIntensities.length === 0 || activeIntensities.some((i) => tagSet.has(i));
      const matchesMood = activeMoods.length === 0 || activeMoods.some((m) => tagSet.has(m));

      return matchesGenre && matchesIntensity && matchesMood;
    });
  }

  get trackOptions(): ReadonlyArray<{ value: string; label: string }> {
    const options: { value: string; label: string }[] = [
      { value: 'auto', label: 'Auto (DJ Agent)' },
    ];
    for (const track of this.tracks) {
      options.push({ value: track.id, label: track.title });
    }
    return options;
  }

  // ── Lifecycle ──

  override async initialize(): Promise<void> {
    this.isMuted = assetStore.audioMuted;

    // Initialize scene overrides with defaults
    const defaults: Record<string, string | 'auto'> = {};
    for (const sceneType of SCENE_TYPES) {
      defaults[sceneType] = 'auto';
    }
    this.sceneOverrides = defaults as Record<SceneType, string | 'auto'>;

    // Discover local tracks
    await this.rescanTracks();

    await super.initialize();
  }

  override async dispose(): Promise<void> {
    this._clearPreviewTimer();
    await super.dispose();
  }

  // ── Provider ──

  setProvider(provider: MusicProviderType): void {
    const option = MUSIC_PROVIDERS.find((p) => p.id === provider);
    if (!option?.enabled) {
      this.feedback = `${option?.label ?? provider} is not available in this version.`;
      return;
    }
    this.provider = provider;
  }

  // ── Filters ──

  toggleGenreFilter(label: string): void {
    const filter = this.genreFilters.find((f) => f.label === label);
    if (filter) {
      filter.active = !filter.active;
    }
  }

  toggleIntensityFilter(label: string): void {
    const filter = this.intensityFilters.find((f) => f.label === label);
    if (filter) {
      filter.active = !filter.active;
    }
  }

  toggleMoodFilter(label: string): void {
    const filter = this.moodFilters.find((f) => f.label === label);
    if (filter) {
      filter.active = !filter.active;
    }
  }

  clearFilters(): void {
    for (const f of this.genreFilters) {
      f.active = false;
    }
    for (const f of this.intensityFilters) {
      f.active = false;
    }
    for (const f of this.moodFilters) {
      f.active = false;
    }
  }

  // ── Preview ──

  async previewTrack(trackId: string): Promise<void> {
    if (this.isMuted) {
      this.feedback = 'Unmute to preview';
      return;
    }

    const track = trackRegistryService.getTrackById(trackId);
    if (!track?.url) {
      this.feedback = 'Track not found';
      return;
    }

    // Stop current preview if any
    this._clearPreviewTimer();

    // Save previous BGM URL
    this._previousTrackUrl = audioService.activeTrackUrl;

    this.previewingTrackId = trackId;
    this.previewSecondsRemaining = TRACK_PREVIEW_DURATION_SECONDS;
    this.feedback = `Previewing: ${track.title}`;

    await audioService.transitionToBgm(track.url, 500);

    // Countdown timer
    this._previewTimer = setInterval(() => {
      this.previewSecondsRemaining -= 1;
      if (this.previewSecondsRemaining <= 0) {
        this.stopPreview();
      }
    }, 1000);
  }

  async stopPreview(): Promise<void> {
    this._clearPreviewTimer();

    // Restore previous BGM if any
    if (this._previousTrackUrl) {
      await audioService.transitionToBgm(this._previousTrackUrl, 1000);
      this._previousTrackUrl = null;
    } else {
      audioService.stopAll();
    }

    this.previewingTrackId = null;
    this.previewSecondsRemaining = 0;
    this.feedback = '';
  }

  // ── Scene Overrides ──

  setSceneOverride(sceneType: SceneType, trackId: string): void {
    this.sceneOverrides[sceneType] = trackId;

    // Sync to track registry service
    const overrides: SceneTrackOverride[] = [];
    for (const [key, value] of Object.entries(this.sceneOverrides)) {
      overrides.push({ sceneType: key, trackId: value });
    }
    trackRegistryService.setSceneOverrides(overrides);

    this.feedback = `Scene override set: ${SCENE_TYPE_LABELS[sceneType]}`;
  }

  // ── Volume ──

  setMusicVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.musicVolume = clamped;
    audioService.setBgmVolume(clamped);
  }

  setCrossfadeDuration(ms: number): void {
    const clamped = Math.max(CROSSFADE_DURATION_MIN_MS, Math.min(CROSSFADE_DURATION_MAX_MS, ms));
    this.crossfadeDurationMs = clamped;
  }

  // ── Mute ──

  toggleMute(): void {
    this.isMuted = !this.isMuted;
    assetStore.setAudioMuted(this.isMuted);

    if (this.isMuted) {
      audioService.setBgmVolume(0);
      audioService.setSfxVolume(0);
    } else {
      audioService.setBgmVolume(this.musicVolume);
      audioService.setSfxVolume(1);
    }
  }

  // ── Rescan ──

  async rescanTracks(): Promise<void> {
    this.feedback = 'Scanning for tracks…';
    await trackRegistryService.discoverLocal();
    this.tracks = trackRegistryService.tracks;
    this.isReady = trackRegistryService.isReady;
    this.feedback =
      this.tracks.length > 0
        ? `Found ${this.tracks.length} track(s)`
        : 'No tracks found in library';
  }

  // ── Private ──

  private _clearPreviewTimer(): void {
    if (this._previewTimer) {
      clearInterval(this._previewTimer);
      this._previewTimer = undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const getSettingsMusicViewModel = (
  options: SettingsMusicViewModelOptions,
): SettingsMusicViewModelInterface => SettingsMusicViewModel.create(options);
