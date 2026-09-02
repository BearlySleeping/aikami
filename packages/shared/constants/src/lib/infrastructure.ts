// packages/shared/constants/src/lib/infrastructure.ts
//
// C-454: D1 and R2 infrastructure identity — declared once, consumed
// everywhere. Follows the same `as const satisfies Record<...>` pattern as
// MODE_PROJECT_MAP in project.ts.
//
// D1 database identities (per-mode): the hub's Cloudflare D1 binding.
// R2 bucket identities (per-mode): SAVES_BUCKET (save backups + user objects)
// and CATALOG_BUCKET (catalog asset origin).
//
// Three call sites can't import TS and must stay in sync by convention:
// wrangler.jsonc (static JSONC), .pi extensions (no moon project graph), and
// bash scripts (scripts/direnv/bootstrap.sh).

import type { modes } from './project.ts';

// ---------------------------------------------------------------------------
// D1 databases
// ---------------------------------------------------------------------------

/** Cloudflare D1 identity required to bind one database to a Worker. */
export type D1DatabaseEntry = {
  binding: string;
  databaseName: string;
  databaseId: string;
};

/** Optional per-mode D1 identities for each server database. */
export type D1Databases = {
  hub: Partial<Record<(typeof modes)[number], D1DatabaseEntry>>;
};

/**
 * Per-mode D1 database identities for the hub's Worker binding.
 *
 * - production: real D1 database with live data.
 * - staging: separate D1 database so a staging deploy never touches
 *   production's users or save-backup metadata.
 * - emulator / testing: local-only, no fixed databaseId — resolved at
 *   runtime by local-dev tooling, not declared here.
 */
export const D1_DATABASES = {
  hub: {
    production: {
      binding: 'DB',
      databaseName: 'aikami-hub',
      databaseId: 'bf77e365-058f-408f-871c-4a0567c9aa10',
    },
    staging: {
      binding: 'DB',
      databaseName: 'aikami-staging-hub',
      databaseId: '83bfee84-e656-4d37-b5f5-035e126e0981',
    },
    // emulator / testing: local-only, no fixed databaseId — resolved at
    // runtime by the existing local-dev tooling, not declared here.
  } as const,
} as const satisfies D1Databases;

// ---------------------------------------------------------------------------
// R2 buckets
// ---------------------------------------------------------------------------

/** Cloudflare R2 identity required to bind one bucket to a Worker. */
export type R2BucketEntry = {
  binding: string;
  bucketName: string;
};

/** Optional per-mode R2 identities for each storage target. */
export type R2Buckets = {
  saves: Partial<Record<(typeof modes)[number], R2BucketEntry>>;
  catalog: Partial<Record<(typeof modes)[number], R2BucketEntry>>;
};

/**
 * Per-mode R2 bucket identities.
 *
 * - saves: SAVES_BUCKET — user-object uploads (`users/{uid}/...`) and save
 *   backups (`saves/{accountId}/...`). Both prefixes live in the same bucket.
 * - catalog: CATALOG_BUCKET — public catalog assets, content-addressed.
 *   staging has its own bucket so `--mode staging` publishes can never
 *   overwrite production's live index.
 *
 * `CATALOG_BUCKET` env var still overrides the catalog entry (for local
 * manual testing), matching today's `DEFAULT_CATALOG_BUCKET` precedence.
 */
export const R2_BUCKETS = {
  saves: {
    production: { binding: 'SAVES_BUCKET', bucketName: 'aikami-saves' },
    staging: { binding: 'SAVES_BUCKET', bucketName: 'aikami-staging-saves' },
  } as const,
  catalog: {
    production: { binding: 'CATALOG_BUCKET', bucketName: 'aikami-catalog' },
    staging: { binding: 'CATALOG_BUCKET', bucketName: 'aikami-staging-catalog' },
  } as const,
} as const satisfies R2Buckets;

/**
 * Resolve the R2 bucket name for a given mode and bucket key.
 * Returns undefined for emulator/testing modes (local-only).
 */
export const resolveBucketName = (options: {
  bucketKey: keyof typeof R2_BUCKETS;
  mode: string;
}): string | undefined => {
  const bucket = R2_BUCKETS[options.bucketKey];
  const entry = bucket[options.mode as keyof typeof bucket];
  return entry?.bucketName;
};

/**
 * Resolve the D1 database entry for a given mode and database key.
 * Returns undefined for emulator/testing modes (local-only).
 */
export const resolveD1Database = (options: {
  dbKey: keyof typeof D1_DATABASES;
  mode: string;
}): D1DatabaseEntry | undefined => {
  const db = D1_DATABASES[options.dbKey];
  const entry = db[options.mode as keyof typeof db];
  if (!entry) {
    return undefined;
  }
  return entry;
};
