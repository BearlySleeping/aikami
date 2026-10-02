// packages/frontend/ai-gateway/src/lib/decision/runtime_probe.ts
//
// Runtime readiness, decided by WHICH RUNTIME you are talking to (issue #381).
//
// The bug this file exists to fix is a category error. C-567's probe required
// `/api/version` and enforced a `0.35.0` floor for every backend speaking
// `jev-v1`. That is an *Ollama* fact. Laya's HTTP serving and a hosted Jev
// endpoint serve the same wire shape and have no `/api/version` route at all —
// so every external, non-Ollama backend was refused before it was ever asked a
// question. "Speaks this dialect" and "is this runtime" are different facts,
// and conflating them is how a working endpoint gets reported as an
// unsupported runtime.
//
// What each runtime is allowed to assert about itself:
//
//   `ollama` — may be asked for its version and must clear the dialect floor.
//   `jev`   — a generic, externally managed Jev-compatible server. It is NOT
//             asked for `/api/version`, because it may not serve it. Its
//             checkpoint listing is used when offered and is advisory: a
//             missing listing route is not a failure. The authority on whether
//             it can actually answer is the sample inference in `readiness.ts`,
//             which this module can neither perform nor substitute for.
//
// Nothing here downloads, installs or upgrades anything. Reporting that a
// runtime is too old is the whole deliverable; upgrading someone's shared
// daemon is never this layer's decision.

import type { SystemOneTransport } from './adapters/systemone_adapter.ts';
import {
  declaresScoring,
  normalizeModelName,
  parseModelListing,
  probeSystemOneBackend,
  SYSTEM_ONE_MIN_RUNTIME_VERSION,
  type SystemOneListedModel,
  type SystemOneProbeFailureState,
} from './systemone_readiness.ts';

/** Which runtime kind an endpoint is. Decides which probes are legitimate. */
export type DecisionRuntimeKind =
  /** Ollama serving `/v1/systemone` (0.35.0+). Version route is authoritative. */
  | 'ollama'
  /**
   * Any other server that serves the `jev-v1` shape: laya.cpp's HTTP route, a
   * hosted Jev API, or anything else implementing the same body. No Ollama
   * version route is assumed or required.
   */
  | 'jev';

/** Endpoints a runtime probe may use. All caller-supplied; nothing is assumed. */
export type DecisionRuntimeEndpoints = {
  /** The decision endpoint, e.g. `http://127.0.0.1:11434/v1/systemone`. */
  readonly decision: string;
  /** Ollama only. Required for `runtime: 'ollama'`; never requested for `jev`. */
  readonly version?: string;
  /** Optional checkpoint listing. Advisory for `jev`, a real check for `ollama`. */
  readonly models?: string;
};

/** Runtime identities, as reported in readiness and provenance. */
export const DECISION_RUNTIME_KINDS: readonly DecisionRuntimeKind[] = ['ollama', 'jev'];

/** Human-readable runtime label for a kind, with no vendor implied beyond the fact. */
export const runtimeLabel = (runtime: DecisionRuntimeKind): string =>
  runtime === 'ollama' ? `Ollama (>= ${SYSTEM_ONE_MIN_RUNTIME_VERSION})` : 'Jev-compatible server';

/** Failure states a runtime probe can report. Mirrors the dialect probe's. */
export type DecisionRuntimeProbeFailureState = SystemOneProbeFailureState | 'misconfigured';

/** Outcome of a runtime-level probe. */
export type DecisionRuntimeProbeResult =
  | {
      readonly ok: true;
      /** Runtime version, or the runtime label when the runtime has no version route. */
      readonly runtime: string;
      readonly runtimeKind: DecisionRuntimeKind;
      /** The listing entry that matched, or a synthesised one when unlisted. */
      readonly listed: SystemOneListedModel;
      /** True only when an advertised capability list mentioned decision scoring. */
      readonly scoringDeclared: boolean;
      /** False for `jev`, where no version route is consulted. */
      readonly versionFloorChecked: boolean;
      /** Notes a caller may show: a listing route that could not be read. */
      readonly notes: readonly string[];
    }
  | {
      readonly ok: false;
      readonly state: DecisionRuntimeProbeFailureState;
      readonly reason: string;
      readonly runtimeKind: DecisionRuntimeKind;
      readonly runtime?: string;
    };

/** Runtime probe options. */
export type DecisionRuntimeProbeOptions = {
  readonly runtime: DecisionRuntimeKind;
  readonly transport: SystemOneTransport;
  readonly endpoints: DecisionRuntimeEndpoints;
  readonly model: string;
  /** Total budget across every sub-probe, in ms. */
  readonly budgetMs: number;
  readonly signal: AbortSignal;
  /** Resolved per request so a vault-backed credential is never captured in a closure at construction. */
  readonly authHeaders?: () => Promise<Readonly<Record<string, string>>>;
};

/** JSON parse that never throws; an unparseable body becomes undefined. */
const safeJson = async (response: { text(): Promise<string> }): Promise<unknown> => {
  try {
    return JSON.parse(await response.text());
  } catch {
    return undefined;
  }
};

/** Runs one authenticated GET under the remaining budget and the caller's cancellation. */
const get = async (
  options: DecisionRuntimeProbeOptions,
  url: string,
): Promise<
  | { status: number; body: unknown }
  | { error: 'cancelled' | 'deadline-exceeded' | 'failed'; detail: string }
> => {
  if (options.signal.aborted) {
    return { error: 'cancelled', detail: 'cancelled before probe' };
  }
  if (options.budgetMs <= 0) {
    return { error: 'deadline-exceeded', detail: 'no probe budget left' };
  }
  const headers = options.authHeaders === undefined ? {} : await options.authHeaders();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.budgetMs);
  const onAbort = (): void => controller.abort();
  options.signal.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await options.transport.fetch(url, {
      method: 'GET',
      headers: { ...headers },
      signal: controller.signal,
    });
    const body = await safeJson(response);
    if (options.signal.aborted) {
      return { error: 'cancelled', detail: 'cancelled during probe' };
    }
    if (controller.signal.aborted) {
      return { error: 'deadline-exceeded', detail: 'probe budget exhausted' };
    }
    return { status: response.status, body };
  } catch (error) {
    if (options.signal.aborted) {
      return { error: 'cancelled', detail: 'cancelled during probe' };
    }
    if (controller.signal.aborted) {
      return { error: 'deadline-exceeded', detail: 'probe budget exhausted' };
    }
    return {
      error: 'failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', onAbort);
  }
};

/**
 * Reads the checkpoint from a listing route, treating absence as absence of
 * evidence rather than as a missing model.
 *
 * A generic Jev server may serve `/v1/models` and may not. A 404 on a listing is
 * therefore a note, not a failure — the sample inference decides. An
 * authenticated-but-refused listing (401/403) IS a failure, because it means
 * the credential the user entered is wrong and no later probe would say so.
 */
const advisoryCheckpoint = async (
  options: DecisionRuntimeProbeOptions,
): Promise<
  | { ok: true; listed: SystemOneListedModel; scoringDeclared: boolean; notes: string[] }
  | { ok: false; state: DecisionRuntimeProbeFailureState; reason: string }
> => {
  const notes: string[] = [];
  const fallback: SystemOneListedModel = { name: options.model };
  if (options.endpoints.models === undefined) {
    notes.push('no checkpoint listing route configured; the sample inference is the authority');
    return { ok: true, listed: fallback, scoringDeclared: false, notes };
  }

  const listing = await get(options, options.endpoints.models);
  if ('error' in listing) {
    notes.push(
      `checkpoint listing ${listing.error}: ${listing.detail}; the sample inference is the authority`,
    );
    return { ok: true, listed: fallback, scoringDeclared: false, notes };
  }
  if (listing.status === 401 || listing.status === 403) {
    return {
      ok: false,
      state: 'unauthorized',
      reason: `checkpoint listing returned HTTP ${listing.status}; check the stored credential`,
    };
  }
  if (listing.status !== 200) {
    notes.push(
      `checkpoint listing returned HTTP ${listing.status}; the sample inference is the authority`,
    );
    return { ok: true, listed: fallback, scoringDeclared: false, notes };
  }

  const models = parseModelListing(listing.body);
  const wanted = normalizeModelName(options.model);
  const match = models.find((entry) => normalizeModelName(entry.name) === wanted);
  if (match === undefined) {
    // The listing is advisory here: a server may serve its checkpoints under
    // names the caller does not know yet, and only a sample can settle it.
    notes.push(
      `checkpoint "${options.model}" is not in the listing (${models.length} listed); the sample inference decides`,
    );
    return { ok: true, listed: fallback, scoringDeclared: false, notes };
  }
  if (match.capabilities !== undefined && !declaresScoring(match.capabilities)) {
    return {
      ok: false,
      state: 'capability-missing',
      reason: `checkpoint "${match.name}" advertises [${match.capabilities.join(', ')}], none of which is decision scoring`,
    };
  }
  return { ok: true, listed: match, scoringDeclared: declaresScoring(match.capabilities), notes };
};

/**
 * Probes a `jev-v1` endpoint for runtime readiness, by runtime kind.
 *
 * `ollama` keeps the strict two-stage probe: version floor, then checkpoint.
 * `jev` never requests `/api/version`, treats its checkpoint listing as
 * advisory, and returns success so the caller proceeds to the sample inference
 * that is the real proof either way.
 */
export const probeDecisionRuntime = async (
  options: DecisionRuntimeProbeOptions,
): Promise<DecisionRuntimeProbeResult> => {
  if (options.runtime === 'ollama') {
    if (options.endpoints.version === undefined) {
      return {
        ok: false,
        state: 'misconfigured',
        reason:
          "runtime 'ollama' requires a version endpoint; configure /api/version or switch to runtime 'jev'",
        runtimeKind: 'ollama',
      };
    }
    const result = await probeSystemOneBackend({
      transport: options.transport,
      endpoints: {
        decision: options.endpoints.decision,
        version: options.endpoints.version,
        ...(options.endpoints.models === undefined ? {} : { models: options.endpoints.models }),
      },
      model: options.model,
      budgetMs: options.budgetMs,
      signal: options.signal,
      ...(options.authHeaders === undefined ? {} : { authHeaders: options.authHeaders }),
    });
    if (!result.ok) {
      return { ...result, runtimeKind: 'ollama' };
    }
    return {
      ok: true,
      runtime: result.runtime,
      runtimeKind: 'ollama',
      listed: result.listed,
      scoringDeclared: result.scoringDeclared,
      versionFloorChecked: true,
      notes: [],
    };
  }

  const checkpoint = await advisoryCheckpoint(options);
  if (!checkpoint.ok) {
    return { ...checkpoint, runtimeKind: 'jev' };
  }
  return {
    ok: true,
    runtime: runtimeLabel('jev'),
    runtimeKind: 'jev',
    listed: checkpoint.listed,
    scoringDeclared: checkpoint.scoringDeclared,
    versionFloorChecked: false,
    notes: checkpoint.notes,
  };
};
