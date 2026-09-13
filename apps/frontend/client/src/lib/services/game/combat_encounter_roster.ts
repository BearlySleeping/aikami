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
type EncounterPlayerBinding = {
  combatantId: string;
  classIds: readonly string[];
  /** Display name shown in the sidebar. */
  displayName?: string;
};

/** The optional companion slot's authored identity. */
type EncounterCompanionBinding = {
  npcId: string;
  combatantId?: string;
  classIds?: readonly string[];
  displayName?: string;
};

/** Roster the engine consumes, or `undefined` when the encounter is unknown. */
type EncounterRosterProjection = CombatEncounterParticipant[];

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

  const playerCombatantId = player.combatantId || DEFAULT_PLAYER_COMBATANT_ID;
  const combatantTeams = new Map<string, 'player' | 'ally' | 'enemy'>();
  combatantTeams.set(playerCombatantId, 'player');

  const participants: CombatEncounterParticipant[] = [
    {
      combatantId: playerCombatantId,
      team: 'player',
      // No `stats`: the engine keeps the LIVE player entity's own
      // `CombatStats` (save/class/progression authority) and only attaches the
      // combat components.
      classIds: [...player.classIds],
      ...(player.displayName === undefined ? {} : { displayName: player.displayName }),
    },
  ];

  // The encounter's hostile set. A companion that is also a hostile target is
  // the fight's enemy, not an ally: it must never occupy the companion slot or
  // the same combatant would be spawned on both teams (C-525 R-5). Its single
  // spawn comes from the enemy loop below.
  const hostileNpcIds = new Set(encounter.enemyNpcIds);

  if (companion !== undefined && !hostileNpcIds.has(companion.npcId)) {
    const npc = contentPack.getNpc(companion.npcId);
    const stats = npc?.combatStats;
    if (stats !== undefined) {
      const combatantId = companion.combatantId ?? companion.npcId;
      const existingTeam = combatantTeams.get(combatantId);
      if (existingTeam !== undefined && existingTeam !== 'ally') {
        // A genuine cross-team duplicate is a roster we may not start.
        return undefined;
      }
      if (existingTeam === undefined) {
        combatantTeams.set(combatantId, 'ally');
        const displayName = companion.displayName ?? npc?.name;
        participants.push({
          combatantId,
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
  }

  for (const npcId of encounter.enemyNpcIds) {
    const existingTeam = combatantTeams.get(npcId);
    if (existingTeam === 'enemy') {
      // The same id authored twice is the same combatant, not a second one.
      continue;
    }
    if (existingTeam !== undefined) {
      // The player or an ally already owns this combatant id: a genuine
      // cross-team duplicate is a roster we may not start.
      return undefined;
    }
    const npc = contentPack.getNpc(npcId);
    const stats = npc?.combatStats;
    if (stats === undefined) {
      // A roster with an unauthored enemy is not a roster we may start.
      return undefined;
    }
    combatantTeams.set(npcId, 'enemy');
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
