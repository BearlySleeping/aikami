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

import type { AiConnection, AiProvider, ConfigState, DecisionRuntime } from '@aikami/types';

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
  /** Provider registry id (ollama | jev-external | jev-hosted). */
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
   * Whether this backend was marked qualified for automatic gameplay.
   *
   * Recorded, and NOTHING reads it for routing in this release: workload
   * qualification is a separate gate that stays closed. It exists so a player
   * can see the flag and a later qualified consumer can honour it.
   */
  readonly qualifiedForGameplay: boolean;
};

/** The narrow shape this resolution reads. */
type DecisionConfigState = Pick<ConfigState, 'roles' | 'providers' | 'aiConnections'>;

/** Whether a connection's params really are decision params. */
const isDecisionParams = (
  params: AiConnection['params'],
): params is Extract<AiConnection['params'], { runtime: DecisionRuntime }> =>
  'runtime' in params && 'checkpoint' in params;

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
  };
};
