// packages/frontend/engine/src/frame_pacing.ts

/**
 * Adds elapsed time to a fixed-step accumulator and consumes every whole step.
 *
 * @param options - Current timing state and fixed-step limits.
 * @returns The number of steps to run and the remaining partial-step time.
 */
export const updateFixedStepAccumulator = (options: {
  accumulatorMs: number;
  elapsedMs: number;
  fixedStepMs: number;
  maxStepsPerWake: number;
}): { accumulatorMs: number; stepCount: number } => {
  let accumulatorMs =
    options.accumulatorMs +
    Math.min(options.elapsedMs, options.maxStepsPerWake * options.fixedStepMs);
  let stepCount = 0;

  while (accumulatorMs >= options.fixedStepMs) {
    accumulatorMs -= options.fixedStepMs;
    stepCount++;
  }

  return { accumulatorMs, stepCount };
};

/**
 * Computes the clamped interpolation progress through a simulation step.
 *
 * @param options - Elapsed wall time and fixed simulation step duration.
 * @returns A value from zero through one.
 */
export const computeInterpolationAlpha = (options: { elapsedMs: number; stepMs: number }): number =>
  Math.min(1, Math.max(0, options.elapsedMs / options.stepMs));

/**
 * Linearly interpolates between two scalar values.
 *
 * @param options - Previous value, current value, and interpolation alpha.
 * @returns The interpolated scalar.
 */
export const interpolateValue = (options: {
  previous: number;
  current: number;
  alpha: number;
}): number => options.previous + (options.current - options.previous) * options.alpha;

/**
 * Copies a render-state view before its backing buffer is transferred.
 *
 * @param source - Render-state view whose values must remain readable.
 * @returns An independent copy with its own ArrayBuffer.
 */
export const copyRenderState = (source: Float32Array): Float32Array => {
  const copy = new Float32Array(source.length);
  copy.set(source);
  return copy;
};

/**
 * Inverts the centered camera transform for a screen-space point.
 *
 * @param options - Screen point, viewport dimensions, camera, and render scale.
 * @returns World-space pixel coordinates.
 */
export const unprojectScreenPoint = (options: {
  screenX: number;
  screenY: number;
  screenWidth: number;
  screenHeight: number;
  cameraX: number;
  cameraY: number;
  scale: number;
}): { x: number; y: number } => ({
  x: (options.screenX - options.screenWidth / 2) / options.scale + options.cameraX,
  y: (options.screenY - options.screenHeight / 2) / options.scale + options.cameraY,
});
