// apps/frontend/client/src/lib/services/gm/cyoa_history_injection.test.ts
//
// Unit tests for CYOA choice history injection into the GM prompt —
// AC-4: assemblePrompt includes the Recent Choices section when a
// chatId with recorded history is provided.
//
// Contract: C-245 CYOA Choices Branching Narrative

import { describe, expect, mock, test } from 'bun:test';

mock.module('../game/combat_service.svelte.ts', () => ({
  combatService: {
    enemyName: 'Unknown Enemy',
    enemyHp: 0,
    enemyMaxHp: 0,
  },
}));

mock.module('../game/time_service.svelte.ts', () => ({
  timeService: {
    gameHour: 12,
    gameMinute: 0,
    rainIntensity: 0,
  },
}));

import { CYOA_HISTORY_HEADING } from '@aikami/constants';
// gmPromptService reads choiceHistoryStore directly from its module. Import
// the same module and drive its formatHistorySection double.
import { choiceHistoryStore } from '../chat/choice_history_store.svelte.ts';
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
