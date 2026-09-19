// packages/shared/schemas/src/lib/catalog/candidate_lock.ts
//
// Immutable release-candidate lock (C-496 follow-up).
//
// ── Why ────────────────────────────────────────────────────────────────────
//
// "Promote the same candidate from staging to production" is only meaningful if
// both environments can be shown to be publishing the SAME bytes. Rebuilding
// content per environment cannot demonstrate that: a rebuild can differ by a
// regenerated map, a re-run acceptance decision, or a different timestamp, and
// nothing would notice.
//
// The lock is that proof. It is written once, when the candidate is sealed, and
// every later step — staging publish, staging verify, production promotion —
// consumes it rather than recomputing content. Promotion compares the lock
// hash-for-hash and refuses when any candidate byte differs.
//
// ── What it identifies ─────────────────────────────────────────────────────
//
// Immutable INPUT/OUTPUT identity, keyed by LOGICAL id — never a transient
// path, an mtime, or a build directory. A lock is therefore reproducible from
// the same content on any machine, which is what makes "same candidate"
// checkable rather than asserted.
//
// Generation and candidate creation are separate from environment publication:
// the lock carries no bucket, no origin and no environment. Those belong to the
// publish step, and putting them here would make the lock environment-specific
// — exactly what it exists to prevent.

import { type Static, Type } from 'typebox';

/** One content-addressed artifact, keyed by logical id. */
export const CandidateArtifactSchema = Type.Object(
  {
    /** Stable logical id (a catalog tag, a map id, a slot name). */
    id: Type.String({ minLength: 1 }),
    /** sha256 of the bytes. */
    sha256: Type.String({ minLength: 64, maxLength: 64 }),
    sizeBytes: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type CandidateArtifact = Static<typeof CandidateArtifactSchema>;

/** A group of artifacts with a roll-up hash over the sorted set. */
export const CandidateGroupSchema = Type.Object(
  {
    /** Number of artifacts in the group. */
    count: Type.Integer({ minimum: 0 }),
    /**
     * sha256 over the sorted `id:sha256` lines. The roll-up is what promotion
     * compares; the members are what a human reads when it disagrees.
     */
    digest: Type.String({ minLength: 64, maxLength: 64 }),
    artifacts: Type.Array(CandidateArtifactSchema),
  },
  { additionalProperties: false },
);

export type CandidateGroup = Static<typeof CandidateGroupSchema>;

/**
 * One gate's recorded outcome.
 *
 * A gate is `passed` only with the digest of the run that produced it, so a
 * later reader can tell "this was checked and passed" from "this field was
 * defaulted".
 */
export const CandidateGateSchema = Type.Object(
  {
    passed: Type.Boolean(),
    /** sha256 of the gate's full report, or '' when it did not produce one. */
    digest: Type.String({ description: "sha256 of the gate's report, '' when none" }),
    /** Short human summary, e.g. "74 artifacts, 0 blocked". */
    summary: Type.String(),
  },
  { additionalProperties: false },
);

export type CandidateGate = Static<typeof CandidateGateSchema>;

/** The sealed release candidate. */
export const CandidateLockSchema = Type.Object(
  {
    schemaVersion: Type.Literal('candidate.lock.v1'),

    // ── Provenance ────────────────────────────────────────────────────────
    /** The commit the candidate was built from. */
    sourceCommit: Type.String({ minLength: 7 }),
    /** True when the worktree was dirty at seal time. A dirty seal is not reproducible. */
    sourceDirty: Type.Boolean(),
    packId: Type.String({ minLength: 1 }),
    packVersion: Type.String({ minLength: 1 }),
    /** ISO timestamp of sealing. Metadata only — never part of any content hash. */
    sealedAt: Type.String({ minLength: 1 }),

    // ── Content groups ────────────────────────────────────────────────────
    /** The pack manifest itself. */
    manifest: CandidateGroupSchema,
    maps: CandidateGroupSchema,
    /** The terrain tileset image + its frame definition. */
    terrainAtlas: CandidateGroupSchema,
    /** Every prop-atlas page plus its metadata. */
    propAtlas: CandidateGroupSchema,
    portraits: CandidateGroupSchema,
    /** Non-LPC enemy world visuals. */
    enemyVisuals: CandidateGroupSchema,
    audio: CandidateGroupSchema,
    /** Pack-authored JSON (quests, evidence, dialogue). */
    packData: CandidateGroupSchema,
    /** The compact boot seed the client fetches. */
    assetSeed: CandidateGroupSchema,
    /** Attribution/provenance inputs. */
    credits: CandidateGroupSchema,

    // ── Release-plane identity ────────────────────────────────────────────
    /** Root catalog index hash, or '' before the index is generated. */
    catalogRootHash: Type.String(),
    /** Shard key → hash, as published. */
    catalogShards: Type.Record(Type.String(), Type.String()),
    /** The per-pack installed lock hash, or '' when none was produced. */
    packLockHash: Type.String(),

    // ── Gate outcomes ─────────────────────────────────────────────────────
    rights: CandidateGateSchema,
    validation: CandidateGateSchema,

    /**
     * sha256 over every content group and the release-plane hashes, EXCLUDING
     * `sealedAt`. This is the value staging and production compare.
     */
    lockHash: Type.String({ minLength: 64, maxLength: 64 }),
  },
  { additionalProperties: false },
);

export type CandidateLock = Static<typeof CandidateLockSchema>;

/**
 * The fields that participate in `lockHash`.
 *
 * Deliberately excludes `sealedAt` and `sourceDirty`: two seals of identical
 * content minutes apart are the SAME candidate, and a promotion must not fail
 * because a clock moved or a scratch file was edited. `sourceCommit` IS
 * included — a different commit is a different candidate even when the bytes
 * happen to match, because the next rebuild would not be reproducible.
 */
export const CANDIDATE_LOCK_HASH_FIELDS = [
  'schemaVersion',
  'sourceCommit',
  'packId',
  'packVersion',
  'manifest',
  'maps',
  'terrainAtlas',
  'propAtlas',
  'portraits',
  'enemyVisuals',
  'audio',
  'packData',
  'assetSeed',
  'credits',
  'catalogRootHash',
  'catalogShards',
  'packLockHash',
  'rights',
  'validation',
] as const;
