// packages/shared/schemas/src/lib/catalog/candidate_lock.ts
//
// Immutable release-candidate identity (C-496 follow-up).
//
// ── The three objects, and why they are separate ───────────────────────────
//
//   1. CandidateLock   — the immutable CONTENT being promoted. Environment-
//                        neutral: no bucket, no origin, no mode, and no
//                        release-plane hashes.
//   2. ReleasePlan     — CandidateLock + a verified base release → the exact
//                        objects that WOULD be published to one environment.
//   3. ReleaseReceipt  — what was ACTUALLY uploaded/activated in one
//                        environment.
//
// An earlier revision collapsed all three into one schema and filled the
// release-plane fields with `""` / `{}` placeholders. That is not merely
// untidy: it made a content object claim to describe a published release, so
// the lock could be "verified" while describing nothing that had been
// published. A catalog root hash does not exist until a candidate is combined
// with an environment's verified previous catalog — so it cannot belong to the
// object that exists before staging.
//
// ── Source identity, and the self-reference ────────────────────────────────
//
// A lock stored INSIDE the commit it describes is circular:
//
//   commit contains candidate.lock.json
//   candidate.lock.json contains the commit SHA
//   changing the file changes the commit SHA
//
// The earlier revision "solved" this by committing a lock that pointed at an
// older commit — which is permanently stale the instant it is committed, and
// silently describes a source tree nobody is promoting.
//
// The lock is therefore NOT committed. It is a release artifact written under
// `.local/releases/` (gitignored, alongside the existing workspace plane) from
// a CLEAN committed source state. That removes the cycle outright, so
// `source.commit` is genuinely the commit the bytes came from, and
// `source.tree` lets a verifier re-derive the source set independently with
// `git rev-parse <commit>^{tree}`.
//
// There is deliberately no `sourceDirty` field. Sealing refuses a dirty tree,
// so a sealed lock recording `dirty: true` is an impossible state — and a field
// that can only ever hold one value is not information.

import { type Static, Type } from 'typebox';

/** One content-addressed artifact, keyed by logical id. */
export const CandidateArtifactSchema = Type.Object(
  {
    /** Stable logical id (a manifest tag, a map id, a slot name). */
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
    count: Type.Integer({ minimum: 0 }),
    /**
     * sha256 over the sorted `id:sha256` lines. The roll-up is what a
     * promotion compares; the members are what a human reads when it disagrees.
     */
    digest: Type.String({ minLength: 64, maxLength: 64 }),
    artifacts: Type.Array(CandidateArtifactSchema),
  },
  { additionalProperties: false },
);

export type CandidateGroup = Static<typeof CandidateGroupSchema>;

/** Where the candidate's bytes came from. Independently re-derivable. */
export const CandidateSourceSchema = Type.Object(
  {
    /** Commit the candidate was sealed from. Clean by construction. */
    commit: Type.String({ minLength: 7 }),
    /** `git rev-parse <commit>^{tree}` — the source set a verifier re-derives. */
    tree: Type.String({ minLength: 7 }),
  },
  { additionalProperties: false },
);

export type CandidateSource = Static<typeof CandidateSourceSchema>;

/**
 * One gate's recorded outcome.
 *
 * `digest` is the sha256 of the gate's canonicalised report, so a later reader
 * can tell "this was checked and passed" from "this field was defaulted", and
 * two runs with different findings cannot share a digest.
 */
export const CandidateGateSchema = Type.Object(
  {
    passed: Type.Boolean(),
    /** sha256 of the gate's canonical report. Never a reused input hash. */
    digest: Type.String({ minLength: 64, maxLength: 64 }),
    /** Short human summary, e.g. "74 artifacts, 0 blocked". */
    summary: Type.String(),
  },
  { additionalProperties: false },
);

export type CandidateGate = Static<typeof CandidateGateSchema>;

/**
 * The semantic role of a group member.
 *
 * Declared so that "missing" is a decidable question rather than "the file
 * happened not to exist and we filtered it out". A REQUIRED member that is
 * absent fails sealing; the other roles are expected to be supplied by a later
 * stage, and their absence is not an error here.
 */
export const CANDIDATE_MEMBER_ROLES = [
  /** Must be present in the candidate. Absence fails sealing. */
  'required',
  /** Authored in-repo, present in the candidate. */
  'optional',
  /** Produced during publication (catalog index, pack lock). Not candidate content. */
  'derived-at-release',
  /** Supplied by the verified base release when the checkout no longer holds it. */
  'carried-from-base-release',
] as const;

export type CandidateMemberRole = (typeof CANDIDATE_MEMBER_ROLES)[number];

/** The sealed release candidate — immutable CONTENT identity. */
export const CandidateLockSchema = Type.Object(
  {
    schemaVersion: Type.Literal('candidate.lock.v2'),

    // ── Provenance ────────────────────────────────────────────────────────
    source: CandidateSourceSchema,
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
    /** Portraits this pack authors and binds. */
    portraits: CandidateGroupSchema,
    /** Authored non-LPC world visuals (enemy and otherwise). */
    enemyVisuals: CandidateGroupSchema,
    audio: CandidateGroupSchema,
    /**
     * The compact boot seed and offline-core declaration the client ships.
     *
     * These are GENERATED, not authored, and they were previously outside the
     * candidate entirely — so two candidates whose seeds differed (a different
     * asset set, a different origin stamp) shared one `lockHash`, and a
     * promotion could not tell them apart. They are deterministic outputs of
     * the same scan the other groups come from, so they belong here.
     */
    seed: CandidateGroupSchema,

    // ── Gates ─────────────────────────────────────────────────────────────
    rights: CandidateGateSchema,
    surface: CandidateGateSchema,

    /**
     * sha256 over every content group, the source identity and the gates,
     * EXCLUDING `sealedAt`. This is the value staging and production compare.
     */
    lockHash: Type.String({ minLength: 64, maxLength: 64 }),
  },
  { additionalProperties: false },
);

export type CandidateLock = Static<typeof CandidateLockSchema>;

/**
 * The fields that participate in `lockHash`.
 *
 * Excludes `sealedAt`: two seals of identical content minutes apart are the
 * SAME candidate, and a promotion must not fail because a clock moved.
 *
 * Includes `source`: a different commit is a different candidate even when the
 * bytes happen to match, because the next rebuild would not be reproducible.
 */
export const CANDIDATE_LOCK_HASH_FIELDS = [
  'schemaVersion',
  'source',
  'packId',
  'packVersion',
  'manifest',
  'maps',
  'terrainAtlas',
  'propAtlas',
  'portraits',
  'enemyVisuals',
  'audio',
  'seed',
  'rights',
  'surface',
] as const;

/**
 * The content groups, for a comparison that names what moved.
 *
 * There is deliberately no "authoredData" group. Every authored pack file is
 * either the manifest or a map — both already own a group — so such a group
 * would be permanently empty, and an always-empty group cannot report that
 * something inside it changed. A pack that later ships independent authored
 * files (quests, dialogue) adds a group then, explicitly.
 */
export const CANDIDATE_GROUPS = [
  'manifest',
  'maps',
  'terrainAtlas',
  'propAtlas',
  'portraits',
  'enemyVisuals',
  'audio',
  'seed',
] as const satisfies readonly (keyof CandidateLock)[];

export type CandidateGroupName = (typeof CANDIDATE_GROUPS)[number];
