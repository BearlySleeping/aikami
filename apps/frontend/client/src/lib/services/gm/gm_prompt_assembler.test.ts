// apps/frontend/client/src/lib/services/gm/gm_prompt_assembler.test.ts
//
// Unit tests for GmPromptService — AC-1: all sections present, GM-only
// markers, combat conditional, <6KB, null-safe.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json
//     src/lib/services/gm/gm_prompt_assembler.test.ts

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

import { gmPromptService } from './gm_prompt_service.svelte.ts';

describe('GmPromptService — AC-1', () => {
  test('scene mode includes WORLD STATE section', () => {
    const prompt = gmPromptService.assemblePrompt('scene');
    expect(prompt).toContain('[WORLD STATE]');
    expect(prompt).toContain('[/WORLD STATE]');
  });

  test('scene mode includes SYSTEM INSTRUCTIONS section', () => {
    const prompt = gmPromptService.assemblePrompt('scene');
    expect(prompt).toContain('[SYSTEM INSTRUCTIONS]');
    expect(prompt).toContain('[/SYSTEM INSTRUCTIONS]');
  });

  test('scene mode does NOT include [GM ONLY] markers', () => {
    const prompt = gmPromptService.assemblePrompt('scene');
    expect(prompt).not.toContain('[GM ONLY]');
  });

  test('gm mode includes [GM ONLY] markers', () => {
    const prompt = gmPromptService.assemblePrompt('gm');
    expect(prompt).toContain('[GM ONLY]');
    expect(prompt).toContain('[/GM ONLY]');
  });

  test('gm mode includes direct-GM instructions', () => {
    const prompt = gmPromptService.assemblePrompt('gm');
    expect(prompt).toContain('Direct GM mode');
  });

  test('party mode does NOT include [GM ONLY] markers', () => {
    const prompt = gmPromptService.assemblePrompt('party');
    expect(prompt).not.toContain('[GM ONLY]');
  });

  test('prompt is under 6 KB (6144 bytes)', () => {
    const prompt = gmPromptService.assemblePrompt('scene');
    const encoder = new TextEncoder();
    const byteLength = encoder.encode(prompt).length;
    expect(byteLength).toBeLessThanOrEqual(6144);
  });

  test('assemblePrompt does not throw with null-ish state', () => {
    expect(() => gmPromptService.assemblePrompt('scene')).not.toThrow();
  });

  test('address mode header is present', () => {
    const scenePrompt = gmPromptService.assemblePrompt('scene');
    expect(scenePrompt).toContain('ADDRESS MODE: Scene');
  });

  test('prompt includes PLAYER CHARACTER section', () => {
    const prompt = gmPromptService.assemblePrompt('scene');
    expect(prompt).toContain('[PLAYER CHARACTER]');
  });
});
