// scripts/src/lib/catalog/__tests__/release_target.test.ts
//
// The release-target gate is the last thing standing between a staging
// rehearsal and the production catalog. Every case below is a way that
// separation could be lost.

import { describe, expect, test } from 'bun:test';
import { R2_BUCKETS } from '@aikami/constants';
import {
  CATALOG_ORIGIN_FORBIDDEN_HOSTS,
  CATALOG_TEST_SEAM_ENV,
  REMOTE_RELEASE_MODES,
  ReleaseTargetError,
  resolveReleaseTarget,
} from '../release_target.ts';

const STAGING_ORIGIN = 'https://staging-assets.example.test';
const PRODUCTION_ORIGIN = `https://${CATALOG_ORIGIN_FORBIDDEN_HOSTS[0]}`;

const staging = (env: Partial<Parameters<typeof resolveReleaseTarget>[0]['env']> = {}) =>
  resolveReleaseTarget({
    mode: 'staging',
    env: { catalogOriginUrl: STAGING_ORIGIN, ...env },
  });

const production = (env: Partial<Parameters<typeof resolveReleaseTarget>[0]['env']> = {}) =>
  resolveReleaseTarget({
    mode: 'production',
    env: { catalogOriginUrl: PRODUCTION_ORIGIN, ...env },
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

  test('production is allowed to read the production origin', () => {
    expect(production().originUrl).toBe(PRODUCTION_ORIGIN);
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
    // scripts/.env.production is not committed, so the cross-mode origin
    // comparison cannot run. The gate must say so rather than imply a check
    // that did not happen.
    const target = staging();
    expect(target.warnings.join(' ')).toContain('scripts/.env.production');
  });
});
