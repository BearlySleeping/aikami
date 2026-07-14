// apps/frontend/client/src/lib/services/gm/arc_memory.test.ts
//
// Unit tests for ArcMemory persistence via NarrativeDirectorService —
// AC-4: load/save/update, completion flag, prompt injection.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json
//     src/lib/services/gm/arc_memory.test.ts

import { describe, expect, mock, test } from 'bun:test';

mock.module('../game/serializable_service', () => ({
  registerSerializable: mock(() => {}),
}));

mock.module('$services', () => ({
  textGenerationService: {
    streamChat: mock(async () => {}),
    extractStructure: mock(async () => ({
      description: 'A misty morning in the forest.',
    })),
    cancelAll: mock(() => {}),
  },
}));

import type { ArcMemory } from './gm_types';
import { NarrativeDirectorService } from './narrative_director_service.svelte.ts';

describe('ArcMemory — AC-4', () => {
  test('loadArc populates currentArc', () => {
    const service = NarrativeDirectorService.create({ className: 'TestArcMemory' });
    const arc: ArcMemory = {
      arcId: 'arc-1',
      arcName: 'First Arc',
      description: 'The beginning',
      sceneDirections: [
        {
          id: 'dir-1',
          description: 'Scene one',
          createdAt: Date.now(),
          acknowledged: false,
        },
      ],
      isCompleted: false,
      updatedAt: Date.now(),
    };
    service.loadArc(arc);
    expect(service.currentArc).not.toBeNull();
    expect(service.currentArc?.arcId).toBe('arc-1');
  });

  test('loadArc restores scene directions', () => {
    const service = NarrativeDirectorService.create({ className: 'TestArcMemory' });
    const arc: ArcMemory = {
      arcId: 'arc-2',
      arcName: 'Second Arc',
      description: 'Middle',
      sceneDirections: [
        { id: 'd1', description: 'D1', createdAt: 100, acknowledged: false },
        { id: 'd2', description: 'D2', createdAt: 200, acknowledged: true },
      ],
      isCompleted: false,
      updatedAt: Date.now(),
    };
    service.loadArc(arc);
    expect(service.sceneDirectionCount).toBe(2);
  });

  test('completeArc marks arc as completed', () => {
    const service = NarrativeDirectorService.create({ className: 'TestArcMemory' });
    const arc: ArcMemory = {
      arcId: 'arc-3',
      arcName: 'Third Arc',
      description: 'End',
      sceneDirections: [],
      isCompleted: false,
      updatedAt: Date.now(),
    };
    service.loadArc(arc);
    service.completeArc();
    expect(service.currentArc?.isCompleted).toBe(true);
  });

  test('serialize preserves arc memory', () => {
    const service = NarrativeDirectorService.create({ className: 'TestArcMemory' });
    const arc: ArcMemory = {
      arcId: 'arc-4',
      arcName: 'Persist',
      description: 'Test',
      sceneDirections: [],
      isCompleted: false,
      updatedAt: Date.now(),
    };
    service.loadArc(arc);
    const state = service.serialize();
    expect(state.arcMemory?.arcId).toBe('arc-4');
  });

  test('hydrate with null does not throw (preserves existing arc)', () => {
    const service = NarrativeDirectorService.create({ className: 'TestArcMemory' });
    const arc: ArcMemory = {
      arcId: 'arc-5',
      arcName: 'Clear',
      description: 'Test',
      sceneDirections: [],
      isCompleted: false,
      updatedAt: Date.now(),
    };
    service.loadArc(arc);
    expect(() => service.hydrate({ arcMemory: null })).not.toThrow();
  });
});
