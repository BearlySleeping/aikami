// packages/backend/svelte-kit/src/lib/log_sink.test.ts
//
// Regression test for the staging pretty-print bug: SSRLogSink only wrote
// single-line JSON (parseable by Cloud Logging into jsonPayload) when
// AIKAMI_MODE === 'production'; staging pretty-printed multi-line JSON,
// which Cloud Logging shreds into unfilterable textPayload lines. Both
// deployed modes (staging AND production) must write exactly one line of
// JSON.stringify(payload); local modes (unset/emulator/testing) keep the
// human-readable pretty-print via console.log.
//
// Note: bun:test's spyOn reuses the same mock object when a property is
// already mocked, so call counts accumulate across tests — every test
// restores via mock.restore() in afterEach to get a fresh spy.

// biome-ignore-all lint/style/useNamingConvention: syslog severity level names

import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { LogEntry } from '@aikami/types';
import { SSRLogSink } from './log_sink.ts';

type TestContext = {
  sessionId?: string;
  userId?: string;
  ip?: string;
  route?: string;
  userAgent?: string;
  device?: unknown;
  source?: string;
  app?: string;
};

const store = new AsyncLocalStorage<TestContext>();

// logLevel (syslog enum) → lowercase console logType.
const LOG_TYPES: Record<string, LogEntry['logType']> = {
  DEBUG: 'debug',
  INFO: 'info',
  NOTICE: 'log',
  WARNING: 'warn',
  ERROR: 'error',
  CRITICAL: 'error',
  ALERT: 'error',
  EMERGENCY: 'error',
  NONE: 'log',
};

const makeEntry = (logLevel: NonNullable<LogEntry['logLevel']>, message: string): LogEntry => ({
  logLevel,
  logType: LOG_TYPES[logLevel] ?? 'log',
  message,
});

afterEach(() => {
  delete process.env.AIKAMI_MODE;
  mock.restore();
});

describe('SSRLogSink deployed modes (single-line JSON)', () => {
  for (const mode of ['staging', 'production'] as const) {
    test(`AIKAMI_MODE=${mode}: writes exactly one line of JSON.stringify(payload) to stdout`, () => {
      process.env.AIKAMI_MODE = mode;
      const stdoutWrite = spyOn(process.stdout, 'write');
      const stderrWrite = spyOn(process.stderr, 'write');
      const consoleLog = spyOn(console, 'log');

      const sink = new SSRLogSink(store);
      sink.write(makeEntry('INFO', 'hello'));

      expect(stdoutWrite).toHaveBeenCalledTimes(1);
      expect(stderrWrite).not.toHaveBeenCalled();
      expect(consoleLog).not.toHaveBeenCalled();

      const raw = String(stdoutWrite.mock.calls[0][0]);
      // Exactly one non-empty line — a single-line JSON doc + trailing newline.
      const lines = raw.split('\n').filter((l) => l.length > 0);
      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toContain('\n  '); // not pretty-printed

      const payload = JSON.parse(lines[0]);
      expect(payload.severity).toBe('INFO');
      expect(payload.message).toBe('hello');
      expect(payload.source).toBe('ssr');
    });
  }

  test('AIKAMI_MODE=staging: ERROR entries go to stderr as single-line JSON', () => {
    process.env.AIKAMI_MODE = 'staging';
    const stdoutWrite = spyOn(process.stdout, 'write');
    const stderrWrite = spyOn(process.stderr, 'write');

    const sink = new SSRLogSink(store);
    sink.write(makeEntry('ERROR', 'boom'));

    expect(stdoutWrite).not.toHaveBeenCalled();
    expect(stderrWrite).toHaveBeenCalledTimes(1);
    const raw = String(stderrWrite.mock.calls[0][0]);
    expect(raw.split('\n').filter((l) => l.length > 0)).toHaveLength(1);
    expect(JSON.parse(raw).severity).toBe('ERROR');
  });
});

describe('SSRLogSink local modes (pretty-print via console.log)', () => {
  for (const mode of [undefined, 'emulator', 'testing'] as const) {
    test(`AIKAMI_MODE=${String(mode)}: pretty-prints, never emits single-line JSON`, () => {
      if (mode !== undefined) {
        process.env.AIKAMI_MODE = mode;
      }
      const stdoutWrite = spyOn(process.stdout, 'write');
      const consoleLog = spyOn(console, 'log');

      const sink = new SSRLogSink(store);
      sink.write(makeEntry('DEBUG', 'local'));

      expect(consoleLog).toHaveBeenCalledTimes(1);
      const raw = String(consoleLog.mock.calls[0][0]);
      expect(raw).toContain('\n  '); // pretty-printed with indentation
      const payload = JSON.parse(raw);
      expect(payload.message).toBe('local');
      expect(payload.severity).toBe('DEBUG');

      // The sink itself must not emit single-line JSON payloads in local
      // mode. (console.log may internally route through process.stdout.write,
      // so assert on content, not call counts.)
      const stdout = stdoutWrite.mock.calls.map((call) => String(call[0])).join('');
      for (const line of stdout.split('\n')) {
        expect(line.startsWith('{"severity"')).toBe(false);
      }
    });
  }
});

describe('SSRLogSink context.app tagging', () => {
  test('includes app in the payload when the store context has it', () => {
    process.env.AIKAMI_MODE = 'production';
    const stdoutWrite = spyOn(process.stdout, 'write');

    const sink = new SSRLogSink(store);
    store.run({ source: 'client', app: 'client' }, () => {
      sink.write(makeEntry('INFO', 'browser log'));
    });

    const payload = JSON.parse(String(stdoutWrite.mock.calls[0][0]));
    expect(payload.app).toBe('client');
    expect(payload.source).toBe('client');
  });

  test('omits app (and other optional fields) when not in the store context', () => {
    process.env.AIKAMI_MODE = 'production';
    const stdoutWrite = spyOn(process.stdout, 'write');

    const sink = new SSRLogSink(store);
    store.run({ source: 'ssr' }, () => {
      sink.write(makeEntry('INFO', 'no app'));
    });

    const payload = JSON.parse(String(stdoutWrite.mock.calls[0][0]));
    expect(payload).not.toHaveProperty('app');
    expect(payload).not.toHaveProperty('sessionId');
    expect(payload).not.toHaveProperty('userId');
  });
});
