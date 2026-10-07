// apps/frontend/client/src/lib/services/worldgen/world_gen_draft_late_persistence.test.ts
// G01 — late device writes and hydration must not retire a newer draft run.

import { describe, expect, test } from 'bun:test';
import {
  createRealDatabase,
  createRealStore,
} from '../../views/worldgen/testing/world_gen_db_fixtures.ts';
import {
  coherentPayloads,
  createControllableProvider,
  WORLD_GEN_TEST_INPUT,
} from '../../views/worldgen/testing/world_gen_fixtures.ts';
import { createWorldGenDraftService } from './world_gen_draft_service.svelte.ts';

const createGate = (): { promise: Promise<void>; open: () => void } => {
  let open = (): void => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

describe('private drafts — late persistence boundaries', () => {
  test('a cancelled write cannot clear the active replacement run', async () => {
    const db = createRealDatabase();
    const store = createRealStore(db);
    const provider = createControllableProvider({ payloads: coherentPayloads() });
    const firstWrite = createGate();
    const firstWriteEntered = createGate();
    const secondStage = createGate();
    const secondStageEntered = createGate();
    let writes = 0;
    let replacing = false;
    const service = createWorldGenDraftService({
      className: 'LatePersistenceDraftTest',
      text: {
        extractStructure: async (call) => {
          if (replacing && call.schemaName === 'WorldGenDraft_arcs') {
            secondStageEntered.open();
            await secondStage.promise;
          }
          return provider.capability.extractStructure(call);
        },
      },
      resolveStore: async () => ({
        get: (id) => store.get(id),
        latest: (limit) => store.latest(limit),
        upsert: async (draft) => {
          writes += 1;
          if (writes === 1) {
            firstWriteEntered.open();
            await firstWrite.promise;
          }
          await store.upsert(draft);
        },
      }),
    });
    try {
      const first = service.generate({ input: WORLD_GEN_TEST_INPUT });
      await firstWriteEntered.promise;
      expect(service.run?.status).toBe('running');
      expect(await service.generate({ input: WORLD_GEN_TEST_INPUT })).toBeUndefined();
      service.cancel('replace while the device write is pending');
      replacing = true;
      const second = service.generate({
        input: { ...WORLD_GEN_TEST_INPUT, goals: 'Find a different route through the valley.' },
      });
      await secondStageEntered.promise;
      const liveRunId = service.run?.runId;
      firstWrite.open();
      expect(await first).toBeUndefined();
      expect(service.run?.runId).toBe(liveRunId);
      expect(service.run?.status).toBe('running');
      secondStage.open();
      const completed = await second;
      expect(completed?.status).toBe('complete');
      expect(completed?.runId).toBe(liveRunId);
      expect((await store.get(completed?.draftId ?? 'missing'))?.revision).toBe(
        completed?.revision,
      );
    } finally {
      firstWrite.open();
      secondStage.open();
      await service.dispose();
      await db.close();
    }
  });

  test('a late initial read cannot replace a newly generated draft', async () => {
    const db = createRealDatabase();
    const store = createRealStore(db);
    const provider = createControllableProvider({ payloads: coherentPayloads() });
    const original = createWorldGenDraftService({
      className: 'OriginalPrivateDraftTest',
      text: provider.capability,
      resolveStore: async () => store,
    });
    await original.generate({ input: WORLD_GEN_TEST_INPUT });
    const reading = createGate();
    const readEntered = createGate();
    const service = createWorldGenDraftService({
      className: 'LateHydrationDraftTest',
      text: provider.capability,
      resolveStore: async () => ({
        get: (id) => store.get(id),
        upsert: (draft) => store.upsert(draft),
        latest: async (limit) => {
          const drafts = await store.latest(limit);
          readEntered.open();
          await reading.promise;
          return drafts;
        },
      }),
    });
    try {
      const hydration = service.initialize();
      await readEntered.promise;
      const generated = await service.generate({ input: WORLD_GEN_TEST_INPUT });
      expect(generated).toBeDefined();
      reading.open();
      expect(await hydration).toBeUndefined();
      expect(service.draft?.draftId).toBe(generated?.draftId);
      expect(service.draft?.runId).toBe(generated?.runId);
    } finally {
      reading.open();
      await original.dispose();
      await service.dispose();
      await db.close();
    }
  });

  test('oversized wizard inputs are rejected before any provider admission', async () => {
    const db = createRealDatabase();
    const store = createRealStore(db);
    const provider = createControllableProvider({ payloads: coherentPayloads() });
    const service = createWorldGenDraftService({
      className: 'BoundedDraftInputTest',
      text: provider.capability,
      resolveStore: async () => store,
    });
    try {
      expect(
        await service.generate({ input: { ...WORLD_GEN_TEST_INPUT, setting: 'x'.repeat(3000) } }),
      ).toBeUndefined();
      expect(service.run?.status).toBe('failed');
      expect(service.run?.error).toContain('inputs');
      expect(provider.calls).toHaveLength(0);
      expect(await store.count()).toBe(0);
    } finally {
      await service.dispose();
      await db.close();
    }
  });

  test('a malformed stage is retried rather than checkpointed as successful', async () => {
    const db = createRealDatabase();
    const store = createRealStore(db);
    const provider = createControllableProvider({ payloads: coherentPayloads() });
    let castAttempts = 0;
    const service = createWorldGenDraftService({
      className: 'RetriableInvalidStageTest',
      text: {
        extractStructure: async (call) => {
          if (call.schemaName === 'WorldGenDraft_cast') {
            castAttempts += 1;
            if (castAttempts === 1) {
              return { npcs: [{ name: 'Maren' }] };
            }
          }
          return provider.capability.extractStructure(call);
        },
      },
      resolveStore: async () => store,
    });
    try {
      expect((await service.generate({ input: WORLD_GEN_TEST_INPUT }))?.status).toBe('complete');
      expect(castAttempts).toBe(2);
      expect(provider.countStage('setting')).toBe(1);
      expect(provider.countStage('places')).toBe(1);
      expect(await store.count()).toBe(1);
    } finally {
      await service.dispose();
      await db.close();
    }
  });

  test('malformed stage text cannot be called a complete memory-only draft', async () => {
    const db = createRealDatabase();
    const store = createRealStore(db);
    const payloads = coherentPayloads();
    const cast = payloads.cast as { npcs: { description: string }[] };
    const npc = cast.npcs[0];
    if (npc === undefined) {
      throw new Error('The coherent fixture must contain a cast member.');
    }
    npc.description = '';
    const provider = createControllableProvider({ payloads });
    const service = createWorldGenDraftService({
      className: 'InvalidPrivateDraftTest',
      text: provider.capability,
      resolveStore: async () => store,
    });
    try {
      expect(await service.generate({ input: WORLD_GEN_TEST_INPUT })).toBeUndefined();
      expect(service.run?.status).toBe('failed');
      expect(service.draft).toBeUndefined();
      expect(await store.count()).toBe(0);
    } finally {
      await service.dispose();
      await db.close();
    }
  });
});
