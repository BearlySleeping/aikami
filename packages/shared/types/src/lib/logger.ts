import type { LogLevelPriority } from '@aikami/constants';
import { DeviceData } from './device';

export type TimerInterface = {
  /**
   * Returns the duration in milliseconds. If you have passed sentry
   * TransactionContext to the constructor / createTimer method, it will also
   * finish the transaction and span.
   *
   * NB: this method should only be called once, if you want to keep the timer
   * running, use `getTimeInMS` instead.
   *
   * @returns Duration in ms
   */
  finish(): bigint;
  /**
   * Returns the duration in milliseconds. This will not finish the
   * transaction and span. If you want to finish the transaction and span, use
   * `finish` instead.
   *
   * @returns Duration in ms
   */
  getTimeInMS(): bigint;
};

/**
 * `LogLevel` indicates the detailed level of the log entry. See
 * {@link LogLevelPriority} for priority.
 */
export type LogLevel = keyof typeof LogLevelPriority;

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
 * A `LogSink` receives structured log entries for external persistence
 * (e.g. Firestore, HTTP batch endpoint). Sinks are fire-and-forget;
 * errors inside a sink must not bubble up to the caller.
 */
export type LogSink = {
  write(entry: LogEntry, ...data: unknown[]): void | Promise<void>;
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
export type LoggerInterface = {
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
   * Registers a `LogSink` that will receive every structured log entry.
   */
  addSink(sink: LogSink): void;

  /**
   * Sets request-scoped context for the next remote log write.
   * Only meaningful in the browser sink.
   */
  setContext?(ctx: Record<string, unknown>): void;

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


/**
 * Context automatically attached to every persisted log entry.
 * Populated via `AsyncLocalStorage` in SSR / Functions, or
 * explicitly in the browser sink.
 */
export type LogContext = {
  source: 'client' | 'ssr' | 'functions';
  userId?: string;
  companyId?: string;
  sessionId?: string;
  ip?: string;
  route?: string;
  device?: DeviceData;
  userAgent?: string;
};
