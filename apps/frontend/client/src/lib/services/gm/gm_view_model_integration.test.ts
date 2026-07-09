// apps/frontend/client/src/lib/services/gm/gm_view_model_integration.test.ts
//
// Phase 2 integration tests — verifies that ViewModels compose correctly
// with services and each other.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json
//     src/lib/services/gm/gm_view_model_integration.test.ts

import { describe, expect, mock, test } from 'bun:test';

mock.module('../game/serializable_service', () => ({
  registerSerializable: mock(() => {}),
}));

const COMBAT_SVC_PATH =
  '/home/sonny/Development/Projects/passion/aikami/apps/frontend/client/src/lib/services/game/combat_service.svelte.ts';
const GAME_STATE_SVC_PATH =
  '/home/sonny/Development/Projects/passion/aikami/apps/frontend/client/src/lib/services/game/game_state_service.svelte.ts';
const TIME_SVC_PATH =
  '/home/sonny/Development/Projects/passion/aikami/apps/frontend/client/src/lib/services/game/time_service.svelte.ts';
const TEXT_GEN_SVC_PATH =
  '/home/sonny/Development/Projects/passion/aikami/apps/frontend/client/src/lib/services/ai/text_generation_service.svelte.ts';

mock.module(COMBAT_SVC_PATH, () => ({
  combatService: {
    enemyName: 'Unknown Enemy',
    enemyHp: 0,
    enemyMaxHp: 0,
  },
}));

mock.module(GAME_STATE_SVC_PATH, () => ({
  gameStateService: {
    worldGenOutput: undefined,
    quests: [],
    characterSheetSummary: undefined,
  },
}));

mock.module(TIME_SVC_PATH, () => ({
  timeService: {
    gameHour: 12,
    gameMinute: 0,
    rainIntensity: 0,
  },
}));

mock.module(TEXT_GEN_SVC_PATH, () => ({
  textGenerationService: {
    streamChat: mock(async () => {}),
    extractStructure: mock(async () => ({
      description: 'Test scene direction.',
    })),
    cancelAll: mock(() => {}),
  },
}));

import { gmPromptService } from './gm_prompt_service.svelte.ts';
import { NarrativeDirectorService } from './narrative_director_service.svelte.ts';

describe('GM System Integration', () => {
  test('gmPromptService.assemblePrompt does not throw after NarrativeDirector start', () => {
    const nd = NarrativeDirectorService.create({ className: 'TestND' });
    nd.start(300_000);
    const prompt = gmPromptService.assemblePrompt({ mode: 'scene' });
    expect(prompt.length).toBeGreaterThan(0);
    nd.stop();
  });

  test('gmPromptService handles all address modes without error', () => {
    const modes = ['scene', 'party', 'gm'] as const;
    for (const mode of modes) {
      const prompt = gmPromptService.assemblePrompt({ mode });
      expect(prompt).toContain(
        `ADDRESS MODE: ${mode === 'scene' ? 'Scene' : mode === 'party' ? 'Party' : 'GM'}`,
      );
    }
  });

  test('gatherContext returns a well-shaped object', () => {
    const ctx = gmPromptService.gatherContext();
    expect(ctx).toHaveProperty('worldName');
    expect(ctx).toHaveProperty('timeOfDay');
    expect(ctx).toHaveProperty('weather');
    expect(ctx).toHaveProperty('playerCharacter');
    expect(typeof ctx.worldName).toBe('string');
  });

  test('gatherCombatContext returns null when not in combat', () => {
    const combatCtx = gmPromptService.gatherCombatContext();
    expect(combatCtx).toBeNull();
  });
});
