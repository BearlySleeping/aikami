// apps/frontend/client/src/lib/services/config/decision_backend_resolution.ts
//
// What a saved decision backend resolves to, and how (issue #381).
//
// Split out of `config_service.svelte.ts` for two reasons: the shape is a domain
// type that belongs beside the schemas it comes from rather than inside a
// 1,600-line service, and the resolution is a pure function of the saved state,
// which makes it testable without the service, the vault or a storage backend.
//
// Resolving a decision backend is deliberately NOT the same operation as
// resolving a text provider. A decision checkpoint answers closed questions and
// cannot generate prose; a chat model cannot score them. Both refusals below are
// load-bearing: without them a `decisions` role could be pointed at a surviving
// chat connection and the player would be told a decision backend exists.

import type {
  AiConnection,
  AiProvider,
  ConfigState,
  DecisionGameplayMode,
  DecisionRuntime,
} from '@aikami/types';

/**
 * A configured decision backend, resolved but NOT routed.
 *
 * Carrying the credential here is deliberate and is the only place a decision
 * credential is read: it is handed straight to the adapter's auth callback and
 * never written into a log, an artifact or a readiness reason.
 */
export type ResolvedDecisionBackend = {
  /** Connection id, for provenance and cache identity. */
  readonly connectionId: string;
  /** Provider registry id (ollama | llamacpp | jev-external | jev-hosted). */
  readonly registryId: string;
  /** Endpoint base URL, never with credentials embedded. */
  readonly endpoint: string;
  /** Checkpoint identity, reported verbatim by the adapter. */
  readonly checkpoint: string;
  /** Which runtime probe is legitimate. */
  readonly runtime: DecisionRuntime;
  /** Languages the checkpoint declares; anything else must abstain. */
  readonly languages: readonly ('en' | 'multi')[];
  /** Vault-held credential, when the endpoint needs one. */
  readonly credential?: string;
  /**
   * Whether the player opted this backend into automatic tasks.
   *
   * A master switch only. It can narrow the evidence below; it can never stand
   * in for it.
   */
  readonly qualifiedForGameplay: boolean;
  /**
   * Persisted Off/Shadow/On. Defaults to `off`.
   *
   * Read from the connection rather than held in a service, because a mode that
   * lives only in memory is lost on reload — and a decision path whose mode
   * silently reverts is a rollback nobody can rely on.
   */
  readonly gameplayMode: DecisionGameplayMode;

  /**
   * The measured qualification, if one has been recorded.
   *
   * Undefined means no shipped measurement cleared the gate for this
   * checkpoint, and automatic routing must be refused. It is carried through so
   * the consumer can compare all four of task, task version, dialect and
   * checkpoint against what it supports NOW.
   */
  readonly qualification?: {
    readonly taskId: string;
    readonly taskVersion: number;
    readonly dialect: string;
    readonly checkpoint: string;
    readonly measuredAt?: string;
    readonly runId?: string;
  };
};

/** The narrow shape this resolution reads. */
type DecisionConfigState = Pick<ConfigState, 'roles' | 'providers' | 'aiConnections'>;

/** Whether a connection's params really are decision params. */
const isDecisionParams = (
  params: AiConnection['params'],
): params is Extract<AiConnection['params'], { runtime: DecisionRuntime }> =>
  'runtime' in params && 'checkpoint' in params;

/** The recorded qualification, when the connection carries a well-formed one. */
const qualificationOf = (
  params: Extract<AiConnection['params'], { runtime: DecisionRuntime }>,
): ResolvedDecisionBackend['qualification'] => {
  const evidence = params.qualification;
  if (evidence === undefined) {
    return undefined;
  }
  return {
    taskId: evidence.taskId,
    taskVersion: evidence.taskVersion,
    dialect: evidence.dialect,
    checkpoint: evidence.checkpoint,
    ...(evidence.measuredAt === undefined ? {} : { measuredAt: evidence.measuredAt }),
    ...(evidence.runId === undefined ? {} : { runId: evidence.runId }),
  };
};

/** The provider a decision connection points at, when it has one. */
const providerFor = (
  providers: readonly AiProvider[],
  connection: AiConnection,
): AiProvider | undefined => providers.find((candidate) => candidate.id === connection.providerId);

/**
 * The backend the `decisions` role resolves to, or undefined.
 *
 * Every early return is a refusal a player can act on: no role assigned, a role
 * pointing at the wrong capability, params that are not decision params, or a
 * provider with no endpoint.
 */
export const resolveDecision = (
  state: DecisionConfigState,
): ResolvedDecisionBackend | undefined => {
  const connectionId = state.roles.decisions;
  if (connectionId === undefined) {
    return undefined;
  }
  const connection = state.aiConnections.find((candidate) => candidate.id === connectionId);
  if (connection === undefined || connection.capability !== 'decision') {
    return undefined;
  }
  if (!isDecisionParams(connection.params)) {
    return undefined;
  }
  const provider = providerFor(state.providers, connection);
  if (provider === undefined || provider.baseUrl === undefined) {
    return undefined;
  }
  return {
    connectionId: connection.id,
    registryId: provider.registryId,
    endpoint: provider.baseUrl,
    checkpoint: connection.params.checkpoint,
    runtime: connection.params.runtime,
    languages: connection.params.languages ?? ['en'],
    ...(provider.credential === undefined ? {} : { credential: provider.credential }),
    qualifiedForGameplay: connection.params.qualifiedForGameplay === true,
    // Absent means `off`: a connection saved before this field existed must not
    // start dispatching decisions because a newer build added a mode field.
    gameplayMode: connection.params.gameplayMode ?? 'off',
    ...(qualificationOf(connection.params) === undefined
      ? {}
      : { qualification: qualificationOf(connection.params) }),
  };
};

/**
 * Writes a mode onto a decision connection's params.
 *
 * Only `gameplayMode` is written — re-sending the whole `params` object would
 * let a stale caller that read `params` once clobber a `qualification` record it
 * never looked at, silently un-qualifying a backend that had qualified.
 */
const withGameplayMode = (
  params: Extract<AiConnection['params'], { runtime: DecisionRuntime }>,
  mode: DecisionGameplayMode,
): Extract<AiConnection['params'], { runtime: DecisionRuntime }> => ({
  ...params,
  gameplayMode: mode,
});

/**
 * The decision connection's params with `gameplayMode` set, or undefined when
 * there is no decision connection to write to.
 *
 * Separate from the write itself so the 1600-line config service can delegate
 * in one line: a missing connection, a non-decision connection, or a connection
 * without decision params all mean the same thing — there is nothing to persist
 * the mode on.
 */
const decisionParamsWithMode = (
  state: DecisionConfigState,
  mode: DecisionGameplayMode,
):
  | {
      readonly id: string;
      readonly params: Extract<AiConnection['params'], { runtime: DecisionRuntime }>;
    }
  | undefined => {
  const backend = resolveDecision(state);
  if (backend === undefined) {
    return undefined;
  }
  const connection = state.aiConnections.find((candidate) => candidate.id === backend.connectionId);
  if (connection === undefined || connection.capability !== 'decision') {
    return undefined;
  }
  return {
    id: connection.id,
    params: withGameplayMode(
      connection.params as Extract<AiConnection['params'], { runtime: DecisionRuntime }>,
      mode,
    ),
  };
};

/**
 * Applies a mode through an injected writer.
 *
 * The writer is injected so this stays a pure decision about WHICH connection
 * and WHAT params, leaving the 1600-line config service free of the lookup. It
 * is also what makes the function testable without a service instance.
 */
export const applyDecisionGameplayMode = (
  state: DecisionConfigState,
  mode: DecisionGameplayMode,
  write: (
    id: string,
    params: Extract<AiConnection['params'], { runtime: DecisionRuntime }>,
  ) => void,
): boolean => {
  const target = decisionParamsWithMode(state, mode);
  if (target === undefined) {
    return false;
  }
  write(target.id, target.params);
  return true;
};
