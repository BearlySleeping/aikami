import process from 'node:process';
import type { LogEntry, LoggerInterface, TimerInterface } from '@aikami/types';
import { BaseLoggerService } from './base.ts';
import { Timer } from './timer.ts';

export type SvelteKitBackendLoggerInterface = LoggerInterface;

class SvelteKitTimer extends Timer implements TimerInterface {}

class SvelteKitBackendLoggerService
  extends BaseLoggerService
  implements SvelteKitBackendLoggerInterface
{
  override write(entry: LogEntry, ...data: unknown[]): void {
    try {
      if (this.shouldSkipLog(entry)) {
        return;
      }

      let { logType, message } = entry;

      if (!logType || logType === 'log') {
        logType = 'info';
      }

      if (!message) {
        const element = data.shift();
        message = this.getMessage(element);
        // Put the extracted message back on entry so sinks see it.
        (entry as Record<string, unknown>).message = message;
      }

      // Write to console
      // biome-ignore lint/suspicious/noConsole: logger implementation
      console[logType](this.getMessage(message));
      // biome-ignore lint/suspicious/noConsole: logger implementation
      console.log('\n');
      for (const element of data) {
        // biome-ignore lint/suspicious/noConsole: logger implementation
        console.log(this.getMessage(element));
      }

      // Flush to registered sinks (SSRLogSink for Firestore persistence)
      this._flushSinks(entry, ...data);
    } catch (_error) {
      // console.log(_error);
    }
  }

  override createTimer(): TimerInterface {
    return new SvelteKitTimer();
  }
}

export function createLogger(): LoggerInterface {
  return new SvelteKitBackendLoggerService({
    logLevel: process.env.LOG_LEVEL,
  });
}
