// scripts/src/lib/catalog/release_target.ts
//
// Release-target identity resolution and its fail-closed safety gate.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// C-454 introduced mode-aware catalog bucket resolution (`R2_BUCKETS.catalog`):
//
//     production -> aikami-catalog
//     staging    -> aikami-staging-catalog
//
// …specifically so a typo could not publish into the production bucket. That
// guarantee was defeated in practice by the `CATALOG_BUCKET` environment
// override, which took PRECEDENCE over the mode-aware resolution:
//
//     const bucket = getScriptsEnv('CATALOG_BUCKET') || resolveDefaultCatalogBucket(mode);
//
// `scripts/.env.staging` (generated from `secrets/staging.enc.env`) declared
// `CATALOG_BUCKET=aikami-catalog` and
// `CATALOG_ORIGIN_URL=https://assets.bearlysleeping.com` — production identity.
// A `--mode staging` publish therefore resolved to the PRODUCTION bucket and
// the PRODUCTION read origin. The mode-aware safety net never ran, because the
// override short-circuited it.
//
// That is a release-target bug, not a reporting error: the override is
// configuration, and configuration must not be able to silently retarget a
// remote mode at the other environment's bucket.
//
// ── The rule ───────────────────────────────────────────────────────────────
//
// For a REMOTE mode (staging, production) the resolved bucket and origin are
// DERIVED, never accepted from an override:
//
//   1. bucket MUST equal `R2_BUCKETS.catalog[mode].bucketName`
//   2. bucket MUST NOT equal the other remote mode's declared bucket
//   3. origin MUST NOT equal the other remote mode's origin, when that origin
//      is resolvable from the sibling `scripts/.env.{otherMode}`
//   4. origin MUST NOT equal any origin in `CATALOG_ORIGIN_FORBIDDEN_HOSTS`,
//      which is DERIVED from `CATALOG_ORIGINS` in `@aikami/constants` — the
//      canonical per-mode origin identity table. Deriving it keeps the denylist
//      from drifting from the identity it protects.
//   5. origin MUST be provisioned. `CATALOG_ORIGINS[mode].originUrl === null`
//      means the mode has no public read origin yet, which fails closed rather
//      than falling back to production.
//
// An override is still available for LOCAL work, but only through an explicit
// test seam that cannot name a remote bucket or origin. That keeps the local
// rehearsal workflow (C-454's stated reason for the override) while making the
// dangerous case unreachable.
//
// On the denylist: C-395 forbids hardcoding the catalog hostname as
// *configuration* (the origin is injected, and re-pointing must only require
// regenerating the index). A denylist is not configuration — it is a safety
// check whose whole purpose is to recognise a known-dangerous value. Keeping it
// out of code would mean the check silently disappears whenever the sibling env
// file is absent, which is exactly the state this bug shipped in. It is
// therefore declared here, explicitly, with that reasoning.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CATALOG_ORIGINS,
  PRODUCTION_CATALOG_ORIGINS,
  R2_BUCKETS,
  resolveBucketName,
} from '@aikami/constants';
import { scriptsEnvRoot } from '../env/scripts_env.ts';

/** Modes that address a real remote catalog. Emulator/testing never do. */
export const REMOTE_RELEASE_MODES = ['staging', 'production'] as const;
export type RemoteReleaseMode = (typeof REMOTE_RELEASE_MODES)[number];

/**
 * Hostnames that must never serve a non-production catalog release.
 *
 * Safety denylist, not configuration — see the module header. These are the
 * public origins currently known to serve the production catalog; a staging
 * publish that resolves to one of them would write production-visible bytes
 * while believing it was rehearsing.
 */
export const CATALOG_ORIGIN_FORBIDDEN_HOSTS: readonly string[] = PRODUCTION_CATALOG_ORIGINS;

/**
 * The ONLY way to point a local run at a non-declared bucket.
 *
 * Set `AIKAMI_CATALOG_TEST_SEAM=1` and `CATALOG_BUCKET=<name>`. The seam is
 * rejected if `<name>` is any declared remote bucket, so it cannot be used to
 * retarget a real environment — only to rehearse against a scratch bucket.
 */
export const CATALOG_TEST_SEAM_ENV = 'AIKAMI_CATALOG_TEST_SEAM';

/** Thrown for every release-target violation. Never carries credentials. */
export class ReleaseTargetError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ReleaseTargetError';
    this.code = code;
  }
}

/** Safe, credential-free description of what a run will read and write. */
export type ReleaseTarget = {
  /** Requested mode. */
  mode: string;
  /** Bucket the publisher will WRITE to. */
  bucket: string;
  /** Origin the index will record and verification will READ from. */
  originUrl: string;
  /** The bucket `R2_BUCKETS.catalog[mode]` declares for this mode. */
  expectedBucket: string;
  /** True when `bucket` came from the explicit local test seam. */
  viaTestSeam: boolean;
  /** Non-fatal observations worth printing (never contains secrets). */
  warnings: readonly string[];
};

/** Every bucket name any remote mode declares. */
const declaredRemoteBuckets = (): string[] =>
  REMOTE_RELEASE_MODES.map((mode) => R2_BUCKETS.catalog[mode].bucketName);

/**
 * Reads one key from a sibling `scripts/.env.{mode}` without loading it into
 * `process.env` (loading would let a sibling file retarget the current run).
 */
const readSiblingEnvValue = (mode: string, key: string): string | undefined => {
  const path = join(scriptsEnvRoot(), 'scripts', `.env.${mode}`);
  if (!existsSync(path)) {
    return undefined;
  }
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      continue;
    }
    if (trimmed.slice(0, eq).trim() === key) {
      return trimmed.slice(eq + 1).trim();
    }
  }
  return undefined;
};

/** The other remote mode, for cross-checks. */
const siblingRemoteMode = (mode: RemoteReleaseMode): RemoteReleaseMode =>
  mode === 'staging' ? 'production' : 'staging';

/** The canonical per-mode origin identity table, widened for arbitrary mode strings. */
type OriginTable = Record<string, { bucketName: string; originUrl: string | null }>;

type ReleaseTargetEnv = {
  catalogBucket?: string | undefined;
  catalogOriginUrl?: string | undefined;
  testSeam?: string | undefined;
};

const defaultOrigins = (): OriginTable => ({
  production: CATALOG_ORIGINS.production,
  staging: CATALOG_ORIGINS.staging,
});

/** Step 1: the mode must declare a catalog bucket at all. */
const expectedBucketFor = (mode: string): string => {
  const expectedBucket = resolveBucketName({ bucketKey: 'catalog', mode });
  if (expectedBucket) {
    return expectedBucket;
  }
  throw new ReleaseTargetError(
    'no-declared-bucket',
    `No catalog bucket is declared for mode ${JSON.stringify(mode)}. ` +
      `Declared modes: ${REMOTE_RELEASE_MODES.join(', ')}.`,
  );
};

/**
 * Step 2: the bucket is DERIVED from the mode, and an override that disagrees
 * is only ever legitimate as an explicit local rehearsal.
 */
const resolveReleaseBucket = (options: {
  mode: string;
  env: ReleaseTargetEnv;
  expectedBucket: string;
  warnings: string[];
}): { bucket: string; viaTestSeam: boolean } => {
  const { mode, env, expectedBucket, warnings } = options;
  const override = env.catalogBucket?.trim();
  if (!override || override === expectedBucket) {
    return { bucket: expectedBucket, viaTestSeam: false };
  }
  if (env.testSeam !== '1') {
    throw new ReleaseTargetError(
      'bucket-override-rejected',
      `CATALOG_BUCKET=${JSON.stringify(override)} disagrees with the bucket declared for ` +
        `mode ${JSON.stringify(mode)} (${JSON.stringify(expectedBucket)}). Refusing to ` +
        'publish: a configuration override must not retarget a remote mode. Remove ' +
        'CATALOG_BUCKET from scripts/.env.' +
        `${mode} (and from secrets/${mode}.enc.env), or set ${CATALOG_TEST_SEAM_ENV}=1 to ` +
        'rehearse against a scratch bucket.',
    );
  }
  if ((declaredRemoteBuckets() as string[]).includes(override)) {
    throw new ReleaseTargetError(
      'test-seam-names-remote-bucket',
      `The test seam may not name a declared remote bucket (${JSON.stringify(override)}). ` +
        `Declared remote buckets: ${declaredRemoteBuckets().join(', ')}.`,
    );
  }
  warnings.push(
    `test seam active (${CATALOG_TEST_SEAM_ENV}=1): writing to scratch bucket ${JSON.stringify(override)} instead of ${JSON.stringify(expectedBucket)}`,
  );
  return { bucket: override, viaTestSeam: true };
};

/**
 * Step 3: a bucket must never be shared between two remote modes, so a swapped
 * or copy-pasted env file cannot make staging write production.
 */
const assertBucketNotSharedWithSibling = (mode: string, bucket: string): void => {
  const sibling = siblingRemoteMode(mode as RemoteReleaseMode);
  if (bucket !== R2_BUCKETS.catalog[sibling].bucketName) {
    return;
  }
  throw new ReleaseTargetError(
    'bucket-shared-with-other-mode',
    `Mode ${JSON.stringify(mode)} resolved to ${JSON.stringify(bucket)}, which is the bucket ` +
      `declared for ${JSON.stringify(sibling)}. Refusing to publish.`,
  );
};

/**
 * Steps 4–5: the read origin must be present, parseable and PROVISIONED for
 * this mode. `originUrl: null` means the mode has no public read origin yet —
 * fail closed rather than accept whatever the environment happens to say,
 * because the only other origin available is production's.
 */
const resolveReleaseOrigin = (options: {
  mode: string;
  env: ReleaseTargetEnv;
  origins: OriginTable;
}): { host: string; originUrl: string } => {
  const { mode, env, origins } = options;
  const originUrl = env.catalogOriginUrl?.trim() ?? '';
  if (!originUrl) {
    throw new ReleaseTargetError(
      'origin-missing',
      `CATALOG_ORIGIN_URL is not set for mode ${JSON.stringify(mode)}. Set it in ` +
        `scripts/.env.${mode} (see scripts/.env.example).`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(originUrl);
  } catch {
    throw new ReleaseTargetError(
      'origin-invalid',
      `CATALOG_ORIGIN_URL is not a valid URL (${JSON.stringify(originUrl)}).`,
    );
  }
  const declared = origins[mode];
  if (declared?.originUrl === null) {
    throw new ReleaseTargetError(
      'origin-not-provisioned',
      `Mode ${JSON.stringify(mode)} has no declared catalog origin yet ` +
        `(CATALOG_ORIGINS.${mode}.originUrl is null), so a ${mode} publish could not be ` +
        'verified. Provision a public read origin for ' +
        `\`${declared.bucketName}\` and record it in CATALOG_ORIGINS before publishing.`,
    );
  }
  return { host: parsed.hostname, originUrl: parsed.toString().replace(/\/+$/, '') };
};

/**
 * Step 6: a non-production mode must never read the production catalog —
 * verifying a staging write by reading production proves nothing about staging.
 */
const assertOriginNotForbiddenHost = (mode: string, host: string): void => {
  if (
    mode === 'production' ||
    !(CATALOG_ORIGIN_FORBIDDEN_HOSTS as readonly string[]).includes(host)
  ) {
    return;
  }
  throw new ReleaseTargetError(
    'origin-is-production',
    `Mode ${JSON.stringify(mode)} resolved its read origin to ${JSON.stringify(host)}, which ` +
      'serves the production catalog. A non-production release must have its own read ' +
      `origin — verifying a ${mode} write against production is not verification. Set ` +
      `CATALOG_ORIGIN_URL in scripts/.env.${mode} to the ${mode} catalog origin.`,
  );
};

/** Step 7: the origin must equal the one this mode declares, when it declares one. */
const assertOriginMatchesDeclared = (options: {
  mode: string;
  originUrl: string;
  declared: { originUrl: string | null } | undefined;
}): void => {
  const { mode, originUrl, declared } = options;
  if (declared?.originUrl === null || declared?.originUrl === undefined) {
    return;
  }
  const normalizedDeclaredOrigin = new URL(declared.originUrl).toString().replace(/\/+$/, '');
  if (normalizedDeclaredOrigin === originUrl) {
    return;
  }
  throw new ReleaseTargetError(
    'origin-override-rejected',
    `CATALOG_ORIGIN_URL=${JSON.stringify(originUrl)} disagrees with the origin ` +
      `declared for mode ${JSON.stringify(mode)} ` +
      `(${JSON.stringify(normalizedDeclaredOrigin)}). Refusing to publish.`,
  );
};

/** Step 8: the two remote modes must not share one catalog origin. */
const assertOriginNotSharedWithSibling = (options: {
  mode: string;
  host: string;
  warnings: string[];
}): void => {
  const { mode, host, warnings } = options;
  const sibling = siblingRemoteMode(mode as RemoteReleaseMode);
  const siblingOrigin = readSiblingEnvValue(sibling, 'CATALOG_ORIGIN_URL');
  if (!siblingOrigin) {
    if (mode !== 'production') {
      warnings.push(
        `scripts/.env.${sibling} is absent, so the ${mode} origin could not be compared against ` +
          `${sibling}'s. Only the denylist and bucket checks protect this run.`,
      );
    }
    return;
  }
  let siblingHost: string | undefined;
  try {
    siblingHost = new URL(siblingOrigin).hostname;
  } catch {
    siblingHost = undefined;
  }
  if (siblingHost && siblingHost === host) {
    throw new ReleaseTargetError(
      'origin-shared-with-other-mode',
      `Mode ${JSON.stringify(mode)} and ${JSON.stringify(sibling)} both resolve their read ` +
        `origin to ${JSON.stringify(host)}. Refusing to publish: the two modes would share ` +
        'one catalog.',
    );
  }
};

/**
 * Resolves and VALIDATES the release target for a mode.
 *
 * @throws {ReleaseTargetError} before any caller can write, when the resolved
 *   target does not match what the mode declares.
 */
export const resolveReleaseTarget = (options: {
  mode: string;
  /** Raw values, injected so tests need not mutate `process.env`. */
  env: ReleaseTargetEnv;
  /**
   * Canonical origin identity table. Defaults to the committed one; injected by
   * tests so a PROVISIONED origin can be exercised without editing the shipped
   * table (which deliberately records staging as unprovisioned).
   */
  origins?: OriginTable;
}): ReleaseTarget => {
  const { mode, env } = options;
  const origins = options.origins ?? defaultOrigins();
  const warnings: string[] = [];

  const expectedBucket = expectedBucketFor(mode);
  const { bucket, viaTestSeam } = resolveReleaseBucket({ mode, env, expectedBucket, warnings });
  assertBucketNotSharedWithSibling(mode, bucket);

  const origin = resolveReleaseOrigin({ mode, env, origins });
  assertOriginNotForbiddenHost(mode, origin.host);
  assertOriginMatchesDeclared({ mode, originUrl: origin.originUrl, declared: origins[mode] });
  assertOriginNotSharedWithSibling({ mode, host: origin.host, warnings });

  return {
    mode,
    bucket,
    originUrl: origin.originUrl,
    expectedBucket,
    viaTestSeam,
    warnings,
  };
};

/** The single line a plan/apply prints to identify its target. Never secrets. */
export const describeReleaseTarget = (target: ReleaseTarget): string =>
  [
    `mode:   ${target.mode}`,
    `bucket: ${target.bucket}${target.viaTestSeam ? ' (test seam)' : ''}`,
    `origin: ${target.originUrl}`,
  ].join('\n');
