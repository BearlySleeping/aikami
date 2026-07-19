// packages/frontend/engine/src/systems/turn_manager_system.ts
//
// TurnManagerSystem — turn-based combat sequencing + dice combat math
// + action economy + status effects + damage types + downed state
//
// Contracts: C-145 Turn-Based Combat Loop
//            C-338 Deepen Turn-Based Combat (AC-1 through AC-5)
// ---------------------------------------------------------------------------

import { STATUS_EFFECT_REGISTRY } from '@aikami/constants';
import type { ActiveStatusEffect, DamageTypeKey } from '@aikami/types';
import type { World } from 'bitecs';
import { getComponent, query, removeEntity } from 'bitecs';
import type { CombatStatsData } from '../components/combat_stats.ts';
import { CombatStats } from '../components/combat_stats.ts';
import { CombatTactics, combatRoleFromIndex } from '../components/combat_tactics.ts';
import { Enemy } from '../components/enemy.ts';
import { Position, type PositionData } from '../components/position.ts';
import { getResistanceFactor } from '../components/resistances.ts';
import {
  addStatusEffect,
  clearStatusEffects,
  getActiveEffects,
  recomputeStatusFlags,
  removeStatusEffect,
  StatusEffects,
} from '../components/status_effects.ts';
import type { TurnOrderData } from '../components/turn_order.ts';
import { TurnOrder } from '../components/turn_order.ts';
import { incrementEntityGeneration } from '../core/entity_reference.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import { isWalkable } from './collision_system.ts';
import { getCombatantScreenStates } from './combat_stage_system.ts';
import { resolveTacticalAction } from './goap_combat_tactics_system.ts';
import { grantXp } from './progression_system.ts';

/** Cached query terms for active combat participants. */
const COMBAT_QUERY_TERMS = [CombatStats, TurnOrder];

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let turnOrderList: number[] = [];
let currentTurnIndex = -1;

// ---------------------------------------------------------------------------
// C-338 AC-1: Action economy tracking (per-entity, reset each turn advance)
// ---------------------------------------------------------------------------

type ActionEconomyState = {
  entityId: number;
  actionConsumed: boolean;
  bonusActionConsumed: boolean;
  reactionConsumed: boolean;
};

/**
 * Per-entity action economy state, indexed by entity ID.
 * Reset when advanceTurn() sets the new active entity.
 */
const _actionEconomy: Record<number, ActionEconomyState> = {};

const _getActionEconomy = (eid: number): ActionEconomyState => {
  if (!_actionEconomy[eid]) {
    _actionEconomy[eid] = {
      entityId: eid,
      actionConsumed: false,
      bonusActionConsumed: false,
      reactionConsumed: false,
    };
  }
  return _actionEconomy[eid];
};

const _resetActionEconomy = (eid: number): void => {
  _actionEconomy[eid] = {
    entityId: eid,
    actionConsumed: false,
    bonusActionConsumed: false,
    reactionConsumed: false,
  };
};

const _emitActionEconomy = (bridge: EngineBridge, eid: number): void => {
  const ae = _getActionEconomy(eid);
  bridge.emit({
    type: 'ACTION_ECONOMY_CHANGED',
    entityId: eid,
    actionAvailable: !ae.actionConsumed,
    bonusActionAvailable: !ae.bonusActionConsumed,
    reactionAvailable: !ae.reactionConsumed,
  });
};

// ---------------------------------------------------------------------------
// C-338 AC-5: Downed state and death saves
// ---------------------------------------------------------------------------

const _deathSaveSuccesses: Record<number, number> = {};
const _deathSaveFailures: Record<number, number> = {};

const _resetDeathSaves = (eid: number): void => {
  delete _deathSaveSuccesses[eid];
  delete _deathSaveFailures[eid];
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const initCombat = (world: World, bridge: EngineBridge, seed?: number): void => {
  if (!world || !bridge) {
    return;
  }

  if (seed !== undefined) {
    setCombatSeed(seed);
  } else if (turnOrderList.length === 0) {
    setCombatSeed(null);
  }

  if (turnOrderList.length > 0) {
    return;
  }

  // C-338: support multiple enemies — gather ALL combat-capable entities
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

  const sorted = [...participantIds].sort((a, b) => {
    const aData = getComponent(world, a, TurnOrder) as TurnOrderData | undefined;
    const bData = getComponent(world, b, TurnOrder) as TurnOrderData | undefined;
    const initDiff = (bData?.initiativeValue ?? 0) - (aData?.initiativeValue ?? 0);
    if (initDiff !== 0) {
      return initDiff;
    }
    return a - b;
  });

  turnOrderList = sorted;
  currentTurnIndex = 0;

  const firstId = turnOrderList[0];
  if (firstId !== undefined && firstId > 0) {
    TurnOrder.currentTurn[firstId] = true;
    _resetActionEconomy(firstId);
    _emitActionEconomy(bridge, firstId);
  }

  bridge.emit({
    type: 'COMBAT_STARTED',
    participantIds: [...turnOrderList],
    firstTurnEntityId: firstId ?? 0,
  });
};

const advanceTurn = (world: World, bridge: EngineBridge): void => {
  if (!world || !bridge) {
    return;
  }

  if (turnOrderList.length === 0 || currentTurnIndex < 0) {
    return;
  }

  const outgoingId = turnOrderList[currentTurnIndex];
  if (outgoingId !== undefined && outgoingId > 0) {
    TurnOrder.currentTurn[outgoingId] = false;
  }

  const startIndex = currentTurnIndex;
  let found = false;
  let foundId = 0;

  for (let attempt = 0; attempt < turnOrderList.length; attempt++) {
    currentTurnIndex = (currentTurnIndex + 1) % turnOrderList.length;
    const candidateId = turnOrderList[currentTurnIndex];
    if (candidateId === undefined || candidateId <= 0) {
      continue;
    }

    const stats = getComponent(world, candidateId, CombatStats) as CombatStatsData | undefined;
    if (stats && stats.health > 0) {
      foundId = candidateId;
      found = true;
      break;
    }

    if (currentTurnIndex === startIndex) {
      break;
    }
  }

  if (!found) {
    bridge.emit({ type: 'COMBAT_ENDED', victory: false });
    turnOrderList = [];
    currentTurnIndex = -1;
    return;
  }

  TurnOrder.currentTurn[foundId] = true;
  _resetActionEconomy(foundId);

  // C-338 AC-2: Process status ticks at start of turn
  _processStatusTicks(world, bridge, foundId, outgoingId);

  // C-338 AC-1: Check for stun — auto-skip if stunned
  const isStunned = (StatusEffects.isStunned[foundId] ?? 0) === 1;
  if (isStunned) {
    bridge.emit({
      type: 'COMBAT_LOG',
      message: `${_getEntityName(world, foundId)} is stunned and cannot act!`,
      sourceId: foundId,
      targetId: 0,
      targetRemainingHp: 0,
      targetMaxHp: 0,
    });
    _emitActionEconomy(bridge, foundId);
    _emitCombatStateUpdate(world, bridge);
    return;
  }

  // C-338 AC-5: Auto-roll death save for downed entities
  const downedEid = _getDownedPlayerEid(foundId);
  if (downedEid > 0) {
    const roller = rollDice;
    _processDeathSave(world, bridge, foundId, roller);
    _emitActionEconomy(bridge, foundId);
    _emitCombatStateUpdate(world, bridge);
    return;
  }

  _emitActionEconomy(bridge, foundId);

  const activeIds = getActiveParticipantIds(world);
  bridge.emit({
    type: 'TURN_CHANGED',
    currentEntityId: foundId,
    activeEntities: activeIds,
  });
};

const endCombat = (bridge: EngineBridge, victory: boolean = false): void => {
  if (!bridge) {
    return;
  }

  if (currentTurnIndex >= 0 && currentTurnIndex < turnOrderList.length) {
    const currentId = turnOrderList[currentTurnIndex];
    if (currentId !== undefined && currentId > 0) {
      TurnOrder.currentTurn[currentId] = false;
    }
  }

  // C-338: Clear status effects on combat ended
  for (const eid of turnOrderList) {
    clearStatusEffects(eid);
    _resetDeathSaves(eid);
  }

  bridge.emit({ type: 'COMBAT_ENDED', victory });
  turnOrderList = [];
  currentTurnIndex = -1;
};

const resetTurnTracking = (): void => {
  turnOrderList = [];
  currentTurnIndex = -1;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
// Seedable RNG
// ---------------------------------------------------------------------------

import { createSeedableRng as _sharedCreateSeedableRng, type SeedableRng } from '@aikami/utils';

export { _sharedCreateSeedableRng as createSeedableRng, type SeedableRng };

let _activeRng: SeedableRng | null = null;

const setCombatSeed = (seed: number | null): void => {
  if (seed === null) {
    _activeRng = null;
    return;
  }
  _activeRng = _sharedCreateSeedableRng(seed);
};

const getCombatSeed = (): SeedableRng | null => {
  return _activeRng;
};

const rollDice = (sides: number): number => {
  if (sides < 1) {
    return 0;
  }
  if (_activeRng) {
    return _activeRng.dice(sides);
  }
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return (array[0] % sides) + 1;
};

// ---------------------------------------------------------------------------
// Combat action handling — expanded for C-338
// ---------------------------------------------------------------------------

type CombatActionParams = {
  world: World;
  playerEntityId: number;
  /** The combat action to execute (C-338: expanded with ABILITY, SUPPORT, REVIVE). */
  action: 'ATTACK' | 'FLEE' | 'DEFEND' | 'ABILITY' | 'SUPPORT' | 'REVIVE';
  targetId?: number;
  targetIds?: number[];
  bridge: EngineBridge;
  diceRoller?: (sides: number) => number;
  advantage?: boolean;
  bonusDamage?: number;
  /** C-338: damage type for resistance checks. Default: 'slashing'. */
  damageType?: string;
  /** C-338: ABILITY actions are routed through ABILITY case. */
  abilityId?: string;

  /** C-338: SUPPORT kind — 'heal' or 'buff'. */
  supportKind?: 'heal' | 'buff';
  /** C-338: heal amount for SUPPORT heal. */
  healAmount?: number;
  /** C-338: buff effect ID for SUPPORT buff. */
  buffEffectId?: string;
};

const handleCombatAction = (params: CombatActionParams): void => {
  const {
    world,
    playerEntityId,
    action,
    targetId,
    targetIds,
    bridge,
    diceRoller,
    advantage,
    bonusDamage,
    damageType,
    abilityId: _ablId,
    supportKind,
    healAmount,
    buffEffectId,
  } = params;

  if (!world || !bridge) {
    return;
  }

  if (turnOrderList.length === 0) {
    return;
  }

  const roller = diceRoller ?? rollDice;

  // C-338 AC-1: Action economy — validate before executing
  const currentEid = _getCurrentTurnEntity();
  if (currentEid <= 0) {
    return;
  }

  // C-338: FLEE and DEFEND are standard actions
  if (action === 'FLEE' || action === 'DEFEND') {
    const ae = _getActionEconomy(currentEid);
    if (ae.actionConsumed) {
      bridge.emit({
        type: 'COMBAT_LOG',
        message: 'No standard action remaining!',
        sourceId: currentEid,
        targetId: 0,
        targetRemainingHp: 0,
        targetMaxHp: 0,
      });
      return;
    }
    ae.actionConsumed = true;
    _emitActionEconomy(bridge, currentEid);
  }

  switch (action) {
    case 'ATTACK': {
      // C-338 AC-1: ATTACK is a standard action
      const ae = _getActionEconomy(currentEid);
      if (ae.actionConsumed) {
        bridge.emit({
          type: 'COMBAT_LOG',
          message: 'No standard action remaining!',
          sourceId: currentEid,
          targetId: 0,
          targetRemainingHp: 0,
          targetMaxHp: 0,
        });
        return;
      }
      ae.actionConsumed = true;
      _emitActionEconomy(bridge, currentEid);

      _processPlayerAttack({
        world,
        playerEntityId,
        targetId,
        bridge,
        roller,
        advantage,
        bonusDamage,
        damageType: (damageType ?? 'slashing') as DamageTypeKey,
      });
      break;
    }
    case 'ABILITY': {
      // C-338 AC-1: ABILITY can be standard or bonus action
      const ae = _getActionEconomy(currentEid);
      // For now, ABILITY consumes standard action
      if (ae.actionConsumed) {
        bridge.emit({
          type: 'COMBAT_LOG',
          message: 'No standard action remaining!',
          sourceId: currentEid,
          targetId: 0,
          targetRemainingHp: 0,
          targetMaxHp: 0,
        });
        return;
      }
      ae.actionConsumed = true;
      _emitActionEconomy(bridge, currentEid);

      // C-338 AC-4: Multi-target resolution
      const targets =
        targetIds && targetIds.length > 0 ? targetIds : targetId && targetId > 0 ? [targetId] : [];
      if (targets.length === 0) {
        bridge.emit({
          type: 'COMBAT_LOG',
          message: 'No valid targets for ability!',
          sourceId: currentEid,
          targetId: 0,
          targetRemainingHp: 0,
          targetMaxHp: 0,
        });
        return;
      }
      _resolveMultiTargetAction({
        world,
        playerEntityId,
        targetIds: targets,
        bridge,
        roller,
        damageType: (damageType ?? 'slashing') as DamageTypeKey,
        bonusDamage,
      });
      break;
    }
    case 'SUPPORT': {
      // C-338 AC-4: Support actions — heal or buff
      const ae = _getActionEconomy(currentEid);
      if (ae.actionConsumed) {
        bridge.emit({
          type: 'COMBAT_LOG',
          message: 'No standard action remaining!',
          sourceId: currentEid,
          targetId: 0,
          targetRemainingHp: 0,
          targetMaxHp: 0,
        });
        return;
      }
      ae.actionConsumed = true;
      _emitActionEconomy(bridge, currentEid);

      const supportTarget = targetId && targetId > 0 ? targetId : currentEid;
      if (supportKind === 'heal') {
        _processHealAction(world, bridge, supportTarget, currentEid, healAmount ?? 0);
      } else if (supportKind === 'buff' && buffEffectId) {
        _applyStatusEffect(world, bridge, supportTarget, currentEid, buffEffectId);
      }
      break;
    }
    case 'REVIVE': {
      // C-338 AC-5: Revive action
      const ae = _getActionEconomy(currentEid);
      if (ae.actionConsumed) {
        bridge.emit({
          type: 'COMBAT_LOG',
          message: 'No standard action remaining!',
          sourceId: currentEid,
          targetId: 0,
          targetRemainingHp: 0,
          targetMaxHp: 0,
        });
        return;
      }
      ae.actionConsumed = true;
      _emitActionEconomy(bridge, currentEid);

      const reviveTarget = targetId && targetId > 0 ? targetId : 0;
      if (reviveTarget <= 0) {
        bridge.emit({
          type: 'COMBAT_LOG',
          message: 'No valid target to revive!',
          sourceId: currentEid,
          targetId: 0,
          targetRemainingHp: 0,
          targetMaxHp: 0,
        });
        return;
      }
      _processReviveAction(world, bridge, reviveTarget, currentEid, roller);
      break;
    }
    case 'FLEE': {
      endCombat(bridge, false);
      break;
    }
    case 'DEFEND': {
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
// C-338 AC-3: Damage type resistance modifier
// ---------------------------------------------------------------------------

/**
 * Applies resistance factor to raw damage.
 *
 * @returns The actual damage after resistance (minimum 1 unless immune).
 */
const _applyResistance = (rawDamage: number, resistanceFactor: number): number => {
  if (resistanceFactor <= 0) {
    return 0; // immune
  }
  const result = Math.max(1, Math.floor(rawDamage * resistanceFactor));
  return result;
};

/**
 * Gets a human-readable resistance label for combat log.
 */
const _resistanceLabel = (factor: number): string => {
  if (factor <= 0) {
    return 'Immune';
  }
  if (factor < 1.0) {
    return 'Resists';
  }
  if (factor > 1.0) {
    return 'Vulnerable';
  }
  return '';
};

// ---------------------------------------------------------------------------
// Internal — player attack (C-338: extended with damage type + resistance)
// ---------------------------------------------------------------------------

type ProcessPlayerAttackParams = {
  world: World;
  playerEntityId: number;
  targetId: number | undefined;
  bridge: EngineBridge;
  roller: (sides: number) => number;
  advantage?: boolean;
  bonusDamage?: number;
  damageType?: DamageTypeKey;
};

const _processPlayerAttack = (params: ProcessPlayerAttackParams): void => {
  const { world, playerEntityId, targetId, bridge, roller, advantage, bonusDamage, damageType } =
    params;
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

  // Apply status effect modifiers to attack roll
  const statusAccBonus = _getStatusAccuracyModifier(playerEntityId);
  const statusAttBonus = _getStatusAttackModifier(playerEntityId);

  // Hit check
  let attackRoll: number;
  if (advantage) {
    const roll1 = roller(20);
    const roll2 = roller(20);
    attackRoll = Math.max(roll1, roll2);
  } else {
    attackRoll = roller(20);
  }
  const hitTotal = attackRoll + (playerStats.accuracy ?? 0) + statusAccBonus;
  const hitThreshold = enemyStats.evasion ?? 0;
  const advantageLabel = advantage ? ' [ADV]' : '';

  if (hitTotal < hitThreshold) {
    bridge.emit({
      type: 'COMBAT_LOG',
      message: `Player rolls ${attackRoll}${advantageLabel} (+${playerStats.accuracy ?? 0}${statusAccBonus !== 0 ? ` ${statusAccBonus >= 0 ? '+' : ''}${statusAccBonus}` : ''} = ${hitTotal}) vs Evasion ${hitThreshold} — Miss!`,
      sourceId: playerEntityId,
      targetId: enemyId,
      targetRemainingHp: enemyStats.health,
      targetMaxHp: enemyStats.maxHealth,
    });
    _emitCombatStateUpdate(world, bridge);
    _processEnemyTurn(world, playerEntityId, bridge, roller);
    return;
  }

  // Damage roll with status modifiers
  const damageRoll = roller(6);
  const rawDamage =
    damageRoll + Math.max(0, (playerStats.attack ?? 0) + statusAttBonus) + (bonusDamage ?? 0);
  let damage = Math.max(1, rawDamage - (enemyStats.defense ?? 0));

  // C-338 AC-3: Resistance check
  const dt = damageType ?? 'slashing';
  const resistFactor = getResistanceFactor(enemyId, dt);
  damage = _applyResistance(damage, resistFactor);

  // Apply status-based damage multiplier
  const dmgMult = _getStatusDamageMultiplier(playerEntityId);
  damage = Math.max(1, Math.floor(damage * dmgMult));

  CombatStats.health[enemyId] = Math.max(0, enemyStats.health - damage);
  const remainingHp = CombatStats.health[enemyId];

  const resistMsg = _resistanceLabel(resistFactor);
  const typeSuffix = damageType ? ` [${damageType}]` : '';
  const resistSuffix = resistMsg ? ` — ${resistMsg}${damageType ? ` ${damageType}` : ''}!` : '';

  bridge.emit({
    type: 'COMBAT_LOG',
    message: `Player rolls ${attackRoll}${advantageLabel} (+${playerStats.accuracy ?? 0} = ${hitTotal}) to hit. Hits for ${damage} damage${typeSuffix}!${resistSuffix} (Enemy HP: ${remainingHp}/${enemyStats.maxHealth})`,
    sourceId: playerEntityId,
    targetId: enemyId,
    targetRemainingHp: remainingHp,
    targetMaxHp: enemyStats.maxHealth,
    damageType: dt,
  });

  const enemyScreenX = Position.x[enemyId] ?? 0;
  const enemyScreenY = Position.y[enemyId] ?? 0;
  bridge.emit({
    type: 'DAMAGE_DEALT',
    entityId: enemyId,
    amount: damage,
    isCritical: false,
    screenX: enemyScreenX,
    screenY: enemyScreenY,
    damageType: dt,
  });

  _emitCombatStateUpdate(world, bridge);

  // C-338 AC-5: Check for downed state for player-target attacks
  // Enemies die at 0 HP (no death saves)
  if (remainingHp <= 0) {
    _handleEnemyDefeated(world, enemyId, bridge, playerEntityId);
    return;
  }

  _processEnemyTurn(world, playerEntityId, bridge, roller);
};

// ---------------------------------------------------------------------------
// C-338 AC-4: Multi-target action resolution
// ---------------------------------------------------------------------------

type ResolveMultiTargetParams = {
  world: World;
  playerEntityId: number;
  targetIds: number[];
  bridge: EngineBridge;
  roller: (sides: number) => number;
  damageType?: DamageTypeKey;
  bonusDamage?: number;
};

const _resolveMultiTargetAction = (params: ResolveMultiTargetParams): void => {
  const { world, playerEntityId, targetIds, bridge, roller, damageType, bonusDamage } = params;

  const playerStats = getComponent(world, playerEntityId, CombatStats) as
    | CombatStatsData
    | undefined;
  if (!playerStats) {
    return;
  }

  // C-338: Filter out dead/downed targets
  const validTargets = targetIds.filter((tid) => {
    const stats = getComponent(world, tid, CombatStats) as CombatStatsData | undefined;
    return stats && stats.health > 0;
  });

  if (validTargets.length === 0) {
    bridge.emit({
      type: 'COMBAT_LOG',
      message: 'No valid targets in range!',
      sourceId: playerEntityId,
      targetId: 0,
      targetRemainingHp: 0,
      targetMaxHp: 0,
    });
    return;
  }

  const dt = damageType ?? 'slashing';
  const isMulti = validTargets.length > 1;

  for (const tid of validTargets) {
    const targetStats = getComponent(world, tid, CombatStats) as CombatStatsData | undefined;
    if (!targetStats) {
      continue;
    }

    // Independent hit check per target
    const attackRoll = roller(20);
    const hitTotal = attackRoll + (playerStats.accuracy ?? 0);
    const hitThreshold = targetStats.evasion ?? 0;

    if (hitTotal < hitThreshold) {
      bridge.emit({
        type: 'COMBAT_LOG',
        message: `Ability vs ${_getEntityName(world, tid)}: rolls ${attackRoll} (+${playerStats.accuracy ?? 0} = ${hitTotal}) vs Evasion ${hitThreshold} — Miss!`,
        sourceId: playerEntityId,
        targetId: tid,
        targetRemainingHp: targetStats.health,
        targetMaxHp: targetStats.maxHealth,
        damageType: dt,
        isMultiTarget: isMulti,
      });
      continue;
    }

    // Independent damage roll per target
    const damageRoll = roller(6);
    const rawDamage = damageRoll + (playerStats.attack ?? 0) + (bonusDamage ?? 0);
    let damage = Math.max(1, rawDamage - (targetStats.defense ?? 0));

    const resistFactor = getResistanceFactor(tid, dt);
    damage = _applyResistance(damage, resistFactor);

    CombatStats.health[tid] = Math.max(0, targetStats.health - damage);
    const remainingHp = CombatStats.health[tid];

    const resistMsg = _resistanceLabel(resistFactor);
    const resistSuffix = resistMsg ? ` — ${resistMsg} ${dt}!` : '';

    bridge.emit({
      type: 'COMBAT_LOG',
      message: `Ability vs ${_getEntityName(world, tid)}: rolls ${attackRoll} (+${playerStats.accuracy ?? 0} = ${hitTotal}) to hit. Deals ${damage} damage${resistSuffix}! (HP: ${remainingHp}/${targetStats.maxHealth})`,
      sourceId: playerEntityId,
      targetId: tid,
      targetRemainingHp: remainingHp,
      targetMaxHp: targetStats.maxHealth,
      damageType: dt,
      isMultiTarget: isMulti,
    });

    bridge.emit({
      type: 'DAMAGE_DEALT',
      entityId: tid,
      amount: damage,
      isCritical: false,
      screenX: Position.x[tid] ?? 0,
      screenY: Position.y[tid] ?? 0,
      damageType: dt,
    });

    // Check defeat — enemies die at 0 HP
    if (remainingHp <= 0) {
      _handleEnemyDefeated(world, tid, bridge, playerEntityId);
      // If combat ended during multi-target (victory), stop processing remaining targets
      if (turnOrderList.length === 0) {
        break;
      }
    }
  }

  _emitCombatStateUpdate(world, bridge);

  // Process enemy turns if combat still active
  if (turnOrderList.length > 0) {
    _processEnemyTurn(world, playerEntityId, bridge, roller);
  }
};

// ---------------------------------------------------------------------------
// C-338 AC-4: Support actions — heal and buff
// ---------------------------------------------------------------------------

const _processHealAction = (
  world: World,
  bridge: EngineBridge,
  targetId: number,
  sourceId: number,
  amount: number,
): void => {
  const targetStats = getComponent(world, targetId, CombatStats) as CombatStatsData | undefined;
  if (!targetStats) {
    return;
  }

  const oldHp = targetStats.health;
  const newHp = Math.min(targetStats.maxHealth, oldHp + amount);
  CombatStats.health[targetId] = newHp;

  bridge.emit({
    type: 'COMBAT_LOG',
    message: `${_getEntityName(world, targetId)} healed for ${newHp - oldHp} HP! (HP: ${newHp}/${targetStats.maxHealth})`,
    sourceId,
    targetId,
    targetRemainingHp: newHp,
    targetMaxHp: targetStats.maxHealth,
  });

  _emitCombatStateUpdate(world, bridge);
};

const _applyStatusEffect = (
  world: World,
  bridge: EngineBridge,
  targetId: number,
  sourceId: number,
  effectId: string,
): void => {
  const def = STATUS_EFFECT_REGISTRY[effectId];
  if (!def) {
    bridge.emit({
      type: 'COMBAT_LOG',
      message: `Unknown status effect: ${effectId}`,
      sourceId,
      targetId,
      targetRemainingHp: _getHp(world, targetId),
      targetMaxHp: _getMaxHp(world, targetId),
    });
    return;
  }

  // Check for existing effect of the same type — no stacking, longer duration wins
  const existing = getActiveEffects(targetId);
  const existingIdx = existing.findIndex((e) => e.effectId === effectId);
  if (existingIdx >= 0 && existing[existingIdx]) {
    if (existing[existingIdx].remainingDuration >= def.defaultDuration) {
      // Existing has longer or equal duration — no-op
      return;
    }
    // Remove existing, will re-apply with longer duration
    removeStatusEffect(targetId, existingIdx);
  }

  const active: ActiveStatusEffect = {
    effectId,
    sourceEntityId: sourceId,
    remainingDuration: def.defaultDuration,
    appliedOnTurn: currentTurnIndex,
  };

  addStatusEffect(targetId, active);
  recomputeStatusFlags(targetId, STATUS_EFFECT_REGISTRY);

  bridge.emit({
    type: 'STATUS_APPLIED',
    effectId,
    targetId,
    sourceId,
    duration: def.defaultDuration,
    turnNumber: currentTurnIndex,
  });

  bridge.emit({
    type: 'COMBAT_LOG',
    message: `${_getEntityName(world, targetId)} is now ${def.name}!`,
    sourceId,
    targetId,
    targetRemainingHp: _getHp(world, targetId),
    targetMaxHp: _getMaxHp(world, targetId),
    statusEffectId: effectId,
  });

  _emitCombatStateUpdate(world, bridge);
};

// ---------------------------------------------------------------------------
// C-338 AC-5: Revive action
// ---------------------------------------------------------------------------

const _processReviveAction = (
  world: World,
  bridge: EngineBridge,
  targetId: number,
  sourceId: number,
  roller: (sides: number) => number,
): void => {
  const targetStats = getComponent(world, targetId, CombatStats) as CombatStatsData | undefined;
  if (!targetStats) {
    return;
  }

  // Only works on downed entities (HP === 0 but has death saves)
  if (targetStats.health > 0) {
    bridge.emit({
      type: 'COMBAT_LOG',
      message: `${_getEntityName(world, targetId)} is not downed!`,
      sourceId,
      targetId,
      targetRemainingHp: targetStats.health,
      targetMaxHp: targetStats.maxHealth,
    });
    return;
  }

  // DC 12 medicine check (d20, no modifier for now)
  const medicineRoll = roller(20);
  if (medicineRoll >= 12) {
    CombatStats.health[targetId] = 1;
    _resetDeathSaves(targetId);
    bridge.emit({
      type: 'ENTITY_REVIVED',
      entityId: targetId,
      revivedByEntityId: sourceId,
    });
    bridge.emit({
      type: 'COMBAT_LOG',
      message: `${_getEntityName(world, targetId)} has been revived! (HP: 1/${targetStats.maxHealth})`,
      sourceId,
      targetId,
      targetRemainingHp: 1,
      targetMaxHp: targetStats.maxHealth,
    });
  } else {
    bridge.emit({
      type: 'COMBAT_LOG',
      message: `Revive attempt fails! (DC 12, rolled ${medicineRoll})`,
      sourceId,
      targetId,
      targetRemainingHp: 0,
      targetMaxHp: targetStats.maxHealth,
    });
  }

  _emitCombatStateUpdate(world, bridge);
};

// ---------------------------------------------------------------------------
// C-338 AC-2: Status effect tick processing
// ---------------------------------------------------------------------------

const _processStatusTicks = (
  world: World,
  bridge: EngineBridge,
  currentEid: number,
  _outgoingEid: number,
): void => {
  const effects = getActiveEffects(currentEid);
  let changed = false;

  for (let i = effects.length - 1; i >= 0; i--) {
    const effect = effects[i];
    if (!effect) {
      continue;
    }

    const def = STATUS_EFFECT_REGISTRY[effect.effectId];
    if (!def) {
      continue;
    }

    // Process tick damage/heal
    if (def.modifier.damagePerTick && def.modifier.damagePerTick > 0) {
      const tickType = def.modifier.tickDamageType ?? 'poison';
      const resistFactor = getResistanceFactor(currentEid, tickType);
      const tickDamage = _applyResistance(def.modifier.damagePerTick, resistFactor);

      const currentHp = CombatStats.health[currentEid] ?? 0;
      const newHp = Math.max(0, currentHp - tickDamage);
      CombatStats.health[currentEid] = newHp;

      bridge.emit({
        type: 'STATUS_TICK',
        effectId: effect.effectId,
        targetId: currentEid,
        amount: tickDamage,
        isDamage: true,
      });

      bridge.emit({
        type: 'COMBAT_LOG',
        message: `${_getEntityName(world, currentEid)} takes ${tickDamage} ${def.name} damage! (HP: ${newHp}/${_getMaxHp(world, currentEid)})`,
        sourceId: currentEid,
        targetId: currentEid,
        targetRemainingHp: newHp,
        targetMaxHp: _getMaxHp(world, currentEid),
        statusEffectId: effect.effectId,
      });

      changed = true;

      // C-338 AC-5: If tick damage kills, check for downed state
      if (newHp <= 0 && currentEid === 1) {
        _handlePlayerDowned(world, bridge, currentEid);
        return; // Stop processing other ticks
      }
    }

    if (def.modifier.healPerTick && def.modifier.healPerTick > 0) {
      const currentHp = CombatStats.health[currentEid] ?? 0;
      const maxHp = CombatStats.health[currentEid] ?? _getMaxHp(world, currentEid);
      const newHp = Math.min(maxHp, currentHp + def.modifier.healPerTick);
      CombatStats.health[currentEid] = newHp;

      bridge.emit({
        type: 'STATUS_TICK',
        effectId: effect.effectId,
        targetId: currentEid,
        amount: def.modifier.healPerTick,
        isDamage: false,
      });

      changed = true;
    }

    // Decrement duration
    effect.remainingDuration -= 1;
    if (effect.remainingDuration <= 0) {
      removeStatusEffect(currentEid, i);
      bridge.emit({
        type: 'STATUS_EXPIRED',
        effectId: effect.effectId,
        targetId: currentEid,
      });
      bridge.emit({
        type: 'COMBAT_LOG',
        message: `${_getEntityName(world, currentEid)}'s ${def.name} has expired.`,
        sourceId: currentEid,
        targetId: currentEid,
        targetRemainingHp: _getHp(world, currentEid),
        targetMaxHp: _getMaxHp(world, currentEid),
        statusEffectId: effect.effectId,
      });
    } else {
      // Update the remaining duration in the SoA
      removeStatusEffect(currentEid, i);
      addStatusEffect(currentEid, { ...effect, remainingDuration: effect.remainingDuration - 1 });
    }

    changed = true;
  }

  if (changed) {
    recomputeStatusFlags(currentEid, STATUS_EFFECT_REGISTRY);
  }
};

// ---------------------------------------------------------------------------
// C-338 AC-5: Downed state and death saves
// ---------------------------------------------------------------------------

/**
 * Handles the player entering the downed state at 0 HP.
 */
const _handlePlayerDowned = (world: World, bridge: EngineBridge, eid: number): void => {
  CombatStats.health[eid] = 0;
  _deathSaveSuccesses[eid] = 0;
  _deathSaveFailures[eid] = 0;

  bridge.emit({
    type: 'ENTITY_DOWNED',
    entityId: eid,
  });

  bridge.emit({
    type: 'COMBAT_LOG',
    message: `${_getEntityName(world, eid)} has been downed!`,
    sourceId: eid,
    targetId: eid,
    targetRemainingHp: 0,
    targetMaxHp: _getMaxHp(world, eid),
  });
};

/**
 * Processes a death save for a downed entity.
 */
const _processDeathSave = (
  world: World,
  bridge: EngineBridge,
  eid: number,
  roller: (sides: number) => number,
): void => {
  const roll = roller(20);
  let successes = _deathSaveSuccesses[eid] ?? 0;
  let failures = _deathSaveFailures[eid] ?? 0;

  if (roll === 20) {
    // Natural 20 — revive at 1 HP
    CombatStats.health[eid] = 1;
    _resetDeathSaves(eid);
    bridge.emit({
      type: 'DEATH_SAVE_ROLLED',
      entityId: eid,
      roll,
      cumulativeSuccesses: 0,
      cumulativeFailures: 0,
    });
    bridge.emit({
      type: 'ENTITY_REVIVED',
      entityId: eid,
      revivedByEntityId: 0,
    });
    bridge.emit({
      type: 'COMBAT_LOG',
      message: `${_getEntityName(world, eid)} rolls a natural 20 on a death save and springs back to life! (HP: 1)`,
      sourceId: eid,
      targetId: eid,
      targetRemainingHp: 1,
      targetMaxHp: _getMaxHp(world, eid),
    });
    return;
  }
  if (roll === 1) {
    // Natural 1 — two failures
    failures += 2;
  } else if (roll >= 10) {
    successes += 1;
  } else {
    failures += 1;
  }

  _deathSaveSuccesses[eid] = successes;
  _deathSaveFailures[eid] = failures;

  bridge.emit({
    type: 'DEATH_SAVE_ROLLED',
    entityId: eid,
    roll,
    cumulativeSuccesses: successes,
    cumulativeFailures: failures,
  });

  if (successes >= 3) {
    // Stable — HP stays at 0, no more death saves
    bridge.emit({
      type: 'COMBAT_LOG',
      message: `${_getEntityName(world, eid)} has stabilized! (Death saves: ${successes} successes, ${failures} failures)`,
      sourceId: eid,
      targetId: eid,
      targetRemainingHp: 0,
      targetMaxHp: _getMaxHp(world, eid),
    });
    return;
  }

  if (failures >= 3) {
    // Dead — remove from combat
    bridge.emit({
      type: 'COMBAT_LOG',
      message: `${_getEntityName(world, eid)} has died! (Death saves: ${successes} successes, ${failures} failures)`,
      sourceId: eid,
      targetId: eid,
      targetRemainingHp: 0,
      targetMaxHp: _getMaxHp(world, eid),
    });
    _resetDeathSaves(eid);
    clearStatusEffects(eid);

    // Check if all player-controlled entities are dead → defeat
    if (_allPlayersDeadOrDowned(world, eid)) {
      bridge.emit({ type: 'COMBAT_ENDED', victory: false });
      turnOrderList = [];
      currentTurnIndex = -1;
    }
    return;
  }

  bridge.emit({
    type: 'COMBAT_LOG',
    message: `${_getEntityName(world, eid)} death save: ${roll} (${successes} successes, ${failures} failures)`,
    sourceId: eid,
    targetId: eid,
    targetRemainingHp: 0,
    targetMaxHp: _getMaxHp(world, eid),
  });
};

/**
 * Checks if the given eid is a downed player entity (HP === 0, not yet stable/dead).
 */
const _getDownedPlayerEid = (eid: number): number => {
  // Only player entity (eid === 1) gets death saves
  if (eid !== 1) {
    return 0;
  }
  const successes = _deathSaveSuccesses[eid] ?? 0;
  const failures = _deathSaveFailures[eid] ?? 0;
  // If stable (3+ successes) or dead (3+ failures), no more saves
  if (successes >= 3 || failures >= 3) {
    return 0;
  }
  // If has death save tracking and HP is 0, they're downed
  if (_deathSaveSuccesses[eid] !== undefined || _deathSaveFailures[eid] !== undefined) {
    return eid;
  }
  return 0;
};

const _allPlayersDeadOrDowned = (world: World, _deadEid: number): boolean => {
  // Only player entity (eid === 1) matters for defeat
  const playerStats = getComponent(world, 1, CombatStats) as CombatStatsData | undefined;
  if (!playerStats) {
    return true;
  }
  return playerStats.health <= 0;
};

// ---------------------------------------------------------------------------
// Internal — enemy turn (C-338: extended with combat roles + damage types)
// ---------------------------------------------------------------------------

const _processEnemyTurn = (
  world: World,
  playerEntityId: number,
  bridge: EngineBridge,
  roller: (sides: number) => number,
): void => {
  // C-338: support multiple enemies — process all enemy participants
  const enemies = _findAllEnemyParticipants(playerEntityId);
  for (const enemyId of enemies) {
    _processSingleEnemyTurn(world, enemyId, playerEntityId, bridge, roller);
    if (turnOrderList.length === 0) {
      return; // combat ended
    }
  }
};

const _processSingleEnemyTurn = (
  world: World,
  enemyId: number,
  playerEntityId: number,
  bridge: EngineBridge,
  roller: (sides: number) => number,
): void => {
  const enemyStats = getComponent(world, enemyId, CombatStats) as CombatStatsData | undefined;
  if (!enemyStats || enemyStats.health <= 0) {
    return;
  }

  // C-338: Process enemy status ticks
  _processStatusTicks(world, bridge, enemyId, 0);

  const enemyPos = getComponent(world, enemyId, Position) as PositionData | undefined;
  const playerPos = getComponent(world, playerEntityId, Position) as PositionData | undefined;

  if (!enemyPos || !playerPos) {
    _processLegacyEnemyAttack(world, enemyId, playerEntityId, bridge, roller, enemyStats);
    return;
  }

  // C-338: Read combat role for AI behavior
  const roleIdx = CombatTactics.combatRole[enemyId] ?? 4;
  const role = combatRoleFromIndex[roleIdx] ?? 'generic';

  // Support role — heal most damaged ally
  if (role === 'support') {
    _processSupportEnemyTurn(world, enemyId, bridge, roller);
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

  // Distance check — role-specific preferred range
  const estimatedDistance = _estimateGridDist(world, enemyId, selectedTarget);
  const prefRange = _getPreferredRange(enemyId);
  const isInRange = estimatedDistance <= prefRange;

  // Rushers and bosses don't retreat
  const skipRetreat = role === 'rusher' || role === 'boss';
  const enemyHpRatio = enemyStats.maxHealth > 0 ? enemyStats.health / enemyStats.maxHealth : 0;
  if (!skipRetreat && enemyHpRatio <= 0.25) {
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

  if (!isInRange && role !== 'rusher') {
    // Snipers and generic maintain range, rushers always close
    _repositionEnemy(
      world,
      enemyId,
      selectedTarget,
      estimatedDistance,
      prefRange,
      bridge,
      targetStats,
    );
    return;
  }

  // Attack (with role-specific damage type)
  const enemyDt: DamageTypeKey = role === 'sniper' ? 'piercing' : 'slashing';
  _executeEnemyAttack(
    world,
    enemyId,
    selectedTarget,
    bridge,
    roller,
    enemyStats,
    targetStats,
    playerEntityId,
    enemyDt,
  );
};

const _processSupportEnemyTurn = (
  world: World,
  enemyId: number,
  bridge: EngineBridge,
  roller: (sides: number) => number,
): void => {
  // Find the most damaged ally (lowest HP ratio)
  const allies = _findAllEnemyParticipants(enemyId);
  let bestAlly = 0;
  let lowestRatio = 1.0;

  for (const allyId of allies) {
    const allyStats = getComponent(world, allyId, CombatStats) as CombatStatsData | undefined;
    if (!allyStats || allyStats.health <= 0) {
      continue;
    }
    const ratio = allyStats.maxHealth > 0 ? allyStats.health / allyStats.maxHealth : 0;
    if (ratio < lowestRatio) {
      lowestRatio = ratio;
      bestAlly = allyId;
    }
  }

  if (bestAlly > 0) {
    // Heal the most damaged ally for d6 + 1 HP
    const healAmount = roller(6) + 1;
    _processHealAction(world, bridge, bestAlly, enemyId, healAmount);
  }

  _emitCombatStateUpdate(world, bridge);
};

// ---------------------------------------------------------------------------
// Internal — legacy + enemy attack helpers
// ---------------------------------------------------------------------------

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

  bridge.emit({
    type: 'COMBAT_LOG',
    message: `Enemy rolls ${attackRoll} (+${enemyStats.accuracy ?? 0} = ${hitTotal}) vs Evasion ${hitThreshold} — Hits!`,
    sourceId: enemyId,
    targetId: playerEntityId,
    targetRemainingHp: playerStats.health,
    targetMaxHp: playerStats.maxHealth,
  });

  const damageRoll = roller(6);
  const rawDamage = damageRoll + (enemyStats.attack ?? 0);
  const damage = Math.max(1, rawDamage - (playerStats.defense ?? 0));

  _applyDamageToTarget(world, playerEntityId, damage, bridge, enemyId, 'slashing');

  // C-338 AC-5: Check for downed state after player damage
  if (playerEntityId > 0) {
    const remainingHp = CombatStats.health[playerEntityId] ?? 0;
    if (remainingHp <= 0) {
      _handlePlayerDowned(world, bridge, playerEntityId);
    }
  }
};

const _repositionEnemy = (
  world: World,
  enemyId: number,
  selectedTarget: number,
  estimatedDistance: number,
  prefRange: number,
  bridge: EngineBridge,
  targetStats: CombatStatsData,
): void => {
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
};

const _executeEnemyAttack = (
  world: World,
  enemyId: number,
  selectedTarget: number,
  bridge: EngineBridge,
  roller: (sides: number) => number,
  enemyStats: CombatStatsData,
  targetStats: CombatStatsData,
  playerEntityId: number,
  damageTypeOverride?: DamageTypeKey,
): void => {
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

  const damageRoll = roller(6);
  const rawDamage = damageRoll + (enemyStats.attack ?? 0);
  const damage = Math.max(1, rawDamage - (targetStats.defense ?? 0));
  const dt = damageTypeOverride ?? 'slashing';

  _applyDamageToTarget(world, selectedTarget, damage, bridge, enemyId, dt);

  // Check if target was the player and is now downed/dead
  if (playerEntityId === selectedTarget) {
    const remainingHp = CombatStats.health[selectedTarget] ?? 0;
    if (remainingHp <= 0) {
      _handlePlayerDowned(world, bridge, selectedTarget);
    }
  }
};

/**
 * Applies damage to a target with resistance checks.
 * C-338 AC-3: integrated into damage application.
 */
const _applyDamageToTarget = (
  world: World,
  targetId: number,
  rawDamage: number,
  bridge: EngineBridge,
  sourceId: number,
  damageType: DamageTypeKey,
): void => {
  const targetStats = getComponent(world, targetId, CombatStats) as CombatStatsData | undefined;
  if (!targetStats) {
    return;
  }

  const resistFactor = getResistanceFactor(targetId, damageType);
  const actualDamage = _applyResistance(rawDamage, resistFactor);

  CombatStats.health[targetId] = Math.max(0, targetStats.health - actualDamage);
  const remainingHp = CombatStats.health[targetId];

  const resistMsg = _resistanceLabel(resistFactor);
  const resistSuffix = resistMsg ? ` — ${resistMsg} ${damageType}!` : '';

  bridge.emit({
    type: 'COMBAT_LOG',
    message: `Enemy deals ${actualDamage} damage to ${_getEntityName(world, targetId)}!${resistSuffix} (HP: ${remainingHp}/${targetStats.maxHealth})`,
    sourceId,
    targetId,
    targetRemainingHp: remainingHp,
    targetMaxHp: targetStats.maxHealth,
    damageType,
  });

  bridge.emit({
    type: 'DAMAGE_DEALT',
    entityId: targetId,
    amount: actualDamage,
    isCritical: false,
    screenX: Position.x[targetId] ?? 0,
    screenY: Position.y[targetId] ?? 0,
    damageType,
  });

  _emitCombatStateUpdate(world, bridge);
};

// ---------------------------------------------------------------------------
// Internal — defeat + loot
// ---------------------------------------------------------------------------

const _handleEnemyDefeated = (
  world: World,
  enemyId: number,
  bridge: EngineBridge,
  playerEntityId: number,
): void => {
  if (playerEntityId > 0) {
    const playerStats = getComponent(world, playerEntityId, CombatStats) as
      | CombatStatsData
      | undefined;
    const playerClassId = playerStats?.classId || 'fighter';
    grantXp(world, playerEntityId, 25, bridge, playerClassId);
  }

  const spawnId = Enemy.spawnId[enemyId] ?? '';

  clearStatusEffects(enemyId);
  _resetDeathSaves(enemyId);
  incrementEntityGeneration(enemyId);
  removeEntity(world, enemyId);

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

const _findFirstEnemyParticipant = (playerEntityId: number): number => {
  for (const eid of turnOrderList) {
    if (eid !== playerEntityId && eid > 0) {
      return eid;
    }
  }
  return 0;
};

const _findAllEnemyParticipants = (playerEntityId: number): number[] => {
  const enemies: number[] = [];
  for (const eid of turnOrderList) {
    if (eid !== playerEntityId && eid > 0) {
      const stats = CombatStats.health[eid];
      if (stats !== undefined && stats > 0) {
        enemies.push(eid);
      }
    }
  }
  return enemies;
};

const _getCurrentTurnEntity = (): number => {
  if (currentTurnIndex < 0 || currentTurnIndex >= turnOrderList.length) {
    return 0;
  }
  return turnOrderList[currentTurnIndex] ?? 0;
};

const _getHp = (world: World, eid: number): number => {
  const stats = getComponent(world, eid, CombatStats) as CombatStatsData | undefined;
  return stats?.health ?? 0;
};

const _getMaxHp = (world: World, eid: number): number => {
  const stats = getComponent(world, eid, CombatStats) as CombatStatsData | undefined;
  return stats?.maxHealth ?? 0;
};

const _getPreferredRange = (eid: number): number => {
  return CombatTactics.preferredRange[eid] ?? 3;
};

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

  const midX = Math.floor((fx + tx) / 2) * tileSize + tileSize / 2;
  const midY = Math.floor((fy + ty) / 2) * tileSize + tileSize / 2;
  if (!_checkWalkable(midX, midY)) {
    dist = Math.floor(dist * 2.0);
  }

  return dist;
};

const _checkWalkable = (x: number, y: number): boolean => {
  return isWalkable(x, y);
};

const _getEntityName = (_world: World, eid: number): string => {
  if (eid === 1) {
    return 'Player';
  }
  return `Entity #${eid}`;
};

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

// ---------------------------------------------------------------------------
// C-338: Status effect stat modifier helpers
// ---------------------------------------------------------------------------

const _getStatusAccuracyModifier = (eid: number): number => {
  let bonus = 0;
  const effects = getActiveEffects(eid);
  for (const effect of effects) {
    const def = STATUS_EFFECT_REGISTRY[effect.effectId];
    if (def?.modifier.accuracyModifier) {
      bonus += def.modifier.accuracyModifier;
    }
  }
  return bonus;
};

const _getStatusAttackModifier = (eid: number): number => {
  let bonus = 0;
  const effects = getActiveEffects(eid);
  for (const effect of effects) {
    const def = STATUS_EFFECT_REGISTRY[effect.effectId];
    if (def?.modifier.attackModifier) {
      bonus += def.modifier.attackModifier;
    }
  }
  return bonus;
};

const _getStatusDamageMultiplier = (eid: number): number => {
  let mult = 1.0;
  const effects = getActiveEffects(eid);
  for (const effect of effects) {
    const def = STATUS_EFFECT_REGISTRY[effect.effectId];
    if (def?.modifier.damageDealtMultiplier) {
      mult *= def.modifier.damageDealtMultiplier;
    }
  }
  return mult;
};

// ---------------------------------------------------------------------------
// Emit helpers
// ---------------------------------------------------------------------------

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
  endCombat,
  getCombatSeed,
  handleCombatAction,
  initCombat,
  resetTurnTracking,
  setCombatSeed,
};
