// packages/frontend/engine/src/state/game_mode.ts

// ---------------------------------------------------------------------------
// Engine-level game mode state
//
// The worker reads this to gate movement (only EXPLORE allows player
// movement). Set by the main thread via SET_GAME_MODE bridge command.
// ---------------------------------------------------------------------------

/** The current game mode — defaults to EXPLORE (free movement). */
let _currentMode: 'EXPLORE' | 'DIALOGUE' | 'MENU' = 'EXPLORE';

/**
 * Sets the engine-level game mode.
 *
 * Called by the worker when it receives a SET_GAME_MODE command from
 * the main thread via the EngineBridge.
 */
const setEngineGameMode = (mode: 'EXPLORE' | 'DIALOGUE' | 'MENU'): void => {
  _currentMode = mode;
};

/**
 * Returns the current engine-level game mode.
 *
 * Called by {@link import('../systems/movement_system.ts').updateMovement}
 * to gate player movement — movement is skipped when the mode is not EXPLORE.
 */
const getEngineGameMode = (): 'EXPLORE' | 'DIALOGUE' | 'MENU' => {
  return _currentMode;
};

export { getEngineGameMode, setEngineGameMode };
