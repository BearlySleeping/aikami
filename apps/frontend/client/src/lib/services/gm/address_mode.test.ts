// apps/frontend/client/src/lib/services/gm/address_mode.test.ts
//
// Unit tests for Address Mode — AC-2: mode state transitions, prompt
// scoping per mode.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json
//     src/lib/services/gm/address_mode.test.ts

import { describe, expect, mock, test } from 'bun:test';

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
    extractStructure: mock(async () => ({})),
    cancelAll: mock(() => {}),
  },
}));

import { gmPromptService } from './gm_prompt_service.svelte.ts';
import type { AddressMode } from './gm_types';

describe('Address Mode — AC-2', () => {
  const modes: AddressMode[] = ['scene', 'party', 'gm'];

  for (const mode of modes) {
    test(`${mode} mode produces a non-empty prompt`, () => {
      const prompt = gmPromptService.assemblePrompt(mode);
      expect(prompt.length).toBeGreaterThan(0);
    });
  }

  test('scene mode uses third-person omniscient instruction', () => {
    const prompt = gmPromptService.assemblePrompt('scene');
    expect(prompt).toContain('omniscient');
    expect(prompt).not.toContain('second person');
  });

  test('gm mode uses second-person instruction', () => {
    const prompt = gmPromptService.assemblePrompt('gm');
    expect(prompt).toContain('second person');
  });

  test('party mode uses group-focused instruction', () => {
    const prompt = gmPromptService.assemblePrompt('party');
    expect(prompt).toContain('collectively');
  });
});
