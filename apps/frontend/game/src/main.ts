// apps/frontend/game/src/main.ts

import { createEngineBridge, GameWorld } from './engine/index.ts';
import { MenuController } from './menu/menu-controller.ts';

// ---------------------------------------------------------------------------
// Application entry point — boots menu first, game on demand
// ---------------------------------------------------------------------------

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error('Canvas element #game-canvas not found');
}

// Ensure TypeScript sees canvas as non-null after guard
const gameCanvas: HTMLCanvasElement = canvas;

const menu = new MenuController();

let gameWorld: GameWorld | undefined;
let initialized = false;

menu.onScreenChange(async (screen) => {
  if (screen === 'game') {
    await startGame();
  } else if (screen === 'menu') {
    stopGame();
  }
});

/**
 * Starts the game engine on the canvas.
 */
async function startGame(): Promise<void> {
  if (gameWorld) {
    gameWorld.resume();
    return;
  }

  const { width, height } = menu.getResolution();

  // Update canvas dimensions to match selected resolution
  gameCanvas.width = width;
  gameCanvas.height = height;

  const bridge = createEngineBridge();
  gameWorld = new GameWorld(bridge);

  try {
    await gameWorld.initialize({ canvas: gameCanvas, width, height });
    initialized = true;
  } catch (err) {
    console.error('Failed to initialize game world:', err);
    bridge.emit({ type: 'GAME_ERROR', message: String(err) });
  }
}

/**
 * Stops the game engine and returns to menu.
 */
function stopGame(): void {
  if (gameWorld) {
    gameWorld.destroy();
    gameWorld = undefined;
  }
  initialized = false;
}
