// packages/shared/schemas/src/lib/catalog/release_plan.ts
//
// The two environment-scoped release objects.
//
// ── Why these are not part of CandidateLock ────────────────────────────────
//
// A catalog root hash does not exist until a candidate is combined with an
// environment's VERIFIED previous catalog. Staging and production can
// legitimately carry different unrelated base entries, so their roots differ
// even when the Emberwatch candidate is byte-identical — which is precisely the
// guarantee promotion rests on.
//
//   ReleasePlan     what WOULD be published to one environment. Reproducible
//                   and inspectable before apply; `--plan` writes nothing.
//   ReleaseReceipt  what WAS uploaded/activated. Environment fields live here,
//                   and only here.
//
// Neither is candidate content, and neither may mutate the candidate's bytes.

import { type Static, Type } from 'typebox';

/** One object the plan will write, under its immutable key. */
export const PlannedObjectSchema = Type.Object(
  {
    key: Type.String({ minLength: 1 }),
    hash: Type.String({ minLength: 64, maxLength: 64 }),
    /** What this object is, for an operator reading a diff. */
    role: Type.String({ minLength: 1 }),
    /** Already present at the target — no upload needed. */
    present: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type PlannedObject = Static<typeof PlannedObjectSchema>;

/** Where a plan is aimed. Resolved from the canonical identity table. */
export const ReleaseTargetIdentitySchema = Type.Object(
  {
    mode: Type.String({ minLength: 1 }),
    bucket: Type.String({ minLength: 1 }),
    originUrl: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type ReleaseTargetIdentity = Static<typeof ReleaseTargetIdentitySchema>;

/** The verified base release a plan composes on top of, or null on first publish. */
export const ReleaseBaseSchema = Type.Object(
  {
    releaseId: Type.String({ minLength: 1 }),
    rootHash: Type.String({ minLength: 64, maxLength: 64 }),
  },
  { additionalProperties: false },
);

export type ReleaseBase = Static<typeof ReleaseBaseSchema>;

/** How the candidate's entries combine with the base catalog's. */
export const CatalogMergeSchema = Type.Object(
  {
    carried: Type.Integer({ minimum: 0 }),
    replaced: Type.Integer({ minimum: 0 }),
    added: Type.Integer({ minimum: 0 }),
    retired: Type.Integer({ minimum: 0 }),
    total: Type.Integer({ minimum: 0 }),
    /** Tags the candidate adds, sorted. */
    addedTags: Type.Array(Type.String()),
    /** Tags the candidate replaces, sorted. */
    replacedTags: Type.Array(Type.String()),
    /** Tags explicitly retired by this release, sorted. */
    retiredTags: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

export type CatalogMerge = Static<typeof CatalogMergeSchema>;

/** What a plan intends to publish to one environment. */
export const ReleasePlanSchema = Type.Object(
  {
    schemaVersion: Type.Literal('release.plan.v1'),
    /** The candidate this plan publishes. */
    candidateLockHash: Type.String({ minLength: 64, maxLength: 64 }),
    target: ReleaseTargetIdentitySchema,
    /** null means first publish at this origin. */
    base: Type.Union([ReleaseBaseSchema, Type.Null()]),

    merge: CatalogMergeSchema,

    /** Every immutable object the release consists of, with presence resolved. */
    objects: Type.Array(PlannedObjectSchema),
    /** Objects that still need uploading. */
    uploadsRequired: Type.Integer({ minimum: 0 }),

    /** Root index hash this plan would activate. */
    catalogRootHash: Type.String({ minLength: 64, maxLength: 64 }),
    /** Shard key → hash. */
    catalogShards: Type.Record(Type.String(), Type.String()),
    /** The per-pack installed lock, when one was produced. */
    packLockHash: Type.String(),

    /** Rights/content gate state carried from the candidate, re-asserted here. */
    rightsPassed: Type.Boolean(),
    surfacePassed: Type.Boolean(),

    createdAt: Type.String({ minLength: 1 }),
    /** sha256 over the plan's decision fields, EXCLUDING `createdAt`. */
    planHash: Type.String({ minLength: 64, maxLength: 64 }),
  },
  { additionalProperties: false },
);

export type ReleasePlan = Static<typeof ReleasePlanSchema>;

/**
 * Plan fields that participate in `planHash`.
 *
 * Excludes `createdAt` and `uploadsRequired`/`objects[].present`: whether an
 * object is already uploaded is a property of the moment, not of the decision.
 * Two plans that would publish the same bytes must hash identically whether or
 * not a previous attempt got partway.
 */
export const RELEASE_PLAN_HASH_FIELDS = [
  'schemaVersion',
  'candidateLockHash',
  'target',
  'base',
  'merge',
  'catalogRootHash',
  'catalogShards',
  'packLockHash',
  'rightsPassed',
  'surfacePassed',
] as const;

/** One phase's outcome, so a receipt is machine-readable rather than scraped. */
export const ReleasePhaseResultSchema = Type.Object(
  {
    phase: Type.String({ minLength: 1 }),
    ok: Type.Boolean(),
    /** Populated when `ok` is false. */
    error: Type.String(),
    /** sha256 of the phase's structured result. */
    digest: Type.String(),
  },
  { additionalProperties: false },
);

export type ReleasePhaseResult = Static<typeof ReleasePhaseResultSchema>;

/** What actually happened in one environment. */
export const ReleaseReceiptSchema = Type.Object(
  {
    schemaVersion: Type.Literal('release.receipt.v1'),
    candidateLockHash: Type.String({ minLength: 64, maxLength: 64 }),
    planHash: Type.String({ minLength: 64, maxLength: 64 }),
    mode: Type.String({ minLength: 1 }),
    bucket: Type.String({ minLength: 1 }),
    originUrl: Type.String({ minLength: 1 }),

    /** The pointer before this run, or '' on first publish. */
    previousReleaseId: Type.String(),
    /** The pointer after activation, or '' when activation did not happen. */
    releaseId: Type.String(),

    catalogRootHash: Type.String(),
    catalogShards: Type.Record(Type.String(), Type.String()),
    dependencies: Type.Array(PlannedObjectSchema),
    packLockHash: Type.String(),

    /**
     * Whether the release pointer was advanced. False on any pre-activation
     * failure — the previous complete release stays authoritative.
     */
    activated: Type.Boolean(),
    /** The exact release graph was already active, so the pointer was not advanced. */
    alreadyActive: Type.Boolean(),
    /**
     * The mutable legacy compatibility alias. Reported separately and never
     * conflated with activation: a failed alias write leaves the immutable
     * release valid and active, and rolling it back would be wrong.
     */
    legacyAliasWritten: Type.Boolean(),
    legacyAliasError: Type.String(),

    /** Remote re-resolution of the new release, using the client's resolver. */
    verified: Type.Boolean(),
    verificationError: Type.String(),

    phases: Type.Array(ReleasePhaseResultSchema),
    startedAt: Type.String({ minLength: 1 }),
    finishedAt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type ReleaseReceipt = Static<typeof ReleaseReceiptSchema>;
