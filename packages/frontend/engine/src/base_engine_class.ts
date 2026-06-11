// packages/frontend/engine/src/base_engine_class.ts

import { BaseClass, type BaseClassInterface, type BaseClassOptions } from '@aikami/utils';
import { logger } from '$logger';

// ---------------------------------------------------------------------------
// BaseEngineClass — shared base for all engine-layer classes
//
// Extends the monorepo BaseClass with engine-specific capabilities:
// - render(): ultra-verbose frame-level logging, toggled via a static flag
// - Inherits debug(), info(), warn(), error() from BaseClass
// - Inherits .create() factory + proxy auto-debug from BaseClass
// ---------------------------------------------------------------------------

export type BaseEngineClassOptions = BaseClassOptions & {};

export type BaseEngineClassInterface = BaseClassInterface & {
  /** @internal render-level diagnostic (off by default, toggle via static flag) */
  render(...args: unknown[]): void;
};

/**
 * Shared base class for engine-layer classes (GameWorld, systems, etc.).
 *
 * Adds a {@link render} log level that is suppressed by default.
 * Toggle via {@link BaseEngineClass.setRenderDebug} to see per-frame
 * diagnostics during development without spamming the regular debug log.
 */
export abstract class BaseEngineClass<
    Options extends BaseEngineClassOptions = BaseEngineClassOptions,
  >
  extends BaseClass<Options>
  implements BaseEngineClassInterface
{
  // -----------------------------------------------------------------------
  // Static: render-debug toggle
  // -----------------------------------------------------------------------

  private static _renderDebug = false;

  /** When `true`, {@link render} calls produce console output. */
  static get renderDebugEnabled(): boolean {
    return BaseEngineClass._renderDebug;
  }

  /** Enable or disable render-level diagnostic logging globally. */
  static setRenderDebug(enabled: boolean): void {
    BaseEngineClass._renderDebug = enabled;
  }

  // -----------------------------------------------------------------------
  // Render-level logging
  // -----------------------------------------------------------------------

  /**
   * Ultra-verbose render-level log. Suppressed by default.
   *
   * Use for per-frame diagnostics (entity count, draw calls, culling
   * stats) that would otherwise spam the console at 60fps.
   *
   * Enable globally via {@link BaseEngineClass.setRenderDebug}.
   */
  render(...args: unknown[]): void {
    if (!BaseEngineClass._renderDebug) {
      return;
    }

    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour: 'numeric',
      hour12: false,
      minute: 'numeric',
      second: 'numeric',
    });

    const prefix = `${timestamp} [${this._className}] [render]`;

    if (typeof args[0] === 'string') {
      const message = args.shift() as string;
      logger.debug(`${prefix} ${message}`, ...args);
    } else {
      logger.debug(prefix, ...args);
    }
  }
}
