// packages/frontend/api-core/src/ai/clients/gemini_client.ts

import type { TSchema } from 'typebox';

import type { GameApiClientInterface } from '../../api/game_api_client_interface.ts';
import type { FrontendAiInterface } from '../frontend_ai_interface.ts';
import type {
  AiProviderCapabilities,
  ContentDescriptionOptions,
  DialogueContext,
  DialogueOptions,
  DialogueResponse,
  HealthCheckResult,
  ImageOptions,
  ImageResult,
  SpeechResult,
  TtsOptions,
} from '../types.ts';

/**
 * Gemini cloud provider — routes all AI requests through the backend proxy.
 *
 * API keys NEVER leave the server. All requests go through a
 * {@link GameApiClientInterface} instance that calls the backend
 * `prompt_ai` / `generate_image` Firebase Functions with `provider: 'gemini'`.
 *
 * Does NOT bundle the `@google/generative-ai` SDK. Zero direct Google AI dependencies.
 */
class GeminiClient implements FrontendAiInterface {
  readonly name = 'gemini';
  readonly capabilities: AiProviderCapabilities = {
    dialogue: true,
    contentDescription: true,
    speech: false,
    image: true,
    structured: true,
    requiresBackend: true,
    isLocal: false,
  };

  private apiClient: GameApiClientInterface;
  private model: string;

  /**
   * @param apiClient - API client for backend communication.
   * @param model - Model identifier. Default: 'gemini-2.0-flash'.
   */
  constructor(apiClient: GameApiClientInterface, model: string = 'gemini-2.0-flash') {
    this.apiClient = apiClient;
    this.model = model;
  }

  async generateDialogue(
    context: DialogueContext,
    options?: DialogueOptions,
  ): Promise<DialogueResponse> {
    const response = await this.apiClient.post<DialogueResponse>('/api/prompt_ai', {
      provider: 'gemini',
      model: options?.model ?? this.model,
      messages: [
        ...(context.systemPrompt
          ? [{ role: 'system' as const, content: context.systemPrompt }]
          : []),
        ...(context.history ?? []).map((msg) => ({
          role: msg.role === 'npc' ? ('assistant' as const) : ('user' as const),
          content: msg.text,
        })),
        { role: 'user' as const, content: context.playerInput },
      ],
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    });

    return response;
  }

  async generateContentDescription(
    prompt: string,
    options?: ContentDescriptionOptions,
  ): Promise<string> {
    const response = await this.apiClient.post<DialogueResponse>('/api/prompt_ai', {
      provider: 'gemini',
      model: options?.model ?? this.model,
      messages: [
        { role: 'system', content: 'You generate concise game content descriptions.' },
        { role: 'user', content: prompt },
      ],
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    });

    return response.text;
  }

  async synthesizeSpeech(_text: string, _options?: TtsOptions): Promise<SpeechResult> {
    throw new Error('GeminiClient does not support speech synthesis. Use LocalTtsClient instead.');
  }

  async generateImage(prompt: string, options?: ImageOptions): Promise<ImageResult> {
    const response = await this.apiClient.post<ImageResult>('/api/generate_image', {
      provider: 'gemini',
      prompt,
      width: options?.width,
      height: options?.height,
    });

    return response;
  }

  async generateStructured<T>(instruction: string, schema: TSchema, context?: string): Promise<T> {
    const fullContext = context ? `${instruction}\n\nContext: ${context}` : instruction;

    const response = await this.apiClient.post<{ data: T }>('/api/prompt_ai', {
      provider: 'gemini',
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `You generate structured JSON matching this schema: ${(schema as Record<string, unknown>).description ?? 'No description provided'}`,
        },
        { role: 'user', content: fullContext },
      ],
      responseFormat: { type: 'json_object' },
    });

    return response.data;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const start = performance.now();
      await this.apiClient.get('/api/health');
      const latencyMs = Math.round(performance.now() - start);

      return { available: true, latencyMs, message: 'Gemini backend reachable' };
    } catch {
      return {
        available: false,
        latencyMs: 0,
        message: 'Backend unreachable or Gemini unavailable',
      };
    }
  }
}

export { GeminiClient };
