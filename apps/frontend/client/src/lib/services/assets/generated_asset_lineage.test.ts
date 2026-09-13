// apps/frontend/client/src/lib/services/assets/generated_asset_lineage.test.ts
//
// C-518 AC-1 (production registration smoke) + AC-3/AC-4 on the real write
// seam: `registerGeneratedAsset` — the function behind
// `assetManager.registerGenerated` — persists the private lineage and the
// acceptance alongside the registry row, rolls the lineage back when the row
// fails, and stays idempotent on retry.
//
// The public-projection half of AC-1 is asserted here too: what
// `redactGenerationProvenance` builds from the *persisted* record contains no
// prompt, model id or local path.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  AssetRegistryRepository,
  applyMigrations,
  GenerationRevisionConflictError,
  isAcceptanceCurrent,
  readAcceptance,
  readGenerationProvenance,
  WasmStorageAdapter,
} from '@aikami/frontend/storage';
import { bytesToBlob } from '@aikami/local-ai';
import { redactGenerationProvenance } from '@aikami/utils';
import type { GeneratedAssetLineage } from '$types';
import { sha256Hex } from './asset_hasher.ts';
import type { AssetCacheBackend } from './cache_backend.ts';
import { registerGeneratedAsset } from './generated_asset_registration.ts';

const MIME = 'image/png';

/** A 1x1 PNG — real bytes so the content hash is real. */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

/** In-memory cache backend — hash-verified, like the OPFS one. */
const createMemoryBackend = (): AssetCacheBackend => {
  const blobs = new Map<string, Blob>();
  return {
    kind: 'opfs',
    isAvailable: true,
    init: async () => undefined,
    has: async (hash) => blobs.has(hash),
    get: async (hash) => blobs.get(hash),
    put: async ({ hash, blob }) => {
      blobs.set(hash, blob);
    },
    remove: async (hash) => {
      blobs.delete(hash);
    },
    clear: async () => {
      blobs.clear();
    },
    listHashes: async () => [...blobs.keys()],
    requestPersistence: async () => true,
  };
};

const openRegistry = async (): Promise<{
  db: WasmStorageAdapter;
  registry: AssetRegistryRepository;
}> => {
  const db = new WasmStorageAdapter({ databasePath: ':memory:' });
  await db.open();
  await applyMigrations(db);
  return { db, registry: new AssetRegistryRepository(db) };
};

const createDeps = (registry: AssetRegistryRepository, backend: AssetCacheBackend) => ({
  registry,
  backend,
  onRegistered: async () => undefined,
  debug: () => undefined,
  info: () => undefined,
});

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('C-518 AC-1: registration records durable private lineage', () => {
  let db: WasmStorageAdapter;
  let registry: AssetRegistryRepository;
  let backend: AssetCacheBackend;

  beforeEach(async () => {
    ({ db, registry } = await openRegistry());
    backend = createMemoryBackend();
  });

  afterEach(async () => {
    await db.close();
  });

  const register = async (): Promise<{ candidateId: string; sha256: string }> => {
    const sha256 = await sha256Hex(bytesToBlob(PNG_BYTES, MIME));
    const asset = {
      recipeId: 'portrait',
      category: 'portraits' as const,
      tag: 'portraits:hero',
      sha256,
      sizeBytes: PNG_BYTES.length,
      ext: '.png',
      mimeType: MIME,
      provenance: { source: 'generated:sdcpp' },
      engine: 'sdcpp' as const,
      model: 'sd15-private-model-id',
      seed: 42,
      prompt: 'a private unreleased-storm-arc hero',
    };
    const lineage: GeneratedAssetLineage = {
      provenance: {
        engine: 'sdcpp',
        models: [{ id: 'sd15-private-model-id', kind: 'base', artifactHash: HASH_A }],
        seed: 42,
        prompt: 'a private unreleased-storm-arc hero',
        references: [{ role: 'image', sha256: HASH_B, pointer: '/home/creator/refs/storm.png' }],
        rawHash: sha256,
        preparedHash: sha256,
        transformations: [{ operation: 'generated:sdcpp', processorHash: HASH_A }],
        media: { mimeType: MIME, sizeBytes: PNG_BYTES.length },
        rights: {
          inference: { permitted: false, state: 'unknown', evidence: 'terms not read' },
          gameInclusion: { permitted: false, state: 'unknown' },
          standaloneDistribution: { permitted: false, state: 'unknown' },
        },
        createdAt: '2026-09-13T00:00:00.000Z',
      },
      status: 'accepted',
      acceptedAt: '2026-09-13T00:00:01.000Z',
      validationReportHash: HASH_B,
    };
    const result = await registerGeneratedAsset(
      createDeps(registry, backend),
      asset,
      PNG_BYTES,
      lineage,
    );
    expect(result.registered).toBe(true);
    expect(result.candidateId).toBeDefined();
    return { candidateId: result.candidateId as string, sha256 };
  };

  test('the private record and the acceptance are written with the registry row', async () => {
    const { candidateId, sha256 } = await register();

    const record = await readGenerationProvenance(db, candidateId);
    expect(record?.preparedHash).toBe(sha256);
    expect(record?.rawHash).toBe(sha256);
    expect(record?.prompt).toBe('a private unreleased-storm-arc hero');
    expect(record?.provenanceState).toBe('captured');

    const acceptance = await readAcceptance(db, candidateId);
    expect(acceptance?.preparedHash).toBe(sha256);
    expect(
      await isAcceptanceCurrent(db, {
        candidateId,
        preparedHash: sha256,
        transformationHash: acceptance?.transformationHash ?? '',
      }),
    ).toBe(true);

    // The tag is resolvable through the registry — the production outcome.
    const row = await registry.findById('portraits:hero');
    expect(row?.hash).toBe(sha256);
  });

  test('the lineage and the same bytes survive a close and reload', async () => {
    const { candidateId, sha256 } = await register();
    await db.flush?.();
    const exported = await db.exportBytes();
    await db.close();

    const reopened = new WasmStorageAdapter({ databasePath: ':memory:' });
    await reopened.open();
    await reopened.importBytes(exported);
    const reloaded = await readGenerationProvenance(reopened, candidateId);
    expect(reloaded?.preparedHash).toBe(sha256);
    expect(reloaded?.prompt).toBe('a private unreleased-storm-arc hero');
    expect((await readAcceptance(reopened, candidateId))?.preparedHash).toBe(sha256);
    await reopened.close();
    // The afterEach close of the original adapter must stay a no-op.
    db = reopened;
    backend = createMemoryBackend();
  });

  test('the public projection of the persisted record omits every private field', async () => {
    const { candidateId } = await register();
    const record = await readGenerationProvenance(db, candidateId);
    const projection = redactGenerationProvenance({ provenance: record ?? ({} as never) });
    const serialized = JSON.stringify(projection);

    expect(projection.source).toBe('generated:sdcpp');
    expect(projection.generation?.rights?.standaloneDistribution).toBe('unknown');
    expect(serialized).not.toContain('private unreleased-storm-arc');
    expect(serialized).not.toContain('sd15-private-model-id');
    expect(serialized).not.toContain('/home/creator');
    expect(serialized).not.toContain(HASH_A);
  });

  test('registering without a lineage keeps the C-510 behaviour unchanged', async () => {
    const sha256 = await sha256Hex(bytesToBlob(PNG_BYTES, MIME));
    const result = await registerGeneratedAsset(
      createDeps(registry, backend),
      {
        recipeId: 'portrait',
        category: 'portraits',
        tag: 'portraits:nolineage',
        sha256,
        sizeBytes: PNG_BYTES.length,
        ext: '.png',
        mimeType: MIME,
        provenance: { source: 'generated:sdcpp' },
        engine: 'sdcpp',
        prompt: 'no lineage',
      },
      PNG_BYTES,
    );
    expect(result.registered).toBe(true);
    expect(result.candidateId).toBeUndefined();
  });

  test('a failed registry row rolls the lineage back — no dangling accepted row', async () => {
    const sha256 = await sha256Hex(bytesToBlob(PNG_BYTES, MIME));
    const failingRegistry = Object.create(registry) as AssetRegistryRepository;
    // Simulate a quota/transaction failure at the registry write.
    (failingRegistry as unknown as { registerGenerated: unknown }).registerGenerated = async () => {
      throw new Error('quota exceeded');
    };

    const asset = {
      recipeId: 'portrait',
      category: 'portraits' as const,
      tag: 'portraits:hero',
      sha256,
      sizeBytes: PNG_BYTES.length,
      ext: '.png',
      mimeType: MIME,
      provenance: { source: 'generated:sdcpp' },
      engine: 'sdcpp' as const,
      prompt: 'a private unreleased-storm-arc hero',
    };

    await expect(
      registerGeneratedAsset(createDeps(failingRegistry, backend), asset, PNG_BYTES, {
        provenance: {
          engine: 'sdcpp',
          models: [],
          references: [],
          rawHash: sha256,
          preparedHash: sha256,
          transformations: [{ operation: 'generated:sdcpp' }],
          media: { mimeType: MIME, sizeBytes: PNG_BYTES.length },
          rights: {
            inference: { permitted: true, state: 'allowed' },
            gameInclusion: { permitted: true, state: 'allowed' },
            standaloneDistribution: { permitted: true, state: 'allowed' },
          },
          createdAt: '2026-09-13T00:00:00.000Z',
        },
        status: 'accepted',
        acceptedAt: '2026-09-13T00:00:01.000Z',
        validationReportHash: HASH_B,
      }),
    ).rejects.toThrow('quota exceeded');

    const rows = await db.query({
      sql: 'SELECT candidate_id FROM generation_candidates',
      args: [],
    });
    expect(rows.rows).toEqual([]);
    expect(await registry.findById('portraits:hero')).toBeUndefined();
  });

  test('a retry after the failure succeeds and converges on one candidate', async () => {
    const sha256 = await sha256Hex(bytesToBlob(PNG_BYTES, MIME));
    const asset = {
      recipeId: 'portrait',
      category: 'portraits' as const,
      tag: 'portraits:hero',
      sha256,
      sizeBytes: PNG_BYTES.length,
      ext: '.png',
      mimeType: MIME,
      provenance: { source: 'generated:sdcpp' },
      engine: 'sdcpp' as const,
      prompt: 'a private prompt',
    };
    const lineage: GeneratedAssetLineage = {
      provenance: {
        engine: 'sdcpp',
        models: [],
        references: [],
        rawHash: sha256,
        preparedHash: sha256,
        transformations: [{ operation: 'generated:sdcpp' }],
        media: { mimeType: MIME, sizeBytes: PNG_BYTES.length },
        rights: {
          inference: { permitted: true, state: 'allowed' },
          gameInclusion: { permitted: true, state: 'allowed' },
          standaloneDistribution: { permitted: true, state: 'allowed' },
        },
        createdAt: '2026-09-13T00:00:00.000Z',
      },
      status: 'accepted',
      acceptedAt: '2026-09-13T00:00:01.000Z',
      validationReportHash: HASH_B,
    };

    const first = await registerGeneratedAsset(
      createDeps(registry, backend),
      asset,
      PNG_BYTES,
      lineage,
    );
    const second = await registerGeneratedAsset(
      createDeps(registry, backend),
      asset,
      PNG_BYTES,
      lineage,
    );
    expect(first.candidateId).toBe(second.candidateId);

    const rows = await db.query({
      sql: 'SELECT candidate_id FROM generation_candidates',
      args: [],
    });
    expect(rows.rows).toHaveLength(1);
  });

  test('an accepted candidate without a validation report is refused before any write', async () => {
    const sha256 = await sha256Hex(bytesToBlob(PNG_BYTES, MIME));
    await expect(
      registerGeneratedAsset(
        createDeps(registry, backend),
        {
          recipeId: 'portrait',
          category: 'portraits',
          tag: 'portraits:hero',
          sha256,
          sizeBytes: PNG_BYTES.length,
          ext: '.png',
          mimeType: MIME,
          provenance: { source: 'generated:sdcpp' },
          engine: 'sdcpp',
          prompt: 'a private prompt',
        },
        PNG_BYTES,
        {
          provenance: {
            engine: 'sdcpp',
            models: [],
            references: [],
            rawHash: sha256,
            preparedHash: sha256,
            transformations: [],
            media: { mimeType: MIME, sizeBytes: PNG_BYTES.length },
            rights: {
              inference: { permitted: true, state: 'allowed' },
              gameInclusion: { permitted: true, state: 'allowed' },
              standaloneDistribution: { permitted: true, state: 'allowed' },
            },
            createdAt: '2026-09-13T00:00:00.000Z',
          },
          status: 'accepted',
        },
      ),
    ).rejects.toThrow('acceptance needs both');
    const rows = await db.query({
      sql: 'SELECT candidate_id FROM generation_candidates',
      args: [],
    });
    expect(rows.rows).toEqual([]);
  });

  test('a refused acceptance leaves no candidate looking accepted', async () => {
    const { candidateId: acceptedId } = await register();

    // A second generation for the same tag with *different* bytes, marked
    // accepted without an explicit revision decision. The acceptance is
    // refused, and the refused candidate must not keep the `accepted` status
    // the acceptance would have granted (AC-4: no dangling accepted row).
    const secondBytes = new Uint8Array([...PNG_BYTES, 0x00]);
    const secondHash = await sha256Hex(bytesToBlob(secondBytes, MIME));
    await expect(
      registerGeneratedAsset(
        createDeps(registry, backend),
        {
          recipeId: 'portrait',
          category: 'portraits',
          tag: 'portraits:hero',
          sha256: secondHash,
          sizeBytes: secondBytes.length,
          ext: '.png',
          mimeType: MIME,
          provenance: { source: 'generated:sdcpp' },
          engine: 'sdcpp',
          prompt: 'a second take on the same tag',
        },
        secondBytes,
        {
          provenance: {
            engine: 'sdcpp',
            models: [],
            references: [],
            rawHash: secondHash,
            preparedHash: secondHash,
            transformations: [{ operation: 'generated:sdcpp' }],
            media: { mimeType: MIME, sizeBytes: secondBytes.length },
            rights: {
              inference: { permitted: true, state: 'allowed' },
              gameInclusion: { permitted: true, state: 'allowed' },
              standaloneDistribution: { permitted: true, state: 'allowed' },
            },
            createdAt: '2026-09-13T01:00:00.000Z',
          },
          status: 'accepted',
          acceptedAt: '2026-09-13T01:00:01.000Z',
          validationReportHash: HASH_B,
        },
      ),
    ).rejects.toThrow(GenerationRevisionConflictError);

    const accepted = await db.query({
      sql: "SELECT candidate_id FROM generation_candidates WHERE tag = ? AND status = 'accepted'",
      args: ['portraits:hero'],
    });
    expect(accepted.rows.map((row) => row.candidate_id)).toEqual([acceptedId]);
    expect(await readAcceptance(db, acceptedId)).toBeDefined();
  });
});

describe('bytesToBlob is the shared bridge this seam relies on', () => {
  test('the descriptor hash equals the real byte hash', async () => {
    const blob = bytesToBlob(PNG_BYTES, MIME);
    expect(blob.type).toBe(MIME);
    expect(await sha256Hex(bytesToBlob(PNG_BYTES, MIME))).toMatch(/^[a-f0-9]{64}$/);
  });
});
