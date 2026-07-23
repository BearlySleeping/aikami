// apps/frontend/client/src/lib/services/game/game_mode_service.svelte.ts
//
// Game mode service (C-314) — owns current GameMode, mode transitions,
// and EngineBridge broadcast for SET_GAME_MODE.
//
// Extracted from game_state_service (C-314 service split).

import { setEngineGameMode } from '@aikami/frontend/engine';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { GameMode } from '$types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GameModeServiceInterface = BaseFrontendClassInterface & {
  readonly currentMode: GameMode;

  setMode(mode: GameMode): void;
  reset(): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class GameModeService
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements GameModeServiceInterface
{
  currentMode = $state<GameMode>('EXPLORE');

  /**
   * Sets the current game mode and broadcasts the change to the ECS worker
   * via the EngineBridge.
   *
   * The worker uses this to gate movement (only EXPLORE allows player movement).
   * The UI uses this to toggle overlay visibility (DIALOGUE → dialogue overlay).
   */
  setMode(mode: GameMode): void {
    if (this.currentMode === mode) {
      return;
    }

    this.currentMode = mode;

    // Broadcast to the ECS worker via the EngineBridge so the movement
    // system can gate player input.
    void this._broadcastModeToEngine(mode);
  }

  /**
   * Lazily imports the EngineBridge singleton and sends a SET_GAME_MODE
   * command to the ECS worker. Also sets the mode on the main thread so the
   * keyboard listeners in input_system.ts (which run on the main thread)
   * can gate movement keys — the worker's copy alone is not sufficient.
   */
  private async _broadcastModeToEngine(mode: GameMode): Promise<void> {
    // Synchronously update the main thread's copy so input_system.ts gates
    // keyboard events immediately — this must never be deferred, otherwise
    // the game world's keydown listeners start with a stale mode.
    setEngineGameMode(mode);

    // Async: send to the worker so ECS systems (movement, encounter, etc.) gate too
    try {
      const { createEngineBridge } = await import('@aikami/frontend/engine');
      const bridge = createEngineBridge();
      bridge.send({ type: 'SET_GAME_MODE' as never, mode } as never);
    } catch (error) {
      this.debug('_broadcastModeToEngine:failed', { mode, error: String(error) });
    }
  }

  /** @inheritdoc */
  reset(): void {
    this.currentMode = 'EXPLORE';
    // Force-broadcast to the engine to clear stale mode state from prior
    // sessions (C-332). On SPA navigation the engine module is not
    // reloaded, so module-level _currentMode may hold MENU/DIALOGUE/COMBAT
    // from the previous route. Without this broadcast, keyboard input
    // is silently dropped by the engine's movement gate.
    void this._broadcastModeToEngine('EXPLORE');
    this.debug('reset:cleared');
  }
}

export const gameModeService: GameModeServiceInterface = GameModeService.create({
  className: 'GameModeService',
});
