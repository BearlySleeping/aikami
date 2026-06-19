// packages/frontend/engine/src/worker/worker_logger.ts
//
// Lightweight console wrapper for the ECS worker.
// The worker runs in a Web Worker context where path aliases ($logger,
// @aikami/*) and NPM packages may not resolve correctly. This thin
// wrapper keeps logging consistent with the pattern used throughout
// the engine while avoiding heavy dependencies.

/** Worker-scoped debug logger — visible in browser DevTools console. */
const debug = (tag: string, message: string, data?: Record<string, unknown>): void => {
  const extra = data ? ` ${JSON.stringify(data)}` : '';
  // biome-ignore lint/suspicious/noConsole: logger wrapper
  console.debug(`[${tag}] ${message}${extra}`);
};

/** Worker-scoped informational log. */
const info = (tag: string, message: string): void => {
  // biome-ignore lint/suspicious/noConsole: logger wrapper
  console.log(`[${tag}] ${message}`);
};

/** Worker-scoped warning. */
const warn = (tag: string, message: string): void => {
  // biome-ignore lint/suspicious/noConsole: logger wrapper
  console.warn(`[${tag}] ${message}`);
};

/** Worker-scoped error log. */
const error = (tag: string, message: string, err?: unknown): void => {
  // biome-ignore lint/suspicious/noConsole: logger wrapper
  console.error(`[${tag}] ${message}`, err ?? '');
};

export const logger = { debug, info, warn, error } as const;
