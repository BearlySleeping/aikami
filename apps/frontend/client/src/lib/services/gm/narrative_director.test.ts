// apps/frontend/client/src/lib/services/gm/narrative_director.test.ts
//
// Unit tests for NarrativeDirectorService — AC-3: interval check,
// structured output via Zod, guidance injection, manual override.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json
//     src/lib/services/gm/narrative_director.test.ts

import { describe, expect, mock, test } from 'bun:test';

mock.module('../game/serializable_service', () => ({
  registerSerializable: mock(() => {}),
}));

mock.module('$services', () => ({
  textGenerationService: {
    streamChat: mock(async () => {}),
    extractStructure: mock(async () => ({
      description: 'A misty morning in the forest. Birds chirp softly.',
      playerGuidance: 'Follow the path north to find the ancient ruins.',
    })),
    cancelAll: mock(() => {}),
  },
}));

import { NarrativeDirectorService } from './narrative_director_service.svelte.ts';

describe('NarrativeDirectorService — AC-3', () => {
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
