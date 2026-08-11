// apps/frontend/client/src/lib/services/tauri_console_log.ts
//
// Tauri desktop: forward browser console messages to the tauri-plugin-log
// Rust targets (stdout + log file). This makes the Tauri webview's page logs
// visible in the app's stdout — `herdr_session read client` in dev mode, or
// the terminal in the embedded build — which is otherwise impossible with
// WebKitGTK (no console forwarding built in).
//
// No-op in a plain browser (no __TAURI__ global).

// biome-ignore-all lint/suspicious/noConsole: this module intentionally wraps console for forwarding

import { debug, error, info, trace, warn } from '@tauri-apps/plugin-log';

let _done = false;

/** JSON.stringify replacer that expands Error instances instead of dropping
 *  their (non-enumerable-on-some-engines) message/stack to `{}`. */
const errorReplacer = (_key: string, value: unknown): unknown => {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
};

/** `String(someObject)` collapses to the useless literal `"[object Object]"`
 *  — this is why nested error/metadata objects logged via `logger.warn(msg,
 *  { error })` were unreadable in the forwarded Tauri console. Errors get
 *  their full stack; other objects get real JSON; circular refs fall back
 *  to String() instead of throwing. */
const stringifyArg = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }
  if (value === null || typeof value !== 'object') {
    return String(value);
  }
  try {
    return JSON.stringify(value, errorReplacer) ?? String(value);
  } catch {
    return String(value);
  }
};

const init = (): void => {
  if (_done) {
    return;
  }
  _done = true;

  if (typeof window === 'undefined' || !('__TAURI__' in window)) {
    return;
  }

  const forward = (
    name: 'log' | 'debug' | 'info' | 'warn' | 'error',
    logger: (message: string) => Promise<void>,
  ): void => {
    const original = console[name];
    console[name] = (...args: unknown[]): void => {
      original?.(...args);
      try {
        logger(args.map(stringifyArg).join(' ')).catch(() => {
          // Forwarding must never break app code.
        });
      } catch {
        // Forwarding must never break app code.
      }
    };
  };
  forward('log', trace);
  forward('debug', debug);
  forward('info', info);
  forward('warn', warn);
  forward('error', error);

  void info('[tauri-console-log] console forwarding installed');
};

init();
