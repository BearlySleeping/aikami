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
  CombatObjectiveState,
  CombatState,
  CombatTeam,
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
  abilityCatalog: Record<string, CombatAbilityDefinition>;
  battlefield: BattlefieldState;
  /** Caller-supplied campaign character id for the player combatant. */
  playerCombatantId: string;
  /** Runtime eid of the player entity, when the world knows it. */
  playerEntityId?: number | null;
  objectives?: CombatObjectiveState[];
  /** Per-combatant ability ids; defaults to every catalog ability id. */
  abilityIdsByCombatant?: Record<string, string[]>;
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
    return {
      combatantId,
      name: resolvedName !== undefined && resolvedName !== '' ? resolvedName : combatantId,
      team: resolveTeam(entityId, combatantId, options),
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
    };
  });

  return createCombatState({
    encounterId: options.encounterId,
    rulesVersion: options.rulesVersion,
    seed: options.seed,
    combatants,
    abilityCatalog: options.abilityCatalog,
    battlefield: options.battlefield,
    objectives: options.objectives ?? [],
  });
};

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

const appliedRevisions = new WeakMap<World, number>();

/**
 * Projects a resolved kernel result back onto the live ECS world.
 *
 * - No-ops when `result.valid === false` — a rejected command never touches
 *   the world.
 * - Revision-guarded: only the result that advances
 *   `previousState.stateRevision` by exactly one is applied, and a result is
 *   applied at most once per world (re-applying is a no-op).
 * - Applies only the kernel's own state — no diff is re-derived here.
 */
export const applyCombatResult = (
  world: World,
  previousState: CombatState,
  result: ResolveCombatResult,
): void => {
  if (!result.valid) {
    return;
  }
  const alreadyApplied = appliedRevisions.get(world);
  if (alreadyApplied !== undefined && result.state.stateRevision <= alreadyApplied) {
    return;
  }
  if (result.state.stateRevision !== previousState.stateRevision + 1) {
    return;
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

  appliedRevisions.set(world, result.state.stateRevision);
};

/** Clears the per-world apply guard — test/lifecycle helper. */
export const resetCombatApplyGuard = (world: World): void => {
  appliedRevisions.delete(world);
};
