// apps/frontend/client/src/lib/views/dev/voice/voice_composition.ts
//
// Production wiring for the dev voice sandbox. This is the only module in the
// feature that imports the `$services` barrel; the ViewModel receives its
// dependencies as typed capabilities, so unit tests never touch the global
// service registry.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { ttsService } from '$services';
import { createVoiceViewModel, type VoiceViewModelInterface } from './voice_view_model.svelte';

/**
 * Builds the voice ViewModel wired to the production TTS singleton.
 */
export const getVoiceViewModel = (options: BaseViewModelOptions): VoiceViewModelInterface =>
  createVoiceViewModel({ ...options, tts: ttsService });
