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
        logger(args.map((a) => String(a)).join(' ')).catch(() => {
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
