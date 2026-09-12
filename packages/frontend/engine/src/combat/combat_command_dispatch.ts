// packages/frontend/engine/src/combat/combat_command_dispatch.ts
//
// Combat `GameCommand` dispatch for the ECS worker.
//
// Extracted from `worker/ecs_worker.ts`, which is on the source-file-size
// guard's grandfathered baseline. Behaviour is identical — the worker's
// `switch` delegates to `dispatchCombatCommand` for the three combat command
// types instead of handling them inline.
//
// Contract: C-145, C-166, C-514 AC-4

import type { World } from 'bitecs';
import type { EngineBridge } from '../engine_bridge.ts';
import { triggerPlayerAttackAnimation } from '../systems/combat_stage_system.ts';
import { advanceTurn, handleCombatAction } from '../systems/turn_manager_system.ts';
import type { GameCommand } from '../types.ts';

/** The combat command variants this dispatcher owns. */
export type CombatDispatchCommand = Extract<
  GameCommand,
  { type: 'COMBAT_ACTION' | 'COMBAT_ACTION_ANIMATE' | 'COMBAT_END_TURN' }
>;

export type CombatDispatchContext = {
  world: World;
  bridge: EngineBridge;
  playerEntityId: number;
};

/**
 * Handles one combat command. Turn ownership is validated inside the turn
 * driver: a client cannot end a turn that is not active (C-514 AC-4).
 */
export const dispatchCombatCommand = (
  command: CombatDispatchCommand,
  context: CombatDispatchContext,
): void => {
  const { world, bridge, playerEntityId } = context;

  switch (command.type) {
    case 'COMBAT_ACTION': {
      handleCombatAction({
        world,
        playerEntityId,
        action: command.action,
        targetId: command.targetId,
        bridge,
        advantage: command.advantage,
        bonusDamage: command.bonusDamage,
      });
      return;
    }
    case 'COMBAT_ACTION_ANIMATE': {
      // ── Trigger player attack animation during AI resolution (C-166) ──
      triggerPlayerAttackAnimation(world);
      return;
    }
    case 'COMBAT_END_TURN': {
      // ── Explicit end turn (C-514 AC-4) ──
      advanceTurn(world, bridge);
    }
  }
};
