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
  ContentPackProp,
} from '@aikami/frontend/engine';
import { buildEncounterRosterFromContentPack } from './combat_encounter_roster.ts';

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
  props?: Record<string, ContentPackProp>;
}): ContentPackLoaderInterface =>
  ({
    manifest: { props: options.props ?? {} },
    getEncounter: (id: string) => (id === options.encounter.id ? options.encounter : undefined),
    getNpc: (id: string) => options.npcs[id],
  }) as unknown as ContentPackLoaderInterface;

describe('C-525 R-5: the roster never puts one combatant on both teams', () => {
  test('drops the companion slot when the companion is the hostile target', () => {
    const payload = buildEncounterRosterFromContentPack({
      contentPack: contentPack({
        encounter: encounter(['rat', 'mira']),
        npcs: { rat: npc('Rat'), mira: npc('Mira') },
      }),
      encounterId: 'test-encounter',
      player: { combatantId: 'player', classIds: ['fighter'] },
      companion: { npcId: 'mira', classIds: ['cleric'] },
    });

    expect(payload).toBeDefined();
    const ids = payload?.participants?.map((participant) => participant.combatantId) ?? [];
    // Mira is the target: exactly one enemy slot, no ally slot.
    expect(ids).toEqual(['player', 'rat', 'mira']);
    expect(
      payload?.participants?.filter((participant) => participant.team === 'ally'),
    ).toHaveLength(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('keeps the companion as an ally when it is not a hostile target', () => {
    const payload = buildEncounterRosterFromContentPack({
      contentPack: contentPack({
        encounter: encounter(['rat']),
        npcs: { rat: npc('Rat'), mira: npc('Mira') },
      }),
      encounterId: 'test-encounter',
      player: { combatantId: 'player', classIds: ['fighter'] },
      companion: { npcId: 'mira', classIds: ['cleric'] },
    });

    const ally = payload?.participants?.find((participant) => participant.team === 'ally');
    expect(ally?.combatantId).toBe('mira');
    expect(ally?.stats?.hitPoints).toBe(12);
  });

  test('de-duplicates the same enemy id authored twice', () => {
    const payload = buildEncounterRosterFromContentPack({
      contentPack: contentPack({
        encounter: encounter(['rat', 'rat', 'bat']),
        npcs: { rat: npc('Rat'), bat: npc('Bat') },
      }),
      encounterId: 'test-encounter',
      player: { combatantId: 'player', classIds: ['fighter'] },
    });

    const enemyIds = payload?.participants
      ?.filter((participant) => participant.team === 'enemy')
      .map((participant) => participant.combatantId);
    expect(enemyIds).toEqual(['rat', 'bat']);
  });

  test('uses the companion npc id even when a divergent combatant id is supplied', () => {
    const payload = buildEncounterRosterFromContentPack({
      contentPack: contentPack({
        encounter: encounter(['rat']),
        npcs: { rat: npc('Rat'), mira: npc('Mira') },
      }),
      encounterId: 'test-encounter',
      player: { combatantId: 'player', classIds: ['fighter'] },
      // A stale caller-local id must not replace the party roster identity.
      companion: { npcId: 'mira', combatantId: 'rat', classIds: ['cleric'] },
    });

    expect(
      payload?.participants?.find((participant) => participant.team === 'ally')?.combatantId,
    ).toBe('mira');
    expect(
      payload?.participants?.filter((participant) => participant.combatantId === 'rat'),
    ).toHaveLength(1);
  });

  test('rejects an enemy whose id collides with the player', () => {
    const payload = buildEncounterRosterFromContentPack({
      contentPack: contentPack({
        encounter: encounter(['player']),
        npcs: { player: npc('Doppelganger') },
      }),
      encounterId: 'test-encounter',
      player: { combatantId: 'player', classIds: ['fighter'] },
    });

    expect(payload).toBeUndefined();
  });

  test('rejects the entire roster when authored environment compilation fails', () => {
    const payload = buildEncounterRosterFromContentPack({
      contentPack: contentPack({
        encounter: {
          ...encounter(['rat']),
          environment: {
            objects: [{ objectId: 'missing-object', propId: 'missing-prop', cell: { x: 1, y: 1 } }],
          },
        },
        npcs: { rat: npc('Rat') },
      }),
      encounterId: 'test-encounter',
      player: { combatantId: 'player', classIds: ['fighter'] },
    });

    expect(payload).toBeUndefined();
  });
});

describe('C-526 AC-6 / AC-8: the roster carries the control mode and character policy', () => {
  test('projects the persisted control mode onto the ally participant', () => {
    const payload = buildEncounterRosterFromContentPack({
      contentPack: contentPack({
        encounter: encounter(['rat']),
        npcs: { rat: npc('Rat'), mira: npc('Mira') },
      }),
      encounterId: 'test-encounter',
      player: { combatantId: 'player', classIds: ['fighter'] },
      companion: { npcId: 'mira', classIds: ['cleric'], controlMode: 'direct' },
    });
    expect(payload).toBeDefined();
    const ally = payload?.participants?.find((entry) => entry.team === 'ally');
    expect(ally).toBeDefined();
    expect(ally?.controlMode).toBe('direct');
  });

  test('omits the mode when the party entry never chose one', () => {
    const payload = buildEncounterRosterFromContentPack({
      contentPack: contentPack({
        encounter: encounter(['rat']),
        npcs: { rat: npc('Rat'), mira: npc('Mira') },
      }),
      encounterId: 'test-encounter',
      player: { combatantId: 'player', classIds: ['fighter'] },
      companion: { npcId: 'mira', classIds: ['cleric'] },
    });
    expect(payload).toBeDefined();
    const ally = payload?.participants?.find((entry) => entry.team === 'ally');
    expect(ally).toBeDefined();
    // Absent ⇒ the engine keeps the turn AI-driven, matching pre-526 saves.
    expect(ally?.controlMode).toBeUndefined();
  });

  test('projects authored personality and the lines the NPC will not cross', () => {
    const payload = buildEncounterRosterFromContentPack({
      contentPack: contentPack({
        encounter: encounter(['rat']),
        npcs: {
          rat: npc('Rat'),
          mira: {
            ...npc('Mira'),
            personality: { voice: 'clipped and formal', manner: 'unfailingly polite' },
            boundaries: ['will not strike a surrendered foe'],
            // `secrets` must never reach the model-facing snapshot.
            secrets: ['she poisoned the well'],
          },
        },
      }),
      encounterId: 'test-encounter',
      player: { combatantId: 'player', classIds: ['fighter'] },
      companion: { npcId: 'mira', classIds: ['cleric'], controlMode: 'suggest' },
    });
    // Exercised through the PUBLIC projection: the policy builder is an internal
    // detail of how a roster becomes an encounter, not a capability of its own.
    expect(payload).toBeDefined();
    const ally = payload?.participants?.find((entry) => entry.team === 'ally');
    expect(ally).toBeDefined();
    expect(ally?.policy?.role).toBe('cleric');
    expect(ally?.policy?.personality).toEqual(['clipped and formal', 'unfailingly polite']);
    expect(ally?.policy?.fears).toEqual(['will not strike a surrendered foe']);
    expect(JSON.stringify(ally?.policy)).not.toContain('poisoned the well');
  });

  test('leaves the policy absent when the pack authored no character facts', () => {
    const payload = buildEncounterRosterFromContentPack({
      contentPack: contentPack({
        encounter: encounter(['rat']),
        npcs: { rat: npc('Rat'), mira: npc('Mira') },
      }),
      encounterId: 'test-encounter',
      player: { combatantId: 'player', classIds: ['fighter'] },
      companion: { npcId: 'mira', classIds: ['cleric'] },
    });
    // The class id IS an authored fact, so it survives as the role; everything
    // else stays ABSENT rather than being invented, and the perception
    // snapshot's neutral defaults apply for the parts the pack did not author.
    expect(payload).toBeDefined();
    const ally = payload?.participants?.find((entry) => entry.team === 'ally');
    expect(ally).toBeDefined();
    const policy = ally?.policy;
    expect(policy?.role).toBe('cleric');
    expect(policy?.personality).toBeUndefined();
    expect(policy?.fears).toBeUndefined();
    expect(policy?.obedience).toBeUndefined();
  });
});
