// apps/frontend/client/src/lib/views/worldgen/map_seeding.test.ts
//
// Unit tests for WorldGenSeedingService — verifies that NPC, location,
// party arc, and HUD widget seeding methods dispatch correctly without
// throwing.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/worldgen/map_seeding.test.ts
//
// Contract: C-233

import { describe, expect, test } from 'bun:test';
import { worldGenSeedingService } from './world_gen_seeding_service.svelte.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_NPCS = [
  {
    name: 'Elena Vex',
    race: 'Human',
    class: 'Wizard',
    role: 'Quest Giver',
    description: 'A wise wizard with silver hair.',
    personality: 'Wise and measured.',
  },
  {
    name: 'Kael Stonebeard',
    race: 'Dwarf',
    class: 'Engineer',
    role: 'Ally',
    description: 'A gruff engineer who maintains levitation crystals.',
    personality: 'Blunt and practical.',
  },
];

const MOCK_LOCATIONS = ['Arcanum Spire', 'The Underdrift', 'Crystalwood Grove'];

const MOCK_ARCS = [
  {
    chapter: 'Chapter 1: The Awakening',
    description: 'The party investigates the source of the Blight.',
    objectives: ['Visit the Grove', 'Collect samples'],
    questGivers: ['Elena Vex'],
  },
];

const MOCK_WIDGETS = [
  {
    slot: 'top-left',
    label: 'Compass',
    icon: 'compass',
    defaultVisibility: true,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorldGenSeedingService — C-233', () => {
  describe('seedNpcs', () => {
    test('seeds NPCs without throwing', async () => {
      await expect(worldGenSeedingService.seedNpcs({ npcs: MOCK_NPCS })).resolves.toBeUndefined();
    });

    test('handles empty NPC array', async () => {
      await expect(worldGenSeedingService.seedNpcs({ npcs: [] })).resolves.toBeUndefined();
    });

    test('handles large NPC array', async () => {
      const manyNpcs = Array.from({ length: 20 }, (_, i) => ({
        ...(MOCK_NPCS[0] as (typeof MOCK_NPCS)[0]),
        name: `NPC ${i + 1}`,
      }));
      await expect(worldGenSeedingService.seedNpcs({ npcs: manyNpcs })).resolves.toBeUndefined();
    });
  });

  describe('seedLocations', () => {
    test('seeds locations without throwing', async () => {
      await expect(
        worldGenSeedingService.seedLocations({
          locations: MOCK_LOCATIONS,
          worldName: 'Test World',
        }),
      ).resolves.toBeUndefined();
    });

    test('handles empty locations array', async () => {
      await expect(
        worldGenSeedingService.seedLocations({
          locations: [],
          worldName: 'Empty World',
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('seedPartyArcs', () => {
    test('seeds party arcs without throwing', async () => {
      await expect(
        worldGenSeedingService.seedPartyArcs({ arcs: MOCK_ARCS }),
      ).resolves.toBeUndefined();
    });

    test('handles empty arcs array', async () => {
      await expect(worldGenSeedingService.seedPartyArcs({ arcs: [] })).resolves.toBeUndefined();
    });

    test('handles multiple arcs', async () => {
      const multipleArcs = [
        ...MOCK_ARCS,
        {
          chapter: 'Chapter 2: The Underdrift',
          description: 'Descend below the clouds.',
          objectives: ['Find the entrance', 'Navigate the ruins'],
          questGivers: ['Kael Stonebeard'],
        },
      ];
      await expect(
        worldGenSeedingService.seedPartyArcs({ arcs: multipleArcs }),
      ).resolves.toBeUndefined();
    });
  });

  describe('seedHudWidgets', () => {
    test('seeds HUD widgets without throwing', async () => {
      await expect(
        worldGenSeedingService.seedHudWidgets({ widgets: MOCK_WIDGETS }),
      ).resolves.toBeUndefined();
    });

    test('handles empty widgets array', async () => {
      await expect(worldGenSeedingService.seedHudWidgets({ widgets: [] })).resolves.toBeUndefined();
    });
  });

  describe('assembleGmPrompt', () => {
    test('returns a non-empty prompt string', () => {
      const output = {
        worldName: 'Test World',
        worldDescription: 'A test world for testing.',
        npcs: MOCK_NPCS,
        locations: MOCK_LOCATIONS,
        partyArcs: MOCK_ARCS,
        hudWidgets: MOCK_WIDGETS,
      };

      const prompt = worldGenSeedingService.assembleGmPrompt({
        output,
        playerGoals: 'Test the world.',
      });

      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain('Test World');
      expect(prompt).toContain('Elena Vex');
      expect(prompt).toContain('Arcanum Spire');
      expect(prompt).toContain('Chapter 1');
      expect(prompt).toContain('Test the world.');
    });

    test('includes NPC details in prompt', () => {
      const output = {
        worldName: 'Test',
        worldDescription: 'Desc.',
        npcs: MOCK_NPCS,
        locations: ['Loc'],
        partyArcs: MOCK_ARCS,
        hudWidgets: MOCK_WIDGETS,
      };

      const prompt = worldGenSeedingService.assembleGmPrompt({
        output,
        playerGoals: 'Goals.',
      });

      expect(prompt).toContain('Kael Stonebeard');
      expect(prompt).toContain('Dwarf');
      expect(prompt).toContain('Engineer');
    });

    test('includes HUD widget blueprint info', () => {
      const output = {
        worldName: 'Test',
        worldDescription: 'Desc.',
        npcs: MOCK_NPCS,
        locations: ['Loc'],
        partyArcs: MOCK_ARCS,
        hudWidgets: MOCK_WIDGETS,
      };

      const prompt = worldGenSeedingService.assembleGmPrompt({
        output,
        playerGoals: 'Goals.',
      });

      expect(prompt).toContain('Compass');
      expect(prompt).toContain('top-left');
    });
  });
});
