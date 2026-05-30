// apps/frontend/game/src/engine/game_world.ts
import { createWorld } from 'bitecs';
import type { Application } from 'pixi.js';
import { registerNPCDialogObservers } from './components/npc_dialog.ts';
import { registerPositionObservers } from './components/position.ts';
import { registerSpriteObservers } from './components/sprite.ts';
import { registerVelocityObservers } from './components/velocity.ts';
import type { EngineBridge } from './engine_bridge.ts';
import { createPlayer } from './entities/create_player.ts';
import { createTestSprite } from './entities/create_test_sprite.ts';
import type { PixiAppOptions } from './pixi_app.ts';
import { createPixiApp } from './pixi_app.ts';
import { updateDialogTriggers } from './systems/dialog_trigger_system.ts';
import { setupInput } from './systems/input_system.ts';
import { updateMovement } from './systems/movement_system.ts';
import { updateRender } from './systems/render_system.ts';

// ---------------------------------------------------------------------------
// GameWorld — bitECS + PixiJS lifecycle manager
// ---------------------------------------------------------------------------

/**
 * Manages the complete game engine lifecycle: PixiJS Application, bitECS
 * world, component registration, system registration, entity creation,
 * and the per-frame ticker loop.
 *
 * This class is instantiated once per game route. It owns the PixiJS
 * Application and the bitECS World. The UI layer interacts with it
 * exclusively through the {@link EngineBridge}.
 *
 * Zero framework imports. Zero reactivity. Pure imperative TypeScript.
 */
class GameWorld {
  /** The PixiJS Application (owns the canvas, ticker, stage). */
  private app: Application | undefined;

  /** The bitECS world (owns all entities, components, queries). */
  private world = createWorld();

  /** The engine bridge for UI↔Game communication. */
  private bridge: EngineBridge;

  /** The entity ID of the player entity. */
  private playerEntityId = 0;

  /** Cleanup function returned by {@link setupInput}. */
  private inputTeardown: (() => void) | undefined;

  /** Whether the game loop is currently running. */
  private running = false;

  /** PixiJS ticker callback reference for teardown. */
  private tickerCallback: (() => void) | undefined;

  /**
   * Creates a new GameWorld (uninitialized).
   *
   * Call {@link initialize} to start the engine. Call {@link destroy} to
   * tear it down and release all resources.
   *
   * @param bridge - The engine bridge to use for UI↔Game communication.
   */
  constructor(bridge: EngineBridge) {
    this.bridge = bridge;
  }

  /**
   * Initializes the game engine: creates the PixiJS application, registers
   * all bitECS components and systems, spawns the player and test sprite,
   * and starts the game loop.
   *
   * Must be called once after construction. The canvas element passed here
   * is exclusively owned by PixiJS — UI must NOT touch it after this.
   *
   * @param options - PixiJS application options (must include a canvas).
   */
  async initialize(options: PixiAppOptions): Promise<void> {
    const { canvas, width, height } = options;

    if (this.app) {
      return;
    }

    // ---- 1. Create PixiJS Application --------------------------------
    this.app = await createPixiApp({ canvas, width, height });

    // ---- 2. Register bitECS component observers ----------------------
    registerPositionObservers(this.world);
    registerVelocityObservers(this.world);
    registerSpriteObservers(this.world);
    registerNPCDialogObservers(this.world);

    // ---- 3. Spawn entities -------------------------------------------
    this.playerEntityId = createPlayer(this.world);
    if (width && height) {
      createTestSprite(this.world, width, height);
    }

    // ---- 4. Set up input system (keyboard + bridge commands) ---------
    this.inputTeardown = setupInput(this.world, this.playerEntityId, this.bridge);

    // ---- 5. Start the game loop --------------------------------------
    const stage = this.app.stage;

    this.tickerCallback = (): void => {
      if (!this.running || !this.app) {
        return;
      }

      const deltaMs = this.app.ticker.deltaMS;

      updateMovement(this.world, deltaMs);
      updateDialogTriggers(this.world, this.playerEntityId, this.bridge);
      updateRender(this.world, stage);
    };

    this.app.ticker.add(this.tickerCallback);
    this.running = true;

    // ---- 6. Signal ready ---------------------------------------------
    this.bridge.emit({ type: 'GAME_READY' });
  }

  /**
   * Pauses the game loop. Entities and systems remain loaded.
   */
  pause(): void {
    this.running = false;
  }

  /**
   * Resumes a paused game loop.
   */
  resume(): void {
    this.running = true;
  }

  /**
   * Destroys the game engine: cancels the animation loop, tears down
   * input listeners, destroys the PixiJS application (releases WebGL
   * context), and removes all bitECS entities.
   *
   * Call this when the UI component is unmounted to prevent memory
   * leaks and orphaned animation frames.
   */
  destroy(): void {
    // Stop the game loop
    this.running = false;

    if (this.app && this.tickerCallback) {
      this.app.ticker.remove(this.tickerCallback);
      this.tickerCallback = undefined;
    }

    // Tear down input listeners
    if (this.inputTeardown) {
      this.inputTeardown();
      this.inputTeardown = undefined;
    }

    // Destroy PixiJS (releases WebGL context, removes canvas listeners)
    if (this.app) {
      this.app.destroy(true, { children: true });
      this.app = undefined;
    }

    // bitECS world is cleaned up via garbage collection
    // (there's no explicit destroy in bitecs v0.4 — resetWorld replaces it)
  }
}

export { GameWorld };
