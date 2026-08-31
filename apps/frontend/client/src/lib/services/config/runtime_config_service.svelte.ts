// apps/frontend/client/src/lib/services/config/runtime_config_service.svelte.ts
//
// Runtime engine configuration loader (C-389). Replaces the build-time
// `PUBLIC_*` endpoint baking: engine URLs resolve at boot from a fetched
// `config.json` document so one SPA artifact works across every stack
// topology (served dist/, container, Tauri desktop) without a rebuild.
//
// Precedence chain, highest first:
//   1. localStorage override (developer escape hatch — dev builds only)
//   2. Tauri config file (app config directory, written by first run)
//   3. `GET ./config.json` relative to the app origin
//   4. Compile-time `PUBLIC_*` env defaults (dev server only — production
//      builds compile these to undefined, so no URL literal is embedded)
//   5. Unset — engine URLs resolve to undefined; engine-dependent features
//      report unavailable.
//
// Missing or malformed documents fall back down the chain, log exactly one
// warning per boot, and never crash.
//
// Contract: C-389 AC-1, AC-2, AC-3

import { isDevelopmentModePublic, publicEnv } from '@aikami/frontend/configs';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { RuntimeEngineConfigSchema, schemaCheck } from '@aikami/schemas';
import type { RuntimeEngineConfig, TtsMode } from '@aikami/types';

/** Where the resolved config came from — logged once at info. */
type RuntimeConfigSource = 'localStorage' | 'tauri-file' | 'http' | 'defaults' | 'unset';

export type RuntimeConfigServiceOptions = BaseFrontendClassOptions;

export type RuntimeConfigServiceInterface = BaseFrontendClassInterface & {
  /** Resolved engine config (all fields optional; missing = unset). */
  readonly engineConfig: RuntimeEngineConfig;

  /** Where the resolved config came from. */
  readonly configSource: RuntimeConfigSource;

  /** True once the config has been resolved at boot. */
  readonly isLoaded: boolean;

  /** Resolves the config once (idempotent) and caches the result. */
  loadConfig(): Promise<RuntimeEngineConfig>;

  /** Base URL of the text engine, or undefined when unset. */
  getTextUrl(): string | undefined;
  /** Base URL of the image engine, or undefined when unset. */
  getImageUrl(): string | undefined;
  /** TTS mode ('browser' | 'server' | 'disabled'). */
  getVoiceTtsMode(): TtsMode;
  /** Server-mode TTS endpoint, or undefined when unset. */
  getVoiceTtsUrl(): string | undefined;
  /** STT endpoint (reserved for C-359), or undefined when unset. */
  getSttUrl(): string | undefined;
  /** Base origin for one-time model asset downloads, or undefined. */
  getModelsOrigin(): string | undefined;
};

const CONFIG_PATH = './config.json';
const LOCAL_STORAGE_KEY = 'aikami.runtime_engine_config';
const TAURI_INTERNALS_KEY = '__TAURI_INTERNALS__';

/** True when running inside a Tauri webview. */
const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' &&
  (window as unknown as Record<string, unknown>)[TAURI_INTERNALS_KEY] !== undefined;

const parseDocument = (raw: string): RuntimeEngineConfig | undefined => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    if (!schemaCheck(RuntimeEngineConfigSchema, parsed)) {
      return undefined;
    }
    return parsed as RuntimeEngineConfig;
  } catch {
    return undefined;
  }
};

/** Strips null URL fields and applies the browser-TTS default mode. */
const normalizeConfig = (doc: RuntimeEngineConfig): RuntimeEngineConfig => {
  const url = (value: string | null | undefined): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;

  return {
    text: {
      url: url(doc.text?.url),
      model: doc.text?.model,
    },
    image: {
      url: url(doc.image?.url),
      engine: doc.image?.engine ?? 'auto',
    },
    voice: {
      tts: {
        mode: doc.voice?.tts?.mode ?? 'browser',
        url: url(doc.voice?.tts?.url),
      },
      stt: {
        url: url(doc.voice?.stt?.url),
      },
    },
    models: {
      originUrl: url(doc.models?.originUrl),
    },
  };
};

class RuntimeConfigService
  extends BaseFrontendClass<RuntimeConfigServiceOptions>
  implements RuntimeConfigServiceInterface
{
  engineConfig = $state<RuntimeEngineConfig>({
    text: { url: undefined, model: undefined },
    image: { url: undefined, engine: 'auto' },
    voice: { tts: { mode: 'browser', url: undefined }, stt: { url: undefined } },
    models: { originUrl: undefined },
  });

  configSource = $state<RuntimeConfigSource>('unset');
  isLoaded = $state(false);

  private _loadPromise: Promise<RuntimeEngineConfig> | undefined;
  private _warnedOnce = false;

  /** @inheritdoc */
  async loadConfig(): Promise<RuntimeEngineConfig> {
    if (this._loadPromise) {
      return await this._loadPromise;
    }

    this._loadPromise = this._resolve();
    const config = await this._loadPromise;
    this.engineConfig = config;
    this.isLoaded = true;
    this.info('runtime-config:source', { source: this.configSource });
    return config;
  }

  private async _resolve(): Promise<RuntimeEngineConfig> {
    // ── Rung 1: localStorage override (dev builds only) ──────────────────
    if (isDevelopmentModePublic()) {
      try {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (stored) {
          const doc = parseDocument(stored);
          if (doc) {
            this.configSource = 'localStorage';
            this.debug('runtime-config:localStorage', { doc });
            return normalizeConfig(doc);
          }
          this._warnOnce();
        }
      } catch (error) {
        this.warn('runtime-config:localStorage-unavailable', error);
      }
    }

    // ── Rung 2: Tauri config file (app config directory) ─────────────────
    if (isTauriRuntime()) {
      try {
        const internals = (
          window as unknown as Record<string, { invoke: (cmd: string) => Promise<unknown> }>
        )[TAURI_INTERNALS_KEY];
        const raw = (await internals.invoke('read_runtime_config')) as string | null;
        if (typeof raw === 'string' && raw.length > 0) {
          const doc = parseDocument(raw);
          if (doc) {
            this.configSource = 'tauri-file';
            this.debug('runtime-config:tauri-file', { doc });
            return normalizeConfig(doc);
          }
          this._warnOnce();
        }
      } catch (error) {
        // Command unavailable (older shell) — fall through to HTTP.
        this.debug('runtime-config:tauri-file-unavailable', error);
      }
    }

    // ── Rung 3: `GET ./config.json` beside index.html ────────────────────
    try {
      const response = await fetch(CONFIG_PATH, { cache: 'no-store' });
      if (response.ok) {
        const raw = await response.text();
        const doc = parseDocument(raw);
        if (doc) {
          this.configSource = 'http';
          this.debug('runtime-config:http', { doc });
          return normalizeConfig(doc);
        }
        this._warnOnce();
      }
      // 404 / non-OK → fall through (no warning — a bare static host is a
      // supported deployment).
    } catch (error) {
      this.debug('runtime-config:http-failed', error);
    }

    // ── Rung 4: compile-time PUBLIC_* defaults (dev server only) ─────────
    if (isDevelopmentModePublic()) {
      const env = import.meta.env as unknown as Record<string, string | undefined>;
      const hasDefaults = Boolean(
        env.PUBLIC_OLLAMA_BASE_URL || env.PUBLIC_IMAGE_URL || env.PUBLIC_VOICE_URL,
      );
      if (hasDefaults) {
        const doc: RuntimeEngineConfig = {
          text: { url: env.PUBLIC_OLLAMA_BASE_URL },
          image: { url: env.PUBLIC_IMAGE_URL },
          voice: {
            tts: {
              mode: env.PUBLIC_VOICE_URL ? 'server' : 'browser',
              url: env.PUBLIC_VOICE_URL,
            },
          },
          models: { originUrl: undefined },
        };
        this.configSource = 'defaults';
        this.debug('runtime-config:defaults', { doc });
        return normalizeConfig(doc);
      }
    }

    // ── Rung 5: unset ────────────────────────────────────────────────────
    this.configSource = 'unset';
    this.debug('runtime-config:unset');
    return normalizeConfig({});
  }

  /** Logs a single malformed-config warning per boot. */
  private _warnOnce(): void {
    if (this._warnedOnce) {
      return;
    }
    this._warnedOnce = true;
    this.warn('runtime-config:invalid', {
      hint: 'config.json is missing or malformed — falling back to defaults. See the "Configure your local engines" docs page.',
    });
  }

  // ── Accessors ──────────────────────────────────────────────────────────

  getTextUrl(): string | undefined {
    return this.engineConfig.text?.url;
  }

  getImageUrl(): string | undefined {
    return this.engineConfig.image?.url;
  }

  getVoiceTtsMode(): TtsMode {
    return this.engineConfig.voice?.tts?.mode ?? 'browser';
  }

  getVoiceTtsUrl(): string | undefined {
    return this.engineConfig.voice?.tts?.url;
  }

  getSttUrl(): string | undefined {
    return this.engineConfig.voice?.stt?.url;
  }

  getModelsOrigin(): string | undefined {
    return this.engineConfig.models?.originUrl;
  }
}

export const runtimeConfigService: RuntimeConfigServiceInterface = RuntimeConfigService.create({
  className: 'RuntimeConfigService',
});

/** Convenience re-export used by boot code and tests. */
export { publicEnv };
