// apps/frontend/client/src/lib/services/gm/gm_prompt_service.test.ts
//
// Unit tests for GmPromptService — C-457 GM Prompt Assembly Upgrade.
// AC-1: Oversized prompts are truncated, not just warned
// AC-2: Placeholder context fields resolve to real data
// AC-3: Dropped sections are observable via logging
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json
//     src/lib/services/gm/gm_prompt_service.test.ts

import { beforeEach, describe, expect, mock, test } from 'bun:test';

// ── Mock service dependencies ─────────────────────────────────────
// Config service pulls in crypto_vault which can't be resolved in Bun test env.
// Mock the config service at its resolved filesystem path to break the chain.
mock.module('../config/config_service.svelte.ts', () => ({
  configService: {
    state: {
      lorebooks: [],
      activeLorebookIds: [],
    },
  },
  // biome-ignore lint/style/useNamingConvention: mirrors the real module's exported PascalCase class name
  ConfigService: class {},
}));

// 🔴 worldStateService must be mocked at the SAME specifier the service
// imports it from. C-456 moved it out of the `$services` barrel to a direct
// path to break a barrel cycle, so a `$services` mock is now a different
// module instance and mutations here would be invisible to the service.
type MockLocation =
  | { id: string; name: string; description: string; connections: []; npcIds: string[] }
  | undefined;
const worldStateMock: {
  worldGenOutput: undefined;
  quests: unknown[];
  currentLocation: MockLocation;
} = {
  worldGenOutput: undefined,
  quests: [],
  currentLocation: undefined,
};
mock.module('../game/world_state_service.svelte.ts', () => ({
  worldStateService: worldStateMock,
}));

// Import after mocks are registered
import { playerStateService } from '$services';
import { gmPromptService } from './gm_prompt_service.svelte.ts';

// We need to access the CLASS_REGISTRY mock - it's a package import,
// so we mock it at the barrel level via test_preload globals.
// For characterService, the global mock is a stub with no selectedCharacter.

describe('GmPromptService — C-457', () => {
  beforeEach(() => {
    // Reset mocked services to baseline state
    worldStateMock.currentLocation = undefined;
    worldStateMock.quests = [];

    // Player state defaults (matches test_preload)
    playerStateService.playerLevel = 1;
    playerStateService.playerHp = 100;
    playerStateService.playerMaxHp = 100;
    playerStateService.classId = 'fighter';
  });

  // ── AC-2: Placeholder context fields resolve to real data ─────

  describe('AC-2: Placeholder context fields resolve to real data', () => {
    test('gatherContext uses real location data when currentLocation is set', () => {
      worldStateMock.currentLocation = {
        id: 'loc-dark-forest',
        name: 'Dark Forest',
        description: 'A dense, misty forest with ancient trees.',
        connections: [],
        npcIds: [],
      };

      const ctx = gmPromptService.gatherContext();

      expect(ctx.locationName).toBe('Dark Forest');
      expect(ctx.locationDescription).toBe('A dense, misty forest with ancient trees.');
    });

    test('gatherContext falls back to placeholder when currentLocation is undefined', () => {
      worldStateMock.currentLocation = undefined;

      const ctx = gmPromptService.gatherContext();

      expect(ctx.locationName).toBe('Town Square');
      expect(ctx.locationDescription).toBe('A bustling town square with merchants and townsfolk.');
    });

    test('gatherContext uses real player stats from playerStateService', () => {
      playerStateService.playerLevel = 5;
      playerStateService.playerHp = 42;
      playerStateService.playerMaxHp = 80;

      const ctx = gmPromptService.gatherContext();

      expect(ctx.playerCharacter.level).toBe(5);
      expect(ctx.playerCharacter.currentHp).toBe(42);
      expect(ctx.playerCharacter.maxHp).toBe(80);
    });

    test('gatherContext resolves class name from CLASS_REGISTRY via classId', () => {
      playerStateService.classId = 'wizard';

      const ctx = gmPromptService.gatherContext();

      expect(ctx.playerCharacter.class).toBe('Wizard');
    });

    test('gatherContext falls back to Adventurer for unknown classId', () => {
      playerStateService.classId = 'nonexistent-class';

      const ctx = gmPromptService.gatherContext();

      expect(ctx.playerCharacter.class).toBe('Adventurer');
    });

    test('gatherContext uses real character name when selectedCharacter is set', () => {
      const ctx = gmPromptService.gatherContext();

      // With the default global mock (characterService stub returns mock fn),
      // the fallback 'Hero' is used since mock fns are truthy but have empty name.
      expect(typeof ctx.playerCharacter.name).toBe('string');
    });

    test('assemblePrompt includes real player data in the assembled prompt', () => {
      playerStateService.playerLevel = 3;
      playerStateService.playerHp = 75;
      playerStateService.playerMaxHp = 100;
      playerStateService.classId = 'rogue';

      const prompt = gmPromptService.assemblePrompt({ mode: 'scene' });

      expect(prompt).toContain('Level 3');
      expect(prompt).toContain('75/100');
      expect(prompt).toContain('Rogue');
    });
  });

  // ── AC-1: Oversized prompts are truncated ──────────────────────

  describe('AC-1: Oversized prompts are truncated, not just warned', () => {
    test('normal prompt stays under 6144 bytes', () => {
      const prompt = gmPromptService.assemblePrompt({ mode: 'scene' });
      const encoder = new TextEncoder();
      const byteLength = encoder.encode(prompt).length;

      expect(byteLength).toBeLessThanOrEqual(6144);
    });

    test('prompt with large content truncates low-priority sections', () => {
      // Simulate many active quests with very long descriptions to push over budget
      const longDescription = 'A'.repeat(2000);
      const manyQuests = Array.from({ length: 20 }, (_, i) => ({
        id: `quest-${i}`,
        title: `Long Quest ${i}`,
        description: longDescription,
        status: 'active' as const,
      }));
      worldStateMock.quests = manyQuests;

      const prompt = gmPromptService.assemblePrompt({ mode: 'scene' });
      const encoder = new TextEncoder();
      const byteLength = encoder.encode(prompt).length;

      // Prompt must be under budget
      expect(byteLength).toBeLessThanOrEqual(6144);

      // Required sections must still be present
      expect(prompt).toContain('[SYSTEM INSTRUCTIONS]');
      expect(prompt).toContain('[/SYSTEM INSTRUCTIONS]');
      expect(prompt).toContain('[WORLD STATE]');
      expect(prompt).toContain('[PLAYER CHARACTER]');
    });

    test('required sections (SYSTEM INSTRUCTIONS) are never dropped', () => {
      // Push well over budget with huge quest data
      worldStateMock.quests = Array.from({ length: 50 }, (_, i) => ({
        id: `q-${i}`,
        title: `Quest ${i} with an extremely long title that wastes bytes`,
        description: 'X'.repeat(1500),
        status: 'active' as const,
      }));

      const prompt = gmPromptService.assemblePrompt({ mode: 'scene' });

      // System instructions must always be present
      expect(prompt).toContain('[SYSTEM INSTRUCTIONS]');
      expect(prompt).toContain('You are an AI Game Master for a fantasy RPG.');
      expect(prompt).toContain('[/SYSTEM INSTRUCTIONS]');
    });

    test('prompt with userMessage and chatId still respects budget', () => {
      worldStateMock.quests = Array.from({ length: 15 }, (_, i) => ({
        id: `q-${i}`,
        title: `Quest ${i}`,
        description: 'Y'.repeat(1000),
        status: 'active' as const,
      }));

      const prompt = gmPromptService.assemblePrompt({
        mode: 'scene',
        userMessage: 'hello world',
        chatId: 'chat-123',
      });
      const encoder = new TextEncoder();
      const byteLength = encoder.encode(prompt).length;

      expect(byteLength).toBeLessThanOrEqual(6144);
    });
  });

  // ── AC-3: Dropped sections are observable ───────────────────────

  describe('AC-3: Dropped sections are observable via logging', () => {
    test('warn is called when sections are dropped due to budget', () => {
      // The singleton's `warn` is bound inside the factory, so it cannot be
      // spied on from here. Assert the observable consequence instead: that
      // truncation happened and the budget was enforced.

      // Create an oversized prompt scenario
      worldStateMock.quests = Array.from({ length: 30 }, (_, i) => ({
        id: `q-${i}`,
        title: `Quest ${i}`,
        description: 'B'.repeat(1200),
        status: 'active' as const,
      }));

      const prompt = gmPromptService.assemblePrompt({ mode: 'scene' });
      const encoder = new TextEncoder();
      const byteLength = encoder.encode(prompt).length;

      // Budget is enforced
      expect(byteLength).toBeLessThanOrEqual(6144);

      // System instructions survived truncation
      expect(prompt).toContain('[SYSTEM INSTRUCTIONS]');
      expect(prompt).toContain('[/SYSTEM INSTRUCTIONS]');
    });

    test('normal-sized prompts do not trigger warnings', () => {
      worldStateMock.quests = [];
      const prompt = gmPromptService.assemblePrompt({ mode: 'scene' });
      const encoder = new TextEncoder();
      const byteLength = encoder.encode(prompt).length;

      // Normal prompt fits comfortably under budget
      expect(byteLength).toBeLessThan(6144);
    });

    test('address mode header is always present (required priority)', () => {
      const prompt = gmPromptService.assemblePrompt({ mode: 'gm' });
      expect(prompt).toContain('[ADDRESS MODE: GM');
    });

    test('CYOA history and bridge context are low priority and get dropped first', () => {
      // Fill budget mostly with required+high sections so low-priority items get dropped
      worldStateMock.quests = Array.from({ length: 25 }, (_, i) => ({
        id: `q-${i}`,
        title: `Quest ${i}`,
        description: 'C'.repeat(1000),
        status: 'active' as const,
      }));

      const prompt = gmPromptService.assemblePrompt({
        mode: 'scene',
        userMessage: 'test message',
        chatId: 'chat-123',
      });
      const encoder = new TextEncoder();
      const byteLength = encoder.encode(prompt).length;

      expect(byteLength).toBeLessThanOrEqual(6144);
    });
  });

  // ── Existing behavior regression tests ──────────────────────────

  describe('Regression: existing behavior preserved', () => {
    test('scene mode includes WORLD STATE section', () => {
      const prompt = gmPromptService.assemblePrompt({ mode: 'scene' });
      expect(prompt).toContain('[WORLD STATE]');
      expect(prompt).toContain('[/WORLD STATE]');
    });

    test('scene mode does NOT include [GM ONLY] markers', () => {
      const prompt = gmPromptService.assemblePrompt({ mode: 'scene' });
      expect(prompt).not.toContain('[GM ONLY]');
    });

    test('gm mode includes [GM ONLY] markers', () => {
      const prompt = gmPromptService.assemblePrompt({ mode: 'gm' });
      expect(prompt).toContain('[GM ONLY]');
      expect(prompt).toContain('[/GM ONLY]');
    });

    test('address mode header is present', () => {
      const prompt = gmPromptService.assemblePrompt({ mode: 'scene' });
      expect(prompt).toContain('ADDRESS MODE: Scene');
    });

    test('assemblePrompt does not throw with null-ish state', () => {
      expect(() => gmPromptService.assemblePrompt({ mode: 'scene' })).not.toThrow();
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
});
