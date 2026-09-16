// packages/shared/schemas/src/lib/community/theme_publishing.ts
//
// C-530 — Hub theme publishing and installation wire shapes.
//
// A theme is deliberately **not** a `CatalogCategory`. A theme package is a
// bounded ZIP whose manifest carries `kind: 'aikami-theme'`; widening
// `CatalogCategorySchema` would also make a zip a valid background image,
// studio category and generation recipe — the exact "zip disguised as an
// asset" outcome C-530's Architecture Directive 1 forbids. So the theme
// surface has its own kind discriminator, its own routes
// (`/api/assets/themes*`) and its own shapes here.
//
// 🔴 Removal is NOT a moderation state. `COMMUNITY_ASSET_MODERATION_STATES` is
// declared twice and both declarations are closed (the schema union and the D1
// CHECK constraint), and SQLite cannot alter a CHECK in place. A withdrawn
// version is expressed as a separate `revokedAt` marker: public delivery and
// listing both refuse it, the moderator audit trail survives, and an
// already-installed pack keeps working offline.
//
// Schema-First law: the static types are re-exported from `@aikami/types`;
// there are no hand-written duplicate shapes.

import {
  THEME_API_RANGE_PATTERN,
  THEME_ID_PATTERN,
  THEME_VERSION_PATTERN,
} from '@aikami/constants';
import { type Static, Type } from 'typebox';
import { CATALOG_SHA256_PATTERN } from '../catalog/hash.ts';
import { CommunityAssetProvenanceProjectionSchema } from './asset_publishing.ts';

/** Lowercase hex sha256 — the content address. */
export const ThemePackageSha256Schema = Type.String({ pattern: CATALOG_SHA256_PATTERN });

/** Longest accepted theme display name. */
export const THEME_NAME_MAX_LENGTH = 64;

/** Longest accepted revocation/rejection note. */
export const THEME_NOTE_MAX_LENGTH = 500;

/** The extension a theme package upload carries. */
export const THEME_PACKAGE_EXTENSION = '.zip';

/** Url-safe theme id — identical constraint to the package manifest `id`. */
export const ThemeIdSchema = Type.String({
  minLength: 1,
  maxLength: 64,
  pattern: THEME_ID_PATTERN,
});

/** Strict semver version — identical constraint to the manifest `version`. */
export const ThemeVersionSchema = Type.String({
  minLength: 5,
  maxLength: 16,
  pattern: THEME_VERSION_PATTERN,
});

/** The theme API compatibility range the manifest declares. */
export const ThemeApiRangeSchema = Type.String({
  minLength: 1,
  maxLength: 32,
  pattern: THEME_API_RANGE_PATTERN,
});

/** Moderation states a `theme_versions` row may hold — the same closed union. */
export const THEME_VERSION_MODERATION_STATES = ['pending', 'approved', 'rejected'] as const;

/** One theme version's moderation state. */
export const ThemeVersionModerationStateSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('approved'),
  Type.Literal('rejected'),
]);

/** A `theme_versions.moderation_state` value. */
export type ThemeVersionModerationState = Static<typeof ThemeVersionModerationStateSchema>;

/** One declared variant fact, derived from the validated token file. */
export const ThemeVariantFactSchema = Type.Object(
  {
    variant: Type.Union([Type.Literal('light'), Type.Literal('dark')]),
    /** Declared font stacks, in declaration order. */
    fontFamily: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 32 }),
    /** Declared font weights. */
    fontWeight: Type.Array(Type.Number({ minimum: 1, maximum: 1000 }), { maxItems: 32 }),
    /** Number of allowlisted tokens the variant declares. */
    tokenCount: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

/** One declared variant fact. */
export type ThemeVariantFact = Static<typeof ThemeVariantFactSchema>;

/** One declared token declaration, exactly as the shared compiler produced it. */
export const ThemeDeclarationFactSchema = Type.Object(
  {
    variant: Type.Union([Type.Literal('light'), Type.Literal('dark')]),
    /** Allowlisted token id the declaration came from. */
    tokenId: Type.String({ minLength: 1, maxLength: 96 }),
    /** The `--ui-*` custom property the compiler emitted. */
    cssVariable: Type.String({ minLength: 1, maxLength: 96 }),
    /** The compiled, validated CSS value — never a raw creator string. */
    value: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);

/** One declared token declaration. */
export type ThemeDeclarationFact = Static<typeof ThemeDeclarationFactSchema>;

/** One declared package asset, as the detail surface reports it. */
export const ThemeAssetFactSchema = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 200 }),
    mediaType: Type.String({ minLength: 3, maxLength: 64 }),
    bytes: Type.Integer({ minimum: 0 }),
    /** True when this asset is the declared preview image. */
    isPreview: Type.Boolean(),
  },
  { additionalProperties: false },
);

/** One declared package asset. */
export type ThemeAssetFact = Static<typeof ThemeAssetFactSchema>;

// ---------------------------------------------------------------------------
// Reserve (step 1)
// ---------------------------------------------------------------------------

/**
 * Request body for reserving a theme-version publish.
 *
 * Deliberately minimal: the manifest inside the archive is the authority for
 * the name, licence, author display name and API range, and the server reads
 * them from the *validated* package rather than trusting a JSON claim.
 * `sizeBytes` is the declared upload length the staging budget is reserved
 * against; `provenance` feeds the existing C-513 rights gate at reserve time.
 */
export const ReserveThemeVersionRequestSchema = Type.Object(
  {
    themeId: ThemeIdSchema,
    version: ThemeVersionSchema,
    /** Declared byte length; must equal the upload's `Content-Length`. */
    sizeBytes: Type.Integer({ minimum: 1, maximum: 10 * 1024 * 1024 }),
    provenance: CommunityAssetProvenanceProjectionSchema,
  },
  { additionalProperties: false },
);

/** Request body for reserving a theme-version publish. */
export type ReserveThemeVersionRequest = Static<typeof ReserveThemeVersionRequestSchema>;

/** Response from a successful theme-version reservation. */
export const ReserveThemeVersionResultSchema = Type.Object({
  themeId: Type.String({ minLength: 1 }),
  version: ThemeVersionSchema,
  /** Path the owner must PUT the raw package bytes to. */
  uploadPath: Type.String({ minLength: 1 }),
  stagingState: Type.Literal('reserved'),
});

/** Result of a successful theme-version reservation. */
export type ReserveThemeVersionResult = Static<typeof ReserveThemeVersionResultSchema>;

// ---------------------------------------------------------------------------
// Listing / detail
// ---------------------------------------------------------------------------

/** One immutable published theme version as a listing sees it. */
export const ThemeVersionSummarySchema = Type.Object({
  themeId: Type.String({ minLength: 1 }),
  version: ThemeVersionSchema,
  name: Type.String({ minLength: 1 }),
  /** Display only — never used to resolve identity or ownership. */
  authorDisplayName: Type.String({ minLength: 1 }),
  license: Type.String({ minLength: 1 }),
  themeApiRange: ThemeApiRangeSchema,
  /** The client build's verdict on `themeApiRange`. */
  themeApiSupported: Type.Boolean(),
  variants: Type.Array(Type.Union([Type.Literal('light'), Type.Literal('dark')])),
  assetCount: Type.Integer({ minimum: 0 }),
  packageBytes: Type.Integer({ minimum: 0 }),
  sha256: ThemePackageSha256Schema,
  moderationState: ThemeVersionModerationStateSchema,
  /** True once public distribution was withdrawn; never a fourth state. */
  revoked: Type.Boolean(),
  /** True when the caller owns this version (drives the owner-only controls). */
  isOwner: Type.Boolean(),
  /** True once the bytes are in the public catalog namespace. */
  promoted: Type.Boolean(),
  /** Present for promoted, non-revoked rows (public) and for the owner's own. */
  deliveryUrl: Type.Optional(Type.String({ minLength: 1 })),
  /** True when the package ships an optional HUD preset (a separate opt-in). */
  hasHudPreset: Type.Boolean(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

/** One immutable published theme version. */
export type ThemeVersionSummary = Static<typeof ThemeVersionSummarySchema>;

/** Full detail for one immutable theme version. */
export const ThemeVersionDetailSchema = Type.Object({
  ...ThemeVersionSummarySchema.properties,
  /** Derived, declared facts — never a field the manifest cannot supply. */
  variantFacts: Type.Array(ThemeVariantFactSchema),
  /**
   * The compiled declarations per variant, from the same compiler the client
   * and the CLI use. The Hub renders its preview from these — there is no
   * creator-supplied stylesheet anywhere in the path.
   */
  declarations: Type.Array(ThemeDeclarationFactSchema, { maxItems: 512 }),
  assets: Type.Array(ThemeAssetFactSchema),
  /** Validator warnings surfaced to the visitor (contrast, etc.). */
  validationWarnings: Type.Array(
    Type.Object({
      code: Type.String({ minLength: 1 }),
      message: Type.String({ minLength: 1 }),
      subject: Type.Optional(Type.String()),
    }),
  ),
  /** Free-form update notes supplied by the creator at reserve time. */
  notes: Type.Optional(Type.String({ maxLength: THEME_NOTE_MAX_LENGTH })),
});

/** Full detail for one immutable theme version. */
export type ThemeVersionDetail = Static<typeof ThemeVersionDetailSchema>;

/** Cursor-paginated theme listing. */
export const ThemeVersionPageSchema = Type.Object({
  items: Type.Array(ThemeVersionSummarySchema),
  nextCursor: Type.Optional(Type.String({ minLength: 1 })),
});

/** One bounded page of theme versions. */
export type ThemeVersionPage = Static<typeof ThemeVersionPageSchema>;

// ---------------------------------------------------------------------------
// Moderation / revocation
// ---------------------------------------------------------------------------

/** Operator moderation transition request. */
export const ModerateThemeVersionRequestSchema = Type.Object({
  decision: Type.Union([Type.Literal('approved'), Type.Literal('rejected')]),
  note: Type.Optional(Type.String({ maxLength: THEME_NOTE_MAX_LENGTH })),
});

/** Operator moderation transition request. */
export type ModerateThemeVersionRequest = Static<typeof ModerateThemeVersionRequestSchema>;

/**
 * Operator revocation request.
 *
 * Separate from moderation on purpose: revocation withdraws public
 * distribution of an already-approved version without pretending a fourth
 * moderation state exists.
 */
export const RevokeThemeVersionRequestSchema = Type.Object({
  revoked: Type.Boolean(),
  note: Type.Optional(Type.String({ maxLength: THEME_NOTE_MAX_LENGTH })),
});

/** Operator revocation request. */
export type RevokeThemeVersionRequest = Static<typeof RevokeThemeVersionRequestSchema>;

// ---------------------------------------------------------------------------
// Client install handoff
// ---------------------------------------------------------------------------

/**
 * The trusted install intent a Hub page hands to a native/browser consumer.
 *
 * 🔴 It carries an *identity*, never a URL or a filesystem path: the consumer
 * resolves `{ themeId, version }` against its configured trusted Hub endpoint
 * (`hubApiBase()`). A link cannot name an arbitrary origin, and it can never
 * auto-apply a pack.
 */
export const ThemeInstallIntentSchema = Type.Object(
  {
    themeId: ThemeIdSchema,
    version: ThemeVersionSchema,
    source: Type.Literal('configured-hub'),
  },
  { additionalProperties: false },
);

/** A trusted theme install intent. */
export type ThemeInstallIntent = Static<typeof ThemeInstallIntentSchema>;

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/**
 * Machine-readable failure codes for the theme routes.
 *
 * AC-2 requires each rejection to be a *named* case, not a generic 400 — a
 * publisher must be able to act on the answer.
 */
export type ThemePublishErrorCode =
  | 'unauthorized'
  | 'rate_limited'
  | 'invalid-argument'
  | 'invalid-slug'
  | 'theme-slug-taken'
  | 'duplicate-version'
  | 'revision-conflict'
  | 'not-found'
  | 'theme-invalid-manifest'
  | 'theme-invalid-license'
  | 'theme-unsupported-api'
  | 'theme-archive-too-large'
  | 'theme-manifest-too-large'
  | 'theme-too-many-entries'
  | 'theme-expands-too-large'
  | 'theme-compression-bomb'
  | 'theme-hostile-archive-entry'
  | 'theme-hash-mismatch'
  | 'theme-invalid-asset'
  | 'theme-invalid-package'
  | 'theme-sanitizer-unavailable'
  | 'theme-scan-in-progress'
  | 'rights-unresolved'
  | 'rights-denied'
  | 'provenance-local-path'
  | 'attribution-missing'
  | 'not-moderator'
  | 'already-moderated'
  | 'revoked'
  | 'upload-failed'
  | 'commit-failed';
