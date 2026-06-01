// apps/frontend/game/src/lib/core/logger.ts
import {
  BaseLoggerService,
  type LogEntry,
  type LoggerInterface,
  Timer,
  type TimerInterface,
} from '@aikami/logger';

export type BasicLoggerInterface = LoggerInterface;

class BasicTimer extends Timer implements TimerInterface {}

class BasicLoggerService extends BaseLoggerService implements BasicLoggerInterface {
  write(entry: LogEntry, ...data: unknown[]): void {
    try {
      if (this.shouldSkipLog(entry)) {
        return;
      }

      const { logType, message } = entry;

      // biome-ignore lint/suspicious/noConsole: logger implementation
      const log = console[logType ?? 'log'];

      log(logType, message);
      for (const element of data) {
        log(this.getMessage(element));
      }
      log('\n');
    } catch (_error) {
      // console.log(e);
    }
  }

  override createTimer(): TimerInterface {
    return new BasicTimer();
  }
}

export type { LogEntry };

export const logger = new BasicLoggerService({
  logLevel: import.meta.env.LOG_LEVEL,
});
