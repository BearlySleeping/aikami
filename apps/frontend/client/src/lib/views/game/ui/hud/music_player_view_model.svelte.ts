// apps/frontend/client/src/lib/views/game/ui/hud/music_player_view_model.svelte.ts
//
// MusicPlayerViewModel — thin ViewModel over the MusicPlayerService
// singleton powering the optional mini music-player overlay.
//
// Contract: C-150 (audio engine), C-249 (music tags)

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import {
  buildMusicSceneContext,
  musicPlayerService,
} from '$lib/services/audio/music_player_service.svelte';
import { gameEngineService, gameOverlayService, timeService } from '$services';

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
  extends BaseViewModel<BaseViewModelOptions>
  implements MusicPlayerViewModelInterface
{
  get visible(): boolean {
    return musicPlayerService.visible;
  }

  get currentTrackTitle(): string {
    return musicPlayerService.currentTrack?.title ?? 'No music playing';
  }

  get vibeLabel(): string {
    return musicPlayerService.vibeLabel;
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

  get hasActiveTrack(): boolean {
    return musicPlayerService.currentTrack !== null;
  }

  get feedback(): string {
    return musicPlayerService.feedback;
  }

  hide(): void {
    musicPlayerService.setVisible(false);
  }

  async togglePlayPause(): Promise<void> {
    if (musicPlayerService.isPaused) {
      await musicPlayerService.resume();
    } else if (musicPlayerService.isPlaying) {
      musicPlayerService.pause();
    } else {
      // Stopped — resume the vibe-appropriate track.
      await musicPlayerService.skip();
    }
  }

  async skip(): Promise<void> {
    await musicPlayerService.skip();
  }

  stop(): void {
    musicPlayerService.stop();
  }

  override async initialize(): Promise<void> {
    // Watch the live game state (scene, clock, weather, combat) and push
    // the refreshed vibe context into the service for similar-track matching.
    this.registerEffectRoot(() => {
      $effect(() => {
        // Touch reactive inputs so the effect re-runs on change.
        void gameEngineService.playerScene;
        void gameEngineService.currentMapId;
        void timeService.gameHour;
        void timeService.rainIntensity;
        void gameOverlayService.activeOverlay;
        musicPlayerService.setSceneContext(buildMusicSceneContext());
      });
    });
    await super.initialize();
  }
}

export const getMusicPlayerViewModel = (
  options: BaseViewModelOptions,
): MusicPlayerViewModelInterface => MusicPlayerViewModel.create(options);
