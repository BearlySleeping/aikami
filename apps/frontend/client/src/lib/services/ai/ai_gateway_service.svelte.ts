// apps/frontend/client/src/lib/services/ai/ai_gateway_service.svelte.ts
//
// Client wiring of the unified AI Provider Gateway (C-320). Composes the
// gateway core from @aikami/frontend/ai-gateway with:
// - text adapters (offline = Ollama/local OpenAI-compatible, byok = cloud
//   endpoints with vault keys) — one shared OpenAI-compatible transport;
// - a `service` text adapter over the Firebase `ai` callable (legacy
//   ai_service behavior);
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
  createOpenAiCompatibleTextAdapter,
  createServiceTextAdapter,
  detectImageAvailability,
  detectTextAvailability,
  detectVoiceAvailability,
} from '@aikami/frontend/ai-gateway';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
  firebaseFunctionsService,
} from '@aikami/frontend/services';
import type {
  AIMessageData,
  AiCapability,
  AiDetectionResult,
  AiModeResolution,
} from '@aikami/types';
import { ttsService } from '$lib/services/audio/tts_service.svelte.ts';
import { configService } from '$lib/services/config/config_service.svelte.ts';
import { PROVIDER_MODEL_FETCH } from '$lib/services/config/provider_endpoints';
import { imageGenerationService } from '$lib/services/image/image_generation_service.svelte.ts';
import { aiSettingsService } from '$lib/services/settings/ai_settings.svelte.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Providers served by the `offline` adapter family (localhost, no key). */
const LOCAL_TEXT_PROVIDERS = new Set(['ollama', 'ooba']);

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
      supportsStructuredOutput: () => false,
      getDefaultEndpoint: (provider) => this._getDefaultTextEndpoint(provider),
      onSchemaCacheSize: (size) => {
        (globalThis as Record<string, unknown>).__text_service_compiled_schema_cache_size = size;
      },
      onEvent: (event, data) => this.debug(`textAdapter:${event}`, data),
    });

    // One transport serves both offline (local) and byok (cloud) text modes.
    registry.registerText({ mode: 'offline', adapter: textAdapter });
    registry.registerText({ mode: 'byok', adapter: textAdapter });

    // `service` mode: wraps the existing Firebase callable path so legacy
    // ai_service behavior is preserved. Selection via resolveMode stays
    // guarded (mode_unavailable) until Phase 5 activation.
    registry.registerText({
      mode: 'service',
      adapter: createServiceTextAdapter({
        call: async (data) => {
          // The gateway's generic callable shape narrows to the typed Firebase
          // `ai` payload contract at this boundary.
          const response = await firebaseFunctionsService.call('ai', data as AIMessageData);
          return response as Record<string, unknown>;
        },
      }),
    });

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
            signal,
          }),
        image: ({ signal }) =>
          detectImageAvailability({
            hasConfiguredProvider: () => this._hasConfiguredImageProvider(),
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
    const keys = configService.state.text.apiKeys;
    return keys[provider as keyof typeof keys];
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
   * Whether a cloud text provider is configured. Union of the legacy
   * aiSettingsService shape and C-230 connections saved via Settings →
   * Connections (C-322) — both read live per detection call, never cached.
   */
  private _hasCloudTextConfig(): boolean {
    return this._hasLegacyCloudTextConfig() || this._hasCloudTextConnection();
  }

  /** Legacy aiSettingsService text config (pre-C-230 installs). */
  private _hasLegacyCloudTextConfig(): boolean {
    try {
      const { textProvider } = aiSettingsService;
      return Boolean(textProvider.apiKey || (textProvider.endpoint && textProvider.model));
    } catch {
      return false;
    }
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
      const { connections, text } = configService.state;
      if (!Array.isArray(connections) || connections.length === 0) {
        return false;
      }
      return connections.some((connection) => {
        if (LOCAL_TEXT_PROVIDERS.has(connection.provider)) {
          return false;
        }
        const apiKey = connection.apiKey || text.apiKeys[connection.provider];
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
