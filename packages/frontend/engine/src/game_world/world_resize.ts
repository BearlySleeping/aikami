// packages/frontend/engine/src/game_world/world_resize.ts
//
// Applies a renderer resize and forwards the resulting screen size to the
// simulation worker. Extracted from `game_world.ts` (source-size waiver) so the
// viewport-sizing concern lives in one place; both the production window
// observer and the embedded debugger's element-bound observer call it through
// `GameWorld.resize`.

import { BASE_WORLD_SCALE } from '@aikami/constants';
import type { Application, Container } from 'pixi.js';
import { DEFAULT_HEIGHT, DEFAULT_WIDTH } from '../pixi_app.ts';
import { sanitizeCanvasDimension } from '../pixi_init_options.ts';

export type WorldResizeOptions = {
  readonly app: Application | undefined;
  readonly worldContainer: Container | undefined;
  readonly width: number;
  readonly height: number;
  readonly postScreenSize: (size: { width: number; height: number; scale: number }) => void;
};

/**
 * Sanitizes and applies a renderer resize, then reports the new screen size and
 * world-container scale so the worker's camera system can update its clamping.
 *
 * Resize callers measure the DOM, which lies on some WebKitGTK hosts (negative
 * innerWidth, billions-scale clientWidth). Passing that through wraps to a
 * multi-gigapixel backing store the platform refuses, blanking a canvas that
 * was rendering fine a frame earlier.
 */
export const applyWorldResize = (options: WorldResizeOptions): void => {
  const { app } = options;
  const safeWidth = sanitizeCanvasDimension(options.width, app?.renderer.width ?? DEFAULT_WIDTH);
  const safeHeight = sanitizeCanvasDimension(
    options.height,
    app?.renderer.height ?? DEFAULT_HEIGHT,
  );
  if (app !== undefined) {
    app.renderer.resize(safeWidth, safeHeight);
  }
  options.postScreenSize({
    width: safeWidth,
    height: safeHeight,
    scale: options.worldContainer?.scale.x ?? BASE_WORLD_SCALE,
  });
};
