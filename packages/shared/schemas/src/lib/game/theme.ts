// packages/shared/schemas/src/lib/game/theme.ts
//
// C-529 — runtime schemas for the declarative theme profile and the device-local
// appearance selection.
//
// All three shapes are UNTRUSTED input: a manifest and its token files arrive
// from a package the player picked, and the selection can arrive from a
// previous build or a hand-edited localStorage value. TypeBox is therefore the
// only validator, and the `parse*` helpers below are the only entry points that
// produce these types.
//
// 🔴 Data-only: bounded strings, bounded records, no scripts/styles/URLs. The
// token *values* are further restricted by the compiler, which is the only
// thing allowed to turn a value into CSS.

import {
  THEME_API_RANGE_PATTERN,
  THEME_ID_PATTERN,
  THEME_MAX_ASSETS,
  THEME_MAX_MANIFEST_BYTES,
  THEME_MAX_RESOLVED_TOKENS,
  THEME_MAX_TOKENS_JSON_BYTES,
  THEME_PACKAGE_KIND,
  THEME_PACKAGE_PATH_PATTERN,
  THEME_SELECTION_SCHEMA_VERSION,
  THEME_VERSION_PATTERN,
} from '@aikami/constants';
import { type Static, type TLiteral, Type } from 'typebox';
import { Value } from 'typebox/value';
import { CATALOG_SHA256_PATTERN } from '../catalog/hash.ts';

/**
 * The literal set is declared explicitly because TypeBox needs a tuple to infer
 * a union — deriving it from a `readonly string[]` constant infers `never` and
 * would make every valid token file unrepresentable. A sibling test asserts the
 * two stay identical, so the duplication cannot drift silently.
 */
const THEME_TOKEN_TYPE_LITERALS: [
  TLiteral<'color'>,
  TLiteral<'dimension'>,
  TLiteral<'duration'>,
  TLiteral<'fontFamily'>,
  TLiteral<'fontWeight'>,
] = [
  Type.Literal('color'),
  Type.Literal('dimension'),
  Type.Literal('duration'),
  Type.Literal('fontFamily'),
  Type.Literal('fontWeight'),
];

/** Token value kind, mirroring the allowlist registry. */
export const ThemeTokenTypeSchema = Type.Union(THEME_TOKEN_TYPE_LITERALS, {
  description: 'color | dimension | duration | fontFamily | fontWeight',
});

/** Token variant identifier. */
export const ThemeVariantSchema = Type.Union(
  [Type.Literal('light'), Type.Literal('dark')] as [TLiteral<'light'>, TLiteral<'dark'>],
  { description: 'light | dark' },
);

/** Appearance mode — deliberately independent of the theme identity. */
export const AppearanceModeSchema = Type.Union(
  [Type.Literal('system'), Type.Literal('light'), Type.Literal('dark')],
  { description: 'system | light | dark' },
);

/**
 * One declared token value.
 *
 * A string may be an alias (`{color.base-100}`) or a literal the compiler
 * validates per type. Numbers are only meaningful for `fontWeight`.
 */
export const ThemeTokenValueSchema = Type.Object(
  {
    $type: ThemeTokenTypeSchema,
    $value: Type.Union([
      Type.String({ minLength: 1, maxLength: 160 }),
      Type.Number({ minimum: 1, maximum: 1000 }),
    ]),
  },
  { additionalProperties: false },
);

/** One validated token file (a variant of a theme). */
export const ThemeTokenFileSchema = Type.Object(
  {
    profileVersion: Type.Literal(1, { description: 'Aikami theme profile version' }),
    variant: ThemeVariantSchema,
    tokens: Type.Record(Type.String({ minLength: 1, maxLength: 96 }), ThemeTokenValueSchema, {
      maxProperties: THEME_MAX_RESOLVED_TOKENS,
      description: 'Allowlisted token id → typed value',
    }),
  },
  { additionalProperties: false },
);

/** One declared package asset. Hashes are integrity checks, not rights attestations. */
export const ThemeAssetSchema = Type.Object(
  {
    path: Type.String({
      minLength: 1,
      maxLength: 128,
      pattern: THEME_PACKAGE_PATH_PATTERN,
      description: 'Canonical package-relative path',
    }),
    mediaType: Type.String({ minLength: 3, maxLength: 64 }),
    bytes: Type.Integer({ minimum: 1, maximum: 64 * 1024 * 1024 }),
    sha256: Type.String({ pattern: CATALOG_SHA256_PATTERN }),
  },
  { additionalProperties: false },
);

/** Author metadata. Display only — never used to resolve anything. */
export const ThemeAuthorSchema = Type.Object(
  { displayName: Type.String({ minLength: 1, maxLength: 64 }) },
  { additionalProperties: false },
);

/** The portable theme package envelope. */
export const ThemePackageManifestSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1, { description: 'Envelope version' }),
    kind: Type.Literal(THEME_PACKAGE_KIND),
    id: Type.String({ minLength: 1, maxLength: 64, pattern: THEME_ID_PATTERN }),
    version: Type.String({ minLength: 5, maxLength: 16, pattern: THEME_VERSION_PATTERN }),
    themeApiRange: Type.String({
      minLength: 1,
      maxLength: 32,
      pattern: THEME_API_RANGE_PATTERN,
      description: 'Theme API compatibility range this package requires',
    }),
    name: Type.String({ minLength: 1, maxLength: 64 }),
    author: ThemeAuthorSchema,
    license: Type.String({ minLength: 1, maxLength: 64 }),
    variants: Type.Object(
      {
        light: Type.Optional(
          Type.String({ minLength: 1, maxLength: 128, pattern: THEME_PACKAGE_PATH_PATTERN }),
        ),
        dark: Type.Optional(
          Type.String({ minLength: 1, maxLength: 128, pattern: THEME_PACKAGE_PATH_PATTERN }),
        ),
      },
      { additionalProperties: false, description: 'Variant → package-relative token file' },
    ),
    assets: Type.Array(ThemeAssetSchema, { maxItems: THEME_MAX_ASSETS }),
    preview: Type.Optional(
      Type.String({ minLength: 1, maxLength: 128, pattern: THEME_PACKAGE_PATH_PATTERN }),
    ),
    hudPreset: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 128,
        pattern: THEME_PACKAGE_PATH_PATTERN,
        description: 'Applies only on separate action',
      }),
    ),
  },
  { additionalProperties: false },
);

/** The device-local appearance selection. Contains no private preferences. */
export const ThemeSelectionSchema = Type.Object(
  {
    schemaVersion: Type.Literal(THEME_SELECTION_SCHEMA_VERSION, {
      description: 'Selection format version',
    }),
    themeId: Type.String({ minLength: 1, maxLength: 64, pattern: THEME_ID_PATTERN }),
    version: Type.String({ minLength: 5, maxLength: 16, pattern: THEME_VERSION_PATTERN }),
    mode: AppearanceModeSchema,
  },
  { additionalProperties: false },
);

/**
 * The device-local accessibility appearance overrides.
 *
 * Separate from {@link ThemeSelectionSchema} on purpose: accessibility policy is
 * not part of a theme and must survive changing one, and it is applied last so it
 * always wins.
 */
export const ThemeAccessibilityOverridesSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1, { description: 'Overrides format version' }),
    highContrast: Type.Boolean(),
    opaqueSurfaces: Type.Boolean(),
  },
  { additionalProperties: false },
);

/**
 * The device-local installation record for a community theme.
 *
 * This is the *installed bytes*, not the exchange format: the validated token
 * files are kept exactly as they were accepted so the runtime recompiles from
 * validated data every boot instead of trusting a cached stylesheet string.
 * It is deliberately not part of the public manifest.
 */
export const ThemeInstallationSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1, { description: 'Installation record version' }),
    manifest: ThemePackageManifestSchema,
    variants: Type.Object(
      {
        light: Type.Optional(ThemeTokenFileSchema),
        dark: Type.Optional(ThemeTokenFileSchema),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type ThemeTokenTypeValue = Static<typeof ThemeTokenTypeSchema>;
export type ThemeVariant = Static<typeof ThemeVariantSchema>;
export type AppearanceMode = Static<typeof AppearanceModeSchema>;
export type ThemeTokenValue = Static<typeof ThemeTokenValueSchema>;
export type ThemeTokenFile = Static<typeof ThemeTokenFileSchema>;
export type ThemeAsset = Static<typeof ThemeAssetSchema>;
export type ThemeAuthor = Static<typeof ThemeAuthorSchema>;
export type ThemePackageManifest = Static<typeof ThemePackageManifestSchema>;
export type ThemeSelection = Static<typeof ThemeSelectionSchema>;
export type ThemeAccessibilityOverrides = Static<typeof ThemeAccessibilityOverridesSchema>;
export type ThemeInstallation = Static<typeof ThemeInstallationSchema>;

/** Maximum untrusted manifest JSON text accepted before parsing (256 KiB). */
export const THEME_MANIFEST_JSON_MAX_LENGTH = THEME_MAX_MANIFEST_BYTES;

/** Maximum untrusted token JSON text accepted before parsing (512 KiB). */
export const THEME_TOKENS_JSON_MAX_LENGTH = THEME_MAX_TOKENS_JSON_BYTES;

/** Rejects an oversized manifest before it can consume parser time or memory. */
export const isThemeManifestJsonWithinSizeLimit = (raw: string): boolean =>
  raw.length <= THEME_MANIFEST_JSON_MAX_LENGTH;

/** Rejects oversized token JSON before it can consume parser time or memory. */
export const isThemeTokensJsonWithinSizeLimit = (raw: string): boolean =>
  raw.length <= THEME_TOKENS_JSON_MAX_LENGTH;

/** Parses an untrusted value into an appearance selection. Never throws. */
export const parseThemeSelection = (value: unknown): ThemeSelection | undefined => {
  if (!Value.Check(ThemeSelectionSchema, value)) {
    return undefined;
  }
  return value as ThemeSelection;
};

/** Parses untrusted JSON text into an appearance selection. Never throws. */
export const parseThemeSelectionJson = (raw: string): ThemeSelection | undefined => {
  try {
    return parseThemeSelection(JSON.parse(raw));
  } catch {
    return undefined;
  }
};

/** Parses an untrusted value into a token file. Never throws. */
export const parseThemeTokenFile = (value: unknown): ThemeTokenFile | undefined => {
  if (!Value.Check(ThemeTokenFileSchema, value)) {
    return undefined;
  }
  return value as ThemeTokenFile;
};

/** Parses untrusted JSON text into a token file, bounded before parsing. */
export const parseThemeTokenFileJson = (raw: string): ThemeTokenFile | undefined => {
  if (!isThemeTokensJsonWithinSizeLimit(raw)) {
    return undefined;
  }
  try {
    return parseThemeTokenFile(JSON.parse(raw));
  } catch {
    return undefined;
  }
};

/** Parses an untrusted value into accessibility appearance overrides. Never throws. */
export const parseThemeAccessibilityOverrides = (
  value: unknown,
): ThemeAccessibilityOverrides | undefined => {
  if (!Value.Check(ThemeAccessibilityOverridesSchema, value)) {
    return undefined;
  }
  return value as ThemeAccessibilityOverrides;
};

/** Parses untrusted JSON text into accessibility appearance overrides. Never throws. */
export const parseThemeAccessibilityOverridesJson = (
  raw: string,
): ThemeAccessibilityOverrides | undefined => {
  try {
    return parseThemeAccessibilityOverrides(JSON.parse(raw));
  } catch {
    return undefined;
  }
};

/** Parses an untrusted value into an installation record. Never throws. */
export const parseThemeInstallation = (value: unknown): ThemeInstallation | undefined => {
  if (!Value.Check(ThemeInstallationSchema, value)) {
    return undefined;
  }
  const installation = value as ThemeInstallation;
  // A record with no compiled variant can never render; it is corrupt, not
  // merely incomplete.
  if (installation.variants.light === undefined && installation.variants.dark === undefined) {
    return undefined;
  }
  return installation;
};

/** Parses untrusted JSON text into an installation record. Never throws. */
export const parseThemeInstallationJson = (raw: string): ThemeInstallation | undefined => {
  if (!isThemeTokensJsonWithinSizeLimit(raw)) {
    return undefined;
  }
  try {
    return parseThemeInstallation(JSON.parse(raw));
  } catch {
    return undefined;
  }
};

/** Parses an untrusted value into a package manifest. Never throws. */
export const parseThemePackageManifest = (value: unknown): ThemePackageManifest | undefined => {
  if (!Value.Check(ThemePackageManifestSchema, value)) {
    return undefined;
  }
  const manifest = value as ThemePackageManifest;
  // A package with no variant at all can never render, so it is not a valid
  // manifest even though each individual field is well-formed.
  if (manifest.variants.light === undefined && manifest.variants.dark === undefined) {
    return undefined;
  }
  if (hasDuplicateAssetPaths(manifest.assets)) {
    return undefined;
  }
  return manifest;
};

/** Parses untrusted JSON text into a package manifest, bounded before parsing. */
export const parseThemePackageManifestJson = (raw: string): ThemePackageManifest | undefined => {
  if (!isThemeManifestJsonWithinSizeLimit(raw)) {
    return undefined;
  }
  try {
    return parseThemePackageManifest(JSON.parse(raw));
  } catch {
    return undefined;
  }
};

/**
 * Rejects an asset list containing the same path twice, case-insensitively.
 *
 * Two rows claiming the same path (or two paths that collide on a
 * case-insensitive filesystem) have no defined meaning, and a case collision is
 * exactly the shape an archive is used to smuggle past a naive lookup.
 */
export const hasDuplicateAssetPaths = (assets: readonly { path: string }[]): boolean => {
  const seen = new Set<string>();
  for (const asset of assets) {
    const key = asset.path.toLowerCase();
    if (seen.has(key)) {
      return true;
    }
    seen.add(key);
  }
  return false;
};
