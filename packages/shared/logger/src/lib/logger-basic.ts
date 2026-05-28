import { type BaseLoggerInterface, BaseLoggerService, type LogEntry } from './base.ts';
import { Timer, type TimerInterface } from './timer.ts';

export type BasicLoggerInterface = BaseLoggerInterface;

class BasicTimer extends Timer implements TimerInterface {}
class BasicLoggerService extends BaseLoggerService implements BasicLoggerInterface {
  write(entry: LogEntry, ...data: unknown[]): void {
    try {
      if (this.shouldSkipLog(entry)) {
        return;
      }

      const { logType, message } = entry;

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

export const logger = new BasicLoggerService({
  logLevel: process.env.LOG_LEVEL,
});
