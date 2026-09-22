// apps/frontend/client/src/lib/views/game/ui/hud/music_player_composition.ts
//
// Production wiring for the music-player mini overlay. This is the only module
// in the feature that imports the `$services` singletons; the ViewModel
// receives them as typed capabilities.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import type { HudWidgetId } from '@aikami/types';
import { isHudWidgetPolicyVisible } from '$lib/utils/hud/hud_layout_state.ts';
import { buildMusicSceneContext } from '$lib/utils/music_utils';
import { gameEngineService, gameOverlayService, musicPlayerService, timeService } from '$services';
import { configuredHudPreferenceService } from '$views/hud_preference_composition.ts';
import {
  createMusicPlayerViewModel,
  type MusicPlayerViewModelInterface,
} from './music_player_view_model.svelte';

/** The registry id of the optional music-player widget. */
const MUSIC_PLAYER_WIDGET_ID: HudWidgetId = 'music-player';

/**
 * Builds the music-player ViewModel wired to the production audio, engine,
 * time, and overlay singletons.
 *
 * 🔴 The HUD resolver owns whether this widget is shown, not the audio service.
 * C-528 Directive 11 makes the HUD preference authority the single visibility
 * owner; the audio service keeps playback (track, pause, skip, stop). The
 * overlay is only mounted when the resolver placed the widget, and this adapter
 * keeps the widget's in-overlay Hide control writing to the same authority.
 */
export const getMusicPlayerViewModel = (
  options: BaseViewModelOptions,
): MusicPlayerViewModelInterface =>
  createMusicPlayerViewModel({
    ...options,
    player: {
      get visible(): boolean {
        return isHudWidgetPolicyVisible(
          configuredHudPreferenceService.preferences,
          MUSIC_PLAYER_WIDGET_ID,
        );
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
      setVisible: (visible) => {
        configuredHudPreferenceService.applyNow({
          kind: 'set-visibility',
          widgetId: MUSIC_PLAYER_WIDGET_ID,
          visibility: visible ? 'always' : 'hidden',
        });
      },
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
