// packages/frontend/engine/src/combat/combat_bridge_commands.ts
//
// Combat bridge-command registration for `GameWorld`.
//
// Extracted from `game_world.ts`, which is on the source-file-size guard's
// grandfathered baseline. Behaviour is identical — the same commands are
// registered with the same handlers, only the declaration site moved.
//
// Contract: C-145, C-514 AC-4

import type { GameCommand } from '../types.ts';

/** Registrar matching `GameWorld._registerBridgeCommand`. */
export type BridgeCommandRegistrar = <T extends GameCommand['type']>(
  type: T,
  handler: (command: Extract<GameCommand, { type: T }>) => void,
) => void;

/** The combat commands forwarded verbatim to the ECS worker. */
export type ForwardedCombatCommand = Extract<
  GameCommand,
  { type: 'COMBAT_ACTION' | 'COMBAT_END_TURN' }
>;

/** Posts a command envelope to the worker. */
export type BridgeCommandPoster = (command: ForwardedCombatCommand) => void;

/**
 * Registers the combat bridge commands. `COMBAT_END_TURN` carries no payload —
 * the worker validates turn ownership before advancing (C-514 AC-4).
 */
export const registerCombatBridgeCommands = (options: {
  register: BridgeCommandRegistrar;
  post: BridgeCommandPoster;
}): void => {
  const { register, post } = options;

  // Forward COMBAT_ACTION commands (C-145)
  register('COMBAT_ACTION', (cmd) => {
    post({
      type: 'COMBAT_ACTION',
      action: cmd.action,
      targetId: cmd.targetId,
    });
  });

  // Forward COMBAT_END_TURN commands (C-514 AC-4)
  register('COMBAT_END_TURN', () => {
    post({ type: 'COMBAT_END_TURN' });
  });
};
