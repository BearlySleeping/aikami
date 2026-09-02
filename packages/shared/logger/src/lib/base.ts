// packages/shared/logger/src/lib/base.ts
import { LogLevelPriority } from '@aikami/constants';
import type { LogEntry, LoggerInterface, LogLevel, LogSink, TimerInterface } from '@aikami/types';

import { Timer } from './timer.ts';

export const isValidLogLevel = (logLevel?: string): logLevel is LogLevel =>
  !!logLevel && logLevel in LogLevelPriority;

/** Internal bookkeeping for {@link BaseLoggerService.spam}. */
type SpamEntry = {
  lastContent: string;
  lastEmitted: number;
  suppressed: number;
  suppressedSince: number;
  lastAccess: number;
};

/** Minimum interval between emissions for the same spam ID (ms). */
const SPAM_THROTTLE_MS = 500;

export abstract class BaseLoggerService implements LoggerInterface {
  logLevel: LogLevel;
  protected _sinks: LogSink[] = [];
  /** Whether remote log persistence is active. See {@link setExternalLogging}. */
  protected _externalLoggingEnabled = true;

  // --- Infinite Loop Tracker State ---
  private _lastLogSignature = '';
  private _logRepeatCount = 0;
  private _lastLogTimestamp = 0;

  // --- Spam Dedup State ---
  private _spamState = new Map<string, SpamEntry>();
  private _lastSpamCleanup = 0;

  constructor(options?: { logLevel?: LogLevel | string }) {
    const logLevel = options?.logLevel?.toUpperCase();
    this.logLevel = isValidLogLevel(logLevel) ? logLevel : 'INFO';
  }

  setLogLevel(logLevel: LogLevel): void {
    if (!isValidLogLevel(logLevel)) {
      this.warn(
        `Invalid log level "${logLevel}". Valid levels are: ${Object.keys(LogLevelPriority).join(
          ', ',
        )}`,
      );
      return;
    }

    this.logLevel = logLevel;
  }

  addSink(sink: LogSink): void {
    this._sinks.push(sink);
  }

  get externalLoggingEnabled(): boolean {
    return this._externalLoggingEnabled;
  }

  setExternalLogging(enabled: boolean): void {
    this._externalLoggingEnabled = enabled;
  }

  protected _flushSinks(entry: LogEntry, ...data: unknown[]): void {
    // Check for loops BEFORE we write to sinks so we don't spam the console/network.
    // Returns true when the log should be dropped (rate-limited).
    if (this._detectInfiniteLoop(entry, data)) {
      return;
    }

    for (const sink of this._sinks) {
      try {
        void sink.write(entry, ...data);
      } catch {
        // Sinks must never throw; swallow silently.
      }
    }
  }

  protected shouldSkipLog(options: { logLevel?: LogLevel }): boolean {
    if (this.logLevel === 'NONE') {
      return true;
    }

    const currentLogLevelPriority = this.toLogLevelPriority(this.logLevel);
    const entryLogLevelPriority = this.toLogLevelPriority(options.logLevel ?? 'INFO');

    return currentLogLevelPriority > entryLogLevelPriority;
  }

  createTimer(): TimerInterface {
    return new Timer();
  }

  protected toLogLevelPriority(logLevel: LogLevel): LogLevelPriority {
    return LogLevelPriority[logLevel];
  }

  abstract write(entry: LogEntry, ...data: unknown[]): void;

  error(...args: unknown[]): void {
    this.write(
      {
        logLevel: 'ERROR',
        logType: 'error',
      },
      ...args,
    );
  }
  log(...args: unknown[]): void {
    this.write(
      {
        logLevel: 'INFO',
        logType: 'log',
      },
      ...args,
    );
  }
  info(...args: unknown[]): void {
    this.write(
      {
        logLevel: 'INFO',
        logType: 'info',
      },
      ...args,
    );
  }
  warn(...args: unknown[]): void {
    this.write(
      {
        logLevel: 'WARNING',
        logType: 'warn',
      },
      ...args,
    );
  }

  debug(...args: unknown[]): void {
    this.write(
      {
        logLevel: 'DEBUG',
        logType: 'debug',
      },
      ...args,
    );
  }

  spam(id: string, ...args: unknown[]): void {
    const content = args
      .map((a) => {
        if (typeof a === 'string') {
          return a;
        }
        try {
          return JSON.stringify(a);
        } catch {
          return `[${typeof a}]`;
        }
      })
      .join(' ');

    const now = Date.now();

    // Periodic cleanup: drop entries unused for > 60 s
    this._cleanupSpamState(now);

    const state = this._spamState.get(id);

    if (!state) {
      this._spamState.set(id, {
        lastContent: content,
        lastEmitted: now,
        suppressed: 0,
        suppressedSince: 0,
        lastAccess: now,
      });
      this.debug(...args);
      return;
    }

    state.lastAccess = now;

    if (state.lastContent === content) {
      state.suppressed++;
      if (state.suppressedSince === 0) {
        state.suppressedSince = now;
      }

      // Heartbeat every 10 s while suppressed
      if (now - state.suppressedSince >= 10_000) {
        this.debug(
          `[spam:${id}] (suppressed ${state.suppressed} repeats in ${((now - state.suppressedSince) / 1000).toFixed(0)}s)`,
        );
        state.suppressed = 0;
        state.suppressedSince = now;
      }
      return;
    }

    // Content changed — but throttle to SPAM_THROTTLE_MS floor
    if (now - state.lastEmitted < SPAM_THROTTLE_MS) {
      state.suppressed++;
      if (state.suppressedSince === 0) {
        state.suppressedSince = now;
      }
      return;
    }

    // Flush suppression tally, then emit new content
    if (state.suppressed > 0) {
      this.debug(`[spam:${id}] (suppressed ${state.suppressed} repeats)`);
    }

    state.lastContent = content;
    state.lastEmitted = now;
    state.suppressed = 0;
    state.suppressedSince = 0;
    this.debug(...args);
  }

  /** Drops spam-state entries that haven't been accessed in 60 s. */
  private _cleanupSpamState(now: number): void {
    // Only check every ~10 s to avoid per-call overhead
    if (now - this._lastSpamCleanup < 10_000) {
      return;
    }
    this._lastSpamCleanup = now;

    for (const [id, entry] of this._spamState) {
      if (now - entry.lastAccess > 60_000) {
        this._spamState.delete(id);
      }
    }
  }

  protected getMessage(element: unknown): string {
    if (typeof element === 'string') {
      return element;
    }

    // check if object and then set max chars to 1000 and end with ...
    if (typeof element === 'object' && element !== null && !(element instanceof Error)) {
      element = this._limitObjectOrArray(element);
    }
    return JSON.stringify(element, stringyReplacer, 2);
  }

  /**
   * Rate-limits repeated log signatures to prevent console / network
   * floods during infinite-loop or detached-buffer cascades.
   *
   * Returns `true` when the log should be dropped (rate-limited).
   * Never throws — throwing only kills the current microtask, which
   * is useless against async event floods (WebSocket, postMessage).
   *
   * Only active in dev; always returns `false` in production.
   */
  private _detectInfiniteLoop(entry: LogEntry, data: unknown[]): boolean {
    // Rate-limiting is dev-only.  In production, logs pass through
    // unthrottled (they won't flood at prod volumes).
    //
    // Detection order: Bun/Node process.env, then Vite import.meta.env.
    const isProduction =
      (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') ||
      (typeof import.meta !== 'undefined' &&
        (import.meta as unknown as Record<string, unknown>).env !== undefined && // guard-ignore lint/type-safety/casting: import.meta.env access for log level - env var types are dynamic
        !(import.meta as unknown as Record<string, unknown>).DEV); // guard-ignore lint/type-safety/casting: import.meta.env access for log level - env var types are dynamic

    if (isProduction) {
      return false;
    }

    const signature = entry.message || (typeof data[0] === 'string' ? data[0] : 'obj_log');
    const now = Date.now();

    if (this._lastLogSignature === signature && now - this._lastLogTimestamp < 50) {
      this._logRepeatCount++;

      if (this._logRepeatCount > 100) {
        if (this._logRepeatCount === 101) {
          // biome-ignore lint/suspicious/noConsole: one-shot rate-limit warning
          console.warn(
            `%c🚨 Rate-limiting log: "%c${signature}%c" is firing too rapidly (%c${this._logRepeatCount}+%c times). Dropping repeats silently.`,
            'font-weight:bold;color:#f59e0b',
            'font-weight:bold;color:#ef4444',
            'font-weight:bold;color:#f59e0b',
            'font-weight:bold',
            'font-weight:bold;color:#f59e0b',
          );
        }

        this._lastLogTimestamp = now;
        return true; // Drop silently — let the app crash naturally, don't throw
      }
    } else {
      this._lastLogSignature = signature;
      this._logRepeatCount = 1;
    }

    this._lastLogTimestamp = now;
    return false;
  }

  private _limitObjectOrArray<T extends unknown[] | object | null | unknown>(object: T): T {
    if (object === null) {
      return null as T;
    }
    if (typeof object === 'string') {
      return object as T;
    }

    if (Array.isArray(object)) {
      return object.map((element) => this._limitObjectOrArray(element as T)) as T;
    }
    if (typeof object !== 'object') {
      return object;
    }

    const result: Record<string, unknown> = {};
    for (const key in object) {
      if (!Object.hasOwn(object, key)) {
        continue;
      }
      const value = (object as Record<string, unknown>)[key];

      const keysToHide = ['thumbnailImageBase64', 'password', 'token', 'secret'];

      if (this.logLevel !== 'DEBUG' && keysToHide.includes(key)) {
        result[key] = value ? '...' : undefined;
        continue;
      }

      if (value === null) {
        result[key] = null;
      } else if (typeof value === 'string') {
        result[key] = value;
      } else if (value instanceof Error) {
        result[key] = {
          // Pull all enumerable properties, supporting properties on custom Errors
          ...value,
          message: value.message,
          // Pull specific non-enumerable properties
          name: value.name,
          stack: value.stack,
        };
      } else if (typeof value === 'object' && !(value instanceof Error)) {
        result[key] = this._limitObjectOrArray(value);
      } else {
        result[key] = JSON.stringify(value, stringyReplacer, 2);
      }
    }
    return result as T;
  }
}

const stringyReplacer = (_key: string, value: unknown) => {
  if (value instanceof Error) {
    return {
      // Pull all enumerable properties, supporting properties on custom Errors
      ...value,
      message: value.message,
      // Pull specific non-enumerable properties
      name: value.name,
      stack: value.stack,
    };
  }

  return value;
};
