// packages/shared/schemas/src/lib/generation/media_validation.ts
//
// Deterministic media-preparation results and QA findings (C-520).
//
// A prepared artifact is only useful if a reviewer can answer three questions
// without trusting prose: *which raw bytes* were the input, *which processor
// version* produced the output, and *which checks failed*. This module carries
// exactly that — raw/prepared SHA-256, profile id+version, machine findings and
// an explicit manual-review flag.
//
// Contract: C-520 Versioned image workflows and asset preparation

import { type Static, Type } from 'typebox';

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

/** Severity of one machine finding. `error` fails the machine gate. */
export const MediaFindingSeveritySchema = Type.Union([
  Type.Literal('info'),
  Type.Literal('warning'),
  Type.Literal('error'),
]);

export type MediaFindingSeverity = Static<typeof MediaFindingSeveritySchema>;

/**
 * One machine finding. `code` is a stable identifier from
 * `MEDIA_VALIDATION_CODES` so a rejection reason is auditable and scriptable —
 * never a free-text surprise.
 */
export const MediaValidationFindingSchema = Type.Object({
  code: Type.String({ minLength: 1 }),
  severity: MediaFindingSeveritySchema,
  message: Type.String({ minLength: 1 }),
  /** Measured value behind the finding, when there is one. */
  measured: Type.Optional(Type.Number()),
  /** Limit the measurement was compared against, when there is one. */
  limit: Type.Optional(Type.Number()),
});

export type MediaValidationFinding = Static<typeof MediaValidationFindingSchema>;

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/** Ground-contact origin of a prepared artifact, in its own pixel space. */
export const GroundContactSchema = Type.Object({
  x: Type.Integer({ minimum: 0 }),
  y: Type.Integer({ minimum: 0 }),
});

export type GroundContact = Static<typeof GroundContactSchema>;

/**
 * The complete, self-describing record of one preparation run. Written beside
 * the prepared artifact so a later reviewer (or C-518's provenance chain) can
 * re-derive the decision without the raw bytes.
 */
export const MediaValidationReportSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  /** Profile that drove the run. */
  profileId: Type.String({ minLength: 1 }),
  profileVersion: Type.String({ minLength: 1 }),
  /**
   * Stable processor identity — `deterministic` for the pure preparation
   * kernel, or the id of a stochastic model that contributed (e.g. a
   * segmentation model). Recorded separately so a stochastic step can never
   * masquerade as a deterministic one.
   */
  processor: Type.Object({
    id: Type.String({ minLength: 1 }),
    version: Type.String({ minLength: 1 }),
    deterministic: Type.Boolean(),
  }),
  /** SHA-256 of the raw source bytes (lowercase hex). */
  inputSha256: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  /** SHA-256 of the prepared bytes (lowercase hex). */
  outputSha256: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }),
  groundContact: Type.Optional(GroundContactSchema),
  /** Operation steps applied, in order, as `op` discriminants. */
  operations: Type.Array(Type.String({ minLength: 1 })),
  /** True only when no `error` finding was produced. */
  machinePassed: Type.Boolean(),
  findings: Type.Array(MediaValidationFindingSchema),
  /** Geometry checks alone do not prove visual/temporal coherence. */
  manualReviewRequired: Type.Boolean(),
  /** Why manual review is required — often empty when it is not. */
  manualReviewReasons: Type.Array(Type.String({ minLength: 1 })),
});

export type MediaValidationReport = Static<typeof MediaValidationReportSchema>;

/** A prepared artifact plus the report that justifies it. */
export const PreparedMediaArtifactSchema = Type.Object({
  bytesLength: Type.Integer({ minimum: 0 }),
  sha256: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  ext: Type.String({ pattern: '^\\.[a-z0-9]+$' }),
  width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }),
  report: MediaValidationReportSchema,
});

export type PreparedMediaArtifact = Static<typeof PreparedMediaArtifactSchema>;
