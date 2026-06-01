import process from 'node:process';
import type { LogEntry, LoggerInterface } from '@aikami/types';
import { logger as firebaseFunctionsLogger } from 'firebase-functions/logger';
import { BaseLoggerService } from './base.ts';

export type FunctionsLoggerInterface = LoggerInterface;

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
        process.env.FIREBASE_CONFIG && !process.env.FUNCTIONS_EMULATOR
          ? firebaseFunctionsLogger
          : console;

      const log = baseLog[logType ?? 'log'];

      log(this.getMessage(message));
      for (const element of data) {
        log(this.getMessage(element));
      }
    } catch (_error) {
      // console.log(e);
    }
  }
}

export const logger = new FunctionsLoggerService({
  logLevel: process.env.LOG_LEVEL,
});
