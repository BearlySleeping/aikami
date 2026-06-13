// apps/frontend/client/src/lib/services/game/game_load_state.svelte.ts

/**
 * Simple module-level payload store for cross-route game load handoff.
 *
 * When the Dashboard ViewModel loads a saved game, it stores the ECS
 * payload here and navigates to /game. The Game ViewModel checks for
 * a pending payload during initialization and passes it to GameWorld.
 */

let pendingPayload: string | undefined;

/** Stores an ECS snapshot payload for the next game initialization. */
export const setPendingGameLoad = (payload: string): void => {
  pendingPayload = payload;
};

/** Consumes the pending ECS snapshot payload, clearing it after read. */
export const consumePendingGameLoad = (): string | undefined => {
  const payload = pendingPayload;
  pendingPayload = undefined;
  return payload;
};
