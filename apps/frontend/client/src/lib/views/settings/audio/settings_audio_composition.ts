// apps/frontend/client/src/lib/views/settings/audio/settings_audio_composition.ts
//
// Production wiring for the settings-audio ViewModel. This is the only module
// in the feature that imports the `$services` barrel; the ViewModel receives
// its collaborators as typed capabilities.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import {
  audioService,
  musicPlayerService,
  playSceneBgm,
  runtimeConfigService,
  ttsService,
  voiceModelService,
} from '$services';
import {
  createSettingsAudioViewModel,
  type SettingsAudioViewModelInterface,
} from './settings_audio_view_model.svelte';

/**
 * Builds the settings-audio ViewModel wired to the production audio, TTS,
 * voice-model and runtime-config singletons.
 */
export const getSettingsAudioViewModel = (
  options: BaseViewModelOptions,
): SettingsAudioViewModelInterface =>
  createSettingsAudioViewModel({
    ...options,
    audio: audioService,
    musicPlayer: musicPlayerService,
    tts: ttsService,
    voiceModel: voiceModelService,
    runtimeConfig: runtimeConfigService,
    playSceneBgm,
  });
