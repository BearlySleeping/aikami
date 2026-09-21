// packages/shared/schemas/src/lib/catalog/hash.ts

import { type Static, Type } from 'typebox';

/** Exact lowercase SHA-256 hexadecimal digest used by catalog wire schemas. */
export const CATALOG_SHA256_PATTERN = '^[0-9a-f]{64}$';

/**
 * A complete, canonical lowercase SHA-256 digest.
 *
 * Shared so every place that hashes or pins catalog bytes (release pointers,
 * receipts, plans, pack locks) agrees on what a *complete* hash looks like.
 * A bare `length === 64` check is not enough: it accepts non-hex characters and
 * only catches absence, not a malformed value that must never be compared.
 */
export const CatalogSha256Schema = Type.String({ pattern: CATALOG_SHA256_PATTERN });

export type CatalogSha256 = Static<typeof CatalogSha256Schema>;

/** Runtime guard for the canonical lowercase SHA-256 digest form. */
export const isCatalogSha256 = (value: unknown): value is CatalogSha256 =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
