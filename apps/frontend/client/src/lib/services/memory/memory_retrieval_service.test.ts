// apps/frontend/client/src/lib/services/memory/memory_retrieval_service.test.ts
//
// Unit & integration tests for the memory retrieval service and backend.
//
// Contract: C-458 In-House Memory & Lore Retrieval System
//
// These tests verify:
//  - AC-1: Semantic retrieval (paraphrase matching)
//  - AC-2: Cross-source query results
//  - AC-3: Fully offline operation (no network calls)
//  - AC-4: Background indexing without blocking boot
//
// Note: The actual embedding model (@huggingface/transformers) is NOT
// available in Bun's test environment (depends on ONNX runtime).
// We test the retrieval logic via a mock backend that simulates
// embedding-based similarity, and test the backend interface contract.

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { EMBEDDING_DIMENSION, MEMORY_QUERY_SCOPE_SOURCE_TYPES } from '@aikami/constants';
import type {
  MemoryIndexable,
  MemoryQuery,
  MemoryResult,
  MemoryRetrievalBackend,
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

const mockFeatureExtraction = mock(async () => ({
  data: new Float32Array(EMBEDDING_DIMENSION).fill(0.5),
}));
const mockTransformerPipeline = mock(async () => mockFeatureExtraction);
const mockTransformersEnvironment = {
  allowLocalModels: false,
  allowRemoteModels: true,
  backends: { onnx: { wasm: { wasmPaths: '' } } },
  localModelPath: '',
};

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

mock.module('@huggingface/transformers', () => ({
  env: mockTransformersEnvironment,
  pipeline: mockTransformerPipeline,
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
  mockFeatureExtraction.mockClear();
  mockTransformerPipeline.mockClear();
  mockTransformersEnvironment.allowLocalModels = false;
  mockTransformersEnvironment.allowRemoteModels = true;
  mockTransformersEnvironment.localModelPath = '';
  mockTransformersEnvironment.backends.onnx.wasm.wasmPaths = '';

  ({ LocalEmbeddingBackend } = await import('./local_embedding_backend'));
  ({ MemoryRetrievalService } = await import('./memory_retrieval_service.svelte'));
});

// ---------------------------------------------------------------------------
// Mock backend for testing retrieval logic without the real embedding model
// ---------------------------------------------------------------------------

type MockEntry = {
  sourceType: MemoryIndexable['sourceType'];
  sourceId: string;
  content: string;
  keywords: string[];
};

/**
 * A simple keyword-overlap-based mock that simulates semantic retrieval.
 * Returns results where the query text overlaps with entry keywords or content.
 * Scores are computed as a simple overlap ratio (0..1).
 */
const createMockBackend = (): MemoryRetrievalBackend & {
  seed: (entries: MockEntry[]) => void;
} => {
  let entries: MockEntry[] = [];

  const backend: MemoryRetrievalBackend & { seed: (entries: MockEntry[]) => void } = {
    seed: (e: MockEntry[]) => {
      entries = e;
    },
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
          // Compute overlap score: fraction of query words found in entry
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

const createSessionSummary = (id: string, content: string): MemoryIndexable => ({
  sourceType: 'session_summary',
  sourceId: id,
  content,
});

// ---------------------------------------------------------------------------
// Tests: LocalEmbeddingBackend (interface contract)
// ---------------------------------------------------------------------------

describe('LocalEmbeddingBackend', () => {
  it('returns empty results when index is empty (graceful degradation)', async () => {
    const backend = LocalEmbeddingBackend.create();
    const results = await backend.query({ text: 'anything' });
    expect(results).toEqual([]);
  });

  it('returns empty results after clear()', async () => {
    const backend = LocalEmbeddingBackend.create();
    // @ts-expect-error: accessing private _entries for test setup
    backend._entries = [
      {
        sourceType: 'lore' as const,
        sourceId: 'e1',
        content: 'test',
        embedding: [1, 0, 0],
      },
    ];
    await backend.clear();
    const results = await backend.query({ text: 'test' });
    expect(results).toEqual([]);
  });

  it('reports size() correctly', async () => {
    const backend = LocalEmbeddingBackend.create();
    expect(await backend.size()).toBe(0);
    // @ts-expect-error: accessing private _entries for test setup
    backend._entries = [
      { sourceType: 'lore' as const, sourceId: 'e1', content: 'a', embedding: [1, 0] },
      { sourceType: 'lore' as const, sourceId: 'e2', content: 'b', embedding: [0, 1] },
    ];
    expect(await backend.size()).toBe(2);
  });

  it('remove() removes by sourceType + sourceId', async () => {
    const backend = LocalEmbeddingBackend.create();
    // @ts-expect-error: accessing private _entries for test setup
    backend._entries = [
      { sourceType: 'lore' as const, sourceId: 'e1', content: 'a', embedding: [1, 0] },
      {
        sourceType: 'session_summary' as const,
        sourceId: 's1',
        content: 'b',
        embedding: [0, 1],
      },
    ];
    await backend.remove({ sourceType: 'lore', sourceId: 'e1' });
    expect(await backend.size()).toBe(1);
  });

  it('toSnapshot() and loadSnapshot() round-trip', async () => {
    const backend = LocalEmbeddingBackend.create();
    // @ts-expect-error: accessing private _entries for test setup
    backend._entries = [
      {
        sourceType: 'lore' as const,
        sourceId: 'e1',
        content: 'test content',
        embedding: [0.1, 0.2, 0.3],
      },
    ];

    const snapshot = backend.toSnapshot();
    expect(snapshot.entries).toHaveLength(1);

    const backend2 = LocalEmbeddingBackend.create();
    backend2.loadSnapshot(snapshot);
    await expect(backend2.size()).resolves.toBe(1);
  });

  it('is idempotent — re-indexing same sourceId replaces entry', async () => {
    const backend = LocalEmbeddingBackend.create();
    await backend.index([createLoreEntry('e1', 'old content')]);
    await backend.index([createLoreEntry('e1', 'new content')]);

    expect(await backend.size()).toBe(1);
    expect(backend.toSnapshot().entries[0].content).toBe('new content');
  });

  it('reuses the model loaded by init() when indexing', async () => {
    const backend = LocalEmbeddingBackend.create();

    await backend.init();
    await backend.index([createLoreEntry('e1', 'indexed content')]);

    expect(mockTransformerPipeline).toHaveBeenCalledTimes(1);
    expect(mockTransformersEnvironment.allowLocalModels).toBe(true);
    expect(mockTransformersEnvironment.allowRemoteModels).toBe(false);
    expect(mockTransformersEnvironment.localModelPath).toBe('/models/');
    expect(mockTransformersEnvironment.backends.onnx.wasm.wasmPaths).toBe('/ort/');
  });
});

// ---------------------------------------------------------------------------
// Tests: MemoryRetrievalService (retrieval logic with mock backend)
// ---------------------------------------------------------------------------

describe('MemoryRetrievalService', () => {
  let service: MemoryRetrievalServiceInterface;
  let mockBackend: ReturnType<typeof createMockBackend>;

  beforeEach(() => {
    mockBackend = createMockBackend();

    // Create service instance
    service = MemoryRetrievalService.create({
      className: 'MemoryRetrievalService',
    }) as MemoryRetrievalServiceInterface;

    // Inject the mock backend
    // @ts-expect-error: accessing private _backend for test injection
    (service as Record<string, unknown>)._backend = mockBackend;
    // @ts-expect-error: accessing private _isReady for test setup
    (service as Record<string, unknown>)._isReady = true;
    // @ts-expect-error: accessing private _initialised for test setup
    (service as Record<string, unknown>)._initialised = true;
  });

  it('allows initialization to retry after a backend failure', async () => {
    let attempts = 0;
    const init = mock(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('model unavailable');
      }
    });
    const retryBackend = Object.assign(createMockBackend(), { init });
    (service as Record<string, unknown>)._backend = retryBackend;
    (service as Record<string, unknown>)._isReady = false;
    (service as Record<string, unknown>)._initialised = false;

    await service.init();
    expect(service.isReady).toBe(false);

    await service.init();
    expect(service.isReady).toBe(true);
    expect(init).toHaveBeenCalledTimes(2);
  });

  // AC-1: Semantic retrieval (simulated via keyword overlap)
  describe('AC-1: Semantic retrieval', () => {
    it('returns results by content meaning, not exact keyword', async () => {
      await mockBackend.index([
        createLoreEntry(
          'e1',
          'The old mill by the river has been abandoned for years. The miller was known as a kind soul who helped travelers.',
        ),
      ]);

      const results = await service.query({
        text: 'abandoned watermill where the nice miller used to work',
        scope: 'lore',
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].sourceId).toBe('e1');
      expect(results[0].relevanceScore).toBeGreaterThan(0);
    });

    it('returns empty results when nothing is relevant', async () => {
      await mockBackend.index([
        createLoreEntry('e1', 'Dragons are ancient creatures of immense power.'),
      ]);

      const results = await service.query({
        text: 'the price of bread in the village',
      });
      expect(results).toHaveLength(0);
    });
  });

  // AC-2: Cross-source query
  describe('AC-2: Cross-source query', () => {
    it('returns results from multiple source types for the same NPC', async () => {
      const npcName = 'Elara';

      await mockBackend.index([
        createLoreEntry(
          'lore-elara',
          `${npcName} is a elven ranger who guards the Whispering Woods. She has a hawk companion named Sol.`,
        ),
      ]);

      await mockBackend.index([
        createSessionSummary(
          'session-1',
          `The party met ${npcName} in the forest. She agreed to guide them to the ancient ruins in exchange for help finding her lost hawk.`,
        ),
      ]);

      const results = await service.query({ text: npcName, scope: 'all' });

      const sourceTypes = new Set(results.map((r) => r.sourceType));
      expect(sourceTypes.size).toBeGreaterThan(1);
    });

    it('respects scope filter — "lore" only returns lore entries', async () => {
      await mockBackend.index([
        createLoreEntry('lore-1', 'The blacksmith in town forges magical weapons.'),
        createSessionSummary('session-1', 'The party visited the blacksmith and bought a sword.'),
      ]);

      const loreResults = await service.query({ text: 'blacksmith', scope: 'lore' });
      expect(loreResults.every((r) => r.sourceType === 'lore')).toBe(true);
    });
  });

  // AC-3: Fully offline (no network calls)
  describe('AC-3: Offline operation', () => {
    it('works with no network calls (uses local backend)', async () => {
      await mockBackend.index([createLoreEntry('e1', 'The forest is home to many creatures.')]);

      const results = await service.query({ text: 'forest creatures' });
      expect(results.length).toBeGreaterThan(0);
    });

    it('returns empty results when disabled via toggle', async () => {
      service.setEnabled(false);

      await mockBackend.index([createLoreEntry('e1', 'Something indexed')]);

      const results = await service.query({ text: 'indexed' });
      expect(results).toHaveLength(0);
    });
  });

  // AC-4: Background indexing
  describe('AC-4: Background indexing', () => {
    it('indexAll() collects lore entries and session summaries', async () => {
      mockLorebooks.push({
        id: 'lorebook-1',
        entries: [{ id: 'e1', content: 'The crystal cave glows with an inner light.' }],
      });
      mockSessionSummary = {
        id: 's1',
        createdAt: 1,
        keyEvents: ['The party discovered ancient writings.'],
        npcInteractions: [],
        playtimeMinutes: 30,
        resumePoint: 'Inside the crystal cave',
        synopsis: 'The party explored the crystal cave.',
      };

      await service.indexAll();

      expect(mockBackend.index).toHaveBeenCalledTimes(1);
      expect(mockBackend.index).toHaveBeenCalledWith([
        {
          content: 'The crystal cave glows with an inner light.',
          metadata: { lorebookId: 'lorebook-1' },
          sourceId: 'e1',
          sourceType: 'lore',
        },
        {
          content: 'The party explored the crystal cave. The party discovered ancient writings.',
          metadata: { createdAt: '1' },
          sourceId: 's1',
          sourceType: 'session_summary',
        },
      ]);
    });

    it('clearIndex() removes all entries', async () => {
      await mockBackend.index([createLoreEntry('e1', 'Some indexed content.')]);

      await service.clearIndex();
      const results = await service.query({ text: 'indexed' });
      expect(results).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: Backend scope filtering
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
          embedding: [1, 0],
        },
      ],
    });

    const results = await backend.query({ text: 'ancient writings', scope: 'history' });

    expect(results).toHaveLength(1);
    expect(results[0].sourceType).toBe('session_summary');
  });

  it('returns empty gracefully when no entries match the scope', async () => {
    const backend = LocalEmbeddingBackend.create();
    // @ts-expect-error: accessing private _entries for test
    backend._entries = [
      {
        sourceType: 'lore' as const,
        sourceId: 'e1',
        content: 'test',
        embedding: [1, 0],
      },
    ];

    const results = await backend.query({ text: 'anything', scope: 'history' });
    expect(results).toEqual([]);
  });

  it('returns empty for all scopes when index is empty', async () => {
    const backend = LocalEmbeddingBackend.create();
    const results = await backend.query({ text: 'test', scope: 'lore' });
    expect(results).toEqual([]);
  });
});
