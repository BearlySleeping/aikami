// packages/shared/logger/src/lib/logger_browser.ts
import type { LogEntry, LoggerInterface } from '@aikami/types';
import { BaseLoggerService } from './base.ts';

export type FrontendLoggerInterface = LoggerInterface;

class FrontendLoggerService extends BaseLoggerService implements FrontendLoggerInterface {
  write(entry: LogEntry, ...data: unknown[]): void {
    try {
      if (this.shouldSkipLog(entry)) {
        return;
      }

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
  return new FrontendLoggerService({
    logLevel: import.meta.env.PUBLIC_LOG_LEVEL,
  });
}

/**
 * Singleton browser logger instance.
 * Used by packages that import `{ logger }` from `$logger`.
 */
export const logger = createLogger();
