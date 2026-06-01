import type { LogContext, LogEntry, LoggerInterface, LogSink } from '@aikami/types';
import { BaseLoggerService, isValidLogLevel } from './lib/base.ts';
import { logger } from './lib/logger_basic.ts';

export { Timer, type TimerInterface } from './lib/timer.ts';

export {
  BaseLoggerService,
  isValidLogLevel,
  type LogContext,
  type LogEntry,
  type LoggerInterface,
  type LogSink,
  logger,
};
