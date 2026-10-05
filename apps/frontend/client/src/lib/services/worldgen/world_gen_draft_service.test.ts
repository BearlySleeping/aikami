// apps/frontend/client/src/lib/services/worldgen/world_gen_draft_service.test.ts
//
// G01 — draft orchestration tests.
//
// Every test here drives the real service with a controllable provider and a
// real store, then asserts on what the orchestration DID — how many provider
// calls each stage received, what was persisted, what was published — rather
// than on a mock's own return value. Where a defect would have been invisible
// before (a second pipeline, a whole-pipeline retry, a late write), the
// assertion is on the call log.

import { describe, expect, test } from 'bun:test';
import {
  createRealDatabase,
  createRealStore,
} from '../../views/worldgen/testing/world_gen_db_fixtures.ts';
import {
  coherentPayloads,
  createControllableProvider,
  createDeferredProvider,
  createMemoryStore,
  type MemoryStore,
  WORLD_GEN_TEST_INPUT,
} from '../../views/worldgen/testing/world_gen_fixtures.ts';
import type { WorldGenDraftServiceInterface } from './world_gen_draft_service.svelte.ts';
import { createWorldGenDraftService } from './world_gen_draft_service.svelte.ts';

type Harness = {
  service: WorldGenDraftServiceInterface;
  provider: ReturnType<typeof createControllableProvider>;
  store: MemoryStore;
};

const build = (
  providerOptions: Parameters<typeof createControllableProvider>[0] = {},
  storeOptions: { real?: boolean } = {},
): Harness => {
  const provider = createControllableProvider({ payloads: coherentPayloads(), ...providerOptions });
  const memory = createMemoryStore();
  const real = storeOptions.real === true ? createRealStore(createRealDatabase()) : memory;
  const service = createWorldGenDraftService({
    className: 'WorldGenDraftServiceTest',
    text: provider.capability,
    resolveStore: async () => real,
    maxAttemptsPerStage: 3,
  });
  return { service, provider, store: memory };
};

describe('WorldGenDraftService — run identity (G01)', () => {
  test('every stage call carries a signal, a background task, a deadline and a request id', async () => {
    const { service, provider } = build();

    await service.generate({ input: WORLD_GEN_TEST_INPUT });

    expect(provider.calls.length).toBe(5);
    for (const call of provider.calls) {
      expect(call.hadSignal).toBe(true);
      expect(call.task).toBe('agent-world');
      expect(call.deadlineAt).toBeGreaterThan(Date.now());
      expect(call.requestId).toContain(service.run?.runId);
      expect(call.scope).toBe(`worldgen:${service.run?.runId}`);
    }
  });

  test('all stages of one run share ONE absolute deadline', async () => {
    const { service, provider } = build();

    await service.generate({ input: WORLD_GEN_TEST_INPUT });

    const deadlines = new Set(provider.calls.map((call) => call.deadlineAt));
    expect(deadlines.size).toBe(1);
  });

  test('a duplicate generate does not open a second pipeline', async () => {
    const { service, provider } = build({ delayMs: { setting: 60, cast: 60 } });

    const first = service.generate({ input: WORLD_GEN_TEST_INPUT });
    // A double-clicked Generate button.
    const second = service.generate({ input: WORLD_GEN_TEST_INPUT });
    await Promise.all([first, second]);

    // One call per stage — a second pipeline would double every one of these.
    expect(provider.countStage('setting')).toBe(1);
    expect(provider.countStage('cast')).toBe(1);
    expect(provider.countStage('arcs')).toBe(1);
  });
});

describe('WorldGenDraftService — stage ordering (G01)', () => {
  test('arcs are only requested after the cast resolves', async () => {
    const { service, provider } = build({ delayMs: { cast: 40 } });

    await service.generate({ input: WORLD_GEN_TEST_INPUT });

    const castAttempt = provider.calls.find((call) => call.stage === 'cast');
    const arcAttempt = provider.calls.find((call) => call.stage === 'arcs');
    expect(castAttempt).toBeDefined();
    expect(arcAttempt).toBeDefined();
    // The arc prompt must embed the cast, so the cast call precedes it.
    expect(provider.calls.indexOf(castAttempt as (typeof provider.calls)[number])).toBeLessThan(
      provider.calls.indexOf(arcAttempt as (typeof provider.calls)[number]),
    );
  });

  test('a complete run produces a preview-only draft', async () => {
    const { service } = build();

    const draft = await service.generate({ input: WORLD_GEN_TEST_INPUT });

    expect(draft?.preview).toBe(true);
    expect(draft?.playable).toBe(false);
    expect(draft?.status).toBe('complete');
    expect(draft?.cast).toHaveLength(2);
  });
});

describe('WorldGenDraftService — checkpoint retention (G01)', () => {
  test('a failing stage does not re-run the stages that already succeeded', async () => {
    // `places` never succeeds; `setting`/`cast`/`hudWidgets` succeed first time.
    const { service, provider } = build({ failStages: { places: 'provider unavailable' } });

    await service.generate({ input: WORLD_GEN_TEST_INPUT });

    expect(provider.countStage('setting')).toBe(1);
    expect(provider.countStage('cast')).toBe(1);
    expect(provider.countStage('hudWidgets')).toBe(1);
    // Only the failing stage is retried, up to its budget.
    expect(provider.countStage('places')).toBe(3);
    expect(service.run?.status).toBe('failed');
  });

  test('a stage payload the FINAL schema would reject never becomes a checkpoint', async () => {
    // An arc with no objectives is legal against the arcs stage schema unless
    // the schema says otherwise, and `absorbStageResult` records a checkpoint
    // purely on that schema. So a stage schema that permits it lets an
    // unbuildable draft hold a checkpoint: the run then fails at the final
    // parse with every stage's work discarded.
    const payloads = coherentPayloads();
    const arcs = payloads.arcs as { arcs: { objectives: string[] }[] };
    const arc = arcs.arcs[0];
    if (arc === undefined) {
      throw new Error('The coherent fixture must contain an arc.');
    }
    arc.objectives = [];
    const { service, provider } = build({ payloads });

    const draft = await service.generate({ input: WORLD_GEN_TEST_INPUT });

    expect(draft).toBeUndefined();
    expect(service.run?.status).toBe('failed');
    // The arcs stage was re-issued to its attempt budget: it never
    // checkpointed, so nothing downstream could adopt it.
    expect(provider.countStage('arcs')).toBe(3);
  });

  test('a transient failure retries only that stage and then completes', async () => {
    const { service, provider } = build({ flakyStages: { hudWidgets: 1 } });

    const draft = await service.generate({ input: WORLD_GEN_TEST_INPUT });

    expect(draft?.status).toBe('complete');
    expect(provider.countStage('setting')).toBe(1);
    expect(provider.countStage('hudWidgets')).toBe(2);
    // The retry is a NEW request id, not a re-issue of the same one.
    const widgetCalls = provider.calls.filter((call) => call.stage === 'hudWidgets');
    expect(widgetCalls[0]?.requestId).not.toBe(widgetCalls[1]?.requestId);
  });

  test('a retry after failure reuses surviving checkpoints instead of rerunning everything', async () => {
    // The provider itself always succeeds; only the wrapper fails, so the
    // second run can recover without the fixture still failing underneath it.
    const provider = createControllableProvider({ payloads: coherentPayloads() });
    const store = createMemoryStore();
    let failing = true;
    const service = createWorldGenDraftService({
      className: 'WorldGenDraftServiceTest',
      text: {
        extractStructure: async (call) => {
          if (failing && call.schemaName === 'WorldGenDraft_places') {
            throw new Error('provider unavailable');
          }
          return provider.capability.extractStructure(call);
        },
      },
      resolveStore: async () => store,
      maxAttemptsPerStage: 1,
    });

    await service.generate({ input: WORLD_GEN_TEST_INPUT });
    const afterFirst = provider.calls.length;
    expect(service.run?.status).toBe('failed');
    expect(service.run?.error).toContain('locations');
    // The setting stage already succeeded and must not be requested again.
    expect(provider.countStage('setting')).toBe(1);

    failing = false;
    const draft = await service.generate({ input: WORLD_GEN_TEST_INPUT });

    expect(draft?.status).toBe('complete');
    expect(provider.calls.length).toBeLessThan(afterFirst + 2);
    expect(provider.countStage('setting')).toBe(1);
  });
});

describe('WorldGenDraftService — cancellation (G01)', () => {
  test('cancel during a run stops it and never auto-retries', async () => {
    const { service, provider } = build({ delayMs: { cast: 80, places: 80, arcs: 80 } });

    const run = service.generate({ input: WORLD_GEN_TEST_INPUT });
    await provider.waitForCalls('cast', 1);
    service.cancel();
    await run;

    expect(service.run?.status).toBe('cancelled');
    // Cancellation is terminal: nothing re-issues the aborted stages.
    expect(provider.countStage('arcs')).toBe(0);
  });

  test('a late provider completion cannot write into a newer state', async () => {
    const { service, provider } = build({ delayMs: { setting: 50, cast: 50, places: 50 } });

    const first = service.generate({ input: WORLD_GEN_TEST_INPUT });
    const firstRunId = service.run?.runId;
    await provider.waitForCalls('setting', 1);
    service.cancel();
    await first;

    expect(service.draft).toBeUndefined();

    const second = await service.generate({ input: WORLD_GEN_TEST_INPUT });

    // The abandoned run's checkpoint did not become the new run's identity, and
    // the newer run owns the draft.
    expect(second?.status).toBe('complete');
    expect(second?.runId).not.toBe(firstRunId);
  });

  test('dispose aborts the live run', async () => {
    const { service, provider } = build({ delayMs: { setting: 60, cast: 60, places: 60 } });

    const run = service.generate({ input: WORLD_GEN_TEST_INPUT });
    await provider.waitForCalls('setting', 1);
    await service.dispose();
    await run;

    expect(service.run?.status).toBe('cancelled');
    expect(service.draft).toBeUndefined();
  });

  test('a generate issued after dispose does nothing', async () => {
    const { service, provider } = build();

    await service.dispose();
    const draft = await service.generate({ input: WORLD_GEN_TEST_INPUT });

    expect(draft).toBeUndefined();
    expect(provider.calls).toHaveLength(0);
  });
});

describe('WorldGenDraftService — acceptance is private and single-flight (G01)', () => {
  test('accepting writes only the draft row and publishes nothing', async () => {
    const { service, store } = build();
    await service.generate({ input: WORLD_GEN_TEST_INPUT });

    const accepted = await service.accept();

    expect(accepted?.status).toBe('accepted_preview');
    expect(accepted?.playable).toBe(false);
    expect(store.rows.get(accepted?.draftId as string)?.status).toBe('accepted_preview');
  });

  test('accepting twice is idempotent — no second write', async () => {
    const { service, store } = build();
    await service.generate({ input: WORLD_GEN_TEST_INPUT });

    const first = await service.accept();
    const upsertsAfterFirst = store.upserts;
    const second = await service.accept();

    expect(second).toEqual(first);
    expect(store.upserts).toBe(upsertsAfterFirst);
  });

  test('accept refuses while a run is in flight', async () => {
    const { service } = build({ delayMs: { setting: 60, cast: 60, places: 60 } });

    const run = service.generate({ input: WORLD_GEN_TEST_INPUT });
    const acceptedWhileRunning = await service.accept();
    await run;

    expect(acceptedWhileRunning).toBeUndefined();
    expect(service.draft?.status).toBe('complete');
  });

  test('accept returns undefined when there is no draft', async () => {
    const { service } = build();

    expect(await service.accept()).toBeUndefined();
  });

  test('a persistence failure does not advance the draft to accepted', async () => {
    const { service, store } = build();
    await service.generate({ input: WORLD_GEN_TEST_INPUT });
    store.failUpsert = 'disk is read-only';

    const accepted = await service.accept();

    expect(accepted).toBeUndefined();
    expect(service.draft?.status).toBe('complete');
    expect(service.persistence).toBe('memory');
  });

  test('a FAILED acceptance clears the latch, so a later accept still works', async () => {
    // A latch that is only cleared on success is a latch that makes every
    // later accept a silent no-op forever after one disk hiccup.
    const { service, store } = build();
    await service.generate({ input: WORLD_GEN_TEST_INPUT });

    store.failUpsert = 'disk is read-only';
    expect(await service.accept()).toBeUndefined();

    delete store.failUpsert;
    const retried = await service.accept();

    expect(retried?.status).toBe('accepted_preview');
    expect(service.persistence).toBe('durable');
  });

  test('concurrent accepts perform exactly ONE durable write', async () => {
    const { service, store } = build();
    await service.generate({ input: WORLD_GEN_TEST_INPUT });
    // Hold the write open so both callers are inside the read-complete →
    // await-upsert window simultaneously. Without the latch both would read
    // `complete`, both would await their own upsert, and the row would be
    // written twice.
    store.holdUpsert = true;

    const first = service.accept();
    const second = service.accept();
    await store.waitForHeldUpsert?.();
    store.releaseUpserts?.();
    const [a, b] = await Promise.all([first, second]);

    expect(a).toEqual(b);
    expect(store.upserts).toBe(2); // one for the completed run, one for accept
    expect(service.draft?.status).toBe('accepted_preview');
  });

  test('an acceptance superseded while writing does not claim the result', async () => {
    const { service, store } = build();
    await service.generate({ input: WORLD_GEN_TEST_INPUT });
    store.holdUpsert = true;

    const accepting = service.accept();
    await store.waitForHeldUpsert?.();
    // A cancel + fresh generate lands while the acceptance write is open. The
    // hold is released first so the NEW run's own write is not gated behind the
    // acceptance it is supposed to supersede.
    store.holdUpsert = false;
    service.cancel();
    const newer = await service.generate({ input: WORLD_GEN_TEST_INPUT });
    store.releaseUpserts?.();
    const stale = await accepting;

    expect(stale).toBeUndefined();
    expect(newer?.revision).toBeGreaterThan(0);
    expect(service.draft?.revision).toBe(newer?.revision);
    expect(service.draft?.status).toBe('complete');
  });
});

describe('WorldGenDraftService — durable reload vs in-memory cache (G01)', () => {
  test('a completed draft is durable once the real store accepted it', async () => {
    const { service } = build({}, { real: true });

    await service.generate({ input: WORLD_GEN_TEST_INPUT });

    expect(service.persistence).toBe('durable');
  });

  test('reload re-reads from the device store rather than echoing the cache', async () => {
    const { service } = build({}, { real: true });
    await service.generate({ input: WORLD_GEN_TEST_INPUT });

    const reloaded = await service.reload();

    expect(reloaded?.status).toBe('complete');
    expect(reloaded?.cast).toHaveLength(2);
  });

  test('an unavailable device store degrades to memory and says so', async () => {
    const provider = createControllableProvider({ payloads: coherentPayloads() });
    const service = createWorldGenDraftService({
      className: 'WorldGenDraftServiceTest',
      text: provider.capability,
      resolveStore: async () => {
        throw new Error('local database unavailable');
      },
    });

    const draft = await service.generate({ input: WORLD_GEN_TEST_INPUT });

    expect(draft?.status).toBe('complete');
    expect(service.persistence).toBe('memory');
  });

  test('a REAL page reload hydrates the newest draft into a FRESH service', async () => {
    const db = createRealDatabase();
    const store = createRealStore(db);
    const provider = createControllableProvider({ payloads: coherentPayloads() });

    const first = createWorldGenDraftService({
      className: 'WorldGenDraftServiceTest',
      text: provider.capability,
      resolveStore: async () => store,
    });
    const draft = await first.generate({ input: WORLD_GEN_TEST_INPUT });
    await first.accept();

    // A brand-new service over the SAME device database. It holds NOTHING in
    // memory: no draft id, no checkpoints, no run. This is what a browser
    // reload produces, and the old `reload()` could not serve it because it
    // returns early when `_draft` is undefined — the durable claim was true
    // only within one tab's lifetime.
    const second = createWorldGenDraftService({
      className: 'WorldGenDraftServiceTest',
      text: provider.capability,
      resolveStore: async () => store,
    });
    expect(second.draft).toBeUndefined();
    expect(second.persistence).toBe('unknown');

    const hydrated = await second.initialize();

    expect(hydrated?.draftId).toBe(draft?.draftId);
    expect(hydrated?.status).toBe('accepted_preview');
    expect(hydrated?.preview).toBe(true);
    expect(hydrated?.playable).toBe(false);
    expect(hydrated?.cast).toHaveLength(2);
    expect(second.draft?.draftId).toBe(draft?.draftId);
    expect(second.persistence).toBe('durable');
  });

  test('a hydrated draft reuses its checkpoints instead of re-billing the provider', async () => {
    const db = createRealDatabase();
    const store = createRealStore(db);
    const provider = createControllableProvider({ payloads: coherentPayloads() });

    const first = createWorldGenDraftService({
      className: 'WorldGenDraftServiceTest',
      text: provider.capability,
      resolveStore: async () => store,
    });
    await first.generate({ input: WORLD_GEN_TEST_INPUT });
    const callsAfterFirst = provider.calls.length;

    const second = createWorldGenDraftService({
      className: 'WorldGenDraftServiceTest',
      text: provider.capability,
      resolveStore: async () => store,
    });
    await second.initialize();
    const regenerated = await second.generate({ input: WORLD_GEN_TEST_INPUT });

    expect(regenerated?.status).toBe('complete');
    expect(provider.calls.length).toBe(callsAfterFirst);
  });

  test('a corrupt stored row fails closed with a diagnostic, not a bad cast', async () => {
    const db = createRealDatabase();
    const store = createRealStore(db);
    const provider = createControllableProvider({ payloads: coherentPayloads() });

    const first = createWorldGenDraftService({
      className: 'WorldGenDraftServiceTest',
      text: provider.capability,
      resolveStore: async () => store,
    });
    const draft = await first.generate({ input: WORLD_GEN_TEST_INPUT });

    // Overwrite the column with something that is not a draft at all.
    await db.execute({
      sql: 'UPDATE worldgen_drafts SET blueprint_json = ? WHERE draft_id = ?',
      args: ['{"schemaVersion":1,"draftId":"x","preview":true,"playable":true}', draft?.draftId],
    });

    const second = createWorldGenDraftService({
      className: 'WorldGenDraftServiceTest',
      text: provider.capability,
      resolveStore: async () => store,
    });
    const hydrated = await second.initialize();

    expect(hydrated).toBeUndefined();
    expect(second.draft).toBeUndefined();
    expect(second.persistence).toBe('memory');
    // The diagnostic must NAME the real fault. This row is not oversized, and
    // labelling it `size_limit` sends the reader hunting for a size problem
    // that does not exist.
    expect(second.diagnostics).toHaveLength(1);
    expect(second.diagnostics[0]?.code).toBe('unreadable_storage');
    expect(second.diagnostics[0]?.message).toContain('structural validation');
  });

  test('a store that throws on read is reported as unreadable storage too', async () => {
    // A different fault with the same honest answer: the row was never even
    // returned, and calling that `size_limit` would be as wrong as above.
    const store = createMemoryStore();
    const service = createWorldGenDraftService({
      className: 'WorldGenDraftServiceTest',
      text: createControllableProvider({ payloads: coherentPayloads() }).capability,
      resolveStore: async () => ({
        ...store,
        latest: async () => {
          throw new Error('database is locked by another process');
        },
      }),
    });

    const hydrated = await service.initialize();

    expect(hydrated).toBeUndefined();
    expect(service.persistence).toBe('memory');
    expect(service.diagnostics[0]?.code).toBe('unreadable_storage');
    expect(service.diagnostics[0]?.message).toContain('database is locked');
  });
});

describe('WorldGenDraftService — superseded runs cannot write (G01)', () => {
  test('an old run finishing AFTER a new run started cannot change the cast or checkpoints', async () => {
    // NEGATIVE CONTROL: `createDeferredProvider` never observes its
    // AbortSignal. A provider that honours the signal makes this defect
    // invisible, because the abort alone already suppresses the late write.
    const provider = createDeferredProvider();
    const store = createMemoryStore();
    const service = createWorldGenDraftService({
      className: 'WorldGenDraftServiceTest',
      text: provider.capability,
      resolveStore: async () => store,
      maxAttemptsPerStage: 1,
    });

    const first = service.generate({ input: WORLD_GEN_TEST_INPUT });
    await provider.waitForCall('setting');

    // The player gives up and starts a NEW run while the old provider call is
    // still outstanding.
    service.cancel('player restarted');
    const second = service.generate({ input: WORLD_GEN_TEST_INPUT });
    await provider.waitForCall('setting', 2);

    // Only now does the abandoned run's provider call come back — after the new
    // run has already started and issued its own `setting` request. `resolve`
    // settles the OLDEST outstanding call, so this is the stale one.
    provider.resolve('setting', {
      worldName: 'STALE RUN WORLD',
      worldDescription: 'This premise belongs to a run the player abandoned.',
      themes: ['stale'],
    });

    const firstResult = await first;
    expect(firstResult).toBeUndefined();

    // Now answer the LIVE run's own setting call, then its remaining stages.
    provider.resolve('setting');
    await provider.waitForCall('cast');
    provider.resolve('cast');
    await provider.waitForCall('places');
    provider.resolve('places');
    await provider.waitForCall('hudWidgets');
    provider.resolve('hudWidgets');
    await provider.waitForCall('arcs');
    provider.resolve('arcs');
    const secondDraft = await second;

    expect(secondDraft?.status).toBe('complete');
    // The abandoned run's premise was NOT spliced into the live run.
    expect(secondDraft?.setting?.worldName).toBe('Duskhollow');
    expect(secondDraft?.cast).toHaveLength(2);

    const final = service.draft;
    expect(final?.setting?.worldName).not.toBe('STALE RUN WORLD');
    expect(final?.checkpoints.map((checkpoint) => checkpoint.stage).sort()).toEqual([
      'arcs',
      'cast',
      'hudWidgets',
      'places',
      'setting',
    ]);
    // Exactly one draft row: the abandoned run never reached the device store.
    expect(store.rows.size).toBe(1);
  });

  test('a persistence result from a superseded run never claims durable', async () => {
    // The cancel has to land while the REAL write is in flight. Cancelling
    // while a stage was still outstanding meant `_persist` was never reached,
    // so the assertion below held no matter what the persistence guard did —
    // the previous version of this test did exactly that and passed vacuously.
    const provider = createControllableProvider({ payloads: coherentPayloads() });
    const store = createMemoryStore();
    const service = createWorldGenDraftService({
      className: 'WorldGenDraftServiceTest',
      text: provider.capability,
      resolveStore: async () => store,
      maxAttemptsPerStage: 1,
    });

    // Every stage succeeds, so the run reaches its single durable write…
    store.holdUpsert = true;
    const run = service.generate({ input: WORLD_GEN_TEST_INPUT });
    // …and this resolves only once `store.upsert` has actually been entered.
    await store.waitForHeldUpsert?.();

    // The player gives up in that exact window: the write is open, and the run
    // it belongs to is over.
    service.cancel('player navigated away');
    store.releaseUpserts?.();
    await run;

    // Non-vacuity first: the write really did happen and really did land.
    expect(store.upserts).toBe(1);
    expect(store.rows.size).toBe(1);
    expect(service.run?.status).toBe('cancelled');

    // And the outcome of that write, which succeeded, is NOT claimed: the draft
    // the player was no longer looking at must not be stamped 'durable'.
    expect(service.persistence).not.toBe('durable');
    expect(service.persistence).toBe('unknown');
  });
});

describe('WorldGenDraftService — the run budget bounds retries (G01)', () => {
  test('a provider that ignores the deadline still cannot outlive the run budget', async () => {
    const provider = createDeferredProvider();
    const store = createMemoryStore();
    const service = createWorldGenDraftService({
      className: 'WorldGenDraftServiceTest',
      text: provider.capability,
      resolveStore: async () => store,
      runBudgetMs: 40,
      maxAttemptsPerStage: 5,
    });

    const run = service.generate({ input: WORLD_GEN_TEST_INPUT });
    await provider.waitForCall('setting');

    // No manual settlement: the local deadline must finish this run even
    // when the provider never resolves or observes cancellation.
    expect(await run).toBeUndefined();
    provider.resolve('setting', {
      worldName: 'Too Late',
      worldDescription: 'Arrived after the budget the run was given.',
      themes: [],
    });
    await Bun.sleep(0);

    // The budget expired long before this stage could have been re-issued, so
    // the run ends at the deadline check instead of walking the rest of the
    // graph — and the late premise never becomes a draft.
    expect(service.run?.status).toBe('failed');
    expect(service.run?.error).toContain('budget');
    expect(service.draft).toBeUndefined();
    expect(provider.calls).toHaveLength(1);
    expect(store.upserts).toBe(0);
  });
});

describe('cast disambiguation — the draft, not an adapter (G01)', () => {
  test('an unknown quest-giver is reported instead of silently dropped', async () => {
    const payloads = coherentPayloads();
    const arcs = payloads.arcs as { arcs: { questGiverNames: string[] }[] };
    const arc = arcs.arcs[0];
    if (arc === undefined) {
      throw new Error('The coherent fixture must contain an arc.');
    }
    arc.questGiverNames = ['Nobody At All'];
    const { service } = build({ payloads });

    const draft = await service.generate({ input: WORLD_GEN_TEST_INPUT });

    expect(draft).toBeUndefined();
    expect(service.run?.status).toBe('failed');
    expect(service.run?.failures.find((failure) => failure.stage === 'arcs')?.message).toContain(
      'Nobody At All',
    );
  });

  test('two same-named cast members stay individually addressable', async () => {
    const payloads = coherentPayloads();
    const cast = payloads.cast as { npcs: { name: string }[] };
    const secondCastMember = cast.npcs[1];
    const arcs = payloads.arcs as { arcs: { questGiverNames: string[] }[] };
    const authoredArc = arcs.arcs[0];
    if (secondCastMember === undefined || authoredArc === undefined) {
      throw new Error('The coherent fixture must contain two cast members and an arc.');
    }
    secondCastMember.name = 'Maren';
    authoredArc.questGiverNames = ['Maren', 'Maren'];
    const { service } = build({ payloads });

    const draft = await service.generate({ input: WORLD_GEN_TEST_INPUT });

    // Two "Maren"s are a legitimate provider outcome, so they get distinct
    // stable ids AND disambiguated labels — the draft is accepted, not rejected.
    expect(new Set(draft?.cast.map((npc) => npc.id)).size).toBe(2);
    expect(draft?.cast.map((npc) => npc.name)).toEqual(['Maren', 'Maren (2)']);
    expect(draft?.arcs[0]?.questGiverIds).toEqual(draft?.cast.map((npc) => npc.id));
    expect(service.diagnostics).toEqual([]);
  });
});
