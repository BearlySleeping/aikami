// packages/backend/ai/src/lib/factory.ts
import type { AiServiceInterface } from './ai-service-interface.ts';
import { GeminiService } from './gemini-service.ts';
import { OpenAiService } from './openai-service.ts';
import type { CreateAiServiceOptions } from './types.ts';

/**
 * Create an AI service instance based on the provider type.
 *
 * The provider type determines which concrete implementation is instantiated.
 * API keys are read from the options or the environment:
 * - `openai` → `OPENAI_API_KEY` env var or `apiKey` option
 * - `gemini` → `GEMINI_API_KEY` env var or `apiKey` option
 *
 * @param options — Provider type and optional API key, model, debug flag.
 * @returns An {@link AiServiceInterface} instance ready for use.
 *
 * @example
 * ```typescript
 * // Uses GEMINI_API_KEY from environment
 * const service = createAiService({ provider: 'gemini' });
 *
 * // Uses explicit API key
 * const service = createAiService({ provider: 'openai', apiKey: 'sk-...' });
 * ```
 */
export const createAiService = (options: CreateAiServiceOptions): AiServiceInterface => {
  const { provider, apiKey, model, debug } = options;

  switch (provider) {
    case 'openai':
      return new OpenAiService({ name: 'OpenAI', apiKey, model, debug });

    case 'gemini':
      return new GeminiService({ name: 'Gemini', apiKey, model, debug });
  }
};
