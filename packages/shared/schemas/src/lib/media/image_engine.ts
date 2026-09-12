// packages/shared/schemas/src/lib/media/image_engine.ts
//
// TypeBox schemas for the persisted image-engine preference (C-388).
// The engine id selects which image backend to talk to (`auto` probes both,
// sd-server first). The preference object is what survives page reloads.
//
// Contract: C-388 Image Engine Provider Abstraction

import { type Static, Type } from 'typebox';
import { CommonGenerationEngineIdSchema } from './generation_engine.ts';

/** Which image backend to talk to. `auto` probes both, sd-server first. */
export const ImageEngineIdSchema = Type.Union([
  Type.Literal('auto', { description: 'Probe both engines, prefer sd-server' }),
  CommonGenerationEngineIdSchema,
]);

export type ImageEngineId = Static<typeof ImageEngineIdSchema>;

/**
 * Persisted image-engine preference. Stored per install so the selected
 * engine (and its checkpoint) survives reloads. The legacy unnamespaced
 * `image.checkpoint` config value is treated as the ComfyUI value on first
 * read and migrated forward — see C-388 Migration.
 */
export const ImageEnginePreferenceSchema = Type.Object({
  /** Selected engine id. */
  engine: ImageEngineIdSchema,
  /** Engine-specific checkpoint/model id. */
  checkpoint: Type.Optional(
    Type.String({ description: 'Persisted checkpoint id for the selected engine' }),
  ),
});

export type ImageEnginePreference = Static<typeof ImageEnginePreferenceSchema>;
