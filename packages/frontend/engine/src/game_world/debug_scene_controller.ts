// packages/frontend/engine/src/game_world/debug_scene_controller.ts
//
// Owns a caller-supplied synthetic debug scene: its presentation overlay, the
// fitted debug camera that frames it, and the viewport diagnostics an embedded
// debugger reads. Extracted from `game_world.ts` (which must stay inside its
// source-size waiver) as one cohesive responsibility.
//
// It is a READ-ONLY presentation controller: it never performs pathfinding,
// combat, or movement calculation, and production never constructs a scene.
// It reads GameWorld-owned state through injected accessors, so GameWorld's
// integration is a single field.

import { BASE_WORLD_SCALE } from '@aikami/constants';
import type { Application, Container } from 'pixi.js';
import { clearDebugScene, type DebugSceneSpec, renderDebugScene } from './debug_scene_overlay.ts';

/** Minimum debug-camera zoom; keeps a large synthetic board legible. */
const MIN_ZOOM = 0.2;
/** Maximum debug-camera zoom; prevents an oversized token filling a pane. */
const MAX_ZOOM = 3;
/** Fraction of the pane the fitted board occupies, so tokens never clip. */
const FIT_MARGIN = 0.94;

export type DebugSceneCamera = {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
};

export type DebugSceneScreen = {
  readonly width: number;
  readonly height: number;
};

/**
 * Read-only viewport/renderer diagnostics for embedded engine surfaces.
 *
 * A debugger needs to see the exact relationship between CSS size, backing
 * store, Pixi screen and camera; a mismatch is invisible otherwise.
 */
export type GameWorldViewportDiagnostics = {
  readonly renderer: string;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly backingWidth: number;
  readonly backingHeight: number;
  readonly screenWidth: number;
  readonly screenHeight: number;
  readonly resolution: number;
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number };
  readonly debugSceneActive: boolean;
  readonly debugSceneActorCount: number;
};

/** GameWorld-owned state the controller reads; never mutated. */
export type DebugSceneControllerAccessors = {
  getContainer(): Container | undefined;
  getScreen(): DebugSceneScreen | undefined;
  getApp(): Application | undefined;
  getCamera(): { readonly x: number; readonly y: number; readonly zoom: number };
  getRenderer(): string;
};

export class DebugSceneController {
  private readonly _accessors: DebugSceneControllerAccessors;
  private _spec: DebugSceneSpec | undefined;
  private _camera: DebugSceneCamera | undefined;

  constructor(accessors: DebugSceneControllerAccessors) {
    this._accessors = accessors;
  }

  get active(): boolean {
    return this._spec !== undefined;
  }

  get actorCount(): number {
    return this._spec?.actors?.length ?? 0;
  }

  get tileSize(): number | undefined {
    return this._spec?.tileSize;
  }

  /** Fitted camera to apply instead of the worker follow-camera, if any. */
  get camera(): DebugSceneCamera | undefined {
    return this._camera;
  }

  /** Sets (or clears) the scene and repaints it with a fitted camera. */
  setScene(spec: DebugSceneSpec | undefined): void {
    this._spec = spec;
    const container = this._accessors.getContainer();
    if (spec === undefined) {
      this._camera = undefined;
      if (container !== undefined) {
        clearDebugScene(container);
      }
      return;
    }
    if (container !== undefined) {
      renderDebugScene({ container, spec });
    }
    this._fit();
  }

  /** Re-fits the active scene to the current screen size. */
  fit(): void {
    this._fit();
  }

  /** Clears the scene and fitted camera. */
  clear(): void {
    this._spec = undefined;
    this._camera = undefined;
    const container = this._accessors.getContainer();
    if (container !== undefined) {
      clearDebugScene(container);
    }
  }

  /** Builds the read-only viewport diagnostics snapshot. */
  getDiagnostics(): GameWorldViewportDiagnostics {
    const canvas = this._accessors.getApp()?.canvas;
    const app = this._accessors.getApp();
    const camera = this._camera ?? this._accessors.getCamera();
    return {
      renderer: this._accessors.getRenderer(),
      cssWidth: canvas?.clientWidth ?? 0,
      cssHeight: canvas?.clientHeight ?? 0,
      backingWidth: canvas?.width ?? 0,
      backingHeight: canvas?.height ?? 0,
      screenWidth: app?.screen.width ?? 0,
      screenHeight: app?.screen.height ?? 0,
      resolution: app?.renderer.resolution ?? 1,
      camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
      debugSceneActive: this._spec !== undefined,
      debugSceneActorCount: this._spec?.actors?.length ?? 0,
    };
  }

  private _fit(): void {
    const spec = this._spec;
    const screen = this._accessors.getScreen();
    if (spec === undefined || screen === undefined || spec.width <= 0 || spec.height <= 0) {
      return;
    }
    const boardWidth = spec.width * spec.tileSize;
    const boardHeight = spec.height * spec.tileSize;
    const rawZoom = Math.min(
      screen.width / (boardWidth * BASE_WORLD_SCALE),
      screen.height / (boardHeight * BASE_WORLD_SCALE),
    );
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, rawZoom * FIT_MARGIN));
    this._camera = { x: boardWidth / 2, y: boardHeight / 2, zoom };
  }
}
