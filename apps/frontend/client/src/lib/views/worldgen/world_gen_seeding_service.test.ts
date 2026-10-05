// apps/frontend/client/src/lib/views/worldgen/world_gen_seeding_service.test.ts
//
// G01 — the legacy world-generation adapter.
//
// Two jobs here:
//
//   1. `assembleGmPrompt` is a LIVE production consumer (the combat ViewModel
//      folds a world's narrative text into the GM prompt), so its output is
//      still tested. G01 deliberately does NOT feed it: an earlier revision of
//      the draft service published an accepted draft into the live world-state
//      context, so accepting a private draft rewrote the running game's GM
//      prompt. That bridge is gone, and this suite now pins the GM prompt as
//      the UNCHANGED consumer of whatever world-seed output the game already
//      had.
//   2. The four `seed*` methods that used to write NPCs, locations, arcs and
//      HUD widgets into the running campaign are GONE. This suite pins that
//      removal, because "we deleted the dangerous method" is exactly the claim
//      that silently regresses when someone adds a convenience back.
//
// Contract: C-233 (legacy adapter), G01 (retirement of the seeding path)

import { describe, expect, test } from 'bun:test';
import type { WorldGenOutput } from '@aikami/types';
import { worldGenSeedingService } from '../../services/worldgen/world_gen_seeding_service.svelte.ts';

const OUTPUT: WorldGenOutput = {
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
  hudWidgets: [{ slot: 'top-left', label: 'Compass', icon: 'compass', defaultVisibility: true }],
};

/** Strips whole-line and block comments so prose cannot trip a code check. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('WorldGenSeedingService — G01 retirement of the seeding path', () => {
  test('the campaign-mutating seed methods no longer exist on the service', () => {
    const service = worldGenSeedingService as unknown as Record<string, unknown>;

    for (const method of ['seedNpcs', 'seedLocations', 'seedPartyArcs', 'seedHudWidgets']) {
      expect(service[method]).toBeUndefined();
    }
  });

  test('the adapter no longer imports any world-state or NPC mutator', async () => {
    const source = await Bun.file(
      new URL('../../services/worldgen/world_gen_seeding_service.svelte.ts', import.meta.url),
    ).text();
    // Comments deliberately NAME the removed mutators so the retirement is
    // documented where it happened; only executable code is scanned.
    const code = stripComments(source);

    for (const forbidden of [
      'world_state_service',
      'npc_service',
      'auth_service',
      'addNpc',
      'setVariable',
      'recordEvent',
      'createNpc',
      'subscribeToWorld',
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  test('the singleton still exposes the one method combat consumes', () => {
    expect(typeof worldGenSeedingService.assembleGmPrompt).toBe('function');
  });
});

describe('assembleGmPrompt — legacy prompt projection', () => {
  test('includes every narrative section the GM prompt needs', () => {
    const prompt = worldGenSeedingService.assembleGmPrompt({
      output: OUTPUT,
      playerGoals: 'Explore the archipelago.',
    });

    expect(prompt).toContain("Aetheria's Echo");
    expect(prompt).toContain('Arcanum Spire');
    expect(prompt).toContain('Elena Vex');
    expect(prompt).toContain('Chapter 1: The Blight Awakens');
    expect(prompt).toContain('Compass');
    expect(prompt).toContain('Explore the archipelago.');
  });
});
