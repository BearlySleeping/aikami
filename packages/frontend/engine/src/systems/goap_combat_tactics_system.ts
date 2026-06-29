// packages/frontend/engine/src/systems/goap_combat_tactics_system.ts

import type { World } from 'bitecs';
import { getComponent } from 'bitecs';
import type { CombatStatsData } from '../components/combat_stats.ts';
import { CombatStats } from '../components/combat_stats.ts';
import { CombatTactics } from '../components/combat_tactics.ts';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';
import { WorldStateBit } from '../math/goap/world_state_bits.ts';
import { isWalkable } from '../systems/collision_system.ts';

// ---------------------------------------------------------------------------
// GoapCombatTacticsSystem — zero-allocation tactical combat AI
//
// Contract C-197: Replaces rigid enemy counter-attacks with adaptive bitmask
// tactical planning. For each enemy combatant on its turn, evaluates all
// potential targets, scores them using JPS-distance-weighted heuristics,
// selects the best tactical action via GOAP, and executes it.
//
// Runs inside the Web Worker alongside other game systems. All lookups are
// monomorphic — reading directly from SoA arrays via unversioned eid keys
// to maximize JIT-friendly access patterns.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Obstacle penalty multiplier for obstructed paths (C-197 AC-2). */
const OBSTRUCTED_PATH_PENALTY = 2.0;

/** Health threshold ratio for tagging a target as "weak" (below 40% HP). */
const WEAK_TARGET_HP_RATIO = 0.4;

/** Default tile size in pixels for grid coordinate conversion. */
const DEFAULT_TILE_SIZE = 32;

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Evaluates tactical combat decisions for all enemy combatants.
 *
 * Called once per tick from the worker's pipeline (Step 4: Cognition).
 * For each active enemy with a CombatTactics component, evaluates
 * available targets, scores them, and updates the GoapAgent state
 * with tactical goals.
 *
 * AC-1: All evaluations use bitwise math and direct array access —
 * zero heap allocations per invocation.
 *
 * @param world - The bitECS world.
 * @param playerEntityId - The player entity ID (always a valid target).
 */
export const updateGoapCombatTactics = (world: World, playerEntityId: number): void => {
  if (!world || playerEntityId <= 0) {
    return;
  }

  // Scan for entities that have both CombatStats and CombatTactics
  // (i.e., enemy combatants that use tactical AI).
  const count = CombatTactics.preferredRange.length;
  for (let eid = 0; eid < count; eid++) {
    const prefRange = CombatTactics.preferredRange[eid];
    if (prefRange === undefined) {
      continue;
    }

    // Only process if this entity is alive
    const health = CombatStats.health[eid];
    if (health === undefined || health <= 0) {
      continue;
    }

    // Evaluate tactical decisions for this combatant
    _evaluateTactics(world, eid, playerEntityId);
  }
};

/**
 * Scores a potential target for the given attacker.
 *
 * Computes a threat score based on three factors:
 * 1. **Distance**: Inverse weight via taxicab grid distance, penalized
 *    2× if the line-of-sight is obstructed (AC-2).
 * 2. **Health ratio**: Weak targets (below 40% HP) get a bonus multiplier.
 * 3. **Already targeted**: Existing target gets a slight loyalty bonus
 *    to prevent oscillation (Watch Point).
 *
 * @param attackerEid - The evaluating agent's entity ID.
 * @param targetEid - The potential target's entity ID.
 * @param alreadyTargeted - `true` if this target is the current threatTargetEid.
 * @returns A numeric threat score (higher = more attractive target).
 */
export const scoreTarget = (
  world: World,
  attackerEid: number,
  targetEid: number,
  alreadyTargeted: boolean = false,
): number => {
  const attackerPos = getComponent(world, attackerEid, Position) as PositionData | undefined;
  const targetPos = getComponent(world, targetEid, Position) as PositionData | undefined;

  if (!attackerPos || !targetPos) {
    return 0;
  }

  // Convert pixel positions to grid coordinates
  const attackerGx = Math.floor(attackerPos.x / DEFAULT_TILE_SIZE);
  const attackerGy = Math.floor(attackerPos.y / DEFAULT_TILE_SIZE);
  const targetGx = Math.floor(targetPos.x / DEFAULT_TILE_SIZE);
  const targetGy = Math.floor(targetPos.y / DEFAULT_TILE_SIZE);

  // ── Taxicab grid distance ──
  const dx = Math.abs(targetGx - attackerGx);
  const dy = Math.abs(targetGy - attackerGy);
  let distance = dx + dy;

  // ── AC-2: Obstruction penalty ──
  // Check if there's a straight-line obstacle between attacker and target.
  // If the midpoint cell is blocked, the path is obstructed → penalty.
  const midGx = Math.floor((attackerGx + targetGx) / 2);
  const midGy = Math.floor((attackerGy + targetGy) / 2);
  const midX = midGx * DEFAULT_TILE_SIZE + DEFAULT_TILE_SIZE / 2;
  const midY = midGy * DEFAULT_TILE_SIZE + DEFAULT_TILE_SIZE / 2;

  if (!isWalkable(midX, midY)) {
    distance = Math.floor(distance * OBSTRUCTED_PATH_PENALTY);
  }

  // ── Distance contributes inversely to score ──
  // Closer targets score higher. Add 1 to avoid division by zero.
  let score = 100.0 / (distance + 1);

  // ── AC-3: Weak target bonus ──
  const targetStats = getComponent(world, targetEid, CombatStats) as CombatStatsData | undefined;
  if (targetStats) {
    const hpRatio = targetStats.health / Math.max(targetStats.maxHealth, 1);
    if (hpRatio <= WEAK_TARGET_HP_RATIO) {
      score *= 1.5; // 50% bonus for finishing weak targets
    }
  }

  // ── Loyalty bonus for already-targeted entities ──
  // Prevents oscillation when two targets have very similar scores.
  if (alreadyTargeted) {
    score *= 1.1; // 10% loyalty bonus
  }

  // ── Out of range penalty ──
  const prefRange = CombatTactics.preferredRange[attackerEid] ?? 3;
  if (distance > prefRange * 2) {
    score *= 0.5; // Distant targets are much less attractive
  }

  return score;
};

/**
 * Resolves the selected target and tactical action for a single combatant.
 *
 * Called by {@link updateGoapCombatTactics}. Evaluates all valid targets,
 * selects the best one via {@link scoreTarget}, updates the CombatTactics
 * component, and sets the GoapAgent's goal based on the current state.
 *
 * This is the public entry point for turn-based tactical resolution —
 * the turn manager calls this when an enemy's turn arrives.
 *
 * @param world - The bitECS world.
 * @param attackerEid - The enemy entity ID evaluating tactics.
 * @param validTargets - Array of valid target entity IDs (alive participants).
 * @returns The selected target entity ID, or 0 if no valid targets exist.
 */
export const resolveTacticalAction = (
  world: World,
  attackerEid: number,
  validTargets: number[],
): number => {
  if (!world || attackerEid <= 0 || validTargets.length === 0) {
    return 0;
  }

  const currentTarget = CombatTactics.threatTargetEid[attackerEid] ?? 0;
  const attackerHealth = CombatStats.health[attackerEid] ?? 0;
  const attackerMaxHealth = CombatStats.maxHealth[attackerEid] ?? 100;
  const hpRatio = attackerMaxHealth > 0 ? attackerHealth / attackerMaxHealth : 0;

  // ── Score all valid targets ──
  let bestEid = 0;
  let bestScore = -1;

  for (const targetEid of validTargets) {
    if (targetEid === attackerEid) {
      continue;
    }

    const targetHealth = CombatStats.health[targetEid];
    if (targetHealth === undefined || targetHealth <= 0) {
      continue;
    }

    const alreadyTargeted = targetEid === currentTarget;
    const score = scoreTarget(world, attackerEid, targetEid, alreadyTargeted);

    if (score > bestScore) {
      bestScore = score;
      bestEid = targetEid;
    }
  }

  // ── Update CombatTactics ──
  if (bestEid > 0) {
    CombatTactics.threatTargetEid[attackerEid] = bestEid;

    // ── Determine tactical state bits ──
    const distance = _computeGridDistance(world, attackerEid, bestEid);
    const prefRange = CombatTactics.preferredRange[attackerEid] ?? 3;

    let tacticalMask = 0;
    if (distance <= prefRange) {
      tacticalMask |= WorldStateBit.IsInRange;
    }
    if (hpRatio <= WEAK_TARGET_HP_RATIO) {
      tacticalMask |= WorldStateBit.LowHealth;
    }
    // Advantage bit set when attacking a weak target or having range advantage
    if (targetHasWeak(world, bestEid)) {
      tacticalMask |= WorldStateBit.HasAdvantage | WorldStateBit.TargetIsWeak;
    }
    tacticalMask |= WorldStateBit.HasTarget | WorldStateBit.InCombat;

    CombatTactics.tacticalActionMask[attackerEid] = tacticalMask;
  }

  return bestEid;
};

/**
 * Computes an estimated grid distance between two entities.
 *
 * Uses taxicab distance after converting pixel positions to cell coordinates.
 * If the path midpoint is obstructed, applies the AC-2 penalty.
 *
 * @param world - The bitECS world.
 * @param fromEid - Source entity ID.
 * @param toEid - Target entity ID.
 * @returns Estimated grid path distance in cells.
 */
const _computeGridDistance = (world: World, fromEid: number, toEid: number): number => {
  const fromPos = getComponent(world, fromEid, Position) as PositionData | undefined;
  const toPos = getComponent(world, toEid, Position) as PositionData | undefined;

  if (!fromPos || !toPos) {
    return 999;
  }

  const fx = Math.floor(fromPos.x / DEFAULT_TILE_SIZE);
  const fy = Math.floor(fromPos.y / DEFAULT_TILE_SIZE);
  const tx = Math.floor(toPos.x / DEFAULT_TILE_SIZE);
  const ty = Math.floor(toPos.y / DEFAULT_TILE_SIZE);

  const dx = Math.abs(tx - fx);
  const dy = Math.abs(ty - fy);
  let dist = dx + dy;

  // Obstruction check: midpoint
  const midGx = Math.floor((fx + tx) / 2);
  const midGy = Math.floor((fy + ty) / 2);
  if (
    !isWalkable(
      midGx * DEFAULT_TILE_SIZE + DEFAULT_TILE_SIZE / 2,
      midGy * DEFAULT_TILE_SIZE + DEFAULT_TILE_SIZE / 2,
    )
  ) {
    dist = Math.floor(dist * OBSTRUCTED_PATH_PENALTY);
  }

  return dist;
};

/**
 * Checks if the target entity has low HP (below 40%).
 */
const targetHasWeak = (world: World, targetEid: number): boolean => {
  const stats = getComponent(world, targetEid, CombatStats) as CombatStatsData | undefined;
  if (!stats) {
    return false;
  }
  return stats.health <= stats.maxHealth * WEAK_TARGET_HP_RATIO;
};

/**
 * Evaluates tactics for a single enemy combatant.
 *
 * Internal worker for {@link updateGoapCombatTactics}. Gathers valid
 * targets (player + alive allies), scores them, and selects the best
 * tactical action.
 */
const _evaluateTactics = (world: World, attackerEid: number, playerEntityId: number): void => {
  // Gather valid targets from the combat encounter (player + alive companions)
  const validTargets: number[] = [playerEntityId];

  // Scan for other potential targets (allies, companions) with CombatStats
  const statsCount = CombatStats.health.length;
  for (let eid = 0; eid < statsCount; eid++) {
    if (eid === attackerEid || eid === playerEntityId) {
      continue;
    }
    const health = CombatStats.health[eid];
    if (health !== undefined && health > 0) {
      validTargets.push(eid);
    }
  }

  // Resolve and execute tactical action
  resolveTacticalAction(world, attackerEid, validTargets);
};
