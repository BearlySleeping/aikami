// apps/frontend/client/src/lib/services/ai/local_task_pool_service.svelte.ts
//
// Singleton service that provides a configured LocalTaskPool for on-device
// text generation. The pool's loader is tiered:
//   1. Native Tauri llama.cpp sidecar / local-stack engine (OpenAI-compatible
//      HTTP on the runtime-configured text URL) — fastest, GPU-friendly.
//   2. In-browser transformers.js WebGPU/WASM worker (`text_llm_worker.ts`).
// Agents and the offline gateway adapter submit micro-tasks here with gateway
// fallback.
//
// Contract: C-427 AC-4, C-507

import { QWEN3_BUNDLE } from '@aikami/constants';
import { sanitizeJsonResponse, validateAgainstSchema } from '@aikami/frontend/ai-gateway';
import {
  createTransformersTextBackend,
  LocalTaskPool,
  type TextEngineBackend,
} from '@aikami/frontend/local-runtime';
import { BaseFrontendClass, type BaseFrontendClassInterface } from '@aikami/frontend/services/base';
import type { LocalTaskPoolServiceOptions } from '$types';
import { runtimeConfigService } from '../config/runtime_config_service.svelte.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Public contract for the configured local task-pool singleton. */
export type LocalTaskPoolServiceInterface = BaseFrontendClassInterface & {
  /** The underlying LocalTaskPool instance. */
  readonly pool: LocalTaskPool;
};

/** How long to wait for the sidecar health probe before falling back. */
const SIDECAR_PROBE_TIMEOUT_MS = 1500;

/** Output cap for sidecar-hosted micro-tasks. */
const SIDECAR_MAX_TOKENS = 512;

/** True when a value is a non-null object. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Reads `choices[0].message.content` from an OpenAI-compatible response. */
const parseChatContent = (value: unknown): string => {
  if (!isRecord(value) || !Array.isArray(value.choices) || value.choices.length === 0) {
    return '';
  }
  const first = value.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) {
    return '';
  }
  return typeof first.message.content === 'string' ? first.message.content : '';
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class LocalTaskPoolService
  extends BaseFrontendClass<LocalTaskPoolServiceOptions>
  implements LocalTaskPoolServiceInterface
{
  readonly pool: LocalTaskPool;

  constructor(options: LocalTaskPoolServiceOptions) {
    super(options);
    this.pool = new LocalTaskPool({
      bundle: QWEN3_BUNDLE,
      loader: (files, signal) => this._loadTextEngine({ files, signal }),
      maxConcurrency: 2,
      // The sidecar and the transformers.js worker source weights themselves,
      // so the app-managed Qwen3 cache is optional.
      allowMissingAssets: true,
      validation: {
        sanitizeJsonResponse,
        validateAgainstSchema,
      },
    });
  }

  // ── Private: tiered engine loader ────────────────────────────────────

  /**
   * Loads the best available on-device text backend. Prefers the native
   * sidecar (reachable over HTTP), then the in-browser worker.
   */
  private async _loadTextEngine(options: {
    files: ReadonlyArray<{ path: string; data: ArrayBuffer }>;
    signal: AbortSignal;
  }): Promise<TextEngineBackend> {
    const sidecar = await this._trySidecarBackend(options.signal);
    if (sidecar) {
      this.info('localTaskPool:sidecar-ready');
      return sidecar;
    }

    this.info('localTaskPool:worker-loading', { files: options.files.length });
    return await createTransformersTextBackend({
      bundle: QWEN3_BUNDLE,
      signal: options.signal,
      maxTokens: SIDECAR_MAX_TOKENS,
      temperature: 0.3,
    });
  }

  /**
   * Probes the runtime-configured local text engine and, when it answers,
   * returns a backend that forwards generation to its OpenAI-compatible
   * chat endpoint. Returns undefined when no engine is configured/reachable.
   */
  private async _trySidecarBackend(signal: AbortSignal): Promise<TextEngineBackend | undefined> {
    const base = runtimeConfigService.getTextUrl()?.replace(/\/+$/, '');
    if (!base) {
      return undefined;
    }

    const probeSignal = AbortSignal.any([signal, AbortSignal.timeout(SIDECAR_PROBE_TIMEOUT_MS)]);
    try {
      const probe = await fetch(`${base}/models`, { signal: probeSignal });
      if (!probe.ok) {
        return undefined;
      }
    } catch {
      return undefined;
    }

    return {
      // The sidecar is a native process, but `EngineBackend.kind` only models
      // in-browser backends; `wasm` is reused as the "local, non-GPU" marker.
      kind: 'wasm',
      async generate(prompt: string): Promise<string> {
        const response = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'local',
            messages: [{ role: 'user', content: prompt }],
            stream: false,
            temperature: 0.3,
            // biome-ignore lint/style/useNamingConvention: OpenAI-compatible API uses snake_case
            max_tokens: SIDECAR_MAX_TOKENS,
          }),
        });
        if (!response.ok) {
          throw new Error(`Local text engine responded ${response.status}`);
        }
        return parseChatContent(await response.json());
      },
      async dispose(): Promise<void> {},
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const localTaskPoolService: LocalTaskPoolServiceInterface = LocalTaskPoolService.create({
  className: 'LocalTaskPoolService',
});
