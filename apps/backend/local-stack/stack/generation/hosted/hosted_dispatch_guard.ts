// apps/backend/local-stack/stack/generation/hosted/hosted_dispatch_guard.ts
//
// C-524: the reserve-before-dispatch / settle-after guard the *production
// runner* calls for every hosted item.
//
// 🔴 This module exists because a plan-time refusal is not a dispatch-time
// guard. `enforceGenerationBudget` runs in the portable plan, where two
// processes can both pass the same ceiling check before either writes
// anything. The guard re-asserts the reservation under the job store's
// exclusive lock immediately before the outbound request, and settles it
// afterwards — so a second process either finds the existing reservation (the
// same request key) or is refused, and in neither case makes a second billable
// call.
//
// It is separate from `runner.ts` for the same reason `runner_reports.ts` is:
// the item loop stays about policy, and the write/settle plumbing lives here.
//
// Contract: C-524 Optional hosted asset provider comparison

import { GENERATION_BATCH_EXIT_CODES, GENERATION_PROVIDER_PROFILES } from '@aikami/constants';
import {
  buildHostedPreflightQuote,
  type GenerationRunProgress,
  type HostedSettlementOutcome,
  hostedTransportForProfile,
  isReservationUnsettled,
  unsettledReservationBlocker,
} from '@aikami/local-ai';
import type {
  CostReservation,
  GenerationBudget,
  GenerationPlanBlocker,
  GenerationPlanItem,
} from '@aikami/types';
import type { GenerationStorePaths } from '../job_store.ts';
import { looksLikeUncertainRequest } from '../runner_reports.ts';
import {
  type HostedDispatchReservation,
  reserveHostedDispatch,
  settleHostedDispatch,
} from './hosted_reservations.ts';

/** What the runner should do about a hosted item's money, before dispatch. */
export type HostedReserveOutcome =
  | { readonly kind: 'not-hosted' }
  | { readonly kind: 'reserved'; readonly reservation: CostReservation }
  | { readonly kind: 'refused'; readonly blocker: GenerationPlanBlocker };

/** The reservation id for one item attempt — deterministic, so a retry reuses it. */
export const hostedReservationIdFor = (jobId: string): string => `hosted:${jobId}`;

/**
 * Reserves a hosted item's quoted ceiling, atomically, immediately before the
 * outbound request.
 *
 * A non-hosted item is untouched (`not-hosted`) — the guard has no opinion
 * about a local dispatch.
 */
export const reserveHostedItem = async (options: {
  paths: GenerationStorePaths;
  item: GenerationPlanItem;
  budget: GenerationBudget;
  progress: GenerationRunProgress;
  at: string;
}): Promise<HostedReserveOutcome> => {
  const profile = GENERATION_PROVIDER_PROFILES[options.item.providerProfileId];
  if (profile === undefined || hostedTransportForProfile(profile) === undefined) {
    return { kind: 'not-hosted' };
  }

  const quoted = buildHostedPreflightQuote({
    profile,
    items: [
      {
        itemId: options.item.itemId,
        jobId: options.item.jobId,
        candidateCount: options.item.candidateLimit,
        maximumDurationSeconds: options.item.estimatedDurationSeconds,
      },
    ],
    generatedAt: options.at,
  });
  if (quoted.kind === 'refused') {
    return {
      kind: 'refused',
      blocker: {
        code: 'provider_unavailable',
        itemId: options.item.itemId,
        providerProfileId: profile.id,
        message: quoted.unavailability.message,
        unavailability: quoted.unavailability,
      },
    };
  }

  const reserved: HostedDispatchReservation = await reserveHostedDispatch({
    paths: options.paths,
    quote: quoted.quote,
    reservationId: hostedReservationIdFor(options.item.jobId),
    jobId: options.item.jobId,
    requestKey: options.item.requestKey,
    budget: options.budget,
    progress: options.progress,
    itemId: options.item.itemId,
    itemCandidateLimit: options.item.candidateLimit,
    attempt: options.item.attempt,
    at: options.at,
  });

  if (reserved.kind === 'reserved') {
    return reserved;
  }
  if (reserved.kind === 'refused') {
    return reserved;
  }

  // The request key already has a reservation: this submission must not be
  // billed twice. An unresolved one requires reconciliation; a settled one is
  // reported as already claimed.
  const existing = reserved.reservation;
  if (isReservationUnsettled(existing)) {
    return {
      kind: 'refused',
      blocker: unsettledReservationBlocker({
        reservation: existing,
        itemId: options.item.itemId,
      }),
    };
  }
  return {
    kind: 'refused',
    blocker: {
      code: 'job_already_claimed',
      itemId: options.item.itemId,
      providerProfileId: existing.providerProfileId,
      message: `Request key "${options.item.requestKey}" already has the settled cost reservation ${existing.reservationId} (${existing.settledUsd ?? 0} ${existing.currency}) — refusing to make a second billable provider call for it.`,
    },
  };
};

/** How a hosted dispatch ended, from the money's point of view. */
export type HostedDispatchOutcome = 'completed' | 'no-charge' | 'unknown';

/**
 * Maps a dispatch outcome plus the provider's own metadata onto the settlement
 * the reservation records.
 *
 * A completed request whose provider reported no usage counter settles at the
 * held ceiling with a stated note — a maximum, not an invoice — rather than
 * inventing a charge or leaving a finished candidate unresolved.
 */
const settlementOutcomeFor = (options: {
  outcome: HostedDispatchOutcome;
  reason?: string;
  engineMetadata?: Readonly<Record<string, string | number>>;
}): HostedSettlementOutcome => {
  if (options.outcome === 'unknown') {
    return {
      kind: 'unknown',
      reason:
        options.reason ??
        'The provider request left this process without a reported billable outcome.',
    };
  }
  if (options.outcome === 'no-charge') {
    return { kind: 'no-charge' };
  }
  const reported = options.engineMetadata?.['hosted.actualUsd'];
  return typeof reported === 'number' && Number.isFinite(reported)
    ? { kind: 'reported', actualUsd: reported }
    : { kind: 'no-usage-counter' };
};

/**
 * Settles a hosted reservation against what the provider actually reported.
 *
 * 🔴 `unknown` leaves the reservation unresolved and auditable — the caller
 * must then hold the job at `job_reconciliation_required` rather than retry.
 */
export const settleHostedItem = async (options: {
  paths: GenerationStorePaths;
  reservation: CostReservation;
  outcome: HostedDispatchOutcome;
  reason?: string;
  /** The engine's flat metadata, when the dispatch produced one. */
  engineMetadata?: Readonly<Record<string, string | number>>;
  at: string;
}): Promise<CostReservation> =>
  settleHostedDispatch({
    paths: options.paths,
    reservation: options.reservation,
    outcome: settlementOutcomeFor(options),
    at: options.at,
  });

/**
 * The documented exit code a hosted refusal maps to.
 *
 * A budget refusal is deliberately distinct from a job-state conflict: an LLM
 * or script caller must be able to tell "raise the ceiling" from "reconcile the
 * unresolved spend".
 */
export const hostedRefusalExitCode = (blocker: GenerationPlanBlocker): number => {
  if (blocker.code === 'budget_exceeded') {
    return GENERATION_BATCH_EXIT_CODES.BUDGET_REFUSED;
  }
  if (blocker.code === 'job_reconciliation_required' || blocker.code === 'job_already_claimed') {
    return GENERATION_BATCH_EXIT_CODES.CLAIM_CONFLICT;
  }
  return GENERATION_BATCH_EXIT_CODES.BLOCKED_PLAN;
};

/** A dispatch that was guarded (and, for a hosted item, reserved and settled). */
export type HostedGuardedDispatch<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | {
      readonly kind: 'refused';
      readonly blocker: GenerationPlanBlocker;
      readonly status: 'failed' | 'reconciliation_required';
      readonly exitCode: number;
    };

/**
 * Reserves, dispatches and settles one item — the production runner's hosted
 * money boundary.
 *
 * 🔴 The reservation is written before `dispatch()` is called and settled after
 * it returns or throws. A throw whose message looks like a request that left
 * the process without a native handle settles as `unknown`, which is what keeps
 * the job at `reconciliation_required` instead of retrying a possibly-billed
 * request. The error is re-thrown so the runner's own failure classification
 * still records it.
 *
 * A non-hosted item is passed straight through: the guard has no opinion about
 * a local dispatch.
 */
export const withHostedReservation = async <T>(options: {
  paths: GenerationStorePaths;
  item: GenerationPlanItem;
  budget: GenerationBudget;
  progress: GenerationRunProgress;
  at: string;
  dispatch: () => Promise<T>;
  /** Reads the engine's flat metadata off the dispatch's value. */
  engineMetadataOf?: (value: T) => Readonly<Record<string, string | number>> | undefined;
}): Promise<HostedGuardedDispatch<T>> => {
  const reserved = await reserveHostedItem({
    paths: options.paths,
    item: options.item,
    budget: options.budget,
    progress: options.progress,
    at: options.at,
  });
  if (reserved.kind === 'not-hosted') {
    return { kind: 'ok', value: await options.dispatch() };
  }
  if (reserved.kind === 'refused') {
    return {
      kind: 'refused',
      blocker: reserved.blocker,
      status:
        reserved.blocker.code === 'job_reconciliation_required'
          ? 'reconciliation_required'
          : 'failed',
      exitCode: hostedRefusalExitCode(reserved.blocker),
    };
  }

  const reservation = reserved.reservation;
  try {
    const value = await options.dispatch();
    const metadata = options.engineMetadataOf?.(value);
    await settleHostedItem({
      paths: options.paths,
      reservation,
      outcome: 'completed',
      ...(metadata === undefined ? {} : { engineMetadata: metadata }),
      at: options.at,
    });
    return { kind: 'ok', value };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await settleHostedItem({
      paths: options.paths,
      reservation,
      outcome: looksLikeUncertainRequest(message) ? 'unknown' : 'no-charge',
      reason: message,
      at: options.at,
    });
    throw error;
  }
};
