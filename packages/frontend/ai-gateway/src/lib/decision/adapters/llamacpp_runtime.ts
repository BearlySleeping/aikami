// packages/frontend/ai-gateway/src/lib/decision/adapters/llamacpp_runtime.ts
//
// The runtime half of the native llama.cpp adapter: `/props`, `/health`, and
// what they can and cannot prove (issue #381).
//
// Split out of `llamacpp_adapter.ts` because readiness and dispatch are
// different jobs with different failure vocabularies. Collapsing them produced
// one 890-line module whose "can this endpoint answer?" and "what did it answer?"
// paths shared every branch, which is exactly the shape that makes a 501 look
// like an outage.
//
// What this module asserts, and what it deliberately does not:
//
//   * `/props.build_info` is the string `"b<build>-<commit>"` — measured, not
//     assumed. It is the only field that makes "does this build contain the
//     endpoint" checkable.
//   * `/props.model_path` is a FILESYSTEM PATH. It is compared to the
//     configured checkpoint on its basename, because the player types a name and
//     the server reports where the file is.
//   * `/props.is_sleeping` means the weights are RELEASED. "A model is loaded"
//     and "the weights are resident" are different facts, and reporting
//     verified-warm during sleep would put a cold sample into a warm percentile.
//   * `/health` answering 503 means the model is still loading — a real, distinct
//     state the settings UI must show rather than hide behind "unreachable".

import type { DecisionCapability } from '../types.ts';
// These live here, not in `llamacpp_adapter.ts`, because the runtime half needs
// them and the adapter needs the runtime: importing them from the adapter
// while the adapter imports this module closes a cycle, and a cycle between a
// type and a parser is exactly how a module ends up half-initialised.
// `llamacpp_adapter.ts` re-exports every one of them, so the package's public
// surface is unchanged.

export type LlamaCppTransport = {
  fetch(
    input: string,
    init: { method: string; body?: string; headers: Record<string, string>; signal: AbortSignal },
  ): Promise<{ status: number; text(): Promise<string> }>;
};
/**
 * Build identity reported by `GET /props`.
 *
 * `build_commit` is what proves the server actually contains the endpoint.
 * A build string alone ("0.5.0-dev") proves nothing: every build for months has
 * carried a `0.x` dev version, including many predating this route.
 */
export type LlamaCppBuildInfo = {
  readonly version?: string;
  readonly buildCommit?: string;
  readonly buildNumber?: number;
};
/**
 * The `/props` facts this adapter relies on.
 *
 * `modelPath` is the checkpoint the PROCESS was started with. Because native
 * llama.cpp serves exactly the model it was launched with and has no per-request
 * or on-demand unload route, that is strong residency evidence — but it is
 * evidence about the process, so it is reported with the method that produced
 * it rather than as a bare boolean.
 */
export type LlamaCppServerProps = {
  /** Full filesystem path of the checkpoint the server was started with. */
  readonly modelPath?: string;
  /** The `--alias` the operator gave the model, when they set one. */
  readonly modelAlias?: string;
  readonly totalSlots?: number;
  /**
   * llama.cpp's sleep mode. `true` means the weights are released, so a latency
   * measured then is a cold sample and must not be aggregated as warm.
   */
  readonly isSleeping?: boolean;
  readonly build?: LlamaCppBuildInfo;
};
/**
 * Upstream's `build_info`, as `GET /props` actually spells it: the STRING
 * `"b<build_number>-<commit_prefix>"`.
 *
 * Measured against a running server, not assumed. An earlier reading of this
 * file looked for `default_generation_settings.build_info.{version, build_commit,
 * build_number}`, which is not the shape `/props` returns; the consequence was a
 * runtime label with no commit in it on every real server — which is the one
 * field that makes "does this build contain the endpoint" checkable at all.
 */
export const parseLlamaCppBuildInfo = (raw: unknown): LlamaCppBuildInfo | undefined => {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return undefined;
  }
  const trimmed = raw.trim();
  const match = /^b(\d+)-([0-9a-f]{6,40})$/.exec(trimmed);
  if (match === null) {
    // An unrecognised build string is still evidence that a build was recorded.
    return { version: trimmed };
  }
  return {
    buildNumber: Number.parseInt(match[1] as string, 10),
    buildCommit: match[2] as string,
  };
};
/** Reads a llama.cpp server's `GET /props` body. Unparseable yields undefined. */
export const parseServerProps = (body: unknown): LlamaCppServerProps | undefined => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  const build = parseLlamaCppBuildInfo(record.build_info);
  return {
    ...(typeof record.model_path === 'string' ? { modelPath: record.model_path } : {}),
    ...(typeof record.model_alias === 'string' ? { modelAlias: record.model_alias } : {}),
    ...(typeof record.total_slots === 'number' ? { totalSlots: record.total_slots } : {}),
    ...(typeof record.is_sleeping === 'boolean' ? { isSleeping: record.is_sleeping } : {}),
    ...(build === undefined ? {} : { build }),
  };
};

/**
 * JSON parse that never throws.
 *
 * Exported because the adapter reads response bodies through the same rule: a
 * malformed body must become "no body", never a thrown parse that a caller
 * reports as a transport outage.
 */
export const safeJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

/** One GET result, or why there wasn't one. */
export type ProbeResult =
  | { readonly status: number; readonly body: unknown }
  | { readonly error: 'cancelled' | 'deadline-exceeded' | 'failed'; readonly detail: string };

/** Inputs every runtime probe shares. */
export type RuntimeProbeContext = {
  readonly transport: LlamaCppTransport;
  readonly authHeaders?: () => Promise<Readonly<Record<string, string>>>;
};

/** Runs one GET under a budget and the caller's cancellation. */
export const probeGet = async (
  context: RuntimeProbeContext,
  url: string,
  budgetMs: number,
  signal: AbortSignal,
): Promise<ProbeResult> => {
  if (signal.aborted) {
    return { error: 'cancelled', detail: 'cancelled before probe' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  const onAbort = (): void => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const authHeaders = context.authHeaders === undefined ? {} : await context.authHeaders();
    const response = await context.transport.fetch(url, {
      method: 'GET',
      headers: { ...authHeaders },
      signal: controller.signal,
    });
    const body = safeJson(await response.text());
    if (signal.aborted) {
      return { error: 'cancelled', detail: 'cancelled during probe' };
    }
    if (controller.signal.aborted) {
      return { error: 'deadline-exceeded', detail: 'probe budget exhausted' };
    }
    return { status: response.status, body };
  } catch (error) {
    return classifyProbeError({ signal, probeSignal: controller.signal, error });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
};

/** Turns a thrown transport error into the state it means. */
const classifyProbeError = (options: {
  readonly signal: AbortSignal;
  readonly probeSignal: AbortSignal;
  readonly error: unknown;
}): ProbeResult => {
  if (options.signal.aborted) {
    return { error: 'cancelled', detail: 'cancelled during probe' };
  }
  if (options.probeSignal.aborted) {
    return { error: 'deadline-exceeded', detail: 'probe budget exhausted' };
  }
  return {
    error: 'failed',
    detail: options.error instanceof Error ? options.error.message : String(options.error),
  };
};

/** Maps a probe transport error onto the readiness state it means. */
export const probeErrorState = (
  error: 'cancelled' | 'deadline-exceeded' | 'failed',
): NonNullable<DecisionCapability['notReadyState']> => {
  if (error === 'cancelled') {
    return 'cancelled';
  }
  return error === 'deadline-exceeded' ? 'deadline-exceeded' : 'unreachable';
};

/** What a readiness probe learned about the server process. */
export type IdentityProbe =
  | { readonly ok: true; readonly props: LlamaCppServerProps | undefined }
  | {
      readonly ok: false;
      readonly state: NonNullable<DecisionCapability['notReadyState']>;
      readonly reason: string;
    };

/**
 * Reads the server's identity from `/props`.
 *
 * A server that does not serve `/props` is not a refusal: it returns ok with
 * `props: undefined` and the caller falls back to the sample inference, which
 * remains the authority on whether the checkpoint can answer.
 */
export const probeIdentity = async (options: {
  readonly context: RuntimeProbeContext;
  readonly propsUrl: string | undefined;
  readonly budgetMs: number;
  readonly signal: AbortSignal;
}): Promise<IdentityProbe> => {
  if (options.propsUrl === undefined) {
    return { ok: true, props: undefined };
  }
  if (options.budgetMs <= 0) {
    return { ok: false, state: 'deadline-exceeded', reason: 'no probe budget left' };
  }
  const response = await probeGet(
    options.context,
    options.propsUrl,
    options.budgetMs,
    options.signal,
  );
  if ('error' in response) {
    return {
      ok: false,
      state: probeErrorState(response.error),
      reason: `server props ${response.error}: ${response.detail}`,
    };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, state: 'unauthorized', reason: `/props returned HTTP ${response.status}` };
  }
  if (response.status !== 200) {
    return { ok: true, props: undefined };
  }
  return { ok: true, props: parseServerProps(response.body) };
};

/**
 * Checks `/health`.
 *
 * 503 is llama.cpp's "still loading". It is reported as its own reason so the
 * settings UI can say "loading the model" rather than "unreachable", which sends
 * a player to check a port that is perfectly fine.
 */
export const probeHealth = async (options: {
  readonly context: RuntimeProbeContext;
  readonly healthUrl: string | undefined;
  readonly budgetMs: number;
  readonly signal: AbortSignal;
}): Promise<
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly state: NonNullable<DecisionCapability['notReadyState']>;
      readonly reason: string;
    }
> => {
  if (options.healthUrl === undefined || options.budgetMs <= 0) {
    return { ok: true };
  }
  const response = await probeGet(
    options.context,
    options.healthUrl,
    options.budgetMs,
    options.signal,
  );
  if ('error' in response) {
    return {
      ok: false,
      state: probeErrorState(response.error),
      reason: `health ${response.error}: ${response.detail}`,
    };
  }
  if (response.status === 503) {
    return {
      ok: false,
      state: 'unreachable',
      reason: 'the server is still loading its model (HTTP 503 from /health)',
    };
  }
  return { ok: true };
};

/**
 * Residency, from the server process.
 *
 * Native llama.cpp loads exactly one checkpoint at startup and exposes no
 * on-demand unload for it, so `/props.model_path` is direct evidence of what is
 * resident. Reported WITH its method so a harness never has to guess whether the
 * observation came from the runtime or from timing.
 */
export const probeResidency = async (options: {
  readonly context: RuntimeProbeContext;
  readonly propsUrl: string;
  readonly budgetMs: number;
  readonly signal: AbortSignal;
}): Promise<{
  readonly verified: boolean;
  readonly resident?: boolean;
  readonly method: string;
  readonly detail: string;
}> => {
  const response = await probeGet(
    options.context,
    options.propsUrl,
    options.budgetMs,
    options.signal,
  );
  if ('error' in response) {
    return { verified: false, method: 'llamacpp:/props', detail: response.error };
  }
  const props = parseServerProps(response.body);
  if (props?.modelPath === undefined) {
    return { verified: false, method: 'llamacpp:/props', detail: 'no model_path reported' };
  }
  if (props.isSleeping === true) {
    return {
      verified: true,
      resident: false,
      method: 'llamacpp:/props#model_path',
      detail: 'the server is in sleep mode; the checkpoint is loaded but its weights are released',
    };
  }
  return {
    verified: true,
    resident: true,
    method: 'llamacpp:/props#model_path',
    detail: `single-checkpoint server resident with ${props.modelPath}`,
  };
};

/**
 * Turns a decision endpoint into its server root, for sibling routes.
 *
 * Exported because `/props` and `/health` are siblings of `/v1/systemone` on the
 * same server, and deriving the root from the configured decision endpoint means
 * a player who edits one URL does not have to edit three.
 */
export const stripDecisionPath = (endpoint: string): string =>
  endpoint.replace(/\/v1\/systemone\/?$/, '');
