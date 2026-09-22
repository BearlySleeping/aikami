// apps/frontend/client/src/lib/views/settings/audio/settings_audio_composition.ts
//
// Production wiring for the settings-audio ViewModel. This is the only module
// in the feature that imports the `$services` barrel; the ViewModel receives
// its collaborators as typed capabilities.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import type { HudWidgetId } from '@aikami/types';
import { isHudWidgetPolicyVisible } from '$lib/utils/hud/hud_layout_state.ts';
import {
  audioService,
  playSceneBgm,
  runtimeConfigService,
  ttsService,
  voiceModelService,
} from '$services';
import { configuredHudPreferenceService } from '$views/hud_preference_composition.ts';
import {
  createSettingsAudioViewModel,
  type SettingsAudioViewModelInterface,
} from './settings_audio_view_model.svelte';

/** The registry id of the optional music-player widget. */
const MUSIC_PLAYER_WIDGET_ID: HudWidgetId = 'music-player';

/**
 * Builds the settings-audio ViewModel wired to the production audio, TTS,
 * voice-model and runtime-config singletons.
 *
 * The legacy "music player" switch is an ADAPTER over the HUD preference
 * authority (C-528 Directive 11): it reads and writes the `music-player`
 * widget's visibility, so the Audio tab and the HUD editor can never disagree.
 */
export const getSettingsAudioViewModel = (
  options: BaseViewModelOptions,
): SettingsAudioViewModelInterface =>
  createSettingsAudioViewModel({
    ...options,
    audio: audioService,
    musicPlayer: {
      get visible(): boolean {
        return isHudWidgetPolicyVisible(
          configuredHudPreferenceService.preferences,
          MUSIC_PLAYER_WIDGET_ID,
        );
      },
      toggleVisible(): void {
        const visible = isHudWidgetPolicyVisible(
          configuredHudPreferenceService.preferences,
          MUSIC_PLAYER_WIDGET_ID,
        );
        configuredHudPreferenceService.applyNow({
          kind: 'set-visibility',
          widgetId: MUSIC_PLAYER_WIDGET_ID,
          visibility: visible ? 'hidden' : 'always',
        });
      },
    },
    tts: ttsService,
    voiceModel: voiceModelService,
    runtimeConfig: runtimeConfigService,
    playSceneBgm,
  });
