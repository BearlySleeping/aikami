// apps/frontend/client/src/lib/services/gm/gm_prompt_party.test.ts
//
// Unit tests for GmPromptService — AC-1 (party members in prompt),
// AC-2 (nearby NPCs addressable), and party-mode section assembly.
//
// Contract: C-456 Group Chat & Systemic NPC Interactions (AC-1, AC-2)

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { GmPromptServiceInterface } from './gm_prompt_service.svelte.ts';

// ── Mocks ──────────────────────────────────────────────────────────────────

mock.module('../game/combat_service.svelte.ts', () => ({
  combatService: {
    enemyName: 'Unknown Enemy',
    enemyHp: 0,
    enemyMaxHp: 0,
  },
}));

mock.module('../game/game_state_service.svelte.ts', () => ({
  gameStateService: {
    worldGenOutput: undefined,
    quests: [],
    characterSheetSummary: undefined,
  },
}));

mock.module('../game/time_service.svelte.ts', () => ({
  timeService: {
    gameHour: 12,
    gameMinute: 0,
    rainIntensity: 0,
  },
}));

const currentLocation = {
  id: 'town_square',
  name: 'Town Square',
  description: 'A bustling town square',
  connections: [],
  npcIds: ['npc_merchant', 'npc_guard'],
};

mock.module('../game/world_state_service.svelte.ts', () => ({
  worldStateService: {
    worldGenOutput: undefined,
    quests: [],
    currentLocation,
  },
}));

mock.module('../game/party_roster_service.svelte.ts', () => ({
  partyRosterService: {
    members: [
      {
        npcId: 'lydia',
        name: 'Lydia',
        classId: 'cleric',
        level: 3,
        approval: 50,
        recruitedAt: '2026-09-01T00:00:00Z',
        personalQuestActive: false,
        equipmentSlotIds: [],
      },
      {
        npcId: 'hjorn',
        name: 'Hjorn',
        classId: 'fighter',
        level: 5,
        approval: 75,
        recruitedAt: '2026-09-01T00:00:00Z',
        personalQuestActive: false,
        equipmentSlotIds: [],
      },
    ],
    activeCount: 2,
    maxSize: 4,
    isFull: false,
    hasMember: mock(() => false),
    getMember: mock(() => undefined),
    isEmpty: mock(() => false),
  },
}));

mock.module('../npc/npc_awareness_service.svelte.ts', () => ({
  npcAwarenessService: {
    nearbyNpcIds: ['npc_merchant', 'npc_guard'],
    getNearbyNpcContext: mock(() => Promise.resolve([])),
    getNpcPersonality: mock(() => Promise.resolve('Unknown')),
    getNpcName: mock(() => Promise.resolve('Unknown')),
  },
}));

let gmPromptService: GmPromptServiceInterface;

beforeEach(async () => {
  currentLocation.npcIds = ['npc_merchant', 'npc_guard'];
  ({ gmPromptService } = await import('./gm_prompt_service.svelte.ts'));
});

describe('GmPromptService — AC-1 (Party Members in Prompt)', () => {
  test('party mode includes [PARTY MEMBERS] section with companion names', () => {
    const prompt = gmPromptService.assemblePrompt({ mode: 'party' });

    expect(prompt).toContain('[PARTY MEMBERS]');
    expect(prompt).toContain('[/PARTY MEMBERS]');
    expect(prompt).toContain('Lydia');
    expect(prompt).toContain('Hjorn');
  });

  test('scene mode does NOT include [PARTY MEMBERS] section', () => {
    const prompt = gmPromptService.assemblePrompt({ mode: 'scene' });

    expect(prompt).not.toContain('[PARTY MEMBERS]');
  });

  test('gm mode does NOT include [PARTY MEMBERS] section', () => {
    const prompt = gmPromptService.assemblePrompt({ mode: 'gm' });

    expect(prompt).not.toContain('[PARTY MEMBERS]');
  });

  test('party mode [PARTY MEMBERS] shows class and level info', () => {
    const prompt = gmPromptService.assemblePrompt({ mode: 'party' });

    // Party members should include class/level in personality field
    expect(prompt).toContain('cleric');
    expect(prompt).toContain('Level 3');
    expect(prompt).toContain('Level 5');
  });
});

describe('GmPromptService — AC-2 (Nearby NPCs)', () => {
  test('party mode includes [NEARBY NPCS] section when NPCs present', () => {
    const prompt = gmPromptService.assemblePrompt({ mode: 'party' });

    expect(prompt).toContain('[NEARBY NPCS]');
    expect(prompt).toContain('[/NEARBY NPCS]');
  });

  test('nearby NPC IDs appear in the assembled prompt', () => {
    const prompt = gmPromptService.assemblePrompt({ mode: 'party' });

    // Nearby NPCs from worldStateService.currentLocation.npcIds
    expect(prompt).toContain('npc_merchant');
    expect(prompt).toContain('npc_guard');
  });

  test('prompt is still under 6 KB with party members and nearby NPCs', () => {
    const prompt = gmPromptService.assemblePrompt({ mode: 'party' });
    const encoder = new TextEncoder();
    const byteLength = encoder.encode(prompt).length;
    expect(byteLength).toBeLessThanOrEqual(6144);
  });

  test('truncates trailing nearby NPC IDs to keep the prompt within 6 KB', () => {
    currentLocation.npcIds = Array.from(
      { length: 300 },
      (_, index) => `npc_${index}_${'x'.repeat(40)}`,
    );

    const prompt = gmPromptService.assemblePrompt({ mode: 'party' });

    expect(new TextEncoder().encode(prompt).length).toBeLessThanOrEqual(6144);
    expect(prompt).toContain(currentLocation.npcIds[0]);
    expect(prompt).not.toContain(currentLocation.npcIds.at(-1));
  });
});
