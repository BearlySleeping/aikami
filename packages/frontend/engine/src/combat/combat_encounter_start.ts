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
import {
  COMBAT_MESSAGE_KEYS,
  cellToWorldPixel,
  isCellImpassable,
  worldPixelToCell,
} from '@aikami/utils';
import type { World } from 'bitecs';
import { addComponent, addEntity, getComponent, hasComponent, query, set } from 'bitecs';
import { logger } from '$logger';
import { CombatIdentity } from '../components/combat_identity.ts';
import { CombatMovement } from '../components/combat_movement.ts';
import type { CombatStatsData } from '../components/combat_stats.ts';
import { CombatStats } from '../components/combat_stats.ts';
import { Companion } from '../components/companion.ts';
import { Enemy } from '../components/enemy.ts';
import { GridPosition } from '../components/grid_position.ts';
import { Position } from '../components/position.ts';
import { TurnOrder } from '../components/turn_order.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import { getTerrainGrid, getTerrainTileSize } from '../systems/collision_system.ts';
import { spawnEncounterEnemy } from '../systems/encounter_system.ts';
import { snapshotBattlefield } from './combat_battlefield.ts';
import { encounterStartRejection, validateEncounterRoster } from './combat_encounter_validation.ts';
import { getActiveTurn, hasCombatTurns, startCombatTurns } from './combat_turn_driver.ts';

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

/** Team a participant fights for — mirrors the kernel's `CombatTeam`. */
export type EncounterParticipantTeam = 'player' | 'ally' | 'enemy';

/**
 * Authored combat stats for one roster slot.
 *
 * Only the four fields the adapter maps (`COMBAT_STATS_FIELD_MAP`) plus the
 * movement allowance are accepted; `defense` is deliberately absent.
 */
export type EncounterParticipantStats = {
  hitPoints: number;
  armorClass: number;
  attackBonus: number;
  initiative: number;
  /** Movement cells per turn; defaults to the driver's allowance. */
  movementPerTurn?: number;
};

/** One authored combatant in an encounter roster. */
export type CombatEncounterParticipant = {
  /** Stable authored combatant id — never a runtime eid. */
  combatantId: string;
  team: EncounterParticipantTeam;
  /**
   * Authored grid cell on the battle map.
   *
   * Optional: a main-thread caller that does not know the map layout (the
   * dialogue chip authors stats, not cells) omits it and the engine places the
   * combatant with its deterministic formation rule.
   */
  cell?: { x: number; y: number };
  /**
   * Authored combat stats.
   *
   * Optional for the PLAYER slot: the engine keeps the live player entity's own
   * `CombatStats` (save/class/progression authority) and only attaches the
   * combat components. Enemy and ally slots must carry them.
   */
  stats?: EncounterParticipantStats;
  /** Content-pack NPC id (ally/enemy), used for the `Companion`/`Enemy` tags. */
  npcId?: string;
  /** Display name shown in the sidebar. */
  displayName?: string;
  /** Class ids granting this combatant its ability list. */
  classIds?: string[];
  /** Explicit ability grants; wins over `classIds` when present. */
  abilityIds?: string[];
  /**
   * Reuse this existing runtime entity instead of spawning one.
   *
   * The collision funnel derives its roster from entities the map already
   * spawned, so it must never spawn a second copy of the same enemy.
   */
  reuseEntityId?: number;
};

/** Everything the engine needs to start one encounter. */
export type CombatEncounterRoster = {
  encounterId: string;
  seed: number;
  engine: CombatEngineKind;
  /** Authored participants; a missing cell is solved by the engine. */
  participants: CombatEncounterParticipant[];
  allowNonCombatResolution?: boolean;
};

/** A participant whose grid cell is known — the only shape that may spawn. */
export type SolvedEncounterParticipant = CombatEncounterParticipant & {
  cell: { x: number; y: number };
};

/**
 * Deterministic formation used when a participant is authored without a cell.
 *
 * Expanding rings from the player's live cell, ORTHOGONAL neighbours first
 * (right, down, left, up) and diagonals after, skipping impassable, occupied
 * and already-taken cells. Preferring orthogonal contact matters: an encounter
 * that begins with everyone a diagonal apart cannot be opened with a melee
 * attack, and a fight nobody can reach stalls forever. Fully deterministic and
 * map-agnostic, so the dialogue chip can author stats without knowing layout.
 */
const FORMATION_OFFSETS: ReadonlyArray<{ x: number; y: number }> = (() => {
  const offsets: Array<{ x: number; y: number }> = [];
  for (let ring = 1; ring <= 4; ring++) {
    const ringOffsets: Array<{ x: number; y: number }> = [];
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) {
          continue;
        }
        ringOffsets.push({ x: dx, y: dy });
      }
    }
    // Orthogonal contact first: |dx| + |dy| === ring means exactly one axis is
    // at the ring distance, which is the cell an adjacent melee attacker needs.
    ringOffsets.sort((a, b) => Math.abs(a.x) + Math.abs(a.y) - (Math.abs(b.x) + Math.abs(b.y)));
    offsets.push(...ringOffsets);
  }
  return offsets;
})();

/**
 * Fills in every missing participant cell.
 *
 * Returns `null` when no free cell can be found inside the formation radius —
 * the caller then rejects the whole roster before spawning anything.
 */
export const solveParticipantCells = (options: {
  world: World;
  participants: readonly CombatEncounterParticipant[];
  playerEntityId: number;
}): SolvedEncounterParticipant[] | null => {
  const { world, participants, playerEntityId } = options;
  const playerCell = cellOf(world, playerEntityId);
  const battlefield = snapshotBattlefield(world);
  const taken = new Set<string>();
  for (const participant of participants) {
    if (participant.cell !== undefined) {
      taken.add(`${participant.cell.x}:${participant.cell.y}`);
    }
  }

  const isFree = (cell: { x: number; y: number }): boolean => {
    if (taken.has(`${cell.x}:${cell.y}`)) {
      return false;
    }
    return !isCellImpassable({ battlefield, cell });
  };

  const solved: SolvedEncounterParticipant[] = [];
  for (const participant of participants) {
    if (participant.cell !== undefined) {
      solved.push({ ...participant, cell: { ...participant.cell } });
      continue;
    }
    if (participant.team === 'player') {
      solved.push({ ...participant, cell: playerCell });
      continue;
    }
    const candidate = FORMATION_OFFSETS.map((offset) => ({
      x: playerCell.x + offset.x,
      y: playerCell.y + offset.y,
    })).find(isFree);
    if (candidate === undefined) {
      logger.warn('[combat_encounter_start] no free formation cell', {
        combatantId: participant.combatantId,
        playerCell,
      });
      return null;
    }
    taken.add(`${candidate.x}:${candidate.y}`);
    solved.push({ ...participant, cell: candidate });
  }
  return solved;
};

/** Typed rejection — the same vocabulary the preview/commit paths use. */
export type StartEncounterResult =
  | {
      ok: true;
      participantIds: number[];
      firstTurnEntityId: number;
      /** Per-combatant ability grants, keyed by combatant id. */
      abilityIdsByCombatant: Record<string, string[]>;
    }
  | { ok: false; reasonCode: CombatInvalidReason; messageKey: string };

// ---------------------------------------------------------------------------
// Per-world engine pin
// ---------------------------------------------------------------------------

const encounterEngines = new WeakMap<World, CombatEngineKind>();

/**
 * The engine kind pinned when this world's encounter started, or `undefined`
 * when no encounter is running. Callers branch on this — never on the flag.
 */
export const getEncounterEngine = (world: World): CombatEngineKind | undefined =>
  encounterEngines.get(world);

/** Clears the pinned engine choice (encounter end / test teardown). */
export const clearEncounterEngine = (world: World): void => {
  encounterEngines.delete(world);
};

// Roster validation lives in its own module (validate-before-spawn is a
// separate responsibility from materialisation); re-exported so the public
// surface and existing importers keep resolving it here.
export { encounterStartRejection, validateEncounterRoster };

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

const cellPixel = (cell: { x: number; y: number }) =>
  cellToWorldPixel({ cell, tileSize: getTerrainTileSize() });

/** Attaches the combat-2.0 components a participant needs to be previewable. */
const attachCombatComponents = (options: {
  world: World;
  entityId: number;
  combatantId: string;
  participant: SolvedEncounterParticipant;
}): void => {
  const { world, entityId, combatantId, participant } = options;

  if (!hasComponent(world, entityId, GridPosition)) {
    addComponent(world, entityId, GridPosition);
  }
  addComponent(
    world,
    entityId,
    set(GridPosition, { x: participant.cell.x, y: participant.cell.y }),
  );

  const pixel = cellPixel(participant.cell);
  if (!hasComponent(world, entityId, Position)) {
    addComponent(world, entityId, Position);
  }
  addComponent(world, entityId, set(Position, { x: pixel.x, y: pixel.y }));

  if (!hasComponent(world, entityId, CombatIdentity)) {
    addComponent(world, entityId, CombatIdentity);
  }
  addComponent(world, entityId, set(CombatIdentity, { combatantId }));

  addComponent(world, entityId, CombatMovement);
  // Only write an authored allowance: writing `0` would override the driver's
  // default and leave the combatant unable to move at all.
  const movementPerTurn = participant.stats?.movementPerTurn;
  if (movementPerTurn !== undefined) {
    addComponent(world, entityId, set(CombatMovement, { movementPerTurn }));
  }
};

/** Overwrites only the adapter-mapped `CombatStats` fields. */
const applyCombatStats = (options: {
  world: World;
  entityId: number;
  stats: EncounterParticipantStats;
}): void => {
  const { world, entityId, stats } = options;
  if (!hasComponent(world, entityId, CombatStats)) {
    addComponent(world, entityId, CombatStats);
  }
  const existing =
    (getComponent(world, entityId, CombatStats) as CombatStatsData | undefined) ??
    ({} as CombatStatsData);
  addComponent(
    world,
    entityId,
    set(CombatStats, {
      ...existing,
      health: stats.hitPoints,
      maxHealth: stats.hitPoints,
      evasion: stats.armorClass,
      accuracy: stats.attackBonus,
      initiative: stats.initiative,
    }),
  );

  if (!hasComponent(world, entityId, TurnOrder)) {
    addComponent(world, entityId, TurnOrder);
  }
  addComponent(
    world,
    entityId,
    set(TurnOrder, { currentTurn: false, initiativeValue: stats.initiative, isActive: true }),
  );
};

/**
 * Materialises one roster slot.
 *
 * The player slot reuses the live player entity (the driver keys on it), an
 * enemy slot goes through the existing content-pack spawner, and an ally slot
 * is a fresh entity tagged `Companion` so the roster classifier sees an ally
 * rather than another enemy.
 */
const spawnParticipant = (options: {
  world: World;
  playerEntityId: number;
  encounterId: string;
  participant: SolvedEncounterParticipant;
}): number => {
  const { world, playerEntityId, encounterId, participant } = options;
  const authoredStats = participant.stats;

  if (participant.reuseEntityId !== undefined && participant.team !== 'player') {
    if (authoredStats !== undefined) {
      applyCombatStats({ world, entityId: participant.reuseEntityId, stats: authoredStats });
    }
    attachCombatComponents({
      world,
      entityId: participant.reuseEntityId,
      combatantId: participant.combatantId,
      participant,
    });
    return participant.reuseEntityId;
  }

  if (participant.team === 'player') {
    if (participant.stats !== undefined) {
      applyCombatStats({ world, entityId: playerEntityId, stats: participant.stats });
    }
    attachCombatComponents({
      world,
      entityId: playerEntityId,
      combatantId: participant.combatantId,
      participant,
    });
    return playerEntityId;
  }

  const entityId =
    participant.team === 'enemy'
      ? spawnEncounterEnemy({
          world,
          data: {
            encounterId,
            npcName: participant.npcId ?? participant.combatantId,
            x: cellPixel(participant.cell).x,
            y: cellPixel(participant.cell).y,
            hitPoints: authoredStats?.hitPoints ?? 1,
            attackBonus: authoredStats?.attackBonus ?? 0,
            armorClass: authoredStats?.armorClass ?? 0,
            initiative: authoredStats?.initiative ?? 0,
          },
        })
      : addEntity(world);

  if (entityId === 0) {
    return 0;
  }

  if (participant.team === 'ally') {
    addComponent(world, entityId, Companion);
    addComponent(
      world,
      entityId,
      set(Companion, {
        npcId: participant.npcId ?? participant.combatantId,
        approval: 0,
        recruited: true,
      }),
    );
    if (authoredStats !== undefined) {
      applyCombatStats({ world, entityId, stats: authoredStats });
    }
  }

  attachCombatComponents({
    world,
    entityId,
    combatantId: participant.combatantId,
    participant,
  });
  return entityId;
};

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

  // Idempotent: a start while turns are already running changes nothing.
  if (hasCombatTurns(world)) {
    return { ok: true, participantIds: [], firstTurnEntityId: 0, abilityIdsByCombatant: {} };
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
  }

  encounterEngines.set(world, roster.engine);

  startCombatTurns(world, bridge, {
    playerEntityId,
    playerCombatantId: roster.participants.find((entry) => entry.team === 'player')?.combatantId,
    encounterId: roster.encounterId,
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

/** The grid cell an entity occupies — `GridPosition`, else its pixel position. */
const cellOf = (world: World, entityId: number): { x: number; y: number } => {
  if (hasComponent(world, entityId, GridPosition)) {
    return { x: GridPosition.x[entityId] ?? 0, y: GridPosition.y[entityId] ?? 0 };
  }
  const pixelX = Position.x[entityId] ?? 0;
  const pixelY = Position.y[entityId] ?? 0;
  return worldPixelToCell({ px: pixelX, py: pixelY, tileSize: getTerrainTileSize() });
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
  roster?: CombatEncounterParticipant[];
  allowNonCombatResolution?: boolean;
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
    return { ok: true, participantIds: [], firstTurnEntityId: 0, abilityIdsByCombatant: {} };
  }

  const engine = command.engine ?? 'legacy';
  let roster: CombatEncounterRoster | null = null;
  if (command.roster !== undefined && command.roster.length > 0) {
    roster = {
      encounterId: command.encounterId,
      seed: command.seed,
      engine,
      participants: command.roster,
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
    };
  }

  return startProductionEncounter({
    world,
    bridge,
    roster: withAbilities,
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
