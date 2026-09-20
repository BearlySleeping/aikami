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
  /**
   * C-513: private intake plane for unreviewed community-asset bytes.
   * No public custom domain is ever attached — a pending object must not be
   * reachable by a direct unauthenticated GET (contract AC-6).
   */
  uploads: Partial<Record<(typeof modes)[number], R2BucketEntry>>;
};

/**
 * Per-mode R2 bucket identities.
 *
 * - saves: SAVES_BUCKET — user-object uploads (`users/{uid}/...`) and save
 *   backups (`saves/{accountId}/...`). Both prefixes live in the same bucket.
 * - catalog: CATALOG_BUCKET — public catalog assets, content-addressed.
 *   staging has its own bucket so `--mode staging` publishes can never
 *   overwrite production's live index.
 * - uploads: UPLOADS_BUCKET — the C-513 private intake plane
 *   (`staging/{accountId}/{uploadId}`). Never publicly served: approved
 *   bytes are *copied* into the catalog bucket at promotion time.
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
  uploads: {
    production: { binding: 'UPLOADS_BUCKET', bucketName: 'aikami-uploads' },
    staging: { binding: 'UPLOADS_BUCKET', bucketName: 'aikami-staging-uploads' },
  } as const,
} as const satisfies R2Buckets;

/** The R2 bucket keys the hub Worker needs bindings for (C-513 adds `uploads`). */
export const HUB_R2_BUCKET_KEYS = ['saves', 'catalog', 'uploads'] as const;

/**
 * Canonical catalog ORIGIN identity, per mode.
 *
 * `R2_BUCKETS` answers "which bucket does this mode write to?". This answers the
 * question that caused a real release-target bug: "which PUBLIC ORIGIN does
 * this mode read back from?" — and the two must agree, because verifying a
 * staging write by reading the production origin proves nothing about staging.
 *
 * An origin is an IDENTITY here, not a setting. `scripts/.env.staging` once
 * carried `CATALOG_ORIGIN_URL=https://assets.bearlysleeping.com`, so `--mode
 * staging` resolved the production read origin and the mode-aware safety net
 * never ran. Encoding the origin alongside the bucket makes that
 * misconfiguration a static contradiction rather than a runtime surprise.
 *
 * `originUrl: null` means the origin is NOT PROVISIONED. That is deliberate and
 * is the current staging state: there is no public URL for
 * `aikami-staging-catalog`, and inventing one — or pointing staging at
 * production to unblock testing — would make every staging verification a lie.
 * A null origin fails closed; it is never a fallback.
 *
 * Provisioning a staging origin is a HUMAN infrastructure action: create a
 * public R2 custom domain (or Worker route) for `aikami-staging-catalog`, then
 * set the URL here and in the mode's environment.
 */
export const CATALOG_ORIGINS = {
  production: {
    bucketName: 'aikami-catalog',
    originUrl: 'https://assets.bearlysleeping.com',
  },
  staging: {
    bucketName: 'aikami-staging-catalog',
    // NOT PROVISIONED — see the doc comment. A staging publish cannot be
    // verified until this is a real URL.
    originUrl: null,
  },
} as const satisfies Record<string, { bucketName: string; originUrl: string | null }>;

/** The catalog origin identity for a mode, or undefined when none applies. */
export const resolveCatalogOrigin = (
  mode: string,
): { bucketName: string; originUrl: string | null } | undefined =>
  (CATALOG_ORIGINS as Record<string, { bucketName: string; originUrl: string | null }>)[mode];

/**
 * Every HOSTNAME that serves the PRODUCTION catalog.
 *
 * Derived from `CATALOG_ORIGINS` so the denylist cannot drift from the identity
 * table it exists to protect. Hostnames, not URLs: the consumer compares a
 * parsed `URL.hostname`, and a denylist of full URLs would silently never
 * match — which is exactly the failure mode this list exists to prevent.
 */
export const PRODUCTION_CATALOG_ORIGINS: readonly string[] = (
  [CATALOG_ORIGINS.production.originUrl] as readonly (string | null)[]
)
  .filter((url): url is string => typeof url === 'string' && url.length > 0)
  .map((url) => new URL(url).hostname);

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
