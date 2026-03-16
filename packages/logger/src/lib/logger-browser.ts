import { type BaseLoggerInterface, BaseLoggerService, type LogEntry } from './base.ts';
import { Timer, type TimerInterface } from './timer.ts';

export type FrontendLoggerInterface = BaseLoggerInterface;
class FrontendTimer extends Timer implements TimerInterface {}
class FrontendLoggerService extends BaseLoggerService implements FrontendLoggerInterface {
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
    } catch (_error) {
      // console.log(e);
    }
  }

  override createTimer(): TimerInterface {
    return new FrontendTimer();
  }
}

export const logger = new FrontendLoggerService({
  logLevel: import.meta.env.PUBLIC_LOG_LEVEL,
});
