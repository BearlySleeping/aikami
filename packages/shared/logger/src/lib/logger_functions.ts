import process from 'node:process';
import type { LogEntry, LoggerInterface } from '@aikami/types';
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

      // biome-ignore lint/suspicious/noConsole: logger implementation
      const log = console[logType ?? 'log'];

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
