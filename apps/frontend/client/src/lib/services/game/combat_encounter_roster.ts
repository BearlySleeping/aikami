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
  CombatDecisionPolicy,
  CombatEncounterParticipant,
  ContentPackLoaderInterface,
  EncounterRosterPayload,
} from '@aikami/frontend/engine';
import type { CompanionControlMode, ContentPackNpcEntry } from '@aikami/types';
import { buildEncounterDepthFromContentPack } from './combat_encounter_depth.ts';
import { buildEncounterEnvironmentFromContentPack } from './combat_encounter_environment.ts';

/** The player slot's authored identity. */
type EncounterPlayerBinding = {
  combatantId: string;
  classIds: readonly string[];
  /** Display name shown in the sidebar. */
  displayName?: string;
  /**
   * Projected character-sheet check modifiers, keyed by registered source
   * (ability key or skill id) (C-531 AC-2). Resolved on the main thread — the
   * sheet is client state — and pinned into the encounter snapshot.
   */
  checkModifiers?: Record<string, number>;
};

/** The optional companion slot's authored identity. */
type EncounterCompanionBinding = {
  npcId: string;
  combatantId?: string;
  classIds?: readonly string[];
  displayName?: string;
  /**
   * Persisted companion control mode (C-526 §12.5).
   *
   * `'direct'` hands this companion's turn to the player; every other mode
   * keeps it AI-driven. Absent ⇒ AI-driven, matching pre-526 behaviour.
   */
  controlMode?: CompanionControlMode;
};

/**
 * Roster the engine consumes, or `undefined` when the encounter is unknown.
 *
 * Carries the authored participants AND the encounter's pinned battlefield
 * objects (C-531), so one payload describes the whole authored encounter.
 */
type EncounterRosterProjection = EncounterRosterPayload;

const DEFAULT_PLAYER_COMBATANT_ID = 'player';

/**
 * Projects the character sheet's check modifiers by registered source
 * (C-531 AC-2).
 *
 * A registered environmental check names a `modifierSource` — an ability key
 * such as `strength` or a skill id such as `athletics`. The sheet stores skill
 * DISPLAY names (`Athletics`) keyed by nothing, so the lowercase name is the
 * registry source id. The engine never substitutes an unrelated bonus, so a
 * source absent from this map refuses the check instead of rolling unmodified.
 */
export const checkModifiersFromCharacterSheet = (options: {
  skills: readonly { name: string; modifier: number }[];
  abilities: Record<string, { modifier: number }>;
}): Record<string, number> => {
  const modifiers: Record<string, number> = {};
  for (const [abilityKey, score] of Object.entries(options.abilities)) {
    modifiers[abilityKey] = score.modifier;
  }
  for (const skill of options.skills) {
    modifiers[skill.name.toLowerCase()] = skill.modifier;
  }
  return modifiers;
};

// ---------------------------------------------------------------------------
// Authored character policy (C-526 AC-8)
// ---------------------------------------------------------------------------

/**
 * Projects an NPC's authored identity into a combat decision policy.
 *
 * Only AUTHORED character facts are projected: the personality voice/manner,
 * the class label, and the lines the NPC will not cross (fears). `agenda`,
 * `knowledge` and especially `secrets` are deliberately NOT projected — the
 * decision snapshot is read by a model, so authored secrets must never travel
 * with it (`combat_2.md` §20).
 *
 * Returns `undefined` when the pack authored nothing, so the perception
 * snapshot's neutral defaults apply rather than an invented personality.
 *
 * Module-private on purpose: the roster projection is the only caller, so
 * exporting it would be an orphaned capability — a test exercises it through
 * {@link buildEncounterRosterFromContentPack}, which is how production uses it.
 */
const buildCombatPolicyFromNpc = (options: {
  npc: ContentPackNpcEntry | undefined;
  role?: string | undefined;
  /** Companion approval (-100..100); a hostile companion is less obedient. */
  approval?: number | undefined;
}): CombatDecisionPolicy | undefined => {
  const { npc } = options;
  const personality: string[] = [];
  if (npc?.personality !== undefined) {
    personality.push(npc.personality.voice, npc.personality.manner);
  }
  const fears = [...(npc?.boundaries ?? [])];
  let obedience: 'independent' | 'obedient' | undefined;
  if (options.approval !== undefined) {
    obedience = options.approval < 0 ? 'independent' : 'obedient';
  }
  if (
    personality.length === 0 &&
    fears.length === 0 &&
    options.role === undefined &&
    obedience === undefined
  ) {
    return undefined;
  }
  return {
    ...(options.role === undefined ? {} : { role: options.role }),
    // Empty arrays are OMITTED rather than sent as `[]`: "the pack authored no
    // traits" and "the pack authored an empty trait list" would otherwise look
    // identical to the decision prompt, and the neutral defaults are the honest
    // representation of the former.
    ...(personality.length === 0 ? {} : { personality }),
    ...(fears.length === 0 ? {} : { fears }),
    ...(obedience === undefined ? {} : { obedience }),
  };
};

/**
 * Projects an authored encounter into a combat roster.
 *
 * Returns `undefined` — never a partial roster — when the encounter is absent
 * or an enemy NPC has no `combatStats`, so callers can reject a broken
 * encounter instead of starting a half-built fight.
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
      // C-531 AC-2: the sheet's check modifiers ride the roster — the worker
      // cannot see the client's sheet, and an environmental check naming a
      // source the snapshot does not project is refused, not invented.
      ...(player.checkModifiers === undefined
        ? {}
        : { checkModifiers: { ...player.checkModifiers } }),
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
      // Companion identity is the party roster's npcId. Accepting a divergent
      // combatantId breaks preference and approval lookups, which are keyed by
      // that same persisted npcId throughout the client.
      const combatantId = companion.npcId;
      const existingTeam = combatantTeams.get(combatantId);
      if (existingTeam !== undefined && existingTeam !== 'ally') {
        // A genuine cross-team duplicate is a roster we may not start.
        return undefined;
      }
      if (existingTeam === undefined) {
        combatantTeams.set(combatantId, 'ally');
        const displayName = companion.displayName ?? npc?.name;
        const policy = buildCombatPolicyFromNpc({
          npc,
          role: companion.classIds?.[0] ?? npc?.companionClassId,
          approval: npc?.initialApproval,
        });
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
          ...(companion.controlMode === undefined ? {} : { controlMode: companion.controlMode }),
          ...(policy === undefined ? {} : { policy }),
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
    const enemyPolicy = buildCombatPolicyFromNpc({
      npc,
      role: npc?.companionClassId,
    });
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
      ...(enemyPolicy === undefined ? {} : { policy: enemyPolicy }),
    });
  }

  // C-531: the authored objects travel with the roster, resolved from the SAME
  // content pack on the SAME thread.
  const environmentResult = buildEncounterEnvironmentFromContentPack({ contentPack, encounterId });
  if (!environmentResult.ok) {
    return undefined;
  }
  const environment = environmentResult.environment;

  // C-532: the authored objectives, morale rules and reactions travel with the
  // roster the same way, resolved from the SAME content pack on the SAME
  // thread. An encounter that authors none keeps its pre-Combat-08 behaviour.
  const depthResult = buildEncounterDepthFromContentPack({ contentPack, encounterId });
  if (!depthResult.ok) {
    return undefined;
  }
  const depth = depthResult.depth;

  return {
    participants,
    ...(environment === undefined ? {} : { environment }),
    ...(depth === undefined ? {} : { depth }),
  };
};
