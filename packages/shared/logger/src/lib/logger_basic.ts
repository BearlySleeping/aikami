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

      // The variadic helpers (logger.info('text')) build a LogEntry with no
      // `message` — the text arrives in `data`. Printing the header
      // unconditionally emitted a literal "info undefined" line before every
      // such call, which is most of the build-script output.
      if (message !== undefined) {
        log(logType, message);
      }
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
