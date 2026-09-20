// packages/shared/types/src/lib/media/audio_cue_binding.ts
//
// C-523: authored pack audio-cue-binding types, derived from the TypeBox
// schemas in `@aikami/schemas` (Schema-First law — no hand-written duplicate
// shapes).
//
// Contract: C-523 Emberwatch asset pilot and offline integration

import type { PackAudioBindingsSchema, PackAudioCueBindingSchema } from '@aikami/schemas';
import type { Static } from 'typebox';

export type PackAudioBindings = Static<typeof PackAudioBindingsSchema>;
export type PackAudioCueBinding = Static<typeof PackAudioCueBindingSchema>;

export type {
  AudioAssetCueBinding,
  AudioAssetSource,
  AudioCueFallback,
  AudioCueResolution,
  AudioCueSource,
  AudioCueSourceKind,
  AudioCueTarget,
  AudioSilenceCueBinding,
  AudioSilenceSource,
  PackAudioBindingIssue,
  PackAudioBindingIssueCode,
} from '@aikami/schemas';

export { isAssetCueBinding } from '@aikami/schemas';
