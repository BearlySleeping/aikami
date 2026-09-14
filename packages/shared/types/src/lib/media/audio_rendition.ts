// packages/shared/types/src/lib/media/audio_rendition.ts
//
// C-521: audio-rendition types, derived from the TypeBox schemas in
// `@aikami/schemas` (Schema-First law — no hand-written duplicate shapes).
//
// Contract: C-521 Music and SFX generation with audio preparation

import type {
  AudioAnalysisSchema,
  AudioFindingSchema,
  AudioGenerationRefusalSchema,
  AudioLoopBoundsSchema,
  AudioRenditionBundleSchema,
  AudioRenditionSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type AudioAnalysis = Static<typeof AudioAnalysisSchema>;
export type AudioFinding = Static<typeof AudioFindingSchema>;
export type AudioLoopBounds = Static<typeof AudioLoopBoundsSchema>;
export type AudioRendition = Static<typeof AudioRenditionSchema>;
export type AudioRenditionBundle = Static<typeof AudioRenditionBundleSchema>;
export type AudioGenerationRefusal = Static<typeof AudioGenerationRefusalSchema>;

export type {
  AudioCodec,
  AudioContainer,
  AudioFindingCode,
  AudioFindingSeverity,
  AudioGenerationRefusalCode,
  AudioRenditionProfileId,
} from '@aikami/schemas';
