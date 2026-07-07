// apps/frontend/client/src/lib/views/worldgen/gm_prompt_assembly.test.ts
//
// Unit tests for GM prompt assembly — verifies that the assembled prompt
// contains all required sections, respects length limits, and handles
// edge cases (empty inputs, special characters).
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/worldgen/gm_prompt_assembly.test.ts
//
// Contract: C-233

import { describe, expect, test } from 'bun:test';
import { worldGenSeedingService } from './world_gen_seeding_service.svelte.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_OUTPUT = {
  worldName: "Aetheria's Echo",
  worldDescription: 'A floating archipelago suspended above a sea of clouds.',
  npcs: [
    {
      name: 'Elena Vex',
      race: 'Human',
      class: 'Wizard',
      role: 'Quest Giver',
      description: 'A wise wizard with silver hair.',
      personality: 'Wise and measured.',
    },
  ],
  locations: ['Arcanum Spire', 'The Underdrift'],
  partyArcs: [
    {
      chapter: 'Chapter 1: The Blight Awakens',
      description: 'The Blight spreads.',
      objectives: ['Visit the Grove', 'Collect samples'],
      questGivers: ['Elena Vex'],
    },
  ],
  hudWidgets: [
    {
      slot: 'top-left',
      label: 'Compass',
      icon: 'compass',
      defaultVisibility: true,
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GM Prompt Assembly — C-233', () => {
  test('assembles prompt with world name and description', () => {
    const prompt = worldGenSeedingService.assembleGmPrompt({
      output: BASE_OUTPUT,
      playerGoals: 'Test goals.',
    });

    expect(prompt).toContain("World: Aetheria's Echo");
    expect(prompt).toContain('A floating archipelago');
  });

  test('includes Locations section', () => {
    const prompt = worldGenSeedingService.assembleGmPrompt({
      output: BASE_OUTPUT,
      playerGoals: 'Test goals.',
    });

    expect(prompt).toContain('## Locations');
    expect(prompt).toContain('- Arcanum Spire');
    expect(prompt).toContain('- The Underdrift');
  });

  test('includes NPC section with details', () => {
    const prompt = worldGenSeedingService.assembleGmPrompt({
      output: BASE_OUTPUT,
      playerGoals: 'Test goals.',
    });

    expect(prompt).toContain('## Key NPCs');
    expect(prompt).toContain('Elena Vex');
    expect(prompt).toContain('Human');
    expect(prompt).toContain('Wizard');
    expect(prompt).toContain('Quest Giver');
  });

  test('includes Story Arcs section with objectives', () => {
    const prompt = worldGenSeedingService.assembleGmPrompt({
      output: BASE_OUTPUT,
      playerGoals: 'Test goals.',
    });

    expect(prompt).toContain('## Story Arcs');
    expect(prompt).toContain('Chapter 1: The Blight Awakens');
    expect(prompt).toContain('- Visit the Grove');
    expect(prompt).toContain('- Collect samples');
  });

  test('includes Player Goals section', () => {
    const prompt = worldGenSeedingService.assembleGmPrompt({
      output: BASE_OUTPUT,
      playerGoals: 'Find the Heart of the Forest.',
    });

    expect(prompt).toContain('## Player Goals');
    expect(prompt).toContain('Find the Heart of the Forest.');
  });

  test('includes HUD Widgets section with visibility', () => {
    const prompt = worldGenSeedingService.assembleGmPrompt({
      output: BASE_OUTPUT,
      playerGoals: 'Test goals.',
    });

    expect(prompt).toContain('## HUD Widgets');
    expect(prompt).toContain('Compass');
    expect(prompt).toContain('top-left');
    expect(prompt).toContain('visible by default');
  });

  test('handles multiple NPCs', () => {
    const output = {
      ...BASE_OUTPUT,
      npcs: [
        ...BASE_OUTPUT.npcs,
        {
          name: 'Kael Stonebeard',
          race: 'Dwarf',
          class: 'Engineer',
          role: 'Ally',
          description: 'A gruff engineer.',
          personality: 'Blunt.',
        },
      ],
    };

    const prompt = worldGenSeedingService.assembleGmPrompt({
      output,
      playerGoals: 'Test.',
    });

    expect(prompt).toContain('Kael Stonebeard');
    expect(prompt).toContain('Dwarf');
    expect(prompt).toContain('Engineer');
  });

  test('handles multiple party arcs with objectives', () => {
    const output = {
      ...BASE_OUTPUT,
      partyArcs: [
        ...BASE_OUTPUT.partyArcs,
        {
          chapter: 'Chapter 2: The Depths',
          description: 'Descend below.',
          objectives: ['Find entrance', 'Navigate caverns', 'Defeat the guardian'],
          questGivers: ['Kael Stonebeard'],
        },
      ],
    };

    const prompt = worldGenSeedingService.assembleGmPrompt({
      output,
      playerGoals: 'Test.',
    });

    expect(prompt).toContain('Chapter 2: The Depths');
    expect(prompt).toContain('Navigate caverns');
  });

  test('handles empty NPCs gracefully', () => {
    const output = { ...BASE_OUTPUT, npcs: [] };

    const prompt = worldGenSeedingService.assembleGmPrompt({
      output,
      playerGoals: 'Test.',
    });

    expect(prompt).toContain('## Key NPCs');
    // No bullet items after the heading
    expect(prompt).not.toContain('- **'); // no NPC formatted lines
  });

  test('handles empty locations gracefully', () => {
    const output = { ...BASE_OUTPUT, locations: [] };

    const prompt = worldGenSeedingService.assembleGmPrompt({
      output,
      playerGoals: 'Test.',
    });

    expect(prompt).toContain('## Locations');
  });

  test('handles empty HUD widgets gracefully', () => {
    const output = { ...BASE_OUTPUT, hudWidgets: [] };

    const prompt = worldGenSeedingService.assembleGmPrompt({
      output,
      playerGoals: 'Test.',
    });

    expect(prompt).toContain('## HUD Widgets');
  });

  test('prompt is not excessively long for minimal input', () => {
    const output = {
      worldName: 'T',
      worldDescription: 'D.',
      npcs: [],
      locations: [],
      partyArcs: [],
      hudWidgets: [],
    };

    const prompt = worldGenSeedingService.assembleGmPrompt({
      output,
      playerGoals: 'Test.',
    });

    expect(prompt.length).toBeLessThan(500);
  });
});
