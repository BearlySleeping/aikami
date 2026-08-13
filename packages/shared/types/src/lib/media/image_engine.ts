// packages/shared/types/src/lib/media/image_engine.ts
//
// Static types derived from the TypeBox schemas for the persisted
// image-engine preference (C-388).
//
// Contract: C-388 Image Engine Provider Abstraction

import type { ImageEngineIdSchema, ImageEnginePreferenceSchema } from '@aikami/schemas';
import type { Static } from 'typebox';

export type ImageEngineId = Static<typeof ImageEngineIdSchema>;
export type ImageEnginePreference = Static<typeof ImageEnginePreferenceSchema>;
