// packages/frontend/ai-gateway/src/lib/gateway.ts
//
// Default AiProviderGateway implementation — typed, mode-resolving dispatch
// for the three AI capabilities. Resolution happens exactly once per call
// at this boundary; adapters never re-check providers. Cancellation is
// propagated to every adapter via linked AbortSignals; cancelAll() aborts
// all in-flight calls. Errors surface exclusively as AiGatewayException.
// Contract: C-320

import type { AiCapability, AiDetectionResult, AiMode, AiModeResolution } from '@aikami/types';
import type { AiAdapterRegistry } from './adapter_registry.ts';
import { DETECTION_TIMEOUT_MS } from './detection.ts';
import { createAiGatewayError, toAiGatewayError } from './errors.ts';
import type {
  AiDetector,
  AiImageGenerationOptions,
  AiImageGenerationResult,
  AiModeResolver,
  AiProviderGateway,
  AiTextAdapter,
  AiTextGenerationOptions,
  AiTextGenerationResult,
  AiVoiceGenerationOptions,
  AiVoiceGenerationResult,
} from './gateway_types.ts';

/** Options for constructing the default gateway. */
export type AiProviderGatewayOptions = {
  /** Adapter registry keyed by (capability, mode). */
  registry: AiAdapterRegistry;
  /** Per-capability mode resolver, computed from provided config. */
  resolveMode: AiModeResolver;
  /** Detection functions per capability. */
  detectors?: Partial<Record<AiCapability, AiDetector>>;
  /** Detection budget in ms (default 3000). */
  detectionTimeoutMs?: number;
  /** Log hook — invoked once per dispatch with the resolution. */
  onDispatch?: (resolution: AiModeResolution) => void;
};

/**
 * Creates the default AiProviderGateway.
 */
export const createAiProviderGateway = (options: AiProviderGatewayOptions): AiProviderGateway => {
  const {
    registry,
    resolveMode,
    detectors = {},
    detectionTimeoutMs = DETECTION_TIMEOUT_MS,
    onDispatch,
  } = options;

  const activeControllers = new Set<AbortController>();

  /** Creates a controller linked to the caller's signal and tracks it. */
  const linkSignal = (signal?: AbortSignal): AbortController => {
    const controller = new AbortController();
    if (signal) {
      if (signal.aborted) {
        controller.abort(signal.reason);
      } else {
        signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
      }
    }
    activeControllers.add(controller);
    return controller;
  };

  /** Builds a resolution for an explicit mode override via the registry. */
  const resolveOverride = (options2: {
    capability: AiCapability;
    mode: AiMode;
    provider?: string;
    model?: string;
  }): AiModeResolution => ({
    capability: options2.capability,
    mode: options2.mode,
    provider: options2.provider ?? options2.mode,
    model: options2.model,
  });

  const missingAdapterError = (options2: { capability: AiCapability; mode: AiMode }): Error =>
    createAiGatewayError({
      code: 'mode_unavailable',
      capability: options2.capability,
      mode: options2.mode,
      message: `No ${options2.capability} adapter registered for mode "${options2.mode}"`,
    });

  /**
   * Runs the resolver, normalizing any raw resolver error (e.g. config
   * lookups that throw plain Errors) into AiGatewayException.
   */
  const resolveNormalized = (options2: {
    capability: AiCapability;
    model?: string;
  }): AiModeResolution => {
    try {
      return resolveMode(options2);
    } catch (error) {
      throw toAiGatewayError({ error, capability: options2.capability, mode: 'offline' });
    }
  };

  return {
    resolveMode(capability): AiModeResolution {
      return resolveNormalized({ capability });
    },

    async detect(capability): Promise<AiDetectionResult> {
      const detector = detectors[capability];
      const checkedAt = new Date().toISOString();

      if (!detector) {
        return {
          capability,
          available: false,
          detail: 'No detector registered',
          checkedAt,
        };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), detectionTimeoutMs);
      try {
        return await Promise.race([
          detector({ signal: controller.signal }),
          new Promise<AiDetectionResult>((resolve) =>
            setTimeout(
              () =>
                resolve({
                  capability,
                  available: false,
                  detail: 'Detection timed out',
                  checkedAt,
                }),
              detectionTimeoutMs,
            ),
          ),
        ]);
      } catch (error) {
        return {
          capability,
          available: false,
          detail: `Detection failed: ${error instanceof Error ? error.message : String(error)}`,
          checkedAt,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    },

    async generateText(options2: AiTextGenerationOptions): Promise<AiTextGenerationResult> {
      const { messages, onChunk, schema, schemaName, model, signal, mode, onResolve } = options2;

      // Resolution happens exactly once, here at the gateway boundary.
      let resolution: AiModeResolution;
      let adapter: AiTextAdapter | undefined;
      if (mode) {
        adapter = registry.getText(mode);
        if (!adapter) {
          throw missingAdapterError({ capability: 'text', mode });
        }
        resolution = resolveOverride({
          capability: 'text',
          mode,
          provider: adapter.provider,
          model,
        });
      } else {
        resolution = resolveNormalized({ capability: 'text', model });
        adapter = registry.getText(resolution.mode);
        if (!adapter) {
          throw missingAdapterError({ capability: 'text', mode: resolution.mode });
        }
      }

      onResolve?.(resolution);
      onDispatch?.(resolution);

      const controller = linkSignal(signal);
      try {
        return await adapter.generateText({
          resolution,
          signal: controller.signal,
          messages,
          onChunk,
          schema,
          schemaName,
        });
      } catch (error) {
        throw toAiGatewayError({
          error,
          capability: 'text',
          mode: resolution.mode,
          provider: resolution.provider,
        });
      } finally {
        activeControllers.delete(controller);
      }
    },

    async generateImage(options2: AiImageGenerationOptions): Promise<AiImageGenerationResult> {
      const { prompt, checkpoint, signal, onResolve } = options2;

      const resolution = resolveNormalized({ capability: 'image' });
      const adapter = registry.getImage(resolution.mode);
      if (!adapter) {
        throw missingAdapterError({ capability: 'image', mode: resolution.mode });
      }

      onResolve?.(resolution);
      onDispatch?.(resolution);

      const controller = linkSignal(signal);
      try {
        return await adapter.generateImage({
          resolution,
          signal: controller.signal,
          prompt,
          checkpoint,
        });
      } catch (error) {
        throw toAiGatewayError({
          error,
          capability: 'image',
          mode: resolution.mode,
          provider: resolution.provider,
        });
      } finally {
        activeControllers.delete(controller);
      }
    },

    async generateVoice(options2: AiVoiceGenerationOptions): Promise<AiVoiceGenerationResult> {
      const { text, voiceId, signal, onResolve } = options2;

      const resolution = resolveNormalized({ capability: 'voice' });
      const adapter = registry.getVoice(resolution.mode);
      if (!adapter) {
        throw missingAdapterError({ capability: 'voice', mode: resolution.mode });
      }

      onResolve?.(resolution);
      onDispatch?.(resolution);

      const controller = linkSignal(signal);
      try {
        return await adapter.generateVoice({
          resolution,
          signal: controller.signal,
          text,
          voiceId,
        });
      } catch (error) {
        throw toAiGatewayError({
          error,
          capability: 'voice',
          mode: resolution.mode,
          provider: resolution.provider,
        });
      } finally {
        activeControllers.delete(controller);
      }
    },

    cancelAll(): void {
      for (const controller of activeControllers) {
        controller.abort();
      }
      activeControllers.clear();
    },
  };
};
