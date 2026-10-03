// packages/frontend/ai-gateway/src/lib/decision/tasks/residency_probe.ts
//
// Runtime residency evidence for Ollama-compatible decision endpoints
// (issue #381, lane C).
//
// ---------------------------------------------------------------------------
// Why the runtime has to be asked
// ---------------------------------------------------------------------------
//
// A harness cannot learn whether a checkpoint is resident from how long a
// request took, and it certainly cannot learn it from which case it was. On a
// 16 GB card a 4.48 GB checkpoint can be resident for the whole run, evicted
// halfway through, or pre-loaded before the first dispatch — and all three
// produce a latency sequence that looks like "some cold, then warm".
//
// Ollama reports residency directly: `GET /api/ps` lists the models currently
// loaded, with their names. That is lifecycle evidence, so it is what this
// reads.
//
// Where the runtime cannot answer, this returns `verified: false` rather than a
// guess. An unverifiable condition is not a satisfied condition, and the
// measurement layer treats the difference as the difference between a reported
// warm percentile and no percentile at all.

import type { ResidencyEvidence } from '../adapters/types.ts';

/** The subset of Ollama's `/api/ps` payload this reads. */
type OllamaPsEntry = { name?: unknown; model?: unknown };
type OllamaPsBody = { models?: unknown };

/**
 * Derives the Ollama API root from a `/v1/systemone` decision endpoint.
 *
 * Derived rather than configured so a caller cannot pair a decision endpoint
 * with the residency route of a different daemon — which would report another
 * process's residency and silently corrupt the condition.
 */
export const ollamaRootFor = (decisionEndpoint: string): string =>
  decisionEndpoint.replace(/\/v1\/systemone\/?$/, '').replace(/\/+$/, '');

/**
 * Normalizes a checkpoint identity for comparison against a listing.
 *
 * Mirrors the readiness probe's own normalization: Ollama lists `tev1:latest`
 * when configured as `tev1`, and either may appear with or without a registry
 * prefix.
 */
export const residencyNameMatches = (listed: string, checkpoint: string): boolean => {
  const normalize = (value: string): string => value.trim().toLowerCase().split(':')[0] ?? '';
  return normalize(listed) === normalize(checkpoint);
};

/**
 * Asks an Ollama-compatible daemon whether `checkpoint` is resident.
 *
 * Cheap and local: `/api/ps` is a process-state query, not inference. It is
 * called once per dispatch to observe residency at that moment.
 */
export const probeOllamaResidency = async (options: {
  readonly root: string;
  readonly checkpoint: string;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}): Promise<ResidencyEvidence> => {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  try {
    const response = await doFetch(`${options.root}/api/ps`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (!response.ok) {
      return {
        verified: false,
        method: 'ollama:/api/ps',
        detail: `residency listing answered ${response.status}`,
      };
    }
    const body = (await response.json()) as OllamaPsBody;
    if (!Array.isArray(body.models)) {
      return {
        verified: false,
        method: 'ollama:/api/ps',
        detail: 'residency listing had no models array',
      };
    }
    const loaded = (body.models as OllamaPsEntry[])
      .map((entry) => (typeof entry.name === 'string' ? entry.name : entry.model))
      .filter((value): value is string => typeof value === 'string');

    return {
      verified: true,
      resident: loaded.some((name) => residencyNameMatches(name, options.checkpoint)),
      method: 'ollama:/api/ps',
      detail: `${loaded.length} model(s) resident`,
    };
  } catch (error) {
    return {
      verified: false,
      method: 'ollama:/api/ps',
      detail: `residency listing unreachable: ${String(error)}`,
    };
  }
};

/** The evidence an adapter reports when its runtime offers no residency route. */
export const unverifiedResidency = (method: string, detail: string): ResidencyEvidence => ({
  verified: false,
  method,
  detail,
});
