// apps/frontend/client/src/lib/services/gm/narrative_director.test.ts
//
// Unit tests for NarrativeDirectorService:
//   - C-235 baseline: interval check, structured output, guidance injection, manual override.
//   - C-459 AC-1: scene direction references relevant past events via memory retrieval.
//   - C-459 AC-2: graceful degradation when no retrieval results exist.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json
//     src/lib/services/gm/narrative_director.test.ts

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { NarrativeDirectorService as NarrativeDirectorServiceClass } from './narrative_director_service.svelte.ts';

mock.module('../game/serializable_service', () => ({
  registerSerializable: mock(() => {}),
}));

const mockMemoryQuery = mock(async () => []);
const mockExtractStructure = mock(async () => ({
  description: 'A misty morning in the forest. Birds chirp softly.',
  playerGuidance: 'Follow the path north to find the ancient ruins.',
}));

mock.module('$services', () => ({
  textGenerationService: {
    streamChat: mock(async () => {}),
    extractStructure: mockExtractStructure,
    cancelAll: mock(() => {}),
  },
  memoryRetrievalService: {
    query: mockMemoryQuery,
  },
}));

let NarrativeDirectorService: typeof NarrativeDirectorServiceClass;

beforeEach(async () => {
  const serviceModule = await import('./narrative_director_service.svelte.ts');
  NarrativeDirectorService = serviceModule.NarrativeDirectorService;
  mockExtractStructure.mockClear();
});

describe('NarrativeDirectorService — C-235 baseline + C-459', () => {
  test('isRunning starts as false', () => {
    const service = NarrativeDirectorService.create({ className: 'TestNarrativeDirector' });
    expect(service.isRunning).toBe(false);
  });

  test('start sets isRunning to true', () => {
    const service = NarrativeDirectorService.create({ className: 'TestNarrativeDirector' });
    service.start(300_000);
    expect(service.isRunning).toBe(true);
    service.stop();
  });

  test('stop sets isRunning to false', () => {
    const service = NarrativeDirectorService.create({ className: 'TestNarrativeDirector' });
    service.start(300_000);
    service.stop();
    expect(service.isRunning).toBe(false);
  });

  test('start is idempotent — calling twice does not throw', () => {
    const service = NarrativeDirectorService.create({ className: 'TestNarrativeDirector' });
    service.start(300_000);
    service.start(300_000); // second call should be no-op
    expect(service.isRunning).toBe(true);
    service.stop();
  });

  test('scene direction count is 0 initially', () => {
    const service = NarrativeDirectorService.create({ className: 'TestNarrativeDirector' });
    expect(service.sceneDirectionCount).toBe(0);
  });

  test('currentArc is null initially', () => {
    const service = NarrativeDirectorService.create({ className: 'TestNarrativeDirector' });
    expect(service.currentArc).toBeNull();
  });

  test('serialize returns serializable state', () => {
    const service = NarrativeDirectorService.create({ className: 'TestNarrativeDirector' });
    const state = service.serialize();
    expect(state).toHaveProperty('arcMemory');
  });

  test('hydrate restores state', () => {
    const service = NarrativeDirectorService.create({ className: 'TestNarrativeDirector' });
    const arc = {
      arcId: 'test-arc',
      arcName: 'Test Arc',
      description: 'Test description',
      sceneDirections: [],
      isCompleted: false,
      updatedAt: Date.now(),
    };
    service.hydrate({ arcMemory: arc });
    expect(service.currentArc?.arcId).toBe('test-arc');
  });
});

// ── C-459 AC-1: Scene direction references relevant past events ───────────

describe('C-459 AC-1: Scene direction references relevant past events', () => {
  beforeEach(() => {
    mockMemoryQuery.mockReset();
  });

  test('referencedMemory is populated when retrieval has relevant results', async () => {
    const mockResults = [
      {
        sourceType: 'session_summary' as const,
        sourceId: 's1',
        content: 'The party discovered ancient writings about the lost city.',
        relevanceScore: 0.85,
      },
      {
        sourceType: 'lore' as const,
        sourceId: 'e1',
        content: 'The lost city was built by the first dwarven king.',
        relevanceScore: 0.72,
      },
    ];
    mockMemoryQuery.mockResolvedValue(mockResults);

    const service = NarrativeDirectorService.create({ className: 'TestNarrativeDirector' });
    service.start(300_000);

    // Trigger manual generation
    await service.pushStory();

    const directions = service.sceneDirections;
    expect(directions.length).toBe(1);

    const direction = directions[0];
    expect(direction.referencedMemory).toBeDefined();
    expect(direction.referencedMemory?.length).toBe(2);
    expect(direction.referencedMemory?.[0].sourceId).toBe('s1');
    expect(direction.referencedMemory?.[1].sourceId).toBe('e1');

    service.stop();
  });

  test('memoryRetrievalService is queried with arc description', async () => {
    mockMemoryQuery.mockResolvedValue([]);

    const service = NarrativeDirectorService.create({ className: 'TestNarrativeDirector' });
    service.start(300_000);

    await service.pushStory();

    expect(mockMemoryQuery).toHaveBeenCalledTimes(1);
    const queryArg = mockMemoryQuery.mock.calls[0][0];
    expect(queryArg).toHaveProperty('text');
    expect(queryArg).toHaveProperty('scope', 'all');
    expect(queryArg).toHaveProperty('limit', 5);

    service.stop();
  });

  test('discards pending generation when a different arc loads during retrieval', async () => {
    let resolveRetrieval: (() => void) | undefined;
    mockMemoryQuery.mockImplementation(
      () =>
        new Promise<never[]>((resolve) => {
          resolveRetrieval = () => resolve([]);
        }),
    );

    const service = NarrativeDirectorService.create({ className: 'TestNarrativeDirector' });
    service.loadArc({
      arcId: 'original-arc',
      arcName: 'Original Arc',
      description: 'The party searches the old forest.',
      sceneDirections: [],
      isCompleted: false,
      updatedAt: Date.now(),
    });

    const generation = service.pushStory();
    expect(mockMemoryQuery).toHaveBeenCalledTimes(1);

    service.loadArc({
      arcId: 'replacement-arc',
      arcName: 'Replacement Arc',
      description: 'The party arrives in a new kingdom.',
      sceneDirections: [],
      isCompleted: false,
      updatedAt: Date.now(),
    });
    resolveRetrieval?.();
    await generation;

    expect(service.currentArc?.arcId).toBe('replacement-arc');
    expect(service.sceneDirections).toHaveLength(0);
    expect(mockExtractStructure).not.toHaveBeenCalled();
  });
});

// ── C-459 AC-2: Graceful degradation with no retrieval results ────────────

describe('C-459 AC-2: Graceful degradation with no retrieval results', () => {
  beforeEach(() => {
    mockMemoryQuery.mockReset();
  });

  test('generation succeeds with empty retrieval results (no referencedMemory)', async () => {
    mockMemoryQuery.mockResolvedValue([]);

    const service = NarrativeDirectorService.create({ className: 'TestNarrativeDirector' });
    service.start(300_000);

    await service.pushStory();

    const directions = service.sceneDirections;
    expect(directions.length).toBe(1);

    const direction = directions[0];
    expect(direction.referencedMemory).toBeUndefined();
    expect(direction.description).toBeTruthy();
    expect(direction.description.length).toBeGreaterThan(0);

    service.stop();
  });

  test('generation succeeds when retrieval throws (falls back gracefully)', async () => {
    mockMemoryQuery.mockRejectedValue(new Error('retrieval unavailable'));

    const service = NarrativeDirectorService.create({ className: 'TestNarrativeDirector' });
    service.start(300_000);

    await service.pushStory();

    const directions = service.sceneDirections;
    expect(directions.length).toBe(1);

    const direction = directions[0];
    expect(direction.referencedMemory).toBeUndefined();
    expect(direction.description).toBeTruthy();

    service.stop();
  });

  test('existing C-235 baseline behavior is preserved (world/party/quest only)', async () => {
    mockMemoryQuery.mockResolvedValue([]);

    const service = NarrativeDirectorService.create({ className: 'TestNarrativeDirector' });
    service.start(300_000);

    await service.pushStory();

    // Direction content should still be valid JSON-like structure
    const direction = service.sceneDirections[0];
    expect(direction.id).toBeTruthy();
    expect(direction.createdAt).toBeGreaterThan(0);
    expect(direction.acknowledged).toBe(false);

    service.stop();
  });
});
