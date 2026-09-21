// packages/frontend/engine/src/game_world/command_forwarding.ts
//
// Main-thread game-command forwarding for `GameWorld`.
//
// Extracted from `game_world.ts` (C-525 R-1): `game_world.ts` is on the
// source-file-size guard's reviewed exception list, so the declaration site
// moved here and behaviour is IDENTICAL — the same commands are registered with
// the same handlers through the same typed capability, only the site changed.
//
// Every forwarder translates one bridge command into a worker message. Two
// commands are deliberately handled on the MAIN thread instead (a UI selection
// is invisible to the worker): `COMBAT_MOVE_MODE` and
// `COMBAT_SELECTION_HIGHLIGHTS`.

import type { GridPoint } from '@aikami/types';
import { registerCombatBridgeCommands } from '../combat/combat_bridge_commands.ts';
import type { GameCommand } from '../types.ts';
import type { WorkerOutboundMessage } from './worker_session.ts';

/** Everything the forwarders need from the GameWorld that owns them. */
export type GameCommandForwardingDeps = {
  /** Registers a forwarder and retains its unsubscribe on the world. */
  register: <T extends GameCommand['type']>(
    type: T,
    handler: (command: Extract<GameCommand, { type: T }>) => void,
  ) => void;
  /** Posts an outbound worker message (the transport lives in WorkerSession). */
  postToWorker: (message: WorkerOutboundMessage) => void;
  /** Cancels an in-flight click-path plan (mode left EXPLORE). */
  cancelClickPath: () => void;
  /** Leaves combat move selection: clears the mode and the highlight overlay. */
  exitCombatMoveMode: () => void;
  /** Opens/closes combat move selection (main-thread only). */
  setCombatMoveMode: (active: boolean) => void;
  /** Publishes the highlight overlay cells (main-thread only). */
  setSelectionHighlights: (highlights: {
    legalEndpoints: GridPoint[];
    legalTargetCells: GridPoint[];
  }) => void;
  debug: (event: string, data?: unknown) => void;
};

/** Registers every game-command forwarder this world owns. */
export const setupGameCommandForwarding = (deps: GameCommandForwardingDeps): void => {
  // Register each forwarder through the typed engine-facing capability.
  // The session owns the transport; this only translates bridge commands
  // into worker messages.
  deps.register('SET_PLAYER_VELOCITY', (cmd) => {
    deps.postToWorker({
      type: 'BRIDGE_COMMAND',
      command: { type: 'SET_PLAYER_VELOCITY', velocity: cmd.velocity },
    });
  });

  deps.register('SPAWN_NPC', (cmd) => {
    deps.postToWorker({
      type: 'BRIDGE_COMMAND',
      command: { type: 'SPAWN_NPC', npcData: cmd.npcData },
    });
  });

  deps.register('SET_ENTITY_VELOCITY', (cmd) => {
    deps.postToWorker({
      type: 'BRIDGE_COMMAND',
      command: {
        type: 'SET_ENTITY_VELOCITY',
        entityId: cmd.entityId,
        velocity: cmd.velocity,
      },
    });
  });

  deps.register('TRIGGER_MACRO', (cmd) => {
    deps.postToWorker({
      type: 'BRIDGE_COMMAND',
      command: {
        type: 'TRIGGER_MACRO',
        macro: cmd.macro,
        args: cmd.args,
        entityId: cmd.entityId,
      },
    });
  });

  // Forward SET_GAME_MODE commands (C-140)
  deps.register('SET_GAME_MODE', (cmd) => {
    // C-380 AC-7: Mode changes cancel click-path
    if (cmd.mode !== 'EXPLORE') {
      deps.cancelClickPath();
    }
    if (cmd.mode !== 'COMBAT') {
      deps.exitCombatMoveMode();
    }
    deps.postToWorker({
      type: 'BRIDGE_COMMAND',
      command: { type: 'SET_GAME_MODE', mode: cmd.mode },
    });
  });
  // Combat move selection mode (C-516 AC-8). Handled on the main thread —
  // it gates how the canvas pointer interprets a click, which the worker
  // cannot see — and deliberately not forwarded.
  deps.register('COMBAT_MOVE_MODE', (cmd) => {
    deps.setCombatMoveMode(cmd.active);
  });

  // Combat direct-control highlight overlay (C-525 R-2). Handled on the main
  // thread: the worker cannot see a UI selection, and the overlay is paint
  // only — clearing it on mode exit keeps a stale reachable set off the
  // battlefield.
  deps.register('COMBAT_SELECTION_HIGHLIGHTS', (cmd) => {
    deps.setSelectionHighlights({
      legalEndpoints: cmd.legalEndpoints,
      legalTargetCells: cmd.legalTargetCells,
    });
  });

  // Forward the combat bridge commands (C-145, C-514 AC-4)
  registerCombatBridgeCommands({
    register: (type, handler) => deps.register(type, handler),
    post: (command) => deps.postToWorker({ type: 'BRIDGE_COMMAND', command }),
  });

  // Forward UPDATE_PLAYER_APPEARANCE commands (C-163)
  deps.register('UPDATE_PLAYER_APPEARANCE', (cmd) => {
    deps.postToWorker({
      type: 'BRIDGE_COMMAND',
      command: {
        type: 'UPDATE_PLAYER_APPEARANCE',
        slots: cmd.slots,
      },
    });
  });

  // Forward INTERACT commands (C-161 camera zoom)
  deps.register('INTERACT', (cmd) => {
    deps.postToWorker({
      type: 'BRIDGE_COMMAND',
      command: { type: 'INTERACT', targetEntityId: cmd.targetEntityId },
    });
  });

  // Forward SET_ENVIRONMENT_CONFIG commands (C-213)
  deps.register('SET_ENVIRONMENT_CONFIG', (cmd) => {
    deps.postToWorker({
      type: 'BRIDGE_COMMAND',
      command: {
        type: 'SET_ENVIRONMENT_CONFIG',
        timeScale: cmd.timeScale,
        windVelocity: cmd.windVelocity,
        rainIntensity: cmd.rainIntensity,
        startHour: cmd.startHour,
        weatherMode: cmd.weatherMode,
      },
    });
  });

  // Forward SET_COMPANION_RECRUITED commands (C-212, C-340)
  deps.register('SET_COMPANION_RECRUITED', (cmd) => {
    deps.postToWorker({
      type: 'BRIDGE_COMMAND',
      command: {
        type: 'SET_COMPANION_RECRUITED',
        entityId: cmd.entityId,
        recruited: cmd.recruited,
      },
    });
  });
};
