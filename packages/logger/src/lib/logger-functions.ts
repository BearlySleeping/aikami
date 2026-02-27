import process from 'node:process';
import logger from 'firebase-functions/logger';
import { type BaseLoggerInterface, BaseLoggerService, type LogEntry } from './base.ts';
import { Timer, type TimerInterface } from './timer.ts';

export type FunctionsLoggerInterface = BaseLoggerInterface;

class FunctionsTimer extends Timer implements TimerInterface {}

class FunctionsLoggerService extends BaseLoggerService implements FunctionsLoggerInterface {
  override write(entry: LogEntry, ...data: unknown[]): void {
    try {
      if (this.shouldSkipLog(entry)) {
        return;
      }
      const { logType } = entry;
      let message = entry.message;

      if (!message) {
        const element = data.shift();
        message = this.getMessage(element);
      }

      const baseLog =
        process.env.FIREBASE_CONFIG && !process.env.FUNCTIONS_EMULATOR ? logger : console;

      const log = baseLog[logType ?? 'log'];

      log(this.getMessage(message));
      for (const element of data) {
        log(this.getMessage(element));
      }
    } catch (_error) {
      // console.log(e);
    }
  }

  override createTimer(): TimerInterface {
    return new FunctionsTimer();
  }
}

export default new FunctionsLoggerService({
  logLevel: process.env.LOG_LEVEL,
});
