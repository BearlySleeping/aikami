import { LogLevelPriority } from '@aikami/constants';
import type { LogEntry, LoggerInterface, LogLevel, LogSink, TimerInterface } from '@aikami/types';

import { Timer } from './timer.ts';

export const isValidLogLevel = (logLevel?: string): logLevel is LogLevel =>
  !!logLevel && logLevel in LogLevelPriority;

export abstract class BaseLoggerService implements LoggerInterface {
  logLevel: LogLevel;
  protected _sinks: LogSink[] = [];

  // --- Infinite Loop Tracker State ---
  private _lastLogSignature = '';
  private _logRepeatCount = 0;
  private _lastLogTimestamp = 0;

  constructor(options?: { logLevel?: LogLevel | string }) {
    const logLevel = options?.logLevel?.toUpperCase();
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

  addSink(sink: LogSink): void {
    this._sinks.push(sink);
  }

  protected _flushSinks(entry: LogEntry, ...data: unknown[]): void {
    // Check for loops BEFORE we write to sinks so we don't spam the console/network
    this._detectInfiniteLoop(entry, data);

    for (const sink of this._sinks) {
      try {
        void sink.write(entry, ...data);
      } catch {
        // Sinks must never throw; swallow silently.
      }
    }
  }

  protected shouldSkipLog(options: { logLevel?: LogLevel }): boolean {
    if (this.logLevel === 'NONE') {
      return true;
    }

    const currentLogLevelPriority = this.toLogLevelPriority(this.logLevel);
    const entryLogLevelPriority = this.toLogLevelPriority(options.logLevel ?? 'INFO');

    return currentLogLevelPriority > entryLogLevelPriority;
  }

  createTimer(): TimerInterface {
    return new Timer();
  }

  protected toLogLevelPriority(logLevel: LogLevel): LogLevelPriority {
    return LogLevelPriority[logLevel];
  }

  abstract write(entry: LogEntry, ...data: unknown[]): void;

  error(...args: unknown[]): void {
    this.write(
      {
        logLevel: 'ERROR',
        logType: 'error',
      },
      ...args,
    );
  }
  log(...args: unknown[]): void {
    this.write(
      {
        logLevel: 'INFO',
        logType: 'log',
      },
      ...args,
    );
  }
  info(...args: unknown[]): void {
    this.write(
      {
        logLevel: 'INFO',
        logType: 'info',
      },
      ...args,
    );
  }
  warn(...args: unknown[]): void {
    this.write(
      {
        logLevel: 'WARNING',
        logType: 'warn',
      },
      ...args,
    );
  }

  debug(...args: unknown[]): void {
    this.write(
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

  /**
   * Super lite circuit breaker to detect infinite reactivity loops.
   * Only runs in development.
   */
  private _detectInfiniteLoop(entry: LogEntry, data: unknown[]): void {
    // 1. MUST NOT RUN IN PRODUCTION!
    // Assuming you have a way to check env here, e.g., import.meta.env.DEV
    if (typeof import.meta !== 'undefined' && !import.meta.env?.DEV) {
      return;
    }

    // 2. Create a fast, lightweight signature (don't deep stringify the whole object!)
    // We just use the log level, message, or the first string argument.
    const signature = entry.message || (typeof data[0] === 'string' ? data[0] : 'obj_log');

    const now = Date.now();

    // 3. Check if it's the exact same log happening very quickly (e.g., under 50ms apart)
    if (this._lastLogSignature === signature && now - this._lastLogTimestamp < 50) {
      this._logRepeatCount++;

      // 4. If we hit 150 identical, rapid-fire logs, KILL IT.
      if (this._logRepeatCount > 150) {
        this._logRepeatCount = 0; // Reset so we don't trap the error handler itself

        // Throwing a hard error breaks the JS execution thread, stopping the infinite loop!
        throw new Error(
          `🚨 EMERGENCY HALT: Infinite loop detected! The log "${signature}" fired 150+ times in a few milliseconds.`,
        );
      }
    } else {
      // Reset the tracker if it's a new log or enough time has passed
      this._lastLogSignature = signature;
      this._logRepeatCount = 1;
    }

    this._lastLogTimestamp = now;
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
