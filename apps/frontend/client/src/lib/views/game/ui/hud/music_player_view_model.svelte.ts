// apps/frontend/client/src/lib/views/game/ui/hud/music_player_view_model.svelte.ts
//
// MusicPlayerViewModel — thin ViewModel over the mini music-player overlay.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures. Production wiring lives in
// ./music_player_composition.ts.
//
// Contract: C-150 (audio engine), C-249 (music tags)

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { MusicSceneContext } from '@aikami/types';
import type { GameOverlayType } from '$types';

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/** Playback state and controls the music-player overlay consumes. */
export type MusicPlayerCapabilities = {
  readonly visible: boolean;
  readonly currentTrack: { title: string } | null;
  readonly vibeLabel: string;
  readonly isPlaying: boolean;
  readonly isPaused: boolean;
  readonly hasSimilarTracks: boolean;
  readonly feedback: string;
  setVisible(v: boolean): void;
  resume(): Promise<void>;
  pause(): void;
  skip(): Promise<void>;
  stop(): void;
  setSceneContext(ctx: MusicSceneContext): void;
};

/** Live game-state reads the ViewModel watches to derive the scene context. */
export type MusicPlayerContextCapabilities = {
  readonly playerScene: string;
  readonly currentMapId: string;
  readonly gameHour: number;
  readonly rainIntensity: number;
  readonly activeOverlay: GameOverlayType;
  /** Builds the current scene context from live game state. */
  buildSceneContext(): MusicSceneContext;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type MusicPlayerViewModelOptions = BaseViewModelOptions & {
  player: MusicPlayerCapabilities;
  context: MusicPlayerContextCapabilities;
};

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type MusicPlayerViewModelInterface = BaseViewModelInterface & {
  /** Whether the overlay is visible (persisted toggle). */
  readonly visible: boolean;

  /** Title of the currently playing track, or a placeholder. */
  readonly currentTrackTitle: string;

  /** Human-readable vibe badge (e.g. "Exploration · Forest"). */
  readonly vibeLabel: string;

  /** Whether BGM is actively playing (not paused, not stopped). */
  readonly isPlaying: boolean;

  /** Whether BGM is paused. */
  readonly isPaused: boolean;

  /** Whether a different similar-vibe track exists to skip to. */
  readonly hasSimilarTracks: boolean;

  /** Whether any track is loaded/playing at all. */
  readonly hasActiveTrack: boolean;

  /** Last user-facing feedback (e.g. "Only one track in the library"). */
  readonly feedback: string;

  /** Hides the overlay. */
  hide(): void;

  /** Toggles play/pause for the current track. */
  togglePlayPause(): Promise<void>;

  /** Skips to another track matching the current vibe. */
  skip(): Promise<void>;

  /** Stops all BGM. */
  stop(): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class MusicPlayerViewModel
  extends BaseViewModel<MusicPlayerViewModelOptions>
  implements MusicPlayerViewModelInterface
{
  private readonly _player: MusicPlayerCapabilities;
  private readonly _context: MusicPlayerContextCapabilities;

  constructor(options: MusicPlayerViewModelOptions) {
    super(options);
    this._player = options.player;
    this._context = options.context;
  }

  get visible(): boolean {
    return this._player.visible;
  }

  get currentTrackTitle(): string {
    return this._player.currentTrack?.title ?? 'No music playing';
  }

  get vibeLabel(): string {
    return this._player.vibeLabel;
  }

  get isPlaying(): boolean {
    return this._player.isPlaying;
  }

  get isPaused(): boolean {
    return this._player.isPaused;
  }

  get hasSimilarTracks(): boolean {
    return this._player.hasSimilarTracks;
  }

  get hasActiveTrack(): boolean {
    return this._player.currentTrack !== null;
  }

  get feedback(): string {
    return this._player.feedback;
  }

  hide(): void {
    this._player.setVisible(false);
  }

  async togglePlayPause(): Promise<void> {
    if (this._player.isPaused) {
      await this._player.resume();
    } else if (this._player.isPlaying) {
      this._player.pause();
    } else {
      // Stopped — resume the vibe-appropriate track.
      await this._player.skip();
    }
  }

  async skip(): Promise<void> {
    await this._player.skip();
  }

  stop(): void {
    this._player.stop();
  }

  override async initialize(): Promise<void> {
    // Watch the live game state (scene, clock, weather, combat) and push
    // the refreshed vibe context into the player for similar-track matching.
    this.registerEffectRoot(() => {
      $effect(() => {
        // Touch reactive inputs so the effect re-runs on change.
        void this._context.playerScene;
        void this._context.currentMapId;
        void this._context.gameHour;
        void this._context.rainIntensity;
        void this._context.activeOverlay;
        this._player.setSceneContext(this._context.buildSceneContext());
      });
    });
    await super.initialize();
  }
}

/**
 * Builds a music-player ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getMusicPlayerViewModel` in ./music_player_composition.ts.
 */
export const createMusicPlayerViewModel = (
  options: MusicPlayerViewModelOptions,
): MusicPlayerViewModelInterface => MusicPlayerViewModel.create(options);
