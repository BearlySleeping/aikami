/**
 * apps/backend/local-stack/stack/detect_ollama.ts
 *
 * Loopback probe for an already-running Ollama server on the text engine's
 * port. This is a deliberate, narrow exception to `detectHardware`'s
 * "entirely local, no network" contract (see init.ts's header comment) —
 * it never leaves 127.0.0.1 and exists purely for interop, the same way a
 * compose healthcheck talks to its own container over loopback.
 *
 * Why this matters: `stack init` binds the bundled text engine to 11434
 * because that's Ollama's own default and what the client's Ollama
 * provider and the Tauri CSP allowlist already expect (README "Ports are
 * deliberate"). A user who already runs Ollama on 11434 doesn't have a
 * port conflict to work around — they have a redundant download and a
 * container that will fail to bind. Detecting it lets `stack init` offer
 * to just point at what's already there.
 */

/** Capped short — this only needs to distinguish "answers instantly" from "nothing home". */
const PROBE_TIMEOUT_MS = 300;

/** Shape of Ollama's `GET /api/tags` response — enough to avoid false positives on an unrelated service. */
const looksLikeOllama = (body: unknown): boolean =>
  Boolean(body && typeof body === 'object' && Array.isArray((body as { models?: unknown }).models));

/**
 * True when an Ollama-shaped HTTP server answers on `127.0.0.1:port`.
 * Never throws — connection refused, timeout, or a non-Ollama response on
 * the port all resolve to `false`.
 */
export const probeOllama = async (port: number): Promise<boolean> => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/tags`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return false;
    }
    const body = await response.json().catch(() => undefined);
    return looksLikeOllama(body);
  } catch {
    return false;
  }
};
