import { LogLevelPriority } from '@aikami/constants';
import type { LogLevel } from '@aikami/types';
import type { TimerInterface } from './timer.ts';
/** `LogType` indicates the type of console log. See {@link Console} */
export type LogType = 'debug' | 'info' | 'warn' | 'error' | 'log';

/**
 * `LogEntry` represents a structured entry. All keys aside from `level`,
 * `logType` and `message` are included in the log.
 */
export type LogEntry = {
  logLevel?: LogLevel;
  logType?: LogType;
  message?: string;
};

/**
 * `Logger` is a wrapper around the console object. It provides a structured
 * logging interface and a way to dynamically set the {@link LogLevel} (log
 * level).
 *
 * In production, the log level is set to `CRITICAL` by default.
 *
 * In development, the log level is set to `INFO` by default.
 */
export type BaseLoggerInterface = {
  logLevel: LogLevel;

  createTimer(): TimerInterface;

  /**
   * Sets the current log level. If the level is not set, it will never log
   * anything.
   *
   * In production, the default level is undefined.
   *
   * @param logLevel The logLevel to set.
   */
  setLogLevel(logLevel: LogLevel): void;

  /**
   * Writes a `LogEntry` to the console.
   *
   * If the level is not set, it will never log anything. If the level is set,
   * it will only log if the level is greater than or equal to the current
   * level. See {@link LogLevelPriority} for the priority order.
   *
   * The default {@link LogLevel} is `INFO`.
   *
   * The default {@link LogType} is `log`.
   *
   * @param entry - The `LogEntry` including level, message, and any
   *   additional structured metadata.
   */
  write(entry: LogEntry, ...data: unknown[]): void;
  /**
   * Writes a `debug` {@link LogType}.
   *
   * The default {@link LogLevel} is `INFO`.
   *
   * @param args - Arguments, concatenated into the log message.
   */
  debug(...args: unknown[]): void;
  /**
   * Writes a `log` {@link LogType}.
   *
   * The default {@link LogLevel} is `INFO`.
   *
   * @param args - Arguments, concatenated into the log message.
   */
  log(...args: unknown[]): void;
  /**
   * Writes a `info` {@link LogType}.
   *
   * The default {@link LogLevel} is `INFO`.
   *
   * @param args - Arguments, concatenated into the log message.
   */
  info(...args: unknown[]): void;
  /**
   * Writes a `warn` {@link LogType}.
   *
   * The default {@link LogLevel} is `WARNING`.
   *
   * @param args - Arguments, concatenated into the log message.
   */
  warn(...args: unknown[]): void;
  /**
   * Writes a `error` {@link LogType}.
   *
   * The default {@link LogLevel} is `ERROR`.
   *
   * @param args - Arguments, concatenated into the log message.
   * @public
   */
  error(...args: unknown[]): void;
};
export const isValidLogLevel = (logLevel?: string): logLevel is LogLevel =>
  !!logLevel && logLevel in LogLevelPriority;

export abstract class BaseLoggerService implements BaseLoggerInterface {
  logLevel: LogLevel;

  constructor(options?: { logLevel?: LogLevel | string }) {
    const logLevel = options?.logLevel;
    this.logLevel = isValidLogLevel(logLevel) ? logLevel : 'INFO';
  }

  setLogLevel(logLevel: LogLevel): void {
    if (!isValidLogLevel(logLevel)) {
      this.warn(
        `Invalid log level "${logLevel}". Valid levels are: ${Object.keys(LogLevelPriority).join(
          ', ',
        )}`,
      );
      return;
    }

    this.logLevel = logLevel;
  }

  protected shouldSkipLog(options: { logLevel?: LogLevel }): boolean {
    if (this.logLevel === 'NONE') {
      return true;
    }

    const currentLogLevelPriority = this.toLogLevelPriority(this.logLevel);
    const entryLogLevelPriority = this.toLogLevelPriority(options.logLevel ?? 'INFO');

    return currentLogLevelPriority > entryLogLevelPriority;
  }

  abstract createTimer(): TimerInterface;

  protected toLogLevelPriority(logLevel: LogLevel): LogLevelPriority {
    return LogLevelPriority[logLevel];
  }

  abstract write(entry: LogEntry, ...data: unknown[]): void;

  error(...args: unknown[]): void {
    return this.write(
      {
        logLevel: 'ERROR',
        logType: 'error',
      },
      ...args,
    );
  }
  log(...args: unknown[]): void {
    return this.write(
      {
        logLevel: 'INFO',
        logType: 'log',
      },
      ...args,
    );
  }
  info(...args: unknown[]): void {
    return this.write(
      {
        logLevel: 'INFO',
        logType: 'info',
      },
      ...args,
    );
  }
  warn(...args: unknown[]): void {
    return this.write(
      {
        logLevel: 'WARNING',
        logType: 'warn',
      },
      ...args,
    );
  }

  debug(...args: unknown[]): void {
    return this.write(
      {
        logLevel: 'DEBUG',
        logType: 'debug',
      },
      ...args,
    );
  }

  protected getMessage(element: unknown): string {
    if (typeof element === 'string') {
      return element;
    }

    // check if object and then set max chars to 1000 and end with ...
    if (typeof element === 'object' && element !== null && !(element instanceof Error)) {
      element = this._limitObjectOrArray(element);
    }
    return JSON.stringify(element, stringyReplacer, 2);
  }

  private _limitObjectOrArray<T extends unknown[] | object | null | unknown>(object: T): T {
    if (object === null) {
      return null as T;
    }
    if (typeof object === 'string') {
      return object as T;
    }

    if (Array.isArray(object)) {
      return object.map((element) => this._limitObjectOrArray(element as T)) as T;
    }
    if (typeof object !== 'object') {
      return object;
    }

    const result: Record<string, unknown> = {};
    for (const key in object) {
      if (!Object.hasOwn(object, key)) {
        continue;
      }
      const value = (object as Record<string, unknown>)[key];

      const keysToHide = ['thumbnailImageBase64', 'password', 'token', 'secret'];

      if (this.logLevel !== 'DEBUG' && keysToHide.includes(key)) {
        result[key] = value ? '...' : undefined;
        continue;
      }

      if (value === null) {
        result[key] = null;
      } else if (typeof value === 'string') {
        result[key] = value;
      } else if (value instanceof Error) {
        result[key] = {
          // Pull all enumerable properties, supporting properties on custom Errors
          ...value,
          message: value.message,
          // Pull specific non-enumerable properties
          name: value.name,
          stack: value.stack,
        };
      } else if (typeof value === 'object' && !(value instanceof Error)) {
        result[key] = this._limitObjectOrArray(value);
      } else {
        result[key] = JSON.stringify(value, stringyReplacer, 2);
      }
    }
    return result as T;
  }
}

const stringyReplacer = (_key: string, value: unknown) => {
  if (value instanceof Error) {
    return {
      // Pull all enumerable properties, supporting properties on custom Errors
      ...value,
      message: value.message,
      // Pull specific non-enumerable properties
      name: value.name,
      stack: value.stack,
    };
  }

  return value;
};
