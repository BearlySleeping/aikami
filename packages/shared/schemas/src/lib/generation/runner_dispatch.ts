// packages/shared/schemas/src/lib/generation/runner_dispatch.ts
//
// C-522: Hub ↔ creator-GPU runner pairing and dispatch.
//
// A Cloudflare Worker cannot reach a creator's machine: `127.0.0.1` inside a
// Worker isolate is the isolate, not the browser, and a runner behind NAT has
// no inbound path at all. Every Hub→runner step is therefore the *response* to
// a runner-initiated request. These shapes are the vocabulary of that
// conversation:
//
//   * a short-lived pairing code binds one owner account to one device id and
//     mints a narrowly scoped, revocable runner credential;
//   * a dispatch names allowlisted recipe/profile ids plus reference artifact
//     ids — never executable code, a shell command, arbitrary graph JSON or an
//     arbitrary callback URL;
//   * the claim is a CAS over the dispatch row (D1 uniqueness, not an
//     in-isolate counter), and the resulting lease is the shared C-519
//     `GenerationLease` — wrapped with the attempt generation that fences
//     stale status updates, never duplicated as a second lease shape;
//   * a rejected update names *which* fence failed, so the runner can
//     reconcile instead of overwriting a newer attempt;
//   * artifact transfer needs an explicit owner-scoped ticket. A ticket is a
//     private staging handle with an expiry, not a publication.
//
// Contract: C-522 Hub and client access to the generation runner

import { type Static, Type } from 'typebox';
import { GenerationModalitySchema } from './asset_recipe.ts';
import {
  GenerationBudgetSchema,
  GenerationJobCancellationSchema,
  GenerationJobFailureSchema,
  GenerationJobStatusSchema,
  GenerationLeaseSchema,
} from './generation_job.ts';
import { GenerationJobIdSchema } from './generation_provenance.ts';
import { GenerationSha256Schema } from './hash.ts';

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

/** Runner-protocol version. Bump only for a breaking change to these shapes. */
export const GENERATION_RUNNER_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** How a Hub-side job reaches a creator's GPU. */
export const GenerationRunnerModeSchema = Type.Union([
  /** The browser talks straight to a configured loopback endpoint. */
  Type.Literal('direct_loopback'),
  /** The runner polls the Hub; the Hub never dials the runner. */
  Type.Literal('paired_outbound'),
]);

/** One runner transport mode. */
export type GenerationRunnerMode = Static<typeof GenerationRunnerModeSchema>;

/** The host platform a paired device runs on. */
export const RunnerPlatformSchema = Type.Union([
  Type.Literal('linux'),
  Type.Literal('macos'),
  Type.Literal('windows'),
  Type.Literal('unknown'),
]);

/** One runner host platform. */
export type RunnerPlatform = Static<typeof RunnerPlatformSchema>;

/** An opaque, server-issued device identity. */
export const RunnerDeviceIdSchema = Type.String({
  minLength: 8,
  maxLength: 160,
  pattern: '^[A-Za-z0-9_-]+$',
});

/** The short-lived code a creator reads off the Hub and types into the runner. */
export const RunnerPairingCodeSchema = Type.String({
  minLength: 8,
  maxLength: 64,
  pattern: '^[A-Z2-9]+(-[A-Z2-9]+)*$',
});

/**
 * A stored runner credential is `sha256(token)` — the token itself is returned
 * once, at pairing time, and never persisted Hub-side. Same shape as every
 * other content address here, so no second hashing convention appears.
 */
export const RunnerTokenHashSchema = GenerationSha256Schema;

// ---------------------------------------------------------------------------
// Rejection vocabulary
// ---------------------------------------------------------------------------

/**
 * Why a runner request was refused.
 *
 * Every rejection is a named code rather than a bare 4xx: the runner must be
 * able to tell "my credential died" (stop, tell the creator) apart from
 * "someone else won the claim" (poll again) and from "my update is stale"
 * (reconcile, never overwrite).
 */
export const GenerationDispatchRejectionCodeSchema = Type.Union([
  /** No credential, or one that matches no device row. */
  Type.Literal('unauthorized'),
  /** The device row exists but has been revoked — blocks claims and retrieval. */
  Type.Literal('device_revoked'),
  /** The dispatch belongs to a different account than the caller. */
  Type.Literal('owner_mismatch'),
  /** The dispatch targets a different paired device. */
  Type.Literal('device_mismatch'),
  /** The update names an attempt generation older than the dispatch's. */
  Type.Literal('stale_attempt'),
  /** The update echoes a lease id the dispatch does not currently hold. */
  Type.Literal('lease_not_held'),
  /** The lease the caller holds has expired (wall clock, Hub side). */
  Type.Literal('lease_expired'),
  /** Another runner already took this dispatch. */
  Type.Literal('already_claimed'),
  /** The device advertises no engine for the dispatch's modality. */
  Type.Literal('capability_mismatch'),
  /** The owner disabled private artifact upload for this device. */
  Type.Literal('upload_disabled'),
  /** The artifact ticket exists but its expiry has passed. */
  Type.Literal('ticket_expired'),
  /** No such dispatch / ticket / device. */
  Type.Literal('not_found'),
  /** The pairing code is unknown, consumed or past its expiry. */
  Type.Literal('pairing_code_invalid'),
  /**
   * The body does not match the runner-protocol schema.
   *
   * Distinct from `device_mismatch`, which means the body parsed and named a
   * *different* device: collapsing the two sends a caller hunting for an
   * identity bug when the real problem is a malformed payload.
   */
  Type.Literal('invalid_request'),
  /** The Hub has no D1 binding — degrade, never 500. */
  Type.Literal('runner_unconfigured'),
]);

/** One named refusal reason. */
export type GenerationDispatchRejectionCode = Static<typeof GenerationDispatchRejectionCodeSchema>;

/**
 * A refusal body. `code` is the only machine-readable field; `message` is for
 * the creator-facing surface and never carries credential material.
 */
export const GenerationDispatchRejectionSchema = Type.Object(
  {
    schemaVersion: Type.Literal(GENERATION_RUNNER_SCHEMA_VERSION),
    ok: Type.Literal(false),
    code: GenerationDispatchRejectionCodeSchema,
    message: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { additionalProperties: false },
);

/** One refusal. */
export type GenerationDispatchRejection = Static<typeof GenerationDispatchRejectionSchema>;

// ---------------------------------------------------------------------------
// Paired runners
// ---------------------------------------------------------------------------

/**
 * One paired creator device.
 *
 * `tokenHash` is deliberately part of the *record* and never part of the
 * creator-visible `RunnerDeviceSummarySchema` — the Hub can verify a presented
 * token but can never re-display it.
 */
export const PairedRunnerSchema = Type.Object(
  {
    schemaVersion: Type.Literal(GENERATION_RUNNER_SCHEMA_VERSION),
    deviceId: RunnerDeviceIdSchema,
    ownerAccountId: Type.String({ minLength: 1, maxLength: 160 }),
    /** Creator-supplied label, e.g. `Studio desktop`. */
    label: Type.String({ minLength: 1, maxLength: 120 }),
    platform: RunnerPlatformSchema,
    /** Modalities the device advertised engines for at pairing time. */
    modalities: Type.Array(GenerationModalitySchema, { maxItems: 8 }),
    /** Physical resource groups (e.g. `gpu:0`). Default GPU concurrency is 1. */
    resourceGroups: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { maxItems: 8 }),
    /** `sha256(token)` — set at pairing, rotated on re-pair. */
    tokenHash: RunnerTokenHashSchema,
    /** Whether this device may upload private preview artifacts to the Hub. */
    artifactUploadEnabled: Type.Boolean(),
    createdAt: Type.String({ maxLength: 40 }),
    lastSeenAt: Type.String({ maxLength: 40 }),
    /** Present once revoked; revocation blocks new claims, never local compute. */
    revokedAt: Type.Optional(Type.String({ maxLength: 40 })),
  },
  { additionalProperties: false },
);

/** One paired device record. */
export type PairedRunner = Static<typeof PairedRunnerSchema>;

/**
 * The creator-visible projection of a paired device.
 *
 * No `tokenHash`, no last-seen IP, no local path. This is what the Hub's
 * paired-device list renders, so a compromised session cannot exfiltrate an
 * existing credential from a read.
 */
export const RunnerDeviceSummarySchema = Type.Object(
  {
    schemaVersion: Type.Literal(GENERATION_RUNNER_SCHEMA_VERSION),
    deviceId: RunnerDeviceIdSchema,
    label: Type.String({ minLength: 1, maxLength: 120 }),
    platform: RunnerPlatformSchema,
    modalities: Type.Array(GenerationModalitySchema, { maxItems: 8 }),
    resourceGroups: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { maxItems: 8 }),
    artifactUploadEnabled: Type.Boolean(),
    createdAt: Type.String({ maxLength: 40 }),
    lastSeenAt: Type.String({ maxLength: 40 }),
    revoked: Type.Boolean(),
    revokedAt: Type.Optional(Type.String({ maxLength: 40 })),
    /**
     * Derived, Hub-side: a device that has not polled within the liveness
     * window is shown as offline rather than silently accepting jobs.
     */
    online: Type.Boolean(),
  },
  { additionalProperties: false },
);

/** One creator-visible paired device. */
export type RunnerDeviceSummary = Static<typeof RunnerDeviceSummarySchema>;

/** A pairing code row — short-lived, single-use, owner-scoped. */
export const RunnerPairingCodeRecordSchema = Type.Object(
  {
    schemaVersion: Type.Literal(GENERATION_RUNNER_SCHEMA_VERSION),
    code: RunnerPairingCodeSchema,
    ownerAccountId: Type.String({ minLength: 1, maxLength: 160 }),
    createdAt: Type.String({ maxLength: 40 }),
    expiresAt: Type.String({ maxLength: 40 }),
    consumedAt: Type.Optional(Type.String({ maxLength: 40 })),
    /** The device the code bound, once consumed. */
    deviceId: Type.Optional(RunnerDeviceIdSchema),
  },
  { additionalProperties: false },
);

/** One stored pairing-code row (the code itself is the credential). */
export type RunnerPairingCodeRecord = Static<typeof RunnerPairingCodeRecordSchema>;

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * The allowlisted half of a job.
 *
 * Every field is either an id from the shared registries (`recipeId`,
 * `providerProfileId`, `preparationProfile`, `referenceIds`) or a bounded
 * scalar. There is no field a caller could put a shell command, an engine URL
 * or graph JSON into — that is the point, not an omission.
 */
export const GenerationDispatchSpecSchema = Type.Object(
  {
    /** Brief item this job belongs to. */
    itemId: Type.String({ minLength: 1, maxLength: 160 }),
    recipeId: Type.String({ minLength: 1, maxLength: 160 }),
    /**
     * The recipe's modality, denormalised onto the dispatch so the Hub can
     * reject a device-capability mismatch *before* the claim without importing
     * the recipe registry into the Worker's request path.
     */
    modality: GenerationModalitySchema,
    providerProfileId: Type.String({ minLength: 1, maxLength: 160 }),
    preparationProfile: Type.String({ minLength: 1, maxLength: 160 }),
    /** Owned/licensed reference artifacts, by id — never by URL. */
    referenceIds: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 64 }),
    seed: Type.Integer({ minimum: 0 }),
    candidateLimit: Type.Integer({ minimum: 1, maximum: 16 }),
    /**
     * The locked resource budget (C-519 `GenerationBudget`) — the *same* shape
     * the CLI and the client studio lock, so all three front doors spend from
     * one shared budget vocabulary instead of three private ones.
     */
    budget: GenerationBudgetSchema,
    /** Private to the owner; never part of a public projection. */
    prompt: Type.String({ minLength: 1, maxLength: 8000 }),
    negativePrompt: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
  },
  { additionalProperties: false },
);

/** The allowlisted job description a dispatch carries. */
export type GenerationDispatchSpec = Static<typeof GenerationDispatchSpecSchema>;

/**
 * The fencing handle: the shared C-519 `GenerationLease` (not a second lease
 * shape) plus the attempt generation the Hub compares incoming updates against.
 *
 * `lease.owner` is the paired device id and `lease.resourceGroup` the physical
 * group it holds, so the same `resourceGroup`/`owner`/`leaseId` semantics that
 * make the local store exclusive also make the Hub work exclusive.
 */
export const GenerationDispatchFenceSchema = Type.Object(
  {
    schemaVersion: Type.Literal(GENERATION_RUNNER_SCHEMA_VERSION),
    dispatchId: Type.String({ minLength: 1, maxLength: 160 }),
    attempt: Type.Integer({ minimum: 1 }),
    lease: GenerationLeaseSchema,
  },
  { additionalProperties: false },
);

/** One dispatch fence. */
export type GenerationDispatchFence = Static<typeof GenerationDispatchFenceSchema>;

/**
 * One Hub-side dispatch: owner + device metadata plus the existing C-519 job
 * identity (`jobId`/`requestKey`/`effectiveSpecHash`/`attempt`). It is not a
 * second job shape — it is the routing record for one.
 */
export const GenerationDispatchSchema = Type.Object(
  {
    schemaVersion: Type.Literal(GENERATION_RUNNER_SCHEMA_VERSION),
    dispatchId: Type.String({ minLength: 1, maxLength: 160 }),
    /** Owner account — every read/claim is scoped to this. */
    ownerAccountId: Type.String({ minLength: 1, maxLength: 160 }),
    /** Exactly one paired device a job routes to. */
    deviceId: RunnerDeviceIdSchema,
    jobId: GenerationJobIdSchema,
    requestKey: Type.String({ minLength: 1, maxLength: 300 }),
    effectiveSpecHash: GenerationSha256Schema,
    /** Fencing generation — incremented only by an explicit new attempt. */
    attempt: Type.Integer({ minimum: 1 }),
    spec: GenerationDispatchSpecSchema,
    status: GenerationJobStatusSchema,
    /** The dispatch-side fence: the shared lease plus the attempt. */
    fence: Type.Optional(GenerationDispatchFenceSchema),
    candidateCount: Type.Integer({ minimum: 0 }),
    /** The candidate the Hub knows about, once the runner reports one. */
    candidateId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    /** Verified hash of the produced bytes — never a local filesystem path. */
    preparedHash: Type.Optional(GenerationSha256Schema),
    createdAt: Type.String({ maxLength: 40 }),
    updatedAt: Type.String({ maxLength: 40 }),
    /** The runner's structured failure, once it reports one. */
    failure: Type.Optional(GenerationJobFailureSchema),
    /** The split request/confirmation cancellation record. */
    cancellation: Type.Optional(GenerationJobCancellationSchema),
  },
  { additionalProperties: false },
);

/** One Hub-side dispatch record. */
export type GenerationDispatch = Static<typeof GenerationDispatchSchema>;

// ---------------------------------------------------------------------------
// Runner-initiated endpoints
// ---------------------------------------------------------------------------

/** `POST /api/generation/runners/pair` — consume a pairing code. */
export const RunnerPairRequestSchema = Type.Object(
  {
    schemaVersion: Type.Literal(GENERATION_RUNNER_SCHEMA_VERSION),
    code: RunnerPairingCodeSchema,
    deviceId: RunnerDeviceIdSchema,
    label: Type.String({ minLength: 1, maxLength: 120 }),
    platform: RunnerPlatformSchema,
    modalities: Type.Array(GenerationModalitySchema, { maxItems: 8 }),
    resourceGroups: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { maxItems: 8 }),
    /** The device opts in to uploading private previews; default is off. */
    artifactUploadEnabled: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

/** One pairing request. */
export type RunnerPairRequest = Static<typeof RunnerPairRequestSchema>;

/**
 * The pairing response. `token` is returned exactly once — the Hub keeps only
 * its hash, so there is no "show me my token again" path to leak.
 */
export const RunnerPairResponseSchema = Type.Object(
  {
    schemaVersion: Type.Literal(GENERATION_RUNNER_SCHEMA_VERSION),
    ok: Type.Literal(true),
    device: RunnerDeviceSummarySchema,
    /** `rt_<deviceId>.<secret>` — bearer credential, returned once. */
    token: Type.String({ minLength: 16, maxLength: 300 }),
    tokenExpiresAt: Type.String({ maxLength: 40 }),
  },
  { additionalProperties: false },
);

/** One pairing response. */
export type RunnerPairResponse = Static<typeof RunnerPairResponseSchema>;

/** `POST /api/generation/runners/claim` — take at most one queued dispatch. */
export const RunnerClaimRequestSchema = Type.Object(
  {
    schemaVersion: Type.Literal(GENERATION_RUNNER_SCHEMA_VERSION),
    deviceId: RunnerDeviceIdSchema,
    /** The physical group the runner is free to use right now. */
    resourceGroup: Type.String({ minLength: 1, maxLength: 120 }),
    /**
     * The runner's own clock. The Hub computes expiry from this and its own
     * `now`, so two-clock skew is explicit rather than assumed away.
     */
    runnerNow: Type.String({ maxLength: 40 }),
    /** How long the runner wants the lease for. */
    leaseTtlMs: Type.Integer({ minimum: 1000, maximum: 86_400_000 }),
    /** Modalities the runner can execute *this poll* (may be narrower). */
    modalities: Type.Array(GenerationModalitySchema, { maxItems: 8 }),
  },
  { additionalProperties: false },
);

/** One claim request. */
export type RunnerClaimRequest = Static<typeof RunnerClaimRequestSchema>;

/** `POST /api/generation/runners/claim` — empty queue or one dispatch + fence. */
export const RunnerClaimResponseSchema = Type.Union([
  Type.Object(
    {
      schemaVersion: Type.Literal(GENERATION_RUNNER_SCHEMA_VERSION),
      claimed: Type.Literal(true),
      dispatch: GenerationDispatchSchema,
      fence: GenerationDispatchFenceSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      schemaVersion: Type.Literal(GENERATION_RUNNER_SCHEMA_VERSION),
      claimed: Type.Literal(false),
      /** Always stated — "nothing queued" is never a silent empty body. */
      reason: Type.String({ minLength: 1, maxLength: 200 }),
    },
    { additionalProperties: false },
  ),
]);

/** One claim response. */
export type RunnerClaimResponse = Static<typeof RunnerClaimResponseSchema>;

/**
 * `POST /api/generation/runners/status` — report progress on a held dispatch.
 *
 * The fence is the pair (`attempt`, `fence.lease.leaseId`). A runner whose
 * update fails either fence reconciles; it never overwrites.
 */
export const RunnerStatusUpdateSchema = Type.Object(
  {
    schemaVersion: Type.Literal(GENERATION_RUNNER_SCHEMA_VERSION),
    deviceId: RunnerDeviceIdSchema,
    dispatchId: Type.String({ minLength: 1, maxLength: 160 }),
    attempt: Type.Integer({ minimum: 1 }),
    /** The lease id the runner believes it holds. */
    leaseId: Type.String({ minLength: 1, maxLength: 160 }),
    status: GenerationJobStatusSchema,
    candidateCount: Type.Integer({ minimum: 0 }),
    candidateId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    /** Verified hash of the produced bytes — a hash, never a local path. */
    preparedHash: Type.Optional(GenerationSha256Schema),
    failure: Type.Optional(GenerationJobFailureSchema),
    cancellation: Type.Optional(GenerationJobCancellationSchema),
    /** The runner's clock, so lease expiry is never judged one-sided. */
    runnerNow: Type.String({ maxLength: 40 }),
  },
  { additionalProperties: false },
);

/** One status update. */
export type RunnerStatusUpdate = Static<typeof RunnerStatusUpdateSchema>;

/**
 * `POST /api/generation/runners/status` — what the runner learns in return.
 *
 * Cancellation is delivered as the *response* to a runner-initiated request
 * (a runner behind CGNAT has no inbound path), and it is always a *request*:
 * `cancellation.confirmed` stays false until the runner reports the provider's
 * own receipt back, so the Hub never claims a stop it did not observe.
 */
export const RunnerStatusUpdateResponseSchema = Type.Object(
  {
    schemaVersion: Type.Literal(GENERATION_RUNNER_SCHEMA_VERSION),
    ok: Type.Literal(true),
    status: GenerationJobStatusSchema,
    candidateCount: Type.Integer({ minimum: 0 }),
    /** Dispatch ids this device holds that carry an unconfirmed cancel ask. */
    pendingCancellationDispatchIds: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), {
      maxItems: 32,
    }),
  },
  { additionalProperties: false },
);

/** One status-update response. */
export type RunnerStatusUpdateResponse = Static<typeof RunnerStatusUpdateResponseSchema>;

/** `POST /api/generation/runners/signal` — request cancellation of a dispatch. */
export const RunnerCancelSignalSchema = Type.Object(
  {
    schemaVersion: Type.Literal(GENERATION_RUNNER_SCHEMA_VERSION),
    deviceId: RunnerDeviceIdSchema,
    dispatchId: Type.String({ minLength: 1, maxLength: 160 }),
    /** The attempt the runner is asking about — a stale ask is refused. */
    attempt: Type.Integer({ minimum: 1 }),
    leaseId: Type.String({ minLength: 1, maxLength: 160 }),
    requested: Type.Boolean(),
    runnerNow: Type.String({ maxLength: 40 }),
  },
  { additionalProperties: false },
);

/** One cancellation signal. */
export type RunnerCancelSignal = Static<typeof RunnerCancelSignalSchema>;

// ---------------------------------------------------------------------------
// Private candidates
// ---------------------------------------------------------------------------

/**
 * A candidate's review state.
 *
 * `pending` is the only state a completion ever produces. Acceptance is a
 * *private* decision — it moves the candidate into the owner's library and
 * stops there. Publication is a separate, explicit act (C-513's reserve/upload
 * path) and is not expressible here.
 */
export const GenerationCandidateStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('accepted'),
  Type.Literal('rejected'),
]);

/** One private candidate review state. */
export type GenerationCandidateStatus = Static<typeof GenerationCandidateStatusSchema>;

/** `POST /api/generation/runners/candidates` — report a finished candidate. */
export const RunnerCandidateReportSchema = Type.Object(
  {
    schemaVersion: Type.Literal(GENERATION_RUNNER_SCHEMA_VERSION),
    deviceId: RunnerDeviceIdSchema,
    dispatchId: Type.String({ minLength: 1, maxLength: 160 }),
    attempt: Type.Integer({ minimum: 1 }),
    leaseId: Type.String({ minLength: 1, maxLength: 160 }),
    candidateId: Type.String({ minLength: 1, maxLength: 160 }),
    /** Verified byte identity of the produced artifact. */
    preparedHash: GenerationSha256Schema,
    seed: Type.Integer({ minimum: 0 }),
    /** Producing engine, when the runner can name it. */
    engineId: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
    mimeType: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    bytes: Type.Optional(Type.Integer({ minimum: 0 })),
    /**
     * Recorded, never fabricated: a provider that exposes no revision gets
     * `partial`/`unknown` rather than an invented hash.
     */
    provenanceState: Type.Union([
      Type.Literal('full'),
      Type.Literal('partial'),
      Type.Literal('unknown'),
    ]),
    runnerNow: Type.String({ maxLength: 40 }),
  },
  { additionalProperties: false },
);

/** One candidate report. */
export type RunnerCandidateReport = Static<typeof RunnerCandidateReportSchema>;

/**
 * The owner-visible candidate.
 *
 * Deliberately excludes the spec's private prompt: review is about the bytes
 * and their lineage, and the rejection note is the owner's own words.
 */
export const GenerationCandidateViewSchema = Type.Object(
  {
    schemaVersion: Type.Literal(GENERATION_RUNNER_SCHEMA_VERSION),
    candidateId: Type.String({ minLength: 1, maxLength: 160 }),
    dispatchId: Type.String({ minLength: 1, maxLength: 160 }),
    jobId: Type.String({ minLength: 1, maxLength: 160 }),
    itemId: Type.String({ minLength: 1, maxLength: 160 }),
    recipeId: Type.String({ minLength: 1, maxLength: 160 }),
    providerProfileId: Type.String({ minLength: 1, maxLength: 160 }),
    effectiveSpecHash: GenerationSha256Schema,
    attempt: Type.Integer({ minimum: 1 }),
    seed: Type.Integer({ minimum: 0 }),
    preparedHash: GenerationSha256Schema,
    status: GenerationCandidateStatusSchema,
    /** Present only when a private review decision was recorded. */
    reviewNote: Type.Optional(Type.String({ maxLength: 500 })),
    createdAt: Type.String({ maxLength: 40 }),
    updatedAt: Type.String({ maxLength: 40 }),
  },
  { additionalProperties: false },
);

/** One owner-visible private candidate. */
export type GenerationCandidateView = Static<typeof GenerationCandidateViewSchema>;

/** `POST /api/generation/candidates/:id/review` — accept or reject, privately. */
export const CandidateReviewRequestSchema = Type.Object(
  {
    decision: Type.Union([Type.Literal('accept'), Type.Literal('reject')]),
    note: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  },
  { additionalProperties: false },
);

/** One private review decision. */
export type CandidateReviewRequest = Static<typeof CandidateReviewRequestSchema>;

// ---------------------------------------------------------------------------
// Artifact tickets
// ---------------------------------------------------------------------------

/** The artifact classes a runner may hand to the Hub for private review. */
export const GenerationArtifactKindSchema = Type.Union([
  Type.Literal('image'),
  Type.Literal('audio'),
]);

/** One artifact class. */
export type GenerationArtifactKind = Static<typeof GenerationArtifactKindSchema>;

/** `POST /api/generation/runners/artifact` — request a private upload handle. */
export const RunnerArtifactTicketRequestSchema = Type.Object(
  {
    schemaVersion: Type.Literal(GENERATION_RUNNER_SCHEMA_VERSION),
    deviceId: RunnerDeviceIdSchema,
    dispatchId: Type.String({ minLength: 1, maxLength: 160 }),
    attempt: Type.Integer({ minimum: 1 }),
    leaseId: Type.String({ minLength: 1, maxLength: 160 }),
    candidateId: Type.String({ minLength: 1, maxLength: 160 }),
    kind: GenerationArtifactKindSchema,
    mimeType: Type.String({ minLength: 1, maxLength: 120 }),
    /** Hub-side ceiling; a larger artifact is refused before any bytes move. */
    bytes: Type.Integer({ minimum: 1 }),
    sha256: GenerationSha256Schema,
    runnerNow: Type.String({ maxLength: 40 }),
  },
  { additionalProperties: false },
);

/** One artifact ticket request. */
export type RunnerArtifactTicketRequest = Static<typeof RunnerArtifactTicketRequestSchema>;

/**
 * An owner-scoped, expiring handle to a *private* staged artifact.
 *
 * This is deliberately not a publication: nothing here touches
 * `asset_community.ts`, and the only reader is the owning session. If upload
 * is off, the answer is `upload_disabled` and the client shows a local-only
 * result with export/import instead.
 */
export const GenerationArtifactTicketSchema = Type.Object(
  {
    schemaVersion: Type.Literal(GENERATION_RUNNER_SCHEMA_VERSION),
    ticketId: Type.String({ minLength: 1, maxLength: 160 }),
    ownerAccountId: Type.String({ minLength: 1, maxLength: 160 }),
    deviceId: RunnerDeviceIdSchema,
    dispatchId: Type.String({ minLength: 1, maxLength: 160 }),
    candidateId: Type.String({ minLength: 1, maxLength: 160 }),
    kind: GenerationArtifactKindSchema,
    mimeType: Type.String({ minLength: 1, maxLength: 120 }),
    bytes: Type.Integer({ minimum: 1 }),
    sha256: GenerationSha256Schema,
    /** Private staging key — never a public catalog key. */
    stagingKey: Type.String({ minLength: 1, maxLength: 512 }),
    createdAt: Type.String({ maxLength: 40 }),
    expiresAt: Type.String({ maxLength: 40 }),
    uploadedAt: Type.Optional(Type.String({ maxLength: 40 })),
  },
  { additionalProperties: false },
);

/** One artifact ticket. */
export type GenerationArtifactTicket = Static<typeof GenerationArtifactTicketSchema>;

/**
 * The owner-facing view of an uploaded artifact. `retrievalPath` is the
 * owner-scoped read route; it is short-lived and never a catalog URL.
 */
export const GenerationArtifactTicketViewSchema = Type.Object(
  {
    schemaVersion: Type.Literal(GENERATION_RUNNER_SCHEMA_VERSION),
    ticketId: Type.String({ minLength: 1, maxLength: 160 }),
    dispatchId: Type.String({ minLength: 1, maxLength: 160 }),
    candidateId: Type.String({ minLength: 1, maxLength: 160 }),
    kind: GenerationArtifactKindSchema,
    mimeType: Type.String({ minLength: 1, maxLength: 120 }),
    bytes: Type.Integer({ minimum: 1 }),
    sha256: GenerationSha256Schema,
    uploadedAt: Type.String({ maxLength: 40 }),
    expiresAt: Type.String({ maxLength: 40 }),
    retrievalPath: Type.String({ minLength: 1, maxLength: 512 }),
  },
  { additionalProperties: false },
);

/** One owner-facing artifact view. */
export type GenerationArtifactTicketView = Static<typeof GenerationArtifactTicketViewSchema>;

// ---------------------------------------------------------------------------
// Availability — the typed reason AC-3/AC-5 need
// ---------------------------------------------------------------------------

/** Why a creator cannot dispatch right now. */
export const GenerationRunnerUnavailableCodeSchema = Type.Union([
  /** No device is paired to this account yet. */
  Type.Literal('no_runner_paired'),
  /** A device exists but is revoked. */
  Type.Literal('runner_revoked'),
  /** Every paired device is outside the liveness window. */
  Type.Literal('runner_offline'),
  /** The origin/token allowlist refused this origin. */
  Type.Literal('loopback_blocked'),
  /** The Hub is reachable but has no D1 binding. */
  Type.Literal('hub_unconfigured'),
]);

/** One unavailability reason code. */
export type GenerationRunnerUnavailableCode = Static<typeof GenerationRunnerUnavailableCodeSchema>;

/**
 * The transport the creator's session can actually use.
 *
 * A blocked direct-loopback mode resolves here to `paired_outbound` when a
 * device is online, or to an explicit `unavailable` with a code and an
 * actionable `remedy` — never a false success and never a retry loop.
 */
export const GenerationRunnerAvailabilitySchema = Type.Union([
  Type.Object(
    {
      schemaVersion: Type.Literal(GENERATION_RUNNER_SCHEMA_VERSION),
      available: Type.Literal(true),
      mode: GenerationRunnerModeSchema,
      deviceId: RunnerDeviceIdSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      schemaVersion: Type.Literal(GENERATION_RUNNER_SCHEMA_VERSION),
      available: Type.Literal(false),
      mode: Type.Literal('unavailable'),
      code: GenerationRunnerUnavailableCodeSchema,
      /** Creator-facing explanation, safe for a public projection. */
      reason: Type.String({ minLength: 1, maxLength: 500 }),
      /** What the creator does next — never an empty dead end. */
      remedy: Type.String({ minLength: 1, maxLength: 500 }),
    },
    { additionalProperties: false },
  ),
]);

/** The resolved runner transport. */
export type GenerationRunnerAvailability = Static<typeof GenerationRunnerAvailabilitySchema>;

/** Liveness window: a device that has not polled within this is `offline`. */
export const RUNNER_LIVENESS_WINDOW_MS = 120_000;

/** Pairing-code lifetime — short by design. */
export const RUNNER_PAIRING_CODE_TTL_MS = 600_000;

/** Default credential lifetime; a re-pair rotates it. */
export const RUNNER_TOKEN_TTL_MS = 2_592_000_000;

/** Private artifact-ticket lifetime. */
export const RUNNER_ARTIFACT_TICKET_TTL_MS = 3_600_000;

/** Single-artifact ceiling for Hub-side private staging (256 MiB). */
export const RUNNER_ARTIFACT_MAX_BYTES = 268_435_456;
