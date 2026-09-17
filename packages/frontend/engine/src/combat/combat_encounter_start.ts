// packages/frontend/engine/src/combat/combat_encounter_start.ts
//
// Production encounter start (Combat-04).
//
// This is the ONE funnel both entry points converge on: the dialogue chip
// (`COMBAT_START_ENCOUNTER`) and the world-collision trigger
// (`encounter_system.ts#_triggerEncounter`) both call
// {@link startProductionEncounter}. It materialises the authored roster into
// real ECS combatants, registers the combat identity/movement components the
// v2 adapter needs, and starts the turn driver exactly once with a pinned
// engine choice.
//
// Two rules the module exists to enforce:
//   1. Validate BEFORE spawning — an incomplete roster is a typed rejection
//      with no partial spawn (no half-built encounter the player can enter).
//   2. Idempotent — a start while combat turns are already running is ignored,
//      so a double-trigger can never double-spawn the roster.
//
// The engine choice is captured here and stored per world
// ({@link getEncounterEngine}); nothing downstream re-reads the feature flag.
//
// Contract: C-516 AC-1, AC-2

import type { CombatAbilityDefinition, CombatEngineKind, CombatInvalidReason } from '@aikami/types';
import { COMBAT_MESSAGE_KEYS } from '@aikami/utils';
import type { World } from 'bitecs';
import { addComponent, getComponent, query, set } from 'bitecs';
import { logger } from '$logger';
import type { CombatStatsData } from '../components/combat_stats.ts';
import { CombatStats } from '../components/combat_stats.ts';
import { Companion } from '../components/companion.ts';
import { Enemy } from '../components/enemy.ts';
import { TurnOrder } from '../components/turn_order.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import { getTerrainGrid } from '../systems/collision_system.ts';
import type { CombatDecisionPolicy } from './combat_ai_perception.ts';
import { clearCombatCheckModifiers, setCombatCheckModifiers } from './combat_check_modifiers.ts';
import {
  clearEncounterDepth,
  type EncounterDepth,
  setEncounterDepth,
} from './combat_encounter_depth.ts';
import {
  clearEncounterEnvironment,
  type EncounterEnvironment,
  setEncounterEnvironment,
} from './combat_encounter_environment.ts';
import { cellOf, solveParticipantCells } from './combat_encounter_formation.ts';
import { spawnParticipant } from './combat_encounter_spawn.ts';
import type {
  CombatEncounterParticipant,
  CombatEncounterRoster,
  EncounterRosterPayload,
} from './combat_encounter_types.ts';
import { encounterStartRejection, validateEncounterRoster } from './combat_encounter_validation.ts';
import { getOrAllocateEncounterRunId } from './combat_run_identity.ts';
import { getActiveTurn, hasCombatTurns, startCombatTurns } from './combat_turn_driver.ts';
import { applyWorldObjectState, getWorldObjectState } from './combat_world_object_state.ts';

export type { EncounterDepth } from './combat_encounter_depth.ts';
export {
  clearEncounterDepth,
  getEncounterDepth,
  setEncounterDepth,
} from './combat_encounter_depth.ts';
export {
  clearEncounterEnvironment,
  getEncounterEnvironment,
  setEncounterEnvironment,
} from './combat_encounter_environment.ts';
// The payload shapes live in `combat_encounter_types.ts` so the formation solver
// and the spawner can share them without importing this orchestrator back.
// Re-exported here because this module is the public surface importers use.
export type {
  CombatEncounterParticipant,
  CombatEncounterRoster,
  EncounterEnvironment,
  EncounterParticipantStats,
  EncounterParticipantTeam,
  EncounterRosterPayload,
  SolvedEncounterParticipant,
} from './combat_encounter_types.ts';

/** Collects the authored character policies carried by a roster (AC-8). */
const policiesOf = (
  participants: readonly CombatEncounterParticipant[],
): Record<string, CombatDecisionPolicy> => {
  const policies: Record<string, CombatDecisionPolicy> = {};
  for (const participant of participants) {
    if (participant.policy !== undefined) {
      policies[participant.combatantId] = participant.policy;
    }
  }
  return policies;
};

/** Typed rejection — the same vocabulary the preview/commit paths use. */
export type StartEncounterResult =
  | {
      ok: true;
      participantIds: number[];
      firstTurnEntityId: number;
      /** Per-combatant ability grants, keyed by combatant id. */
      abilityIdsByCombatant: Record<string, string[]>;
      /**
       * Authored character policies, keyed by combatant id (C-526 AC-8).
       *
       * The AI coordinator consumes these so the perception snapshot the model
       * reads carries real personality/role/risk data instead of neutral
       * placeholders. Empty when the roster authored none.
       */
      policyByCombatant: Record<string, CombatDecisionPolicy>;
    }
  | { ok: false; reasonCode: CombatInvalidReason; messageKey: string };

// ---------------------------------------------------------------------------
// Per-world engine pin
// ---------------------------------------------------------------------------

const encounterEngines = new WeakMap<World, CombatEngineKind>();

/**
 * The authored roster metadata for the running encounter, keyed by combatant id
 * (review F-B). Cleared with the encounter so a finished fight's authored ids
 * never leak into the next one.
 */
const authoredParticipants = new WeakMap<World, Map<string, CombatEncounterParticipant>>();

/** The authored participant metadata for one combatant, or `null`. */
export const getAuthoredParticipant = (
  world: World,
  combatantId: string,
): CombatEncounterParticipant | null => authoredParticipants.get(world)?.get(combatantId) ?? null;

/**
 * The engine kind pinned when this world's encounter started, or `undefined`
 * when no encounter is running. Callers branch on this — never on the flag.
 */
export const getEncounterEngine = (world: World): CombatEngineKind | undefined =>
  encounterEngines.get(world);

/** Clears the pinned engine choice (encounter end / test teardown). */
export const clearEncounterEngine = (world: World): void => {
  authoredParticipants.delete(world);
  encounterEngines.delete(world);
};

// Roster validation lives in its own module (validate-before-spawn is a
// separate responsibility from materialisation); re-exported so the public
// surface and existing importers keep resolving it here.
export { encounterStartRejection, validateEncounterRoster };

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

/** The hooks the turn driver needs — supplied by the caller (the worker). */
export type StartEncounterHooks = Parameters<typeof startCombatTurns>[2]['hooks'];

export type StartProductionEncounterOptions = {
  world: World;
  bridge: EngineBridge;
  roster: CombatEncounterRoster;
  /** Runtime eid of the player entity. Defaults to the project convention (1). */
  playerEntityId?: number;
  abilityCatalog: Parameters<typeof startCombatTurns>[2]['abilityCatalog'];
  hooks: StartEncounterHooks;
  /**
   * Authored battlefield objects and their pinned definition bundle (C-531).
   *
   * Omitted by an encounter that authors none — the encounter then runs with
   * the empty environmental state, exactly as every pre-531 fight did.
   */
  environment?: EncounterEnvironment;
  /**
   * Authored Combat-08 depth — objectives, morale rules and reactions (C-532).
   * Omitted by an encounter that authors none.
   */
  depth?: EncounterDepth;
};

/**
 * Starts a production encounter: spawns the roster, pins the engine kind, and
 * runs the turn driver once.
 *
 * `COMBAT_STARTED` is emitted by the driver (`startCombatTurns`), which carries
 * the real participants and the pinned engine kind — so this function never
 * emits a duplicate start event of its own.
 */
export const startProductionEncounter = (
  options: StartProductionEncounterOptions,
): StartEncounterResult => {
  const { world, bridge, roster, abilityCatalog, hooks } = options;
  const playerEntityId = options.playerEntityId ?? 1;
  const environment = options.environment ?? roster.environment;

  // Idempotent: a start while turns are already running changes nothing.
  if (hasCombatTurns(world)) {
    return {
      ok: true,
      participantIds: [],
      firstTurnEntityId: 0,
      abilityIdsByCombatant: {},
      policyByCombatant: {},
    };
  }

  const solved = solveParticipantCells({
    world,
    participants: roster.participants,
    playerEntityId,
  });
  if (solved === null) {
    return encounterStartRejection('pathInvalid');
  }

  const terrain = getTerrainGrid();
  const invalid = validateEncounterRoster({
    roster: { ...roster, participants: solved },
    battlefieldSize:
      terrain === undefined ? undefined : { width: terrain.width, height: terrain.height },
  });
  if (invalid !== null) {
    return invalid;
  }

  const abilityIdsByCombatant: Record<string, string[]> = {};
  const policyByCombatant: Record<string, CombatDecisionPolicy> = {};
  const participantIds: number[] = [];
  for (const participant of solved) {
    const entityId = spawnParticipant({
      world,
      playerEntityId,
      encounterId: roster.encounterId,
      participant,
    });
    if (entityId === 0) {
      logger.warn('[combat_encounter_start] participant could not be spawned', {
        encounterId: roster.encounterId,
        combatantId: participant.combatantId,
      });
      return encounterStartRejection('invalidStateShape');
    }
    participantIds.push(entityId);
    if (participant.abilityIds !== undefined) {
      abilityIdsByCombatant[participant.combatantId] = [...participant.abilityIds];
    }
    if (participant.policy !== undefined) {
      policyByCombatant[participant.combatantId] = participant.policy;
    }
  }

  encounterEngines.set(world, roster.engine);

  // Review F-B: the authored participant metadata is the DURABLE half of an
  // actor binding. `Enemy.spawnId` is derived (`encounter:npcName`), so the
  // authored `npcId`/`classIds`/`controlMode` exist only on the roster — a save
  // that reconstructed bindings from the ECS alone could not re-bind them.
  authoredParticipants.set(
    world,
    new Map(solved.map((participant) => [participant.combatantId, { ...participant }])),
  );

  // Review F-B: re-apply the authored controller metadata a restored retry
  // checkpoint recorded. A Direct companion must still be player-controlled
  // after the retry — ownership is encounter state, not UI state.
  if (roster.controlByCombatant !== undefined) {
    for (const [combatantId, mode] of Object.entries(roster.controlByCombatant)) {
      const participant = solved.find((entry) => entry.combatantId === combatantId);
      if (participant === undefined || participant.team !== 'ally') {
        continue;
      }
      const index = solved.indexOf(participant);
      const entityId = participantIds[index];
      if (entityId === undefined || !Number.isInteger(entityId) || entityId <= 0) {
        continue;
      }
      addComponent(
        world,
        entityId,
        set(Companion, {
          npcId: Companion.npcId[entityId] || participant.npcId || combatantId,
          approval: Companion.approval[entityId] ?? 0,
          recruited: true,
          controlMode: mode,
        }),
      );
    }
  }

  // C-531: pin the authored objects for this encounter. Cleared when the
  // encounter ends so a finished fight's objects never leak into the next one.
  if (environment === undefined) {
    clearEncounterEnvironment(world);
  } else {
    // AC-7: a previous fight's committed object state (or a reloaded save)
    // overlays the freshly authored state, so a destroyed support is still
    // destroyed and a moved crate is still where it landed.
    const persisted = getWorldObjectState(world);
    setEncounterEnvironment(
      world,
      persisted === undefined
        ? environment
        : applyWorldObjectState({ persisted, initial: environment }),
    );
  }

  // C-532: pin the authored objectives, morale rules and reactions. Cleared
  // when the encounter authors none, so a previous fight's objectives never
  // leak into the next one.
  const depth = options.depth ?? roster.depth;
  if (depth === undefined) {
    clearEncounterDepth(world);
  } else {
    setEncounterDepth(world, depth);
  }

  // C-531 AC-2: pin the projected character-sheet check modifiers the same
  // way. Cleared with the encounter so a previous fight's sheet never leaks
  // into the next one, and an encounter that carries none starts clean.
  const checkModifiersByCombatant: Record<string, Record<string, number>> = {};
  for (const participant of roster.participants) {
    if (participant.checkModifiers !== undefined) {
      checkModifiersByCombatant[participant.combatantId] = { ...participant.checkModifiers };
    }
  }
  if (Object.keys(checkModifiersByCombatant).length === 0) {
    logger.debug('combat:checkModifiers:none', { encounterId: roster.encounterId });
    clearCombatCheckModifiers(world);
  } else {
    logger.debug('combat:checkModifiers:pinned', {
      encounterId: roster.encounterId,
      ids: Object.keys(checkModifiersByCombatant),
      playerSources: Object.keys(checkModifiersByCombatant.player ?? {}),
    });
    setCombatCheckModifiers(world, checkModifiersByCombatant);
  }

  const encounterRunId =
    roster.engine === 'v2' ? getOrAllocateEncounterRunId(world, roster.encounterId) : undefined;
  startCombatTurns(world, bridge, {
    playerEntityId,
    playerCombatantId: roster.participants.find((entry) => entry.team === 'player')?.combatantId,
    encounterId: roster.encounterId,
    ...(encounterRunId === undefined ? {} : { encounterRunId }),
    abilityCatalog,
    seed: roster.seed,
    engine: roster.engine,
    abilityIdsByCombatant,
    // C-516: the kernel drives v2 turn order, so the driver must not run the
    // legacy AI hook inside `resolveActiveTurns`.
    deferAiTurns: roster.engine === 'v2',
    hooks,
  });

  return {
    ok: true,
    participantIds,
    // `startCombatTurns` resolves the first turn synchronously, so the active
    // turn is already the encounter's opening turn here.
    firstTurnEntityId: getActiveTurn(world)?.entityId ?? 0,
    abilityIdsByCombatant,
    policyByCombatant,
  };
};

// ---------------------------------------------------------------------------
// Roster derivation from the live world (collision funnel)
// ---------------------------------------------------------------------------

/**
 * Derives the roster from entities that ALREADY exist in the world.
 *
 * The collision funnel has real entities but no authored participant list: the
 * map spawner created the enemies, the player exists and any recruited
 * companion exists. This reuses those entities (never spawns a second copy)
 * while still projecting their authored stats through
 * {@link CombatEncounterParticipant}, so both funnels start identical combats.
 *
 * @returns The derived roster, or `null` when there is nothing to fight.
 */
export const deriveEncounterRosterFromWorld = (options: {
  world: World;
  playerEntityId: number;
  encounterId: string;
  seed: number;
  engine: CombatEngineKind;
}): CombatEncounterRoster | null => {
  const { world, playerEntityId, encounterId, seed, engine } = options;
  const participants: CombatEncounterParticipant[] = [];

  const playerStats = (getComponent(world, playerEntityId, CombatStats) as
    | CombatStatsData
    | undefined) ?? {
    health: 1,
    maxHealth: 1,
    initiative: 0,
    accuracy: 0,
    evasion: 0,
  };
  participants.push({
    combatantId: 'player',
    team: 'player',
    cell: cellOf(world, playerEntityId),
    stats: {
      hitPoints: playerStats.health ?? 1,
      armorClass: playerStats.evasion ?? 0,
      attackBonus: playerStats.accuracy ?? 0,
      initiative: playerStats.initiative ?? 0,
    },
  });

  for (const eid of query(world, [CombatStats, TurnOrder])) {
    if (eid === playerEntityId || eid <= 0) {
      continue;
    }
    const isCompanion = Companion.recruited[eid] === true;
    const isEnemy = Enemy.isActive[eid] === true;
    if (!isCompanion && !isEnemy) {
      continue;
    }
    if (isEnemy && encounterId !== '' && Enemy.encounterId[eid] !== encounterId) {
      continue;
    }
    const stats = getComponent(world, eid, CombatStats) as CombatStatsData | undefined;
    if (stats === undefined) {
      continue;
    }
    const npcId = isCompanion ? Companion.npcId[eid] : Enemy.spawnId[eid];
    const enemySuffix = isEnemy ? `_${eid}` : '';
    const combatantId =
      npcId === undefined || npcId === '' ? `combatant_${eid}` : `${npcId}${enemySuffix}`;
    participants.push({
      combatantId,
      team: isCompanion ? 'ally' : 'enemy',
      cell: cellOf(world, eid),
      stats: {
        hitPoints: stats.health ?? 1,
        armorClass: stats.evasion ?? 0,
        attackBonus: stats.accuracy ?? 0,
        initiative: stats.initiative ?? 0,
      },
      ...(isCompanion ? { npcId: Companion.npcId[eid] ?? '' } : {}),
      reuseEntityId: eid,
    });
  }

  if (participants.length < 2) {
    return null;
  }
  return { encounterId, seed, engine, participants };
};

// ---------------------------------------------------------------------------
// Command entry point (both production funnels)
// ---------------------------------------------------------------------------

/** The worker-received shape of `COMBAT_START_ENCOUNTER`. */
export type StartEncounterCommand = {
  encounterId: string;
  seed: number;
  engine?: CombatEngineKind;
  /** Authored roster resolved on the main thread; omitted by the collision funnel. */
  roster?: EncounterRosterPayload;
  allowNonCombatResolution?: boolean;
  /** Authored battlefield objects and their pinned bundle (C-531). */
  environment?: EncounterEnvironment;
};

/**
 * Starts an encounter from a `COMBAT_START_ENCOUNTER` command.
 *
 * Two funnels, one start:
 *   - the dialogue chip sends an authored roster (resolved from the content
 *     pack on the main thread, which owns the pack loader);
 *   - the world-collision trigger sends no roster, so it is derived from the
 *     entities the map already spawned.
 *
 * The ability catalog is injected here (AC-3): the caller supplies the
 * resolver's hooks; a v2 start uses deferred AI hooks.
 */
export const startEncounterFromCommand = (options: {
  world: World;
  bridge: EngineBridge;
  command: StartEncounterCommand;
  playerEntityId: number;
  abilityCatalog: Record<string, CombatAbilityDefinition>;
  abilityIdsForClasses: (classIds: readonly string[]) => string[];
  hooks: StartEncounterHooks;
  /** Starts the legacy turn manager after the roster exists (legacy only). */
  startLegacy?: (world: World, bridge: EngineBridge, seed: number) => void;
}): StartEncounterResult => {
  const { world, bridge, command, playerEntityId, abilityCatalog, abilityIdsForClasses, hooks } =
    options;

  if (hasCombatTurns(world)) {
    return {
      ok: true,
      participantIds: [],
      firstTurnEntityId: 0,
      abilityIdsByCombatant: {},
      policyByCombatant: {},
    };
  }

  const engine = command.engine ?? 'legacy';
  let roster: CombatEncounterRoster | null = null;
  if (command.roster !== undefined && command.roster.participants.length > 0) {
    roster = {
      encounterId: command.encounterId,
      seed: command.seed,
      engine,
      participants: command.roster.participants,
      ...(command.roster.environment === undefined
        ? {}
        : { environment: command.roster.environment }),
      // C-532: the authored objectives/morale/reactions travel with the roster
      // and must survive the command→roster rebuild. Dropping them here pinned
      // no depth, so the objective panel had nothing to read.
      ...(command.roster.depth === undefined ? {} : { depth: command.roster.depth }),
      ...(command.allowNonCombatResolution === undefined
        ? {}
        : { allowNonCombatResolution: command.allowNonCombatResolution }),
    };
  } else {
    roster = deriveEncounterRosterFromWorld({
      world,
      playerEntityId,
      encounterId: command.encounterId,
      seed: command.seed,
      engine,
    });
  }

  if (roster === null) {
    return {
      ok: false,
      reasonCode: 'invalidStateShape',
      messageKey: COMBAT_MESSAGE_KEYS.invalidStateShape,
    };
  }

  const withAbilities: CombatEncounterRoster = {
    ...roster,
    participants: roster.participants.map((participant) => ({
      ...participant,
      abilityIds: participant.abilityIds ?? abilityIdsForClasses(participant.classIds ?? []),
    })),
  };

  if (engine === 'legacy') {
    const solvedLegacy = solveParticipantCells({
      world,
      participants: withAbilities.participants,
      playerEntityId,
    });
    if (solvedLegacy === null) {
      return {
        ok: false,
        reasonCode: 'pathInvalid',
        messageKey: COMBAT_MESSAGE_KEYS.pathInvalid,
      };
    }
    const legacyRoster: CombatEncounterRoster = { ...withAbilities, participants: solvedLegacy };
    const invalid = validateEncounterRoster({
      roster: legacyRoster,
      battlefieldSize: battlefieldSize(),
    });
    if (invalid !== null) {
      return invalid;
    }
    const participantIds: number[] = [];
    for (const participant of solvedLegacy) {
      participantIds.push(
        spawnParticipant({
          world,
          playerEntityId,
          encounterId: withAbilities.encounterId,
          participant,
        }),
      );
    }
    encounterEngines.set(world, 'legacy');
    options.startLegacy?.(world, bridge, legacyRoster.seed);
    return {
      ok: true,
      participantIds,
      firstTurnEntityId: getActiveTurn(world)?.entityId ?? 0,
      abilityIdsByCombatant: Object.fromEntries(
        legacyRoster.participants.map((participant) => [
          participant.combatantId,
          participant.abilityIds ?? [],
        ]),
      ),
      policyByCombatant: policiesOf(legacyRoster.participants),
    };
  }

  return startProductionEncounter({
    world,
    bridge,
    roster: withAbilities,
    environment: withAbilities.environment ?? command.environment,
    playerEntityId,
    abilityCatalog,
    hooks,
  });
};

/** Battle map size when a terrain grid is loaded. */
const battlefieldSize = (): { width: number; height: number } | undefined => {
  const terrain = getTerrainGrid();
  return terrain === undefined ? undefined : { width: terrain.width, height: terrain.height };
};

// ---------------------------------------------------------------------------
// Start with fallback (Migration & Rollback)
// ---------------------------------------------------------------------------

/** Outcome of a start attempt including the legacy fallback. */
export type EncounterStartOutcome = {
  /** The start result of the engine that finally ran (or the last failure). */
  started: StartEncounterResult;
  /** The engine that actually ran, or the requested one when nothing ran. */
  engine: CombatEngineKind;
  /** `true` when the requested v2 engine failed and legacy took over. */
  fellBack: boolean;
};

/**
 * Starts an encounter, falling back to the legacy engine when v2 cannot.
 *
 * Contract: "a missing catalog/roster/capability falls back to the legacy
 * engine for that encounter and logs, rather than starting a broken v2 fight"
 * (Migration & Rollback). The fallback is safe because validation and cell
 * solving run BEFORE any entity is created, so a rejected v2 attempt leaves the
 * world untouched. Legacy is never retried on itself: a failing legacy start is
 * a genuine failure and the caller surfaces the typed rejection.
 */
export const startEncounterWithFallback = (options: {
  requested: CombatEngineKind;
  attempt: (engine: CombatEngineKind) => StartEncounterResult;
}): EncounterStartOutcome => {
  const started = options.attempt(options.requested);
  if (started.ok || options.requested !== 'v2') {
    return { started, engine: options.requested, fellBack: false };
  }

  logger.warn('[combat_encounter_start] v2 start rejected — falling back to legacy', {
    reasonCode: started.reasonCode,
  });
  const fallback = options.attempt('legacy');
  if (!fallback.ok) {
    return { started: fallback, engine: options.requested, fellBack: false };
  }
  return { started: fallback, engine: 'legacy', fellBack: true };
};
