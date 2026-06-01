/** biome-ignore-all lint/style/useNamingConvention: ComfyUI API uses snake_case fields */
// packages/frontend/api-core/src/ai/clients/comfyui_client.ts

import type { TSchema } from 'typebox';

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
 * ComfyUI local provider — connects directly to a local ComfyUI instance.
 *
 * Uses plain `fetch()` against `http://localhost:8188`. The ComfyUI
 * workflow is asynchronous: POST to `/prompt` returns a `prompt_id`,
 * then you poll `/history/{prompt_id}` until the result is ready.
 *
 * Requires a pre-configured workflow JSON.
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

  private baseUrl: string;
  private timeoutMs: number;
  private outputFormat: string;

  /**
   * @param options - ComfyUI client configuration.
   */
  constructor(options: ComfyUiClientOptions) {
    if (!options.workflowId) {
      throw new Error(
        'ComfyUiClient requires a workflowId. Configure a pre-defined workflow in ComfyUI first.',
      );
    }

    this.baseUrl = (options.baseUrl ?? 'http://localhost:8188').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.outputFormat = options.outputFormat ?? 'png';
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
    // The prompt is injected into the workflow's text node
    const workflow = {
      prompt,
      width: options?.width ?? 512,
      height: options?.height ?? 512,
      steps: options?.steps ?? 20,
      cfg: options?.cfgScale ?? 7.0,
    };

    // 1. Queue the prompt
    const queueResponse = await this.post<ComfyUiQueueResponse>('/prompt', {
      client_id: `game-${Date.now()}`,
      prompt: this.buildWorkflow(workflow),
    });

    const promptId = queueResponse.prompt_id;

    // 2. Poll for completion
    const result = await this.pollForResult(promptId);

    // 3. Get the output image URL
    const imageUrl = `${this.baseUrl}/view?filename=${result.filename}&subfolder=${result.subfolder ?? ''}&type=output`;

    return {
      imageUrl,
      width: options?.width ?? 512,
      height: options?.height ?? 512,
      mimeType: `image/${this.outputFormat}`,
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
      await this.get<Record<string, unknown>>('/');
      const latencyMs = Math.round(performance.now() - start);

      return { available: true, latencyMs, message: 'ComfyUI running' };
    } catch (err) {
      return {
        available: false,
        latencyMs: 0,
        message: err instanceof Error ? err.message : 'ComfyUI unreachable',
      };
    }
  }

  // -----------------------------------------------------------------------
  // Internal: Workflow Building
  // -----------------------------------------------------------------------

  /**
   * Builds a ComfyUI workflow JSON from the prompt parameters.
   *
   * This is a simplified workflow that uses the built-in ComfyUI nodes.
   * For production use, load the actual workflow from disk and inject
   * the prompt into the appropriate text node.
   */
  private buildWorkflow(params: {
    prompt: string;
    width: number;
    height: number;
    steps: number;
    cfg: number;
  }): Record<string, unknown> {
    // Load pre-configured workflow from this.workflowId
    // For now, build a minimal embedded workflow
    return {
      '3': {
        class_type: 'KSampler',
        inputs: {
          seed: Math.floor(Math.random() * 2 ** 32),
          steps: params.steps,
          cfg: params.cfg,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 1,
          model: ['4', 0],
          positive: ['6', 0],
          negative: ['7', 0],
          latent_image: ['5', 0],
        },
      },
      '4': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' },
      },
      '5': {
        class_type: 'EmptyLatentImage',
        inputs: { width: params.width, height: params.height, batch_size: 1 },
      },
      '6': {
        class_type: 'CLIPTextEncode',
        inputs: { text: params.prompt, clip: ['4', 1] },
      },
      '7': {
        class_type: 'CLIPTextEncode',
        inputs: { text: '', clip: ['4', 1] },
      },
      '8': {
        class_type: 'VAEDecode',
        inputs: { samples: ['3', 0], vae: ['4', 2] },
      },
      '9': {
        class_type: 'SaveImage',
        inputs: { filename_prefix: 'game-gen', images: ['8', 0] },
      },
    };
  }

  // -----------------------------------------------------------------------
  // Internal: Poll for Result
  // -----------------------------------------------------------------------

  /**
   * Polls ComfyUI's `/history/{promptId}` endpoint until the image is ready.
   */
  private async pollForResult(
    promptId: string,
  ): Promise<{ filename: string; subfolder: string | null }> {
    const pollInterval = 1000;
    const maxAttempts = Math.ceil(this.timeoutMs / pollInterval);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await sleep(pollInterval);

      const history = await this.get<ComfyUiHistoryResponse>(`/history/${promptId}`);
      const outputs = history[promptId]?.outputs;

      if (outputs) {
        // Find the SaveImage node output
        for (const nodeOutput of Object.values(outputs)) {
          if (nodeOutput.images && nodeOutput.images.length > 0) {
            const image = nodeOutput.images[0];

            return { filename: image.filename, subfolder: image.subfolder ?? null };
          }
        }
      }
    }

    throw new Error('ComfyUI image generation timed out');
  }

  // -----------------------------------------------------------------------
  // HTTP Helpers
  // -----------------------------------------------------------------------

  private async post<TResponse>(path: string, body: unknown): Promise<TResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text().catch(() => '');

        throw new Error(`ComfyUI API error (${response.status}): ${text}`);
      }

      return response.json() as Promise<TResponse>;
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('ComfyUI request timed out');
      }

      throw err;
    }
  }

  private async get<TResponse>(path: string): Promise<TResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`ComfyUI error (${response.status})`);
      }

      return response.json() as Promise<TResponse>;
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('ComfyUI request timed out');
      }

      throw err;
    }
  }
}

export { ComfyUiClient };

// ---------------------------------------------------------------------------
// ComfyUI API types (internal)
// ---------------------------------------------------------------------------

type ComfyUiQueueResponse = {
  prompt_id: string;
  number: number;
  node_errors: Record<string, unknown>;
};

type ComfyUiHistoryResponse = Record<
  string,
  {
    prompt: unknown;
    outputs: Record<
      string,
      { images: Array<{ filename: string; subfolder: string | null; type: string }> }
    >;
    status: { completed: boolean; messages: Array<[string, unknown]> };
  }
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
