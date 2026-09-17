// packages/frontend/engine/src/combat/combat_state_adapter.ts
//
// ECS ⇄ combat-state projection adapter.
//
// This module is a PROJECTION, not a second authority. It reads the live ECS
// world into a `CombatState` for the pure kernel, and writes the kernel's
// returned state back onto the ECS components. It performs no hit, damage,
// range or legality calculation of its own — every mechanical fact comes from
// `@aikami/utils`' combat kernel.
//
// Raw bitECS entity ids never appear in a `CombatState` or a replay artifact:
// the `combatantId ↔ eid` map below is the only place an eid exists.
//
// Contract: C-509 AC-3, AC-6

import type {
  BattlefieldState,
  CombatAbilityDefinition,
  CombatantState,
  CombatEnvironmentBundle,
  CombatObjectiveState,
  CombatState,
  CombatTeam,
  CompanionControlMode,
  EnvironmentalState,
  MoraleRules,
  ObjectiveRules,
  ReactionRegistry,
  ResolveCombatResult,
} from '@aikami/types';
import { createCombatState, DEFAULT_MOVEMENT_PER_TURN } from '@aikami/utils';
import type { World } from 'bitecs';
import { query } from 'bitecs';
import { CombatIdentity } from '../components/combat_identity.ts';
import { CombatStats } from '../components/combat_stats.ts';
import { Companion } from '../components/companion.ts';
import { Enemy } from '../components/enemy.ts';
import { GridPosition } from '../components/grid_position.ts';
import { TurnOrder } from '../components/turn_order.ts';

// ---------------------------------------------------------------------------
// Explicit ECS ⇄ CombatState field mapping (AC-6)
// ---------------------------------------------------------------------------

/**
 * The documented `CombatStats` field → `CombatantState` field mapping used by
 * `snapshotCombatState` / `applyCombatResult`. The adapter invents nothing:
 * any `CombatStats` field absent from this map is deliberately unmapped.
 */
export const COMBAT_STATS_FIELD_MAP = {
  health: 'hp',
  maxHealth: 'maxHp',
  evasion: 'armorClass',
  accuracy: 'attackBonus',
  initiative: 'initiative',
} as const;

/**
 * `CombatStats` fields with no Combat-01 kernel counterpart. Recorded so a
 * later slice maps them deliberately instead of silently inventing semantics.
 *
 * `defense` in particular must NOT be folded into `armorClass` — the kernel's
 * armor class comes from `evasion`, and damage reduction is out of scope.
 */
export const UNMAPPED_COMBAT_STATS_FIELDS = [
  'attack',
  'defense',
  'xp',
  'level',
  'xpToNextLevel',
  'classId',
] as const;

// ---------------------------------------------------------------------------
// Combatant identity registry
// ---------------------------------------------------------------------------

/** Bidirectional `combatantId ↔ runtime eid` map. */
export type CombatantIdMap = {
  toEntityId(combatantId: string): number | null;
  toCombatantId(entityId: number): string | null;
};

/** A {@link CombatantIdMap} that stays in sync with the live ECS world. */
export type CombatIdentityRegistry = CombatantIdMap & {
  /** Reconciles the map with the live world, retiring stale identities. */
  sync(world: World): void;
  /** Drops every mapping (and the retired-identity set). */
  clear(): void;
  /** Combatant ids whose entity disappeared or was recycled. */
  retiredCombatantIds(): string[];
  /** Live `{ combatantId, entityId }` pairs in registration order. */
  entries(): Array<{ combatantId: string; entityId: number }>;
};

/**
 * Creates an empty registry. The adapter owns the map; nothing else should
 * hold runtime entity ids on its behalf.
 */
export const createCombatIdentityRegistry = (): CombatIdentityRegistry => {
  const idToEntity = new Map<string, number>();
  const entityToId = new Map<number, string>();
  const retired = new Set<string>();

  const sync = (world: World): void => {
    const liveEids = new Set<number>();
    const livePairs: Array<{ combatantId: string; entityId: number }> = [];

    for (const entityId of query(world, [CombatIdentity])) {
      const combatantId = CombatIdentity.combatantId[entityId];
      if (combatantId === undefined || combatantId === '') {
        continue;
      }
      liveEids.add(entityId);
      livePairs.push({ combatantId, entityId });
    }

    // A despawned entity retires its combatant id — ids are never reused.
    for (const [combatantId, entityId] of [...idToEntity]) {
      if (!liveEids.has(entityId)) {
        idToEntity.delete(combatantId);
        entityToId.delete(entityId);
        retired.add(combatantId);
      }
    }

    // A recycled eid that now carries a different combatant retires the old id.
    for (const [combatantId, entityId] of [...idToEntity]) {
      if (CombatIdentity.combatantId[entityId] !== combatantId) {
        idToEntity.delete(combatantId);
        entityToId.delete(entityId);
        retired.add(combatantId);
      }
    }

    for (const { combatantId, entityId } of livePairs) {
      if (retired.has(combatantId)) {
        continue;
      }
      const mappedEntityId = idToEntity.get(combatantId);
      if (mappedEntityId !== undefined && mappedEntityId !== entityId) {
        idToEntity.delete(combatantId);
        entityToId.delete(mappedEntityId);
        retired.add(combatantId);
        continue;
      }
      const existing = entityToId.get(entityId);
      if (existing !== undefined && existing !== combatantId) {
        entityToId.delete(entityId);
        idToEntity.delete(existing);
        retired.add(existing);
      }
      idToEntity.set(combatantId, entityId);
      entityToId.set(entityId, combatantId);
    }
  };

  return {
    toEntityId: (combatantId) => idToEntity.get(combatantId) ?? null,
    toCombatantId: (entityId) => entityToId.get(entityId) ?? null,
    sync,
    clear: () => {
      idToEntity.clear();
      entityToId.clear();
      retired.clear();
    },
    retiredCombatantIds: () => [...retired],
    entries: () => [...idToEntity].map(([combatantId, entityId]) => ({ combatantId, entityId })),
  };
};

const registries = new WeakMap<World, CombatIdentityRegistry>();

/** Returns (creating on first use) the identity registry for a world. */
export const getCombatIdentityRegistry = (world: World): CombatIdentityRegistry => {
  const existing = registries.get(world);
  if (existing !== undefined) {
    return existing;
  }
  const created = createCombatIdentityRegistry();
  registries.set(world, created);
  return created;
};

// ---------------------------------------------------------------------------
// Combatant id derivation (AC-3, Open Question Q1)
// ---------------------------------------------------------------------------

export type DeriveCombatantIdOptions = {
  entityId: number;
  /** Authored content-pack encounter id — the minting namespace fallback. */
  encounterId: string;
  /** Caller-supplied campaign character id for the player entity. */
  playerCombatantId: string;
  /** Runtime eid of the player entity, when the world knows it. */
  playerEntityId?: number | null;
  /** Deterministic index used only when the entity has no authored id. */
  spawnIndex: number;
};

/**
 * Derives a stable combatant id from the entity's authored ids:
 * `Enemy.spawnId` → `Enemy.encounterId` → `Companion.npcId` →
 * `<encounterId>:<spawnIndex>`, with the player entity resolving to the
 * caller-supplied campaign character id. Never derives from an eid.
 */
export const deriveCombatantId = (options: DeriveCombatantIdOptions): string => {
  if (
    options.playerEntityId !== undefined &&
    options.playerEntityId !== null &&
    options.entityId === options.playerEntityId
  ) {
    return options.playerCombatantId;
  }

  const spawnId = Enemy.spawnId[options.entityId];
  if (spawnId !== undefined && spawnId !== '') {
    return spawnId;
  }
  const encounterId = Enemy.encounterId[options.entityId];
  if (encounterId !== undefined && encounterId !== '') {
    return encounterId;
  }
  const npcId = Companion.npcId[options.entityId];
  if (npcId !== undefined && npcId !== '') {
    return npcId;
  }
  return `${options.encounterId}:${options.spawnIndex}`;
};

/**
 * Derives and writes the `CombatIdentity` component for an entity.
 *
 * @returns The resolved `combatantId`.
 */
export const registerCombatantIdentity = (options: DeriveCombatantIdOptions): string => {
  const combatantId = deriveCombatantId(options);
  CombatIdentity.combatantId[options.entityId] = combatantId;
  return combatantId;
};

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export type CombatSnapshotOptions = {
  encounterId: string;
  rulesVersion: string;
  seed: number;
  /**
   * Execution identity allocated OUTSIDE the kernel (C-532). Absent derives the
   * deterministic `(encounterId, seed)` id for pure fixtures; production always
   * supplies one so a deterministic retry gets a distinct run.
   */
  encounterRunId?: string;
  abilityCatalog: Record<string, CombatAbilityDefinition>;
  battlefield: BattlefieldState;
  /** Caller-supplied campaign character id for the player combatant. */
  playerCombatantId: string;
  /** Runtime eid of the player entity, when the world knows it. */
  playerEntityId?: number | null;
  objectives?: CombatObjectiveState[];
  /**
   * Pinned authored Combat-08 depth. Absent means the empty rules — a fight
   * with no objectives, no morale triggers and no reactions.
   * Contract: C-532 AC-1, AC-2, AC-3.
   */
  objectiveRules?: ObjectiveRules;
  moraleRules?: MoraleRules;
  reactionRegistry?: ReactionRegistry;
  /**
   * Live authored-object and surface state projected into the snapshot.
   * Absent means the empty state (a fight with no environmental mechanics).
   * Contract: C-531 AC-1.
   */
  environment?: EnvironmentalState;
  /**
   * The pinned environmental definition bundle. Absent means the empty bundle.
   * Replay reads this bundle — never the latest mutable content pack.
   * Contract: C-531 AC-1, AC-7.
   */
  environmentBundle?: CombatEnvironmentBundle;
  /** Per-combatant ability ids; defaults to every catalog ability id. */
  abilityIdsByCombatant?: Record<string, string[]>;
  /**
   * Per-combatant projected character-sheet check modifiers, keyed by
   * registered source (ability key or skill id). A combatant with no entry
   * carries none, so an environmental check that names a missing source is
   * rejected rather than silently unmodified. Contract: C-531 AC-2.
   */
  checkModifiersByCombatant?: Record<string, Record<string, number>>;
  /** Display-name resolution (e.g. the C-195 string registry). */
  resolveName?: (entityId: number, combatantId: string) => string | undefined;
  /** Turn movement allowance; defaults to the kernel's Combat-01 default. */
  movementPerTurn?: number;
  /** Registry override — primarily for tests. */
  registry?: CombatIdentityRegistry;
};

const resolveTeam = (
  entityId: number,
  combatantId: string,
  options: CombatSnapshotOptions,
): CombatTeam => {
  if (
    options.playerEntityId !== undefined &&
    options.playerEntityId !== null &&
    entityId === options.playerEntityId
  ) {
    return 'player';
  }
  if (combatantId === options.playerCombatantId) {
    return 'player';
  }
  const spawnId = Enemy.spawnId[entityId];
  if (Enemy.isActive[entityId] === true || (spawnId !== undefined && spawnId !== '')) {
    return 'enemy';
  }
  const npcId = Companion.npcId[entityId];
  if (npcId !== undefined && npcId !== '') {
    return 'ally';
  }
  return 'neutral';
};

const isCompanionControlMode = (value: string | undefined): value is CompanionControlMode =>
  value === 'direct' || value === 'suggest' || value === 'intent' || value === 'autonomous';

/**
 * Projects the live ECS world into a versioned `CombatState`.
 *
 * Reads raw SoA arrays (never `onGet` observers) so capture has no side
 * effects. `CombatStats` fields map exactly per {@link COMBAT_STATS_FIELD_MAP}.
 */
export const snapshotCombatState = (world: World, options: CombatSnapshotOptions): CombatState => {
  const registry = options.registry ?? getCombatIdentityRegistry(world);
  registry.sync(world);

  const catalogAbilityIds = Object.keys(options.abilityCatalog);
  const movementPerTurn = options.movementPerTurn ?? DEFAULT_MOVEMENT_PER_TURN;

  const combatants: CombatantState[] = registry.entries().map(({ combatantId, entityId }) => {
    const hp = CombatStats.health[entityId] ?? 0;
    const maxHp = CombatStats.maxHealth[entityId] ?? 0;
    const defeated = hp <= 0;
    const resolvedName = options.resolveName?.(entityId, combatantId);
    const controlMode = Companion.controlMode[entityId];
    return {
      combatantId,
      name: resolvedName !== undefined && resolvedName !== '' ? resolvedName : combatantId,
      team: resolveTeam(entityId, combatantId, options),
      ...(Companion.recruited[entityId] === true && isCompanionControlMode(controlMode)
        ? { controlMode }
        : {}),
      position: {
        x: GridPosition.x[entityId] ?? 0,
        y: GridPosition.y[entityId] ?? 0,
      },
      hp,
      maxHp: Math.max(1, maxHp),
      armorClass: CombatStats.evasion[entityId] ?? 0,
      attackBonus: CombatStats.accuracy[entityId] ?? 0,
      initiative: CombatStats.initiative[entityId] ?? 0,
      abilityIds: [...(options.abilityIdsByCombatant?.[combatantId] ?? catalogAbilityIds)],
      budget: {
        movementRemaining: movementPerTurn,
        actionAvailable: true,
        quickActionAvailable: true,
        reactionAvailable: true,
      },
      downed: defeated,
      defeated,
      ...(options.checkModifiersByCombatant?.[combatantId] === undefined
        ? {}
        : { checkModifiers: { ...options.checkModifiersByCombatant[combatantId] } }),
    };
  });

  return createCombatState({
    encounterId: options.encounterId,
    rulesVersion: options.rulesVersion,
    seed: options.seed,
    ...(options.encounterRunId === undefined ? {} : { encounterRunId: options.encounterRunId }),
    combatants,
    abilityCatalog: options.abilityCatalog,
    battlefield: options.battlefield,
    objectives: options.objectives ?? [],
    ...(options.objectiveRules === undefined ? {} : { objectiveRules: options.objectiveRules }),
    ...(options.moraleRules === undefined ? {} : { moraleRules: options.moraleRules }),
    ...(options.reactionRegistry === undefined
      ? {}
      : { reactionRegistry: options.reactionRegistry }),
    ...(options.environment === undefined ? {} : { environment: options.environment }),
    ...(options.environmentBundle === undefined
      ? {}
      : { environmentBundle: options.environmentBundle }),
  });
};

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/**
 * Per-world record of the authoritative revision already projected onto the ECS
 * for each encounter.
 *
 * The guard is the *only* thing that decides whether a resolved kernel result
 * may touch the world. It is seeded at the lifecycle boundaries where an
 * authoritative state is installed (encounter start, checkpoint restore, retry)
 * with {@link installCombatProjection}, and advanced by exactly one for each
 * accepted application.
 *
 * Absence means "nothing has been projected for this encounter yet", which is
 * the correct expectation for a fresh encounter at revision 0. It is NOT a
 * licence to skip the check: a restore at revision N installs N, so the next
 * command cannot silently no-op against a guard stuck at 0.
 */
const projectedRevisions = new WeakMap<World, Map<string, number>>();

const projectionMap = (world: World, create: boolean): Map<string, number> | undefined => {
  const existing = projectedRevisions.get(world);
  if (existing !== undefined) {
    return existing;
  }
  if (!create) {
    return undefined;
  }
  const created = new Map<string, number>();
  projectedRevisions.set(world, created);
  return created;
};

/** The revision currently projected onto the ECS for one encounter. */
export const getProjectedCombatRevision = (world: World, encounterId: string): number | null =>
  projectionMap(world, false)?.get(encounterId) ?? null;

/**
 * Installs (or re-seeds) the apply guard from an authoritative state.
 *
 * MUST be called wherever an authoritative `CombatState` is installed outside
 * the ordinary commit path — encounter start, `COMBAT_CHECKPOINT_RESTORED`,
 * retry, or any test that seeds a live fight at a non-zero revision. Without it
 * the guard keeps expecting the previous revision and the first command after
 * the install is silently dropped while the resolver still publishes revision
 * `N+1`.
 */
export const installCombatProjection = (world: World, state: CombatState): void => {
  projectionMap(world, true)?.set(state.encounterId, state.stateRevision);
};

/** Why a resolved kernel result was not projected onto the ECS world. */
export type CombatApplicationRejection =
  /** `result.valid === false` — the kernel rejected the command. */
  | 'invalidResult'
  /** The result belongs to a different encounter than the previous state. */
  | 'encounterMismatch'
  /** The caller's `previousState` is not the revision the ECS currently holds. */
  | 'revisionMismatch'
  /** The result does not advance the previous revision by exactly one. */
  | 'revisionGap';

/**
 * The outcome of {@link applyCombatResult}.
 *
 * - `accepted`  — the ECS now holds the result's state.
 * - `duplicate` — this exact revision (or an older one) was already projected;
 *                 the world is unchanged and the caller must not re-publish.
 * - `rejected`  — the result must not touch the world, and the caller must not
 *                 publish events, spend resources, schedule AI, open reactions
 *                 or settle the encounter.
 */
export type CombatApplicationResult =
  | { status: 'accepted'; encounterId: string; stateRevision: number }
  | { status: 'duplicate'; encounterId: string; stateRevision: number }
  | {
      status: 'rejected';
      reason: CombatApplicationRejection;
      encounterId: string;
      /** Revision the ECS expected, or `null` when none was installed. */
      projectedRevision: number | null;
      previousStateRevision: number;
      resultRevision: number;
    };

/**
 * Projects a resolved kernel result back onto the live ECS world.
 *
 * - A rejected kernel result (`result.valid === false`) never touches the world.
 * - Revision-guarded: only the result that advances the projected revision by
 *   exactly one is applied. Re-projecting an already-projected revision is a
 *   typed `duplicate`.
 * - A guard mismatch is a typed `rejected` — it is never a silent no-op. The
 *   caller MUST NOT continue as if application succeeded.
 * - Applies only the kernel's own state — no diff is re-derived here.
 */
export const applyCombatResult = (
  world: World,
  previousState: CombatState,
  result: ResolveCombatResult,
): CombatApplicationResult => {
  const encounterId = result.valid ? result.state.encounterId : previousState.encounterId;
  const resultRevision = result.valid ? result.state.stateRevision : previousState.stateRevision;

  if (!result.valid) {
    return {
      status: 'rejected',
      reason: 'invalidResult',
      encounterId,
      projectedRevision: getProjectedCombatRevision(world, encounterId),
      previousStateRevision: previousState.stateRevision,
      resultRevision,
    };
  }
  if (previousState.encounterId !== result.state.encounterId) {
    return {
      status: 'rejected',
      reason: 'encounterMismatch',
      encounterId,
      projectedRevision: getProjectedCombatRevision(world, encounterId),
      previousStateRevision: previousState.stateRevision,
      resultRevision,
    };
  }

  const projectedRevision = getProjectedCombatRevision(world, result.state.encounterId);
  // Absence is revision 0: a fresh encounter has projected nothing yet.
  const expectedPreviousRevision = projectedRevision ?? 0;

  // Already projected at this (or a later) revision — idempotent, not an error.
  if (result.state.stateRevision <= expectedPreviousRevision) {
    return {
      status: 'duplicate',
      encounterId: result.state.encounterId,
      stateRevision: result.state.stateRevision,
    };
  }
  if (previousState.stateRevision !== expectedPreviousRevision) {
    return {
      status: 'rejected',
      reason: 'revisionMismatch',
      encounterId: result.state.encounterId,
      projectedRevision,
      previousStateRevision: previousState.stateRevision,
      resultRevision: result.state.stateRevision,
    };
  }
  if (result.state.stateRevision !== previousState.stateRevision + 1) {
    return {
      status: 'rejected',
      reason: 'revisionGap',
      encounterId: result.state.encounterId,
      projectedRevision,
      previousStateRevision: previousState.stateRevision,
      resultRevision: result.state.stateRevision,
    };
  }

  const registry = getCombatIdentityRegistry(world);
  registry.sync(world);

  const activeId = result.state.initiative.order[result.state.initiative.activeIndex] ?? null;

  for (const combatant of Object.values(result.state.combatants)) {
    const entityId = registry.toEntityId(combatant.combatantId);
    if (entityId === null) {
      continue;
    }
    CombatStats.health[entityId] = combatant.hp;
    CombatStats.maxHealth[entityId] = combatant.maxHp;
    CombatStats.evasion[entityId] = combatant.armorClass;
    CombatStats.accuracy[entityId] = combatant.attackBonus;
    CombatStats.initiative[entityId] = combatant.initiative;
    GridPosition.x[entityId] = combatant.position.x;
    GridPosition.y[entityId] = combatant.position.y;
    TurnOrder.currentTurn[entityId] = combatant.combatantId === activeId;
    TurnOrder.isActive[entityId] = !combatant.defeated;
  }

  projectionMap(world, true)?.set(result.state.encounterId, result.state.stateRevision);
  return {
    status: 'accepted',
    encounterId: result.state.encounterId,
    stateRevision: result.state.stateRevision,
  };
};

/**
 * Clears the per-world apply guard — lifecycle/test helper.
 *
 * Used by retry (a new attempt projects from revision 0) and by tests that want
 * a clean projection history for a world.
 */
export const resetCombatApplyGuard = (world: World): void => {
  projectedRevisions.delete(world);
};
