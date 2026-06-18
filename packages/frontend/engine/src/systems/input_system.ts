// apps/frontend/game/src/engine/systems/input_system.ts

import type { World } from 'bitecs';
import { addComponent, set } from 'bitecs';
import type { VelocityData } from '../components/velocity.ts';
import { Velocity } from '../components/velocity.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import { getEngineGameMode } from '../state/game_mode.ts';
import type { Direction } from '../types.ts';

// ---------------------------------------------------------------------------
// InputSystem — translate keyboard events to velocity changes
// ---------------------------------------------------------------------------

/** Base movement speed in pixels per second. */
const PLAYER_SPEED = 150;

/**
 * Direction-to-velocity lookup table.
 *
 * Each entry normalizes the direction into a unit vector multiplied by
 * the per-frame player speed.
 */
const DIRECTION_VELOCITY: Record<Direction, VelocityData> = {
  up: { x: 0, y: -PLAYER_SPEED },
  down: { x: 0, y: PLAYER_SPEED },
  left: { x: -PLAYER_SPEED, y: 0 },
  right: { x: PLAYER_SPEED, y: 0 },
};

/**
 * Registers keyboard input listeners that update the player entity's
 * {@link Velocity} component.
 *
 * Listens for MOVE_PLAYER/STOP_PLAYER commands on the bridge (sent from
 * the UI) and for keyboard events on the window. This system does NOT run
 * per-frame — it reacts to discrete input events.
 *
 * @param world - The bitECS world.
 * @param playerEntityId - The entity ID of the player.
 * @param bridge - The EngineBridge for receiving commands.
 * @returns An unsubscribe function that removes all listeners.
 */
const setupInput = (world: World, playerEntityId: number, bridge: EngineBridge): (() => void) => {
  if (!world || !bridge) {
    return (): void => {};
  }

  const unsubs: Array<() => void> = [];

  // Listen for MOVE_PLAYER and STOP_PLAYER commands from the UI.
  const moveHandler = (cmd: { direction: Direction }): void => {
    const vel = DIRECTION_VELOCITY[cmd.direction];
    if (!vel) {
      return;
    }
    addComponent(world, playerEntityId, set(Velocity, vel));
  };

  const stopHandler = (): void => {
    addComponent(world, playerEntityId, set(Velocity, { x: 0, y: 0 }));
  };

  // Use bridge's internal onCommand (available on MockEngineBridge and EngineBridgeImpl)
  const bridgeWithCommands = bridge as unknown as {
    onCommand: (type: string, handler: (cmd: unknown) => void) => () => void;
  };
  if (typeof bridgeWithCommands.onCommand === 'function') {
    const unsubMove = bridgeWithCommands.onCommand(
      'MOVE_PLAYER',
      moveHandler as (cmd: unknown) => void,
    );
    const unsubStop = bridgeWithCommands.onCommand('STOP_PLAYER', stopHandler);
    unsubs.push(unsubMove, unsubStop);
  }

  // Keyboard input: WASD + arrow keys
  const handleKeyDown = (event: KeyboardEvent): void => {
    // Gate on game mode — only process movement keys in EXPLORE mode.
    // During COMBAT/MENU/DIALOGUE, keyboard events pass through to the
    // overlay UI (combat dialog text input, etc.).
    if (getEngineGameMode() !== 'EXPLORE') {
      return;
    }

    const direction = keyToDirection(event.key);
    if (!direction) {
      return;
    }

    // Prevent browser default scrolling for game keys
    event.preventDefault();

    addComponent(world, playerEntityId, set(Velocity, DIRECTION_VELOCITY[direction]));
  };

  const handleKeyUp = (event: KeyboardEvent): void => {
    // Gate on game mode — same as keydown above
    if (getEngineGameMode() !== 'EXPLORE') {
      return;
    }

    const direction = keyToDirection(event.key);
    if (!direction) {
      return;
    }

    // Only stop if the released key matches the current direction.
    // Read from the SoA array directly to avoid observer overhead.
    const currentVx = Velocity.x[playerEntityId] ?? 0;
    const currentVy = Velocity.y[playerEntityId] ?? 0;
    const releasedVel = DIRECTION_VELOCITY[direction];
    if (currentVx === releasedVel.x && currentVy === releasedVel.y) {
      addComponent(world, playerEntityId, set(Velocity, { x: 0, y: 0 }));
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);

  return (): void => {
    for (const unsub of unsubs) {
      unsub();
    }
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a KeyboardEvent key to a movement direction.
 *
 * @param key - The `event.key` value.
 * @returns The corresponding direction, or `undefined` if not a movement key.
 */
const keyToDirection = (key: string): Direction | undefined => {
  switch (key) {
    case 'w':
    case 'W':
    case 'ArrowUp':
      return 'up';
    case 's':
    case 'S':
    case 'ArrowDown':
      return 'down';
    case 'a':
    case 'A':
    case 'ArrowLeft':
      return 'left';
    case 'd':
    case 'D':
    case 'ArrowRight':
      return 'right';
    default:
      return undefined;
  }
};

export { PLAYER_SPEED, setupInput };
