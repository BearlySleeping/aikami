// packages/frontend/ai-gateway/src/lib/detection.ts
//
// Gateway detection API — relocated provider-ping logic from the client's
// capability_service (Ollama proxy/native ping with shared deadline, cloud
// config presence check, ComfyUI object_info ping, Kokoro engine status).
// Results are convertible to the existing DetectionStatus union.
// Contract: C-320 AC-5

import type { AiDetectionResult, DetectionStatus } from '@aikami/types';

/** Detection budget per capability check (parity with capability_service). */
export const DETECTION_TIMEOUT_MS = 3_000;

/** Default Ollama Vite dev-proxy path (same-origin, no CORS). */
export const DEFAULT_OLLAMA_PROXY_PATH = '/api/text/';

/** Default native Ollama tags endpoint (Tauri / relaxed-CSP contexts).
 *  Resolved at runtime by the caller (C-389) — the SPA bundle must not
 *  embed a hardcoded engine URL.
 */
export const DEFAULT_OLLAMA_NATIVE_URL = '';

/** Default ComfyUI object_info ping path via the Vite dev proxy. */
export const DEFAULT_COMFYUI_PING_URL = '/api/image/object_info';

/** Performs a GET fetch with an abort timeout. */
export const fetchWithTimeout = async (options: {
  url: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}): Promise<Response> => {
  const { url, timeoutMs, fetchFn, signal } = options;
  const doFetch = fetchFn ?? globalThis.fetch;
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Race against the timeout as well — injected fetch implementations
    // that ignore AbortSignal must still respect the detection budget.
    return await Promise.race([
      doFetch(url, { method: 'GET', signal: controller.signal }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), timeoutMs),
      ),
    ]);
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onAbort);
  }
};

const nowIso = (): string => new Date().toISOString();

/**
 * Detects text AI availability.
 *
 * Order (parity with capability_service.detectText):
 * 1. Configured cloud connection (vault/env) → available via `byok`.
 * 2. Ollama via dev proxy (primary; same-origin → no CORS).
 * 3. Native fetch to the runtime-configured engine's Ollama-shaped
 *    `/api/tags` endpoint.
 * 4. Native fetch to the SAME engine's OpenAI-compatible `/v1/models`
 *    endpoint — the local-stack's bundled default (llama.cpp's
 *    llama-server) speaks this shape, not Ollama's native API, even
 *    though it commonly shares Ollama's default port. A server that only
 *    answers here is labelled `llamacpp`, never `ollama`, so the chat
 *    adapter's Ollama-specific quirks (disabled streaming, `/api/chat`
 *    request shape) are never misapplied to it.
 * All local attempts share one aggregate deadline.
 */
export const detectTextAvailability = async (options?: {
  hasCloudConfig?: () => boolean;
  proxyUrl?: string;
  nativeUrl?: string;
  /** Full URL to the runtime-configured engine's OpenAI-compatible models list (e.g. `<base>/v1/models`). */
  openaiCompatUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}): Promise<AiDetectionResult> => {
  const {
    hasCloudConfig,
    proxyUrl = DEFAULT_OLLAMA_PROXY_PATH,
    nativeUrl = DEFAULT_OLLAMA_NATIVE_URL,
    openaiCompatUrl,
    timeoutMs = DETECTION_TIMEOUT_MS,
    fetchFn,
    signal,
  } = options ?? {};

  try {
    if (hasCloudConfig?.()) {
      return {
        capability: 'text',
        available: true,
        mode: 'byok',
        provider: 'cloud',
        detail: 'Cloud text provider configured',
        checkedAt: nowIso(),
      };
    }
  } catch {
    // Vault read failures degrade to not-configured — continue local pings.
  }

  // Both Ollama attempts share one aggregate deadline.
  const deadline = Date.now() + timeoutMs;

  // Primary: Vite dev proxy (same-origin, no CORS issues)
  try {
    const remaining = Math.max(0, deadline - Date.now());
    const response = await fetchWithTimeout({
      url: proxyUrl,
      timeoutMs: remaining,
      fetchFn,
      signal,
    });
    if (response.ok) {
      // Guard against SPA fallback: /api/text/ on a static host returns
      // index.html (200 OK) — check Content-Type to avoid false positives.
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        return {
          capability: 'text',
          available: true,
          mode: 'offline',
          provider: 'ollama',
          detail: 'Ollama reachable via dev proxy',
          checkedAt: nowIso(),
        };
      }
    }
  } catch {
    // Proxy unavailable — fall through to native ping.
  }

  // Fallback: native fetch to the runtime-configured text engine
  // (CORS-limited in browser, works in Tauri / Electron due to relaxed CSP).
  if (nativeUrl) {
    try {
      const remaining = Math.max(0, deadline - Date.now());
      const response = await fetchWithTimeout({
        url: nativeUrl,
        timeoutMs: remaining,
        fetchFn,
        signal,
      });
      if (response.ok) {
        const body = (await response.json()) as { models?: unknown[] };
        const modelCount = Array.isArray(body.models) ? body.models.length : 0;
        return {
          capability: 'text',
          available: true,
          mode: 'offline',
          provider: 'ollama',
          detail: `Ollama reachable natively (${modelCount} models)`,
          checkedAt: nowIso(),
        };
      }
    } catch {
      // CORS rejection or connection refused — expected in browser mode.
    }
  }

  // Fallback: the same engine's OpenAI-compatible surface. Only reached
  // when the Ollama-native probe above didn't already return — a server
  // that answers /api/tags is genuinely Ollama and is reported as such.
  if (openaiCompatUrl) {
    try {
      const remaining = Math.max(0, deadline - Date.now());
      const response = await fetchWithTimeout({
        url: openaiCompatUrl,
        timeoutMs: remaining,
        fetchFn,
        signal,
      });
      if (response.ok) {
        const body = (await response.json()) as { data?: unknown[] };
        if (Array.isArray(body.data)) {
          return {
            capability: 'text',
            available: true,
            mode: 'offline',
            provider: 'llamacpp',
            detail: `Local OpenAI-compatible server reachable (${body.data.length} models)`,
            checkedAt: nowIso(),
          };
        }
      }
    } catch {
      // Connection refused or CORS rejection — expected when nothing local is running.
    }
  }

  return {
    capability: 'text',
    available: false,
    detail: 'No text provider reachable or configured',
    checkedAt: nowIso(),
  };
};

/**
 * Detects image AI availability (parity with capability_service.detectImage):
 * configured provider → available via `byok`; otherwise a local-engine
 * probe, then the ComfyUI dev-proxy ping.
 */
export const detectImageAvailability = async (options?: {
  hasConfiguredProvider?: () => boolean;
  pingUrl?: string;
  /**
   * Probes the runtime-configured image engine and reports which one
   * answered. The mirror of `openaiCompatUrl` on the text detector: the
   * local stack's bundled image engine is sd-server, which speaks the
   * A1111 surface (`/sdapi/v1/sd-models`) and has no ComfyUI
   * `/object_info` at all, so the ping below can never see it. Without
   * this, a healthy local image engine is reported unavailable.
   */
  resolveLocalEngine?: () => Promise<{ id: string } | undefined>;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}): Promise<AiDetectionResult> => {
  const {
    hasConfiguredProvider,
    pingUrl = DEFAULT_COMFYUI_PING_URL,
    resolveLocalEngine,
    timeoutMs = DETECTION_TIMEOUT_MS,
    fetchFn,
    signal,
  } = options ?? {};

  try {
    if (hasConfiguredProvider?.()) {
      return {
        capability: 'image',
        available: true,
        mode: 'byok',
        provider: 'custom',
        detail: 'Image provider configured',
        checkedAt: nowIso(),
      };
    }
  } catch {
    // Fall through to proxy check.
  }

  // The runtime-configured engine, probed through the caller's own engine
  // resolver so detection agrees with what generation will actually use.
  // Runs before the proxy ping: on a static host `pingUrl` is served the SPA
  // shell, and only the content-type guard below keeps that from reading as
  // a live ComfyUI.
  if (resolveLocalEngine) {
    try {
      const engine = await resolveLocalEngine();
      if (engine) {
        return {
          capability: 'image',
          available: true,
          mode: 'offline',
          provider: engine.id,
          detail: `Local image engine reachable (${engine.id})`,
          checkedAt: nowIso(),
        };
      }
    } catch {
      // Probe failure is "not running", never a detection error.
    }
  }

  try {
    const response = await fetchWithTimeout({ url: pingUrl, timeoutMs, fetchFn, signal });
    if (response.ok) {
      // Guard against SPA fallback: on static hosts (Firebase Hosting),
      // /api/image/object_info returns index.html (200 OK). Verify the
      // response is actually JSON from ComfyUI, not the SPA shell.
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        return {
          capability: 'image',
          available: true,
          mode: 'offline',
          provider: 'comfyui',
          detail: 'ComfyUI reachable',
          checkedAt: nowIso(),
        };
      }
    }
  } catch {
    // Connection refused — expected when ComfyUI is not running.
  }

  return {
    capability: 'image',
    available: false,
    detail: 'No image engine reachable and no image provider configured',
    checkedAt: nowIso(),
  };
};

/**
 * Detects voice availability. Reports real engine status while remaining
 * convertible to today's optimistic snapshot (Kokoro WebGPU is treated as
 * available unless the engine reports a hard error).
 */
export const detectVoiceAvailability = async (options?: {
  getEngineStatus?: () => { status: string; serverAvailable: boolean };
}): Promise<AiDetectionResult> => {
  const engine = options?.getEngineStatus?.() ?? {
    status: 'uninitialized',
    serverAvailable: false,
  };

  // Optimistic snapshot (C-320 AC-5): an uninitialized Kokoro WebGPU
  // engine is still available — it initializes lazily on first use.
  // Only a hard engine error makes voice unavailable.
  if (engine.status === 'error') {
    return {
      capability: 'voice',
      available: false,
      detail: 'Kokoro engine error',
      checkedAt: nowIso(),
    };
  }

  return {
    capability: 'voice',
    available: true,
    mode: 'offline',
    provider: 'kokoro',
    detail: engine.serverAvailable
      ? 'Kokoro REST server detected'
      : `Kokoro WebGPU engine (${engine.status})`,
    checkedAt: nowIso(),
  };
};

/**
 * Converts a gateway detection result to the existing DetectionStatus
 * union so C-322 can swap capability_service internals without shape
 * changes.
 */
export const toDetectionStatus = (result: AiDetectionResult): DetectionStatus => {
  if (!result.available) {
    return 'not_found';
  }
  if (result.mode === 'byok') {
    return 'configured';
  }
  return 'detected';
};
