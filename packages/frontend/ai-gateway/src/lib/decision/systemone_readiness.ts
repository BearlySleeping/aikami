// packages/frontend/ai-gateway/src/lib/decision/systemone_readiness.ts
//
// `/v1/systemone`-dialect readiness, checked by asking the runtime (issue #381,
// contract C-567).
//
// Everything here is learned from the endpoint at call time. Nothing is taken
// from a README, and nothing is assumed to work because a port is bound:
//
//   - C-566's adapter reported `ready: true` as soon as `/api/version` answered
//     200. On this machine that is exactly wrong: Ollama `0.34.3` answers
//     `/api/version` with 200 and `/v1/systemone` with 404, so a
//     version-probe-only check would have declared a backend ready that cannot
//     answer a single decision. That is the false-ready bug this module fixes.
//   - A runtime below the dialect's floor cannot serve it, whatever else works.
//   - A runtime new enough but missing the checkpoint cannot serve it either.
//   - A checkpoint that advertises capabilities and none of them are
//     decision-scoring is reported as `capability-missing`. When a runtime
//     advertises NO capability list at all we do NOT fail it: absence of
//     evidence is not evidence of absence, and the sample decision in
//     `readiness.ts` is the real proof either way.
//
// This module does not download, install or upgrade anything. Reporting that a
// runtime is too old is the whole deliverable; upgrading a user's shared daemon
// is never this layer's decision.

import type { SystemOneEndpoints, SystemOneTransport } from './adapters/systemone_adapter.ts';

/**
 * Oldest runtime that serves `/v1/systemone`.
 *
 * Baked in from the dialect's own contract, not from "whatever was current":
 * a runtime below this floor answers the version route but 404s the decision
 * route, which is the exact failure that made C-566 unable to measure anything.
 */
export const SYSTEM_ONE_MIN_RUNTIME_VERSION = '0.35.0';

/**
 * Capability tokens that mean "this checkpoint can score closed choices".
 *
 * Matched case-insensitively as substrings, because runtimes disagree on
 * spelling (`systemone`, `decision`, `score`). This is a *filter for an
 * advertised list*, never a positive claim: an unlisted checkpoint is not
 * promoted to ready by matching one of these.
 */
export const DECISION_SCORING_CAPABILITY_TOKENS = ['systemone', 'decision', 'score'] as const;

/** One entry as reported by a model-listing route. */
export type SystemOneListedModel = {
  /** Model identity as the runtime spells it, e.g. `nimble:latest`. */
  readonly name: string;
  /** Capabilities the runtime advertises, when it advertises any. */
  readonly capabilities?: readonly string[];
  /** Present on `/api/tags`, absent on `/v1/models`. */
  readonly family?: string;
};

/** The subset of readiness states a dialect probe can report as a failure. */
export type SystemOneProbeFailureState =
  | 'unsupported-runtime'
  | 'model-missing'
  | 'capability-missing'
  | 'unreachable'
  | 'unauthorized'
  | 'deadline-exceeded'
  | 'cancelled';

/** The failure half of a probe result, before it is returned. */
export type SystemOneProbeFailure = {
  readonly state: SystemOneProbeFailureState;
  readonly reason: string;
  /** Runtime version, when it was learned before the failure. */
  readonly runtime?: string;
};

/** Outcome of the dialect-level probe. */
export type SystemOneProbeResult =
  | {
      readonly ok: true;
      /** Version string exactly as the runtime reported it. */
      readonly runtime: string;
      /** The listing entry that matched the requested checkpoint. */
      readonly listed: SystemOneListedModel;
      /** True only when the runtime advertised a capability list that matched. */
      readonly scoringDeclared: boolean;
    }
  | {
      readonly ok: false;
      readonly state: SystemOneProbeFailureState;
      readonly reason: string;
      /** Runtime version, when it was learned before the failure. */
      readonly runtime?: string;
    };

/**
 * Compares two dotted version strings.
 *
 * Returns <0, 0 or >0. Non-numeric segments compare as 0, so `0.35.0-rc1` and
 * `0.35.0` compare equal rather than one of them sorting unpredictably. Returns
 * `undefined` when a side cannot be parsed, because "I could not tell" and
 * "they are the same" must not be the same answer.
 */
export const compareDottedVersions = (a: string, b: string): number | undefined => {
  const parse = (value: string): number[] | undefined => {
    const trimmed = value.trim().replace(/^v/i, '');
    if (!/^\d+(\.\d+)*/.test(trimmed)) {
      return undefined;
    }
    return trimmed.split('.').map((segment) => Number.parseInt(segment, 10));
  };
  const left = parse(a);
  const right = parse(b);
  if (left === undefined || right === undefined) {
    return undefined;
  }
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  return 0;
};

/**
 * Normalises a model identity for comparison.
 *
 * `nimble`, `nimble:latest` and `NIMBLE` are the same checkpoint; runtimes
 * differ on the tag and the case, and a mismatch here would report a present
 * model as missing.
 */
export const normalizeModelName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/:latest$/, '');

/**
 * Parses a model listing body.
 *
 * Accepts both shapes the dialect is served behind: OpenAI-compatible
 * `{ data: [{ id }] }` and Ollama's `{ models: [{ name, capabilities }] }`. An
 * unrecognised body yields an empty list rather than a thrown error — a runtime
 * that changes its listing shape must not crash a readiness check.
 */
/** Parses one listing entry, or returns undefined when it is unusable. */
const parseListedEntry = (entry: unknown): SystemOneListedModel | undefined => {
  if (typeof entry !== 'object' || entry === null) {
    return undefined;
  }
  const item = entry as Record<string, unknown>;
  const name = typeof item.name === 'string' ? item.name : item.id;
  if (typeof name !== 'string') {
    return undefined;
  }
  const capabilities = Array.isArray(item.capabilities)
    ? item.capabilities.filter((value): value is string => typeof value === 'string')
    : undefined;
  return {
    name,
    ...(capabilities === undefined ? {} : { capabilities }),
    ...(typeof item.family === 'string' ? { family: item.family } : {}),
  };
};

/** Reads the entry array out of either supported listing shape. */
const listingEntries = (record: Record<string, unknown>): unknown[] => {
  if (Array.isArray(record.models)) {
    return record.models;
  }
  if (Array.isArray(record.data)) {
    return record.data;
  }
  return [];
};

/**
 * Parses a model listing body.
 *
 * Accepts both shapes the dialect is served behind: OpenAI-compatible
 * `{ data: [{ id }] }` and Ollama's `{ models: [{ name, capabilities }] }`. An
 * unrecognised body yields an empty list rather than a thrown error — a runtime
 * that changes its listing shape must not crash a readiness check.
 */
export const parseModelListing = (body: unknown): readonly SystemOneListedModel[] => {
  if (typeof body !== 'object' || body === null) {
    return [];
  }
  return listingEntries(body as Record<string, unknown>)
    .map(parseListedEntry)
    .filter((entry): entry is SystemOneListedModel => entry !== undefined);
};

/** Whether an advertised capability list mentions decision scoring. */
export const declaresScoring = (capabilities: readonly string[] | undefined): boolean => {
  if (capabilities === undefined || capabilities.length === 0) {
    return false;
  }
  return capabilities.some((capability) =>
    DECISION_SCORING_CAPABILITY_TOKENS.some((token) => capability.toLowerCase().includes(token)),
  );
};

/** Read timeout for each sub-probe, in ms. */
export type SystemOneProbeOptions = {
  readonly transport: SystemOneTransport;
  readonly endpoints: SystemOneEndpoints;
  /** Checkpoint to require. */
  readonly model: string;
  /** Total budget across both probes, in ms. */
  readonly budgetMs: number;
  readonly signal: AbortSignal;
  /**
   * Resolved per sub-probe so a vault-backed credential is never captured in a
   * closure at adapter-construction time and never travels in an argument.
   */
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

/** Maps a transport error kind onto the readiness state it means. */
const stateForProbeError = (
  error: 'cancelled' | 'deadline-exceeded' | 'failed',
): SystemOneProbeFailureState => {
  if (error === 'cancelled') {
    return 'cancelled';
  }
  if (error === 'deadline-exceeded') {
    return 'deadline-exceeded';
  }
  return 'unreachable';
};

/** Runs one GET under the remaining budget and the caller's cancellation. */
const get = async (
  options: SystemOneProbeOptions,
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.budgetMs);
  const onAbort = (): void => controller.abort();
  options.signal.addEventListener('abort', onAbort, { once: true });
  try {
    const headers = options.authHeaders === undefined ? {} : await options.authHeaders();
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
 * Probes the `jev-v1` dialect readiness of one endpoint.
 *
 * Order matters: version floor first, because a runtime below it cannot serve
 * the dialect no matter what else is true, and reporting `model-missing` to
 * someone whose runtime is three releases too old would send them to install a
 * model that would still not work.
 *
 * When no listing route is configured the checkpoint check is skipped and the
 * version check stands alone: the sample decision in `readiness.ts` remains the
 * authority on whether the checkpoint can actually answer.
 */
/** Reads the runtime version string out of a version-route body. */
const readRuntimeVersion = (body: unknown): string =>
  typeof (body as { version?: unknown } | undefined)?.version === 'string'
    ? (body as { version: string }).version
    : 'unknown';

/**
 * Stage 1 — the runtime version.
 *
 * Order matters: a runtime below the dialect floor cannot serve it whatever
 * else is true, and reporting `model-missing` to someone whose runtime is
 * three releases too old would send them to install a model that still would
 * not work.
 */
const probeRuntimeVersion = async (
  options: SystemOneProbeOptions,
): Promise<
  | { ok: true; runtime: string }
  | { ok: false; failure: SystemOneProbeFailure & { runtime?: string } }
> => {
  const versionEndpoint = options.endpoints.version;
  if (versionEndpoint === undefined) {
    return {
      ok: false,
      failure: {
        state: 'unreachable',
        reason: 'no runtime version endpoint was configured for this Ollama backend',
      },
    };
  }
  const response = await get(options, versionEndpoint);
  if ('error' in response) {
    return {
      ok: false,
      failure: {
        state: stateForProbeError(response.error),
        reason: `runtime version probe ${response.error}: ${response.detail}`,
      },
    };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      failure: {
        state: 'unauthorized',
        reason: `runtime version probe returned HTTP ${response.status}`,
      },
    };
  }
  if (response.status !== 200) {
    return {
      ok: false,
      failure: {
        state: 'unreachable',
        reason: `runtime version probe returned HTTP ${response.status}`,
      },
    };
  }

  const runtime = readRuntimeVersion(response.body);
  const order = compareDottedVersions(runtime, SYSTEM_ONE_MIN_RUNTIME_VERSION);
  if (order === undefined) {
    return {
      ok: false,
      failure: {
        state: 'unsupported-runtime',
        reason: `runtime reported an unreadable version ("${runtime}"); ${SYSTEM_ONE_MIN_RUNTIME_VERSION} or later is required`,
        runtime,
      },
    };
  }
  if (order < 0) {
    return {
      ok: false,
      failure: {
        state: 'unsupported-runtime',
        reason: `runtime ${runtime} is older than the ${SYSTEM_ONE_MIN_RUNTIME_VERSION} floor required by /v1/systemone`,
        runtime,
      },
    };
  }
  return { ok: true, runtime };
};

/** Stage 2 — the checkpoint, when a listing route is configured. */
const probeCheckpoint = async (
  options: SystemOneProbeOptions,
  runtime: string,
): Promise<
  | { ok: true; listed: SystemOneListedModel; scoringDeclared: boolean }
  | { ok: false; failure: SystemOneProbeFailure & { runtime?: string } }
> => {
  if (options.endpoints.models === undefined) {
    // No listing route configured: the sample decision in `readiness.ts`
    // remains the authority on whether the checkpoint can answer.
    return { ok: true, listed: { name: options.model }, scoringDeclared: false };
  }

  const listing = await get(options, options.endpoints.models);
  if ('error' in listing) {
    // A listing route that cannot be read is not a readiness fact about the
    // checkpoint. Say so rather than reporting the model missing.
    return {
      ok: false,
      failure: {
        state: stateForProbeError(listing.error),
        reason: `model listing ${listing.error}: ${listing.detail}`,
        runtime,
      },
    };
  }
  if (listing.status !== 200) {
    return {
      ok: false,
      failure: {
        state: 'unreachable',
        reason: `model listing returned HTTP ${listing.status}`,
        runtime,
      },
    };
  }

  const models = parseModelListing(listing.body);
  const wanted = normalizeModelName(options.model);
  const match = models.find((entry) => normalizeModelName(entry.name) === wanted);
  if (match === undefined) {
    return {
      ok: false,
      failure: {
        state: 'model-missing',
        reason: `checkpoint "${options.model}" is not installed; the runtime lists ${models.length} model(s)`,
        runtime,
      },
    };
  }
  if (match.capabilities !== undefined && !declaresScoring(match.capabilities)) {
    return {
      ok: false,
      failure: {
        state: 'capability-missing',
        reason: `checkpoint "${match.name}" advertises [${match.capabilities.join(', ')}], none of which is decision scoring`,
        runtime,
      },
    };
  }
  return { ok: true, listed: match, scoringDeclared: declaresScoring(match.capabilities) };
};

/**
 * Probes the `jev-v1` dialect readiness of one endpoint.
 *
 * Two stages, each independently readable: the runtime version floor, then the
 * checkpoint. Both are learned from the endpoint at call time. Nothing here is
 * taken from a README, and nothing is assumed to work because a port is bound.
 *
 * This still does NOT prove the checkpoint can answer — only a sample decision
 * does, and `probeDecisionBackend` owns that.
 */
export const probeSystemOneBackend = async (
  options: SystemOneProbeOptions,
): Promise<SystemOneProbeResult> => {
  const deadlineAt = performance.now() + options.budgetMs;
  const remainingOptions = (): SystemOneProbeOptions => ({
    ...options,
    budgetMs: Math.max(0, deadlineAt - performance.now()),
  });
  const version = await probeRuntimeVersion(remainingOptions());
  if (!version.ok) {
    return { ok: false, ...version.failure };
  }
  const checkpoint = await probeCheckpoint(remainingOptions(), version.runtime);
  if (!checkpoint.ok) {
    return { ok: false, ...checkpoint.failure };
  }
  return {
    ok: true,
    runtime: version.runtime,
    listed: checkpoint.listed,
    scoringDeclared: checkpoint.scoringDeclared,
  };
};
