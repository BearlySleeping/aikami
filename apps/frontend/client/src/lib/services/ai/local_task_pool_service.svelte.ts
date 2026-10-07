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
// Readiness is tracked PER MODEL (`local_readiness.ts`): a `/models` probe that
// merely answers proves a process is listening, not that the model a caller
// asked for can generate, so a model absent from the served list is not treated
// as ready and the caller routes to the gateway instead of paying a cold load.
//
// Contract: C-427 AC-4, C-507, issue #382 P0 readiness-aware local execution.

import { QWEN3_BUNDLE } from '@aikami/constants';
import { sanitizeJsonResponse, validateAgainstSchema } from '@aikami/frontend/ai-gateway';
import {
  createTransformersTextBackend,
  LocalTaskPool,
  type TextEngineBackend,
  type TextEngineGenerateOptions,
} from '@aikami/frontend/local-runtime';
import { BaseFrontendClass, type BaseFrontendClassInterface } from '@aikami/frontend/services/base';
import type { LocalTaskPoolServiceOptions } from '$types';
import { runtimeConfigService } from '../config/runtime_config_service.svelte.ts';
import { createLocalReadinessController, type LocalReadiness } from './local_readiness.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Public contract for the configured local task-pool singleton. */
export type LocalTaskPoolServiceInterface = BaseFrontendClassInterface & {
  /** The underlying LocalTaskPool instance. */
  readonly pool: LocalTaskPool;
  /** What is currently known about the on-device engine's readiness. */
  readonly readiness: LocalReadiness;
  /**
   * Whether local-first may attempt `model` right now.
   *
   * An unresolved engine returns true exactly once — the attempt is what
   * produces the evidence — and false on every call after a failure, so a dead
   * engine costs one probe per cooldown rather than one per request.
   */
  canServeLocal(model?: string): boolean;
};

/** How long to wait for the sidecar health probe before falling back. */
const SIDECAR_PROBE_TIMEOUT_MS = 1500;

/** Output cap for sidecar-hosted micro-tasks. */
const SIDECAR_MAX_TOKENS = 512;

/** True when a value is a non-null object. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Reads `choices[0].message.content` from an OpenAI-compatible response.
 * Throws on a missing/empty body so the caller can fall back rather than
 * treating an empty string as a valid generation.
 */
const parseChatContent = (value: unknown): string => {
  if (!isRecord(value) || !Array.isArray(value.choices) || value.choices.length === 0) {
    throw new Error('Local text engine returned no choices');
  }
  const first = value.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) {
    throw new Error('Local text engine response missing message');
  }
  const content = first.message.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('Local text engine returned empty content');
  }
  return content;
};

/**
 * Extracts served model ids from an OpenAI-compatible `/models` body.
 *
 * Returns an empty list when the shape is unfamiliar. An empty list is the
 * honest result: the probe proved liveness and nothing more, so readiness stays
 * unproven rather than being widened into a claim it cannot support.
 */
const parseServedModelIds = (value: unknown): readonly string[] => {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    return [];
  }
  const ids: string[] = [];
  for (const entry of value.data) {
    if (isRecord(entry) && typeof entry.id === 'string' && entry.id.length > 0) {
      ids.push(entry.id);
    }
  }
  return ids;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class LocalTaskPoolService
  extends BaseFrontendClass<LocalTaskPoolServiceOptions>
  implements LocalTaskPoolServiceInterface
{
  readonly pool: LocalTaskPool;
  private readonly _readiness = createLocalReadinessController();
  /** The model the worker backend serves, for readiness accounting. */
  private readonly _workerModelId = QWEN3_BUNDLE.id;

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

  /** @inheritdoc */
  get readiness(): LocalReadiness {
    return this._readiness.current;
  }

  /** @inheritdoc */
  canServeLocal(model?: string): boolean {
    return this._readiness.canServe(model);
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
    // The worker serves the app-managed bundle and nothing else, so its
    // readiness is known by construction rather than by a probe.
    this._readiness.served([this._workerModelId]);
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
   *
   * The probe records the engine's SERVED MODEL LIST as readiness evidence, not
   * merely that a process answered. The backend itself still learns readiness
   * from what it can actually generate.
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
        this._readiness.unavailable(`probe responded ${probe.status}`);
        return undefined;
      }
      this._readiness.served(parseServedModelIds(await probe.json().catch(() => undefined)));
    } catch (error) {
      // Caller cancellation must propagate, not fall through to the worker.
      if (signal.aborted) {
        throw error;
      }
      this._readiness.unavailable('probe failed');
      return undefined;
    }

    // `this` inside the returned object's method is the backend, not the
    // service, so readiness is captured lexically.
    const readiness = this._readiness;
    return {
      // The sidecar is a native process, but `EngineBackend.kind` only models
      // in-browser backends; `wasm` is reused as the "local, non-GPU" marker.
      kind: 'wasm',
      async generate(prompt: string, options?: TextEngineGenerateOptions): Promise<string> {
        const response = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'local',
            messages: [{ role: 'user', content: prompt }],
            stream: false,
            temperature: options?.temperature ?? 0.3,
            // biome-ignore lint/style/useNamingConvention: OpenAI-compatible API uses snake_case
            max_tokens: options?.maxTokens ?? SIDECAR_MAX_TOKENS,
          }),
          signal: options?.signal,
        });
        if (!response.ok) {
          readiness.unavailable(`generation responded ${response.status}`);
          throw new Error(`Local text engine responded ${response.status}`);
        }
        const content = parseChatContent(await response.json());
        // A completed generation is the strongest readiness evidence there is.
        readiness.generated('local');
        return content;
      },
      async dispose(): Promise<void> {
        readiness.reset();
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const localTaskPoolService: LocalTaskPoolServiceInterface = LocalTaskPoolService.create({
  className: 'LocalTaskPoolService',
});
