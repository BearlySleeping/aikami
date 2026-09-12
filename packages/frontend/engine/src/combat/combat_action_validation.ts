// packages/frontend/engine/src/combat/combat_action_validation.ts
// Validation for standard-action combat commands before their budget is spent.

import { STATUS_EFFECT_REGISTRY } from '@aikami/constants';
import type { World } from 'bitecs';
import { getComponent } from 'bitecs';
import type { CombatStatsData } from '../components/combat_stats.ts';
import { CombatStats } from '../components/combat_stats.ts';
import type { GameCommand } from '../types.ts';

type CombatAction = Extract<GameCommand, { type: 'COMBAT_ACTION' }>['action'];

type CombatActionValidationOptions = {
  world: World;
  action: CombatAction;
  playerEntityId: number;
  currentEntityId: number;
  defaultAttackTargetId: number;
  targetId?: number;
  targetIds?: number[];
  supportKind?: 'heal' | 'buff';
  buffEffectId?: string;
};

export type ValidatedCombatAction =
  | { ok: true; action: 'ATTACK'; targetId: number }
  | { ok: true; action: 'ABILITY'; targetIds: number[] }
  | { ok: true; action: 'SUPPORT'; targetId: number; supportKind: 'heal' }
  | { ok: true; action: 'SUPPORT'; targetId: number; supportKind: 'buff'; buffEffectId: string }
  | { ok: true; action: 'REVIVE'; targetId: number }
  | { ok: true; action: 'FLEE' | 'DEFEND' }
  | {
      ok: false;
      message: string;
      targetId: number;
      targetRemainingHp: number;
      targetMaxHp: number;
    };

const getStats = (options: { world: World; entityId: number }): CombatStatsData | undefined =>
  getComponent(options.world, options.entityId, CombatStats) as CombatStatsData | undefined;

const invalidTarget = (message: string): ValidatedCombatAction => ({
  ok: false,
  message,
  targetId: 0,
  targetRemainingHp: 0,
  targetMaxHp: 0,
});

/**
 * Resolves and validates a combat action without mutating ECS or RNG state, so
 * callers can spend the action budget immediately before the first side effect.
 */
export const validateCombatAction = (
  options: CombatActionValidationOptions,
): ValidatedCombatAction => {
  const {
    world,
    action,
    playerEntityId,
    currentEntityId,
    defaultAttackTargetId,
    targetId,
    targetIds,
    supportKind,
    buffEffectId,
  } = options;

  if (action === 'ATTACK') {
    const resolvedTargetId = targetId && targetId > 0 ? targetId : defaultAttackTargetId;
    const actorStats = getStats({ world, entityId: playerEntityId });
    const targetStats = getStats({ world, entityId: resolvedTargetId });
    if (resolvedTargetId <= 0 || !actorStats || !targetStats) {
      return invalidTarget('No valid target to attack!');
    }
    return { ok: true, action, targetId: resolvedTargetId };
  }

  if (action === 'ABILITY') {
    let requestedTargetIds: number[] = [];
    if (targetIds && targetIds.length > 0) {
      requestedTargetIds = targetIds;
    } else if (targetId && targetId > 0) {
      requestedTargetIds = [targetId];
    }
    const validTargetIds = requestedTargetIds.filter(
      (entityId) => (getStats({ world, entityId })?.health ?? 0) > 0,
    );
    if (!getStats({ world, entityId: playerEntityId }) || validTargetIds.length === 0) {
      return invalidTarget('No valid targets for ability!');
    }
    return { ok: true, action, targetIds: validTargetIds };
  }

  if (action === 'SUPPORT') {
    const resolvedTargetId = targetId && targetId > 0 ? targetId : currentEntityId;
    const targetStats = getStats({ world, entityId: resolvedTargetId });
    if (!targetStats) {
      return invalidTarget('No valid target for support!');
    }
    if (supportKind === 'heal') {
      return { ok: true, action, targetId: resolvedTargetId, supportKind };
    }
    if (supportKind === 'buff' && buffEffectId && STATUS_EFFECT_REGISTRY[buffEffectId]) {
      return { ok: true, action, targetId: resolvedTargetId, supportKind, buffEffectId };
    }
    return {
      ok: false,
      message: 'Invalid support action!',
      targetId: resolvedTargetId,
      targetRemainingHp: targetStats.health,
      targetMaxHp: targetStats.maxHealth,
    };
  }

  if (action === 'REVIVE') {
    const resolvedTargetId = targetId && targetId > 0 ? targetId : 0;
    const targetStats = getStats({ world, entityId: resolvedTargetId });
    if (resolvedTargetId <= 0 || !targetStats) {
      return invalidTarget('No valid target to revive!');
    }
    if (targetStats.health > 0) {
      return {
        ok: false,
        message: 'Target is not downed!',
        targetId: resolvedTargetId,
        targetRemainingHp: targetStats.health,
        targetMaxHp: targetStats.maxHealth,
      };
    }
    return { ok: true, action, targetId: resolvedTargetId };
  }

  return { ok: true, action };
};
