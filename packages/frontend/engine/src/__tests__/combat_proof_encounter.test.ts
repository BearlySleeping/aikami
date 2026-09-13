// packages/frontend/engine/src/__tests__/combat_proof_encounter.test.ts
//
// C-516 (Combat-04) proof-encounter content coverage.
//
//   AC-2  the content pack authors the roster the encounter start consumes
//   AC-10 the proof encounter is player + 1 companion vs 3 enemies
//
// Reads the COMMITTED Emberwatch manifest — the same file the production
// `ContentPackLoader` parses — so a content regression fails here rather than
// in a browser.
//
// Contract: C-516 AC-2, AC-10

import { describe, expect, test } from 'bun:test';
import { ContentPackEncounterEntrySchema, ContentPackNpcEntrySchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import manifestJson from '../../../../../content/packs/emberwatch/manifest.json';

type ManifestShape = {
  npcs: Record<string, unknown>;
  encounters: Record<string, unknown>;
  dialogues: Record<string, string>;
  maps: Record<string, unknown>;
};

const manifest = manifestJson as ManifestShape;

const encounter = manifest.encounters.proof_encounter as
  | {
      id: string;
      mapId: string;
      enemyNpcIds: string[];
      allowNonCombatResolution: boolean;
      startDialogueKey: string;
      victoryDialogueKey: string;
      loot: unknown[];
    }
  | undefined;

describe('C-516 AC-10: the proof encounter is authored in the content pack', () => {
  test('proof_encounter exists and passes the encounter schema', () => {
    expect(encounter).toBeDefined();
    if (encounter === undefined) {
      return;
    }
    expect(Value.Check(ContentPackEncounterEntrySchema, encounter)).toBe(true);
    expect(encounter.id).toBe('proof_encounter');
  });

  test('its complete roster is the player and authored companion versus three enemies', () => {
    const enemyNpcIds = encounter?.enemyNpcIds ?? [];
    const combatantIds = ['player', 'village_guard', ...enemyNpcIds];

    expect(combatantIds).toHaveLength(5);
    expect(combatantIds[0]).toBe('player');
    expect(combatantIds[1]).toBe('village_guard');
    expect(enemyNpcIds.length).toBe(3);
    expect(new Set(enemyNpcIds).size).toBe(3);
    expect(manifest.npcs.village_guard).toBeDefined();
    for (const npcId of enemyNpcIds) {
      expect(manifest.npcs[npcId]).toBeDefined();
    }
  });

  test('every enemy carries authored combatStats that pass the NPC schema', () => {
    for (const npcId of encounter?.enemyNpcIds ?? []) {
      const npc = manifest.npcs[npcId] as Record<string, unknown> | undefined;
      expect(npc).toBeDefined();
      if (npc === undefined) {
        continue;
      }
      expect(Value.Check(ContentPackNpcEntrySchema, npc)).toBe(true);
      const stats = npc.combatStats as Record<string, unknown> | undefined;
      expect(stats).toBeDefined();
      expect(stats?.hitPoints).toBeGreaterThan(0);
      expect(typeof stats?.armorClass).toBe('number');
      expect(typeof stats?.attackBonus).toBe('number');
      expect(typeof stats?.damage).toBe('string');
    }
  });

  test('its dialogue keys resolve in the pack', () => {
    expect(manifest.dialogues[encounter?.startDialogueKey ?? '']).toBeTruthy();
    expect(manifest.dialogues[encounter?.victoryDialogueKey ?? '']).toBeTruthy();
  });

  test('its map exists and it does not offer a non-combat exit', () => {
    expect(manifest.maps[encounter?.mapId ?? '']).toBeDefined();
    expect(encounter?.allowNonCombatResolution).toBe(false);
  });
});
