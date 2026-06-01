// apps/frontend/game/src/main.ts

import { createEngineBridge, GameWorld } from '@aikami/engine';
import { publicEnv } from '@aikami/frontend/configs/environment';
import { getAuthPixiScene } from '$lib/menu/auth_pixi_scene.ts';
import { getMenuController } from '$lib/menu/menu_controller.ts';
import { type AuthHandoffState, getAuthController } from '$lib/services/auth_controller.ts';
import { getFirebase } from '$lib/services/firebase/firebase_app.ts';
import { getDialogueController } from '$lib/ui/dialogue_controller.ts';

// ---------------------------------------------------------------------------
// Application entry point — boots menu first, game on demand
// ---------------------------------------------------------------------------

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error('Canvas element #game-canvas not found');
}

// Ensure TypeScript sees canvas as non-null after guard
const gameCanvas: HTMLCanvasElement = canvas;

const menu = getMenuController({ className: 'MenuController' });
const auth = getAuthController({ className: 'AuthController' });
const authScene = getAuthPixiScene({ className: 'AuthPixiScene', canvas: gameCanvas });

let gameWorld: GameWorld | undefined;
let dialogueController: ReturnType<typeof getDialogueController> | undefined;

// ── Restore existing session on page load ────────────────────────

const fb = getFirebase();
if (fb.auth.isAuthenticated && fb.auth.currentUser) {
  const user = fb.auth.currentUser;
  menu.setAuthState({
    isLoggedIn: true,
    displayName: user.email || user.uid || 'Player',
  });
} else {
  menu.setAuthState({ isLoggedIn: false, displayName: '' });
}

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
  const pwaBaseUrl = publicEnv.PUBLIC_PWA_URL;
  if (!pwaBaseUrl) {
    throw new Error('PUBLIC_PWA_URL not defined');
  }

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

  // Get Firebase Functions client for dialogue API calls
  const fb = getFirebase();
  const functions = fb.functions;

  gameWorld = new GameWorld(bridge);

  // Wire dialogue controller to interaction requests
  gameWorld.onInteractRequest((npcMeta) => {
    // Lock input while dialogue is active
    gameWorld?.setInputLocked(true);

    // Create or reuse dialogue controller
    if (!dialogueController) {
      dialogueController = getDialogueController({ className: 'DialogueController', functions });
    }

    dialogueController.start({
      eid: npcMeta.eid,
      npcId: npcMeta.npcId,
      personaId: npcMeta.personaId,
      npcName: npcMeta.npcName,
      relationshipValue: npcMeta.relationshipValue,
      radius: npcMeta.interactionRadius,
      position: { x: 0, y: 0 },
      inRange: false,
    });

    // When dialogue ends (via close button), unlock input
    const checkDialogueEnd = setInterval(() => {
      if (!dialogueController?.isActive && gameWorld) {
        gameWorld.setInputLocked(false);
        clearInterval(checkDialogueEnd);
      }
    }, 200);
  });

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
  if (dialogueController?.isActive) {
    dialogueController.end();
  }
  dialogueController = undefined;

  if (gameWorld) {
    gameWorld.destroy();
    gameWorld = undefined;
  }
}
