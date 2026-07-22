// apps/frontend/client/src/lib/data/provider_constants.ts
//
// Client-local constants for AI provider configuration.
// Moved from types/provider_config.ts — types/ should never contain data.

/** Available instruct template presets. */
export const INSTRUCT_TEMPLATES = [
  'chatml',
  'alpaca',
  'vicuna',
  'llama3',
  'mistral',
  'deepseek',
  'custom',
] as const;

export type InstructTemplate = (typeof INSTRUCT_TEMPLATES)[number];
