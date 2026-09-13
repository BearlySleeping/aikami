// apps/frontend/client/src/lib/services/game/combat_encounter_roster.ts
//
// Content-pack → encounter roster projection (Combat-04).
//
// The content-pack loader lives on the MAIN thread, so this is where an
// authored encounter becomes the roster the engine spawns. It projects only
// authored facts — combatant ids, NPC ids, authored `combatStats` and class
// ids — and deliberately NOT map cells: the engine owns placement (it knows the
// terrain grid and the player's live cell) and solves any missing cell with its
// deterministic formation rule.
//
// Contract: C-516 AC-2

import type {
  CombatEncounterParticipant,
  ContentPackLoaderInterface,
} from '@aikami/frontend/engine';

/** The player slot's authored identity. */
export type EncounterPlayerBinding = {
  combatantId: string;
  classIds: readonly string[];
  /** Display name shown in the sidebar. */
  displayName?: string;
};

/** The optional companion slot's authored identity. */
export type EncounterCompanionBinding = {
  npcId: string;
  combatantId?: string;
  classIds?: readonly string[];
  displayName?: string;
};

/** Roster the engine consumes, or `undefined` when the encounter is unknown. */
export type EncounterRosterProjection = CombatEncounterParticipant[];

const DEFAULT_PLAYER_COMBATANT_ID = 'player';

/**
 * Projects an authored encounter into a combat roster.
 *
 * Returns `undefined` — never a partial roster — when the encounter is absent
 * or an enemy NPC has no `combatStats`, so a broken encounter falls back to the
 * legacy engine instead of starting a half-built v2 fight (Migration &
 * Rollback).
 */
export const buildEncounterRosterFromContentPack = (options: {
  contentPack: ContentPackLoaderInterface;
  encounterId: string;
  player: EncounterPlayerBinding;
  companion?: EncounterCompanionBinding;
}): EncounterRosterProjection | undefined => {
  const { contentPack, encounterId, player, companion } = options;
  const encounter = contentPack.getEncounter(encounterId);
  if (encounter === undefined) {
    return undefined;
  }

  const participants: CombatEncounterParticipant[] = [
    {
      combatantId: player.combatantId || DEFAULT_PLAYER_COMBATANT_ID,
      team: 'player',
      // No `stats`: the engine keeps the LIVE player entity's own
      // `CombatStats` (save/class/progression authority) and only attaches the
      // combat components.
      classIds: [...player.classIds],
      ...(player.displayName === undefined ? {} : { displayName: player.displayName }),
    },
  ];

  if (companion !== undefined) {
    const npc = contentPack.getNpc(companion.npcId);
    const stats = npc?.combatStats;
    if (stats !== undefined) {
      const displayName = companion.displayName ?? npc?.name;
      participants.push({
        combatantId: companion.combatantId ?? companion.npcId,
        team: 'ally',
        npcId: companion.npcId,
        stats: {
          hitPoints: stats.hitPoints,
          armorClass: stats.armorClass,
          attackBonus: stats.attackBonus,
          initiative: stats.initiativeBonus ?? 0,
        },
        classIds: [...(companion.classIds ?? [])],
        ...(displayName === undefined ? {} : { displayName }),
      });
    }
  }

  for (const npcId of encounter.enemyNpcIds) {
    const npc = contentPack.getNpc(npcId);
    const stats = npc?.combatStats;
    if (stats === undefined) {
      // A roster with an unauthored enemy is not a roster we may start.
      return undefined;
    }
    participants.push({
      combatantId: npcId,
      team: 'enemy',
      npcId,
      stats: {
        hitPoints: stats.hitPoints,
        armorClass: stats.armorClass,
        attackBonus: stats.attackBonus,
        initiative: stats.initiativeBonus ?? 0,
      },
      displayName: npc?.name ?? npcId,
    });
  }

  return participants;
};
