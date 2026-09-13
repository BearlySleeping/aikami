// packages/shared/schemas/src/lib/generation/generation_provenance.ts
//
// C-518: durable generation lineage and candidate/acceptance records.
//
// The `GeneratedAsset` descriptor (C-510) answers "what is this and where did
// it come from". This module answers the question a creator asks months later:
// *with exactly which inputs was this produced, what was done to it, and under
// what intended-use rights was it accepted?*
//
// Three rules shape the shapes below:
//
//   1. **Record, never fabricate.** A hosted provider that exposes only a model
//      version and a request id gets exactly those fields and an explicit
//      `limitation` — never an invented weight hash. Immutable revisions and
//      verified artifact hashes are recorded only when they are actually known.
//   2. **Real measurements, separate from requests.** `request` carries C-517's
//      requested/effective/measured audit; the `media` block carries only what
//      was measured about the actual bytes.
//   3. **Legacy is `unknown`, not backfilled.** A pre-C-518 row has no invented
//      lineage: `provenanceState: 'unknown'` and nothing else.
//
// Contract: C-518 Generation provenance and candidate records

import { type Static, Type } from 'typebox';
import { RightsDecisionSchema } from '../community/asset_publishing.ts';
import { GenerationEngineIdSchema } from './asset_recipe.ts';
import { GenerationRequestAuditSchema } from './generation_request_audit.ts';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Lowercase hex sha256 — byte identity is always SHA-256. */
export const GenerationSha256Schema = Type.String({ pattern: '^[a-f0-9]{64}$' });

/** The current provenance record version. Bump only for a breaking change. */
export const GENERATION_PROVENANCE_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Model / LoRA artifacts
// ---------------------------------------------------------------------------

/**
 * One base model or LoRA the generation depended on.
 *
 * A local run can prove byte identity (`artifactHash`). A hosted provider
 * usually cannot: record `revision` + `requestId` and state the limitation
 * rather than inventing a hash that was never observed.
 */
export const GenerationModelArtifactSchema = Type.Object({
  /** Model identifier, e.g. a `models.manifest.json` entry id. */
  id: Type.String({ minLength: 1, maxLength: 200 }),
  /** Provider/engine kind — pinned here so a later reader needs no context. */
  kind: Type.Union([
    Type.Literal('base'),
    Type.Literal('lora'),
    Type.Literal('vae'),
    Type.Literal('other'),
  ]),
  /** Immutable revision when the provider exposes one (commit sha, tag). */
  revision: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  /** Verified SHA-256 of the local weight file. Never fabricated. */
  artifactHash: Type.Optional(GenerationSha256Schema),
  /** True when the weights live behind a hosted provider and are unverifiable. */
  hosted: Type.Optional(Type.Boolean()),
  /** The only handle a hosted provider gives the caller. */
  requestId: Type.Optional(Type.String({ maxLength: 256 })),
  /** LoRA strength, when applicable. */
  multiplier: Type.Optional(Type.Number()),
  /** Explicit statement of what could not be verified. */
  limitation: Type.Optional(Type.String({ maxLength: 500 })),
});

/** One model/LoRA artifact in the provenance chain. */
export type GenerationModelArtifact = Static<typeof GenerationModelArtifactSchema>;

// ---------------------------------------------------------------------------
// Versions, transformation chain, references
// ---------------------------------------------------------------------------

/** Engine / server / workflow versions in force for this run. */
export const GenerationVersionsSchema = Type.Object({
  engine: Type.Optional(Type.String({ maxLength: 120 })),
  server: Type.Optional(Type.String({ maxLength: 120 })),
  workflow: Type.Optional(Type.String({ maxLength: 200 })),
  /** Hash of the declarative workflow/recipe document used. */
  workflowHash: Type.Optional(GenerationSha256Schema),
});

/** Versions describing the runtime that produced the record. */
export type GenerationVersions = Static<typeof GenerationVersionsSchema>;

/**
 * One step in the transformation chain: generation, upscale, audio prepare,
 * metadata strip. Names the processor so a changed processor descriptor is a
 * detectable provenance change (AC-3).
 */
export const GenerationTransformationSchema = Type.Object({
  /** Operation label, e.g. `generated:sdcpp`, `upscaled:2x`, `prepared:png`. */
  operation: Type.String({ minLength: 1, maxLength: 120 }),
  /** Stable descriptor of the processor (id + version), when one exists. */
  processor: Type.Optional(Type.String({ maxLength: 300 })),
  /** SHA-256 of the processor descriptor — the drift detector. */
  processorHash: Type.Optional(GenerationSha256Schema),
  /** Input/output byte identity for this step. */
  inputHash: Type.Optional(GenerationSha256Schema),
  outputHash: Type.Optional(GenerationSha256Schema),
  /** ISO-8601 timestamp. */
  at: Type.Optional(Type.String({ maxLength: 40 })),
});

/** One transformation step. */
export type GenerationTransformation = Static<typeof GenerationTransformationSchema>;

/**
 * A private reference pointer (source image, mask, style sheet).
 *
 * `pointer` is a private locator (local path, job key). It is deliberately
 * excluded from every public projection.
 */
export const GenerationReferenceSchema = Type.Object({
  role: Type.Union([
    Type.Literal('image'),
    Type.Literal('audio'),
    Type.Literal('mask'),
    Type.Literal('style'),
    Type.Literal('other'),
  ]),
  /** SHA-256 of the reference bytes — the shareable half of the reference. */
  sha256: GenerationSha256Schema,
  /** Private locator. Never redacted into a public projection. */
  pointer: Type.Optional(Type.String({ maxLength: 2048 })),
  /** Free-form note, e.g. `pose reference`. */
  note: Type.Optional(Type.String({ maxLength: 200 })),
});

/** One private reference in the provenance chain. */
export type GenerationReference = Static<typeof GenerationReferenceSchema>;

// ---------------------------------------------------------------------------
// Provenance record
// ---------------------------------------------------------------------------

/** The measured properties of the actual prepared artifact. */
export const GenerationMediaPropertiesSchema = Type.Object({
  mimeType: Type.String({ minLength: 1, maxLength: 120 }),
  sizeBytes: Type.Integer({ minimum: 1 }),
  /** Measured pixel dimensions (image/video). */
  width: Type.Optional(Type.Integer({ minimum: 1 })),
  height: Type.Optional(Type.Integer({ minimum: 1 })),
  /** Measured duration in seconds (audio/video). */
  durationSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  /** Measured sample rate in Hz (audio). */
  sampleRateHz: Type.Optional(Type.Integer({ minimum: 1 })),
});

/** Measured media properties. */
export type GenerationMediaProperties = Static<typeof GenerationMediaPropertiesSchema>;

/** How much of a record's lineage is actually known. */
export const GENERATION_PROVENANCE_STATES = ['captured', 'unknown'] as const;

/** Whether a record captured its lineage or is a pre-contract row. */
export const GenerationProvenanceStateSchema = Type.Union([
  Type.Literal('captured'),
  Type.Literal('unknown'),
]);

/** Whether a record captured its lineage or is a pre-contract row. */
export type GenerationProvenanceState = Static<typeof GenerationProvenanceStateSchema>;

/** The batch/job producing this candidate — an opaque C-519 link. */
export const GenerationJobIdSchema = Type.String({ minLength: 1, maxLength: 160 });

/** A registry tag (`AssetRefSchema.tag`). */
export const GenerationTagSchema = Type.String({
  pattern: '^[a-z0-9]+(:[a-z0-9_.-]+)+$',
  maxLength: 160,
});

/**
 * The durable private lineage of one generated candidate (v1).
 *
 * Additive by design: a later version may add fields, and readers of v1 keep
 * working. Unknown fields are not silently dropped — the record is stored
 * verbatim and validated on write.
 */
export const GenerationProvenanceSchema = Type.Object({
  /** Record version — see {@link GENERATION_PROVENANCE_SCHEMA_VERSION}. */
  schemaVersion: Type.Integer({ minimum: 1, maximum: 64 }),
  /** Immutable candidate identity. Display labels are never identity. */
  candidateId: Type.String({ minLength: 1, maxLength: 160 }),
  /** Opaque link to the C-519 durable job record (owned by C-519). */
  jobId: Type.Optional(GenerationJobIdSchema),
  /** The registry tag this candidate is intended for. */
  tag: GenerationTagSchema,
  /** Producing engine. */
  engine: GenerationEngineIdSchema,
  /** Recipe id + document hash — the "production input lock". */
  recipeId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  recipeHash: Type.Optional(GenerationSha256Schema),
  /** Fixed or engine-chosen seed, when one exists. */
  seed: Type.Optional(Type.Integer()),
  /** Engine/server/workflow versions in force. */
  versions: Type.Optional(GenerationVersionsSchema),
  /** Base models, VAEs and LoRAs, with whatever can be proven about them. */
  models: Type.Array(GenerationModelArtifactSchema, { maxItems: 64 }),
  /** The C-517 requested/effective/measured parameter audit. */
  request: Type.Optional(GenerationRequestAuditSchema),
  /** The original user prompt — PRIVATE, never projected publicly. */
  prompt: Type.Optional(Type.String({ maxLength: 8000 })),
  /** Private reference artifacts (pose/style/mask sources). */
  references: Type.Array(GenerationReferenceSchema, { maxItems: 64 }),
  /** Raw engine output hash, before preparation. */
  rawHash: GenerationSha256Schema,
  /** Prepared artifact hash — the hash an acceptance binds to. */
  preparedHash: GenerationSha256Schema,
  /** Ordered transformation chain from raw to prepared. */
  transformations: Type.Array(GenerationTransformationSchema, { maxItems: 64 }),
  /** Measured properties of the prepared artifact. */
  media: GenerationMediaPropertiesSchema,
  /** Scoped rights decisions for this candidate (C-518 seam). */
  rights: RightsDecisionSchema,
  /** `captured` for a C-518 record; `unknown` for a legacy row. */
  provenanceState: GenerationProvenanceStateSchema,
  /** ISO-8601 creation timestamp. */
  createdAt: Type.String({ maxLength: 40 }),
});

/** The durable private lineage of one generated candidate. */
export type GenerationProvenance = Static<typeof GenerationProvenanceSchema>;

// ---------------------------------------------------------------------------
// Candidate + acceptance records
// ---------------------------------------------------------------------------

/**
 * Candidate status is deliberately separate from job status: a job can finish
 * while its candidate is still `pending_review`.
 */
export const CANDIDATE_STATUSES = ['pending_review', 'accepted', 'rejected', 'superseded'] as const;

/** One candidate review state. */
export const CandidateStatusSchema = Type.Union([
  Type.Literal('pending_review'),
  Type.Literal('accepted'),
  Type.Literal('rejected'),
  Type.Literal('superseded'),
]);

/** One candidate review state. */
export type CandidateStatus = Static<typeof CandidateStatusSchema>;

/** What a candidate row tracks independently of its provenance record. */
export const CandidateRecordSchema = Type.Object({
  /** Immutable candidate identity. */
  candidateId: Type.String({ minLength: 1, maxLength: 160 }),
  /** The registry tag this candidate is intended for. */
  tag: GenerationTagSchema,
  /** Opaque C-519 job link, when one exists. */
  jobId: Type.Optional(GenerationJobIdSchema),
  status: CandidateStatusSchema,
  /** The prepared hash the candidate currently carries. */
  preparedHash: GenerationSha256Schema,
  provenanceState: GenerationProvenanceStateSchema,
  /** Present when this candidate replaced another accepted candidate. */
  revisionOf: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  /** Human-readable note from the review decision. */
  note: Type.Optional(Type.String({ maxLength: 500 })),
  createdAt: Type.String({ maxLength: 40 }),
  updatedAt: Type.String({ maxLength: 40 }),
});

/** What a candidate row tracks independently of its provenance record. */
export type CandidateRecord = Static<typeof CandidateRecordSchema>;

/**
 * An acceptance binds an immutable candidate to *exact bytes*.
 *
 * Both hashes are recorded: changing the prepared bytes, or the validation
 * report the acceptance rested on, invalidates the acceptance without deleting
 * the accepted content.
 */
export const AcceptanceRecordSchema = Type.Object({
  acceptanceId: Type.String({ minLength: 1, maxLength: 160 }),
  candidateId: Type.String({ minLength: 1, maxLength: 160 }),
  /** The exact prepared hash accepted. Changed bytes invalidate acceptance. */
  preparedHash: GenerationSha256Schema,
  /** Hash of the validation report the acceptance rested on. */
  validationReportHash: GenerationSha256Schema,
  acceptedAt: Type.String({ maxLength: 40 }),
  /** The exact transformation chain hash at acceptance (AC-3 drift check). */
  transformationHash: GenerationSha256Schema,
});

/** An acceptance record binding a candidate to exact prepared bytes. */
export type AcceptanceRecord = Static<typeof AcceptanceRecordSchema>;
