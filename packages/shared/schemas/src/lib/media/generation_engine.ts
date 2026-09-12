// packages/shared/schemas/src/lib/media/generation_engine.ts

import { type Static, Type } from 'typebox';

/** Engine ids shared by image preferences and modality-generic generation. */
export const CommonGenerationEngineIdSchema = Type.Union([
  Type.Literal('sdcpp', { description: 'sd-server (stable-diffusion.cpp)' }),
  Type.Literal('comfyui', { description: 'ComfyUI HTTP API' }),
]);

/** Engine id accepted by both the image and modality-generic schemas. */
export type CommonGenerationEngineId = Static<typeof CommonGenerationEngineIdSchema>;
