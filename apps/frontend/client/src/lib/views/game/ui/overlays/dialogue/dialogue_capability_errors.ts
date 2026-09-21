// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_capability_errors.ts
//
// Pure capability-error classification and copy for the dialogue overlay.
// Extracted from the ViewModel so these rules are unit-testable and the
// ViewModel stays within its grandfathered size budget.

/** An actionable setup failure (no text provider, no voice/TTS, no image provider). */
export type CapabilitySetupError = {
  /** Short headline shown in the error banner. */
  title: string;
  /** Actionable explanation for the player. */
  message: string;
  /** Settings group to deep-link to — always the AI group. */
  group: 'ai';
  /** Settings section to deep-link to: 'story-dialogue' | 'artwork' | 'read-aloud'. */
  section: string;
};

/** One pattern covers every "provider is missing" phrasing the services emit. */
const SETUP_ERROR_PATTERN = /(not configured|no provider|is not set up|not set up)/i;

/** Whether the error message represents cancellation (AC-3). */
export const isAbortErrorMessage = (message: string): boolean => /abort/i.test(message);

/** Classifies a text-generation failure as a "text not set up" error, or null. */
export const classifySetupError = (message: string): CapabilitySetupError | null => {
  if (!SETUP_ERROR_PATTERN.test(message)) {
    return null;
  }
  return {
    title: 'Text AI isn’t set up yet',
    message: 'Connect a text provider in Settings before chatting with NPCs.',
    group: 'ai',
    section: 'story-dialogue',
  };
};

/** Whether an image-generation failure message indicates a missing provider. */
export const isImageSetupError = (message: string): boolean => SETUP_ERROR_PATTERN.test(message);

/** True when the TTS engine is in a "needs setup" state (not merely warming up). */
export const isTtsSetupFailure = (status: string): boolean =>
  status === 'not-downloaded' || status === 'disabled' || status === 'error';

/** Human-readable reason for the current TTS setup failure. */
export const ttsSetupMessage = (status: string): string => {
  switch (status) {
    case 'not-downloaded':
      return 'Download or connect a voice provider in Settings before using read-aloud.';
    case 'disabled':
      return 'Voice is currently disabled. Enable a voice provider in Settings to use read-aloud.';
    case 'error':
      return 'The voice provider failed to start. Check its setup in Settings.';
    default:
      return 'Set up a voice provider in Settings before using read-aloud.';
  }
};

/**
 * Formats the AC-4 actionable error, naming the provider when the gateway
 * routing diagnostic is available.
 */
export const formatTimeoutError = (): string => {
  const routing = (globalThis as Record<string, unknown>).__text_service_resolved_routing as
    | { provider?: string }
    | undefined;
  const provider = routing?.provider;
  return provider
    ? `The ${provider} provider did not respond in time. Showing the NPC's pre-written reply instead.`
    : "The text provider did not respond in time. Showing the NPC's pre-written reply instead.";
};
