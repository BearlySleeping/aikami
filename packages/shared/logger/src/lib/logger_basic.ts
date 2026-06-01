import type { LogEntry, LoggerInterface, TimerInterface } from '@aikami/types';
import { BaseLoggerService } from './base.ts';
import { Timer } from './timer.ts';

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

export const logger = new BasicLoggerService({});
