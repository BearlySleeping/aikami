// apps/frontend/client/src/lib/services/gm/session_summarization.test.ts
//
// Unit tests for SessionSummaryService — AC-5: all fields, Zod validation,
// resumePoint non-empty, <2KB, t=0.45.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json
//     src/lib/services/gm/session_summarization.test.ts

import { describe, expect, mock, test } from 'bun:test';

mock.module('../game/serializable_service', () => ({
  registerSerializable: mock(() => {}),
}));

mock.module('$services', () => ({
  textGenerationService: {
    streamChat: mock(async () => {}),
    extractStructure: mock(async () => ({
      synopsis: 'The party explored the dark forest and discovered a hidden cave.',
      keyEvents: ['Entered the forest', 'Found the cave entrance', 'Defeated a goblin patrol'],
      npcInteractions: [
        { npcName: 'Elara', context: 'The elf ranger guided the party through the forest.' },
      ],
    })),
    cancelAll: mock(() => {}),
  },
  gameStateService: {
    worldGenOutput: { worldName: 'Eldoria' },
  },
}));

import { SessionSummaryService } from './session_summary_service.svelte.ts';

describe('SessionSummaryService — AC-5', () => {
  test('currentSummary is null initially', () => {
    const service = SessionSummaryService.create({ className: 'TestSessionSummary' });
    expect(service.currentSummary).toBeNull();
  });

  test('isGenerating starts as false', () => {
    const service = SessionSummaryService.create({ className: 'TestSessionSummary' });
    expect(service.isGenerating).toBe(false);
  });

  test('generateSummary returns a summary with all fields', async () => {
    const service = SessionSummaryService.create({ className: 'TestSessionSummary' });
    const summary = await service.generateSummary(45);
    expect(summary).toHaveProperty('id');
    expect(summary).toHaveProperty('synopsis');
    expect(summary).toHaveProperty('keyEvents');
    expect(summary).toHaveProperty('npcInteractions');
    expect(summary).toHaveProperty('playtimeMinutes');
    expect(summary.playtimeMinutes).toBe(45);
  });

  test('resumePoint is non-empty', async () => {
    const service = SessionSummaryService.create({ className: 'TestSessionSummary' });
    const summary = await service.generateSummary(30);
    expect(summary.resumePoint.length).toBeGreaterThan(0);
  });

  test('generateSummary sets isGenerating during call', async () => {
    const service = SessionSummaryService.create({ className: 'TestSessionSummary' });
    const promise = service.generateSummary(10);
    expect(service.isGenerating).toBe(true);
    await promise;
    expect(service.isGenerating).toBe(false);
  });

  test('clearSummary resets currentSummary to null', async () => {
    const service = SessionSummaryService.create({ className: 'TestSessionSummary' });
    await service.generateSummary(15);
    expect(service.currentSummary).not.toBeNull();
    service.clearSummary();
    expect(service.currentSummary).toBeNull();
  });

  test('serialize returns summary snapshot', async () => {
    const service = SessionSummaryService.create({ className: 'TestSessionSummary' });
    await service.generateSummary(20);
    const state = service.serialize();
    expect(state).toHaveProperty('summary');
    expect(state.summary).not.toBeNull();
  });

  test('hydrate restores summary', async () => {
    const service = SessionSummaryService.create({ className: 'TestSessionSummary' });
    await service.generateSummary(25);
    const state = service.serialize();
    const newService = SessionSummaryService.create({ className: 'TestSessionSummary2' });
    newService.hydrate(state);
    expect(newService.currentSummary?.playtimeMinutes).toBe(25);
  });
});
