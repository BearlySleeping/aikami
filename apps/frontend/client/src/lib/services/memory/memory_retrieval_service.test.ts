// apps/frontend/client/src/lib/services/memory/memory_retrieval_service.test.ts
//
// Unit & integration tests for the memory retrieval service and its
// witness-scoped NPC recall surface.
//
// Contract: C-458 In-House Memory & Lore Retrieval System; C-492 memory
// retrieval correctness and production wiring.
//
// These tests verify:
//  - AC-2: indexAll() indexes committed narrative events + lore + summaries
//  - AC-4: retrieveForNpc() is witness-scoped — an NPC recalls only events it
//    witnessed plus shared lore, and never a session_summary
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { MEMORY_QUERY_SCOPE_SOURCE_TYPES, NPC_RECALL_MAX_RESULTS } from '@aikami/constants';
import type {
  CommittedNarrativeEvent,
  MemoryIndexable,
  MemoryQuery,
  MemoryResult,
  MemoryRetrievalBackend,
  NarrativeEventKind,
  NarrativeInformationKind,
} from '@aikami/types';
import type { SessionSummary } from '$types';
import type { LocalEmbeddingBackend as LocalEmbeddingBackendInstance } from './local_embedding_backend';
import type {
  MemoryRetrievalService as MemoryRetrievalServiceInstance,
  MemoryRetrievalServiceInterface,
  MemoryRetrievalServiceOptions,
} from './memory_retrieval_service.svelte';

// ---------------------------------------------------------------------------
// Mock dependencies BEFORE importing the service module
// ---------------------------------------------------------------------------

const mockLorebooks: Array<{
  id: string;
  entries: Array<{ id: string; content: string; keywords?: string[]; name?: string }>;
}> = [];
let mockSessionSummary: SessionSummary | null = null;
let mockEvents: CommittedNarrativeEvent[] = [];

mock.module('../lorebook/lorebook_store.svelte', () => ({
  lorebookStore: {
    get lorebooks() {
      return mockLorebooks;
    },
  },
}));

mock.module('../gm/session_summary_service.svelte', () => ({
  sessionSummaryService: {
    get currentSummary() {
      return mockSessionSummary;
    },
  },
}));

mock.module('../game/narrative_event_service.svelte', () => ({
  narrativeEventService: {
    get events() {
      return mockEvents;
    },
    witnessedBy: (npcId: string) => mockEvents.filter((e) => e.witnesses.includes(npcId)),
  },
}));

// Mock $logger to avoid Bun resolution issues
mock.module('$logger', () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    log: () => {},
  },
}));

let LocalEmbeddingBackend: { create(): LocalEmbeddingBackendInstance };
let MemoryRetrievalService: {
  create(options: MemoryRetrievalServiceOptions): MemoryRetrievalServiceInstance;
};

beforeEach(async () => {
  mockLorebooks.length = 0;
  mockSessionSummary = null;
  mockEvents = [];

  ({ LocalEmbeddingBackend } = await import('./local_embedding_backend'));
  ({ MemoryRetrievalService } = await import('./memory_retrieval_service.svelte'));
});

// ---------------------------------------------------------------------------
// Mock backend for testing retrieval logic without any model
// ---------------------------------------------------------------------------

type MockEntry = {
  sourceType: MemoryIndexable['sourceType'];
  sourceId: string;
  content: string;
  keywords: string[];
};

/**
 * A keyword-overlap mock backend mirroring LocalEmbeddingBackend's only path.
 */
const createMockBackend = (): MemoryRetrievalBackend & {
  seed: (entries: MockEntry[]) => void;
  entries: () => MockEntry[];
} => {
  let entries: MockEntry[] = [];

  const backend: MemoryRetrievalBackend & {
    seed: (entries: MockEntry[]) => void;
    entries: () => MockEntry[];
  } = {
    seed: (e: MockEntry[]) => {
      entries = e;
    },
    entries: () => entries,
    index: mock(async (indexables: MemoryIndexable[]) => {
      for (const ix of indexables) {
        const existing = entries.findIndex(
          (e) => e.sourceType === ix.sourceType && e.sourceId === ix.sourceId,
        );
        const newEntry: MockEntry = {
          sourceType: ix.sourceType,
          sourceId: ix.sourceId,
          content: ix.content,
          keywords: ix.content.toLowerCase().split(/\W+/).filter(Boolean),
        };
        if (existing >= 0) {
          entries[existing] = newEntry;
        } else {
          entries.push(newEntry);
        }
      }
    }),
    query: async (q: MemoryQuery): Promise<MemoryResult[]> => {
      const scope = q.scope ?? 'all';
      const queryWords = q.text.toLowerCase().split(/\W+/).filter(Boolean);
      const sourceTypes = MEMORY_QUERY_SCOPE_SOURCE_TYPES[scope];

      const candidates = entries.filter((entry) =>
        sourceTypes.some((sourceType) => sourceType === entry.sourceType),
      );

      const scored = candidates
        .map((e) => {
          const matched = queryWords.filter((w) => e.keywords.includes(w)).length;
          const score = queryWords.length > 0 ? matched / queryWords.length : 0;
          return { entry: e, score };
        })
        .filter((r) => r.score >= 0.25)
        .sort((a, b) => b.score - a.score);

      const limit = q.limit ?? 10;
      return scored.slice(0, limit).map((r) => ({
        sourceType: r.entry.sourceType,
        sourceId: r.entry.sourceId,
        content: r.entry.content,
        relevanceScore: r.score,
      }));
    },
    remove: async (options: { sourceType: MemoryIndexable['sourceType']; sourceId: string }) => {
      entries = entries.filter(
        (e) => !(e.sourceType === options.sourceType && e.sourceId === options.sourceId),
      );
    },
    clear: async () => {
      entries = [];
    },
    size: async () => entries.length,
  };

  return backend;
};

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const createLoreEntry = (id: string, content: string): MemoryIndexable => ({
  sourceType: 'lore',
  sourceId: id,
  content,
});

let seq = 1;
const createEvent = (options: {
  id: string;
  summary: string;
  witnesses: string[];
  informationKind?: NarrativeInformationKind;
  claimantId?: string;
  kind?: NarrativeEventKind;
}): CommittedNarrativeEvent => ({
  id: options.id,
  campaignId: 'camp-1',
  sequence: seq++,
  kind: options.kind ?? 'WorldFlagChanged',
  summary: options.summary,
  informationKind: options.informationKind ?? 'world_fact',
  witnesses: options.witnesses,
  recordedAt: new Date().toISOString(),
  ...(options.claimantId ? { claimantId: options.claimantId } : {}),
});

// ---------------------------------------------------------------------------
// Tests: MemoryRetrievalService
// ---------------------------------------------------------------------------

describe('MemoryRetrievalService', () => {
  let service: MemoryRetrievalServiceInterface;
  let mockBackend: ReturnType<typeof createMockBackend>;

  beforeEach(() => {
    seq = 1;
    mockBackend = createMockBackend();

    service = MemoryRetrievalService.create({
      className: 'MemoryRetrievalService',
    }) as MemoryRetrievalServiceInterface;

    // Inject the mock backend
    (service as Record<string, unknown>)._backend = mockBackend;
    (service as Record<string, unknown>)._isReady = true;
    (service as Record<string, unknown>)._initialised = true;
  });

  it('AC-2: indexAll() indexes committed narrative events alongside lore and summaries', async () => {
    mockEvents = [
      createEvent({
        id: 'evt-1',
        summary: 'Rollo possesses the Ward Wand.',
        witnesses: ['npc-rollo'],
      }),
    ];
    mockLorebooks.push({
      id: 'lorebook-1',
      entries: [{ id: 'e1', content: 'The inn sits at the village square.' }],
    });

    await service.indexAll();

    const indexed = mockBackend.entries();
    const eventEntry = indexed.find(
      (e) => e.sourceType === 'narrative_event' && e.sourceId === 'evt-1',
    );
    expect(eventEntry).toBeDefined();
    expect(eventEntry?.content).toBe('Rollo possesses the Ward Wand.');
    expect(indexed.some((e) => e.sourceType === 'lore' && e.sourceId === 'e1')).toBe(true);
  });

  it('AC-2: belief/claim events carry attribution in their recall content', async () => {
    mockEvents = [
      createEvent({
        id: 'evt-belief',
        summary: 'Rollo intends to sell the wand.',
        witnesses: ['npc-thalia'],
        informationKind: 'character_belief',
        claimantId: 'npc-thalia',
      }),
      createEvent({
        id: 'evt-claim',
        summary: 'He never touched the wand.',
        witnesses: ['npc-rollo'],
        informationKind: 'dialogue_claim',
        claimantId: 'npc-rollo',
      }),
      createEvent({
        id: 'evt-fact',
        summary: 'The wand is hidden in the cellar.',
        witnesses: ['npc-rollo'],
        informationKind: 'world_fact',
      }),
    ];

    await service.indexAll();

    const belief = mockBackend.entries().find((e) => e.sourceId === 'evt-belief');
    const claim = mockBackend.entries().find((e) => e.sourceId === 'evt-claim');
    const fact = mockBackend.entries().find((e) => e.sourceId === 'evt-fact');

    expect(belief?.content).toBe('[npc-thalia believes] Rollo intends to sell the wand.');
    expect(claim?.content).toBe('[npc-rollo claims] He never touched the wand.');
    expect(fact?.content).toBe('The wand is hidden in the cellar.');
  });

  describe('AC-4: witness-scoped NPC recall', () => {
    it('returns only events the NPC witnessed and never the unwitnessed secret', async () => {
      mockEvents = [
        createEvent({
          id: 'evt-a',
          summary: 'A witnessed the hidden key.',
          witnesses: ['npc-a'],
          informationKind: 'world_fact',
        }),
        createEvent({
          id: 'evt-secret',
          summary: 'A secret B never learned.',
          witnesses: ['npc-b'],
          informationKind: 'world_fact',
        }),
      ];
      await service.indexAll();

      const resultsA = await service.retrieveForNpc({ npcId: 'npc-a', text: 'key secret learned' });
      const idsA = resultsA.map((r) => r.sourceId);
      expect(idsA).toContain('evt-a');
      expect(idsA).not.toContain('evt-secret');
    });

    it("is symmetric — NPC B does not receive NPC A's witnessed fact", async () => {
      mockEvents = [
        createEvent({
          id: 'evt-a',
          summary: 'A learned a private truth.',
          witnesses: ['npc-a'],
        }),
        createEvent({
          id: 'evt-b',
          summary: 'B witnessed a different truth.',
          witnesses: ['npc-b'],
        }),
      ];
      await service.indexAll();

      const resultsB = await service.retrieveForNpc({ npcId: 'npc-b', text: 'truth' });
      const idsB = resultsB.map((r) => r.sourceId);
      expect(idsB).toContain('evt-b');
      expect(idsB).not.toContain('evt-a');
    });

    it('never returns a session_summary even when it matches the query', async () => {
      // A session summary matches the query, and the NPC witnessed an event.
      mockSessionSummary = {
        id: 's1',
        createdAt: 1,
        keyEvents: [],
        npcInteractions: [],
        playtimeMinutes: 30,
        resumePoint: 'The inn',
        synopsis: 'The player privately plans to betray Rollo.',
      };
      mockEvents = [
        createEvent({ id: 'evt-a', summary: 'Rollo greets the player.', witnesses: ['npc-rollo'] }),
      ];
      await service.indexAll();

      const results = await service.retrieveForNpc({
        npcId: 'npc-rollo',
        text: 'player privately plans betray',
      });

      expect(results.every((r) => r.sourceType !== 'session_summary')).toBe(true);
    });

    it('treats an empty witness set as "no narrative-event recall", not "all events"', async () => {
      mockEvents = [
        createEvent({ id: 'evt-a', summary: 'A secret fact.', witnesses: ['npc-other'] }),
      ];
      await service.indexAll();

      const results = await service.retrieveForNpc({ npcId: 'npc-unknown', text: 'secret fact' });
      // No narrative_event results for an unwitnessed NPC.
      expect(results.every((r) => r.sourceType !== 'narrative_event')).toBe(true);
    });

    it('caps results at NPC_RECALL_MAX_RESULTS (default limit)', async () => {
      mockEvents = Array.from({ length: 8 }, (_, i) =>
        createEvent({
          id: `evt-${i}`,
          summary: `The player spoke about topic ${i}.`,
          witnesses: ['npc-a'],
        }),
      );
      await service.indexAll();

      const results = await service.retrieveForNpc({ npcId: 'npc-a', text: 'topic' });
      expect(results.length).toBeLessThanOrEqual(NPC_RECALL_MAX_RESULTS);
    });
  });

  describe('AC-3/AC-4: lore passes through NPC recall (shared world knowledge)', () => {
    it('returns lore entries the NPC never "witnessed" as shared knowledge', async () => {
      await mockBackend.index([createLoreEntry('lore-1', 'The Ward Wand is legendary.')]);
      const results = await service.retrieveForNpc({ npcId: 'npc-any', text: 'Ward Wand' });
      expect(results.some((r) => r.sourceType === 'lore' && r.sourceId === 'lore-1')).toBe(true);
    });
  });

  it('returns empty results when disabled via toggle', async () => {
    await mockBackend.index([createLoreEntry('e1', 'Something indexed')]);
    service.setEnabled(false);
    const results = await service.query({ text: 'indexed' });
    expect(results).toHaveLength(0);
  });

  it('returns empty NPC recall when disabled', async () => {
    mockEvents = [createEvent({ id: 'evt-a', summary: 'fact', witnesses: ['npc-a'] })];
    await service.indexAll();
    service.setEnabled(false);
    const results = await service.retrieveForNpc({ npcId: 'npc-a', text: 'fact' });
    expect(results).toHaveLength(0);
  });

  it('clearIndex() removes all entries', async () => {
    await mockBackend.index([createLoreEntry('e1', 'Some indexed content.')]);
    await service.clearIndex();
    const results = await service.query({ text: 'indexed' });
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: scope filtering + graceful degradation
// ---------------------------------------------------------------------------

describe('Backend scope filtering', () => {
  it('maps history scope to session summaries', async () => {
    const backend = LocalEmbeddingBackend.create();
    backend.loadSnapshot({
      entries: [
        {
          sourceType: 'session_summary',
          sourceId: 's1',
          content: 'The party discovered ancient writings.',
        },
      ],
    });
    const results = await backend.query({ text: 'ancient writings', scope: 'history' });
    expect(results).toHaveLength(1);
    expect(results[0].sourceType).toBe('session_summary');
  });

  it('npc scope excludes session_summary at the scope layer', async () => {
    const backend = LocalEmbeddingBackend.create();
    backend.loadSnapshot({
      entries: [
        {
          sourceType: 'session_summary',
          sourceId: 's1',
          content: 'The party discovered ancient writings.',
        },
      ],
    });
    const results = await backend.query({ text: 'ancient writings', scope: 'npc' });
    expect(results).toHaveLength(0);
  });

  it('returns empty for all scopes when index is empty', async () => {
    const backend = LocalEmbeddingBackend.create();
    const results = await backend.query({ text: 'test', scope: 'lore' });
    expect(results).toEqual([]);
  });
});
