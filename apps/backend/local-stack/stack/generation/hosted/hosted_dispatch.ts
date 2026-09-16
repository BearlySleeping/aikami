// apps/backend/local-stack/stack/generation/hosted/hosted_dispatch.ts
//
// C-524: the host's hosted-dispatch front door.
//
// Two seams, deliberately separate:
//
//   * the *availability resolver* answers "may this hosted profile be dialled
//     on this host at all?" from the adapter flag and the credential handle.
//     It is passed to the portable planner, which turns a `no` into a typed
//     `provider_unavailable` blocker *before* the budget ceiling is checked —
//     so a clean environment reports the real missing precondition rather than
//     a budget it also happens to exceed;
//   * the *engine factory* builds the dispatchable engine for an item whose
//     plan item already resolved to a hosted transport.
//
// 🔴 Both read the credential from the process environment. Neither writes it
// anywhere. `hostedCredentialReference` is what reaches a record.
//
// Contract: C-524 Optional hosted asset provider comparison

import type { GenerationHostedOperation, GenerationProviderProfile } from '@aikami/constants';
import {
  hostedOperationsForProfile,
  hostedTransportForProfile,
  resolveHostedPreconditions,
} from '@aikami/local-ai';
import type { GenerationEngineClient, HostedUnavailability } from '@aikami/types';
import {
  type HostedEnvironment,
  hostedCredentialReference,
  resolveEnabledHostedTransports,
  resolveHostedCredential,
} from './hosted_credentials.ts';
import { createHostedGenerationEngine } from './hosted_engine.ts';
import { createFetchHostedTransport, type HostedTransport } from './hosted_transport.ts';

/**
 * The hosted preconditions resolver the CLI hands to the portable planner.
 *
 * Returning `undefined` for a non-hosted profile is deliberate: the resolver
 * has no opinion about local profiles, and the planner only calls it for
 * hosted ones anyway.
 */
export const buildHostedAvailabilityResolver =
  (options: {
    env: HostedEnvironment;
    /**
     * The ceiling the run actually resolved (the brief's `execution` value,
     * plus any documented CLI override).
     *
     * 🔴 Passed so a *declared* ceiling — including a declared zero — is left
     * to the budget authority, which reports `budget_exceeded` naming
     * `hostedBudgetUsd`. Only a caller that genuinely knows no ceiling omits
     * it, and then the refusal is `budget_not_configured`.
     */
    hostedBudgetUsd?: number;
  }) =>
  (input: { profile: GenerationProviderProfile }): HostedUnavailability | undefined => {
    const transport = hostedTransportForProfile(input.profile);
    if (transport === undefined) {
      return undefined;
    }
    return resolveHostedPreconditions({
      profile: input.profile,
      enabledTransports: resolveEnabledHostedTransports(options.env),
      ...(hostedCredentialReference({ transport, env: options.env }) === undefined
        ? {}
        : { credentialReference: hostedCredentialReference({ transport, env: options.env }) }),
      ...(options.hostedBudgetUsd === undefined
        ? {}
        : { hostedBudgetUsd: options.hostedBudgetUsd }),
      requiredOperations: hostedOperationsForProfile(input.profile),
    });
  };

/**
 * Builds the hosted engine for a profile, when every precondition holds.
 *
 * @returns `undefined` when the profile is not hosted, the adapter is not
 *          enabled, or no credential resolves — the runner then reports a
 *          structured `provider_unavailable` blocker and makes no call.
 */
export const createHostedEngineForProfile = (options: {
  profile: GenerationProviderProfile;
  env: HostedEnvironment;
  /** Requested operation for this item; falls back to the transport declaration. */
  operation?: GenerationHostedOperation;
  /** Injected in tests so a stub transport can count outbound calls. */
  transport?: HostedTransport;
}): GenerationEngineClient | undefined => {
  const transportId = hostedTransportForProfile(options.profile);
  if (transportId === undefined) {
    return undefined;
  }
  if (!resolveEnabledHostedTransports(options.env).includes(transportId)) {
    return undefined;
  }
  const credential = resolveHostedCredential({ transport: transportId, env: options.env });
  if (credential.state !== 'resolved') {
    return undefined;
  }
  const operation = options.operation ?? hostedOperationsForProfile(options.profile)[0];
  if (operation === undefined) {
    return undefined;
  }
  return createHostedGenerationEngine({
    profile: options.profile,
    credential: credential.value,
    transport: options.transport ?? createFetchHostedTransport(),
    operation,
  });
};
