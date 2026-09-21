// apps/frontend/client/src/lib/views/settings/ai/ai_model_testing.ts
//
// Pure transport for the draft model chat-test: sends the resolved request
// through the credential policy and maps the outcome to a ConnectionTestResult.
// Ownership (generation, session) stays with the caller — this only performs
// the request and shapes the result, so a stale caller can discard it.

import type { ConnectionTestResult } from '$types';

/** Credential-policy fetch transport, as injected into the AI settings editor. */
type CredentialFetch = (options: {
  url: string;
  init: RequestInit;
  hasCredential: boolean;
  approvedOrigins?: readonly string[];
}) => Promise<Response | undefined>;

/** Executes a draft model chat-test and maps the transport outcome to a result. */
export const runDraftModelTest = async (options: {
  request: { url: string; headers: Record<string, string>; body?: string };
  apiKey?: string;
  approvedOrigins?: readonly string[];
  signal: AbortSignal;
  timeoutMs: number;
  fetchWithCredentialPolicy: CredentialFetch;
}): Promise<ConnectionTestResult> => {
  const startMs = performance.now();
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), options.timeoutMs);
  const signal = AbortSignal.any([options.signal, timeoutController.signal]);

  try {
    const response = await options.fetchWithCredentialPolicy({
      url: options.request.url,
      hasCredential: Boolean(options.apiKey),
      approvedOrigins: options.approvedOrigins,
      init: {
        body: options.request.body,
        headers: { 'Content-Type': 'application/json', ...options.request.headers },
        method: 'POST',
        signal,
      },
    });
    const elapsed = Math.round(performance.now() - startMs);

    if (!response) {
      return {
        ok: false,
        latencyMs: elapsed,
        error: 'Request blocked by credential policy (unapproved redirect)',
      };
    }
    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      return {
        ok: false,
        latencyMs: elapsed,
        error: `HTTP ${response.status}${errorBody ? `: ${errorBody.slice(0, 200)}` : ''}`,
      };
    }
    return { ok: true, latencyMs: elapsed };
  } catch (err) {
    const elapsed = Math.round(performance.now() - startMs);
    return {
      ok: false,
      latencyMs: elapsed,
      error:
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Connection timed out'
          : String(err),
    };
  } finally {
    clearTimeout(timeoutId);
  }
};
