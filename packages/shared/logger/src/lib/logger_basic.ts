import type { LogEntry, LoggerInterface } from '@aikami/types';
import { BaseLoggerService } from './base.ts';

export type BasicLoggerInterface = LoggerInterface;

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
}

export const logger = new BasicLoggerService({});
