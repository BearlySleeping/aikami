// apps/frontend/client/src/lib/services/gm/cyoa_history_injection.test.ts
//
// Unit tests for CYOA choice history injection into the GM prompt —
// AC-4: assemblePrompt includes the Recent Choices section when a
// chatId with recorded history is provided.
//
// Contract: C-245 CYOA Choices Branching Narrative

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

import { CYOA_HISTORY_HEADING } from '@aikami/constants';
import { choiceHistoryStore } from '$lib/services/chat/choice_history_store.svelte.ts';
import { gmPromptService } from './gm_prompt_service.svelte.ts';

describe('GmPromptService — CYOA history injection (C-245 AC-4)', () => {
  test('includes Recent Choices section when chat has history', () => {
    const chatId = 'cyoa-test-chat';
    choiceHistoryStore.recordChoice({
      chatId,
      entry: { choiceId: 'c1', label: 'Investigate the ruins', selectedAt: 1000 },
    });
    choiceHistoryStore.recordChoice({
      chatId,
      entry: { choiceId: 'c2', label: 'Open the sarcophagus', selectedAt: 2000 },
    });

    const prompt = gmPromptService.assemblePrompt({ mode: 'scene', chatId });

    expect(prompt).toContain(CYOA_HISTORY_HEADING);
    expect(prompt).toContain('- Investigate the ruins');
    expect(prompt).toContain('- Open the sarcophagus');

    choiceHistoryStore.clearHistory(chatId);
  });

  test('omits Recent Choices section when chat has no history', () => {
    const prompt = gmPromptService.assemblePrompt({
      mode: 'scene',
      chatId: 'empty-history-chat',
    });

    expect(prompt).not.toContain(CYOA_HISTORY_HEADING);
  });

  test('omits Recent Choices section when no chatId provided', () => {
    const prompt = gmPromptService.assemblePrompt({ mode: 'scene' });

    expect(prompt).not.toContain(CYOA_HISTORY_HEADING);
  });
});
