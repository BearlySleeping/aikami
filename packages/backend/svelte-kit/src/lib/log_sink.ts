// biome-ignore-all lint/style/useNamingConvention: syslog severity level names

import type { AsyncLocalStorage } from 'node:async_hooks';
import type { LogEntry, LogSink } from '@aikami/types';

/** Cloud Logging severity map: logLevel → severity string */
const SEVERITY_MAP: Record<string, string> = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  NOTICE: 'NOTICE',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL',
  ALERT: 'ALERT',
  EMERGENCY: 'EMERGENCY',
};

/**
 * SSR log sink that writes structured JSON to stdout/stderr.
 *
 * Pass the same `logContextStore` instance your hooks.server.ts uses so that
 * log entries are tagged with the correct request context.
 *
 * In production (AIKAMI_MODE=production), output is structured JSON
 * compatible with Cloud Logging. In dev/emulator, output is pretty-printed
 * to the console.
 */
export class SSRLogSink implements LogSink {
  constructor(
    private readonly _logContextStore: AsyncLocalStorage<{
      sessionId?: string;
      userId?: string;
      ip?: string;
      route?: string;
      userAgent?: string;
      device?: unknown;
      source?: string;
    }>,
  ) {}

  write(entry: LogEntry, ...data: unknown[]): void {
    try {
      const context = this._logContextStore.getStore();
      const message = entry.message ?? (data.length > 0 ? String(data[0]) : 'unknown');
      const entryLevel = entry.logLevel ?? 'INFO';
      const severity = SEVERITY_MAP[entryLevel] ?? 'DEFAULT';

      const metadata = data.map((d) => {
        if (typeof d === 'string') {
          return d;
        }
        try {
          return JSON.parse(JSON.stringify(d));
        } catch {
          return String(d);
        }
      });

      const payload: Record<string, unknown> = {
        severity,
        message: String(message).slice(0, 2000),
        source: context?.source ?? 'ssr',
      };

      if (context?.sessionId) {
        payload.sessionId = context.sessionId;
      }
      if (context?.userId) {
        payload.userId = context.userId;
      }
      if (context?.ip) {
        payload.ip = context.ip;
      }
      if (context?.route) {
        payload.route = context.route;
      }
      if (context?.userAgent) {
        payload.userAgent = context.userAgent;
      }
      if (metadata.length > 0) {
        payload.metadata = metadata;
      }

      const isProduction = process.env.AIKAMI_MODE === 'production';
      if (isProduction) {
        const stream =
          entryLevel === 'ERROR' || entryLevel === 'CRITICAL' ? process.stderr : process.stdout;
        stream.write(`${JSON.stringify(payload)}\n`);
      } else {
        // biome-ignore lint/suspicious/noConsole: logger implementation
        console.log(JSON.stringify(payload, null, 2));
      }
    } catch {
      // Sinks must never throw.
    }
  }
}
