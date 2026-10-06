// apps/frontend/client/src/lib/views/worldgen/testing/world_gen_fixtures.ts
//
// Feature-owned fixtures for G01 world-generation tests.
//
// Every fixture here is a real collaborator driven through the production
// interface: a controllable provider that honours the AbortSignal it is
// handed, and a store that behaves like the device one. Nothing here asserts
// its own literal output — the assertions live in the tests, against the
// orchestration the production code actually performed.

import type { WorldGenDraft, WorldGenDraftInput } from '@aikami/schemas';
import type {
  WorldGenDraftStore,
  WorldGenDraftTextCapabilities,
} from '../../../services/worldgen/types/world_gen_draft_service.types.ts';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const WORLD_GEN_TEST_INPUT: WorldGenDraftInput = {
  genre: 'Fantasy',
  tone: 'Heroic',
  setting: 'A valley under a permanent twilight.',
  difficulty: 'Medium',
  goals: 'Relight the wardstones before the mist takes the valley.',
};

/** The wizard-facing shape of the same answers. */
export const WORLD_GEN_WIZARD_INPUT = WORLD_GEN_TEST_INPUT;

// ---------------------------------------------------------------------------
// Controllable provider
// ---------------------------------------------------------------------------

/** One observed provider call. */
export type ProviderCall = {
  stage: string;
  schemaName: string;
  requestId: string | undefined;
  task: string | undefined;
  deadlineAt: number | undefined;
  scope: string | undefined;
  hadSignal: boolean;
  attempt: number;
};

/** Options for the fake provider. */
export type ProviderOptions = {
  /** Stage name → payload. A stage with no payload returns `{}`. */
  payloads?: Record<string, unknown>;
  /** Stage name → error message. */
  failStages?: Record<string, string>;
  /** Fail the first `n` attempts of `stage`, then succeed. */
  flakyStages?: Record<string, number>;
  /** Stage name → delay in ms. */
  delayMs?: Record<string, number>;
  /** Every stage fails, for retry-exhaustion tests. */
  failEverything?: string;
};

/** A controllable provider plus the call log that makes fanout observable. */
export type ControllableProvider = {
  capability: WorldGenDraftTextCapabilities;
  calls: ProviderCall[];
  countStage: (stage: string) => number;
  /** Resolves once `count` calls for `stage` have been observed. */
  waitForCalls: (stage: string, count: number) => Promise<void>;
};

/**
 * Builds a provider that honours `signal`, records every call's identity, and
 * can be told exactly which stages fail or stall.
 */
export const createControllableProvider = (options: ProviderOptions = {}): ControllableProvider => {
  const calls: ProviderCall[] = [];
  const attempts = new Map<string, number>();
  const waiters: { stage: string; count: number; resolve: () => void }[] = [];

  const notify = (): void => {
    for (const waiter of [...waiters]) {
      if (calls.filter((call) => call.stage === waiter.stage).length >= waiter.count) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    }
  };

  const capability: WorldGenDraftTextCapabilities = {
    extractStructure: async (call) => {
      const stage = call.schemaName.replace('WorldGenDraft_', '');
      const attempt = (attempts.get(stage) ?? 0) + 1;
      attempts.set(stage, attempt);
      calls.push({
        stage,
        schemaName: call.schemaName,
        requestId: call.requestId,
        task: call.task,
        deadlineAt: call.deadlineAt,
        scope: call.scope,
        hadSignal: call.signal !== undefined,
        attempt,
      });
      notify();

      const delay = options.delayMs?.[stage] ?? 0;
      if (delay > 0) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          call.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }
      if (call.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      if (options.failEverything !== undefined) {
        throw new Error(options.failEverything);
      }
      const flakyBudget = options.flakyStages?.[stage] ?? 0;
      if (flakyBudget > 0 && attempt <= flakyBudget) {
        throw new Error(`Transient provider failure for ${stage} (attempt ${attempt})`);
      }
      const hardFailure = options.failStages?.[stage];
      if (hardFailure !== undefined) {
        throw new Error(hardFailure);
      }
      return options.payloads?.[stage] ?? {};
    },
  };

  return {
    capability,
    calls,
    countStage: (stage: string) => calls.filter((call) => call.stage === stage).length,
    waitForCalls: (stage: string, count: number) =>
      new Promise<void>((resolve) => {
        if (calls.filter((call) => call.stage === stage).length >= count) {
          resolve();
          return;
        }
        waiters.push({ stage, count, resolve });
      }),
  };
};

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

/** A store that behaves like the device one, held in memory. */
export type MemoryStore = WorldGenDraftStore & {
  rows: Map<string, WorldGenDraft>;
  upserts: number;
  /** When set, every upsert rejects — the persistence-boundary failure case. */
  failUpsert?: string;
  /** When set, `upsert` defers until the returned gate is opened. */
  holdUpsert?: boolean;
  /** Opens a held `upsert`, letting the awaiting write settle. */
  releaseUpserts?: () => void;
  /** Awaits the moment a held `upsert` is entered, not when it finishes. */
  waitForHeldUpsert?: () => Promise<void>;
};

export const createMemoryStore = (): MemoryStore => {
  let release: (() => void) | undefined;
  let entered: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const store: MemoryStore = {
    rows: new Map<string, WorldGenDraft>(),
    upserts: 0,
    upsert: async (draft) => {
      if (store.failUpsert !== undefined) {
        throw new Error(store.failUpsert);
      }
      if (store.holdUpsert === true) {
        entered?.();
        await gate;
      }
      store.upserts += 1;
      store.rows.set(draft.draftId, draft);
    },
    get: async (draftId) => store.rows.get(draftId),
    latest: async (limit = 10) =>
      [...store.rows.values()]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit),
    releaseUpserts: () => release?.(),
    waitForHeldUpsert: () => held,
  };
  return store;
};

// ---------------------------------------------------------------------------
// Provider that ignores its AbortSignal
// ---------------------------------------------------------------------------

/**
 * A provider that resolves ONLY when the test says so, and never observes
 * `signal`.
 *
 * This is the negative control for the superseded-run defect. A provider that
 * honours its signal makes the defect invisible: every late completion is
 * suppressed by the abort, so the guard being tested never has to do anything.
 * A real local model server, a queued job, or an in-flight fetch on a dead
 * connection all behave like this.
 */
export type DeferredProvider = {
  capability: WorldGenDraftTextCapabilities;
  /** Every call made, oldest first. */
  calls: { stage: string; attempt: number }[];
  /**
   * Settles the OLDEST outstanding call for `stage`.
   *
   * `payload` defaults to the fixture's payload for that stage.
   */
  resolve(stage: string, payload?: unknown): void;
  /** Rejects the OLDEST outstanding call for `stage`. */
  reject(stage: string, error: Error): void;
  waitForCall(stage: string, count?: number): Promise<void>;
};

export const createDeferredProvider = (
  payloads: Record<string, unknown> = coherentPayloads(),
): DeferredProvider => {
  const calls: { stage: string; attempt: number }[] = [];
  const attempts = new Map<string, number>();
  // A QUEUE per stage, not a single slot. Two runs of the same stage can be in
  // flight at once — that is exactly the situation the negative control is
  // about — and they must be settled independently and in order, so that
  // "the abandoned call finally returns" means the OLD one.
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }[]
  >();
  const waiters: { stage: string; count: number; resolve: () => void }[] = [];

  // Settles the OLDEST outstanding call for `stage`.
  const settle = (stage: string, outcome: 'resolve' | 'reject', value: unknown): void => {
    const queue = pending.get(stage);
    const entry = queue?.shift();
    if (entry === undefined) {
      throw new Error(`No pending call for stage "${stage}".`);
    }
    if (queue !== undefined && queue.length === 0) {
      pending.delete(stage);
    }
    if (outcome === 'resolve') {
      entry.resolve(value);
    } else {
      entry.reject(value as Error);
    }
  };

  const notify = (): void => {
    for (const waiter of [...waiters]) {
      if (calls.filter((call) => call.stage === waiter.stage).length >= waiter.count) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    }
  };

  return {
    calls,
    capability: {
      // Deliberately IGNORES `call.signal`: this is the whole point of the
      // fixture. Nothing here ever rejects on abort.
      extractStructure: (call) => {
        const stage = call.schemaName.replace('WorldGenDraft_', '');
        const attempt = (attempts.get(stage) ?? 0) + 1;
        attempts.set(stage, attempt);
        calls.push({ stage, attempt });
        notify();
        // Resolves WITH the payload the test settles it with, so a test can
        // hand a specific (or deliberately wrong) answer to one specific call.
        return new Promise<unknown>((resolve, reject) => {
          pending.set(stage, [...(pending.get(stage) ?? []), { resolve, reject }]);
        });
      },
    },
    resolve: (stage, payload) => settle(stage, 'resolve', payload ?? payloads[stage] ?? {}),
    reject: (stage, error) => settle(stage, 'reject', error),
    waitForCall: (stage, count = 1) =>
      new Promise<void>((resolve) => {
        if (calls.filter((call) => call.stage === stage).length >= count) {
          resolve();
          return;
        }
        waiters.push({ stage, count, resolve });
      }),
  };
};

// ---------------------------------------------------------------------------
// Stage payloads
// ---------------------------------------------------------------------------

/** Coherent payloads for a complete five-stage draft. */
export const coherentPayloads = (worldName = 'Duskhollow'): Record<string, unknown> => ({
  setting: {
    worldName,
    worldDescription: 'A lantern-lit frontier town in a twilight valley.',
    themes: ['frontier', 'twilight'],
  },
  cast: {
    npcs: [
      {
        name: 'Maren',
        race: 'Human',
        class: 'Innkeeper',
        role: 'Quest Giver',
        description: 'A weathered innkeeper with a knowing smile.',
        personality: 'Hospitable but sharp-tongued.',
      },
      {
        name: 'Thorn',
        race: 'Elf',
        class: 'Ranger',
        role: 'Ally',
        description: 'A quiet ranger in a silverleaf cloak.',
        personality: 'Speaks in short sentences.',
      },
    ],
  },
  places: {
    places: [
      { name: 'The Ember Market', description: 'Stalls of ember-baked bread.' },
      { name: 'Ashfall Bridge', description: 'A bridge of cooled volcanic glass.' },
    ],
  },
  hudWidgets: {
    hudWidgets: [
      { slot: 'top-left', label: 'Ember Compass', icon: 'compass', defaultVisibility: true },
    ],
  },
  arcs: {
    arcs: [
      {
        chapter: 'Chapter 1: The Fading Ward',
        description: 'Maren tasks the party with rekindling the wardstone.',
        objectives: ['Find the wardstone', 'Return to Maren'],
        questGiverNames: ['Maren'],
      },
    ],
  },
});
