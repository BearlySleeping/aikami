// apps/frontend/client/src/lib/services/ai/ai_gateway_service.svelte.ts
//
// Client wiring of the unified AI Provider Gateway (C-320). Composes the
// gateway core from @aikami/frontend/ai-gateway with:
// - text adapters (offline = Ollama/local OpenAI-compatible, byok = cloud
//   endpoints with vault keys) — one shared OpenAI-compatible transport;
// - image/voice adapters delegating to the existing ComfyUI and Kokoro
//   services unchanged;
// - detection wiring with the same ping semantics as capability_service.
//
// Mode is resolved once per capability at this boundary — call sites never
// re-check providers.
// Contract: C-320

import {
  type AiImageGenerationOptions,
  type AiImageGenerationResult,
  type AiProviderGateway,
  type AiTextGenerationOptions,
  type AiTextGenerationResult,
  type AiVoiceGenerationOptions,
  type AiVoiceGenerationResult,
  createAdapterRegistry,
  createAiProviderGateway,
  createDelegatingImageAdapter,
  createDelegatingVoiceAdapter,
  createLocalTextAdapter,
  createOpenAiCompatibleTextAdapter,
  detectImageAvailability,
  detectTextAvailability,
  detectVoiceAvailability,
} from '@aikami/frontend/ai-gateway';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { AiCapability, AiDetectionResult, AiModeResolution } from '@aikami/types';
import { localTaskPool } from '$lib/services/ai/local_task_pool_service.svelte.ts';
import { configService } from '$lib/services/config/config_service.svelte.ts';
import { resolveImageEngine } from '$lib/services/image/engine/image_engine_factory.svelte.ts';
import {
  aiSettingsService,
  getOllamaRuntimeEndpoints,
  getOpenAiCompatRuntimeModelsUrl,
  imageGenerationService,
  PROVIDER_MODEL_FETCH,
  ttsService,
} from '$services';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Providers served by the `offline` adapter family (localhost, no key). */
const LOCAL_TEXT_PROVIDERS = new Set(['ollama', 'llamacpp', 'ooba']);

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type AiGatewayServiceOptions = BaseFrontendClassOptions;

/** The gateway singleton's public surface — the AiProviderGateway contract. */
export type AiGatewayServiceInterface = BaseFrontendClassInterface & AiProviderGateway;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class AiGatewayService
  extends BaseFrontendClass<AiGatewayServiceOptions>
  implements AiGatewayServiceInterface
{
  private readonly _gateway: AiProviderGateway;

  constructor(options: AiGatewayServiceOptions) {
    super(options);
    this._gateway = this._composeGateway();
  }

  // ── AiProviderGateway surface ─────────────────────────────────────────

  resolveMode(capability: AiCapability): AiModeResolution {
    return this._gateway.resolveMode(capability);
  }

  async detect(capability: AiCapability): Promise<AiDetectionResult> {
    return this._gateway.detect(capability);
  }

  async generateText(options: AiTextGenerationOptions): Promise<AiTextGenerationResult> {
    return this._gateway.generateText(options);
  }

  async generateImage(options: AiImageGenerationOptions): Promise<AiImageGenerationResult> {
    return this._gateway.generateImage(options);
  }

  async generateVoice(options: AiVoiceGenerationOptions): Promise<AiVoiceGenerationResult> {
    return this._gateway.generateVoice(options);
  }

  cancelAll(): void {
    this._gateway.cancelAll();
  }

  // ── Private: composition ──────────────────────────────────────────────

  /** Builds the gateway core with all client adapters and detectors. */
  private _composeGateway(): AiProviderGateway {
    const registry = createAdapterRegistry();

    const textAdapter = createOpenAiCompatibleTextAdapter({
      getApiKey: (provider) => this._getTextApiKey(provider),
      supportsStructuredOutput: (provider) => this._supportsStructuredOutput(provider),
      getDefaultEndpoint: (provider) => this._getDefaultTextEndpoint(provider),
      onSchemaCacheSize: (size) => {
        (globalThis as Record<string, unknown>).__text_service_compiled_schema_cache_size = size;
      },
      onEvent: (event, data) => {
        // Validation failures are warnings — the LLM returned data that didn't match the schema
        if (event === 'validation-failed') {
          this.warn(`textAdapter:${event}`, data);
        } else {
          this.debug(`textAdapter:${event}`, data);
        }
      },
    });

    // Register local text adapter for offline mode (C-427)
    const localTextAdapter = createLocalTextAdapter({
      taskPool: localTaskPool,
      provider: 'local-qwen3',
    });
    registry.registerText({ mode: 'offline', adapter: localTextAdapter });

    // One transport serves both offline (local) and byok (cloud) text modes.
    registry.registerText({ mode: 'byok', adapter: textAdapter });
    registry.registerImage({
      mode: 'offline',
      adapter: createDelegatingImageAdapter({
        generate: (options) => imageGenerationService.generateImage(options),
      }),
    });

    registry.registerVoice({
      mode: 'offline',
      adapter: createDelegatingVoiceAdapter({
        synthesize: async (options) => {
          await ttsService.speak({ text: options.text, voiceId: options.voiceId });
          return undefined;
        },
      }),
    });

    return createAiProviderGateway({
      registry,
      resolveMode: ({ capability, model }) => this._resolveCapability({ capability, model }),
      detectors: {
        text: ({ signal }) =>
          detectTextAvailability({
            hasCloudConfig: () => this._hasCloudTextConfig(),
            // C-389: native fallback probes the runtime-configured engine.
            // (`?.` keeps detection safe when no engine is configured.)
            nativeUrl: getOllamaRuntimeEndpoints()?.url,
            // C-406: the local-stack's bundled default (llama.cpp) speaks
            // OpenAI's /v1/models, not Ollama's /api/tags, even on the same
            // port — tried only when the Ollama-native probe above fails.
            openaiCompatUrl: getOpenAiCompatRuntimeModelsUrl(),
            signal,
          }),
        image: ({ signal }) =>
          detectImageAvailability({
            hasConfiguredProvider: () => this._hasConfiguredImageProvider(),
            // The local stack's bundled image engine is sd-server, not
            // ComfyUI; the factory already probes both against the runtime
            // config and caches the winner, so detection reuses it rather
            // than pinging a ComfyUI-only path the engine does not serve.
            resolveLocalEngine: async () => {
              const engine = await resolveImageEngine();
              return engine ? { id: engine.id } : undefined;
            },
            signal,
          }),
        voice: () =>
          detectVoiceAvailability({
            getEngineStatus: () => ({
              status: ttsService.status,
              serverAvailable: ttsService.isKokoroServerAvailable,
            }),
          }),
      },
      onDispatch: (resolution) =>
        this.info('dispatch', {
          capability: resolution.capability,
          mode: resolution.mode,
          provider: resolution.provider,
          model: resolution.model,
          endpoint: resolution.endpoint,
        }),
    });
  }

  // ── Private: per-capability resolution ────────────────────────────────

  /** Resolves the (mode, provider) for a capability — once per call. */
  private _resolveCapability(options: {
    capability: AiCapability;
    model?: string;
  }): AiModeResolution {
    const { capability, model } = options;

    if (capability === 'text') {
      return this._resolveTextRouting(model);
    }
    if (capability === 'image') {
      return { capability: 'image', mode: 'offline', provider: 'comfyui' };
    }
    return { capability: 'voice', mode: 'offline', provider: 'kokoro' };
  }

  /**
   * Resolves text routing from ConfigService.
   * Priority: explicit model param → configService.getActiveTextProvider().
   * Throws (typed via gateway normalization) if no provider is configured.
   */
  private _resolveTextRouting(explicitModel?: string): AiModeResolution {
    if (explicitModel) {
      const match = configService.state.models.find((m) => m.model === explicitModel);
      if (match) {
        return this._toTextResolution({
          provider: match.provider,
          model: match.model,
          endpoint: match.endpoint || '',
        });
      }
      // Model not found in config — use it verbatim with the active provider/endpoint
      const resolved = configService.getActiveTextProvider();
      return this._toTextResolution({
        provider: resolved.provider,
        model: explicitModel,
        endpoint: resolved.endpoint,
      });
    }

    const resolved = configService.getActiveTextProvider();
    return this._toTextResolution({
      provider: resolved.provider,
      model: resolved.model,
      endpoint: resolved.endpoint,
    });
  }

  /** Classifies a text provider into offline (local) vs byok (cloud). */
  private _toTextResolution(options: {
    provider: string;
    model: string;
    endpoint: string;
  }): AiModeResolution {
    const { provider, model, endpoint } = options;
    return {
      capability: 'text',
      mode: LOCAL_TEXT_PROVIDERS.has(provider) ? 'offline' : 'byok',
      provider,
      model,
      endpoint,
    };
  }

  // ── Private: config accessors ─────────────────────────────────────────

  /** Reads the API key for the given provider from ConfigService. */
  private _getTextApiKey(provider: string): string | undefined {
    // 1. Active text connection's apiKey (C-230 connections, set via capability screen)
    const connections = configService.state.connections ?? [];
    const defaultId = configService.state.defaultConnectionId;
    const conn = defaultId
      ? connections.find((c) => c.id === defaultId)
      : connections.find((c) => (c.capability ?? 'text') === 'text' && c.provider === provider);
    if (conn?.apiKey) {
      return conn.apiKey;
    }

    return undefined;
  }

  /**
   * Well-known chat base endpoint for cloud providers, derived from the
   * provider registry's chatTestUrl (strips the /chat/completions suffix).
   */
  private _getDefaultTextEndpoint(provider: string): string | undefined {
    const config = PROVIDER_MODEL_FETCH[provider];
    if (!config?.chatTestOpenAiCompat || !config.chatTestUrl) {
      return undefined;
    }
    return config.chatTestUrl.replace(/\/chat\/completions$/, '');
  }

  /**
   * Determines if a provider supports native json_schema structured output.
   * Local providers (Ollama, Ooba) do not reliably support response_format,
   * so the adapter must fall back to prompt-based extraction.
   */
  private _supportsStructuredOutput(provider: string): boolean {
    // Offline/BYOK local providers (Ollama, Ooba) do not support response_format
    if (LOCAL_TEXT_PROVIDERS.has(provider)) {
      return false;
    }
    // Cloud providers with OpenAI-compatible endpoints support json_schema
    return true;
  }

  /**
   * Whether a cloud text provider is configured. Checks C-230 connections
   * saved via Settings → Connections (C-322) or the pre-C-230 config
   * shape — both read live per detection call, never cached.
   */
  private _hasCloudTextConfig(): boolean {
    return this._hasCloudTextConnection();
  }

  /**
   * Whether a C-230 connection provides cloud text config. Presence-only
   * check — key material is never validated or decrypted here. Local
   * providers (LOCAL_TEXT_PROVIDERS) never count as cloud-configured so
   * they still exercise the real Ollama ping path. ConfigService read
   * failures degrade to "not configured" — detection must never throw.
   */
  private _hasCloudTextConnection(): boolean {
    try {
      const { connections } = configService.state;
      if (!Array.isArray(connections) || connections.length === 0) {
        return false;
      }
      return connections.some((connection) => {
        if (LOCAL_TEXT_PROVIDERS.has(connection.provider)) {
          return false;
        }
        const apiKey = connection.apiKey;
        return Boolean(apiKey || (connection.baseUrl && connection.model));
      });
    } catch {
      return false;
    }
  }

  /** Whether an image provider is configured via settings. */
  private _hasConfiguredImageProvider(): boolean {
    try {
      const { imageProvider } = aiSettingsService;
      return Boolean(imageProvider.endpoint || imageProvider.model);
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const aiGatewayService: AiGatewayServiceInterface = AiGatewayService.create({
  className: 'AiGatewayService',
});
