// packages/frontend/engine/src/game_world/combat_selection_highlights.ts
//
// C-525 R-2 — owns the main-thread combat direct-control highlight overlay.
//
// The combat ViewModel projects the current selection over
// `COMBAT_SELECTION_HIGHLIGHTS`; this controller stores it, paints the Pixi
// overlay above the tactical battlefield, clears it on cancel/scene change,
// and publishes the cells' canvas-local centres for E2E probes. Extracted
// from `game_world.ts` so the facade stays within its source-size ceiling.

import { BASE_WORLD_SCALE } from '@aikami/constants';
import type { GridPoint } from '@aikami/types';
import type { Application, Container } from 'pixi.js';
import { buildCombatHighlightCells } from '../rendering/combat_selection_overlay.ts';
import type { CombatHighlightPoint } from './diagnostics.ts';
import { publishCombatHighlights } from './diagnostics.ts';
import { clearCombatSelectionHighlights, drawCombatSelectionHighlights } from './scene_overlays.ts';

/** The selection cells the overlay paints. */
export type CombatSelection = {
  legalEndpoints: GridPoint[];
  legalTargetCells: GridPoint[];
};

/** Options accessors the controller reads each time it paints or publishes. */
export type CombatSelectionHighlightsOptions = {
  getWorldContainer: () => Container | undefined;
  getApp: () => Application | undefined;
  getTileSize: () => number;
  getCamera: () => { x: number; y: number; zoom: number };
};

/** The combat highlight overlay controller. */
export class CombatSelectionHighlights {
  private _selection: CombatSelection = { legalEndpoints: [], legalTargetCells: [] };
  private readonly _getWorldContainer: () => Container | undefined;
  private readonly _getApp: () => Application | undefined;
  private readonly _getTileSize: () => number;
  private readonly _getCamera: () => { x: number; y: number; zoom: number };

  constructor(options: CombatSelectionHighlightsOptions) {
    this._getWorldContainer = options.getWorldContainer;
    this._getApp = options.getApp;
    this._getTileSize = options.getTileSize;
    this._getCamera = options.getCamera;
  }

  /** Whether the current selection has anything to paint. */
  get isActive(): boolean {
    return this._selection.legalEndpoints.length > 0 || this._selection.legalTargetCells.length > 0;
  }

  /** Replaces the selection, repaints the overlay, and publishes its cells. */
  set(selection: CombatSelection): void {
    this._selection = {
      legalEndpoints: [...selection.legalEndpoints],
      legalTargetCells: [...selection.legalTargetCells],
    };
    const worldContainer = this._getWorldContainer();
    if (!worldContainer) {
      return;
    }
    drawCombatSelectionHighlights({
      worldContainer,
      tileSize: this._getTileSize(),
      legalEndpoints: this._selection.legalEndpoints,
      legalTargetCells: this._selection.legalTargetCells,
    });
    this._publish();
  }

  /** Clears the selection and removes the overlay. */
  clear(): void {
    this._selection = { legalEndpoints: [], legalTargetCells: [] };
    const worldContainer = this._getWorldContainer();
    if (worldContainer) {
      clearCombatSelectionHighlights(worldContainer);
    }
    publishCombatHighlights([]);
  }

  /**
   * Republish the cells' screen centres for E2E. Called once per rendered
   * frame while a selection is open so the points track the camera.
   */
  onFrame(): void {
    if (this.isActive) {
      this._publish();
    }
  }

  private _publish(): void {
    const app = this._getApp();
    if (!app) {
      return;
    }
    const cells = buildCombatHighlightCells({
      legalEndpoints: this._selection.legalEndpoints,
      legalTargetCells: this._selection.legalTargetCells,
    });
    if (cells.length === 0) {
      publishCombatHighlights([]);
      return;
    }
    const camera = this._getCamera();
    const scale = BASE_WORLD_SCALE * camera.zoom;
    const tileSize = this._getTileSize();
    // Publish the CENTRE of each cell so an E2E can click it directly without
    // knowing the world scale.
    const points: CombatHighlightPoint[] = cells.map((cell) => ({
      cellX: cell.x,
      cellY: cell.y,
      kind: cell.kind,
      screenX: ((cell.x + 0.5) * tileSize - camera.x) * scale + app.screen.width / 2,
      screenY: ((cell.y + 0.5) * tileSize - camera.y) * scale + app.screen.height / 2,
    }));
    publishCombatHighlights(points);
  }
}
