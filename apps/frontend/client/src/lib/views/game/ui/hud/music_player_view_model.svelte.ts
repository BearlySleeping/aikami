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
  /** The restored BGM intent, or undefined when the player never chose. */
  readonly intentState: 'playing' | 'paused' | 'stopped' | undefined;
  readonly intentTrackTitle: string | undefined;
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

  /**
   * Why the player is hearing nothing, when something was asked for last time.
   *
   * `undefined` when nothing is playing and nothing was asked for — the normal
   * silent case needs no explanation.
   */
  readonly silentBecause: string | undefined;

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

/**
 * Why the player hears nothing, per stored intent.
 *
 * A lookup rather than a branch ladder: the set of reasons is closed, and a
 * table keeps the sentences next to each other so they stay consistent.
 */
const SILENT_REASONS: Readonly<
  Record<
    NonNullable<MusicPlayerCapabilities['intentState']>,
    (title: string | undefined) => string | undefined
  >
> = {
  playing: (title) =>
    title ? `Was playing ${title} — press play to start again` : 'Press play to start',
  paused: (title) => (title ? `Paused — press play for ${title}` : 'Paused'),
  stopped: () => 'Music stopped',
};

/**
 * Why the player is hearing nothing right now, if that is worth saying.
 *
 * `undefined` covers both "something is playing" and "the player never chose",
 * and the two are deliberately the same answer: with no recorded opinion,
 * silence is not a decision to explain.
 */
const silentReasonFor = (player: MusicPlayerCapabilities): string | undefined => {
  if (player.isPlaying) {
    return undefined;
  }
  if (player.isPaused) {
    return 'Paused';
  }
  const state = player.intentState;
  return state === undefined ? undefined : SILENT_REASONS[state](player.intentTrackTitle);
};

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

  get intentState(): 'playing' | 'paused' | 'stopped' | undefined {
    return this._player.intentState;
  }

  get intentTrackTitle(): string | undefined {
    return this._player.intentTrackTitle;
  }

  /**
   * Explains an unexpected silence.
   *
   * A reload never resumes audio on its own, so after visiting a page where
   * music was on, the player finds it silent with no way to tell whether the
   * game broke or simply will not start by itself. Saying so is the difference
   * between a decision and a bug report.
   */
  get silentBecause(): string | undefined {
    return silentReasonFor(this._player);
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
