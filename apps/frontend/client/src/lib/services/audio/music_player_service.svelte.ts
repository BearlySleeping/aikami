// apps/frontend/client/src/lib/services/audio/music_player_service.svelte.ts
//
// MusicPlayerService — in-game music player orchestrator.
//
// Wraps the AudioService (BGM engine) + TrackRegistryService (tag-based
// library) to power the optional mini music-player overlay:
//   - Shows the currently playing track (title + vibe badge)
//   - Pause / resume / stop / skip controls
//   - "Similar vibe" skip: resolves another track whose tags overlap the
//     current scene context (e.g. exploration forest → another ambient
//     forest track), crossfading between tracks.
//
// 🔴 This service owns PLAYBACK only. Widget visibility belongs to the HUD
// preference authority (C-528 Directive 11): the `music-player` widget's
// visibility is set in the HUD editor / Interface settings, and the legacy
// Audio-tab switch is an adapter over it. There is no second visibility store.
//
// Contract: C-150 (audio engine), C-243 (asset manifest), C-249 (music tags)

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import type { MusicSceneContext, Track } from '@aikami/types';
import { MUSIC_VIBE_TAGS } from '$lib/data/music_track_catalog';
import {
  type MusicPlaybackIntent,
  readMusicPlaybackIntent,
  writeMusicPlaybackIntent,
} from '$lib/utils/music_playback_intent.ts';
import { audioService } from './audio_service.svelte.ts';
import { sceneToMusicTags } from './scene_to_music_tags';
import { trackRegistryService } from './track_registry_service.svelte.ts';

/** Default crossfade between tracks on skip (ms). */
const SKIP_CROSSFADE_MS = 1200;

export type MusicPlayerServiceOptions = BaseFrontendClassOptions;

export type MusicPlayerServiceInterface = BaseFrontendClassInterface & {
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

  /**
   * The player's stored BGM intent, or `undefined` when they have never used
   * the controls.
   *
   * Reported so the overlay can tell the truth about why it is silent. 🔴 It is
   * intent, never playback: nothing is resumed from it, and a reload never
   * starts audio on its own. `undefined` is meaningful — it means the player
   * never expressed an opinion, so silence is not something to explain.
   */
  readonly intent: MusicPlaybackIntent | undefined;

  /** Title of the track the intent refers to, when it is still in the library. */
  readonly intentTrackTitle: string | undefined;

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

  /**
   * Stops all BGM without recording a player intent.
   *
   * For teardown only. A page unload runs this; if it recorded `stopped` it
   * would overwrite a genuine pause the player never asked to lose.
   */
  stopForTeardown(): void;

  /** Plays a specific track. */
  playTrack(track: Track): Promise<void>;
};

class MusicPlayerService
  extends BaseFrontendClass<MusicPlayerServiceOptions>
  implements MusicPlayerServiceInterface
{
  currentScene: MusicSceneContext = $state<MusicSceneContext>({
    locationType: 'wilderness',
    timeOfDay: 'afternoon',
    weather: 'clear',
    isInCombat: false,
    mood: 'neutral',
    lastNarrative: '',
  });
  feedback = $state<string>('');

  /**
   * The player's BGM intent, restored at construction.
   *
   * 🔴 Read here, in the constructor, for the same reason the preference
   * service restores at construction: two entry points boot this service and a
   * restore that only happened in `initialize()` would be one forgotten call
   * site away from ignoring a Stop the player already pressed.
   */
  private _intent: MusicPlaybackIntent | undefined = readMusicPlaybackIntent();

  /** Tracks already attempted this session (skip rotation, avoids repeats). */
  private readonly _skipHistory: string[] = [];

  /**
   * Tracks this device advertised but could not load.
   *
   * A dead entry must be tried once, not on every press: otherwise a 404
   * re-fetches on each click and the player waits on a track that will never
   * sound. Cleared with the rest of the session state on {@link stop}.
   */
  private readonly _unplayable = new Set<string>();

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
  get intent(): MusicPlaybackIntent | undefined {
    return this._intent;
  }

  /** @inheritdoc */
  get intentTrackTitle(): string | undefined {
    const trackId = this._intent?.trackId;
    if (!trackId) {
      return undefined;
    }
    return this.tracks.find((track) => track.id === trackId)?.title;
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

  // ── Lifecycle ──

  /** @inheritdoc */
  async initialize(): Promise<void> {
    // Curated vibe tags make scene matching meaningful.
    trackRegistryService.registerVibeTags(MUSIC_VIBE_TAGS);
    await trackRegistryService.discoverLocal();

    this.debug('initialize', {
      tracks: this.tracks.length,
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
    this._recordIntent('paused', this.currentTrack?.id);
  }

  /** @inheritdoc */
  async resume(): Promise<void> {
    await audioService.resumeBgm();
    this._recordIntent('playing', this.currentTrack?.id);
  }

  /** @inheritdoc */
  stop(): void {
    this._stopPlayback();
    this._recordIntent('stopped', undefined);
  }

  /** @inheritdoc */
  async playTrack(track: Track): Promise<void> {
    if (!track.url) {
      this.warn('playTrack:no-url', { trackId: track.id });
      return;
    }
    if (await this._tryPlay(track)) {
      this._recordIntent('playing', track.id);
      return;
    }

    // 🔴 The catalog can advertise a track whose bytes were never published —
    // the device then 404s and the player hears nothing at all, with the panel
    // showing a track that will never play. Rather than giving up on the first
    // dead entry, fall through the library so the button always does something.
    const alternative = this._findSimilarTrack();
    if (!alternative || !(await this._tryPlay(alternative))) {
      this.feedback = 'No track in your library could be played';
      this.warn('playTrack:no-playable-track', { requested: track.id });
      return;
    }
    this.feedback = `${track.title} is unavailable — playing ${alternative.title}`;
    this.warn('playTrack:unavailable', { requested: track.id, played: alternative.id });
    this._recordIntent('playing', alternative.id);
  }

  /**
   * Plays one track and reports whether it actually started.
   *
   * 🔴 `transitionToBgm` deliberately swallows a load failure (it logs and
   * returns), so it cannot be used as the success signal. The one thing it
   * does on success is publish the track as active — so that is what we check,
   * rather than changing a contract the combat and scene paths also depend on.
   */
  private async _tryPlay(track: Track): Promise<boolean> {
    if (!track.url) {
      this.warn('playTrack:no-url', { trackId: track.id });
      return false;
    }
    this.debug('playTrack', { trackId: track.id, title: track.title, url: track.url });
    await audioService.transitionToBgm(track.url, SKIP_CROSSFADE_MS);
    if (audioService.activeTrackUrl === track.url) {
      return true;
    }
    this._unplayable.add(track.id);
    return false;
  }

  /**
   * Tears playback down WITHOUT recording an intent.
   *
   * 🔴 The composition root calls `stop()` on dispose — which runs on every
   * page unload. If that recorded `stopped`, then closing the tab mid-song
   * would silently overwrite a real pause, and "I paused it and it came back"
   * would be indistinguishable from a bug. Disposal is not a player decision,
   * so it must never write one.
   */
  stopForTeardown(): void {
    this._stopPlayback();
  }

  // ── Private ──

  private _stopPlayback(): void {
    audioService.stopAll();
    this._skipHistory.length = 0;
    this._unplayable.clear();
    this.feedback = '';
  }

  private _recordIntent(state: MusicPlaybackIntent['state'], trackId: string | undefined): void {
    // No short-circuit on "the in-memory intent already matches": the initial
    // value is the DEFAULT, which was never written. Skipping the write would
    // leave nothing on disk, so a first Stop would record nothing at all.
    // Player-initiated writes are rare enough not to be worth guarding.
    this._intent = { state, trackId };
    writeMusicPlaybackIntent(this._intent);
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
      // A track this device already failed to load is not a candidate: the
      // fallthrough would just 404 again and report it as the "alternative".
      if (track.id === currentId || recent.has(track.id) || this._unplayable.has(track.id)) {
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
      best =
        this.tracks.find(
          (t) => t.id !== currentId && !recent.has(t.id) && !this._unplayable.has(t.id),
        ) ?? null;
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
