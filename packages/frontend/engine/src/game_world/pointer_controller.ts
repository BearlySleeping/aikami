// packages/frontend/engine/src/game_world/pointer_controller.ts
//
// Pointer input + click-to-move cursor feedback boundary.
//
// Owns the canvas pointer listeners, the hover-highlight and destination
// marker overlays, their idle-hide timer, and the destination cell. It
// resolves a click to a cell through an injected footprint-aware resolver,
// then posts the command through an injected sink — it never touches the
// worker, the scene loader, or the facade's other state directly.

import { type Container, Graphics } from 'pixi.js';
import { COMPONENT_STRIDE } from '../config/memory_config.ts';
import { WORLD_Z_BANDS } from '../rendering/layer_bands.ts';
import type { GameCommand } from '../types.ts';

/** Milliseconds the hover highlight stays visible after the last move. */
const HOVER_HIGHLIGHT_TIMEOUT_MS = 1000;

export type PointerControllerOptions = {
  /** Resolves a canvas-local point to a footprint-aware tile cell. */
  resolveCell: (screenX: number, screenY: number) => { cellX: number; cellY: number };
  /** Sends a command to the game engine. */
  postCommand: (command: GameCommand) => void;
  /** Input lock accessor (clicks are ignored while locked). */
  isLocked: () => boolean;
  /** Render-loop running accessor. */
  isRunning: () => boolean;
  /** Whether the worker has delivered a readable state buffer. */
  hasActiveView: () => boolean;
  /** The active state view (for destination arrival). */
  getActiveView: () => Float32Array | undefined;
  /** Active map tile size in pixels. */
  getTileSize: () => number;
  /** Player entity id (0 before spawn). */
  getPlayerEntityId: () => number;
  /** Diagnostic log sink. */
  log?: (label: string, detail?: Record<string, unknown>) => void;
  /** Timer indirection for tests. */
  timers?: {
    setTimeout: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
  };
};

export class PointerController {
  private readonly _resolveCell: PointerControllerOptions['resolveCell'];
  private readonly _postCommand: (command: GameCommand) => void;
  private readonly _isLocked: () => boolean;
  private readonly _isRunning: () => boolean;
  private readonly _hasActiveView: () => boolean;
  private readonly _getActiveView: () => Float32Array | undefined;
  private readonly _getTileSize: () => number;
  private readonly _getPlayerEntityId: () => number;
  private readonly _log: ((label: string, detail?: Record<string, unknown>) => void) | undefined;
  private readonly _timers: NonNullable<PointerControllerOptions['timers']>;

  private _canvas: HTMLCanvasElement | undefined;
  private _detach: (() => void) | undefined;

  private _hoverHighlight: Graphics | undefined;
  private _destinationMarker: Graphics | undefined;
  private _hoverHighlightTimeout: ReturnType<typeof setTimeout> | undefined;
  private _lastHoverCell: { cellX: number; cellY: number } | undefined;
  private _destinationCell: { cellX: number; cellY: number } | undefined;

  constructor(options: PointerControllerOptions) {
    this._resolveCell = options.resolveCell;
    this._postCommand = options.postCommand;
    this._isLocked = options.isLocked;
    this._isRunning = options.isRunning;
    this._hasActiveView = options.hasActiveView;
    this._getActiveView = options.getActiveView;
    this._getTileSize = options.getTileSize;
    this._getPlayerEntityId = options.getPlayerEntityId;
    this._log = options.log;
    this._timers = options.timers ?? {
      setTimeout: (handler, ms) => setTimeout(handler, ms),
      clearTimeout: (handle) => clearTimeout(handle),
    };
  }

  /**
   * Creates the cursor overlays and registers canvas listeners. Idempotent.
   */
  attach(target: { canvas: HTMLCanvasElement; worldContainer: Container }): void {
    if (this._detach) {
      return;
    }
    this._canvas = target.canvas;

    this._hoverHighlight ??= this._createOverlay(target.worldContainer, 'hover-highlight');
    this._destinationMarker ??= this._createOverlay(target.worldContainer, 'destination-marker');

    const onPointerDown = (event: PointerEvent): void => this._handlePointerDown(event);
    const onPointerMove = (event: PointerEvent): void => this._handlePointerMove(event);
    const onPointerLeave = (): void => this._handlePointerLeave();

    target.canvas.addEventListener('pointerdown', onPointerDown);
    target.canvas.addEventListener('pointermove', onPointerMove);
    target.canvas.addEventListener('pointerleave', onPointerLeave);

    this._detach = (): void => {
      target.canvas.removeEventListener('pointerdown', onPointerDown);
      target.canvas.removeEventListener('pointermove', onPointerMove);
      target.canvas.removeEventListener('pointerleave', onPointerLeave);
      this._clearHoverTimeout();
    };
  }

  /** Removes listeners and cancels the idle timer. Idempotent. */
  detach(): void {
    this._detach?.();
    this._detach = undefined;
  }

  /**
   * Hides the destination marker once the player reaches its cell. Called
   * once per rendered frame.
   */
  updateDestinationArrival(): void {
    if (!this._destinationMarker?.visible || !this._destinationCell) {
      return;
    }

    const renderView = this._getActiveView();
    const playerEntityId = this._getPlayerEntityId();
    if (!renderView || playerEntityId <= 0) {
      return;
    }

    const offset = playerEntityId * COMPONENT_STRIDE;
    const playerX = renderView[offset];
    const playerY = renderView[offset + 1];
    if (playerX === undefined || playerY === undefined) {
      return;
    }

    const tileSize = this._getTileSize();
    const cellX = Math.floor(playerX / tileSize);
    const cellY = Math.floor(playerY / tileSize);
    if (cellX === this._destinationCell.cellX && cellY === this._destinationCell.cellY) {
      this.clearDestinationMarker();
    }
  }

  /** Cancels the active click-to-move path (movement key or mode change). */
  cancelClickPath(): void {
    this.clearDestinationMarker();
    this._postCommand({ type: 'STOP_PLAYER' });
  }

  /** Whether the active click destination targets the given cell. */
  isAwaitingCell(cellX: number, cellY: number): boolean {
    return this._destinationCell?.cellX === cellX && this._destinationCell.cellY === cellY;
  }

  /** Hides the destination marker and forgets its target cell. */
  clearDestinationMarker(): void {
    if (this._destinationMarker) {
      this._destinationMarker.visible = false;
    }
    this._destinationCell = undefined;
  }

  private _createOverlay(worldContainer: Container, label: string): Graphics {
    const overlay = new Graphics();
    overlay.label = label;
    overlay.zIndex = WORLD_Z_BANDS.zoneOverlays;
    overlay.eventMode = 'none';
    overlay.visible = false;
    worldContainer.addChild(overlay);
    return overlay;
  }

  private _handlePointerDown(event: PointerEvent): void {
    if (event.button !== 0 || this._isLocked() || !this._isRunning() || !this._hasActiveView()) {
      return;
    }

    const { x, y } = this._canvasCoords(event);
    const { cellX, cellY } = this._resolveCell(x, y);
    this._log?.('[GameWorld] pointerDown', { screenX: x, screenY: y, cellX, cellY });

    this._showDestinationMarker(cellX, cellY);
    this._postCommand({ type: 'MOVE_TO_CELL', cellX, cellY, arriveRadius: 0 });
  }

  private _handlePointerMove(event: PointerEvent): void {
    if (this._isLocked() || !this._isRunning() || !this._hasActiveView()) {
      return;
    }

    const { x, y } = this._canvasCoords(event);
    const { cellX, cellY } = this._resolveCell(x, y);

    // Restart the idle-hide timer on ANY move so the highlight tracks an
    // active cursor but fades once the pointer rests.
    this._resetHoverTimeout();

    if (this._lastHoverCell?.cellX === cellX && this._lastHoverCell?.cellY === cellY) {
      return;
    }
    this._lastHoverCell = { cellX, cellY };
    this._updateHoverHighlight(cellX, cellY);
  }

  private _handlePointerLeave(): void {
    this._lastHoverCell = undefined;
    this._clearHoverTimeout();
    if (this._hoverHighlight) {
      this._hoverHighlight.visible = false;
    }
  }

  private _canvasCoords(event: PointerEvent): { x: number; y: number } {
    const rect = this._canvas?.getBoundingClientRect();
    if (!rect) {
      return { x: event.clientX, y: event.clientY };
    }
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private _resetHoverTimeout(): void {
    this._clearHoverTimeout();
    this._hoverHighlightTimeout = this._timers.setTimeout(() => {
      this._hoverHighlightTimeout = undefined;
      if (this._hoverHighlight) {
        this._hoverHighlight.visible = false;
      }
      this._lastHoverCell = undefined;
    }, HOVER_HIGHLIGHT_TIMEOUT_MS);
  }

  private _clearHoverTimeout(): void {
    if (this._hoverHighlightTimeout !== undefined) {
      this._timers.clearTimeout(this._hoverHighlightTimeout);
      this._hoverHighlightTimeout = undefined;
    }
  }

  private _updateHoverHighlight(cellX: number, cellY: number): void {
    if (!this._hoverHighlight) {
      return;
    }
    const tileSize = this._getTileSize();
    const worldX = cellX * tileSize;
    const worldY = cellY * tileSize;

    this._hoverHighlight.clear();
    this._hoverHighlight.rect(worldX, worldY, tileSize, tileSize);
    this._hoverHighlight.fill({ color: 0xffffff, alpha: 0.2 });
    this._hoverHighlight.rect(worldX, worldY, tileSize, tileSize);
    this._hoverHighlight.stroke({ width: 1, color: 0xffffff, alpha: 0.5 });
    this._hoverHighlight.visible = true;
  }

  private _showDestinationMarker(cellX: number, cellY: number): void {
    if (!this._destinationMarker) {
      return;
    }
    const tileSize = this._getTileSize();
    const centerX = cellX * tileSize + tileSize / 2;
    const centerY = cellY * tileSize + tileSize / 2;

    this._destinationMarker.clear();
    const crossSize = 6;
    this._destinationMarker.moveTo(centerX - crossSize, centerY);
    this._destinationMarker.lineTo(centerX + crossSize, centerY);
    this._destinationMarker.moveTo(centerX, centerY - crossSize);
    this._destinationMarker.lineTo(centerX, centerY + crossSize);
    this._destinationMarker.stroke({ width: 2, color: 0x00ff88, alpha: 0.9 });
    this._destinationMarker.visible = true;
    this._destinationCell = { cellX, cellY };
  }
}
