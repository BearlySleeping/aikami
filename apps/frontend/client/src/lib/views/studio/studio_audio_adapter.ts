// apps/frontend/client/src/lib/views/studio/studio_audio_adapter.ts
//
// C-521 AC-1/AC-5 — the Studio's audio engine adapter.
//
// 🔴 What this adapter deliberately does NOT do: dial ACE-Step and read back a
// server-side path. v1.5 reports the audio as a path on the *engine's*
// filesystem, and C-521 is explicit that this must be "translated through the
// runner's owned artifact IDs" rather than exposed to a client. That
// translation is the Hub/runner front door, which C-522 owns and which is still
// a draft. Until it lands there is no browser-reachable audio artifact endpoint,
// so the adapter registers, probes honestly, and states the exact reason it is
// unavailable instead of fabricating a path fetch.
//
// Consequence, recorded rather than hidden: while C-522 is unshipped, audio
// recipes resolve as *unavailable with a reason* in the Studio, and the
// generation production path for this contract is the tooling CLI
// (`bun run --cwd apps/backend/image generate:batch`) plus the host finisher.
//
// Contract: C-521 Music and SFX generation with audio preparation

import { logger } from '$logger';
import { runtimeConfigService } from '$services';
import type { StudioEngineCapability } from './studio_generation_runner.ts';

/** The stated reason audio generation is unavailable to the browser. */
export const AUDIO_RUNNER_FRONT_DOOR_REASON =
  'Audio generation runs on the local asset runner, and its browser-facing front door (C-522) is not shipped yet. Accepted audio still plays; nothing about playback, saves or the catalog depends on the runner.';

/**
 * Probes for a reachable audio runner front door.
 *
 * Returns `false` today on every host: the front door does not exist, so there
 * is nothing to probe that would not be a fabricated endpoint. The probe is
 * kept as a real function so the day C-522 lands, this becomes a health call
 * rather than a rewrite.
 */
export const detectAudioRunner = async (): Promise<boolean> => {
  try {
    await runtimeConfigService.loadConfig();
  } catch (error) {
    logger.warn('studio-audio-adapter:config-load-failed', error);
    return false;
  }
  return false;
};

/**
 * Builds the audio adapter for the studio's modality registry.
 *
 * `generate` can never be reached while `isAvailable()` is false — the runner
 * only dispatches after availability resolved true — so it throws rather than
 * returning placeholder bytes. Fabricating a candidate would put an asset in
 * the registry that no engine produced.
 */
export const createStudioAudioAdapter = (): StudioEngineCapability => ({
  modality: 'audio',
  unavailableReason: AUDIO_RUNNER_FRONT_DOOR_REASON,
  isAvailable: detectAudioRunner,
  generate: async () => {
    throw new Error(AUDIO_RUNNER_FRONT_DOOR_REASON);
  },
  cancel: () => {
    // Nothing to cancel: no audio generation request is ever dispatched.
  },
});
