// biome-ignore-all lint/style/useNamingConvention: ComfyUI API uses snake_case field names
// packages/backend/image/src/lib/orchestrator.ts
import { logger } from '$logger';
import { ComfyUIRestClient } from './rest_client.ts';
import type { ComfyUIConfig, ComfyUIPromptNode, GenerationResult } from './types.ts';
import { ComfyUIWorkflowBuilder } from './workflow_builder.ts';
import { ComfyUIWsReceiver } from './ws_receiver.ts';

/** Default timeout for a full generation cycle (REST queue + WS listen). */
const DEFAULT_GENERATION_TIMEOUT_MS = 120_000;

/** Factory type for creating WS receivers — exported for test injection. */
export type WsReceiverFactory = (clientId: string) => ComfyUIWsReceiver;

/** Options for `ImageGenerationOrchestrator.generate()`. */
export type GenerateOptions = {
  workflow: Record<string, ComfyUIPromptNode>;
  positivePrompt: string;
  negativePrompt?: string;
  seed?: number;
  steps?: number;
  cfg?: number;
  width?: number;
  height?: number;
  signal?: AbortSignal;
  generationTimeoutMs?: number;
};

/**
 * Image Generation Orchestrator — ties the Workflow Builder, REST Client,
 * and WebSocket Receiver together into a full generation cycle.
 */
export class ImageGenerationOrchestrator {
  private readonly _config: ComfyUIConfig;
  private readonly _builder: ComfyUIWorkflowBuilder;
  private readonly _restClient: ComfyUIRestClient;
  private readonly _clientId: string;
  private readonly _wsReceiverFactory: WsReceiverFactory;

  constructor(options: { config: ComfyUIConfig; wsReceiverFactory?: WsReceiverFactory }) {
    this._config = options.config;
    this._builder = new ComfyUIWorkflowBuilder();
    this._restClient = new ComfyUIRestClient({ baseUrl: options.config.baseUrl });
    this._clientId = `aikami-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this._wsReceiverFactory =
      options.wsReceiverFactory ??
      ((clientId: string) => new ComfyUIWsReceiver({ baseUrl: options.config.baseUrl, clientId }));
  }

  /**
   * Executes a full image generation cycle.
   */
  async generate(options: GenerateOptions): Promise<GenerationResult> {
    const {
      workflow,
      positivePrompt,
      negativePrompt: _negativePrompt,
      seed = -1,
      steps = 20,
      cfg = 7.0,
      width = 512,
      height = 512,
      signal,
      generationTimeoutMs,
    } = options;

    logger.debug('generate', { positivePromptLength: positivePrompt.length, width, height });

    const timeout =
      generationTimeoutMs ?? this._config.generationTimeoutMs ?? DEFAULT_GENERATION_TIMEOUT_MS;

    let aborted = false;
    const onAbort = () => {
      aborted = true;
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    if (signal?.aborted) {
      await this._forceFreeMemory();
      throw new Error('Generation aborted');
    }

    try {
      // Step 1: Inject SaveImageWebsocket into the workflow
      const modifiedWorkflow = this._builder.injectSaveImageWebsocket(workflow);

      // Update prompt parameters
      for (const node of Object.values(modifiedWorkflow)) {
        if (node.class_type === 'KSampler' || node.class_type === 'KSamplerAdvanced') {
          if (seed !== -1) {
            node.inputs.seed = seed;
          }
          if (steps > 0) {
            node.inputs.steps = steps;
          }
          if (cfg > 0) {
            node.inputs.cfg = cfg;
          }
        }
        if (node.class_type === 'EmptyLatentImage') {
          if (width > 0) {
            node.inputs.width = width;
          }
          if (height > 0) {
            node.inputs.height = height;
          }
        }
      }

      // Step 2: Queue the prompt
      const promptResponse = await this._restClient.queuePrompt({ workflow: modifiedWorkflow });
      const promptId = promptResponse.prompt_id;
      logger.debug('generate: prompt queued', { promptId });

      // Step 3: Connect WS and listen
      const wsReceiver = this._wsReceiverFactory(this._clientId);

      try {
        await wsReceiver.connect();
      } catch (error) {
        logger.error('generate: WebSocket connect failed', { promptId, error });
        await this._forceFreeMemory();
        throw new Error(`WebSocket connection failed: ${String(error)}`);
      }

      let result: GenerationResult;

      try {
        result = await wsReceiver.listenForGeneration({
          promptId,
          signal,
          timeoutMs: timeout,
        });
        result.promptId = promptId;
      } catch (error) {
        wsReceiver.close();
        await this._forceFreeMemory();

        if (aborted) {
          throw new Error('Generation aborted');
        }
        throw error;
      }

      wsReceiver.close();

      // Step 4 (AC2): Immediately free VRAM after completion
      await this._restClient.freeMemory();

      return result;
    } catch (error) {
      if (!aborted) {
        await this._forceFreeMemory();
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private async _forceFreeMemory(): Promise<void> {
    try {
      await this._restClient.freeMemory();
    } catch {
      logger.warn('_forceFreeMemory: eviction call failed (non-fatal)');
    }
  }
}
