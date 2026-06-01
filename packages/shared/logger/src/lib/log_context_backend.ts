// packages/shared/logger/src/lib/log_context.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import type { LogContext } from '@aikami/types';

/**
 * AsyncLocalStorage instance that holds per-request log context
 * in SvelteKit SSR and Firebase Functions runtimes.
 */
export const logContextStore = new AsyncLocalStorage<LogContext>();
