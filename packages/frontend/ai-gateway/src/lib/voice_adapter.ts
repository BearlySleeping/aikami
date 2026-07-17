// packages/frontend/ai-gateway/src/lib/voice_adapter.ts
//
// Delegating voice adapter — wraps the existing Kokoro TTS path
// (tts_service) unchanged, including its internal WebGPU-worker vs REST
// engine selection. The gateway never re-implements engine choice.
// Contract: C-320 AC-3

import { createAiGatewayError, toAiGatewayError } from './errors.ts';
import type { AiVoiceAdapter, AiVoiceGenerationResult } from './gateway_types.ts';
import { raceWithAbort } from './image_adapter.ts';

/**
 * Creates a voice adapter that delegates to an existing synthesizer.
 * The current Kokoro delegation plays audio through the client's audio
 * pipeline and returns no raw buffer — `audio` is therefore optional.
 */
export const createDelegatingVoiceAdapter = (options: {
  /** Existing synthesis entry point (e.g. ttsService.speak). */
  synthesize: (options: {
    text: string;
    voiceId?: string;
  }) => Promise<{ audio?: ArrayBuffer | ReadableStream<Uint8Array> } | undefined>;
  /** Provider label for resolutions/errors. Defaults to 'kokoro'. */
  provider?: string;
}): AiVoiceAdapter => {
  const { synthesize, provider = 'kokoro' } = options;

  return {
    provider,
    async generateVoice(request): Promise<AiVoiceGenerationResult> {
      const { resolution, signal, text, voiceId } = request;

      const cancelledError = (): Error =>
        createAiGatewayError({
          code: 'cancelled',
          capability: 'voice',
          mode: resolution.mode,
          provider: resolution.provider,
          message: 'Aborted',
        });

      if (signal.aborted) {
        throw cancelledError();
      }

      try {
        const result = await raceWithAbort({
          promise: Promise.resolve(synthesize({ text, voiceId })),
          signal,
          onAbort: cancelledError,
        });
        return { audio: result?.audio };
      } catch (error) {
        throw toAiGatewayError({
          error,
          capability: 'voice',
          mode: resolution.mode,
          provider: resolution.provider,
        });
      }
    },
  };
};
