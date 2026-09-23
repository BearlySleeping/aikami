// packages/frontend/engine/src/game_world/scene_ambient.ts
//
// C-545: per-frame scene-ambient application, extracted from `game_world.ts`
// (which is at its reviewed size ceiling). Resolves the ONE ambient policy,
// writes it to terrain's `uTint`, and applies the matching factor to every
// world entity container.

import type { UniformGroup } from 'pixi.js';
import {
  applyAmbientToEntity,
  NEUTRAL_SCENE_AMBIENT,
  resolveSceneAmbient,
  type SceneAmbient,
} from '../environment/ambient_policy.ts';
import type { RenderEntry } from './render_entry.ts';

/**
 * Owns the resolved scene ambient and its deterministic-capture latch.
 *
 * Terrain consumes the resolved `r`/`g`/`b` through the tilemap shader's
 * `uTint`; props, actors and enemies consume the matching `hex` as a
 * per-entity container tint. Interiors pin to `COLOR_INTERIOR`; outdoor
 * scenes stay neutral until the worker's UBO arrives.
 */
export class SceneAmbientController {
  private _ambient: SceneAmbient = NEUTRAL_SCENE_AMBIENT;
  private _sampleLatched = false;

  /**
   * Resolves this frame's ambient and writes terrain's `uTint`.
   *
   * When `freeze` is true (visual screenshot mode) the first resolved value
   * is latched for the whole capture, so ground and props cannot drift apart
   * as game time advances (C-378 AC-9).
   */
  update(options: {
    isInterior: boolean;
    environmentUbo: Float32Array | undefined;
    tilemapUniforms: UniformGroup | undefined;
    freeze: boolean;
  }): void {
    const tintArr = options.tilemapUniforms?.uniforms.uTint as Float32Array | undefined;
    if (options.freeze) {
      const inputsReady =
        tintArr !== undefined && (options.isInterior || options.environmentUbo !== undefined);
      if (!inputsReady || this._sampleLatched) {
        return;
      }
    }
    const ambient = resolveSceneAmbient({
      isInterior: options.isInterior,
      environmentUbo: options.environmentUbo,
    });
    this._ambient = ambient;
    if (tintArr) {
      tintArr[0] = ambient.r;
      tintArr[1] = ambient.g;
      tintArr[2] = ambient.b;
    }
    if (options.freeze) {
      this._sampleLatched = true;
    }
  }

  /** C-378 AC-9: a new game hour invalidates a latched screenshot sample. */
  invalidateSample(): void {
    this._sampleLatched = false;
  }

  /**
   * Applies the current ambient to every entity container. Emissive props
   * (lit hearth, braziers) opt out via `RenderEntry.ambientExempt`.
   */
  applyToEntries(entries: Iterable<RenderEntry>): void {
    for (const entry of entries) {
      applyAmbientToEntity({
        displayObject: entry.displayObject,
        ambient: this._ambient,
        ...(entry.ambientExempt === true ? { exempt: true } : {}),
      });
    }
  }
}
