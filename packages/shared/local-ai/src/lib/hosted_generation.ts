// packages/shared/local-ai/src/lib/hosted_generation.ts
//
// C-524: the portable hosted-generation core — the preflight quote, the typed
// unavailability, and the cost reservation/settlement around the *shipped*
// budget authority.
//
// It is pure: no clock, no filesystem, no network, no credential. The host
// supplies the credential, the transport and the store; this module decides
// what may be quoted, what is refused and what a reservation means. That is
// what lets the same rules be replayed in a test with a stub transport that
// counts outbound calls.
//
// Three rules carry the weight:
//
//   1. **There is exactly one budget authority.** `enforceGenerationBudget`
//      decides whether a dispatch is authorized; this module only *wraps* it
//      with a quote and a durable reservation. A second ceiling check here
//      would be a second authority, and the two would eventually disagree.
//   2. **A missing precondition is typed, never zero-cost.** A dispatch with
//      no credential, no adapter flag or no ceiling is a
//      {@link HostedUnavailability} naming what is missing. The billable call
//      count for such a run is exactly 0.
//   3. **An unknown outcome stays unknown.** A request that left the process
//      without a reported charge leaves the reservation `unsettled` and the
//      job at `job_reconciliation_required` — never a silent resubmission.
//
// Contract: C-524 Optional hosted asset provider comparison

import {
  type GenerationHostedOperation,
  type GenerationHostedTransportId,
  type GenerationProviderProfile,
  HOSTED_TRANSPORT_OPERATIONS,
  HOSTED_TRANSPORT_TERMS,
} from '@aikami/constants';
import type {
  CostReservation,
  GenerationBudget,
  GenerationEngineId,
  GenerationPlanBlocker,
  GenerationPlanItem,
  HostedPreflightQuote,
  HostedUnavailability,
} from '@aikami/types';
import { enforceGenerationBudget, type GenerationRunProgress } from './generation_job_state.ts';

/**
 * The blocker code an unresolved reservation resolves to.
 *
 * `job_reconciliation_required` already exists in the shipped vocabulary and
 * means exactly the right thing: the billable outcome is unknown, so no new
 * attempt may be dispatched automatically.
 */
export const HOSTED_UNSETTLED_BLOCKER_CODE = 'job_reconciliation_required';

/** The transport a profile reaches, when it is a hosted profile. */
export const hostedTransportForProfile = (
  profile: GenerationProviderProfile,
): GenerationHostedTransportId | undefined =>
  profile.mode === 'hosted' ? profile.hostedTransport : undefined;

/**
 * The engine id a hosted profile's candidate records.
 *
 * 🔴 The hosted transports are members of `GenerationEngineIdSchema` so a
 * hosted candidate's provenance stays truthful (`engine` is required and
 * closed). This is the only place a hosted profile is turned into an engine
 * id — a local engine id must never label a hosted candidate.
 */
export const hostedEngineIdForProfile = (
  profile: GenerationProviderProfile,
): GenerationEngineId | undefined => hostedTransportForProfile(profile);

/** The operations a hosted profile's transport declares. */
export const hostedOperationsForProfile = (
  profile: GenerationProviderProfile,
): readonly GenerationHostedOperation[] => {
  const transport = hostedTransportForProfile(profile);
  if (transport === undefined) {
    return [];
  }
  return profile.hostedOperations ?? HOSTED_TRANSPORT_OPERATIONS[transport];
};

// ---------------------------------------------------------------------------
// Typed unavailability
// ---------------------------------------------------------------------------

/** Builds one typed unavailability. */
const unavailability = (options: {
  code: HostedUnavailability['code'];
  precondition: string;
  message: string;
  profile: GenerationProviderProfile;
  transport?: GenerationHostedTransportId;
}): HostedUnavailability => ({
  code: options.code,
  precondition: options.precondition,
  message: options.message,
  providerProfileId: options.profile.id,
  ...(options.transport === undefined ? {} : { transport: options.transport }),
});

/**
 * Resolves whether a hosted dispatch has every precondition it needs.
 *
 * 🔴 The check order is documented and stable so the *same* missing
 * precondition is named for the same environment: a profile that is not a
 * hosted profile, then a declared transport/operation the profile cannot
 * honour, then the adapter flag, then the credential, then the recorded rights
 * scope, then (only when no ceiling is known at all) the ceiling. Nothing here reads a credential *value* — the
 * caller passes an opaque reference.
 *
 * @returns `undefined` when the dispatch may proceed, otherwise the typed
 *          reason it may not.
 */
export const resolveHostedPreconditions = (options: {
  profile: GenerationProviderProfile;
  /** Transports this host has explicitly enabled. */
  enabledTransports: readonly GenerationHostedTransportId[];
  /** Opaque host-side credential handle (`env:PIXELLAB_API_KEY`). */
  credentialReference?: string;
  /**
   * The run's declared hosted spend ceiling, when one is known at all.
   *
   * 🔴 A *declared* ceiling of `0` is deliberately NOT this check's business:
   * a zero ceiling is the budget authority's decision, and it reports
   * `budget_exceeded` naming `hostedBudgetUsd`. Reporting it here instead
   * would hide the specific ceiling the creator has to raise. This check fires
   * only when no ceiling is known — a caller with no plan yet.
   */
  hostedBudgetUsd?: number;
  /** Operations this dispatch needs; defaults to the profile's declared set. */
  requiredOperations?: readonly GenerationHostedOperation[];
}): HostedUnavailability | undefined => {
  const { profile } = options;
  const transport = hostedTransportForProfile(profile);
  if (transport === undefined) {
    // Not a hosted profile: this resolver has no opinion about it.
    return undefined;
  }

  const declared = HOSTED_TRANSPORT_OPERATIONS[transport];
  if (!declared || declared.length === 0 || profile.hostedModelId === undefined) {
    return unavailability({
      code: 'capability_unsupported',
      precondition: 'hostedTransportProfile',
      message: `Provider profile "${profile.id}" declares the hosted transport "${transport}" but names no pinned model id, so no request can be built for it.`,
      profile,
      transport,
    });
  }

  const required = options.requiredOperations ?? hostedOperationsForProfile(profile);
  const unsupported = required.filter((operation) => !declared.includes(operation));
  if (unsupported.length > 0) {
    return unavailability({
      code: 'capability_unsupported',
      precondition: `operation:${unsupported.join(',')}`,
      message: `The "${transport}" transport does not expose ${unsupported.join(
        ', ',
      )} as a documented API operation, so provider profile "${profile.id}" cannot serve this request — refusing rather than posting to an endpoint that does not exist.`,
      profile,
      transport,
    });
  }

  if (!options.enabledTransports.includes(transport)) {
    return unavailability({
      code: 'adapter_disabled',
      precondition: `adapter:${transport}`,
      message: `The hosted "${transport}" adapter is not enabled on this host, so no outbound provider request was attempted. Enable it explicitly (AIKAMI_HOSTED_ADAPTERS=${transport}) and set the provider credential.`,
      profile,
      transport,
    });
  }

  if (options.credentialReference === undefined || options.credentialReference.length === 0) {
    return unavailability({
      code: 'credential_missing',
      precondition: `credential:${transport}`,
      message: `No credential for the hosted "${transport}" transport resolved on this host, so no outbound provider request was attempted and the billable call count is 0.`,
      profile,
      transport,
    });
  }

  const terms = HOSTED_TRANSPORT_TERMS[transport];
  if (!terms || !terms.inference) {
    return unavailability({
      code: 'rights_unresolved',
      precondition: `rights:${transport}`,
      message: `The recorded terms for the hosted "${transport}" transport do not grant inference, so no candidate may be generated with it.`,
      profile,
      transport,
    });
  }

  if (options.hostedBudgetUsd === undefined) {
    return unavailability({
      code: 'budget_not_configured',
      precondition: 'budget:hostedBudgetUsd',
      message:
        'No hostedBudgetUsd ceiling is known for this run, so no hosted provider may be dialled. Declare a ceiling covering the printed preflight quote to consent to the spend.',
      profile,
      transport,
    });
  }

  return undefined;
};

// ---------------------------------------------------------------------------
// Preflight quote
// ---------------------------------------------------------------------------

/** One item the quote covers. */
export type HostedQuoteItemInput = {
  readonly itemId: string;
  readonly jobId: string;
  readonly candidateCount: number;
  readonly maximumDurationSeconds: number;
};

/** The outcome of building a quote. */
export type HostedQuoteResult =
  | { readonly kind: 'quoted'; readonly quote: HostedPreflightQuote }
  | { readonly kind: 'refused'; readonly unavailability: HostedUnavailability };

/**
 * Builds the preflight quote a creator consents to.
 *
 * 🔴 The quote is a *maximum*, and it says so: `assumptions` lists what it
 * rests on (the declared per-candidate ceiling, the candidate count, the
 * requested durations) so a creator can refuse it. It never invents a price
 * the provider did not publish — the per-candidate figure is the profile's own
 * declared ceiling.
 */
export const buildHostedPreflightQuote = (options: {
  profile: GenerationProviderProfile;
  items: readonly HostedQuoteItemInput[];
  /** Injected clock so the quote is reproducible in a test. */
  generatedAt: string;
}): HostedQuoteResult => {
  const { profile } = options;
  const transport = hostedTransportForProfile(profile);
  if (transport === undefined || profile.hostedModelId === undefined) {
    return {
      kind: 'refused',
      unavailability: {
        code: 'capability_unsupported',
        precondition: 'hostedTransportProfile',
        message: `Provider profile "${profile.id}" is not a resolvable hosted profile, so no preflight quote can be printed for it.`,
        providerProfileId: profile.id,
      },
    };
  }

  const apiVersion = profile.hostedApiVersion ?? 'unspecified';
  const quoteItems = options.items.map((item) => ({
    itemId: item.itemId,
    jobId: item.jobId,
    candidateCount: item.candidateCount,
    maximumDurationSeconds: item.maximumDurationSeconds,
    estimatedMaxUsd: item.candidateCount * profile.estimatedSpendUsdPerCandidate,
  }));
  const candidateCount = quoteItems.reduce((total, item) => total + item.candidateCount, 0);
  const estimatedMaxUsd = quoteItems.reduce((total, item) => total + item.estimatedMaxUsd, 0);
  const maximumDurationSeconds = quoteItems.reduce(
    (maximum, item) => Math.max(maximum, item.maximumDurationSeconds),
    0,
  );
  const terms = HOSTED_TRANSPORT_TERMS[transport];

  return {
    kind: 'quoted',
    quote: {
      schemaVersion: 1,
      providerProfileId: profile.id,
      transport,
      modality: profile.modality,
      modelId: profile.hostedModelId,
      apiVersion,
      currency: 'USD',
      candidateCount,
      estimatedSpendUsdPerCandidate: profile.estimatedSpendUsdPerCandidate,
      estimatedMaxUsd,
      maximumDurationSeconds,
      assumptions: [
        `Priced at the profile's declared ceiling of $${profile.estimatedSpendUsdPerCandidate.toFixed(4)} per candidate for "${profile.id}" — a declared maximum, not a provider quotation.`,
        `Covers ${candidateCount} candidate(s) across ${quoteItems.length} item(s) in this phase.`,
        maximumDurationSeconds > 0
          ? `Assumes no single item requests more than ${maximumDurationSeconds.toFixed(1)}s of generated audio.`
          : 'Image items request no generated duration.',
        `Targets the "${transport}" API version "${apiVersion}" with the explicit model id "${profile.hostedModelId}".`,
        terms
          ? `Account scope: ${terms.accountScope}. Terms revision "${terms.revision}" (${terms.date}); standalone distribution is recorded as ${terms.standaloneDistribution ? 'permitted' : 'denied'}.`
          : 'No recorded terms for this transport — a hosted dispatch is refused.',
        'No automatic paid fallback and no silent resubmission: a timeout leaves the reservation unsettled and the job at reconciliation_required.',
      ],
      items: quoteItems,
      generatedAt: options.generatedAt,
    },
  };
};

/** The quote items one plan phase implies, derived from the plan's own items. */
export const hostedQuoteItemsFromPlan = (
  items: readonly GenerationPlanItem[],
): readonly HostedQuoteItemInput[] =>
  items
    .filter((item) => item.providerMode === 'hosted' && item.dispatchable)
    .map((item) => ({
      itemId: item.itemId,
      jobId: item.jobId,
      candidateCount: item.candidateLimit,
      maximumDurationSeconds: item.estimatedDurationSeconds,
    }));

// ---------------------------------------------------------------------------
// Reservation / settlement
// ---------------------------------------------------------------------------

/** The outcome of reserving a quote's ceiling. */
export type HostedReservationResult =
  | { readonly kind: 'reserved'; readonly reservation: CostReservation }
  | { readonly kind: 'refused'; readonly blocker: GenerationPlanBlocker };

/**
 * Reserves the quote's ceiling for one job before the outbound request.
 *
 * 🔴 The budget decision is `enforceGenerationBudget`'s — the single plan-time
 * authority. This function adds no second ceiling check; it only materializes
 * the decision as a durable reservation. The host writes that reservation
 * under the job store's exclusive lock, so two processes cannot both pass the
 * same ceiling check.
 */
export const reserveHostedCost = (options: {
  quote: HostedPreflightQuote;
  reservationId: string;
  jobId: string;
  requestKey: string;
  budget: GenerationBudget;
  progress: GenerationRunProgress;
  itemId: string;
  itemCandidateLimit: number;
  attempt: number;
  at: string;
}): HostedReservationResult => {
  const refusal = enforceGenerationBudget({
    budget: options.budget,
    progress: options.progress,
    cost: {
      providerProfileId: options.quote.providerProfileId,
      providerMode: 'hosted',
      estimatedSpendUsdPerCandidate: options.quote.estimatedSpendUsdPerCandidate,
      itemCandidateLimit: options.itemCandidateLimit,
      attempt: options.attempt,
      estimatedDurationSeconds: options.quote.maximumDurationSeconds,
      estimatedPixels: 0,
      estimatedRetainedBytes: 0,
    },
    itemId: options.itemId,
  });
  if (refusal) {
    return { kind: 'refused', blocker: refusal };
  }

  return {
    kind: 'reserved',
    reservation: {
      schemaVersion: 1,
      reservationId: options.reservationId,
      jobId: options.jobId,
      requestKey: options.requestKey,
      providerProfileId: options.quote.providerProfileId,
      transport: options.quote.transport,
      currency: options.quote.currency,
      estimatedMaxUsd: options.quote.estimatedMaxUsd,
      state: 'reserved',
      createdAt: options.at,
    },
  };
};

/** What the provider reported about a finished request. */
export type HostedSettlementOutcome =
  /** The provider reported a charge. */
  | { readonly kind: 'reported'; readonly actualUsd: number }
  /** The provider confirmed nothing was submitted (a refusal before dispatch). */
  | { readonly kind: 'no-charge' }
  /**
   * The request completed but the provider reported no usage counter.
   *
   * The settled amount is then the *reserved ceiling* — a maximum, not a
   * measured charge — and the reservation says so, so a later reader cannot
   * mistake it for an invoice.
   */
  | { readonly kind: 'no-usage-counter' }
  /**
   * The outcome is genuinely unknown — a timeout, an aborted read, a process
   * death. The reservation stays unresolved and auditable.
   */
  | { readonly kind: 'unknown'; readonly reason: string };

/**
 * Settles a reservation against what the provider actually reported.
 *
 * 🔴 `unknown` never becomes `settled`. An unreviewed hosted spend is still a
 * spend, and a rollback may not delete a reservation whose billable outcome is
 * unknown — so the record stays readable and the job resolves to
 * `job_reconciliation_required`.
 *
 * A settled reservation carries an `uncertainty` note only when its amount is
 * not a measured charge (the provider reported no usage counter), so a reader
 * can always tell an invoice from a held ceiling.
 */
export const settleHostedCost = (options: {
  reservation: CostReservation;
  outcome: HostedSettlementOutcome;
  at: string;
}): CostReservation => {
  const { reservation, outcome } = options;
  if (outcome.kind === 'unknown') {
    return {
      ...reservation,
      state: 'unsettled',
      uncertainty: outcome.reason,
    };
  }
  if (outcome.kind === 'no-usage-counter') {
    return {
      ...reservation,
      state: 'settled',
      settledUsd: reservation.estimatedMaxUsd,
      uncertainty: `The provider completed the request but reported no usage counter, so the settled amount is the reserved ceiling of $${reservation.estimatedMaxUsd.toFixed(4)} — a declared maximum, not a measured charge.`,
      settledAt: options.at,
    };
  }
  return {
    ...reservation,
    state: 'settled',
    settledUsd: outcome.kind === 'reported' ? outcome.actualUsd : 0,
    settledAt: options.at,
  };
};

/** True when a reservation's billable outcome is still unresolved. */
export const isReservationUnsettled = (reservation: CostReservation): boolean =>
  reservation.state !== 'settled';

/**
 * The blocker an unsettled reservation produces on a retry.
 *
 * A new attempt requires an explicit new attempt/variation; this refusal is
 * what stops an automatic resubmission from paying twice.
 */
export const unsettledReservationBlocker = (options: {
  reservation: CostReservation;
  itemId?: string;
}): GenerationPlanBlocker => ({
  code: HOSTED_UNSETTLED_BLOCKER_CODE,
  itemId: options.itemId,
  providerProfileId: options.reservation.providerProfileId,
  message: `Reservation ${options.reservation.reservationId} for job ${options.reservation.jobId} is unsettled (${options.reservation.uncertainty ?? 'the provider reported no outcome'}) — the billable outcome is unknown, so no new attempt is dispatched automatically. Resolve it explicitly (--reconcile) or submit an explicit new attempt.`,
});
