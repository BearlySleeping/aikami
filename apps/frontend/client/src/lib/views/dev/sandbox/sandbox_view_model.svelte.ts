// apps/frontend/client/src/lib/views/dev/sandbox/sandbox_view_model.svelte.ts

import type { EngineBridge } from '@aikami/frontend/engine';
import { BaseEngineClass, createEngineBridge, GameWorld } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';

export type SandboxViewModelInterface = BaseViewModelInterface & {
  /** Whether the NPC dialog overlay is shown (pauses the game). */
  readonly showDialog: boolean;
  /** Display name of the NPC being interacted with. */
  readonly dialogNpcName: string;
  /** Dialog text from the NPC. */
  readonly dialogText: string;
  /** Shown when player is near an NPC — prompts to press E. */
  readonly interactionHint: string | undefined;
  /** Whether the game engine is initialized and running. */
  readonly engineReady: boolean;
  /** Engine initialization error, surfaced to the user. */
  readonly engineError: string | undefined;
  /** Dismisses the current dialog and resumes the game. */
  dismissDialog: () => void;
  /** Initializes the game engine, binding it to the given canvas. */
  initializeEngine: (canvas: HTMLCanvasElement) => Promise<void>;
  /** Destroys the engine, releasing WebGL and worker resources. */
  destroyEngine: () => void;
};

export type SandboxViewModelOptions = BaseViewModelOptions & {};

class SandboxViewModel
  extends BaseViewModel<SandboxViewModelOptions>
  implements SandboxViewModelInterface
{
  showDialog = $state<boolean>(false);
  dialogNpcName = $state<string>('');
  dialogText = $state<string>('');
  interactionHint = $state<string | undefined>(undefined);
  engineReady = $state<boolean>(false);
  engineError = $state<string | undefined>(undefined);

  private _engineBridge: EngineBridge | undefined;
  private _gameWorld: GameWorld | undefined;
  private _dialogEndCleanup: (() => void) | undefined;
  private _readyCleanup: (() => void) | undefined;

  /**
   * Initializes the game engine, creating the Web Worker simulation and
   * binding the PixiJS renderer to the given canvas element.
   *
   * Idempotent — subsequent calls after the first are no-ops.
   */
  async initializeEngine(canvas: HTMLCanvasElement): Promise<void> {
    if (this._gameWorld) {
      return;
    }

    this.debug('sandbox:initializeEngine:start', {
      canvasW: canvas.clientWidth,
      canvasH: canvas.clientHeight,
      crossOriginIsolated: typeof self !== 'undefined' ? self.crossOriginIsolated : 'n/a',
    });

    try {
      this._engineBridge = createEngineBridge();
      this.debug('sandbox:initializeEngine:bridge-ready');

      // Proximity: show "Press E to interact" hint (no pause)
      this._engineBridge.on('NPC_DIALOG_START', (event) => {
        this.debug('sandbox:event:NPC_DIALOG_START', { npcName: event.npcName });
        this.interactionHint = `Press E to interact with ${event.npcName}`;
      });

      // Proximity exit: hide hint
      this._dialogEndCleanup = this._engineBridge.on('NPC_DIALOG_END', () => {
        this.debug('sandbox:event:NPC_DIALOG_END');
        this.interactionHint = undefined;
      });

      // Listen for GAME_READY — spawn an NPC for interaction testing
      this._readyCleanup = this._engineBridge.on('GAME_READY', () => {
        this.debug('sandbox:event:GAME_READY');
        this.engineReady = true;

        try {
          this._engineBridge?.send({
            type: 'SPAWN_NPC',
            npcData: {
              npcId: 'sandbox-guide',
              npcName: 'Guide',
              x: 500,
              y: 250,
              textureKey: 'npc_guide',
              dialog: 'Welcome to the sandbox! Press E to interact.',
              interactionRadius: 64,
              personaId: 'guide',
              relationshipValue: 0,
            },
          });
          this.debug('sandbox:spawn-npc-sent');
        } catch (err) {
          this.debug('sandbox:spawn-npc-failed', { error: String(err) });
        }
      });

      // Listen for game errors
      this._engineBridge.on('GAME_ERROR', (event) => {
        this.debug('sandbox:event:GAME_ERROR', { message: event.message });
        this.engineError = event.message;
      });

      this._gameWorld = GameWorld.create({ className: 'GameWorld', bridge: this._engineBridge });

      // Key press (E): open full dialog, pause game, stop player movement
      this._gameWorld.onInteractRequest((npc) => {
        this.debug('sandbox:interact-request', { npcName: npc.npcName });
        this._openDialog(
          npc.npcName,
          `Hello! I'm ${npc.npcName}. This is the sandbox interaction test.`,
        );
      });

      this.debug('sandbox:initializeEngine:creating-app');
      await this._gameWorld.initialize({
        canvas,
        width: canvas.clientWidth,
        height: canvas.clientHeight,
      });

      this.debug('sandbox:initializeEngine:complete');

      // Register backtick key to toggle render debug logging
      this._setupRenderDebugToggle();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.debug('sandbox:initializeEngine:error', { error: message, stack: (err as Error).stack });
      this.engineError = message;
    }
  }

  destroyEngine(): void {
    if (this._dialogEndCleanup) {
      this._dialogEndCleanup();
      this._dialogEndCleanup = undefined;
    }

    if (this._readyCleanup) {
      this._readyCleanup();
      this._readyCleanup = undefined;
    }

    if (this._gameWorld) {
      this._gameWorld.destroy();
      this._gameWorld = undefined;
    }

    this._engineBridge = undefined;
    this.engineReady = false;
    this.engineError = undefined;
  }

  override async dispose(): Promise<void> {
    if (this._renderDebugCleanup) {
      this._renderDebugCleanup();
      this._renderDebugCleanup = undefined;
    }
    this.destroyEngine();
    await super.dispose();
  }

  // -----------------------------------------------------------------------
  // Dialog management
  // -----------------------------------------------------------------------

  /**
   * Opens the dialog overlay, stops the player, pauses game rendering.
   *
   * Called on E key press near an NPC. The dialog stays open until the
   * player clicks Continue or presses E again — it does NOT auto-close
   * when the player moves out of range.
   */
  private _openDialog(npcName: string, text: string): void {
    if (this.showDialog) {
      return;
    }

    this.dialogNpcName = npcName;
    this.dialogText = text;
    this.showDialog = true;
    this.interactionHint = undefined;

    // Stop player movement so they don't drift out of range
    this._engineBridge?.send({ type: 'STOP_PLAYER' });

    // Lock movement input only — keep rendering so world stays visible behind dialog
    this._gameWorld?.setInputLocked(true);

    this.debug('dialog:open', { npcName });
  }

  /**
   * Closes the dialog overlay, resumes game rendering and input.
   */
  private _closeDialog(): void {
    if (!this.showDialog) {
      return;
    }

    this.showDialog = false;
    this.dialogNpcName = '';
    this.dialogText = '';

    this._gameWorld?.setInputLocked(false);

    this.debug('dialog:close');
  }

  /** Public method for the view to dismiss the dialog. */
  dismissDialog(): void {
    this._closeDialog();
  }

  // -----------------------------------------------------------------------
  // Render debug toggle
  // -----------------------------------------------------------------------

  private _renderDebugCleanup: (() => void) | undefined;

  private _setupRenderDebugToggle(): void {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === '`') {
        event.preventDefault();
        const enabled = !BaseEngineClass.renderDebugEnabled;
        BaseEngineClass.setRenderDebug(enabled);
        this.debug(`render-debug:${enabled ? 'on' : 'off'}`);
      }
    };

    window.addEventListener('keydown', handler);
    this._renderDebugCleanup = (): void => {
      window.removeEventListener('keydown', handler);
    };
  }
}

export const getSandboxViewModel = (options: SandboxViewModelOptions): SandboxViewModelInterface =>
  new SandboxViewModel(options);
