// packages/shared/schemas/src/lib/generation/hosted_generation.ts
//
// C-524: the shapes that cross a boundary on the *optional* hosted generation
// path — the preflight quote a creator consents to, the cost reservation the
// host writes before any outbound request, the typed unavailability a clean
// environment produces, and the provider account/terms record.
//
// Three rules shape them:
//
//   1. **A quote is not a promise.** It states currency, candidate count,
//      maximum durations and the assumptions it rests on, so a creator can
//      refuse it. It never claims a price the provider did not publish.
//   2. **A reservation is written before the request.** An unreserved spend is
//      an unauditable spend. An unsettled reservation stays readable and
//      resolves to `job_reconciliation_required`, never to a silent retry.
//   3. **Unavailability is typed.** A missing credential, a disabled adapter,
//      an unconfigured budget or an unresolved rights scope is a named
//      precondition — never a zero-cost row and never an invented result.
//
// 🔴 No secret appears in any shape below. A credential is an opaque
// host-side *reference* (`env:PIXELLAB_API_KEY`), never the token itself.
//
// Contract: C-524 Optional hosted asset provider comparison

import { type Static, Type } from 'typebox';

// ---------------------------------------------------------------------------
// Transport identity
// ---------------------------------------------------------------------------

/**
 * The declared hosted transports.
 *
 * 🔴 Written out literally rather than mapped from `HOSTED_TRANSPORT_IDS`:
 * TypeBox infers the union's members from a tuple literal, and a mapped array
 * collapses to `never`. `hosted_generation.test.ts` asserts the two
 * vocabularies agree member-for-member, so the duplication cannot drift
 * silently.
 */
export const HostedTransportIdSchema = Type.Union(
  [
    Type.Literal('pixellab', { description: 'PixelLab image/rotation/animation API (C-524)' }),
    Type.Literal('elevenlabs', { description: 'ElevenLabs SFX/music API (C-524)' }),
  ],
  { description: 'A declared hosted generation transport' },
);

/** A declared hosted transport id. */
export type HostedTransportId = Static<typeof HostedTransportIdSchema>;

/** The schema version of the hosted cost records below. */
export const HOSTED_GENERATION_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Preflight quote
// ---------------------------------------------------------------------------

/** One item's contribution to a preflight quote. */
export const HostedPreflightQuoteItemSchema = Type.Object(
  {
    itemId: Type.String({ minLength: 1, maxLength: 160 }),
    jobId: Type.String({ minLength: 1, maxLength: 160 }),
    candidateCount: Type.Integer({ minimum: 1 }),
    /** Maximum seconds this item may request (audio); `0` for image items. */
    maximumDurationSeconds: Type.Number({ minimum: 0 }),
    /** `candidateCount × estimatedSpendUsdPerCandidate`, in the quote currency. */
    estimatedMaxUsd: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

/** One item in a preflight quote. */
export type HostedPreflightQuoteItem = Static<typeof HostedPreflightQuoteItemSchema>;

/**
 * The preflight quote a creator consents to before a hosted dispatch.
 *
 * 🔴 It is a *maximum*, not a price: `estimatedMaxUsd` is the ceiling the
 * reservation holds, and the assumptions list is what it rests on. A creator
 * who does not accept the quote simply does not raise the ceiling.
 */
export const HostedPreflightQuoteSchema = Type.Object(
  {
    schemaVersion: Type.Literal(HOSTED_GENERATION_SCHEMA_VERSION),
    providerProfileId: Type.String({ minLength: 1, maxLength: 160 }),
    transport: HostedTransportIdSchema,
    modality: Type.Union([Type.Literal('image'), Type.Literal('audio')]),
    /** The explicit model id the request will name. */
    modelId: Type.String({ minLength: 1, maxLength: 200 }),
    /** The pinned provider API version the request targets. */
    apiVersion: Type.String({ minLength: 1, maxLength: 60 }),
    /** ISO-4217 code. Only USD is declared today. */
    currency: Type.Literal('USD'),
    candidateCount: Type.Integer({ minimum: 0 }),
    estimatedSpendUsdPerCandidate: Type.Number({ minimum: 0 }),
    /** The ceiling the reservation holds: candidates × per-candidate estimate. */
    estimatedMaxUsd: Type.Number({ minimum: 0 }),
    /** The largest single-item duration this quote authorizes. */
    maximumDurationSeconds: Type.Number({ minimum: 0 }),
    /** What the quote rests on — printed so a creator can refuse it. */
    assumptions: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), {
      minItems: 1,
      maxItems: 32,
    }),
    items: Type.Array(HostedPreflightQuoteItemSchema, { maxItems: 4096 }),
    generatedAt: Type.String({ maxLength: 40 }),
  },
  { additionalProperties: false },
);

/** The preflight quote for one hosted dispatch. */
export type HostedPreflightQuote = Static<typeof HostedPreflightQuoteSchema>;

// ---------------------------------------------------------------------------
// Cost reservation / settlement
// ---------------------------------------------------------------------------

/** Whether a reservation is still held, settled, or unresolved. */
export const COST_RESERVATION_STATES = ['reserved', 'settled', 'unsettled'] as const;

/**
 * One cost-reservation state.
 *
 * `unsettled` is the honest state for a request that left the process and
 * whose billable outcome is unknown (a timeout, a hard kill). It is never
 * silently collapsed into `settled` or deleted by a rollback.
 */
export const CostReservationStateSchema = Type.Union([
  Type.Literal('reserved'),
  Type.Literal('settled'),
  Type.Literal('unsettled'),
]);

/** One cost-reservation state. */
export type CostReservationState = Static<typeof CostReservationStateSchema>;

/**
 * A reservation binds one job and one request key to a held ceiling.
 *
 * It *extends* the C-519 job/run records rather than replacing them: the job
 * record still owns the lifecycle, and this record owns the money.
 */
export const CostReservationSchema = Type.Object(
  {
    schemaVersion: Type.Literal(HOSTED_GENERATION_SCHEMA_VERSION),
    /** Immutable reservation identity. */
    reservationId: Type.String({ minLength: 1, maxLength: 160 }),
    /** The C-519 job this reservation was taken for. */
    jobId: Type.String({ minLength: 1, maxLength: 160 }),
    /** The idempotency key — a repeated key resolves to the same reservation. */
    requestKey: Type.String({ minLength: 1, maxLength: 300 }),
    providerProfileId: Type.String({ minLength: 1, maxLength: 160 }),
    transport: HostedTransportIdSchema,
    currency: Type.Literal('USD'),
    /** The ceiling held before the outbound request. */
    estimatedMaxUsd: Type.Number({ minimum: 0 }),
    /** The actual charge, once the provider reported one. */
    settledUsd: Type.Optional(Type.Number({ minimum: 0 })),
    state: CostReservationStateSchema,
    /**
     * Why an `unsettled` reservation is unresolved. Present only then — an
     * uncertainty note on a settled reservation would be noise.
     */
    uncertainty: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    createdAt: Type.String({ maxLength: 40 }),
    settledAt: Type.Optional(Type.String({ maxLength: 40 })),
  },
  { additionalProperties: false },
);

/** One hosted cost reservation. */
export type CostReservation = Static<typeof CostReservationSchema>;

// ---------------------------------------------------------------------------
// Typed unavailability
// ---------------------------------------------------------------------------

/** Every precondition a hosted dispatch can be missing. */
export const HOSTED_UNAVAILABILITY_CODES = [
  'credential_missing',
  'adapter_disabled',
  'budget_not_configured',
  'rights_unresolved',
  'capability_unsupported',
] as const;

/**
 * The typed reason a hosted dispatch did not happen.
 *
 * 🔴 These are the only ways "no hosted call was made" may be reported. A
 * zero-cost row and an invented provider result are both defects.
 */
export const HostedUnavailabilityCodeSchema = Type.Union([
  Type.Literal('credential_missing'),
  Type.Literal('adapter_disabled'),
  Type.Literal('budget_not_configured'),
  Type.Literal('rights_unresolved'),
  Type.Literal('capability_unsupported'),
]);

/** One typed unavailability code. */
export type HostedUnavailabilityCode = Static<typeof HostedUnavailabilityCodeSchema>;

/** A named missing precondition. */
export const HostedUnavailabilitySchema = Type.Object(
  {
    code: HostedUnavailabilityCodeSchema,
    /** The precondition that is missing, in the caller's own vocabulary. */
    precondition: Type.String({ minLength: 1, maxLength: 300 }),
    message: Type.String({ minLength: 1, maxLength: 1000 }),
    providerProfileId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    transport: Type.Optional(HostedTransportIdSchema),
  },
  { additionalProperties: false },
);

/** One typed hosted unavailability. */
export type HostedUnavailability = Static<typeof HostedUnavailabilitySchema>;

// ---------------------------------------------------------------------------
// Provider account scope + request evidence
// ---------------------------------------------------------------------------

/**
 * What was known about the provider account when the request was made.
 *
 * Recorded without credentials: the account/plan scope, the terms revision and
 * date, the model/API version and the provider's own response metadata. If the
 * provider cannot expose seeds or deterministic revisions, that limit is
 * recorded here rather than fabricated.
 */
export const HostedProviderAccountScopeSchema = Type.Object(
  {
    providerProfileId: Type.String({ minLength: 1, maxLength: 160 }),
    transport: HostedTransportIdSchema,
    /** The account/plan scope the terms record describes. */
    accountScope: Type.String({ minLength: 1, maxLength: 300 }),
    /** The recorded terms revision. */
    termsRevision: Type.String({ minLength: 1, maxLength: 300 }),
    /** ISO-8601 date the terms record was taken. */
    termsDate: Type.String({ minLength: 1, maxLength: 40 }),
    modelId: Type.String({ minLength: 1, maxLength: 200 }),
    apiVersion: Type.String({ minLength: 1, maxLength: 60 }),
    /** Non-secret response metadata (request id, usage counters, …). */
    responseMetadata: Type.Record(Type.String(), Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);

/** One provider account/terms record. */
export type HostedProviderAccountScope = Static<typeof HostedProviderAccountScopeSchema>;

/**
 * The evidence one executed hosted request produced.
 *
 * This is the *live smoke* record (AC-2b): a request id, the raw and prepared
 * hashes and a measured wall time on named hardware. It is produced only from
 * an executed request — an unconfigured environment records a
 * {@link HostedUnavailability} instead.
 */
export const HostedRequestEvidenceSchema = Type.Object(
  {
    providerProfileId: Type.String({ minLength: 1, maxLength: 160 }),
    transport: HostedTransportIdSchema,
    /** The provider's own request/job id. Required: a hosted record with none is a refusal. */
    requestId: Type.String({ minLength: 1, maxLength: 256 }),
    modelId: Type.String({ minLength: 1, maxLength: 200 }),
    apiVersion: Type.String({ minLength: 1, maxLength: 60 }),
    endpoint: Type.String({ minLength: 1, maxLength: 2048 }),
    /** SHA-256 of the raw provider bytes. */
    rawHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    /** SHA-256 of the prepared artifact the same bytes became. */
    preparedHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    /** Measured wall time of the bounded request, in milliseconds. */
    wallTimeMs: Type.Number({ minimum: 0 }),
    /** The hardware the wall time was measured on. */
    measuredOn: Type.String({ minLength: 1, maxLength: 300 }),
    responseMetadata: Type.Record(Type.String(), Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);

/** One executed hosted request's evidence. */
export type HostedRequestEvidence = Static<typeof HostedRequestEvidenceSchema>;
