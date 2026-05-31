import { LogLevelPriority } from '@aikami/constants';
import type { LogContext, LogEntry, LoggerInterface, TimerInterface } from '@aikami/types';
import { BaseLoggerService } from './base.ts';
import { Timer } from './timer.ts';

const BATCH_FLUSH_INTERVAL_MS = 5000;
const BATCH_MAX_SIZE = 50;

export type FrontendLoggerInterface = LoggerInterface;
class FrontendTimer extends Timer implements TimerInterface {}

class FrontendLoggerService extends BaseLoggerService implements FrontendLoggerInterface {
  private _batch: Array<{ entry: LogEntry; data: unknown[] }> = [];
  private _context: Partial<LogContext> = {};
  private _isFlushing = false;
  /** Minimum log level priority for remote persistence. */
  private _persistLevelPriority: number;

  constructor(options?: { logLevel?: string; persistLevel?: string }) {
    super(options);
    // Configurable persistence threshold: env var > options > default 'WARNING'
    const envPersist =
      typeof process !== 'undefined' ? process.env?.PUBLIC_LOG_PERSIST_LEVEL : undefined;
    const persistLevel = envPersist ?? options?.persistLevel ?? 'WARNING';
    this._persistLevelPriority =
      LogLevelPriority[persistLevel as keyof typeof LogLevelPriority] ?? LogLevelPriority.WARNING;
    this._startFlushTimer();
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this._flush());
      window.addEventListener('error', () => this._flush());
    }
  }

  setContext(ctx: Record<string, unknown>): void {
    this._context = { ...this._context, ...ctx } as Partial<LogContext>;
  }

  write(entry: LogEntry, ...data: unknown[]): void {
    try {
      if (this.shouldSkipLog(entry)) {
        return;
      }

      const { logLevel, logType, message } = entry;

      const currentLogLevelPriority = this.toLogLevelPriority(this.logLevel);
      const entryLogLevelPriority = this.toLogLevelPriority(logLevel ?? 'INFO');

      if (currentLogLevelPriority > entryLogLevelPriority) {
        return;
      }

      // biome-ignore lint/suspicious/noConsole: this is the logger package
      const log = console[logType ?? 'log'];
      if (typeof message !== 'undefined') {
        log(message, ...data);
      } else {
        log(...data);
      }

      // Persist to the remote batch sink (threshold configurable via PUBLIC_LOG_PERSIST_LEVEL env / persistLevel option).
      if (entryLogLevelPriority >= this._persistLevelPriority) {
        this._batch.push({ entry, data });
        if (this._batch.length > BATCH_MAX_SIZE) {
          this._batch.shift();
        }
        this._scheduleFlush();
      }
    } catch (_error) {
      // console.log(e);
    }
  }

  override createTimer(): TimerInterface {
    return new FrontendTimer();
  }

  private _startFlushTimer(): void {
    if (typeof window !== 'undefined') {
      setInterval(() => this._flush(), BATCH_FLUSH_INTERVAL_MS);
    }
  }

  private _scheduleFlush(): void {
    // The periodic timer handles the actual flush; this method
    // exists so callers can trigger an eager flush if desired.
  }

  private _flush(): void {
    if (this._isFlushing || this._batch.length === 0) {
      return;
    }
    this._isFlushing = true;

    const payload = { logs: this._batch, context: this._context };
    this._batch = [];
    // TODO implment logging
    // fetch('/api/logs', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(payload),
    //   keepalive: true,
    // })
    //   .then(() => {
    //     // success
    //   })
    //   .catch(() => {
    //     // On failure, restore the batch (capped to max size).
    //     this._batch = payload.logs.concat(this._batch).slice(-BATCH_MAX_SIZE);
    //   })
    //   .finally(() => {
    //     this._isFlushing = false;
    //   });
  }
}

export function createLogger(): LoggerInterface {
  return new FrontendLoggerService({
    logLevel: import.meta.env.PUBLIC_LOG_LEVEL,
    persistLevel: import.meta.env.PUBLIC_LOG_PERSIST_LEVEL,
  });
}

/**
 * Singleton browser logger instance.
 * Used by packages that import `{ logger }` from `$logger`.
 */
export const logger = createLogger();
