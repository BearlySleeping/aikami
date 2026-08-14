// packages/shared/types/src/lib/runtime/runtime_engine_config.ts
//
// Derived runtime engine config types (C-389). The TypeBox schema in
// `@aikami/schemas` is the single source of truth; these types are inferred
// via `Static<>` so runtime validation and TypeScript stay in lockstep.

import type {
  ImageEngineSchema,
  RuntimeEngineConfigSchema,
  RuntimeImageConfigSchema,
  RuntimeModelsConfigSchema,
  RuntimeTextConfigSchema,
  RuntimeVoiceConfigSchema,
  RuntimeVoiceSttConfigSchema,
  RuntimeVoiceTtsConfigSchema,
  TtsModeSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type RuntimeEngineConfig = Static<typeof RuntimeEngineConfigSchema>;
export type RuntimeTextConfig = Static<typeof RuntimeTextConfigSchema>;
export type RuntimeImageConfig = Static<typeof RuntimeImageConfigSchema>;
export type RuntimeVoiceConfig = Static<typeof RuntimeVoiceConfigSchema>;
export type RuntimeVoiceTtsConfig = Static<typeof RuntimeVoiceTtsConfigSchema>;
export type RuntimeVoiceSttConfig = Static<typeof RuntimeVoiceSttConfigSchema>;
export type RuntimeModelsConfig = Static<typeof RuntimeModelsConfigSchema>;
export type TtsMode = Static<typeof TtsModeSchema>;
export type ImageEngine = Static<typeof ImageEngineSchema>;
