// apps/frontend/client/src/lib/data/connection_defaults.ts
//
// Default values for image and voice connection options.
// Moved from types/connection.ts — types/ should never contain data.
//
// NOTE: Imports types directly from the source file to avoid
// circular deps with types/index.ts which re-exports from here.

import type { ImageConnectionOptions, VoiceConnectionOptions } from '$lib/types/connection';

/** Default image generation connection options. */
export const DEFAULT_IMAGE_OPTIONS = {
  checkpoint: '',
  width: 1024,
  height: 1024,
  steps: 30,
  cfg: 7,
} as const satisfies ImageConnectionOptions;

/** Default voice/TTS connection options. */
export const DEFAULT_VOICE_OPTIONS = {
  voiceId: 'af_heart',
  speed: 1,
  pitch: 0,
} as const satisfies VoiceConnectionOptions;
