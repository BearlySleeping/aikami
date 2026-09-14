// apps/frontend/client/src/lib/services/assets/audio_generation_flag.ts
//
// `PUBLIC_AUDIO_GENERATION` — the C-521 kill switch for NEW audio generation.
//
// 🔴 Scope is deliberately narrow (C-521 AC-6): this flag disables the
// generation *call*, and nothing else. The audio player, the installed
// catalog, the resolvers and already-accepted assets keep working, because
// "a feature flag disables new generation independently of playback".
//
// Kill-switch semantics match `asset_generation_flag.ts`: on by default,
// disabled only by an explicit falsy value.
//
// Contract: C-521 Music and SFX generation with audio preparation

import { PUBLIC_AUDIO_GENERATION } from '$app/env/public';

/** Values that switch new audio generation off. */
const DISABLED_VALUES = new Set(['false', '0', 'off', 'no', '']);

/**
 * Whether new audio generation is enabled.
 *
 * @returns True unless `PUBLIC_AUDIO_GENERATION` is explicitly falsy.
 */
export const isAudioGenerationEnabled = (): boolean => {
  const raw = PUBLIC_AUDIO_GENERATION;
  if (raw === undefined) {
    return true;
  }
  return !DISABLED_VALUES.has(raw.trim().toLowerCase());
};
