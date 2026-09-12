// packages/frontend/engine/src/combat/combat_command_dispatch.ts
//
// Combat `GameCommand` dispatch for the ECS worker.
//
// Extracted from `worker/ecs_worker.ts`, which is on the source-file-size
// guard's grandfathered baseline. Behaviour is identical — the worker narrows
// the incoming command with `isCombatDispatchCommand` and delegates to
// `dispatchCombatCommand` instead of handling the combat command types inline.
//
// Contract: C-145, C-166, C-514 AC-4, C-515 AC-5

import type { World } from 'bitecs';
import type { EngineBridge } from '../engine_bridge.ts';
import { triggerPlayerAttackAnimation } from '../systems/combat_stage_system.ts';
import { advanceTurn, handleCombatAction } from '../systems/turn_manager_system.ts';
import type { GameCommand } from '../types.ts';
import { emitCombatPreviewResult, handleCombatPreviewRequest } from './combat_preview_handler.ts';

/** The combat command variants this dispatcher owns. */
export type CombatDispatchCommand = Extract<
  GameCommand,
  {
    type:
      | 'COMBAT_ACTION'
      | 'COMBAT_ACTION_ANIMATE'
      | 'COMBAT_END_TURN'
      | 'COMBAT_PREVIEW_REQUESTED';
  }
>;

/**
 * Narrows a `GameCommand` to the combat dispatcher's vocabulary.
 *
 * Keeps `worker/ecs_worker.ts` free of combat case labels — a new combat
 * command is added here and nowhere else.
 */
export const isCombatDispatchCommand = (command: GameCommand): command is CombatDispatchCommand =>
  command.type === 'COMBAT_ACTION' ||
  command.type === 'COMBAT_ACTION_ANIMATE' ||
  command.type === 'COMBAT_END_TURN' ||
  command.type === 'COMBAT_PREVIEW_REQUESTED';

export type CombatDispatchContext = {
  /** `null`/absent before the world exists — a combat command is then a no-op. */
  world: World | null | undefined;
  bridge: EngineBridge;
  playerEntityId: number;
};

/**
 * Dispatches `command` when it belongs to the combat dispatcher.
 *
 * Keeps `worker/ecs_worker.ts` free of combat case labels: the worker narrows
 * once, and a new combat command is added here and nowhere else.
 *
 * @returns `true` when the command was a combat command and must not be
 *   handled further by the caller.
 */
export const tryDispatchCombatCommand = (
  command: GameCommand,
  context: CombatDispatchContext,
): boolean => {
  if (!isCombatDispatchCommand(command)) {
    return false;
  }
  dispatchCombatCommand(command, context);
  return true;
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
  if (world === null || world === undefined) {
    return;
  }

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
      return;
    }
    case 'COMBAT_PREVIEW_REQUESTED': {
      // ── Pure tactical preview (C-515 AC-5) — never mutates state ──
      emitCombatPreviewResult(
        bridge,
        handleCombatPreviewRequest({ world, bridge, request: command }),
      );
    }
  }
};
