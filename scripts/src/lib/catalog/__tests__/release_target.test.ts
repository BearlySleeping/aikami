// scripts/src/lib/catalog/__tests__/release_target.test.ts
//
// The release-target gate is the last thing standing between a staging
// rehearsal and the production catalog. Every case below is a way that
// separation could be lost.

import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CATALOG_ORIGINS, R2_BUCKETS } from '@aikami/constants';
import {
  CATALOG_ORIGIN_FORBIDDEN_HOSTS,
  CATALOG_TEST_SEAM_ENV,
  REMOTE_RELEASE_MODES,
  ReleaseTargetError,
  resolveReleaseTarget,
} from '../release_target.ts';

const STAGING_ORIGIN = 'https://staging-assets.example.test';
const PRODUCTION_ORIGIN = `https://${CATALOG_ORIGIN_FORBIDDEN_HOSTS[0]}`;

/**
 * `scripts/` in this checkout — the directory `readSiblingEnvValue` reads from.
 *
 * `scripts/src/lib/catalog/__tests__` → up 4 → `scripts`. Deliberately derived
 * the same way the module under test derives it, so a path fix in one without
 * the other shows up as a failing test rather than a silently skipped check.
 */
const SCRIPTS_DIR = resolve(import.meta.dirname, '../../../..');
const SIBLING_PRODUCTION_ENV = join(SCRIPTS_DIR, '.env.production');

/**
 * A PROVISIONED origin table.
 *
 * The committed `CATALOG_ORIGINS` records staging's origin as `null` on purpose
 * — it genuinely is not provisioned, and the gate fails closed on that. These
 * tests exercise the origin-validation rules, which only run for a provisioned
 * mode, so the table is injected rather than edited. That keeps the shipped
 * table honest and the rules covered.
 */
const PROVISIONED = {
  production: { bucketName: 'aikami-catalog', originUrl: PRODUCTION_ORIGIN },
  staging: { bucketName: 'aikami-staging-catalog', originUrl: STAGING_ORIGIN },
};

const staging = (env: Partial<Parameters<typeof resolveReleaseTarget>[0]['env']> = {}) =>
  resolveReleaseTarget({
    mode: 'staging',
    env: { catalogOriginUrl: STAGING_ORIGIN, ...env },
    origins: PROVISIONED,
  });

const production = (env: Partial<Parameters<typeof resolveReleaseTarget>[0]['env']> = {}) =>
  resolveReleaseTarget({
    mode: 'production',
    env: { catalogOriginUrl: PRODUCTION_ORIGIN, ...env },
    origins: PROVISIONED,
  });

/** Asserts the call throws a ReleaseTargetError carrying `code`. */
const expectRejection = (fn: () => unknown, code: string): void => {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ReleaseTargetError);
  expect((thrown as ReleaseTargetError).code).toBe(code);
};

describe('release target — declared identity', () => {
  test('staging resolves the staging bucket, not production', () => {
    const target = staging();
    expect(target.bucket).toBe(R2_BUCKETS.catalog.staging.bucketName);
    expect(target.bucket).not.toBe(R2_BUCKETS.catalog.production.bucketName);
    expect(target.expectedBucket).toBe(target.bucket);
    expect(target.viaTestSeam).toBe(false);
  });

  test('production resolves the production bucket, not staging', () => {
    const target = production();
    expect(target.bucket).toBe(R2_BUCKETS.catalog.production.bucketName);
    expect(target.bucket).not.toBe(R2_BUCKETS.catalog.staging.bucketName);
    expect(target.expectedBucket).toBe(target.bucket);
  });

  test('the two remote modes declare distinct buckets', () => {
    // Defence in depth: if R2_BUCKETS ever declared one bucket for both modes,
    // every cross-mode check below would silently become a no-op.
    const buckets = REMOTE_RELEASE_MODES.map((mode) => R2_BUCKETS.catalog[mode].bucketName);
    expect(new Set(buckets).size).toBe(buckets.length);
  });

  test('an undeclared mode is refused', () => {
    expectRejection(
      () => resolveReleaseTarget({ mode: 'sandbox', env: { catalogOriginUrl: STAGING_ORIGIN } }),
      'no-declared-bucket',
    );
  });
});

describe('release target — a config override cannot retarget a remote mode', () => {
  test('THE SHIPPED BUG: staging + CATALOG_BUCKET=aikami-catalog is rejected', () => {
    // This is the exact configuration scripts/.env.staging carried. It used to
    // resolve to the production bucket and write there.
    expectRejection(
      () => staging({ catalogBucket: R2_BUCKETS.catalog.production.bucketName }),
      'bucket-override-rejected',
    );
  });

  test('production + CATALOG_BUCKET=aikami-staging-catalog is rejected', () => {
    expectRejection(
      () => production({ catalogBucket: R2_BUCKETS.catalog.staging.bucketName }),
      'bucket-override-rejected',
    );
  });

  test('any override that disagrees with the declared bucket is rejected', () => {
    expectRejection(
      () => staging({ catalogBucket: 'aikami-some-other-bucket' }),
      'bucket-override-rejected',
    );
  });

  test('an override that AGREES with the declared bucket is not an override', () => {
    const target = staging({ catalogBucket: R2_BUCKETS.catalog.staging.bucketName });
    expect(target.bucket).toBe(R2_BUCKETS.catalog.staging.bucketName);
    expect(target.viaTestSeam).toBe(false);
  });
});

describe('release target — the test seam cannot reach a real environment', () => {
  test('the seam may not name the production bucket', () => {
    expectRejection(
      () =>
        staging({
          catalogBucket: R2_BUCKETS.catalog.production.bucketName,
          testSeam: '1',
        }),
      'test-seam-names-remote-bucket',
    );
  });

  test('the seam cannot be used to "confirm" the declared bucket', () => {
    // Naming the mode's own bucket is not an override, so the seam is inert —
    // it must not report itself as active and thereby make a real publish look
    // like a rehearsal.
    const target = staging({ catalogBucket: R2_BUCKETS.catalog.staging.bucketName, testSeam: '1' });
    expect(target.bucket).toBe(R2_BUCKETS.catalog.staging.bucketName);
    expect(target.viaTestSeam).toBe(false);
  });

  test('a scratch bucket is reachable only with the seam explicitly set', () => {
    expectRejection(
      () => staging({ catalogBucket: 'aikami-scratch-catalog' }),
      'bucket-override-rejected',
    );

    const target = staging({ catalogBucket: 'aikami-scratch-catalog', testSeam: '1' });
    expect(target.bucket).toBe('aikami-scratch-catalog');
    expect(target.viaTestSeam).toBe(true);
    // The seam must announce itself — a rehearsal that looks like a real
    // publish in the log is how a scratch run gets mistaken for evidence.
    expect(target.warnings.join(' ')).toContain(CATALOG_TEST_SEAM_ENV);
  });

  test('the seam is inert for a mode that declares no bucket', () => {
    expectRejection(
      () =>
        resolveReleaseTarget({
          mode: 'emulator',
          env: {
            catalogBucket: 'aikami-scratch-catalog',
            testSeam: '1',
            catalogOriginUrl: STAGING_ORIGIN,
          },
        }),
      'no-declared-bucket',
    );
  });
});

describe('release target — the read origin must not be production', () => {
  test('staging must not read the production catalog origin', () => {
    // Verifying a staging write by reading production proves nothing about
    // staging, and hides exactly the failure this gate exists to catch.
    expectRejection(() => staging({ catalogOriginUrl: PRODUCTION_ORIGIN }), 'origin-is-production');
  });

  test('a mode with NO provisioned origin fails closed, never falling back', () => {
    // A table that records staging as unprovisioned — the shape the committed
    // one had before `assets.stg.bearlysleeping.com` was attached to
    // `aikami-staging-catalog`. The gate must refuse rather than accept
    // whatever the environment says, because the only other origin available
    // is production's — which is the bug this whole gate exists to catch.
    const UNPROVISIONED = {
      production: { bucketName: 'aikami-catalog', originUrl: PRODUCTION_ORIGIN },
      staging: { bucketName: 'aikami-staging-catalog', originUrl: null },
    };
    expectRejection(
      () =>
        resolveReleaseTarget({
          mode: 'staging',
          env: { catalogOriginUrl: STAGING_ORIGIN },
          origins: UNPROVISIONED,
        }),
      'origin-not-provisioned',
    );
  });

  test('the shipped table records a real, distinct staging identity', () => {
    // Guards the invariant rather than trusting it: staging must name its own
    // bucket and its own PROVISIONED origin, and neither may equal
    // production's. This is the regression that would otherwise be silent —
    // staging quietly publishing to, or verifying against, production.
    expect(CATALOG_ORIGINS.staging.bucketName).toBe('aikami-staging-catalog');
    expect(CATALOG_ORIGINS.staging.originUrl).toBe('https://assets.stg.bearlysleeping.com');
    expect(CATALOG_ORIGINS.production.bucketName).toBe('aikami-catalog');
    expect(CATALOG_ORIGINS.production.originUrl).toBe('https://assets.bearlysleeping.com');
    expect(CATALOG_ORIGINS.staging.bucketName).not.toBe(CATALOG_ORIGINS.production.bucketName);
    expect(CATALOG_ORIGINS.staging.originUrl).not.toBe(CATALOG_ORIGINS.production.originUrl);
  });

  test('the staging origin is not on the production denylist', () => {
    // `CATALOG_ORIGIN_FORBIDDEN_HOSTS` is DERIVED from the production entry, so
    // this also proves the derivation still points at production and not at
    // whichever entry happens to be listed last.
    const stagingHost = new URL(CATALOG_ORIGINS.staging.originUrl as string).hostname;
    const productionHost = new URL(CATALOG_ORIGINS.production.originUrl as string).hostname;
    expect(CATALOG_ORIGIN_FORBIDDEN_HOSTS).toContain(productionHost);
    expect(CATALOG_ORIGIN_FORBIDDEN_HOSTS).not.toContain(stagingHost);
  });

  test('the committed table resolves staging end to end, with no injected table', () => {
    // The injected-table tests above exercise the RULES; this one exercises the
    // SHIPPED identity, so a table that is internally consistent but wrong
    // (e.g. both modes pointing at production) still fails.
    const target = resolveReleaseTarget({
      mode: 'staging',
      env: {
        catalogBucket: 'aikami-staging-catalog',
        catalogOriginUrl: 'https://assets.stg.bearlysleeping.com',
      },
    });
    expect(target.bucket).toBe('aikami-staging-catalog');
    expect(target.originUrl).toBe('https://assets.stg.bearlysleeping.com');
    expect(target.viaTestSeam).toBe(false);
  });

  test('the committed table resolves production end to end, with no injected table', () => {
    const target = resolveReleaseTarget({
      mode: 'production',
      env: {
        catalogBucket: 'aikami-catalog',
        catalogOriginUrl: 'https://assets.bearlysleeping.com',
      },
    });
    expect(target.bucket).toBe('aikami-catalog');
    expect(target.originUrl).toBe('https://assets.bearlysleeping.com');
  });

  test('production is allowed to read the production origin', () => {
    expect(production().originUrl).toBe(PRODUCTION_ORIGIN);
  });

  test('staging rejects a non-production origin that does not match its declaration', () => {
    expectRejection(
      () => staging({ catalogOriginUrl: 'https://other-staging.example.test' }),
      'origin-override-rejected',
    );
  });

  test('production rejects an origin that does not match its declaration', () => {
    expectRejection(
      () => production({ catalogOriginUrl: 'https://production-alias.example.test' }),
      'origin-override-rejected',
    );
  });

  test('a missing origin is refused', () => {
    expectRejection(
      () => resolveReleaseTarget({ mode: 'staging', env: { catalogOriginUrl: '' } }),
      'origin-missing',
    );
  });

  test('a malformed origin is refused', () => {
    expectRejection(() => staging({ catalogOriginUrl: 'not a url' }), 'origin-invalid');
  });

  test('a trailing slash is normalised so asset URLs never double-slash', () => {
    expect(staging({ catalogOriginUrl: `${STAGING_ORIGIN}/` }).originUrl).toBe(STAGING_ORIGIN);
  });

  test('an absent sibling env file is reported, not silently ignored', () => {
    // scripts/.env.production is not committed, so in CI the cross-mode origin
    // comparison cannot run. The gate must say so rather than imply a check
    // that did not happen. A developer checkout that HAS decrypted
    // scripts/.env.production exercises the real comparison instead — so the
    // assertion is conditional on which of the two situations this is, and
    // neither branch is allowed to be silent.
    const warned = staging().warnings.join(' ');
    if (existsSync(SIBLING_PRODUCTION_ENV)) {
      expect(warned).not.toContain('is absent');
    } else {
      expect(warned).toContain('scripts/.env.production');
    }
  });
});
