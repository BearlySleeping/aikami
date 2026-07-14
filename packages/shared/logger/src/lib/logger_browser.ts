// packages/shared/logger/src/lib/logger_browser.ts
import type { LogEntry, LoggerInterface, LogSink } from '@aikami/types';
import { BaseLoggerService } from './base.ts';

export type { LogEntry };
export type FrontendLoggerInterface = LoggerInterface;

/**
 * HTTP log sink — sends structured log entries to the Vite dev server's
 * /api/logs endpoint so they appear in `herdr_session read client` output.
 *
 * Only active when `fetch` is available (browser env). Silently skipped
 * in Bun test environment and production builds.
 *
 * Entries matching the {@link _excludePattern} are silently dropped to
 * avoid flooding the endpoint with per-frame render logs.
 */
class HttpLogSink implements LogSink {
  private _buffer: LogEntry[] = [];
  private _flushTimer: ReturnType<typeof setTimeout> | undefined;

  /** Messages matching this pattern are excluded from /api/logs (render spam). */
  private readonly _excludePattern =
    /^\d{2}:\d{2} \[GameWorld\] (render|position_changed|pause|resume|setInputLocked)$/;

  write(entry: LogEntry, ..._data: unknown[]): void {
    if (typeof fetch !== 'function') {
      return;
    }
    // Drop noisy per-frame render logs — they flood /api/logs at 60fps
    if (entry.message && this._excludePattern.test(entry.message)) {
      return;
    }
    this._buffer.push(entry);
    this._scheduleFlush();
  }

  /** Flushes buffered log entries to /api/logs immediately. */
  flush(): void {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = undefined;
    }
    if (this._buffer.length === 0) {
      return;
    }
    const batch = this._buffer.splice(0);
    void fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'logger', payload: { batch } }),
    }).catch(() => {
      // Dev server may not be running — silent fallback
    });
  }

  private _scheduleFlush(): void {
    if (this._flushTimer) {
      return;
    }
    // Batch log entries every 500ms to avoid flooding
    this._flushTimer = setTimeout(() => {
      this._flushTimer = undefined;
      this.flush();
    }, 500);
  }
}

class FrontendLoggerService extends BaseLoggerService implements FrontendLoggerInterface {
  private readonly _httpSink: HttpLogSink;

  constructor() {
    super({ logLevel: import.meta.env.PUBLIC_LOG_LEVEL });
    this._httpSink = new HttpLogSink();
    this.addSink(this._httpSink);
  }

  /** Flushes the HTTP log sink immediately. */
  flush(): void {
    this._httpSink.flush();
  }

  write(entry: LogEntry, ...data: unknown[]): void {
    try {
      if (this.shouldSkipLog(entry)) {
        return;
      }

      // Write to sinks (including /api/logs HTTP sink)
      this._flushSinks(entry, ...data);

      // Also write to browser console
      const { logType, message } = entry;
      // biome-ignore lint/suspicious/noConsole: this is the logger package
      const log = console[logType ?? 'log'];
      if (typeof message !== 'undefined') {
        log(message, ...data);
      } else {
        log(...data);
      }
    } catch (_error) {
      // console.log(e);
    }
  }
}

export function createLogger(): LoggerInterface {
  return new FrontendLoggerService();
}

/**
 * Singleton browser logger instance.
 * Used by packages that import `{ logger }` from `$logger`.
 */
export const logger = createLogger();
