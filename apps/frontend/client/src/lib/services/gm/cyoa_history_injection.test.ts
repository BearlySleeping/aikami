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
// The preload stubs the whole $services barrel. gmPromptService reads
// choiceHistoryStore from that same barrel, so import it here and drive
// its formatHistorySection/getHistory doubles — the same pattern used by
// gm_prompt_service.test.ts. (Overriding the whole barrel here would leak
// into sibling test files in the same process.)
import { choiceHistoryStore } from '$services';
import { gmPromptService } from './gm_prompt_service.svelte.ts';

const RECENT_SECTION = [
  CYOA_HISTORY_HEADING,
  '- Investigate the ruins',
  '- Open the sarcophagus',
].join('\n');

describe('GmPromptService — CYOA history injection (C-245 AC-4)', () => {
  test('includes Recent Choices section when chat has history', () => {
    const chatId = 'cyoa-test-chat';
    choiceHistoryStore.formatHistorySection = mock((cid: string) =>
      cid === chatId ? RECENT_SECTION : '',
    );

    const prompt = gmPromptService.assemblePrompt({ mode: 'scene', chatId });

    expect(prompt).toContain(CYOA_HISTORY_HEADING);
    expect(prompt).toContain('- Investigate the ruins');
    expect(prompt).toContain('- Open the sarcophagus');
  });

  test('omits Recent Choices section when chat has no history', () => {
    choiceHistoryStore.formatHistorySection = mock(() => '');
    const prompt = gmPromptService.assemblePrompt({
      mode: 'scene',
      chatId: 'empty-history-chat',
    });

    expect(prompt).not.toContain(CYOA_HISTORY_HEADING);
  });

  test('omits Recent Choices section when no chatId provided', () => {
    choiceHistoryStore.formatHistorySection = mock(() => RECENT_SECTION);
    const prompt = gmPromptService.assemblePrompt({ mode: 'scene' });

    expect(prompt).not.toContain(CYOA_HISTORY_HEADING);
  });
});
