// apps/frontend/client/src/lib/views/game/ui/hud/music_player_composition.ts
//
// Production wiring for the music-player mini overlay. This is the only module
// in the feature that imports the `$services` singletons; the ViewModel
// receives them as typed capabilities.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { buildMusicSceneContext } from '$lib/utils/music_utils';
import { gameEngineService, gameOverlayService, musicPlayerService, timeService } from '$services';
import {
  createMusicPlayerViewModel,
  type MusicPlayerViewModelInterface,
} from './music_player_view_model.svelte';

/**
 * Builds the music-player ViewModel wired to the production audio, engine,
 * time, and overlay singletons. Reactive state is exposed through getters so
 * the ViewModel's effect tracks the live services.
 */
export const getMusicPlayerViewModel = (
  options: BaseViewModelOptions,
): MusicPlayerViewModelInterface =>
  createMusicPlayerViewModel({
    ...options,
    player: {
      get visible(): boolean {
        return musicPlayerService.visible;
      },
      get currentTrack() {
        return musicPlayerService.currentTrack;
      },
      get vibeLabel(): string {
        return musicPlayerService.vibeLabel;
      },
      get isPlaying(): boolean {
        return musicPlayerService.isPlaying;
      },
      get isPaused(): boolean {
        return musicPlayerService.isPaused;
      },
      get hasSimilarTracks(): boolean {
        return musicPlayerService.hasSimilarTracks;
      },
      get feedback(): string {
        return musicPlayerService.feedback;
      },
      setVisible: (v) => musicPlayerService.setVisible(v),
      resume: () => musicPlayerService.resume(),
      pause: () => musicPlayerService.pause(),
      skip: () => musicPlayerService.skip(),
      stop: () => musicPlayerService.stop(),
      setSceneContext: (ctx) => musicPlayerService.setSceneContext(ctx),
    },
    context: {
      get playerScene(): string {
        return gameEngineService.playerScene;
      },
      get currentMapId(): string {
        return gameEngineService.currentMapId;
      },
      get gameHour(): number {
        return timeService.gameHour;
      },
      get rainIntensity(): number {
        return timeService.rainIntensity;
      },
      get activeOverlay() {
        return gameOverlayService.activeOverlay;
      },
      buildSceneContext: () => buildMusicSceneContext(),
    },
  });
