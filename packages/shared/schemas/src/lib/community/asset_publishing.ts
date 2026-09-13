// packages/shared/schemas/src/lib/community/asset_publishing.ts
//
// C-513 — Community asset publishing wire shapes.
//
// A creator publishes a locally-made asset into a hub-served *community*
// namespace: metadata in D1, raw bytes uploaded to the private intake plane
// (`UPLOADS_BUCKET`, key `staging/<accountId>/<uploadId>`), and only promoted
// into the public content-addressed catalog namespace when a moderator
// approves it.
//
// Two steps, so bytes never travel in a JSON body:
//   1. POST /api/assets/community             — reserve (JSON metadata)
//   2. PUT  /api/assets/community/:slug/upload — raw application/octet-stream
//
// Schema-First law: the static types are re-exported from `@aikami/types`;
// there are no hand-written duplicate shapes.

import { MAX_UPLOAD_SIZE } from '@aikami/constants';
import { type Static, Type } from 'typebox';
import { CatalogCategorySchema } from '../catalog/catalog_index.ts';

/** Longest accepted community-asset title (characters). */
export const COMMUNITY_ASSET_TITLE_MAX_LENGTH = 120;

/** Largest accepted rejection note (characters). */
export const COMMUNITY_ASSET_NOTE_MAX_LENGTH = 500;

/** Url-safe public slug — identical constraint to a community map slug. */
export const CommunityAssetSlugSchema = Type.String({
  pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
  maxLength: 80,
});

/** Resolver tag, e.g. `portraits:hero`. Never shadows a curated catalog tag. */
export const CommunityAssetTagSchema = Type.String({
  pattern: '^[a-z0-9]+(:[a-z0-9_.-]+)+$',
  maxLength: 160,
});

/** Lowercase file extension *including* the dot (`.png`, `.ogg`). */
export const CommunityAssetExtensionSchema = Type.String({
  pattern: '^\\.[a-z0-9]+$',
  maxLength: 12,
});

/** Lowercase hex sha256 — the content address. */
export const CommunityAssetSha256Schema = Type.String({
  pattern: '^[a-f0-9]{64}$',
});

/** Moderation states a `community_assets` row may hold. */
export const COMMUNITY_ASSET_MODERATION_STATES = ['pending', 'approved', 'rejected'] as const;

/** One row's moderation state. */
export const CommunityAssetModerationStateSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('approved'),
  Type.Literal('rejected'),
]);

/** A `community_assets.moderation_state` value. */
export type CommunityAssetModerationState = Static<typeof CommunityAssetModerationStateSchema>;

// ---------------------------------------------------------------------------
// C-518 seam — scoped rights decision
// ---------------------------------------------------------------------------

/**
 * 🔴 C-518 SEAM — this shape is *not* owned by C-513.
 *
 * C-513 must not invent the scoped-rights record; C-518 (`draft`) owns it and
 * adds the real schema to the shared package when it lands. What C-513 needs
 * from it is only that each distribution scope is decided *separately* — so
 * this module declares the structural seam the gate reads and nothing more.
 *
 * C-518 can extend this object with extra fields without touching C-513: the
 * reserve request carries it as an opaque optional object.
 */
export const RightsScopeDecisionSchema = Type.Object({
  /** True only when the evidence substantiates permission for this scope. */
  permitted: Type.Boolean(),
  /** Pointer at the evidence that substantiates the decision (opaque to C-513). */
  evidence: Type.Optional(Type.String()),
});

/** One scoped rights decision (C-518 seam). */
export type RightsScopeDecision = Static<typeof RightsScopeDecisionSchema>;

/** The distribution scopes the publish gate evaluates separately. */
export const RIGHTS_SCOPES = ['inference', 'gameInclusion', 'standaloneDistribution'] as const;

/** One evaluated distribution scope. */
export type RightsScope = (typeof RIGHTS_SCOPES)[number];

/** A scoped rights decision over all three distribution scopes (C-518 seam). */
export const RightsDecisionSchema = Type.Object({
  inference: RightsScopeDecisionSchema,
  gameInclusion: RightsScopeDecisionSchema,
  standaloneDistribution: RightsScopeDecisionSchema,
  /** Free-form evidence pointer for the decision as a whole (C-518-owned). */
  evidence: Type.Optional(Type.String()),
});

/** C-518's scoped rights record (seam — see {@link RightsDecisionSchema}). */
export type RightsDecision = Static<typeof RightsDecisionSchema>;

// ---------------------------------------------------------------------------
// Provenance projection
// ---------------------------------------------------------------------------

/**
 * The redacted provenance projection stored and published with a community
 * asset. Never carries prompts, model ids, local filesystem paths or private
 * reference art — see `redactCommunityProvenance` in `@aikami/utils`.
 */
export const CommunityAssetProvenanceProjectionSchema = Type.Object({
  /** `original`, an upstream URL, or `generated:<provider>`. */
  source: Type.String({ minLength: 1, maxLength: 512 }),
  /** SPDX identifier or `proprietary`. */
  license: Type.Optional(Type.String({ maxLength: 64 })),
  /** Required attribution names. */
  author: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 32 }),
  ),
  /** Share-alike indicator carried through from the source asset. */
  shareAlike: Type.Optional(Type.Boolean()),
  /** Licence/attribution origin URL — never a local filesystem path. */
  sourceUrl: Type.Optional(Type.String({ maxLength: 512 })),
  /** Redacted transformation lineage, e.g. `['generated:sd', 'upscaled:2x']`. */
  lineage: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { maxItems: 32 }),
  ),
});

/** The redacted provenance projection attached to a community asset. */
export type CommunityAssetProvenanceProjection = Static<
  typeof CommunityAssetProvenanceProjectionSchema
>;

// ---------------------------------------------------------------------------
// Reserve (step 1)
// ---------------------------------------------------------------------------

/** Request body for reserving a community-asset publish. */
export const ReserveAssetRequestSchema = Type.Object({
  category: CatalogCategorySchema,
  tag: CommunityAssetTagSchema,
  title: Type.String({ minLength: 1, maxLength: COMMUNITY_ASSET_TITLE_MAX_LENGTH }),
  /** Optional explicit slug; derived from the title when omitted. */
  slug: Type.Optional(CommunityAssetSlugSchema),
  ext: CommunityAssetExtensionSchema,
  /** Declared byte length; must equal the upload's `Content-Length`. */
  sizeBytes: Type.Integer({ minimum: 1, maximum: MAX_UPLOAD_SIZE }),
  provenance: CommunityAssetProvenanceProjectionSchema,
  /** C-518 scoped rights record. Absent ⇒ the gate fails closed. */
  rights: Type.Optional(RightsDecisionSchema),
});

/** Request body for reserving a community-asset publish. */
export type ReserveAssetRequest = Static<typeof ReserveAssetRequestSchema>;

/** Response from a successful reservation. */
export const ReserveAssetResultSchema = Type.Object({
  slug: Type.String({ minLength: 1 }),
  revision: Type.Integer({ minimum: 1 }),
  /** Path the owner must PUT the raw bytes to. */
  uploadPath: Type.String({ minLength: 1 }),
  stagingState: Type.Literal('reserved'),
});

/** Result of a successful reservation. */
export type ReserveAssetResult = Static<typeof ReserveAssetResultSchema>;

/** Response from a committed upload (the publish hop). */
export const PublishAssetResultSchema = Type.Object({
  slug: Type.String({ minLength: 1 }),
  revision: Type.Integer({ minimum: 1 }),
  sha256: CommunityAssetSha256Schema,
  moderationState: Type.Literal('pending'),
  /** Owner-only while pending; the CDN URL once approved + promoted. */
  deliveryUrl: Type.String({ minLength: 1 }),
});

/** Result of a committed community-asset publish. */
export type PublishAssetResult = Static<typeof PublishAssetResultSchema>;

// ---------------------------------------------------------------------------
// Listing / moderation
// ---------------------------------------------------------------------------

/** One community-asset revision as seen by a listing. */
export const CommunityAssetSummarySchema = Type.Object({
  slug: Type.String({ minLength: 1 }),
  revision: Type.Integer({ minimum: 1 }),
  title: Type.String(),
  category: CatalogCategorySchema,
  tag: CommunityAssetTagSchema,
  sha256: CommunityAssetSha256Schema,
  ext: CommunityAssetExtensionSchema,
  sizeBytes: Type.Integer({ minimum: 0 }),
  provenance: CommunityAssetProvenanceProjectionSchema,
  license: Type.Optional(Type.String()),
  moderationState: CommunityAssetModerationStateSchema,
  /** True when the caller owns this revision (drives the owner-only controls). */
  isOwner: Type.Boolean(),
  /** True once the bytes are in the public catalog namespace. */
  promoted: Type.Boolean(),
  /** Present for promoted rows (public) and for the owner's own rows. */
  deliveryUrl: Type.Optional(Type.String({ minLength: 1 })),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

/** One community-asset revision as seen by a listing. */
export type CommunityAssetSummary = Static<typeof CommunityAssetSummarySchema>;

/** Cursor-paginated community-asset listing. */
export const CommunityAssetPageSchema = Type.Object({
  items: Type.Array(CommunityAssetSummarySchema),
  nextCursor: Type.Optional(Type.String({ minLength: 1 })),
});

/** One bounded page of community assets. */
export type CommunityAssetPage = Static<typeof CommunityAssetPageSchema>;

/**
 * Community counters for the community surface only.
 *
 * Deliberately a separate route/shape from C-396's frozen `catalog_stats`
 * schemas (extendable only by C-399).
 */
export const CommunityAssetCountersSchema = Type.Object({
  total: Type.Integer({ minimum: 0 }),
  byCategory: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
});

/** Community-surface counters. */
export type CommunityAssetCounters = Static<typeof CommunityAssetCountersSchema>;

/** Operator moderation transition request. */
export const ModerateCommunityAssetRequestSchema = Type.Object({
  decision: Type.Union([Type.Literal('approved'), Type.Literal('rejected')]),
  note: Type.Optional(Type.String({ maxLength: COMMUNITY_ASSET_NOTE_MAX_LENGTH })),
});

/** Operator moderation transition request. */
export type ModerateCommunityAssetRequest = Static<typeof ModerateCommunityAssetRequestSchema>;

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/** Machine-readable failure codes for the community-asset routes. */
export type CommunityAssetErrorCode =
  | 'unauthorized'
  | 'invalid-argument'
  | 'invalid-slug'
  | 'rights-unresolved'
  | 'rights-denied'
  | 'provenance-local-path'
  | 'attribution-missing'
  | 'slug-taken'
  | 'revision-conflict'
  | 'not-found'
  | 'asset_too_large'
  | 'size-mismatch'
  | 'upload-failed'
  | 'commit-failed'
  | 'not-moderator'
  | 'already-moderated';
