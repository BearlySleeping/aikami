// packages/frontend/engine/src/game_world/frame_renderer.ts
//
// Per-frame render transform boundary.
//
// Reads the current/previous simulation state and writes entity display
// transforms, animation frames, z-depth, the camera transform, and tilemap
// chunk culling. It owns only frame-local bookkeeping (the render-log
// throttle and last cull counts) — all world state is passed in per frame as
// an explicit, typed input object, never as the GameWorld itself.

import { BASE_WORLD_SCALE } from '@aikami/constants';
import type { Application, Container } from 'pixi.js';
import { COMPONENT_STRIDE } from '../config/memory_config.ts';
import { computeInterpolationAlpha, interpolateValue } from '../frame_pacing.ts';
import { computeEntityZIndex } from '../rendering/layer_bands.ts';
import { snapToDevicePixels } from '../rendering/pixel_snap.ts';
import type { TextureManager } from '../rendering/texture_manager.ts';
import { frustumCullChunks, type TilemapChunk } from '../rendering/tilemap_chunk_renderer.ts';
import { publishEntityPosition, publishPlayerDebug } from './diagnostics.ts';
import { applyLpcFrameToEntry } from './entity_appearance.ts';
import type { RenderBufferPool } from './render_buffer_pool.ts';
import type { RenderEntry } from './render_entry.ts';

/** Everything one render frame needs. All dependencies are explicit. */
export type FrameRenderOptions = {
  app: Application;
  worldContainer: Container | undefined;
  renderEntries: ReadonlyMap<number, RenderEntry>;
  bufferPool: RenderBufferPool;
  /** Current camera (world-space pixels + zoom). */
  camera: { x: number; y: number; zoom: number };
  /** Real wall-clock delta (ms) for the frame. */
  deltaMs: number;
  playerEntityId: number;
  playerVisibleByMask: number;
  npcCount: number;
  npcAppearance: Record<string, Record<string, string>>;
  tilemapChunks: readonly TilemapChunk[] | undefined;
  /** Receives the throttled per-second render diagnostic. */
  onRenderLog: (message: string) => void;
};

const RENDER_LOG_INTERVAL_MS = 1000;

export class FrameRenderer {
  private readonly _textureManager: TextureManager | undefined;
  private readonly _now: () => number;
  private _lastCulledChunkCounts: { visible: number; total: number } | undefined;
  private _lastRenderLog = 0;

  constructor(options: { textureManager?: TextureManager; now?: () => number }) {
    this._textureManager = options.textureManager;
    this._now = options.now ?? (() => performance.now());
  }

  /** Clears cached cull counts on a scene replacement. */
  resetCullStats(): void {
    this._lastCulledChunkCounts = undefined;
  }

  /**
   * Runs one render frame. No-ops until the worker has delivered a state
   * buffer.
   */
  render(options: FrameRenderOptions): void {
    const renderView = options.bufferPool.activeView;
    if (!renderView) {
      return;
    }

    const stageBounds = options.app.screen;
    let visibleCount = 0;
    let totalCount = 0;

    // ── C-380 AC-2: Compute interpolation alpha ──
    // Blend between the previous and current sim states based on how much
    // wall-clock time has passed since the current state was received.
    const timing = options.bufferPool.timing;
    const hasTwoStates =
      options.bufferPool.previousView !== undefined &&
      timing !== undefined &&
      options.bufferPool.previousSimTimeMs < timing.simTimeMs;
    const stepMs = timing?.stepMs ?? 16.667;
    const stateReceivedAt = options.bufferPool.currentStateReceivedAt;
    const elapsedSinceCurrent = stateReceivedAt > 0 ? this._now() - stateReceivedAt : 0;
    const alpha = hasTwoStates
      ? computeInterpolationAlpha({ elapsedMs: elapsedSinceCurrent, stepMs })
      : 1;
    const prevView = options.bufferPool.previousView;

    for (const [eid, entry] of options.renderEntries) {
      totalCount++;
      const offset = eid * COMPONENT_STRIDE;

      // C-380 AC-2: interpolate between previous and current state
      let x: number;
      let y: number;
      if (hasTwoStates && prevView) {
        const prevX = prevView[offset];
        const prevY = prevView[offset + 1];
        const currX = renderView[offset];
        const currY = renderView[offset + 1];
        if (
          prevX !== undefined &&
          currX !== undefined &&
          !Number.isNaN(prevX) &&
          !Number.isNaN(currX)
        ) {
          x = interpolateValue({ previous: prevX, current: currX, alpha });
          y = interpolateValue({ previous: prevY, current: currY, alpha });
        } else {
          x = renderView[offset];
          y = renderView[offset + 1];
        }
      } else {
        x = renderView[offset];
        y = renderView[offset + 1];
      }

      if (x === undefined || y === undefined) {
        continue;
      }

      // C-180/C-379: expose player world coordinates for E2E collision and
      // NPC-movement assertions. Published only once x/y resolved so a
      // NaN/undefined frame cannot poison the debug read.
      if (eid === options.playerEntityId) {
        publishPlayerDebug({
          playerX: x,
          playerY: y,
          playerEid: eid,
          playerVisibleByMask: options.playerVisibleByMask,
          npcCount: options.npcCount,
          npcAppearance: options.npcAppearance,
        });
      }

      // C-379 AC-7: expose every rendered entity position.
      publishEntityPosition(eid, { x, y });

      entry.displayObject.x = x;
      entry.displayObject.y = y;

      // C-376 AC-4: y-depth via in-place zIndex (raw float; stable sort).
      entry.displayObject.zIndex = computeEntityZIndex(y);

      // Drive the per-entity animation controller from positional deltas and
      // the real elapsed wall-clock delta (C-496 AC-5).
      entry.animationController?.update({ x, y, deltaMs: options.deltaMs });
      if (entry.animationController) {
        applyLpcFrameToEntry({
          layers: entry.layerSprites,
          controller: entry.animationController,
          textureManager: this._textureManager,
        });
      }

      // Spatial culling: still disabled (C-180 follow-up). Kept explicit so
      // the visibility guarantee is obvious.
      entry.displayObject.visible = true;
      visibleCount++;
    }

    // Camera transform: center the world container on the worker camera
    // (lerp + clamping) once per frame, after entity positions are set.
    if (options.worldContainer) {
      this._applyCameraTransform(options, hasTwoStates, alpha);
      this._cullTilemapChunks(options, hasTwoStates, alpha);
    }

    // Throttled per-second render diagnostic (only when
    // BaseEngineClass.setRenderDebug(true)).
    const now = this._now();
    if (totalCount > 0 && now - this._lastRenderLog > RENDER_LOG_INTERVAL_MS) {
      this._lastRenderLog = now;
      const chunkSummary = this._lastCulledChunkCounts
        ? `, chunks ${this._lastCulledChunkCounts.visible}/${this._lastCulledChunkCounts.total} visible`
        : '';
      options.onRenderLog(
        `${visibleCount}/${totalCount} visible, stage ${stageBounds.width}x${stageBounds.height}${chunkSummary}`,
      );
    }
  }

  private _applyCameraTransform(
    options: FrameRenderOptions,
    hasTwoStates: boolean,
    alpha: number,
  ): void {
    const worldContainer = options.worldContainer;
    if (!worldContainer) {
      return;
    }

    // Apply dynamic zoom to the world container scale (C-161).
    const dynamicScale = BASE_WORLD_SCALE * options.camera.zoom;
    if (worldContainer.scale.x !== dynamicScale) {
      worldContainer.scale.set(dynamicScale);
    }

    // ── C-380 AC-2: interpolated camera position ──
    const previousCamera = options.bufferPool.previousCamera;
    const interpCameraX = hasTwoStates
      ? interpolateValue({ previous: previousCamera.x, current: options.camera.x, alpha })
      : options.camera.x;
    const interpCameraY = hasTwoStates
      ? interpolateValue({ previous: previousCamera.y, current: options.camera.y, alpha })
      : options.camera.y;

    // ── C-377 AC-3: device-pixel snap (applied AFTER blending) ──
    const resolution = options.app.renderer.resolution || 1;
    worldContainer.x = snapToDevicePixels(
      options.app.screen.width / 2 - interpCameraX * worldContainer.scale.x,
      resolution,
    );
    worldContainer.y = snapToDevicePixels(
      options.app.screen.height / 2 - interpCameraY * worldContainer.scale.y,
      resolution,
    );
  }

  private _cullTilemapChunks(
    options: FrameRenderOptions,
    hasTwoStates: boolean,
    alpha: number,
  ): void {
    const chunks = options.tilemapChunks;
    const worldContainer = options.worldContainer;
    if (!chunks || chunks.length === 0 || !worldContainer) {
      return;
    }

    const dynamicScale = worldContainer.scale.x;
    const previousCamera = options.bufferPool.previousCamera;
    const interpCameraX = hasTwoStates
      ? interpolateValue({ previous: previousCamera.x, current: options.camera.x, alpha })
      : options.camera.x;
    const interpCameraY = hasTwoStates
      ? interpolateValue({ previous: previousCamera.y, current: options.camera.y, alpha })
      : options.camera.y;

    // Camera is in world-space pixels; viewport is screen-space, so divide by
    // the world scale.
    const viewportWorldW = options.app.screen.width / dynamicScale;
    const viewportWorldH = options.app.screen.height / dynamicScale;

    const culled = frustumCullChunks(
      chunks,
      interpCameraX - viewportWorldW / 2,
      interpCameraY - viewportWorldH / 2,
      viewportWorldW,
      viewportWorldH,
    );
    if (culled.total > 0) {
      this._lastCulledChunkCounts = culled;
    }
  }
}
