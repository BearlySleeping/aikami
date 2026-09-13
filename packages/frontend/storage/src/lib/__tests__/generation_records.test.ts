// packages/frontend/storage/src/lib/__tests__/generation_records.test.ts
//
// C-518 storage-level evidence:
//   AC-1  durable lineage + acceptance status survive a close/reopen
//   AC-3  acceptance cannot drift when bytes or the transformation chain change
//   AC-4  crash/dedup safety — no dangling accepted row, no shared blob deleted
//   AC-5  legacy rows are explicit `unknown`, and old assets still resolve
//   AC-6  a failed migration leaves the database at the previous version with
//         the pre-existing registry rows still resolvable

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { GenerationProvenance } from '@aikami/types';
import { registerGeneratedAssetRow } from '../assets_generated.ts';
import {
  deleteGenerationCandidate,
  findArtifactReferences,
  GenerationRevisionConflictError,
  isAcceptanceCurrent,
  listCandidatesForTag,
  readAcceptance,
  readCandidateRecord,
  readGenerationProvenance,
  recordAcceptance,
  setCandidateStatus,
  writeGenerationCandidate,
} from '../generation_records.ts';
import { AIKAMI_MIGRATIONS, applyMigrations } from '../migrations.ts';
import type { LocalDatabaseInterface } from '../storage_adapter.ts';
import { WasmStorageAdapter } from '../wasm_storage_adapter.ts';

const HASH_RAW = '1'.repeat(64);
const HASH_PREPARED = '2'.repeat(64);
const HASH_SHARED = '3'.repeat(64);
const HASH_REPORT = '4'.repeat(64);
const CHAIN_A = 'a'.repeat(64);
const CHAIN_B = 'b'.repeat(64);

const provenance = (overrides: Partial<GenerationProvenance> = {}): GenerationProvenance => ({
  schemaVersion: 1,
  candidateId: 'candidate-1',
  tag: 'portraits:hero',
  engine: 'sdcpp',
  models: [{ id: 'sd15-base', kind: 'base', artifactHash: HASH_RAW }],
  prompt: 'a private prompt',
  references: [{ role: 'image', sha256: HASH_SHARED, pointer: '/home/creator/refs/hero.png' }],
  rawHash: HASH_RAW,
  preparedHash: HASH_PREPARED,
  transformations: [
    { operation: 'generated:sdcpp', processor: 'sd.cpp@1.9', processorHash: CHAIN_A },
  ],
  media: { mimeType: 'image/png', sizeBytes: 2048, width: 512, height: 512 },
  rights: {
    inference: { permitted: true, state: 'allowed' },
    gameInclusion: { permitted: true, state: 'allowed' },
    standaloneDistribution: { permitted: false, state: 'denied', evidence: 'no redistribution' },
  },
  provenanceState: 'captured',
  createdAt: '2026-09-13T00:00:00.000Z',
  ...overrides,
});

const baseWrite = {
  candidateId: 'candidate-1',
  tag: 'portraits:hero',
  status: 'accepted' as const,
  preparedHash: HASH_PREPARED,
  provenanceState: 'captured' as const,
  artifacts: [
    { hash: HASH_RAW, role: 'raw' as const },
    { hash: HASH_PREPARED, role: 'prepared' as const },
    { hash: HASH_SHARED, role: 'reference' as const },
  ],
  createdAt: '2026-09-13T00:00:00.000Z',
  updatedAt: '2026-09-13T00:00:00.000Z',
};

/** Opens a `:memory:` database already at the latest migration version. */
const openMigrated = async (): Promise<WasmStorageAdapter> => {
  const db = new WasmStorageAdapter({ databasePath: ':memory:' });
  await db.open();
  await applyMigrations(db);
  return db;
};

/**
 * Wraps a real adapter and fails transaction #`failAt` once — the injected
 * crash that AC-4 and AC-6 need without a second SQLite build.
 */
const withInjectedTransactionFailure = (
  inner: LocalDatabaseInterface,
  failAt: number,
): LocalDatabaseInterface => {
  let calls = 0;
  return {
    query: (options) => inner.query(options),
    execute: (options) => inner.execute(options),
    sync: () => inner.sync(),
    exportBytes: () => inner.exportBytes(),
    importBytes: (bytes) => inner.importBytes(bytes),
    close: () => inner.close(),
    transaction: async (queries) => {
      calls += 1;
      if (calls === failAt) {
        throw new Error('injected transaction failure');
      }
      await inner.transaction(queries);
    },
    ...(inner.flush === undefined ? {} : { flush: () => inner.flush?.() ?? Promise.resolve() }),
  };
};

describe('C-518 AC-1: durable lineage survives a reload', () => {
  let db: WasmStorageAdapter;

  beforeEach(async () => {
    db = await openMigrated();
  });

  afterEach(async () => {
    await db.close();
  });

  test('a full private record round-trips byte-for-byte', async () => {
    await writeGenerationCandidate(db, {
      ...baseWrite,
      record: provenance(),
    });
    await recordAcceptance(db, {
      acceptanceId: 'acceptance-1',
      candidateId: 'candidate-1',
      preparedHash: HASH_PREPARED,
      validationReportHash: HASH_REPORT,
      transformationHash: CHAIN_A,
      acceptedAt: '2026-09-13T00:00:01.000Z',
    });

    const reloaded = await readGenerationProvenance(db, 'candidate-1');
    expect(reloaded).toEqual(provenance());
    expect(reloaded?.preparedHash).toBe(HASH_PREPARED);
    expect(reloaded?.rawHash).toBe(HASH_RAW);
    expect(reloaded?.media).toEqual({ mimeType: 'image/png', sizeBytes: 2048, width: 512, height: 512 });

    const candidate = await readCandidateRecord(db, 'candidate-1');
    expect(candidate?.status).toBe('accepted');
    expect(candidate?.provenanceState).toBe('captured');

    const acceptance = await readAcceptance(db, 'candidate-1');
    expect(acceptance?.preparedHash).toBe(HASH_PREPARED);
    expect(await isAcceptanceCurrent(db, {
      candidateId: 'candidate-1',
      preparedHash: HASH_PREPARED,
      transformationHash: CHAIN_A,
    })).toBe(true);
  });

  test('a reload through a fresh connection sees the same rows', async () => {
    await writeGenerationCandidate(db, { ...baseWrite, record: provenance() });
    await db.flush?.();
    const exported = await db.exportBytes();
    await db.close();

    const reopened = new WasmStorageAdapter({ databasePath: ':memory:' });
    await reopened.open();
    await reopened.importBytes(exported);
    const reloaded = await readGenerationProvenance(reopened, 'candidate-1');
    expect(reloaded?.candidateId).toBe('candidate-1');
    expect(reloaded?.prompt).toBe('a private prompt');
    await reopened.close();
    // afterEach closes `db` again; a second close on an already-closed adapter
    // is a no-op for both adapters.
    db = reopened;
  });
});

describe('C-518 AC-3: acceptance cannot drift', () => {
  let db: WasmStorageAdapter;

  beforeEach(async () => {
    db = await openMigrated();
    await writeGenerationCandidate(db, { ...baseWrite, record: provenance() });
    await recordAcceptance(db, {
      acceptanceId: 'acceptance-1',
      candidateId: 'candidate-1',
      preparedHash: HASH_PREPARED,
      validationReportHash: HASH_REPORT,
      transformationHash: CHAIN_A,
      acceptedAt: '2026-09-13T00:00:01.000Z',
    });
  });

  afterEach(async () => {
    await db.close();
  });

  test('replacing the prepared bytes invalidates the acceptance', async () => {
    const newBytes = '9'.repeat(64);
    await writeGenerationCandidate(db, {
      ...baseWrite,
      preparedHash: newBytes,
      record: provenance({ preparedHash: newBytes }),
      updatedAt: '2026-09-14T00:00:00.000Z',
    });
    expect(
      await isAcceptanceCurrent(db, {
        candidateId: 'candidate-1',
        preparedHash: newBytes,
        transformationHash: CHAIN_A,
      }),
    ).toBe(false);
    // The old acceptance is untouched — the previously accepted content stays
    // resolvable under its own hash.
    expect((await readAcceptance(db, 'candidate-1'))?.preparedHash).toBe(HASH_PREPARED);
  });

  test('changing the transformation chain invalidates the acceptance', async () => {
    expect(
      await isAcceptanceCurrent(db, {
        candidateId: 'candidate-1',
        preparedHash: HASH_PREPARED,
        transformationHash: CHAIN_B,
      }),
    ).toBe(false);
  });

  test('a re-prepared candidate is a new candidate, not a silent re-point', async () => {
    await writeGenerationCandidate(db, {
      ...baseWrite,
      candidateId: 'candidate-2',
      preparedHash: '9'.repeat(64),
      status: 'pending_review',
      record: provenance({ candidateId: 'candidate-2', preparedHash: '9'.repeat(64) }),
      updatedAt: '2026-09-14T00:00:00.000Z',
    });
    const candidates = await listCandidatesForTag(db, 'portraits:hero');
    expect(candidates.map((c) => c.candidateId).sort()).toEqual(['candidate-1', 'candidate-2']);
    expect(candidates.find((c) => c.candidateId === 'candidate-1')?.status).toBe('accepted');
  });

  test('accepting a second candidate needs an explicit revision decision', async () => {
    await writeGenerationCandidate(db, {
      ...baseWrite,
      candidateId: 'candidate-2',
      preparedHash: '9'.repeat(64),
      status: 'pending_review',
      record: provenance({ candidateId: 'candidate-2', preparedHash: '9'.repeat(64) }),
      updatedAt: '2026-09-14T00:00:00.000Z',
    });

    await expect(
      recordAcceptance(db, {
        acceptanceId: 'acceptance-2',
        candidateId: 'candidate-2',
        preparedHash: '9'.repeat(64),
        validationReportHash: HASH_REPORT,
        transformationHash: CHAIN_A,
        acceptedAt: '2026-09-14T00:00:01.000Z',
      }),
    ).rejects.toBeInstanceOf(GenerationRevisionConflictError);

    // With the explicit revision decision the supersede is recorded and exactly
    // one acceptance stands.
    await recordAcceptance(db, {
      acceptanceId: 'acceptance-2',
      candidateId: 'candidate-2',
      preparedHash: '9'.repeat(64),
      validationReportHash: HASH_REPORT,
      transformationHash: CHAIN_A,
      acceptedAt: '2026-09-14T00:00:01.000Z',
      revisionOf: 'candidate-1',
    });
    expect((await readCandidateRecord(db, 'candidate-1'))?.status).toBe('superseded');
    expect(await readAcceptance(db, 'candidate-1')).toBeUndefined();
    expect((await readAcceptance(db, 'candidate-2'))?.preparedHash).toBe('9'.repeat(64));
  });
});

describe('C-518 AC-4: crash and dedup safety', () => {
  let db: WasmStorageAdapter;

  beforeEach(async () => {
    db = await openMigrated();
  });

  afterEach(async () => {
    await db.close();
  });

  test('an injected failure leaves no candidate and no acceptance row', async () => {
    const flaky = withInjectedTransactionFailure(db, 1);

    await expect(
      writeGenerationCandidate(flaky, { ...baseWrite, record: provenance() }),
    ).rejects.toThrow('injected transaction failure');

    expect(await readCandidateRecord(db, 'candidate-1')).toBeUndefined();
    expect(await readAcceptance(db, 'candidate-1')).toBeUndefined();
  });

  test('a retry after the failure is idempotent', async () => {
    const flaky = withInjectedTransactionFailure(db, 1);
    await expect(
      writeGenerationCandidate(flaky, { ...baseWrite, record: provenance() }),
    ).rejects.toThrow();

    const first = await writeGenerationCandidate(db, { ...baseWrite, record: provenance() });
    const second = await writeGenerationCandidate(db, { ...baseWrite, record: provenance() });
    expect(first).toEqual({ created: true, changedBytes: false });
    expect(second).toEqual({ created: false, changedBytes: false });
    const candidates = await listCandidatesForTag(db, 'portraits:hero');
    expect(candidates).toHaveLength(1);
  });

  test('deleting one of two candidates sharing bytes deletes nothing shared', async () => {
    // Two tags reference the same cached bytes.
    await writeGenerationCandidate(db, {
      ...baseWrite,
      candidateId: 'candidate-a',
      tag: 'portraits:hero',
      record: provenance({ candidateId: 'candidate-a' }),
      artifacts: [
        { hash: HASH_SHARED, role: 'prepared' },
        { hash: HASH_RAW, role: 'raw' },
      ],
    });
    await writeGenerationCandidate(db, {
      ...baseWrite,
      candidateId: 'candidate-b',
      tag: 'portraits:villain',
      record: provenance({ candidateId: 'candidate-b', tag: 'portraits:villain' }),
      artifacts: [{ hash: HASH_SHARED, role: 'prepared' }],
    });

    const references = await findArtifactReferences(db, [HASH_SHARED]);
    expect([...(references[0]?.tags ?? [])].sort()).toEqual([
      'portraits:hero',
      'portraits:villain',
    ]);

    const removed = await deleteGenerationCandidate(db, 'candidate-a');
    expect(removed.deleted).toBe(true);
    // HASH_RAW was owned only by candidate-a; HASH_SHARED is still referenced.
    expect(removed.orphanedHashes).toEqual([HASH_RAW]);
    expect(removed.orphanedHashes).not.toContain(HASH_SHARED);

    const remaining = await findArtifactReferences(db, [HASH_SHARED]);
    expect(remaining[0]?.tags).toEqual(['portraits:villain']);
  });

  test('deleting a candidate removes its acceptance, leaving no dangling accepted row', async () => {
    await writeGenerationCandidate(db, { ...baseWrite, record: provenance() });
    await recordAcceptance(db, {
      acceptanceId: 'acceptance-1',
      candidateId: 'candidate-1',
      preparedHash: HASH_PREPARED,
      validationReportHash: HASH_REPORT,
      transformationHash: CHAIN_A,
      acceptedAt: '2026-09-13T00:00:01.000Z',
    });
    await deleteGenerationCandidate(db, 'candidate-1');
    expect(await readAcceptance(db, 'candidate-1')).toBeUndefined();
    const orphans = await db.query({
      sql: `SELECT a.acceptance_id FROM generation_acceptances a
            LEFT JOIN generation_candidates c ON c.candidate_id = a.candidate_id
            WHERE c.candidate_id IS NULL`,
      args: [],
    });
    expect(orphans.rows).toEqual([]);
  });

  test('deleting is idempotent', async () => {
    await writeGenerationCandidate(db, { ...baseWrite, record: provenance() });
    expect((await deleteGenerationCandidate(db, 'candidate-1')).deleted).toBe(true);
    expect(await deleteGenerationCandidate(db, 'candidate-1')).toEqual({
      deleted: false,
      reason: 'not_found',
      orphanedHashes: [],
    });
  });

  test('rejecting a candidate removes its acceptance', async () => {
    await writeGenerationCandidate(db, { ...baseWrite, record: provenance() });
    await recordAcceptance(db, {
      acceptanceId: 'acceptance-1',
      candidateId: 'candidate-1',
      preparedHash: HASH_PREPARED,
      validationReportHash: HASH_REPORT,
      transformationHash: CHAIN_A,
      acceptedAt: '2026-09-13T00:00:01.000Z',
    });
    await setCandidateStatus(db, {
      candidateId: 'candidate-1',
      status: 'rejected',
      updatedAt: '2026-09-14T00:00:00.000Z',
    });
    expect(await readAcceptance(db, 'candidate-1')).toBeUndefined();
    expect((await readCandidateRecord(db, 'candidate-1'))?.status).toBe('rejected');
  });
});

describe('C-518 AC-5: legacy compatibility', () => {
  let db: WasmStorageAdapter;

  beforeEach(async () => {
    db = await openMigrated();
  });

  afterEach(async () => {
    await db.close();
  });

  test('a pre-contract generated row still resolves and reports unknown lineage', async () => {
    await registerGeneratedAssetRow(db, {
      tag: 'portraits:legacy',
      hash: HASH_PREPARED,
      sizeBytes: 1024,
      category: 'portraits',
      provenanceSource: 'generated:sdcpp',
    });

    const asset = await db.query({
      sql: 'SELECT a.id, a.hash, s.backend FROM assets a JOIN asset_sources s ON s.asset_id = a.id WHERE a.id = ?',
      args: ['portraits:legacy'],
    });
    expect(asset.rows[0]?.hash).toBe(HASH_PREPARED);
    expect(asset.rows[0]?.backend).toBe('local-generated');

    // No provenance record → explicit unknown, never an invented backfill.
    expect(await readGenerationProvenance(db, 'portraits:legacy')).toBeUndefined();
    expect(await listCandidatesForTag(db, 'portraits:legacy')).toEqual([]);
    expect(await readAcceptance(db, 'portraits:legacy')).toBeUndefined();
    expect(
      await isAcceptanceCurrent(db, {
        candidateId: 'portraits:legacy',
        preparedHash: HASH_PREPARED,
        transformationHash: CHAIN_A,
      }),
    ).toBe(false);
  });
});

describe('C-518 AC-6: a failed migration leaves old assets usable', () => {
  test('the production migration list is contiguous and v7 is the last entry', () => {
    expect(AIKAMI_MIGRATIONS).toHaveLength(7);
    expect(AIKAMI_MIGRATIONS[6]?.version).toBe(7);
    expect(AIKAMI_MIGRATIONS[6]?.name).toBe('generation-provenance-and-candidates');
  });

  test('an injected failure mid-apply does not advance user_version or drop author data', async () => {
    const db = new WasmStorageAdapter({ databasePath: ':memory:' });
    await db.open();

    // An installed database at the previous version, with pre-contract rows.
    await applyMigrations(db, AIKAMI_MIGRATIONS.slice(0, 6));
    await registerGeneratedAssetRow(db, {
      tag: 'portraits:legacy',
      hash: HASH_PREPARED,
      sizeBytes: 1024,
      category: 'portraits',
      provenanceSource: 'generated:sdcpp',
    });
    const before = await db.query({
      sql: 'SELECT * FROM pragma_user_version',
      args: [],
    });
    expect((before.rows[0]?.user_version ?? before.rows[0]?.pragma_user_version) as number).toBe(6);

    // The real v7 migration with a statement that cannot succeed, injected
    // after the first table so the failure lands mid-apply.
    const v7 = AIKAMI_MIGRATIONS[6];
    const broken = {
      version: 7,
      name: 'generation-provenance-and-candidates',
      statements: [
        v7?.statements[0] ?? '',
        `CREATE TABLE generation_candidates (this is not valid sql)`,
      ],
    };

    await expect(applyMigrations(db, [...AIKAMI_MIGRATIONS.slice(0, 6), broken])).rejects.toThrow();

    const after = await db.query({ sql: 'SELECT * FROM pragma_user_version', args: [] });
    expect((after.rows[0]?.user_version ?? after.rows[0]?.pragma_user_version) as number).toBe(6);

    // Reopening must reject or retry without a half-applied schema: the failed
    // migration's first table must not exist.
    const halfApplied = await db.query({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'generation_candidates'",
      args: [],
    });
    expect(halfApplied.rows).toEqual([]);

    // …and the previously resolvable asset still resolves.
    const asset = await db.query({
      sql: 'SELECT a.id, a.hash FROM assets a WHERE a.id = ?',
      args: ['portraits:legacy'],
    });
    expect(asset.rows[0]?.hash).toBe(HASH_PREPARED);

    // A clean retry with the real migration list succeeds.
    await applyMigrations(db);
    const finalVersion = await db.query({ sql: 'SELECT * FROM pragma_user_version', args: [] });
    expect((finalVersion.rows[0]?.user_version ?? finalVersion.rows[0]?.pragma_user_version) as number).toBe(
      7,
    );
    const stillThere = await db.query({
      sql: 'SELECT hash FROM assets WHERE id = ?',
      args: ['portraits:legacy'],
    });
    expect(stillThere.rows[0]?.hash).toBe(HASH_PREPARED);

    await db.close();
  });

  test('a reader at the previous version is unaffected by the added tables', async () => {
    const db = new WasmStorageAdapter({ databasePath: ':memory:' });
    await db.open();
    await applyMigrations(db, AIKAMI_MIGRATIONS.slice(0, 6));
    const v6Tables = await db.query({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      args: [],
    });
    const v6Names = v6Tables.rows.map((row) => row.name as string);
    await applyMigrations(db);

    const v7Tables = await db.query({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      args: [],
    });
    const v7Names = v7Tables.rows.map((row) => row.name as string);
    // Additive only: every v6 table still exists, untouched.
    for (const name of v6Names) {
      expect(v7Names).toContain(name);
    }
    expect(v7Names).toContain('generation_candidates');
    await db.close();
  });
});
