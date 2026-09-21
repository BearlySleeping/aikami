// scripts/src/lib/catalog/__tests__/release_lifecycle.test.ts
//
// The typed release lifecycle, and the failure-atomicity guarantees a release
// has to be able to state.
//
// These target the FINAL model: a sealed CandidateLock is promoted unchanged,
// and every pre-activation failure must leave the previous complete release
// authoritative.

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATALOG_ORIGINS } from '@aikami/constants';
import {
  type CandidateLock,
  CandidateLockSchema,
  type ReleasePlan,
  ReleasePlanSchema,
  ReleaseReceiptSchema,
} from '@aikami/schemas';
import { Value } from 'typebox/value';
import { group, sealCandidate } from '../candidate_lock.ts';
import {
  buildReceipt,
  checkPromotion,
  computePlanHash,
  validateReleasePlan,
  verifyCandidate,
} from '../release.ts';

const emptyGroup = () => group([]);

const makeCandidate = (overrides: Partial<Omit<CandidateLock, 'lockHash'>> = {}): CandidateLock =>
  sealCandidate({
    schemaVersion: 'candidate.lock.v2',
    source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) },
    packId: 'emberwatch',
    packVersion: '5.0.0',
    sealedAt: '2026-09-19T00:00:00.000Z',
    manifest: emptyGroup(),
    maps: emptyGroup(),
    terrainAtlas: emptyGroup(),
    propAtlas: emptyGroup(),
    portraits: emptyGroup(),
    enemyVisuals: emptyGroup(),
    audio: emptyGroup(),
    seed: emptyGroup(),
    rights: { passed: true, digest: 'c'.repeat(64), summary: '74 artifacts, 0 blocked' },
    surface: { passed: true, digest: 'd'.repeat(64), summary: '0 error(s)' },
    ...overrides,
  });

const makePlan = (candidate: CandidateLock, overrides: Partial<ReleasePlan> = {}): ReleasePlan => {
  const plan: ReleasePlan = {
    schemaVersion: 'release.plan.v1',
    candidateLockHash: candidate.lockHash,
    target: { mode: 'staging', bucket: 'aikami-staging-catalog', originUrl: 'https://s.test' },
    base: null,
    merge: {
      carried: 0,
      replaced: 0,
      added: 74,
      retired: 0,
      total: 74,
      addedTags: [],
      replacedTags: [],
      retiredTags: [],
    },
    objects: [],
    uploadsRequired: 0,
    catalogRootHash: 'e'.repeat(64),
    catalogShards: { 'index/v1/revisions/x/maps.json': 'f'.repeat(64) },
    packLockHash: '',
    rightsPassed: candidate.rights.passed,
    surfacePassed: candidate.surface.passed,
    createdAt: '2026-09-19T00:00:00.000Z',
    planHash: '',
    ...overrides,
  };
  plan.planHash = computePlanHash(plan);
  return plan;
};

describe('verifyCandidate — the candidate must be what it claims', () => {
  test('a matching candidate verifies', () => {
    const sealed = makeCandidate();
    const result = verifyCandidate({ sealed, rebuild: () => sealed });
    expect(result.ok).toBe(true);
  });

  test('a TAMPERED lock is rejected by its own hash', () => {
    const sealed = makeCandidate();
    const tampered = { ...sealed, packVersion: '9.9.9' };
    const result = verifyCandidate({ sealed: tampered, rebuild: () => sealed });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('has been modified');
    }
  });

  test('CONTENT DRIFT since sealing is rejected and names the group', () => {
    const sealed = makeCandidate();
    const drifted = makeCandidate({
      maps: group([{ id: 'maps/village.json', sha256: 'z'.repeat(64), sizeBytes: 10 }]),
    });
    const result = verifyCandidate({ sealed, rebuild: () => drifted });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('maps');
      expect(result.error).toContain('Re-seal');
    }
  });

  test('a source-identity change alone is rejected', () => {
    const sealed = makeCandidate();
    const moved = makeCandidate({ source: { commit: '9'.repeat(40), tree: 'b'.repeat(40) } });
    const result = verifyCandidate({ sealed, rebuild: () => moved });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('source identity');
    }
  });
});

describe('validateReleasePlan — refuses a plan that must not be applied', () => {
  const candidate = makeCandidate();

  test('a sound plan passes', () => {
    expect(validateReleasePlan({ plan: makePlan(candidate), candidate }).ok).toBe(true);
  });

  test('a plan for a different candidate is refused', () => {
    const other = makeCandidate({ packVersion: '6.0.0' });
    const result = validateReleasePlan({ plan: makePlan(candidate), candidate: other });
    expect(result.ok).toBe(false);
  });

  test('a failed rights gate is refused', () => {
    const failed = makeCandidate({
      rights: { passed: false, digest: 'c'.repeat(64), summary: '3 blocked' },
    });
    const result = validateReleasePlan({ plan: makePlan(failed), candidate: failed });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('rights gate');
    }
  });

  test('a failed surface gate is refused', () => {
    const failed = makeCandidate({
      surface: { passed: false, digest: 'd'.repeat(64), summary: '2 error(s)' },
    });
    const result = validateReleasePlan({ plan: makePlan(failed), candidate: failed });
    expect(result.ok).toBe(false);
  });

  test('a plan that would EMPTY the catalog is refused', () => {
    const result = validateReleasePlan({
      plan: makePlan(candidate, {
        merge: {
          carried: 0,
          replaced: 0,
          added: 0,
          retired: 0,
          total: 0,
          addedTags: [],
          replacedTags: [],
          retiredTags: [],
        },
      }),
      candidate,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('empty');
    }
  });

  test('a plan that would DROP carried entries is refused', () => {
    // The catalog-truncation failure, caught at plan time rather than after
    // activation.
    const result = validateReleasePlan({
      plan: makePlan(candidate, {
        merge: {
          carried: 12700,
          replaced: 0,
          added: 3,
          retired: 0,
          total: 3,
          addedTags: [],
          replacedTags: [],
          retiredTags: [],
        },
      }),
      candidate,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('drop catalog entries');
    }
  });

  test('a plan with no root hash is refused', () => {
    const result = validateReleasePlan({
      plan: makePlan(candidate, { catalogRootHash: '' }),
      candidate,
    });
    expect(result.ok).toBe(false);
  });
});

describe('plan identity is independent of the moment it was computed', () => {
  const candidate = makeCandidate();

  test('recomputing a plan minutes later yields the same planHash', () => {
    const a = makePlan(candidate, { createdAt: '2026-09-19T00:00:00.000Z' });
    const b = makePlan(candidate, { createdAt: '2026-09-19T09:00:00.000Z' });
    expect(a.planHash).toBe(b.planHash);
  });

  test('whether an object is already uploaded does not change the planHash', () => {
    // A half-finished attempt must not look like a different plan.
    const withObjects = (present: boolean) =>
      makePlan(candidate, {
        objects: [{ key: 'assets/x', hash: 'a'.repeat(64), role: 'asset', present }],
        uploadsRequired: present ? 0 : 1,
      });
    expect(withObjects(true).planHash).toBe(withObjects(false).planHash);
  });

  test('a different candidate produces a different planHash', () => {
    const other = makeCandidate({ packVersion: '6.0.0' });
    expect(makePlan(candidate).planHash).not.toBe(makePlan(other).planHash);
  });

  test('a different target produces a different planHash', () => {
    const production = makePlan(candidate, {
      target: { mode: 'production', bucket: 'aikami-catalog', originUrl: 'https://p.test' },
    });
    expect(production.planHash).not.toBe(makePlan(candidate).planHash);
  });
});

describe('promotion — production publishes the candidate staging approved', () => {
  const candidate = makeCandidate();

  /** A staging receipt that satisfies every promotion requirement. */
  const stagingReceipt = (overrides: Record<string, unknown> = {}) => ({
    candidateLockHash: candidate.lockHash,
    mode: 'staging',
    bucket: CATALOG_ORIGINS.staging.bucketName,
    originUrl: CATALOG_ORIGINS.staging.originUrl as string,
    activated: true,
    alreadyActive: false,
    verified: true,
    ...overrides,
  });

  test('the same candidate is promotable', () => {
    const result = checkPromotion({
      stagingReceipt: stagingReceipt(),
      candidateLockHash: candidate.lockHash,
    });
    expect(result.ok).toBe(true);
  });

  test('a DIFFERENT candidate is refused', () => {
    const other = makeCandidate({ packVersion: '6.0.0' });
    const result = checkPromotion({
      stagingReceipt: stagingReceipt(),
      candidateLockHash: other.lockHash,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('receipt-candidate-mismatch');
      expect(result.reason).toContain('differs from the staging-approved');
    }
  });

  test('a staging receipt that never activated is refused', () => {
    // Nothing was approved, so there is nothing to promote.
    const result = checkPromotion({
      stagingReceipt: stagingReceipt({ activated: false }),
      candidateLockHash: candidate.lockHash,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('receipt-not-activated');
      expect(result.reason).toContain('never activated');
    }
  });

  test('an already-active staging release remains promotable without fabricating activation', () => {
    const result = checkPromotion({
      stagingReceipt: stagingReceipt({ activated: false, alreadyActive: true }),
      candidateLockHash: candidate.lockHash,
    });
    expect(result.ok).toBe(true);
  });

  test('a staging receipt that activated but never VERIFIED is refused', () => {
    // The pointer moved, but the release was never re-read from staging's own
    // origin. An unverified write is not an approval.
    const result = checkPromotion({
      stagingReceipt: stagingReceipt({ verified: false }),
      candidateLockHash: candidate.lockHash,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('receipt-not-verified');
    }
  });

  test('a production receipt cannot be used as the approval reference', () => {
    const result = checkPromotion({
      stagingReceipt: stagingReceipt({ mode: 'production' }),
      candidateLockHash: candidate.lockHash,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('receipt-wrong-mode');
    }
  });

  test('an unknown or emulator mode is refused, not merely a production one', () => {
    // The old guard was `mode === 'production'`, so a typo, an emulator run or
    // an empty string all passed as "not production".
    for (const mode of ['emulator', 'prod', '', 'STAGING']) {
      const result = checkPromotion({
        stagingReceipt: stagingReceipt({ mode }),
        candidateLockHash: candidate.lockHash,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('receipt-wrong-mode');
      }
    }
  });

  test('a receipt that wrote to the production bucket is refused', () => {
    const result = checkPromotion({
      stagingReceipt: stagingReceipt({ bucket: CATALOG_ORIGINS.production.bucketName }),
      candidateLockHash: candidate.lockHash,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('receipt-wrong-bucket');
    }
  });

  test('a receipt verified against the production origin is refused', () => {
    const result = checkPromotion({
      stagingReceipt: stagingReceipt({ originUrl: CATALOG_ORIGINS.production.originUrl }),
      candidateLockHash: candidate.lockHash,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('receipt-wrong-origin');
    }
  });

  test('promotion does NOT require the whole catalog graph to match', () => {
    // Staging and production legitimately carry different unrelated base
    // entries, so their roots differ while the candidate is identical. Only the
    // candidate hash is compared.
    const result = checkPromotion({
      stagingReceipt: stagingReceipt(),
      candidateLockHash: candidate.lockHash,
    });
    expect(result.ok).toBe(true);
  });
});

describe('receipts report activation and alias degradation separately', () => {
  const candidate = makeCandidate();
  const plan = makePlan(candidate);

  const receipt = (report: Parameters<typeof buildReceipt>[0]['report']) =>
    buildReceipt({
      candidate,
      plan,
      report,
      previousReleaseId: 'prev-1',
      phases: [],
      startedAt: '2026-09-19T00:00:00.000Z',
      verified: true,
      verificationError: '',
    });

  test('a receipt validates against the published schema', () => {
    expect(Value.Check(ReleaseReceiptSchema, receipt({ ok: true, releaseWritten: true }))).toBe(
      true,
    );
  });

  test('activation is driven by the publisher, not by an exit code', () => {
    expect(receipt({ ok: true, releaseWritten: true }).activated).toBe(true);
    // Everything uploaded, pointer write failed: NOT activated.
    expect(receipt({ ok: false, releaseWritten: false }).activated).toBe(false);
  });

  test('already-active is persisted separately from pointer activation', () => {
    const r = receipt({ ok: true, releaseWritten: false, alreadyActive: true });
    expect(r.activated).toBe(false);
    expect(r.alreadyActive).toBe(true);
  });

  test('a failed pointer write leaves the previous release named', () => {
    const r = receipt({ ok: false, releaseWritten: false });
    expect(r.previousReleaseId).toBe('prev-1');
    expect(r.releaseId).toBe('');
  });

  test('the receipt records the publisher\u2019s own release id, never an invented one', () => {
    const published = receipt({
      ok: true,
      releaseWritten: true,
      releaseId: '2026-09-20T00:00:00.000Z',
    });
    expect(published.releaseId).toBe('2026-09-20T00:00:00.000Z');
    // A publisher that never reached the activation phase supplies none, and a
    // receipt that fabricated a timestamp could not name the pointer a rollback
    // has to re-point.
    expect(receipt({ ok: false, releaseWritten: false }).releaseId).toBe('');
  });

  test('a post-activation alias failure does NOT deactivate the release', () => {
    // The immutable release is valid and active; the alias is a separate,
    // degraded concern. Rolling back a valid release would be wrong.
    const r = receipt({
      ok: true,
      releaseWritten: true,
      legacyAlias: { key: 'index/v1/pack_lock.json', written: false, error: 'ETIMEDOUT' },
    });
    expect(r.activated).toBe(true);
    expect(r.legacyAliasWritten).toBe(false);
    expect(r.legacyAliasError).toBe('ETIMEDOUT');
  });

  test('the receipt carries the candidate and plan identity', () => {
    const r = receipt({ ok: true, releaseWritten: true });
    expect(r.candidateLockHash).toBe(candidate.lockHash);
    expect(r.planHash).toBe(plan.planHash);
    expect(r.mode).toBe('staging');
    expect(r.bucket).toBe('aikami-staging-catalog');
  });

  test('a first publish records no previous release', () => {
    const r = buildReceipt({
      candidate,
      plan,
      report: { ok: true, releaseWritten: true },
      previousReleaseId: '',
      phases: [],
      startedAt: '2026-09-19T00:00:00.000Z',
      verified: true,
      verificationError: '',
    });
    expect(r.previousReleaseId).toBe('');
    expect(r.activated).toBe(true);
  });

  test('a failed remote verification is reported without deactivating', () => {
    const r = buildReceipt({
      candidate,
      plan,
      report: { ok: true, releaseWritten: true },
      previousReleaseId: 'prev-1',
      phases: [],
      startedAt: '2026-09-19T00:00:00.000Z',
      verified: false,
      verificationError: 'HTTP 404 on the new root',
    });
    expect(r.activated).toBe(true);
    expect(r.verified).toBe(false);
    expect(r.verificationError).toContain('404');
  });
});

describe('schema round-trips', () => {
  test('a candidate lock validates', () => {
    expect(Value.Check(CandidateLockSchema, makeCandidate())).toBe(true);
  });

  test('a release plan validates', () => {
    expect(Value.Check(ReleasePlanSchema, makePlan(makeCandidate()))).toBe(true);
  });

  test('a lock with a release-plane field is rejected by the schema', () => {
    // Guards the split: environment identity must not creep back into the
    // candidate.
    const withExtra = { ...makeCandidate(), catalogRootHash: '' };
    expect(Value.Check(CandidateLockSchema, withExtra)).toBe(false);
  });

  test('a receipt file round-trips through JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'receipt-'));
    const path = join(dir, 'receipt-staging.json');
    const r = buildReceipt({
      candidate: makeCandidate(),
      plan: makePlan(makeCandidate()),
      report: { ok: true, releaseWritten: true },
      previousReleaseId: '',
      phases: [],
      startedAt: '2026-09-19T00:00:00.000Z',
      verified: true,
      verificationError: '',
    });
    writeFileSync(path, JSON.stringify(r));
    expect(
      Value.Check(ReleaseReceiptSchema, JSON.parse(require('node:fs').readFileSync(path, 'utf8'))),
    ).toBe(true);
  });
});
