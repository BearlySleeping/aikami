// packages/shared/schemas/src/lib/storage/keys.ts
//
// C-454: R2 object key specs — one per declared prefix, pairing a TypeBox
// params schema with build()/parse() and (where public) a cacheControl string.
//
// Every key spec also declares which R2_BUCKETS entry it belongs to, so an
// ObjectStore can resolve the correct bucket binding at runtime.

import { type Static, type TObject, type TString, Type } from 'typebox';
import { Value } from 'typebox/value';

// ---------------------------------------------------------------------------
// Cache-control constants (moved from scripts/src/lib/catalog/config.ts)
// ---------------------------------------------------------------------------

/** One-year immutable cache for asset bytes. */
export const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Short cache for seed/metadata JSON files (mutable, refreshed on publish). */
export const SEED_CACHE_CONTROL = 'public, max-age=300';

/** Short cache for the index (AC-3: 60s or less). */
export const INDEX_CACHE_CONTROL = 'public, max-age=60';

// ---------------------------------------------------------------------------
// Key spec type
// ---------------------------------------------------------------------------

/**
 * Describes how a typed parameter object maps to an R2 key and list prefix.
 */
export type KeySpec<Params extends object, PrefixParams extends object = Params> = {
  /** Which R2_BUCKETS entry this key belongs to ('saves' or 'catalog'). */
  bucket: 'saves' | 'catalog';
  /** TypeBox schema for the params this key accepts. */
  schema: TObject<Record<keyof Params, TString>>;
  /** Cache-Control header value, or undefined for private objects. */
  cacheControl: string | undefined;
  /** Build a key string from typed params. */
  build: (params: Params) => string;
  /** Build a prefix without requiring parameters that only identify one object. */
  buildPrefix: (params: PrefixParams) => string;
  /** Parse a key string back into typed params. Returns undefined on mismatch. */
  parse: (key: string) => Params | undefined;
};

const assertValidParams = (options: { label: string; schema: TObject; params: unknown }): void => {
  if (!Value.Check(options.schema, options.params)) {
    throw new TypeError(`${options.label}: invalid key parameters`);
  }
};

// ---------------------------------------------------------------------------
// User object key — users/{uid}/{filename}
// ---------------------------------------------------------------------------

export const UserObjectKeyParamsSchema = Type.Object({
  uid: Type.String({ pattern: '^[^/]+(?![\\s\\S])' }),
  filename: Type.String({ minLength: 1 }),
});
/** Parameters identifying one private user object. */
export type UserObjectKeyParams = Static<typeof UserObjectKeyParamsSchema>;

const UserObjectKeyPrefixParamsSchema = Type.Pick(UserObjectKeyParamsSchema, ['uid']);
type UserObjectKeyPrefixParams = Static<typeof UserObjectKeyPrefixParamsSchema>;

export const userObjectKey = {
  bucket: 'saves' as const,
  schema: UserObjectKeyParamsSchema,
  cacheControl: undefined, // private, session-gated — no public cache header
  build: (params: UserObjectKeyParams): string => {
    assertValidParams({ label: 'userObjectKey', schema: UserObjectKeyParamsSchema, params });
    return `users/${params.uid}/${params.filename}`;
  },
  buildPrefix: (params: UserObjectKeyPrefixParams): string => {
    assertValidParams({
      label: 'userObjectKey prefix',
      schema: UserObjectKeyPrefixParamsSchema,
      params,
    });
    return `users/${params.uid}/`;
  },
  parse: (key: string): UserObjectKeyParams | undefined => {
    const match = /^users\/([^/]+)\/(.+)$/s.exec(key);
    return match ? { uid: match[1], filename: match[2] } : undefined;
  },
} as const satisfies KeySpec<UserObjectKeyParams, UserObjectKeyPrefixParams>;

// ---------------------------------------------------------------------------
// Save backup key — saves/{accountId}/{timestamp}-{backupId}-{filename}
// ---------------------------------------------------------------------------

export const SaveBackupKeyParamsSchema = Type.Object({
  accountId: Type.String({ pattern: '^[^/]+(?![\\s\\S])' }),
  timestamp: Type.String({ pattern: '^\\d+(?![\\s\\S])' }),
  backupId: Type.String({
    pattern:
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?![\\s\\S])',
  }),
  filename: Type.String({ minLength: 1 }),
});
/** Parameters identifying one account save backup. */
export type SaveBackupKeyParams = Static<typeof SaveBackupKeyParamsSchema>;

const SaveBackupKeyPrefixParamsSchema = Type.Pick(SaveBackupKeyParamsSchema, ['accountId']);
type SaveBackupKeyPrefixParams = Static<typeof SaveBackupKeyPrefixParamsSchema>;

export const saveBackupKey = {
  bucket: 'saves' as const,
  schema: SaveBackupKeyParamsSchema,
  cacheControl: undefined, // private, session-gated
  build: (params: SaveBackupKeyParams): string => {
    assertValidParams({ label: 'saveBackupKey', schema: SaveBackupKeyParamsSchema, params });
    return `saves/${params.accountId}/${params.timestamp}-${params.backupId}-${params.filename}`;
  },
  buildPrefix: (params: SaveBackupKeyPrefixParams): string => {
    assertValidParams({
      label: 'saveBackupKey prefix',
      schema: SaveBackupKeyPrefixParamsSchema,
      params,
    });
    return `saves/${params.accountId}/`;
  },
  parse: (key: string): SaveBackupKeyParams | undefined => {
    const match =
      /^saves\/([^/]+)\/(\d+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(.+)$/is.exec(
        key,
      );
    return match
      ? {
          accountId: match[1],
          timestamp: match[2],
          backupId: match[3],
          filename: match[4],
        }
      : undefined;
  },
} as const satisfies KeySpec<SaveBackupKeyParams, SaveBackupKeyPrefixParams>;

// ---------------------------------------------------------------------------
// Asset key — assets/{sha256}{ext}
// ---------------------------------------------------------------------------

export const AssetKeyParamsSchema = Type.Object({
  sha256: Type.String({ pattern: '^[0-9a-fA-F]+(?![\\s\\S])' }),
  ext: Type.String({ pattern: '^\\.[0-9a-zA-Z]+(?![\\s\\S])' }),
});
/** Parameters identifying one content-addressed catalog asset. */
export type AssetKeyParams = Static<typeof AssetKeyParamsSchema>;

export const assetKey = {
  bucket: 'catalog' as const,
  schema: AssetKeyParamsSchema,
  cacheControl: ASSET_CACHE_CONTROL,
  build: (params: AssetKeyParams): string => {
    assertValidParams({ label: 'assetKey', schema: AssetKeyParamsSchema, params });
    return `assets/${params.sha256}${params.ext}`;
  },
  buildPrefix: (_params: Record<never, never>): string => 'assets/',
  parse: (key: string): AssetKeyParams | undefined => {
    const match = /^assets\/([a-f0-9]+)(\.[a-z0-9]+)$/i.exec(key);
    return match ? { sha256: match[1], ext: match[2] } : undefined;
  },
} as const satisfies KeySpec<AssetKeyParams, Record<never, never>>;

// ---------------------------------------------------------------------------
// Catalog index key — index/v1/catalog.json
// ---------------------------------------------------------------------------

export const CatalogIndexKeyParamsSchema = Type.Object({});
/** Empty parameters for the catalog's fixed root-index key. */
export type CatalogIndexKeyParams = Static<typeof CatalogIndexKeyParamsSchema>;

export const catalogIndexKey = {
  bucket: 'catalog' as const,
  schema: CatalogIndexKeyParamsSchema,
  cacheControl: INDEX_CACHE_CONTROL,
  build: (_params: CatalogIndexKeyParams): string => 'index/v1/catalog.json',
  buildPrefix: (_params: CatalogIndexKeyParams): string => 'index/v1/catalog.json',
  parse: (key: string): CatalogIndexKeyParams | undefined =>
    key === 'index/v1/catalog.json' ? {} : undefined,
} as const satisfies KeySpec<CatalogIndexKeyParams>;

// ---------------------------------------------------------------------------
// Seed key — seed/{name}
// ---------------------------------------------------------------------------

export const SeedKeyParamsSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
});
/** Parameters identifying one mutable catalog seed document. */
export type SeedKeyParams = Static<typeof SeedKeyParamsSchema>;

export const seedKey = {
  bucket: 'catalog' as const,
  schema: SeedKeyParamsSchema,
  cacheControl: SEED_CACHE_CONTROL,
  build: (params: SeedKeyParams): string => {
    assertValidParams({ label: 'seedKey', schema: SeedKeyParamsSchema, params });
    return `seed/${params.name}`;
  },
  buildPrefix: (_params: Record<never, never>): string => 'seed/',
  parse: (key: string): SeedKeyParams | undefined => {
    const match = /^seed\/(.+)$/s.exec(key);
    return match ? { name: match[1] } : undefined;
  },
} as const satisfies KeySpec<SeedKeyParams, Record<never, never>>;
