import type { LogEntry, LoggerInterface, LogSink, TimerInterface } from '@aikami/types';
import { isValidLogLevel } from './base.ts';

export { isValidLogLevel, type LogEntry, type LogSink };

let _logger: LoggerInterface | undefined;
let _loading: Promise<LoggerInterface> | undefined;

/** Buffered log calls that arrived before the real logger was loaded. */
const _buffer: Array<{ method: string; args: unknown[] }> = [];

/** Buffered sinks registered before the real logger was loaded. */
const _pendingSinks: LogSink[] = [];

/** Stub timer returned while the real logger is still loading. */
const _noopTimer: TimerInterface = {
  finish: () => BigInt(0),
  getTimeInMS: () => BigInt(0),
};

async function _loadLogger(): Promise<LoggerInterface> {
  // Use `import.meta.env.SSR` (a Vite compile-time constant) so Vite can
  // tree-shake the unused import in each build target. In the server build
  // this becomes `true` and the browser import is dead-code-eliminated;
  // in the client build it becomes `false` and the SSR import is removed.
  if (import.meta.env.SSR) {
    const { createLogger } = await import('./logger_svelte_kit_ssr.ts');
    return createLogger();
  }
  const { createLogger } = await import('./logger_browser.ts');
  return createLogger();
}

function _ensureLoaded(): LoggerInterface {
  if (_logger) {
    return _logger;
  }

  if (!_loading) {
    _loading = _loadLogger().then((l) => {
      _logger = l;
      // Register any sinks that were added before the logger was loaded
      // MUST happen BEFORE replaying buffered calls so those logs reach the sinks.
      for (const sink of _pendingSinks) {
        l.addSink(sink);
      }
      _pendingSinks.length = 0;

      // Replay buffered log calls (sinks are already registered)
      // IMPORTANT: replayed calls run OUTSIDE the original AsyncLocalStorage context.
      // Sinks must handle missing context gracefully (e.g. persist without session context).
      for (const { method, args } of _buffer) {
        const fn = (l as Record<string, unknown>)[method];
        if (typeof fn === 'function') {
          (fn as (...a: unknown[]) => void).apply(l, args);
        }
      }
      _buffer.length = 0;
      return l;
    });
  }

  return _proxy;
}

/** Sync proxy that buffers calls until the async logger resolves. */
const _proxy: LoggerInterface = {
  get logLevel() {
    return _logger?.logLevel ?? 'INFO';
  },
  set logLevel(value) {
    if (_logger) {
      _logger.logLevel = value;
    }
  },
  createTimer() {
    return _logger?.createTimer() ?? _noopTimer;
  },
  setLogLevel(logLevel) {
    if (_logger) {
      _logger.setLogLevel(logLevel);
    }
  },
  addSink(sink) {
    if (_logger) {
      _logger.addSink(sink);
    } else {
      _pendingSinks.push(sink);
    }
  },
  setContext(ctx) {
    if (_logger && typeof _logger.setContext === 'function') {
      _logger.setContext(ctx);
    }
  },
  write(entry, ...data) {
    _buffer.push({ method: 'write', args: [entry, ...data] });
  },
  debug(...args) {
    _buffer.push({ method: 'debug', args });
  },
  log(...args) {
    _buffer.push({ method: 'log', args });
  },
  info(...args) {
    _buffer.push({ method: 'info', args });
  },
  warn(...args) {
    _buffer.push({ method: 'warn', args });
  },
  error(...args) {
    _buffer.push({ method: 'error', args });
  },
};

/**
 * SvelteKit-compatible logger that lazily loads the correct
 * backend or frontend implementation via async dynamic import.
 *
 * Early log calls are buffered and replayed once the real
 * logger is loaded, so the API stays 100% synchronous.
 */
export const logger: LoggerInterface = {
  get logLevel() {
    return _ensureLoaded().logLevel;
  },
  set logLevel(value) {
    _ensureLoaded().logLevel = value;
  },
  createTimer() {
    return _ensureLoaded().createTimer();
  },
  setLogLevel(logLevel) {
    _ensureLoaded().setLogLevel(logLevel);
  },
  addSink(sink) {
    _ensureLoaded().addSink(sink);
  },
  setContext(ctx) {
    const l = _ensureLoaded();
    if (typeof l.setContext === 'function') {
      l.setContext(ctx);
    }
  },
  write(entry, ...data) {
    _ensureLoaded().write(entry, ...data);
  },
  debug(...args) {
    _ensureLoaded().debug(...args);
  },
  log(...args) {
    _ensureLoaded().log(...args);
  },
  info(...args) {
    _ensureLoaded().info(...args);
  },
  warn(...args) {
    _ensureLoaded().warn(...args);
  },
  error(...args) {
    _ensureLoaded().error(...args);
  },
};
