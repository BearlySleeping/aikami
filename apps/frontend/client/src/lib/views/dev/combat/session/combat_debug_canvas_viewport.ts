// apps/frontend/client/src/lib/views/dev/combat/session/combat_debug_canvas_viewport.ts
//
// Element-bound viewport controller for the embedded combat debug canvas.
//
// The production game canvas fills the browser window (`resizeTo: window`); the
// debugger renders into a pane, so it must size from its HOST element instead.
// This owns exactly one ResizeObserver on the host, coalesces bursts to at most
// one resize per animation frame, ignores transient 0x0 layout (a pane that has
// not been laid out yet), and tears down cleanly on dispose. It does NOT resize
// anything itself: the session forwards the measured CSS size to the engine's
// existing `GameWorld.resize` path, so the renderer, canvas backing store and
// worker screen dimensions stay coherent through one code path.

export type CombatDebugCanvasSize = {
  readonly width: number;
  readonly height: number;
};

/** Minimal ResizeObserver surface so tests can inject a deterministic double. */
export type CombatDebugResizeObserver = {
  observe(target: Element): void;
  disconnect(): void;
};

export type CombatDebugCanvasViewportOptions = {
  readonly canvas: HTMLCanvasElement;
  /** Receives the host's CSS pixel size whenever it changes (never 0×0). */
  onResize(width: number, height: number): void;
  /** Frame scheduler; tests inject a synchronous scheduler. */
  scheduleFrame?(callback: () => void): number;
  cancelFrame?(handle: number): void;
  /** ResizeObserver factory; tests inject a fake. */
  createObserver?(callback: () => void): CombatDebugResizeObserver;
};

export type CombatDebugCanvasViewport = {
  /** The element whose box drives sizing (the canvas host). */
  readonly host: HTMLElement;
  /** Measures the host now; both axes may be 0 before layout resolves. */
  measure(): CombatDebugCanvasSize;
  /** Re-applies the current host size if it is usable. */
  refresh(): void;
  dispose(): void;
};

const measureElement = (element: HTMLElement): CombatDebugCanvasSize => ({
  width: Math.max(0, Math.floor(element.clientWidth)),
  height: Math.max(0, Math.floor(element.clientHeight)),
});

/**
 * Creates the viewport controller. The returned object is inert until the host
 * reports a non-zero size; consumers should fall back to the engine defaults
 * for the initial boot and let the first observation correct the size.
 */
export const createCombatDebugCanvasViewport = (
  options: CombatDebugCanvasViewportOptions,
): CombatDebugCanvasViewport => {
  const host = (options.canvas.parentElement as HTMLElement | undefined) ?? options.canvas;
  const scheduleFrame =
    options.scheduleFrame ??
    ((callback: () => void): number => window.requestAnimationFrame(callback));
  const cancelFrame =
    options.cancelFrame ?? ((handle: number): void => window.cancelAnimationFrame(handle));

  let frameHandle: number | undefined;
  let disposed = false;

  const applyMeasuredSize = (): void => {
    frameHandle = undefined;
    if (disposed) {
      return;
    }
    const size = measureElement(host);
    if (size.width <= 0 || size.height <= 0) {
      // Wait for real layout; the next observation will schedule another try.
      return;
    }
    options.onResize(size.width, size.height);
  };

  const scheduleApply = (): void => {
    if (disposed || frameHandle !== undefined) {
      return;
    }
    frameHandle = scheduleFrame(applyMeasuredSize);
  };

  const createObserver =
    options.createObserver ??
    ((callback: () => void): CombatDebugResizeObserver => new ResizeObserver(() => callback()));
  const observer = createObserver(scheduleApply);
  observer.observe(host);

  return {
    host,
    measure: (): CombatDebugCanvasSize => measureElement(host),
    refresh: (): void => {
      applyMeasuredSize();
    },
    dispose: (): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      observer.disconnect();
      if (frameHandle !== undefined) {
        cancelFrame(frameHandle);
        frameHandle = undefined;
      }
    },
  };
};
