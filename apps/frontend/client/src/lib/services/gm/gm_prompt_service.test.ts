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
import type { GmPromptServiceInterface } from './gm_prompt_service.svelte.ts';

const warnMock = mock((..._args: unknown[]) => {});

class MockBaseFrontendClass {
  static create<Options, Service>(
    this: new (
      options: Options,
    ) => Service,
    options: Options,
  ): Service {
    return new this(options);
  }

  protected debug(..._args: unknown[]): void {}
  protected info(..._args: unknown[]): void {}
  protected log(..._args: unknown[]): void {}
  protected warn(...args: unknown[]): void {
    warnMock(...args);
  }
  protected error(..._args: unknown[]): void {}
}

mock.module('@aikami/frontend/services', () => ({
  // biome-ignore lint/style/useNamingConvention: mirrors the real module's exported PascalCase class name
  BaseFrontendClass: MockBaseFrontendClass,
}));

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
import { characterService, choiceHistoryStore, playerStateService } from '$services';

// We need to access the CLASS_REGISTRY mock - it's a package import,
// so we mock it at the barrel level via test_preload globals.
// For characterService, the global mock is a stub with no selectedCharacter.

let gmPromptService: GmPromptServiceInterface;

describe('GmPromptService — C-457', () => {
  beforeEach(async () => {
    const serviceModule = await import('./gm_prompt_service.svelte.ts');
    gmPromptService = serviceModule.gmPromptService;

    // Reset mocked services to baseline state
    worldStateMock.currentLocation = undefined;
    worldStateMock.quests = [];
    Object.defineProperty(characterService, 'selectedCharacter', {
      configurable: true,
      value: undefined,
      writable: true,
    });
    choiceHistoryStore.formatHistorySection = mock(() => '');
    warnMock.mockClear();

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
      const characterName = 'Seraphina';
      Object.defineProperty(characterService, 'selectedCharacter', {
        configurable: true,
        value: { name: characterName },
        writable: true,
      });

      const ctx = gmPromptService.gatherContext();

      expect(ctx.playerCharacter.name).toBe(characterName);
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
      // This optional section fits before SYSTEM INSTRUCTIONS is considered,
      // but must be dropped once the later required section is reserved.
      worldStateMock.quests = [
        {
          id: 'q-required-reservation',
          title: 'Quest that nearly fills the prompt',
          description: 'X'.repeat(5700),
          status: 'active' as const,
        },
      ];

      const prompt = gmPromptService.assemblePrompt({ mode: 'scene' });
      const byteLength = new TextEncoder().encode(prompt).length;

      // System instructions must always be present
      expect(byteLength).toBeLessThanOrEqual(6144);
      expect(prompt).toContain('[SYSTEM INSTRUCTIONS]');
      expect(prompt).toContain('You are an AI Game Master for a fantasy RPG.');
      expect(prompt).toContain('[/SYSTEM INSTRUCTIONS]');
      expect(prompt).not.toContain('Quest that nearly fills the prompt');
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
      expect(warnMock).toHaveBeenCalledWith(
        'assemblePrompt:sections-dropped',
        expect.objectContaining({
          droppedSections: expect.arrayContaining([
            expect.objectContaining({ name: 'ACTIVE QUESTS' }),
          ]),
        }),
      );
    });

    test('normal-sized prompts do not trigger warnings', () => {
      worldStateMock.quests = [];
      const prompt = gmPromptService.assemblePrompt({ mode: 'scene' });
      const encoder = new TextEncoder();
      const byteLength = encoder.encode(prompt).length;

      // Normal prompt fits comfortably under budget
      expect(byteLength).toBeLessThan(6144);
      expect(warnMock).not.toHaveBeenCalled();
    });

    test('address mode header is always present (required priority)', () => {
      const prompt = gmPromptService.assemblePrompt({ mode: 'gm' });
      expect(prompt).toContain('[ADDRESS MODE: GM');
    });

    test('CYOA history and bridge context are low priority and get dropped first', () => {
      const cyoaMarker = 'CHOSE THE MOONLIT PATH';
      const noteMarker = 'REMEMBER THE SILVER OATH';
      const influenceMarker = 'TRUST THE HOODED GUIDE';
      choiceHistoryStore.formatHistorySection = mock(
        () => `[CYOA HISTORY]\n- ${cyoaMarker}: ${'H'.repeat(1000)}`,
      );
      worldStateMock.quests = [
        {
          id: 'quest-priority',
          title: 'The Higher Priority Quest',
          description: 'C'.repeat(4800),
          status: 'active' as const,
        },
      ];

      const prompt = gmPromptService.assemblePrompt({
        mode: 'scene',
        chatId: 'chat-123',
        bridgeContext: {
          durableNotes: [`${noteMarker}: ${'N'.repeat(1000)}`],
          turnInfluences: [`${influenceMarker}: ${'I'.repeat(1000)}`],
          recentGameContext: 'The party entered the ruins.',
        },
      });
      const encoder = new TextEncoder();
      const byteLength = encoder.encode(prompt).length;

      expect(byteLength).toBeLessThanOrEqual(6144);
      expect(prompt).toContain('[ADDRESS MODE: Scene');
      expect(prompt).toContain('[WORLD STATE]');
      expect(prompt).toContain('[PLAYER CHARACTER]');
      expect(prompt).toContain('[ACTIVE QUESTS]');
      expect(prompt).toContain('[SYSTEM INSTRUCTIONS]');
      expect(prompt).not.toContain(cyoaMarker);
      expect(prompt).not.toContain(noteMarker);
      expect(prompt).not.toContain(influenceMarker);
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
