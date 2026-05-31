// apps/frontend/game/src/main.ts

import { createEngineBridge, GameWorld } from '@aikami/engine';
import { AuthController, type AuthHandoffState } from './core/auth/auth_controller.ts';
import { getFirebase } from './core/firebase/firebase_app.ts';
import { AuthPixiScene } from './menu/auth_pixi_scene.ts';
import { MenuController } from './menu/menu_controller.ts';

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
const auth = new AuthController();
const authScene = new AuthPixiScene(gameCanvas);

let gameWorld: GameWorld | undefined;

// ── Auth state → menu UI ─────────────────────────────────────────

auth.onStateChange((state: AuthHandoffState) => {
  switch (state.type) {
    case 'idle': {
      break;
    }
    case 'waiting': {
      // Auth scene is already shown — update status
      authScene.updateStatus('Waiting for authentication...');
      break;
    }
    case 'authenticated': {
      // Auth succeeded — clean up auth scene, update menu
      authScene.destroy().then(() => {
        const user = getFirebase().auth.currentUser;
        menu.setAuthState({
          isLoggedIn: true,
          displayName: user?.email || user?.uid || 'Player',
        });
        menu.showMenu();
      });
      break;
    }
    case 'expired': {
      authScene.updateStatus('Code expired. Returning to menu...');
      setTimeout(async () => {
        await authScene.destroy();
        menu.showMenu();
      }, 2000);
      break;
    }
    case 'error': {
      authScene.updateStatus(`Error: ${state.message}`);
      setTimeout(async () => {
        await authScene.destroy();
        menu.showMenu();
      }, 3000);
      break;
    }
  }
});

// ── Menu login → auth handoff ────────────────────────────────────

menu.onLoginRequest(() => {
  // Show the auth PixiJS scene on the canvas
  const canvasWidth = gameCanvas.width || 800;
  const canvasHeight = gameCanvas.height || 600;
  gameCanvas.width = canvasWidth;
  gameCanvas.height = canvasHeight;

  // Determine PWA base URL (same domain for local dev)
  const pwaBaseUrl = `${window.location.protocol}//${window.location.hostname}:5173`;

  // Start the auth handoff — this generates the code and opens the PWA
  auth.startHandoff({ pwaBaseUrl }).then(() => {
    const state = auth.state;
    if (state.type === 'waiting') {
      authScene.show({
        code: state.code,
        pwaUrl: state.pwaUrl,
        onCancel: () => {
          auth.cancel();
          authScene.destroy().then(() => {
            menu.showMenu();
          });
        },
      });
    }
  });
});

// ── Menu new game → character creation ───────────────────────────

menu.onNewGameRequest(() => {
  // Transition to game screen for character creation
  menu.showGame();
});

// ── Screen transitions ───────────────────────────────────────────

menu.onScreenChange(async (screen) => {
  if (screen === 'game') {
    await startGame();
  } else if (screen === 'menu') {
    stopGame();
  } else if (screen === 'login') {
    // Login screen: stop any running game, auth scene is shown separately
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
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: game project has no logger alias configured
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
}
