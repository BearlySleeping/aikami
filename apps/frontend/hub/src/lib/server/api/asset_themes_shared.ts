// apps/frontend/hub/src/lib/server/api/asset_themes_shared.ts
//
// C-530 — the helpers the theme route modules share: the named validation-error
// mapping (AC-2), the derived display facts (Directive 5), the row → summary
// projection, and the one listing query behind both the JSON route and the
// public browse page.
//
// 🔴 Every rejection has to be a *named* case a publisher can act on. The
// mapping below is the single place a `ThemeValidationIssue` becomes an HTTP
// answer, so the route handler and the browse page cannot disagree about what
// a hostile archive is called.

import { themeVersions } from '@aikami/backend-database';
// biome-ignore lint/style/noRestrictedImports: `@aikami/frontend/theme` is the C-529 home of the shared theme validator/compiler. It is pure TypeScript with no DOM, Svelte or Pixi dependency and is already consumed by the CLI and the client; the Hub reuses the *same* validator so a package cannot pass on the server and fail on the device (C-530 Architecture Directive 2).
import type { ThemeArchiveEntry, ThemePackageValidation } from '@aikami/frontend/theme';
// biome-ignore lint/style/noRestrictedImports: same shared, DOM-free theme package as above.
import { isThemeApiRangeSupported } from '@aikami/frontend/theme';
import type {
  ThemeAssetFact,
  ThemeDeclarationFact,
  ThemeVariantFact,
  ThemeVersionDetail,
  ThemeVersionSummary,
} from '@aikami/schemas';
import { parseThemeTokenFileJson } from '@aikami/schemas';
import type { ThemeValidationIssue } from '@aikami/types';
import { and, desc, eq, isNotNull, lt, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import {
  type AssetCommunityEnv,
  parseProvenance,
  publicDeliveryUrl,
} from './asset_community_shared.ts';

/** One named rejection: an HTTP status plus a machine-readable code. */
export type ThemeRejection = {
  readonly status: number;
  readonly error: string;
  readonly detail?: string;
};

/**
 * Maps the shared validator's issue codes onto the named AC-2 failures.
 *
 * Order matters: the first issue is the most specific one the validator
 * reported, and the validator reports container-level refusals before
 * package-level ones.
 */
export const mapThemeValidationIssues = (
  issues: readonly ThemeValidationIssue[],
): ThemeRejection => {
  const code = issues[0]?.code ?? 'package.invalid-manifest';
  const message = issues[0]?.message;
  const detail = message === undefined ? undefined : { detail: message };
  switch (code) {
    case 'archive.too-large':
      return { status: 413, error: 'theme-archive-too-large', ...detail };
    case 'package.manifest-too-large':
      return { status: 413, error: 'theme-manifest-too-large', ...detail };
    case 'archive.too-many-entries':
    case 'package.too-many-entries':
      return { status: 413, error: 'theme-too-many-entries', ...detail };
    case 'archive.expands-too-large':
    case 'package.too-large':
      return { status: 413, error: 'theme-expands-too-large', ...detail };
    case 'archive.compression-bomb':
      return { status: 422, error: 'theme-compression-bomb', ...detail };
    case 'archive.decompression-unavailable':
      return { status: 503, error: 'theme-sanitizer-unavailable', ...detail };
    case 'archive.symlink-entry':
    case 'archive.invalid-path':
    case 'archive.duplicate-entry':
    case 'package.invalid-path':
      return { status: 422, error: 'theme-hostile-archive-entry', ...detail };
    case 'package.asset-hash-mismatch':
      return { status: 422, error: 'theme-hash-mismatch', ...detail };
    case 'package.unsupported-api':
      return { status: 422, error: 'theme-unsupported-api', ...detail };
    case 'package.media-type-mismatch':
    case 'package.asset-size-mismatch':
    case 'package.invalid-raster':
    case 'package.invalid-font':
    case 'package.font-too-large':
    case 'package.too-many-fonts':
    case 'package.raster-too-large':
    case 'package.too-many-pixels':
      return { status: 422, error: 'theme-invalid-asset', ...detail };
    case 'package.missing-manifest':
    case 'package.invalid-manifest':
      return { status: 422, error: 'theme-invalid-manifest', ...detail };
    case 'archive.not-a-zip':
    case 'archive.corrupt':
    case 'archive.unsupported-compression':
    case 'archive.entry-exceeds-declared-size':
    case 'archive.zip64-unsupported':
      return { status: 422, error: 'theme-invalid-package', ...detail };
    default:
      return { status: 422, error: 'theme-invalid-package', ...detail };
  }
};

/** Builds a lookup over already-extracted entries. */
export const themeEntryIndex = (
  entries: readonly ThemeArchiveEntry[],
): ReadonlyMap<string, ThemeArchiveEntry> => {
  const byPath = new Map<string, ThemeArchiveEntry>();
  for (const entry of entries) {
    if (entry.isDirectory !== true) {
      byPath.set(entry.path.toLowerCase(), entry);
    }
  }
  return byPath;
};

const textDecoder = new TextDecoder();

/**
 * Derives the declared facts the detail surface may show.
 *
 * 🔴 The manifest carries no font-language or font-fallback metadata, so this
 * reports only what the package actually declares: the fontFamily/fontWeight
 * tokens per variant and how many allowlisted tokens each variant sets. It
 * never fabricates a field the format cannot supply.
 */
export const deriveVariantFacts = (
  validation: ThemePackageValidation,
  entries: readonly ThemeArchiveEntry[],
): readonly ThemeVariantFact[] => {
  const manifest = validation.manifest;
  if (manifest === undefined) {
    return [];
  }
  const byPath = themeEntryIndex(entries);
  const facts: ThemeVariantFact[] = [];

  for (const variant of ['light', 'dark'] as const) {
    const path = manifest.variants[variant];
    if (path === undefined) {
      continue;
    }
    const entry = byPath.get(path.toLowerCase());
    if (entry?.data === undefined) {
      continue;
    }
    const tokenFile = parseThemeTokenFileJson(textDecoder.decode(entry.data));
    if (tokenFile === undefined) {
      continue;
    }
    const fontFamily: string[] = [];
    const fontWeight: number[] = [];
    for (const token of Object.values(tokenFile.tokens)) {
      if (token.$type === 'fontFamily' && typeof token.$value === 'string') {
        fontFamily.push(token.$value);
      }
      if (token.$type === 'fontWeight' && typeof token.$value === 'number') {
        fontWeight.push(token.$value);
      }
    }
    facts.push({
      variant,
      fontFamily,
      fontWeight,
      tokenCount: Object.keys(tokenFile.tokens).length,
    });
  }

  return facts;
};

/** The declared assets the detail surface reports. */
export const deriveAssetFacts = (validation: ThemePackageValidation): readonly ThemeAssetFact[] => {
  const manifest = validation.manifest;
  if (manifest === undefined) {
    return [];
  }
  return manifest.assets.map((asset) => ({
    path: asset.path,
    mediaType: asset.mediaType,
    bytes: asset.bytes,
    isPreview: manifest.preview === asset.path,
  }));
};

/** Serialises the validated variant declarations for storage. */
export const serializeVariantDeclarations = (validation: ThemePackageValidation): string =>
  JSON.stringify(validation.variants);

/** The stored row's variant list, tolerant of a hand-edited value. */
export const parseStoredVariants = (raw: string): ('light' | 'dark')[] => {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return [...(['light', 'dark'] as const)].filter((variant) => Array.isArray(parsed[variant]));
  } catch {
    return [];
  }
};

/** The stored derived facts, tolerant of a hand-edited value. */
export const parseStoredVariantFacts = (raw: string): ThemeVariantFact[] => {
  try {
    const parsed = JSON.parse(raw) as ThemeVariantFact[];
    return Array.isArray(parsed) ? [...parsed] : [];
  } catch {
    return [];
  }
};

/** The stored manifest, tolerant of a hand-edited value. */
export const parseStoredManifest = (raw: string): { assets: ThemeAssetFact[] } => {
  try {
    const parsed = JSON.parse(raw) as { assets?: ThemeAssetFact[]; preview?: string };
    const assets = Array.isArray(parsed.assets) ? parsed.assets : [];
    return {
      assets: assets.map((asset) => ({
        path: String(asset.path),
        mediaType: String(asset.mediaType),
        bytes: Number(asset.bytes),
        isPreview: parsed.preview === asset.path,
      })),
    };
  } catch {
    return { assets: [] };
  }
};

/** Row → listing summary. */
export const toThemeSummary = (options: {
  readonly row: typeof themeVersions.$inferSelect;
  readonly isOwner: boolean;
  readonly env: AssetCommunityEnv;
}): ThemeVersionSummary => {
  const { row, isOwner, env } = options;
  const promoted = row.promotedAt !== null && row.r2Key !== null && row.revokedAt === null;
  let deliveryUrl: string | undefined;
  if (promoted) {
    deliveryUrl = publicDeliveryUrl(env, row.r2Key as string);
  } else if (isOwner) {
    deliveryUrl = themeOwnerDeliveryPath(row.slug, row.version);
  }
  return {
    themeId: row.slug,
    version: row.version,
    name: row.name,
    authorDisplayName: row.authorDisplayName,
    license: row.license,
    themeApiRange: row.themeApiRange,
    themeApiSupported: isThemeApiRangeSupported(row.themeApiRange),
    variants: parseStoredVariants(row.variantsJson),
    assetCount: row.assetCount,
    packageBytes: row.packageBytes,
    sha256: row.sha256,
    moderationState: row.moderationState,
    revoked: row.revokedAt !== null,
    isOwner,
    promoted,
    ...(deliveryUrl === undefined ? {} : { deliveryUrl }),
    hasHudPreset: row.hasHudPreset,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
};

/** Flattens the stored variant declarations into the bounded detail list. */
export const parseStoredDeclarations = (raw: string): ThemeDeclarationFact[] => {
  try {
    const parsed = JSON.parse(raw) as Record<
      string,
      Array<{ tokenId?: unknown; cssVariable?: unknown; value?: unknown }>
    >;
    const facts: ThemeDeclarationFact[] = [];
    for (const variant of ['light', 'dark'] as const) {
      const declarations = parsed[variant];
      if (!Array.isArray(declarations)) {
        continue;
      }
      for (const declaration of declarations.slice(0, 256)) {
        facts.push({
          variant,
          tokenId: String(declaration.tokenId),
          cssVariable: String(declaration.cssVariable),
          value: String(declaration.value),
        });
      }
    }
    return facts;
  } catch {
    return [];
  }
};

/** Row → detail (summary plus the declared facts). */
export const toThemeDetail = (options: {
  readonly row: typeof themeVersions.$inferSelect;
  readonly isOwner: boolean;
  readonly env: AssetCommunityEnv;
  readonly validationWarnings?: readonly ThemeValidationIssue[];
}): ThemeVersionDetail => ({
  ...toThemeSummary(options),
  variantFacts: parseStoredVariantFacts(options.row.variantFactsJson),
  declarations: parseStoredDeclarations(options.row.variantsJson),
  assets: parseStoredManifest(options.row.manifestJson).assets,
  validationWarnings: (options.validationWarnings ?? []).map((issue) => ({
    code: issue.code,
    message: issue.message,
    ...(issue.subject === undefined ? {} : { subject: issue.subject }),
  })),
  ...(options.row.notes === null ? {} : { notes: options.row.notes }),
});

/** Owner-only delivery path for one immutable version. */
export const themeOwnerDeliveryPath = (themeId: string, version: string): string =>
  `/api/assets/themes/${themeId}/raw?version=${encodeURIComponent(version)}`;

/** Upload path for one reserved version. */
export const themeUploadPath = (themeId: string, version: string): string =>
  `/api/assets/themes/${themeId}/upload?version=${encodeURIComponent(version)}`;

/** A parsed theme-listing cursor — the opaque `"<updatedAtMs>.<id>"` token. */
export type ThemeVersionCursor = { updatedAt: Date; id: string };

/** Parses an opaque pagination cursor. */
export const parseThemeVersionCursor = (raw: string): ThemeVersionCursor | undefined => {
  const separator = raw.indexOf('.');
  if (separator < 1) {
    return undefined;
  }
  const timestamp = Number(raw.slice(0, separator));
  const id = raw.slice(separator + 1);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || id.length === 0) {
    return undefined;
  }
  return { updatedAt: new Date(timestamp), id };
};

/** One page of the theme listing. */
export type ThemeVersionListing = {
  readonly items: readonly ThemeVersionSummary[];
  readonly nextCursor?: string;
};

/**
 * Reads one page of theme versions, newest first.
 *
 * The single query behind both the JSON route and the public browse page, so
 * the two surfaces cannot diverge on visibility. `mine: false` — the public
 * default — returns **approved, promoted, non-revoked** rows only: a pending,
 * rejected or withdrawn version is not listable through either surface.
 * `mine: true` scopes to one owner across every moderation state and is
 * session-gated by the route that calls it.
 */
export const listThemeVersions = async (options: {
  readonly env: AssetCommunityEnv;
  readonly accountId?: string;
  readonly mine?: boolean;
  readonly themeId?: string;
  readonly limit?: number;
  readonly cursor?: ThemeVersionCursor;
}): Promise<ThemeVersionListing> => {
  const { env, accountId, mine = false, themeId, limit = 48, cursor } = options;
  const db = drizzle(env.DB, { schema: { themeVersions } });

  const visibleState = mine
    ? sql`${themeVersions.ownerAccountId} = ${accountId}`
    : sql`${themeVersions.moderationState} = 'approved' AND ${themeVersions.promotedAt} IS NOT NULL AND ${themeVersions.revokedAt} IS NULL`;

  const filters = [visibleState];
  if (themeId !== undefined) {
    filters.push(sql`${themeVersions.slug} = ${themeId}`);
  }
  if (cursor) {
    filters.push(
      or(
        lt(themeVersions.updatedAt, cursor.updatedAt),
        and(eq(themeVersions.updatedAt, cursor.updatedAt), lt(themeVersions.id, cursor.id)),
      ) as never,
    );
  }

  const rows = await db
    .select()
    .from(themeVersions)
    .where(and(...filters))
    .orderBy(desc(themeVersions.updatedAt), desc(themeVersions.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((row) =>
      toThemeSummary({ row, isOwner: mine && row.ownerAccountId === accountId, env }),
    ),
    ...(rows.length > limit && last
      ? { nextCursor: `${last.updatedAt.getTime()}.${last.id}` }
      : {}),
  };
};

/** Reads the newest version of `themeId` visible to `accountId`. */
export const readVisibleThemeVersion = async (options: {
  readonly env: AssetCommunityEnv;
  readonly themeId: string;
  readonly version?: string;
  readonly accountId?: string;
}): Promise<typeof themeVersions.$inferSelect | undefined> => {
  const { env, themeId, version, accountId } = options;
  const db = drizzle(env.DB, { schema: { themeVersions } });
  const publicRevision = and(
    eq(themeVersions.moderationState, 'approved'),
    isNotNull(themeVersions.promotedAt),
    sql`${themeVersions.revokedAt} IS NULL`,
  );
  const visible =
    accountId === undefined
      ? publicRevision
      : or(publicRevision, eq(themeVersions.ownerAccountId, accountId));

  const filters = [eq(themeVersions.slug, themeId), visible];
  if (version !== undefined) {
    filters.push(eq(themeVersions.version, version));
  }

  const rows = await db
    .select()
    .from(themeVersions)
    .where(and(...filters))
    .orderBy(desc(themeVersions.createdAt), desc(themeVersions.id))
    .limit(1);
  return rows[0];
};

/** Re-exported so route modules import provenance parsing from one place. */
export { parseProvenance };
