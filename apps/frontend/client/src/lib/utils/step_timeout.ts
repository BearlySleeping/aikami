// apps/frontend/client/src/lib/utils/step_timeout.ts
//
// Names a hang.
//
// Boot is a long chain of awaits whose intermediate logging is `debug` —
// suppressed at the default INFO log level. A step that never settles
// therefore surfaced only as the boot pipeline's generic 30s stage timeout,
// with nothing to say which await was stuck. Racing each step against a
// deadline converts that into an actionable error naming the step, and stops
// one wedged dependency from hanging the app indefinitely.
//
// Use for steps expected to be fast. Do NOT wrap steps that are legitimately
// long-running or that report their own progress — a false timeout there is
// worse than no timeout at all.

import { logger } from '$logger';

/** Raised when a step outlives its deadline. */
export class StepTimeoutError extends Error {
  constructor(name: string, timeoutMs: number) {
    super(`asset registry step "${name}" did not settle within ${timeoutMs}ms`);
    this.name = 'StepTimeoutError';
  }
}

/**
 * Runs `run()` under a deadline, logging how long it took either way.
 *
 * The timer is always cleared, so a resolved step never leaves a pending
 * timeout holding the event loop open.
 *
 * @param options - Step name, the work, and the deadline in milliseconds.
 * @returns Whatever `run()` resolves to.
 * @throws StepTimeoutError when the deadline passes first.
 */
export const withStepTimeout = async <T>(options: {
  name: string;
  timeoutMs: number;
  run: () => Promise<T>;
}): Promise<T> => {
  const { name, timeoutMs, run } = options;
  const startedAt = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      run(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new StepTimeoutError(name, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    logger.debug('step:complete', { name, elapsedMs: Math.round(performance.now() - startedAt) });
  }
};
