// apps/frontend/client/src/lib/views/dev/sandbox/camera/camera_sandbox_view_model.svelte.ts
//
// ViewModel for the Camera & Spatial UI sandbox route.
// Mounts a GameWorld with a tilemap and provides devtools for inspecting
// camera zoom, NPC screen-space position, and spatial speech bubble rendering.
//
// Contract: C-161 Spatial UI Camera — devtool sandbox

import type {
  EngineBridge,
  GameWorld,
  GameWorldOptions,
  LpcLayerRecipe,
} from '@aikami/frontend/engine';
import { createEngineBridge, GameWorld as GW, TextureManager } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { getLpcAssetPath } from '$lib/data/lpc_asset_catalog';
import { gameStateService } from '$services';

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

// ---------------------------------------------------------------------------
// Debug log entry
// ---------------------------------------------------------------------------

type DebugLogEntry = {
  /** Timestamp for ordering. */
  time: number;
  /** Short label (event type or action name). */
  label: string;
  /** Optional detail string. */
  detail: string;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CameraSandboxViewModelInterface = BaseViewModelInterface & {
  readonly engineReady: boolean;
  readonly engineError: string | undefined;
  readonly currentMap: string | undefined;
  readonly interactionHint: string | undefined;

  // Camera devtools
  readonly cameraZoom: number;
  readonly npcScreenX: number;
  readonly npcScreenY: number;
  readonly trackingNpcPosition: boolean;
  readonly dialogueZoomActive: boolean;

  // Controls
  toggleMockDialogue: () => void;
  endMockDialogue: () => void;
  readonly mockDialogueActive: boolean;
  readonly activeNpcName: string;
  readonly activeNpcDialog: string;
  /** Number of NPCs known to the main thread (_npcMeta). */
  readonly npcCount: number;
  /** Recent debug log entries (newest first). */
  readonly debugLog: DebugLogEntry[];
  /** Clears the debug log. */
  clearDebugLog: () => void;

  initializeEngine: (canvas: HTMLCanvasElement) => Promise<void>;
  destroyEngine: () => void;
};

export type CameraSandboxViewModelOptions = BaseViewModelOptions & {};

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

class CameraSandboxViewModel
  extends BaseViewModel<CameraSandboxViewModelOptions>
  implements CameraSandboxViewModelInterface
{
  engineReady = $state<boolean>(false);
  engineError = $state<string | undefined>(undefined);
  currentMap = $state<string | undefined>(undefined);
  interactionHint = $state<string | undefined>(undefined);

  cameraZoom = $state<number>(1.0);
  npcScreenX = $state<number>(-1);
  npcScreenY = $state<number>(-1);
  trackingNpcPosition = $state<boolean>(false);
  dialogueZoomActive = $state<boolean>(false);
  mockDialogueActive = $state<boolean>(false);
  activeNpcName = $state<string>('');
  activeNpcDialog = $state<string>('');

  npcCount = $state<number>(0);
  debugLog = $state<DebugLogEntry[]>([]);

  private _engineBridge: EngineBridge | undefined;
  private _gameWorld: GameWorld | undefined;
  private _readyCleanup: (() => void) | undefined;
  private _cameraUpdateCleanup: (() => void) | undefined;
  private _initialMapLoaded = false;

  /** Max debug log entries to keep in memory. */
  private static readonly _MAX_LOG = 30;

  private _addLog(label: string, detail = ''): void {
    const entry: DebugLogEntry = { time: Date.now(), label, detail };
    this.debugLog = [entry, ...this.debugLog.slice(0, CameraSandboxViewModel._MAX_LOG - 1)];
  }

  clearDebugLog(): void {
    this.debugLog = [];
  }

  async initializeEngine(canvas: HTMLCanvasElement): Promise<void> {
    if (this._gameWorld) {
      return;
    }

    this._addLog('INIT', `canvas ${canvas.clientWidth}×${canvas.clientHeight}`);
    this.debug('camera-sandbox:initializeEngine:start', {
      canvasW: canvas.clientWidth,
      canvasH: canvas.clientHeight,
    });

    try {
      this._engineBridge = createEngineBridge();

      this._readyCleanup = this._engineBridge.on('GAME_READY', () => {
        this._addLog('GAME_READY');
        this.engineReady = true;
        if (this._initialMapLoaded) {
          return;
        }
        this._initialMapLoaded = true;
        void this._loadZoneA();
      });

      this._engineBridge.on('GAME_ERROR', (event) => {
        this._addLog('ERROR', event.message);
        this.engineError = event.message;
      });

      this._engineBridge.on('NPC_DIALOG_START', (event) => {
        this._addLog('PROXIMITY', `near ${event.npcName}`);
        this.interactionHint = `Press E to interact with ${event.npcName}`;
      });

      this._engineBridge.on('NPC_DIALOG_END', () => {
        this._addLog('PROX_END');
        this.interactionHint = undefined;
      });

      // Fires from BOTH the main-thread _handleInteractKey AND the worker bridge.
      // Handles both NPC_INTERACTED (dialogue) and VENDOR_INTERACTED (trading).
      this._engineBridge.on('NPC_INTERACTED', (event) => {
        this._addLog('INTERACTED', `NPC=${event.npcName}`);
        this.interactionHint = `🗣️ Speaking with ${event.npcName} — zoom active`;
        this.dialogueZoomActive = true;
        this.activeNpcName = event.npcName;
        this.activeNpcDialog = event.dialog || '';
      });

      this._engineBridge.on('VENDOR_INTERACTED', (event) => {
        this._addLog('VENDOR', `NPC=${event.npcName}`);
        this.interactionHint = `🛒 Trading with ${event.npcName} — zoom active`;
        this.dialogueZoomActive = true;
        this.activeNpcName = event.npcName;
        this.activeNpcDialog = event.dialog || 'What would you like to buy?';
      });

      this._cameraUpdateCleanup = this._engineBridge.on('CAMERA_ZOOM_UPDATE', (event) => {
        this.cameraZoom = event.zoom;
        if (event.npcScreenX !== undefined && event.npcScreenY !== undefined) {
          this.npcScreenX = event.npcScreenX;
          this.npcScreenY = event.npcScreenY;
          this.trackingNpcPosition = true;
          // dialogueZoomActive is set by NPC_INTERACTED / VENDOR_INTERACTED,
          // NOT here — avoids a race with endMockDialogue cleanup.
        } else {
          this.trackingNpcPosition = false;
          this.dialogueZoomActive = false;
        }
      });

      // MAP_LOADED — capture NPC count and optionally auto-trigger
      this._engineBridge.on('MAP_LOADED', () => {
        this.debug('C-161:MAP_LOADED');
        this._addLog('MAP_LOADED');
        // Read NPC count from the GameWorld (via internal access)
        const gw = this._gameWorld as unknown as { _npcMeta?: Map<number, unknown> };
        this.npcCount = gw._npcMeta?.size ?? 0;
        this._addLog('NPC_COUNT', String(this.npcCount));

        // Auto-trigger dialogue if ?trigger param is present
        if (typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search);
          if (params.has('trigger')) {
            this.debug('C-161:TRIGGER spawning test NPC at player pos');
            // Spawn a test NPC right next to the player so INTERACT finds it
            this._engineBridge?.send({
              type: 'SPAWN_NPC',
              npcData: {
                npcId: 'camera-sandbox-test',
                npcName: 'Guide',
                x: 192,
                y: 192,
                textureKey: 'npc_test',
                dialog: 'Hello! This is a camera zoom test.',
                interactionRadius: 128,
                personaId: 'guide',
                relationshipValue: 0,
              },
            });
            // Give the worker a tick to create the NPC, then switch mode and send INTERACT
            setTimeout(() => {
              this.debug('C-161:TRIGGER sending DIALOGUE mode + INTERACT');
              this._engineBridge?.send({ type: 'SET_GAME_MODE', mode: 'DIALOGUE' });
              this._engineBridge?.send({ type: 'INTERACT', targetEntityId: '0' });
            }, 500);
          }
        }
      });

      const EcsWorker = await _resolveEcsWorker();
      const tm = new TextureManager();
      const paletteBytes = new Uint8Array(1024);

      const SANDBOX_RECIPES: LpcLayerRecipe[] = [
        { slot: 'body', assetId: 'body/bodies_male', hexPalette: paletteBytes },
        { slot: 'hair', assetId: 'hair/plain_adult', hexPalette: paletteBytes },
        { slot: 'torso', assetId: 'torso/armour/plate_male', hexPalette: paletteBytes },
        { slot: 'legs', assetId: 'legs/pants_male', hexPalette: paletteBytes },
        { slot: 'feet', assetId: 'feet/armour/plate_male', hexPalette: paletteBytes },
        { slot: 'head', assetId: 'head/heads/human_male', hexPalette: paletteBytes },
      ];

      const worldOptions: GameWorldOptions = {
        className: 'GameWorld',
        bridge: this._engineBridge,
        textureManager: tm,
        recipeResolver: (layerIds) =>
          layerIds
            .map((id, idx) => (id > 0 ? SANDBOX_RECIPES[idx] : null))
            .filter(Boolean) as LpcLayerRecipe[],
        assetUrlResolver: (slot, assetId, state) =>
          getLpcAssetPath(
            slot,
            assetId,
            state as unknown as import('$lib/data/lpc_models').LpcAnimationState,
          ),
        workerFactory: () => new EcsWorker(),
      };
      this._gameWorld = GW.create(worldOptions);

      // Key press (E): main-thread NPC proximity → send INTERACT to worker,
      // and switch game mode to DIALOGUE so the worker tracks zoom state.
      this._gameWorld.onInteractRequest((npc) => {
        this.debug('C-161:E_KEY', { npcName: npc.npcName, eid: npc.eid });
        this._addLog('E_KEY', `NPC=${npc.npcName} eid=${npc.eid}`);
        this.interactionHint = undefined;
        // Update mode state (read by ModeIndicator)
        gameStateService.setMode('DIALOGUE');
        this.mockDialogueActive = true;
        // Switch mode to DIALOGUE — required for zoom tracking
        this._engineBridge?.send({ type: 'SET_GAME_MODE', mode: 'DIALOGUE' });
        // Send INTERACT so the worker's interaction_system calls startDialogueZoom
        this._engineBridge?.send({ type: 'INTERACT', targetEntityId: String(npc.eid) });
      });

      await this._gameWorld.initialize({
        canvas,
        width: canvas.clientWidth,
        height: canvas.clientHeight,
      });

      this._addLog('ENGINE_READY');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._addLog('INIT_ERR', message);
      this.engineError = message;
    }
  }

  private async _loadZoneA(): Promise<void> {
    if (!this._gameWorld) {
      return;
    }

    try {
      this._addLog('LOAD_MAP', '/assets/maps/sandbox_zone_a.json');
      await this._gameWorld.loadMap({
        mapUrl: '/assets/maps/sandbox_zone_a.json',
        targetX: 160,
        targetY: 192,
      });
      this.currentMap = 'sandbox_zone_a.json';
    } catch (err) {
      this._addLog('MAP_ERR', String(err));
    }
  }

  toggleMockDialogue(): void {
    if (!this._engineBridge || !this.engineReady) {
      return;
    }

    if (this.mockDialogueActive) {
      this.endMockDialogue();
      return;
    }

    this.mockDialogueActive = true;
    gameStateService.setMode('DIALOGUE');
    this._addLog('MOCK_ON', 'sending SET_GAME_MODE DIALOGUE');
    this._engineBridge.send({ type: 'SET_GAME_MODE', mode: 'DIALOGUE' });
  }

  endMockDialogue(): void {
    if (!this._engineBridge) {
      return;
    }

    this.mockDialogueActive = false;
    this.dialogueZoomActive = false;
    this.trackingNpcPosition = false;
    this.activeNpcName = '';
    this.activeNpcDialog = '';
    gameStateService.setMode('EXPLORE');
    this._addLog('MOCK_OFF');
    this._engineBridge.send({ type: 'SET_GAME_MODE', mode: 'EXPLORE' });
  }

  destroyEngine(): void {
    if (this._readyCleanup) {
      this._readyCleanup();
      this._readyCleanup = undefined;
    }
    if (this._cameraUpdateCleanup) {
      this._cameraUpdateCleanup();
      this._cameraUpdateCleanup = undefined;
    }

    if (this._gameWorld) {
      this._gameWorld.destroy();
      this._gameWorld = undefined;
    }

    this._engineBridge = undefined;
    this.engineReady = false;
    this.engineError = undefined;
    this.currentMap = undefined;
    this._initialMapLoaded = false;
    this.mockDialogueActive = false;
    this.dialogueZoomActive = false;
    this.trackingNpcPosition = false;
    this.cameraZoom = 1.0;
    this.npcScreenX = -1;
    this.npcScreenY = -1;
    this.npcCount = 0;
    this.activeNpcName = '';
    this.activeNpcDialog = '';
  }

  override async dispose(): Promise<void> {
    this.destroyEngine();
    await super.dispose();
  }
}

export const getCameraSandboxViewModel = (
  options: CameraSandboxViewModelOptions,
): CameraSandboxViewModelInterface => new CameraSandboxViewModel(options);
