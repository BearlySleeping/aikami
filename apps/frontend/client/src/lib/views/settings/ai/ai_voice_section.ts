// apps/frontend/client/src/lib/views/settings/ai/ai_voice_section.ts
//
// Pure voice-section helpers for AI settings (AC-6): preview state, model
// download labels, the preview line, and the Kokoro "test connection" probe.
// No state, no services — the ViewModel owns the reactive fields and passes
// its live reads/callbacks in.

import type { ConnectionTestResult, TtsStatus, VoiceModelState } from '$types';

/**
 * State of a voice preview (AC-6). `synthesizing` covers the request/worker
 * round trip; `playing` only holds while the TTS engine is actually playing —
 * a resolved synthesis promise is not audible success.
 */
export type VoicePreviewState =
  | { status: 'idle' }
  | { status: 'synthesizing' }
  | { status: 'playing' }
  | { status: 'error'; error: string };

/** Used for the voice preview when no campaign is active (AC-6, Edge Cases). */
export const VOICE_PREVIEW_FALLBACK_LINE =
  'The tavern door creaks open as a gust of wind sweeps through the room.';

/** 0–100 voice-model download progress. */
export const voiceModelProgress = (state: VoiceModelState): number => {
  if (state.status === 'downloading') {
    return Math.round((state.receivedBytes / Math.max(1, state.totalBytes)) * 100);
  }
  if (state.status === 'verifying') {
    return 100;
  }
  return 0;
};

/** Human-readable voice-model download size (e.g. "88.6 MB"). */
export const voiceModelSizeLabel = (bytes: number): string =>
  `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Accessible label for a voice-archetype input. */
export const voiceIdInputLabelFor = (archetypeLabel: string): string =>
  `Voice ID for ${archetypeLabel}`;

/** The line spoken by a voice preview, using the active campaign name when present. */
export const voicePreviewLine = (activeCampaignName: string | undefined): string =>
  activeCampaignName ? `Welcome back to ${activeCampaignName}.` : VOICE_PREVIEW_FALLBACK_LINE;

/**
 * Kokoro is a bundled local binary, not an HTTP endpoint — "test connection"
 * means the voice model is downloaded and the TTS runtime can start. Reads the
 * live TTS status through getters so a retry's result is observed.
 */
export const probeKokoroConnection = async (options: {
  modelState: VoiceModelState;
  getTtsStatus: () => TtsStatus;
  getRuntimeError: () => string | null;
  retryRuntime: () => Promise<void>;
}): Promise<ConnectionTestResult> => {
  const startMs = performance.now();
  const elapsed = (): number => Math.round(performance.now() - startMs);
  const model = options.modelState;

  if (model.status === 'error') {
    return {
      ok: false,
      latencyMs: elapsed(),
      error: model.message || 'Voice model download failed',
    };
  }
  if (model.status !== 'ready') {
    return {
      ok: false,
      latencyMs: elapsed(),
      error: 'Voice model not downloaded',
    };
  }

  try {
    if (options.getTtsStatus() !== 'ready') {
      await options.retryRuntime();
    }
    if (options.getTtsStatus() === 'ready') {
      return { ok: true, latencyMs: elapsed() };
    }
    return {
      ok: false,
      latencyMs: elapsed(),
      error: options.getRuntimeError() ?? 'Voice engine failed to start',
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: elapsed(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
