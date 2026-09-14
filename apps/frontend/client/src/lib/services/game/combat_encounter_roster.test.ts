// apps/frontend/client/src/lib/services/game/combat_encounter_roster.test.ts
//
// C-525 R-5: the encounter roster builder must never put the same combatant on
// both teams. A companion that is also this encounter's hostile target is the
// enemy — not an ally — and is spawned exactly once.
//
// Contract: C-516 AC-2, C-525 R-5

import { describe, expect, test } from 'bun:test';
import type {
  ContentPackEncounterEntry,
  ContentPackLoaderInterface,
  ContentPackNpcEntry,
} from '@aikami/frontend/engine';
import {
  buildCombatPolicyFromNpc,
  buildEncounterRosterFromContentPack,
} from './combat_encounter_roster.ts';

const npc = (name: string): ContentPackNpcEntry => ({
  name,
  combatStats: {
    hitPoints: 12,
    armorClass: 11,
    attackBonus: 3,
    damage: '1d6',
    initiativeBonus: 4,
  },
});

const encounter = (enemyNpcIds: string[]): ContentPackEncounterEntry => ({
  id: 'test-encounter',
  mapId: 'test-map',
  name: 'Test Encounter',
  enemyNpcIds,
  allowNonCombatResolution: false,
  startDialogueKey: 'start',
  victoryDialogueKey: 'victory',
  loot: [],
});

const contentPack = (options: {
  encounter: ContentPackEncounterEntry;
  npcs: Record<string, ContentPackNpcEntry>;
}): ContentPackLoaderInterface =>
  ({
    getEncounter: (id: string) => (id === options.encounter.id ? options.encounter : undefined),
    getNpc: (id: string) => options.npcs[id],
  }) as unknown as ContentPackLoaderInterface;

describe('C-525 R-5: the roster never puts one combatant on both teams', () => {
  test('drops the companion slot when the companion is the hostile target', () => {
    const roster = buildEncounterRosterFromContentPack({
      contentPack: contentPack({
        encounter: encounter(['rat', 'mira']),
        npcs: { rat: npc('Rat'), mira: npc('Mira') },
      }),
      encounterId: 'test-encounter',
      player: { combatantId: 'player', classIds: ['fighter'] },
      companion: { npcId: 'mira', classIds: ['cleric'] },
    });

    expect(roster).toBeDefined();
    const ids = roster?.map((participant) => participant.combatantId) ?? [];
    // Mira is the target: exactly one enemy slot, no ally slot.
    expect(ids).toEqual(['player', 'rat', 'mira']);
    expect(roster?.filter((participant) => participant.team === 'ally')).toHaveLength(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('keeps the companion as an ally when it is not a hostile target', () => {
    const roster = buildEncounterRosterFromContentPack({
      contentPack: contentPack({
        encounter: encounter(['rat']),
        npcs: { rat: npc('Rat'), mira: npc('Mira') },
      }),
      encounterId: 'test-encounter',
      player: { combatantId: 'player', classIds: ['fighter'] },
      companion: { npcId: 'mira', classIds: ['cleric'] },
    });

    const ally = roster?.find((participant) => participant.team === 'ally');
    expect(ally?.combatantId).toBe('mira');
    expect(ally?.stats?.hitPoints).toBe(12);
  });

  test('de-duplicates the same enemy id authored twice', () => {
    const roster = buildEncounterRosterFromContentPack({
      contentPack: contentPack({
        encounter: encounter(['rat', 'rat', 'bat']),
        npcs: { rat: npc('Rat'), bat: npc('Bat') },
      }),
      encounterId: 'test-encounter',
      player: { combatantId: 'player', classIds: ['fighter'] },
    });

    const enemyIds = roster
      ?.filter((participant) => participant.team === 'enemy')
      .map((participant) => participant.combatantId);
    expect(enemyIds).toEqual(['rat', 'bat']);
  });

  test('rejects a companion whose combatant id collides with an enemy', () => {
    const roster = buildEncounterRosterFromContentPack({
      contentPack: contentPack({
        encounter: encounter(['rat']),
        npcs: { rat: npc('Rat'), mira: npc('Mira') },
      }),
      encounterId: 'test-encounter',
      player: { combatantId: 'player', classIds: ['fighter'] },
      // The ally explicitly claims the enemy's combatant id.
      companion: { npcId: 'mira', combatantId: 'rat', classIds: ['cleric'] },
    });

    expect(roster).toBeUndefined();
  });

  test('rejects an enemy whose id collides with the player', () => {
    const roster = buildEncounterRosterFromContentPack({
      contentPack: contentPack({
        encounter: encounter(['player']),
        npcs: { player: npc('Doppelganger') },
      }),
      encounterId: 'test-encounter',
      player: { combatantId: 'player', classIds: ['fighter'] },
    });

    expect(roster).toBeUndefined();
  });
});

describe('C-526 AC-6 / AC-8: the roster carries the control mode and character policy', () => {
  test('projects the persisted control mode onto the ally participant', () => {
    const roster = buildEncounterRosterFromContentPack({
      contentPack: contentPack({
        encounter: encounter(['rat']),
        npcs: { rat: npc('Rat'), mira: npc('Mira') },
      }),
      encounterId: 'test-encounter',
      player: { combatantId: 'player', classIds: ['fighter'] },
      companion: { npcId: 'mira', classIds: ['cleric'], controlMode: 'direct' },
    });
    const ally = roster?.find((entry) => entry.team === 'ally');
    expect(ally?.controlMode).toBe('direct');
  });

  test('omits the mode when the party entry never chose one', () => {
    const roster = buildEncounterRosterFromContentPack({
      contentPack: contentPack({
        encounter: encounter(['rat']),
        npcs: { rat: npc('Rat'), mira: npc('Mira') },
      }),
      encounterId: 'test-encounter',
      player: { combatantId: 'player', classIds: ['fighter'] },
      companion: { npcId: 'mira', classIds: ['cleric'] },
    });
    const ally = roster?.find((entry) => entry.team === 'ally');
    // Absent ⇒ the engine keeps the turn AI-driven, matching pre-526 saves.
    expect(ally?.controlMode).toBeUndefined();
  });

  test('projects authored personality and the lines the NPC will not cross', () => {
    const policy = buildCombatPolicyFromNpc({
      npc: {
        ...npc('Mira'),
        personality: { voice: 'clipped and formal', manner: 'unfailingly polite' },
        boundaries: ['will not strike a surrendered foe'],
        // `secrets` must never reach the model-facing snapshot.
        secrets: ['she poisoned the well'],
      },
      role: 'cleric',
      approval: -10,
    });
    expect(policy?.role).toBe('cleric');
    expect(policy?.personality).toEqual(['clipped and formal', 'unfailingly polite']);
    expect(policy?.fears).toEqual(['will not strike a surrendered foe']);
    expect(policy?.obedience).toBe('independent');
    expect(JSON.stringify(policy)).not.toContain('poisoned the well');
  });

  test('returns nothing when the pack authored no character facts', () => {
    expect(buildCombatPolicyFromNpc({ npc: npc('Rat') })).toBeUndefined();
  });
});
