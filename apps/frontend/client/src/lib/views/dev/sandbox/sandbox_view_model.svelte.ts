// apps/frontend/client/src/lib/views/dev/sandbox/sandbox_view_model.svelte.ts

import type { EngineBridge, GameWorldOptions } from '@aikami/frontend/engine';
import {
  BaseEngineClass,
  createEngineBridge,
  GameWorld,
  TextureManager,
} from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { getLpcAssetPath } from '$lib/data/lpc_asset_catalog';
import { textGenerationService } from '$services';

/** Lazily-resolved ECS worker constructor (SSR-safe dynamic import). */
let _ecsWorkerCtor: (new () => Worker) | undefined;

const _resolveEcsWorker = async (): Promise<new () => Worker> => {
  if (_ecsWorkerCtor) {
    return _ecsWorkerCtor;
  }
  const mod = await import('@aikami/frontend/engine/worker/ecs_worker.ts?worker&type=module');
  _ecsWorkerCtor = mod.default as unknown as new () => Worker;
  return _ecsWorkerCtor;
};

export type SandboxViewModelInterface = BaseViewModelInterface & {
  /** Whether the NPC dialog overlay is shown (pauses the game). */
  readonly showDialog: boolean;
  /** Display name of the NPC being interacted with. */
  readonly dialogNpcName: string;
  /** Dialog text from the NPC — built token-by-token during streaming. */
  readonly dialogText: string;
  /** Whether the AI text stream is actively generating tokens. */
  readonly isStreaming: boolean;
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
  isStreaming = $state<boolean>(false);
  interactionHint = $state<string | undefined>(undefined);
  engineReady = $state<boolean>(false);
  engineError = $state<string | undefined>(undefined);

  private _engineBridge: EngineBridge | undefined;
  private _gameWorld: GameWorld | undefined;
  private _dialogEndCleanup: (() => void) | undefined;
  private _readyCleanup: (() => void) | undefined;
  private _activeStreamAbortController: AbortController | undefined;

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

      // Resolve ECS worker (SSR-safe dynamic import).
      const EcsWorker = await _resolveEcsWorker();

      const tm = new TextureManager();

      const paletteBytes = new Uint8Array(1024);

      const SANDBOX_RECIPES: Record<number, import('@aikami/frontend/engine').LpcLayerRecipe> = {
        // Player
        1: { slot: 'body', assetId: 'body/bodies_male', hexPalette: paletteBytes },
        2: { slot: 'hair', assetId: 'hair/plain_adult', hexPalette: paletteBytes },
        3: { slot: 'legs', assetId: 'legs/pants_male', hexPalette: paletteBytes },
        4: { slot: 'head', assetId: 'head/heads/human_male', hexPalette: paletteBytes },
        // NPC
        10: { slot: 'body', assetId: 'body/bodies_female', hexPalette: paletteBytes },
        11: { slot: 'hair', assetId: 'hair/long_adult', hexPalette: paletteBytes },
        12: { slot: 'legs', assetId: 'legs/pants_female', hexPalette: paletteBytes },
        13: { slot: 'head', assetId: 'head/heads/human_female', hexPalette: paletteBytes },
      };

      const worldOptions: GameWorldOptions = {
        className: 'GameWorld',
        bridge: this._engineBridge,
        textureManager: tm,
        recipeResolver: (layerIds) =>
          layerIds
            .map((id) => SANDBOX_RECIPES[id])
            .filter(Boolean) as import('@aikami/frontend/engine').LpcLayerRecipe[],
        assetUrlResolver: (slot, assetId, state) =>
          getLpcAssetPath(
            slot,
            assetId,
            state as unknown as import('$lib/data/lpc_models').LpcAnimationState,
          ),
        workerFactory: () => new EcsWorker(),
      };
      this._gameWorld = GameWorld.create(worldOptions);

      // Key press (E): open full dialog, pause game, stream AI response
      this._gameWorld.onInteractRequest((npc) => {
        this.debug('sandbox:interact-request', { npcName: npc.npcName });
        void this._startAiStream(npc);
      });

      this.debug('sandbox:initializeEngine:creating-app');
      await this._gameWorld.initialize({
        canvas,
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        resizeTo: canvas.parentElement ?? undefined,
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
  // Dialog management — AI streaming
  // -----------------------------------------------------------------------

  /**
   * Opens the dialog overlay, stops the player, locks input, and streams
   * an AI-generated greeting from the NPC.
   *
   * Falls back to a mock stream if the AI service is unavailable.
   */
  private async _startAiStream(npc: {
    npcName: string;
    npcId: string;
    personaId: string;
  }): Promise<void> {
    if (this.showDialog) {
      return;
    }

    this.dialogNpcName = npc.npcName;
    this.dialogText = '';
    this.showDialog = true;
    this.isStreaming = true;
    this.interactionHint = undefined;

    this._engineBridge?.send({ type: 'STOP_PLAYER' });
    this._gameWorld?.setInputLocked(true);

    this._activeStreamAbortController = new AbortController();
    const { signal } = this._activeStreamAbortController;

    const systemPrompt = [
      `You are ${npc.npcName}, an NPC in a 2D RPG.`,
      'The player has just walked up to you.',
      'Greet them in 1-2 short sentences.',
      'Speak in-character — respond as the NPC would.',
    ].join(' ');

    this.debug('dialog:stream-start', { npcName: npc.npcName });

    try {
      await textGenerationService.streamChat({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Hello!' },
        ],
        signal,
        onChunk: (text: string) => {
          this.dialogText += text;
        },
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        this.debug('dialog:stream-aborted');
        return;
      }

      this.debug('dialog:stream-failed', { error: String(err) });
      await this._generateMockStream(npc.npcName);
    } finally {
      this.isStreaming = false;
      this._activeStreamAbortController = undefined;
      this.debug('dialog:stream-end', { npcName: npc.npcName });
    }
  }

  /**
   * Generates a mock NPC greeting when the AI service is unreachable.
   */
  private async _generateMockStream(npcName: string): Promise<void> {
    const mockText = `Hello there! I'm ${npcName}. Welcome to the sandbox — feel free to explore!`;
    this.debug('dialog:mock-fallback', { npcName, length: mockText.length });

    for (const char of mockText) {
      this.dialogText += char;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }

  /**
   * Closes the dialog overlay, aborts any active AI stream, and resumes
   * game rendering and input.
   */
  private _closeDialog(): void {
    if (!this.showDialog) {
      return;
    }

    if (this._activeStreamAbortController) {
      this._activeStreamAbortController.abort();
      this._activeStreamAbortController = undefined;
    }

    this.showDialog = false;
    this.dialogNpcName = '';
    this.dialogText = '';
    this.isStreaming = false;

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
