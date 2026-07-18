// packages/frontend/engine/src/systems/turn_manager_system.ts
import type { World } from 'bitecs';
import { getComponent, query, removeEntity } from 'bitecs';
import type { CombatStatsData } from '../components/combat_stats.ts';
import { CombatStats } from '../components/combat_stats.ts';
import { CombatTactics } from '../components/combat_tactics.ts';
import { Enemy } from '../components/enemy.ts';
import { Position, type PositionData } from '../components/position.ts';
import type { TurnOrderData } from '../components/turn_order.ts';
import { TurnOrder } from '../components/turn_order.ts';
import { incrementEntityGeneration } from '../core/entity_reference.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import { isWalkable } from './collision_system.ts';
import { getCombatantScreenStates } from './combat_stage_system.ts';
import { resolveTacticalAction } from './goap_combat_tactics_system.ts';

// ---------------------------------------------------------------------------
// TurnManagerSystem — turn-based combat sequencing + dice combat math
//
// Manages turn progression for combat encounters. Sorts participants by
// initiative, advances turns on demand, resolves combat actions (attack,
// flee, defend) with d20-style dice RNG, and emits COMBAT_LOG /
// COMBAT_STATE_UPDATE / COMBAT_ENDED events through the EngineBridge.
//
// Designed to run in the Web Worker alongside other game systems. Uses
// direct SoA array mutation for performance — no observer overhead per frame.
//
// Contract: C-145 Turn-Based Combat Loop
// ---------------------------------------------------------------------------

/** Cached query terms for active combat participants. */
const COMBAT_QUERY_TERMS = [CombatStats, TurnOrder];

/**
 * Ordered list of entity IDs sorted by initiative (highest first).
 * Populated during initCombat and maintained across turn advances.
 * Package-private — exposed only for test resets.
 */
let turnOrderList: number[] = [];

/**
 * Index into turnOrderList pointing at the current active entity.
 * Package-private — exposed only for test resets.
 */
let currentTurnIndex = -1;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initializes a combat encounter.
 *
 * Sorts all entities that have both CombatStats and TurnOrder components
 * by initiative (highest first), marks the first entity as having the
 * current turn, and emits COMBAT_STARTED through the bridge.
 *
 * Idempotent — if combat is already initialized (turnOrderList is non-empty),
 * this is a no-op.
 *
 * @param world - The bitECS world.
 * @param bridge - The EngineBridge for emitting events.
 * @param seed - Optional 32-bit seed for deterministic dice (AC-1).
 *   When provided, all combat dice rolls use a mulberry32 PRNG instead of
 *   crypto.getRandomValues. Use the same seed + command sequence to
 *   replay an encounter with identical results.
 */
const initCombat = (world: World, bridge: EngineBridge, seed?: number): void => {
  if (!world || !bridge) {
    return;
  }

  // Set the combat seed if provided (AC-1: deterministic replay)
  // Always apply seed — even if idempotent return (seed may have changed for retry)
  if (seed !== undefined) {
    setCombatSeed(seed);
  } else if (turnOrderList.length === 0) {
    // Only clear seed on fresh init without seed — preserve on idempotent calls
    setCombatSeed(null);
  }

  if (turnOrderList.length > 0) {
    return;
  }

  // Gather all combat-capable entities
  const participantIds: number[] = [];
  for (const eid of query(world, COMBAT_QUERY_TERMS)) {
    const turnOrder = getComponent(world, eid, TurnOrder) as TurnOrderData | undefined;
    if (!turnOrder?.isActive) {
      continue;
    }
    participantIds.push(eid);
  }

  if (participantIds.length === 0) {
    return;
  }

  // Sort by initiative — highest first, entity ID as tiebreaker (AC-1 determinism)
  const sorted = [...participantIds].sort((a, b) => {
    const aData = getComponent(world, a, TurnOrder) as TurnOrderData | undefined;
    const bData = getComponent(world, b, TurnOrder) as TurnOrderData | undefined;
    const initDiff = (bData?.initiativeValue ?? 0) - (aData?.initiativeValue ?? 0);
    if (initDiff !== 0) {
      return initDiff;
    }
    // Tiebreaker: lower entity ID first (stable, deterministic)
    return a - b;
  });

  turnOrderList = sorted;
  currentTurnIndex = 0;

  // Mark the first entity as having the current turn
  const firstId = turnOrderList[0];
  if (firstId !== undefined && firstId > 0) {
    TurnOrder.currentTurn[firstId] = true;
  }

  bridge.emit({
    type: 'COMBAT_STARTED',
    participantIds: [...turnOrderList],
    firstTurnEntityId: firstId ?? 0,
  });
};

/**
 * Advances the turn to the next active combat participant.
 *
 * Clears the current turn flag on the current entity, finds the next
 * active (alive) entity in initiative order, and marks it as the current
 * turn. Emits TURN_CHANGED through the bridge.
 *
 * If no more active entities remain (all dead), emits COMBAT_ENDED with
 * victory = false and resets tracking state.
 *
 * Must be called after initCombat. Safe to call when combat is not
 * initialized — returns silently.
 *
 * @param world - The bitECS world.
 * @param bridge - The EngineBridge for emitting events.
 */
const advanceTurn = (world: World, bridge: EngineBridge): void => {
  if (!world || !bridge) {
    return;
  }

  if (turnOrderList.length === 0 || currentTurnIndex < 0) {
    return;
  }

  // Clear current turn on the outgoing entity
  const outgoingId = turnOrderList[currentTurnIndex];
  if (outgoingId !== undefined && outgoingId > 0) {
    TurnOrder.currentTurn[outgoingId] = false;
  }

  // Find next active entity — wrap around if needed
  const startIndex = currentTurnIndex;
  let found = false;
  for (let attempt = 0; attempt < turnOrderList.length; attempt++) {
    currentTurnIndex = (currentTurnIndex + 1) % turnOrderList.length;
    const candidateId = turnOrderList[currentTurnIndex];
    if (candidateId === undefined || candidateId <= 0) {
      continue;
    }

    // Check if this entity is still alive (health > 0)
    const stats = getComponent(world, candidateId, CombatStats) as CombatStatsData | undefined;
    if (stats && stats.health > 0) {
      TurnOrder.currentTurn[candidateId] = true;
      found = true;
      break;
    }

    // If we've wrapped around to where we started and found nothing,
    // all entities are dead.
    if (currentTurnIndex === startIndex) {
      break;
    }
  }

  if (!found) {
    // All entities are dead — combat ends
    bridge.emit({ type: 'COMBAT_ENDED', victory: false });
    turnOrderList = [];
    currentTurnIndex = -1;
    return;
  }

  // Emit the turn change event
  const activeIds = getActiveParticipantIds(world);
  const currentId = turnOrderList[currentTurnIndex];
  bridge.emit({
    type: 'TURN_CHANGED',
    currentEntityId: currentId ?? 0,
    activeEntities: activeIds,
  });
};

/**
 * Ends the current combat encounter.
 *
 * Clears all turn state and emits COMBAT_ENDED through the bridge.
 * Safe to call when no combat is active — returns silently.
 *
 * @param bridge - The EngineBridge for emitting events.
 * @param victory - Whether the player's party won (default: false).
 */
const endCombat = (bridge: EngineBridge, victory: boolean = false): void => {
  if (!bridge) {
    return;
  }

  // Clear current turn flag on the active entity
  if (currentTurnIndex >= 0 && currentTurnIndex < turnOrderList.length) {
    const currentId = turnOrderList[currentTurnIndex];
    if (currentId !== undefined && currentId > 0) {
      TurnOrder.currentTurn[currentId] = false;
    }
  }

  bridge.emit({ type: 'COMBAT_ENDED', victory });
  turnOrderList = [];
  currentTurnIndex = -1;
};

/**
 * Resets all module-level turn tracking state.
 *
 * Use in test teardown (afterEach) to ensure clean state between tests.
 * Does NOT emit any bridge events — purely resets internal tracking arrays.
 */
const resetTurnTracking = (): void => {
  turnOrderList = [];
  currentTurnIndex = -1;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the list of entity IDs currently alive and participating in combat.
 *
 * Filters the full turnOrderList to only entities with health > 0.
 *
 * @param world - The bitECS world.
 * @returns Array of active entity IDs.
 */
const getActiveParticipantIds = (world: World): number[] => {
  const active: number[] = [];
  for (const eid of turnOrderList) {
    const stats = getComponent(world, eid, CombatStats) as CombatStatsData | undefined;
    if (stats && stats.health > 0) {
      active.push(eid);
    }
  }
  return active;
};

// ---------------------------------------------------------------------------
// Seedable RNG (mulberry32)
// ---------------------------------------------------------------------------

/**
 * A seedable 32-bit PRNG returning values in [0, 1). Uses mulberry32.
 *
 * Deterministic — given the same seed, produces the same sequence.
 * Exposed for serialization and deterministic replay (AC-1).
 */
export type SeedableRng = {
  /** Advance the PRNG and return a float in [0, 1). */
  next(): number;
  /** Return an integer in [1, sides] inclusive. */
  dice(sides: number): number;
  /** The current seed value (for serialization). */
  readonly seed: number;
};

/**
 * Creates a seedable PRNG using the mulberry32 algorithm.
 *
 * Given the same seed, the sequence of values returned by `next()` and
 * `dice()` is identical — enabling deterministic combat replay.
 *
 * @param seed - A 32-bit integer seed.
 * @returns A {@link SeedableRng} instance.
 */
const createSeedableRng = (seed: number): SeedableRng => {
  // mulberry32: a simple 32-bit PRNG with good distribution
  let state = seed | 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const dice = (sides: number): number => {
    if (sides < 1) {
      return 0;
    }
    return Math.floor(next() * sides) + 1;
  };

  return { next, dice, seed };
};

// ---------------------------------------------------------------------------
// Module-level seed state
// ---------------------------------------------------------------------------

/** Active seedable RNG for the current combat encounter, or null if unseeded. */
let _activeRng: SeedableRng | null = null;

/**
 * Sets the combat seed for deterministic RNG.
 *
 * Creates a new {@link SeedableRng} from the given seed and stores it as
 * the active RNG. All subsequent dice rolls in combat will use this PRNG
 * instead of {@link crypto.getRandomValues}.
 *
 * Call before {@link initCombat} to seed the encounter. Call with `null`
 * to clear (revert to crypto RNG).
 *
 * @param seed - A 32-bit integer seed, or null to clear.
 */
const setCombatSeed = (seed: number | null): void => {
  if (seed === null) {
    _activeRng = null;
    return;
  }
  _activeRng = createSeedableRng(seed);
};

/** Returns the active seedable RNG, or null if unseeded. */
const getCombatSeed = (): SeedableRng | null => {
  return _activeRng;
};

/**
 * Default dice roller — prefers the seeded RNG if active;
 * falls back to {@link crypto.getRandomValues} otherwise.
 */
const rollDice = (sides: number): number => {
  if (sides < 1) {
    return 0;
  }
  if (_activeRng) {
    return _activeRng.dice(sides);
  }
  // Use crypto.getRandomValues for uniform distribution
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return (array[0] % sides) + 1;
};

// ---------------------------------------------------------------------------
// Combat action handling (C-145)
// ---------------------------------------------------------------------------

/**
 * Parameters for {@link handleCombatAction}.
 */
type CombatActionParams = {
  world: World;
  /** Player entity ID for damage application and death checks. */
  playerEntityId: number;
  /** The combat action to execute. */
  action: 'ATTACK' | 'FLEE' | 'DEFEND';
  /** Target entity ID (defaults to first non-player enemy participant). */
  targetId?: number;
  bridge: EngineBridge;
  /**
   * Override the dice roller for deterministic testing.
   * When omitted, {@link rollDice} is used (crypto.getRandomValues).
   */
  diceRoller?: (sides: number) => number;
  /** When true, roll 2d20 and take the higher for the hit check (C-146). */
  advantage?: boolean;
  /** Extra damage added to the final damage calculation (C-146). */
  bonusDamage?: number;
};

/**
 * Processes a COMBAT_ACTION command from the UI.
 *
 * Called by the worker's message handler. Routes ATTACK (hit check →
 * damage roll → enemy turn), FLEE (ends combat), and DEFEND (future:
 * apply defense buff). Emits COMBAT_LOG and COMBAT_STATE_UPDATE through
 * the bridge.
 */
const handleCombatAction = (params: CombatActionParams): void => {
  const { world, playerEntityId, action, targetId, bridge, diceRoller, advantage, bonusDamage } =
    params;

  if (!world || !bridge) {
    return;
  }

  // Combat must be initialized
  if (turnOrderList.length === 0) {
    return;
  }

  const roller = diceRoller ?? rollDice;

  switch (action) {
    case 'ATTACK': {
      _processPlayerAttack({
        world,
        playerEntityId,
        targetId,
        bridge,
        roller,
        advantage,
        bonusDamage,
      });
      break;
    }
    case 'FLEE': {
      endCombat(bridge, false);
      break;
    }
    case 'DEFEND': {
      // DEFEND is a defensive stance — future implementation may apply a
      // temporary evasion buff. For now, emit a log entry and end the
      // player's action so the enemy can take its turn.
      bridge.emit({
        type: 'COMBAT_LOG',
        message: 'Player takes a defensive stance!',
        sourceId: playerEntityId,
        targetId: playerEntityId,
        targetRemainingHp: _getHp(world, playerEntityId),
        targetMaxHp: _getMaxHp(world, playerEntityId),
      });
      _emitCombatStateUpdate(world, bridge);
      _processEnemyTurn(world, playerEntityId, bridge, roller);
      break;
    }
    default: {
      break;
    }
  }
};

// ---------------------------------------------------------------------------
// Internal — player attack
// ---------------------------------------------------------------------------

/**
 * Parameters for the private player attack processor.
 */
type ProcessPlayerAttackParams = {
  world: World;
  playerEntityId: number;
  targetId: number | undefined;
  bridge: EngineBridge;
  roller: (sides: number) => number;
  /** When true, roll 2d20 and take the higher for the hit check (C-146). */
  advantage?: boolean;
  /** Extra damage to add to the final damage calculation (C-146). */
  bonusDamage?: number;
};

/**
 * Processes a player ATTACK action.
 *
 * 1. Finds the target enemy (from targetId or first enemy participant).
 * 2. d20 + player accuracy vs enemy evasion for hit check (with optional advantage).
 * 3. d6 + player attack - enemy defense + bonusDamage for damage.
 * 4. Applies damage, emits COMBAT_LOG.
 * 5. If enemy survives, processes enemy counter-attack.
 * 6. If enemy dies, destroys entity + grants loot + emits COMBAT_ENDED.
 */
const _processPlayerAttack = (params: ProcessPlayerAttackParams): void => {
  const { world, playerEntityId, targetId, bridge, roller, advantage, bonusDamage } = params;
  // Find the target enemy — the first non-player combat participant
  const enemyId = targetId && targetId > 0 ? targetId : _findFirstEnemyParticipant(playerEntityId);

  if (enemyId <= 0) {
    bridge.emit({
      type: 'COMBAT_LOG',
      message: 'No valid target to attack!',
      sourceId: playerEntityId,
      targetId: 0,
      targetRemainingHp: 0,
      targetMaxHp: 0,
    });
    return;
  }

  const playerStats = getComponent(world, playerEntityId, CombatStats) as
    | CombatStatsData
    | undefined;
  const enemyStats = getComponent(world, enemyId, CombatStats) as CombatStatsData | undefined;

  if (!playerStats || !enemyStats) {
    return;
  }

  // ── Hit check: d20 + player accuracy vs enemy evasion ──
  // Advantage (C-146): roll two d20s, take the higher
  let attackRoll: number;
  if (advantage) {
    const roll1 = roller(20);
    const roll2 = roller(20);
    attackRoll = Math.max(roll1, roll2);
  } else {
    attackRoll = roller(20);
  }
  const hitTotal = attackRoll + (playerStats.accuracy ?? 0);
  const hitThreshold = enemyStats.evasion ?? 0;

  const advantageLabel = advantage ? ' [ADV]' : '';

  if (hitTotal < hitThreshold) {
    // Miss!
    bridge.emit({
      type: 'COMBAT_LOG',
      message: `Player rolls ${attackRoll}${advantageLabel} (+${playerStats.accuracy ?? 0} = ${hitTotal}) vs Evasion ${hitThreshold} — Miss!`,
      sourceId: playerEntityId,
      targetId: enemyId,
      targetRemainingHp: enemyStats.health,
      targetMaxHp: enemyStats.maxHealth,
    });
    _emitCombatStateUpdate(world, bridge);
    _processEnemyTurn(world, playerEntityId, bridge, roller);
    return;
  }

  // ── Damage roll: d6 + player attack - enemy defense + bonusDamage ──
  const damageRoll = roller(6);
  const rawDamage = damageRoll + (playerStats.attack ?? 0) + (bonusDamage ?? 0);
  const damage = Math.max(1, rawDamage - (enemyStats.defense ?? 0)); // minimum 1 damage

  // Apply damage
  CombatStats.health[enemyId] = Math.max(0, enemyStats.health - damage);
  const remainingHp = CombatStats.health[enemyId];

  bridge.emit({
    type: 'COMBAT_LOG',
    message: `Player rolls ${attackRoll}${advantageLabel} (+${playerStats.accuracy ?? 0} = ${hitTotal}) to hit. Hits for ${damage} damage! (Enemy HP: ${remainingHp}/${enemyStats.maxHealth})`,
    sourceId: playerEntityId,
    targetId: enemyId,
    targetRemainingHp: remainingHp,
    targetMaxHp: enemyStats.maxHealth,
  });

  // ── Visceral feedback: floating damage text (C-163) ──
  const enemyScreenX = Position.x[enemyId] ?? 0;
  const enemyScreenY = Position.y[enemyId] ?? 0;
  bridge.emit({
    type: 'DAMAGE_DEALT',
    entityId: enemyId,
    amount: damage,
    isCritical: false,
    screenX: enemyScreenX,
    screenY: enemyScreenY,
  });

  _emitCombatStateUpdate(world, bridge);

  // ── Check if enemy is defeated ──
  if (remainingHp <= 0) {
    _handleEnemyDefeated(world, enemyId, bridge, playerEntityId);
    return;
  }

  // Enemy counter-attacks
  _processEnemyTurn(world, playerEntityId, bridge, roller);
};

// ---------------------------------------------------------------------------
// Internal — enemy turn
// ---------------------------------------------------------------------------

/**
 * Processes the enemy's turn using tactical AI (C-197).
 *
 * Instead of a fixed counter-attack, the enemy evaluates all valid targets
 * via {@link resolveTacticalAction}, determines whether to attack, move
 * toward the target, retreat, or hold position. Attacks use the same d20
 * hit check + d6 damage roll. Repositioning skips the attack phase and
 * simulates the enemy closing distance.
 *
 * Emits COMBAT_LOG and COMBAT_STATE_UPDATE.
 */
const _processEnemyTurn = (
  world: World,
  playerEntityId: number,
  bridge: EngineBridge,
  roller: (sides: number) => number,
): void => {
  const enemyId = _findFirstEnemyParticipant(playerEntityId);
  if (enemyId <= 0) {
    return;
  }

  const enemyStats = getComponent(world, enemyId, CombatStats) as CombatStatsData | undefined;
  if (!enemyStats) {
    return;
  }

  // ── C-197 AC-1: Resolve tactical target and action ──
  //
  // If positions are available (world-space coordinates), use the full
  // tactical AI pipeline: target scoring, range checking, repositioning.
  // When positions are absent (unit tests, legacy combat), fall back to
  // the classic counter-attack against the player.
  const enemyPos = getComponent(world, enemyId, Position) as PositionData | undefined;
  const playerPos = getComponent(world, playerEntityId, Position) as PositionData | undefined;

  if (!enemyPos || !playerPos) {
    // ── Legacy fallback: direct counter-attack against the player ──
    _processLegacyEnemyAttack(world, enemyId, playerEntityId, bridge, roller, enemyStats);
    return;
  }

  const validTargets = _getAliveTargets(world, enemyId);
  const selectedTarget = resolveTacticalAction(world, enemyId, validTargets);

  if (selectedTarget <= 0) {
    bridge.emit({
      type: 'COMBAT_LOG',
      message: 'Enemy scans for targets but finds none — holding position.',
      sourceId: enemyId,
      targetId: 0,
      targetRemainingHp: 0,
      targetMaxHp: 0,
    });
    _emitCombatStateUpdate(world, bridge);
    return;
  }

  const targetStats = getComponent(world, selectedTarget, CombatStats) as
    | CombatStatsData
    | undefined;
  if (!targetStats) {
    _emitCombatStateUpdate(world, bridge);
    return;
  }

  // ── Distance check ──
  const estimatedDistance = _estimateGridDist(world, enemyId, selectedTarget);
  const prefRange = _getPreferredRange(enemyId);
  const isInRange = estimatedDistance <= prefRange;

  // ── Low health → retreat (C-197 AC-2) ──
  const enemyHpRatio = enemyStats.maxHealth > 0 ? enemyStats.health / enemyStats.maxHealth : 0;
  if (enemyHpRatio <= 0.25) {
    bridge.emit({
      type: 'COMBAT_LOG',
      message: `Enemy is critically wounded and retreats! (HP: ${enemyStats.health}/${enemyStats.maxHealth})`,
      sourceId: enemyId,
      targetId: selectedTarget,
      targetRemainingHp: targetStats.health,
      targetMaxHp: targetStats.maxHealth,
    });
    CombatStats.health[enemyId] = 0;
    _emitCombatStateUpdate(world, bridge);
    TurnOrder.isActive[enemyId] = false;
    return;
  }

  if (!isInRange) {
    // ── Reposition: move toward target ──
    const enemyPos = getComponent(world, enemyId, Position) as PositionData | undefined;
    const targetPos = getComponent(world, selectedTarget, Position) as PositionData | undefined;

    let moveMsg = `Enemy advances toward its target! (distance: ${estimatedDistance}, preferred: ${prefRange})`;
    if (enemyPos && targetPos) {
      const dx = targetPos.x - enemyPos.x;
      const dy = targetPos.y - enemyPos.y;
      const dir =
        Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : dy > 0 ? 'south' : 'north';
      moveMsg = `Enemy advances ${dir} toward its target! (distance: ${estimatedDistance}, preferred: ${prefRange})`;
      const step = 32;
      const norm = Math.sqrt(dx * dx + dy * dy) || 1;
      Position.x[enemyId] = enemyPos.x + (dx / norm) * step;
      Position.y[enemyId] = enemyPos.y + (dy / norm) * step;
    }

    bridge.emit({
      type: 'COMBAT_LOG',
      message: moveMsg,
      sourceId: enemyId,
      targetId: selectedTarget,
      targetRemainingHp: targetStats.health,
      targetMaxHp: targetStats.maxHealth,
    });
    _emitCombatStateUpdate(world, bridge);
    return;
  }

  // ── In range: attack ──
  const attackRoll = roller(20);
  const hitTotal = attackRoll + (enemyStats.accuracy ?? 0);
  const hitThreshold = targetStats.evasion ?? 0;

  if (hitTotal < hitThreshold) {
    bridge.emit({
      type: 'COMBAT_LOG',
      message: `Enemy rolls ${attackRoll} (+${enemyStats.accuracy ?? 0} = ${hitTotal}) vs Evasion ${hitThreshold} — Miss!`,
      sourceId: enemyId,
      targetId: selectedTarget,
      targetRemainingHp: targetStats.health,
      targetMaxHp: targetStats.maxHealth,
    });
    _emitCombatStateUpdate(world, bridge);
    return;
  }

  // ── Damage roll ──
  const damageRoll = roller(6);
  const rawDamage = damageRoll + (enemyStats.attack ?? 0);
  const damage = Math.max(1, rawDamage - (targetStats.defense ?? 0));

  CombatStats.health[selectedTarget] = Math.max(0, targetStats.health - damage);
  const remainingHp = CombatStats.health[selectedTarget];

  bridge.emit({
    type: 'COMBAT_LOG',
    message: `Enemy rolls ${attackRoll} (+${enemyStats.accuracy ?? 0} = ${hitTotal}) to hit ${_getEntityName(world, selectedTarget)}. Deals ${damage} damage! (${_getEntityName(world, selectedTarget)} HP: ${remainingHp}/${targetStats.maxHealth})`,
    sourceId: enemyId,
    targetId: selectedTarget,
    targetRemainingHp: remainingHp,
    targetMaxHp: targetStats.maxHealth,
  });

  // ── Visceral feedback ──
  const targetScreenX = Position.x[selectedTarget] ?? 0;
  const targetScreenY = Position.y[selectedTarget] ?? 0;
  bridge.emit({
    type: 'DAMAGE_DEALT',
    entityId: selectedTarget,
    amount: damage,
    isCritical: false,
    screenX: targetScreenX,
    screenY: targetScreenY,
  });

  _emitCombatStateUpdate(world, bridge);

  // ── Check if target is defeated ──
  if (remainingHp <= 0) {
    if (selectedTarget === playerEntityId) {
      bridge.emit({ type: 'COMBAT_ENDED', victory: false });
      turnOrderList = [];
      currentTurnIndex = -1;
    } else {
      bridge.emit({
        type: 'COMBAT_LOG',
        message: `${_getEntityName(world, selectedTarget)} has fallen!`,
        sourceId: enemyId,
        targetId: selectedTarget,
        targetRemainingHp: 0,
        targetMaxHp: targetStats.maxHealth,
      });
    }
    return;
  }
};

// ---------------------------------------------------------------------------
// Internal — legacy enemy attack (counter-attack, pre C-197)
// ---------------------------------------------------------------------------

/**
 * Legacy enemy attack: direct counter-attack against the player.
 * Used as fallback when Position components are not available (unit
 * tests and situations where spatial awareness is not needed).
 */
const _processLegacyEnemyAttack = (
  world: World,
  enemyId: number,
  playerEntityId: number,
  bridge: EngineBridge,
  roller: (sides: number) => number,
  enemyStats: CombatStatsData,
): void => {
  const playerStats = getComponent(world, playerEntityId, CombatStats) as
    | CombatStatsData
    | undefined;

  if (!playerStats) {
    return;
  }

  // ── Hit check: d20 + enemy accuracy vs player evasion ──
  const attackRoll = roller(20);
  const hitTotal = attackRoll + (enemyStats.accuracy ?? 0);
  const hitThreshold = playerStats.evasion ?? 0;

  if (hitTotal < hitThreshold) {
    bridge.emit({
      type: 'COMBAT_LOG',
      message: `Enemy rolls ${attackRoll} (+${enemyStats.accuracy ?? 0} = ${hitTotal}) vs Evasion ${hitThreshold} — Miss!`,
      sourceId: enemyId,
      targetId: playerEntityId,
      targetRemainingHp: playerStats.health,
      targetMaxHp: playerStats.maxHealth,
    });
    _emitCombatStateUpdate(world, bridge);
    return;
  }

  // ── Damage roll: d6 + enemy attack - player defense ──
  const damageRoll = roller(6);
  const rawDamage = damageRoll + (enemyStats.attack ?? 0);
  const damage = Math.max(1, rawDamage - (playerStats.defense ?? 0));

  CombatStats.health[playerEntityId] = Math.max(0, playerStats.health - damage);
  const remainingHp = CombatStats.health[playerEntityId];

  bridge.emit({
    type: 'COMBAT_LOG',
    message: `Enemy rolls ${attackRoll} (+${enemyStats.accuracy ?? 0} = ${hitTotal}) to hit. Deals ${damage} damage! (Player HP: ${remainingHp}/${playerStats.maxHealth})`,
    sourceId: enemyId,
    targetId: playerEntityId,
    targetRemainingHp: remainingHp,
    targetMaxHp: playerStats.maxHealth,
  });

  // ── Visceral feedback ──
  const playerScreenX = Position.x[playerEntityId] ?? 0;
  const playerScreenY = Position.y[playerEntityId] ?? 0;
  bridge.emit({
    type: 'DAMAGE_DEALT',
    entityId: playerEntityId,
    amount: damage,
    isCritical: false,
    screenX: playerScreenX,
    screenY: playerScreenY,
  });

  _emitCombatStateUpdate(world, bridge);

  // ── Check if player is defeated ──
  if (remainingHp <= 0) {
    bridge.emit({ type: 'COMBAT_ENDED', victory: false });
    turnOrderList = [];
    currentTurnIndex = -1;
  }
};

// ---------------------------------------------------------------------------
// Internal — defeat + loot
// ---------------------------------------------------------------------------

/**
 * Handles enemy defeat: grants XP, destroys the entity, grants loot via
 * INVENTORY_UPDATED, and emits COMBAT_ENDED with victory = true.
 *
 * Contract: C-147 Progression & Persistence — XP grant + level-up check
 *
 * @param playerEntityId - The player entity ID for XP granting.
 */
const _handleEnemyDefeated = (
  world: World,
  enemyId: number,
  bridge: EngineBridge,
  playerEntityId: number,
): void => {
  // Grant XP to the player for this victory
  if (playerEntityId > 0) {
    _grantXp(world, playerEntityId, 25, bridge);
  }

  // Emit a loot event — each enemy drops a generic item on defeat.
  // In a full implementation, the itemId would come from the enemy's
  // spawn properties or a loot table.
  bridge.emit({
    type: 'INVENTORY_UPDATED',
    inventory: [
      {
        itemId: `loot_${enemyId}`,
        quantity: 1,
      },
    ],
  });

  // Read the spawn point ID from the Enemy component for persistence tracking
  const spawnId = Enemy.spawnId[enemyId] ?? '';

  // Remove the entity from the world
  incrementEntityGeneration(enemyId);
  removeEntity(world, enemyId);

  // End combat with victory, including the spawn ID for persistence
  bridge.emit({
    type: 'COMBAT_ENDED',
    victory: true,
    ...(spawnId ? { defeatedEnemyId: spawnId } : {}),
  });
  turnOrderList = [];
  currentTurnIndex = -1;
};

// ---------------------------------------------------------------------------
// Internal — helpers
// ---------------------------------------------------------------------------

/**
 * Finds the first enemy participant in the turn order list.
 *
 * @param playerEntityId - The player's entity ID (excluded from results).
 * @returns The entity ID of the first enemy, or 0 if none found.
 */
const _findFirstEnemyParticipant = (playerEntityId: number): number => {
  for (const eid of turnOrderList) {
    if (eid !== playerEntityId && eid > 0) {
      return eid;
    }
  }
  return 0;
};

// ---------------------------------------------------------------------------
// Internal — experience and leveling (C-147)
// ---------------------------------------------------------------------------

/**
 * Grants XP to the player entity and checks for level-up.
 *
 * Awards the given amount of XP, then checks if the player's total XP
 * meets or exceeds the threshold to reach the next level. If so,
 * triggers a level-up that increases max HP, fully restores HP,
 * boosts base attack and defense, and scales the next XP threshold.
 *
 * Emits {@link PLAYER_LEVELED_UP} through the bridge when a level-up occurs.
 *
 * Contract: C-147 Progression & Persistence
 *
 * @param world - The bitECS world.
 * @param playerEid - The player entity ID to grant XP to.
 * @param amount - Amount of XP to award.
 * @param bridge - The EngineBridge for emitting level-up events.
 */
const _grantXp = (world: World, playerEid: number, amount: number, bridge: EngineBridge): void => {
  const stats = getComponent(world, playerEid, CombatStats) as CombatStatsData | undefined;
  if (!stats) {
    return;
  }

  // Add XP
  const currentXp = (stats.xp ?? 0) + amount;
  CombatStats.xp[playerEid] = currentXp;

  // Check for level-up
  const xpThreshold = stats.xpToNextLevel ?? 100;
  if (currentXp >= xpThreshold) {
    _triggerLevelUp(world, playerEid, currentXp, xpThreshold, bridge);
  }
};

/**
 * Triggers a level-up for the player entity.
 *
 * Resets XP (carrying over remainder), increments level, increases max HP
 * by 20, fully restores HP, boosts attack by 2 and defense by 2, and
 * scales the next XP threshold by 1.5×.
 *
 * Emits {@link PLAYER_LEVELED_UP} so the UI can display a level-up notification.
 */
const _triggerLevelUp = (
  world: World,
  playerEid: number,
  currentXp: number,
  oldThreshold: number,
  bridge: EngineBridge,
): void => {
  const stats = getComponent(world, playerEid, CombatStats) as CombatStatsData | undefined;
  if (!stats) {
    return;
  }

  // Calculate new values
  const newLevel = (stats.level ?? 1) + 1;
  const nextThreshold = Math.floor(oldThreshold * 1.5);
  const remainingXp = currentXp - oldThreshold;
  const newMaxHp = (stats.maxHealth ?? 100) + 20;
  const newAttack = (stats.attack ?? 5) + 2;
  const newDefense = (stats.defense ?? 12) + 2;

  // Apply the level-up stat changes
  CombatStats.level[playerEid] = newLevel;
  CombatStats.xpToNextLevel[playerEid] = nextThreshold;
  CombatStats.xp[playerEid] = remainingXp;
  CombatStats.maxHealth[playerEid] = newMaxHp;
  CombatStats.health[playerEid] = newMaxHp; // full heal on level-up
  CombatStats.attack[playerEid] = newAttack;
  CombatStats.defense[playerEid] = newDefense;

  // Emit the level-up event to the UI
  bridge.emit({
    type: 'PLAYER_LEVELED_UP',
    newLevel,
    maxHp: newMaxHp,
    attack: newAttack,
    defense: newDefense,
    xpToNextLevel: nextThreshold,
  });
};

/**
 * Reads the current HP of an entity from the CombatStats SoA.
 */
const _getHp = (world: World, eid: number): number => {
  const stats = getComponent(world, eid, CombatStats) as CombatStatsData | undefined;
  return stats?.health ?? 0;
};

/**
 * Reads the max HP of an entity from the CombatStats SoA.
 */
const _getMaxHp = (world: World, eid: number): number => {
  const stats = getComponent(world, eid, CombatStats) as CombatStatsData | undefined;
  return stats?.maxHealth ?? 0;
};

/**
 * Gets the preferred combat range for an entity (default: 3 cells).
 * Reads from CombatTactics component if available, with a fallback default.
 */
const _getPreferredRange = (eid: number): number => {
  return CombatTactics.preferredRange[eid] ?? 3;
};

/**
 * Estimates grid distance between two entities in tile cells (C-197 AC-2).
 * Uses taxicab distance with obstacle penalty for obstructed paths.
 */
const _estimateGridDist = (world: World, fromEid: number, toEid: number): number => {
  const fromPos = getComponent(world, fromEid, Position) as PositionData | undefined;
  const toPos = getComponent(world, toEid, Position) as PositionData | undefined;

  if (!fromPos || !toPos) {
    return 999;
  }

  const tileSize = 32;
  const fx = Math.floor(fromPos.x / tileSize);
  const fy = Math.floor(fromPos.y / tileSize);
  const tx = Math.floor(toPos.x / tileSize);
  const ty = Math.floor(toPos.y / tileSize);

  const dx = Math.abs(tx - fx);
  const dy = Math.abs(ty - fy);
  let dist = dx + dy;

  // Obstruction penalty: midpoint check
  const midX = Math.floor((fx + tx) / 2) * tileSize + tileSize / 2;
  const midY = Math.floor((fy + ty) / 2) * tileSize + tileSize / 2;
  if (!_checkWalkable(midX, midY)) {
    dist = Math.floor(dist * 2.0);
  }

  return dist;
};

/**
 * Checks if a pixel position is walkable using the collision system.
 */
const _checkWalkable = (x: number, y: number): boolean => {
  return isWalkable(x, y);
};

/**
 * Gets a human-readable name for an entity (for combat log messages).
 */
const _getEntityName = (_world: World, eid: number): string => {
  if (eid === 1) {
    return 'Player';
  }
  return `Entity #${eid}`;
};

/**
 * Gets all alive target entities for the given attacker.
 * Filters dead entities and excludes the attacker itself.
 */
const _getAliveTargets = (world: World, attackerEid: number): number[] => {
  const alive: number[] = [];
  for (const eid of turnOrderList) {
    if (eid === attackerEid) {
      continue;
    }
    const stats = getComponent(world, eid, CombatStats) as CombatStatsData | undefined;
    if (stats && stats.health > 0) {
      alive.push(eid);
    }
  }
  // Also include any entity in the world with CombatStats
  const statsCount = CombatStats.health.length;
  for (let eid = 0; eid < statsCount; eid++) {
    if (eid === attackerEid || alive.includes(eid)) {
      continue;
    }
    const health = CombatStats.health[eid];
    if (health !== undefined && health > 0) {
      alive.push(eid);
    }
  }
  return alive;
};

/**
 * Emits a COMBAT_STATE_UPDATE event with current HP totals for all
 * combat participants. Called after every action (player attack, enemy
 * counter-attack) so the UI can reactively update HP bars.
 */
const _emitCombatStateUpdate = (world: World, bridge: EngineBridge): void => {
  const hpMap: Record<number, number> = {};
  const maxHpMap: Record<number, number> = {};

  for (const eid of turnOrderList) {
    const stats = getComponent(world, eid, CombatStats) as CombatStatsData | undefined;
    if (stats) {
      hpMap[eid] = stats.health;
      maxHpMap[eid] = stats.maxHealth;
    }
  }

  // Compute screen-space positions for diegetic HP bars (C-166)
  const screenStates = getCombatantScreenStates(world);
  const screenX: Record<number, number> = {};
  const screenY: Record<number, number> = {};
  let activeTurnEntity: number | undefined;
  for (const state of screenStates) {
    screenX[state.entityId] = state.screenX;
    screenY[state.entityId] = state.screenY;
    if (state.isActiveTurn) {
      activeTurnEntity = state.entityId;
    }
  }

  bridge.emit({
    type: 'COMBAT_STATE_UPDATE',
    entityHpMap: hpMap,
    entityMaxHpMap: maxHpMap,
    entityScreenX: screenX,
    entityScreenY: screenY,
    activeTurnEntity,
  });
};

export {
  advanceTurn,
  createSeedableRng,
  endCombat,
  getCombatSeed,
  handleCombatAction,
  initCombat,
  resetTurnTracking,
  setCombatSeed,
};
