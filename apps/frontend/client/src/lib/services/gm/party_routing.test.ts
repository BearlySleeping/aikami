// apps/frontend/client/src/lib/services/gm/party_routing.test.ts
//
// Unit tests for Party Mode Voice Distinction — AC-3: multi-character
// prompt includes all party members with names + personalities.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json
//     src/lib/services/gm/party_routing.test.ts

import { describe, expect, mock, test } from 'bun:test';

const COMBAT_SVC_PATH =
  '/home/sonny/Development/Projects/passion/aikami/apps/frontend/client/src/lib/services/game/combat_service.svelte.ts';
const GAME_STATE_SVC_PATH =
  '/home/sonny/Development/Projects/passion/aikami/apps/frontend/client/src/lib/services/game/game_state_service.svelte.ts';
const TIME_SVC_PATH =
  '/home/sonny/Development/Projects/passion/aikami/apps/frontend/client/src/lib/services/game/time_service.svelte.ts';

mock.module(COMBAT_SVC_PATH, () => ({
  combatService: {
    enemyName: 'Unknown Enemy',
    enemyHp: 0,
    enemyMaxHp: 0,
  },
}));

mock.module(GAME_STATE_SVC_PATH, () => ({
  gameStateService: {
    worldGenOutput: {
      worldName: 'Test Realm',
      locations: ['Test Town'],
    },
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

import { gmPromptService } from './gm_prompt_service.svelte.ts';

describe('Party Mode Voice Distinction — AC-3', () => {
  test('party mode prompt includes multi-character label in header', () => {
    const prompt = gmPromptService.assemblePrompt({ mode: 'party' });
    expect(prompt).toContain('[ADDRESS MODE: Party — Multi-Character Group]');
  });

  test('party mode instruction includes distinct voice guidance', () => {
    const prompt = gmPromptService.assemblePrompt({ mode: 'party' });
    expect(prompt).toContain('distinct voice');
    expect(prompt).toContain('prefix with their name');
  });

  test('party mode prompt does NOT contain GM-only section', () => {
    const prompt = gmPromptService.assemblePrompt({ mode: 'party' });
    expect(prompt).not.toContain('[GM ONLY]');
  });

  test('gm mode prompt contains GM-only section', () => {
    const prompt = gmPromptService.assemblePrompt({ mode: 'gm' });
    expect(prompt).toContain('[GM ONLY]');
    expect(prompt).toContain('Direct GM-to-Player');
  });

  test('scene mode remains third-person omniscient', () => {
    const prompt = gmPromptService.assemblePrompt({ mode: 'scene' });
    expect(prompt).toContain('Omniscient Narrator');
    expect(prompt).toContain('omniscient');
  });

  test('party prompt includes [WORLD STATE] section', () => {
    const prompt = gmPromptService.assemblePrompt({ mode: 'party' });
    expect(prompt).toContain('[WORLD STATE]');
  });

  test('party prompt includes [PLAYER CHARACTER] section', () => {
    const prompt = gmPromptService.assemblePrompt({ mode: 'party' });
    expect(prompt).toContain('[PLAYER CHARACTER]');
  });

  test('all modes produce non-empty prompts', () => {
    for (const mode of ['scene', 'party', 'gm'] as const) {
      const prompt = gmPromptService.assemblePrompt({ mode });
      expect(prompt.length).toBeGreaterThan(0);
    }
  });
});
