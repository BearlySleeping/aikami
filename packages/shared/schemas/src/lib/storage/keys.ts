// packages/shared/schemas/src/lib/storage/keys.ts
//
// C-454: R2 object key specs — one per declared prefix, pairing a TypeBox
// params schema with build()/parse() and (where public) a cacheControl string.
//
// Every key spec also declares which R2_BUCKETS entry it belongs to, so an
// ObjectStore can resolve the correct bucket binding at runtime.

import { type Static, Type } from 'typebox';

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

export type KeySpec<Params extends Record<string, string>> = {
  /** Which R2_BUCKETS entry this key belongs to ('saves' or 'catalog'). */
  bucket: 'saves' | 'catalog';
  /** TypeBox schema for the params this key accepts. */
  schema: import('typebox').TObject<Record<keyof Params, import('typebox').TString>>;
  /** Cache-Control header value, or undefined for private objects. */
  cacheControl: string | undefined;
  /** Build a key string from typed params. */
  build: (params: Params) => string;
  /** Parse a key string back into typed params. Returns undefined on mismatch. */
  parse: (key: string) => Params | undefined;
};

// ---------------------------------------------------------------------------
// User object key — users/{uid}/{filename}
// ---------------------------------------------------------------------------

export const UserObjectKeyParamsSchema = Type.Object({
  uid: Type.String(),
  filename: Type.String(),
});
export type UserObjectKeyParams = Static<typeof UserObjectKeyParamsSchema>;

export const userObjectKey = {
  bucket: 'saves' as const,
  schema: UserObjectKeyParamsSchema,
  cacheControl: undefined, // private, session-gated — no public cache header
  build: (params: UserObjectKeyParams): string =>
    `users/${params.uid}/${params.filename}`,
  parse: (key: string): UserObjectKeyParams | undefined => {
    const match = /^users\/([^/]+)\/(.+)$/.exec(key);
    return match ? { uid: match[1], filename: match[2] } : undefined;
  },
} as const satisfies KeySpec<UserObjectKeyParams>;

// ---------------------------------------------------------------------------
// Save backup key — saves/{accountId}/{timestamp}-{backupId}-{filename}
// ---------------------------------------------------------------------------

export const SaveBackupKeyParamsSchema = Type.Object({
  accountId: Type.String(),
  timestamp: Type.String(),
  backupId: Type.String(),
  filename: Type.String(),
});
export type SaveBackupKeyParams = Static<typeof SaveBackupKeyParamsSchema>;

export const saveBackupKey = {
  bucket: 'saves' as const,
  schema: SaveBackupKeyParamsSchema,
  cacheControl: undefined, // private, session-gated
  build: (params: SaveBackupKeyParams): string =>
    `saves/${params.accountId}/${params.timestamp}-${params.backupId}-${params.filename}`,
  parse: (key: string): SaveBackupKeyParams | undefined => {
    const match = /^saves\/([^/]+)\/(\d+)-([a-f0-9-]+)-(.+)$/.exec(key);
    return match
      ? {
          accountId: match[1],
          timestamp: match[2],
          backupId: match[3],
          filename: match[4],
        }
      : undefined;
  },
} as const satisfies KeySpec<SaveBackupKeyParams>;

// ---------------------------------------------------------------------------
// Asset key — assets/{sha256}{ext}
// ---------------------------------------------------------------------------

export const AssetKeyParamsSchema = Type.Object({
  sha256: Type.String(),
  ext: Type.String(),
});
export type AssetKeyParams = Static<typeof AssetKeyParamsSchema>;

export const assetKey = {
  bucket: 'catalog' as const,
  schema: AssetKeyParamsSchema,
  cacheControl: ASSET_CACHE_CONTROL,
  build: (params: AssetKeyParams): string =>
    `assets/${params.sha256}${params.ext}`,
  parse: (key: string): AssetKeyParams | undefined => {
    const match = /^assets\/([a-f0-9]+)(\.[a-z0-9]+)$/i.exec(key);
    return match ? { sha256: match[1], ext: match[2] } : undefined;
  },
} as const satisfies KeySpec<AssetKeyParams>;

// ---------------------------------------------------------------------------
// Catalog index key — index/v1/catalog.json
// ---------------------------------------------------------------------------

export const CatalogIndexKeyParamsSchema = Type.Object({});
export type CatalogIndexKeyParams = Static<typeof CatalogIndexKeyParamsSchema>;

export const catalogIndexKey = {
  bucket: 'catalog' as const,
  schema: CatalogIndexKeyParamsSchema,
  cacheControl: INDEX_CACHE_CONTROL,
  build: (_params: CatalogIndexKeyParams): string => 'index/v1/catalog.json',
  parse: (key: string): CatalogIndexKeyParams | undefined =>
    key === 'index/v1/catalog.json' ? {} : undefined,
} as const satisfies KeySpec<CatalogIndexKeyParams>;

// ---------------------------------------------------------------------------
// Seed key — seed/{name}
// ---------------------------------------------------------------------------

export const SeedKeyParamsSchema = Type.Object({
  name: Type.String(),
});
export type SeedKeyParams = Static<typeof SeedKeyParamsSchema>;

export const seedKey = {
  bucket: 'catalog' as const,
  schema: SeedKeyParamsSchema,
  cacheControl: SEED_CACHE_CONTROL,
  build: (params: SeedKeyParams): string => `seed/${params.name}`,
  parse: (key: string): SeedKeyParams | undefined => {
    const match = /^seed\/(.+)$/.exec(key);
    return match ? { name: match[1] } : undefined;
  },
} as const satisfies KeySpec<SeedKeyParams>;
