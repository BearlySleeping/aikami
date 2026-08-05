// apps/frontend/client/src/lib/services/audio/music_player_service.svelte.ts
//
// MusicPlayerService — in-game music player orchestrator.
//
// Wraps the AudioService (BGM engine) + TrackRegistryService (tag-based
// library) to power an optional mini music-player overlay:
//   - Shows the currently playing track (title + vibe badge)
//   - Pause / resume / stop / skip controls
//   - "Similar vibe" skip: resolves another track whose tags overlap the
//     current scene context (e.g. exploration forest → another ambient
//     forest track), crossfading between tracks.
//   - Persisted visibility toggle (shown/hidden from Settings > Audio).
//
// Contract: C-150 (audio engine), C-243 (asset manifest), C-249 (music tags)

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { MusicSceneContext, Track } from '@aikami/types';
import { MUSIC_VIBE_TAGS } from '$lib/data/music_track_catalog';
import {
  audioService,
  gameEngineService,
  gameOverlayService,
  timeService,
  trackRegistryService,
} from '$services';
import { sceneToMusicTags } from './scene_to_music_tags';

/** localStorage key for the music player visibility toggle. */
const MUSIC_PLAYER_VISIBLE_KEY = 'aikami:music-player:visible';

/** Default crossfade between tracks on skip (ms). */
const SKIP_CROSSFADE_MS = 1200;

export type MusicPlayerServiceOptions = BaseFrontendClassOptions;

export type MusicPlayerServiceInterface = BaseFrontendClassInterface & {
  /** Whether the music player overlay is shown (persisted toggle). */
  readonly visible: boolean;

  /** The currently playing track, or null when none. */
  readonly currentTrack: Track | null;

  /** Whether BGM is actively playing (not paused, not stopped). */
  readonly isPlaying: boolean;

  /** Whether BGM is paused. */
  readonly isPaused: boolean;

  /** All tracks in the local music library. */
  readonly tracks: readonly Track[];

  /** Vibe tags for the current scene context (e.g. ambient, calm, forest). */
  readonly vibeTags: readonly string[];

  /** Human-readable vibe label (e.g. "Exploration · Forest"). */
  readonly vibeLabel: string;

  /** Whether a different similar-vibe track exists to skip to. */
  readonly hasSimilarTracks: boolean;

  /** Last user-facing feedback message (e.g. "No other similar track"). */
  readonly feedback: string;

  /** Shows/hides the overlay and persists the choice. */
  toggleVisible(): void;

  /** Explicitly sets overlay visibility. */
  setVisible(visible: boolean): void;

  /** Discovers tracks, registers vibe tags, and starts scene watching. */
  initialize(): Promise<void>;

  /** Updates the scene context used for vibe matching. */
  setSceneContext(scene: MusicSceneContext): void;

  /** Crossfades to another track matching the current vibe. */
  skip(): Promise<void>;

  /** Pauses BGM (position retained). */
  pause(): void;

  /** Resumes BGM from the paused position. */
  resume(): Promise<void>;

  /** Stops all BGM. */
  stop(): void;

  /** Plays a specific track. */
  playTrack(track: Track): Promise<void>;
};

class MusicPlayerService
  extends BaseFrontendClass<MusicPlayerServiceOptions>
  implements MusicPlayerServiceInterface
{
  visible = $state<boolean>(false);
  currentScene: MusicSceneContext = $state<MusicSceneContext>({
    locationType: 'wilderness',
    timeOfDay: 'afternoon',
    weather: 'clear',
    isInCombat: false,
    mood: 'neutral',
    lastNarrative: '',
  });
  feedback = $state<string>('');

  /** Tracks already attempted this session (skip rotation, avoids repeats). */
  private readonly _skipHistory: string[] = [];

  // ── Derived state ──

  /** @inheritdoc */
  get currentTrack(): Track | null {
    const url = audioService.activeTrackUrl;
    if (!url) {
      return null;
    }
    return this.tracks.find((t) => t.url === url) ?? null;
  }

  /** @inheritdoc */
  get isPlaying(): boolean {
    return audioService.activeTrackUrl !== null && !audioService.isBgmPaused;
  }

  /** @inheritdoc */
  get isPaused(): boolean {
    return audioService.isBgmPaused;
  }

  /** @inheritdoc */
  get tracks(): readonly Track[] {
    return trackRegistryService.tracks;
  }

  /** @inheritdoc */
  get vibeTags(): readonly string[] {
    return sceneToMusicTags(this.currentScene);
  }

  /** @inheritdoc */
  get vibeLabel(): string {
    const { locationType, isInCombat } = this.currentScene;
    if (isInCombat) {
      return 'Combat';
    }
    const location = locationType.charAt(0).toUpperCase() + locationType.slice(1);
    return `Exploration · ${location}`;
  }

  /** @inheritdoc */
  get hasSimilarTracks(): boolean {
    return this._findSimilarTrack() !== null;
  }

  // ── Visibility toggle (persisted) ──

  /** @inheritdoc */
  toggleVisible(): void {
    this.setVisible(!this.visible);
  }

  /** @inheritdoc */
  setVisible(visible: boolean): void {
    this.visible = visible;
    try {
      localStorage.setItem(MUSIC_PLAYER_VISIBLE_KEY, visible ? '1' : '0');
    } catch {
      // localStorage unavailable (SSR/privacy mode) — in-memory only
    }
    this.debug('setVisible', { visible });
  }

  // ── Lifecycle ──

  /** @inheritdoc */
  async initialize(): Promise<void> {
    // Restore persisted visibility.
    try {
      this.visible = localStorage.getItem(MUSIC_PLAYER_VISIBLE_KEY) === '1';
    } catch {
      this.visible = false;
    }

    // Curated vibe tags make scene matching meaningful.
    trackRegistryService.registerVibeTags(MUSIC_VIBE_TAGS);
    await trackRegistryService.discoverLocal();

    this.debug('initialize', {
      tracks: this.tracks.length,
      visible: this.visible,
    });
  }

  // ── Scene context ──

  /** @inheritdoc */
  setSceneContext(scene: MusicSceneContext): void {
    const tags = sceneToMusicTags(scene);
    this.currentScene = scene;
    this.debug('sceneContext', {
      locationType: scene.locationType,
      timeOfDay: scene.timeOfDay,
      tags,
    });
  }

  // ── Controls ──

  /** @inheritdoc */
  async skip(): Promise<void> {
    const similar = this._findSimilarTrack();
    if (similar) {
      const currentId = this.currentTrack?.id;
      if (currentId) {
        this._skipHistory.push(currentId);
      }
      this.feedback = '';
      await this.playTrack(similar);
      return;
    }

    // No different similar-vibe track — surface why instead of silently
    // replaying the same song.
    const reason =
      this.tracks.length <= 1
        ? 'Only one track in the library'
        : 'No other track matches this vibe';
    this.feedback = reason;
    this.warn('skip:no-similar-track', {
      vibeTags: this.vibeTags,
      trackCount: this.tracks.length,
      currentTrack: this.currentTrack?.id,
    });
  }

  /** @inheritdoc */
  pause(): void {
    audioService.pauseBgm();
  }

  /** @inheritdoc */
  async resume(): Promise<void> {
    await audioService.resumeBgm();
  }

  /** @inheritdoc */
  stop(): void {
    audioService.stopAll();
    this._skipHistory.length = 0;
    this.feedback = '';
  }

  /** @inheritdoc */
  async playTrack(track: Track): Promise<void> {
    if (!track.url) {
      this.warn('playTrack:no-url', { trackId: track.id });
      return;
    }
    this.debug('playTrack', { trackId: track.id, title: track.title, url: track.url });
    await audioService.transitionToBgm(track.url, SKIP_CROSSFADE_MS);
  }

  // ── Private: similar-track resolution ──

  /**
   * Finds another track matching the current vibe.
   *
   * Scores library tracks by tag overlap with the scene vibe tags, excludes
   * the currently playing track and recent skip targets, and returns the best
   * match. Falls back to any other track when the vibe has no overlap.
   * If all tracks are excluded, resets skip history and rescores.
   */
  private _findSimilarTrack(): Track | null {
    const currentId = this.currentTrack?.id;
    const tags = new Set(this.vibeTags.map((t) => t.toLowerCase()));
    const recent = new Set(this._skipHistory);

    let best: Track | null = null;
    let bestScore = 0;

    for (const track of this.tracks) {
      if (track.id === currentId || recent.has(track.id)) {
        continue;
      }
      const overlap = track.tags.filter((t) => tags.has(t.toLowerCase())).length;
      if (overlap > bestScore) {
        bestScore = overlap;
        best = track;
      }
    }

    // No vibe overlap — still offer a different track if one exists.
    if (!best && this.tracks.length > 1) {
      best = this.tracks.find((t) => t.id !== currentId && !recent.has(t.id)) ?? null;
    }

    // If all tracks other than current are excluded, reset skip history and rescore
    if (!best && this.tracks.length > 1 && this._skipHistory.length > 0) {
      this._skipHistory.length = 0;
      this.debug('findSimilarTrack:history-reset', { trackCount: this.tracks.length });
      return this._findSimilarTrack();
    }

    if (best) {
      this.debug('findSimilarTrack', {
        vibeTags: [...tags],
        chosen: best.id,
        overlapScore: bestScore,
      });
    }
    return best;
  }
}

/** Singleton instance of the music player service. */
export const musicPlayerService: MusicPlayerServiceInterface = MusicPlayerService.create({
  className: 'MusicPlayerService',
});

/**
 * Builds a MusicSceneContext from the live game state:
 * current map name → location type, game clock → time of day,
 * rain intensity → weather, overlay state → combat.
 *
 * Module-level so ViewModels can watch the reactive inputs and push the
 * refreshed context into the music player service.
 */
export const buildMusicSceneContext = (): MusicSceneContext => {
  // Prefer the live scene name; fall back to the loaded map id when the
  // engine hasn't reported a named scene yet (e.g. before first movement).
  const rawScene =
    gameEngineService.playerScene && gameEngineService.playerScene !== 'unknown'
      ? gameEngineService.playerScene
      : gameEngineService.currentMapId;
  const scene = rawScene ?? '';
  const locationType = scene.includes('village')
    ? 'village'
    : scene.includes('road') || scene.includes('forest')
      ? 'forest'
      : scene.includes('shrine') || scene.includes('dungeon')
        ? 'dungeon'
        : 'wilderness';

  const hour = timeService.gameHour;
  const timeOfDay =
    hour >= 21 || hour < 5
      ? 'night'
      : hour >= 17
        ? 'evening'
        : hour >= 12
          ? 'afternoon'
          : 'morning';

  const rain = timeService.rainIntensity;
  const weather = rain > 0.5 ? 'storm' : rain > 0.05 ? 'rain' : 'clear';

  const isInCombat = gameOverlayService.activeOverlay === 'COMBAT';

  return {
    locationType,
    timeOfDay,
    weather,
    isInCombat,
    combatIntensity: isInCombat ? 'medium' : undefined,
    mood: 'neutral',
    lastNarrative: '',
  };
};
