// apps/frontend/client/src/lib/services/ai/clients/ai/clients/comfyui_client.ts
//
// ComfyUiClient — FrontendAiInterface implementation for ComfyUI.
// C-388: composes the ComfyUiEngine adapter (services/image/engine) so the
// graph construction lives in exactly one place. This file keeps its
// FrontendAiInterface shape but carries no workflow builder or transport.
//
// Contract: C-388 Image Engine Provider Abstraction

import type { TSchema } from 'typebox';

import { ComfyUiEngine } from '$lib/services/image/engine/comfyui_engine.svelte.ts';
import type { ImageGenerationRequest } from '$lib/services/image/engine/types.ts';
import type { FrontendAiInterface } from '../frontend_ai_interface.ts';
import type {
  AiProviderCapabilities,
  ComfyUiClientOptions,
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
 * ComfyUI local provider — connects directly to a local ComfyUI instance
 * through the shared ComfyUiEngine adapter.
 *
 * API: https://github.com/comfyanonymous/ComfyUI/blob/master/server.py
 */
class ComfyUiClient implements FrontendAiInterface {
  readonly name = 'comfyui';
  readonly capabilities: AiProviderCapabilities = {
    dialogue: false,
    contentDescription: false,
    speech: false,
    image: true,
    structured: false,
    requiresBackend: false,
    isLocal: true,
  };

  private readonly _engine: ComfyUiEngine;

  /**
   * @param options - ComfyUI client configuration.
   */
  constructor(options: ComfyUiClientOptions) {
    this._engine = new ComfyUiEngine(options.baseUrl);
  }

  // -----------------------------------------------------------------------
  // Unsupported capabilities
  // -----------------------------------------------------------------------

  async generateDialogue(
    _context: DialogueContext,
    _options?: DialogueOptions,
  ): Promise<DialogueResponse> {
    throw new Error(
      'ComfyUI does not support dialogue generation. Use OllamaClient or a cloud provider.',
    );
  }

  async generateContentDescription(
    _prompt: string,
    _options?: ContentDescriptionOptions,
  ): Promise<string> {
    throw new Error(
      'ComfyUI does not support content description. Use OllamaClient or a cloud provider.',
    );
  }

  async synthesizeSpeech(_text: string, _options?: TtsOptions): Promise<SpeechResult> {
    throw new Error('ComfyUI does not support speech synthesis. Use LocalTtsClient.');
  }

  // -----------------------------------------------------------------------
  // Image — the main capability
  // -----------------------------------------------------------------------

  async generateImage(prompt: string, options?: ImageOptions): Promise<ImageResult> {
    const request: ImageGenerationRequest = {
      positivePrompt: prompt,
      width: options?.width,
      height: options?.height,
      steps: options?.steps,
      cfgScale: options?.cfgScale,
      model: options?.model,
    };

    const result = await this._engine.generate(request);

    return {
      imageUrl: URL.createObjectURL(result.blob),
      width: result.width,
      height: result.height,
      mimeType: result.mimeType,
    };
  }

  // -----------------------------------------------------------------------
  // Unsupported: structured
  // -----------------------------------------------------------------------

  async generateStructured<T>(
    _instruction: string,
    _schema: TSchema,
    _context?: string,
  ): Promise<T> {
    throw new Error(
      'ComfyUI does not support structured data generation. Use OllamaClient or a cloud provider.',
    );
  }

  // -----------------------------------------------------------------------
  // Health Check
  // -----------------------------------------------------------------------

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const start = performance.now();
      const available = await this._engine.healthCheck();
      const latencyMs = Math.round(performance.now() - start);

      return {
        available,
        latencyMs: available ? latencyMs : 0,
        message: available ? 'ComfyUI running' : 'ComfyUI unreachable',
      };
    } catch (err) {
      return {
        available: false,
        latencyMs: 0,
        message: err instanceof Error ? err.message : 'ComfyUI unreachable',
      };
    }
  }
}

export { ComfyUiClient };
