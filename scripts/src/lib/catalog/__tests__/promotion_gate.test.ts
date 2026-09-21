// scripts/src/lib/catalog/__tests__/promotion_gate.test.ts
//
// Production publishes the candidate staging approved — and only that.
//
// The gate has two halves, and both are exercised here:
//
//   • the RECEIPT must describe a staging approval of this candidate, naming
//     staging's canonical bucket and origin, activated AND verified;
//   • the staging RELEASE it names must still be the one staging serves,
//     hash-verified through the client's own resolver.
//
// A receipt is a file. Every one of these cases is a way a file can lie.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATALOG_ORIGINS } from '@aikami/constants';
import type { ReleaseReceipt } from '@aikami/schemas';
import { verifyStagingApproval } from '../promotion.ts';
import { buildReleaseGraph, entry, sha256 } from './release_graph_fixture.ts';

const STAGING_ORIGIN = CATALOG_ORIGINS.staging.originUrl as string;
const STAGING_BUCKET = CATALOG_ORIGINS.staging.bucketName;
const CANDIDATE = 'a'.repeat(64);

let dir: string;
let receiptPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aikami-promotion-'));
  receiptPath = join(dir, 'receipt-staging.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The staging release graph every case resolves against. */
const STAGING_GRAPH = buildReleaseGraph({
  entries: [entry({ tag: 'sprites:hero', category: 'sprites' })],
  originUrl: STAGING_ORIGIN,
  releaseId: 'release-under-test',
});

/** A receipt that satisfies every requirement, unless overridden. */
const receipt = (overrides: Partial<ReleaseReceipt> = {}): ReleaseReceipt =>
  ({
    schemaVersion: 'release.receipt.v1',
    candidateLockHash: CANDIDATE,
    planHash: 'b'.repeat(64),
    mode: 'staging',
    bucket: STAGING_BUCKET,
    originUrl: STAGING_ORIGIN,
    previousReleaseId: '',
    releaseId: 'release-under-test',
    catalogRootHash: STAGING_GRAPH.rootHash,
    catalogShards: {},
    dependencies: [],
    packLockHash: '',
    activated: true,
    alreadyActive: false,
    legacyAliasWritten: true,
    legacyAliasError: '',
    verified: true,
    verificationError: '',
    phases: [],
    startedAt: '2026-09-20T00:00:00.000Z',
    finishedAt: '2026-09-20T00:01:00.000Z',
    ...overrides,
  }) as ReleaseReceipt;

const writeReceipt = (value: unknown): void => {
  writeFileSync(receiptPath, typeof value === 'string' ? value : JSON.stringify(value));
};

/** A staging release graph, optionally superseded or corrupt. */
const stagingGraph = (options: { releaseId?: string; corruptRoot?: boolean } = {}) =>
  buildReleaseGraph({
    entries: [entry({ tag: 'sprites:hero', category: 'sprites' })],
    originUrl: STAGING_ORIGIN,
    releaseId: options.releaseId ?? 'release-under-test',
    ...(options.corruptRoot ? { corruptRoot: true } : {}),
  });

const run = (options: { candidateLockHash?: string } = {}) =>
  verifyStagingApproval({
    receiptPath,
    candidateLockHash: options.candidateLockHash ?? CANDIDATE,
    reader: stagingGraph().reader,
  });

describe('a production promotion requires a genuine staging approval', () => {
  test('a missing receipt blocks the promotion', async () => {
    const result = await run();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('receipt-absent');
    }
  });

  test('a malformed receipt blocks the promotion', async () => {
    writeReceipt('{not json');
    const result = await run();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('receipt-malformed');
    }
  });

  test('a receipt that fails the published schema blocks the promotion', async () => {
    writeReceipt({ schemaVersion: 'release.receipt.v1', mode: 'staging' });
    const result = await run();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('receipt-malformed');
    }
  });

  test('a wrong-mode receipt blocks the promotion', async () => {
    writeReceipt(receipt({ mode: 'production' }));
    const result = await run();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('receipt-wrong-mode');
    }
  });

  test('an unverified receipt blocks the promotion', async () => {
    writeReceipt(receipt({ verified: false }));
    const result = await run();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('receipt-not-verified');
    }
  });

  test('an unactivated receipt blocks the promotion', async () => {
    writeReceipt(receipt({ activated: false }));
    const result = await run();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('receipt-not-activated');
    }
  });

  test('an already-active receipt approves promotion without claiming pointer advancement', async () => {
    writeReceipt(receipt({ activated: false, alreadyActive: true }));
    const result = await run();
    expect(result.ok).toBe(true);
  });

  test('a candidate-mismatched receipt blocks the promotion', async () => {
    writeReceipt(receipt({ candidateLockHash: sha256('a different candidate') }));
    const result = await run();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('receipt-candidate-mismatch');
    }
  });

  test('a receipt naming the production bucket blocks the promotion', async () => {
    writeReceipt(receipt({ bucket: CATALOG_ORIGINS.production.bucketName }));
    const result = await run();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('receipt-wrong-bucket');
    }
  });

  test('a receipt verified against the production origin blocks the promotion', async () => {
    writeReceipt(receipt({ originUrl: CATALOG_ORIGINS.production.originUrl }));
    const result = await run();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('receipt-wrong-origin');
    }
  });
});

describe('the staging release the receipt names must still be true', () => {
  test('a receipt naming a release staging no longer serves is refused', async () => {
    writeReceipt(receipt({ releaseId: 'an-older-release' }));
    const result = await verifyStagingApproval({
      receiptPath,
      candidateLockHash: CANDIDATE,
      reader: stagingGraph({ releaseId: 'the-current-release' }).reader,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('staging-release-mismatch');
      expect(result.reason).toContain('stale');
    }
  });

  test('a receipt naming a root staging no longer serves is refused', async () => {
    writeReceipt(receipt({ catalogRootHash: sha256('a root that moved') }));
    const result = await run();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('staging-release-mismatch');
    }
  });

  test('a receipt without a complete root binding is refused as a staging mismatch', async () => {
    writeReceipt(receipt({ catalogRootHash: '' }));
    const result = await run();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('staging-release-mismatch');
      expect(result.reason).toContain('not bound');
    }
  });

  test('staging publishing no pointer at all is refused', async () => {
    writeReceipt(receipt());
    const result = await verifyStagingApproval({
      receiptPath,
      candidateLockHash: CANDIDATE,
      reader: async () => undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('staging-release-unresolvable');
    }
  });

  test('a staging release whose graph does not verify is refused', async () => {
    // The pointer names a root whose bytes do not hash to the pinned value.
    writeReceipt(receipt());
    const result = await verifyStagingApproval({
      receiptPath,
      candidateLockHash: CANDIDATE,
      reader: stagingGraph({ corruptRoot: true }).reader,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('staging-release-unresolvable');
    }
  });
});

describe('a genuine staging approval allows the promotion', () => {
  test('a valid, verified, candidate-matching staging receipt is accepted', async () => {
    writeReceipt(receipt());
    const result = await run();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.releaseId).toBe('release-under-test');
      expect(result.rootHash).toHaveLength(64);
      expect(result.receipt.candidateLockHash).toBe(CANDIDATE);
    }
  });

  test('the approval does NOT require staging and production roots to match', async () => {
    // Staging and production legitimately carry different unrelated base
    // inventory, so their catalog roots differ while the candidate is
    // byte-identical. Only candidate identity is compared — this function is
    // never given a production root to compare against.
    writeReceipt(receipt());
    const result = await run();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rootHash).toBe(STAGING_GRAPH.rootHash);
      expect(result.receipt.candidateLockHash).toBe(CANDIDATE);
    }
  });
});
