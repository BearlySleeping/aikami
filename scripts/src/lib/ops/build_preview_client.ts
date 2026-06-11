// scripts/src/lib/ops/build_preview_client.ts
//
// Builds the client PWA for emulator-mode preview, clearing stale
// build artifacts first.  Pass --open to launch the browser after
// the preview server starts.
//
// Usage:
//   bun run scripts/src/lib/ops/build_preview_client.ts
//   bun run scripts/src/lib/ops/build_preview_client.ts --open

import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const ROOT = resolve(import.meta.dirname, '../../../..');
const CLIENT_DIR = resolve(ROOT, 'apps/frontend/client');
const BUILD_DIR = resolve(CLIENT_DIR, 'build');
const SVELTE_KIT_DIR = resolve(CLIENT_DIR, '.svelte-kit');
const PREVIEW_PORT = 5274;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}/dev/sandbox`;
const STARTUP_TIMEOUT_MS = 15_000;

function log(prefix: string, color: string, message: string): void {
  console.log(`${color}${BOLD}[${prefix}]${RESET} ${message}`);
}

function info(message: string): void {
  log('info', BLUE, message);
}

function success(message: string): void {
  log('ok', GREEN, message);
}

function warn(message: string): void {
  log('warn', YELLOW, message);
}

function error(message: string): void {
  log('error', RED, message);
}

/** Removes a directory if it exists. */
const cleanDir = (dirPath: string, label: string): void => {
  if (existsSync(dirPath)) {
    info(`Cleaning ${label}…`);
    rmSync(dirPath, { recursive: true, force: true });
  }
};

/** Spawns a child process and waits for it to complete. */
const spawn = (cmd: string[], label: string): Promise<number> => {
  return new Promise((resolvePromise) => {
    info(`Running: ${cmd.join(' ')}`);
    const proc = Bun.spawn({
      cmd,
      cwd: ROOT,
      stdout: 'inherit',
      stderr: 'inherit',
    });
    proc.exited.then((code) => {
      if (code === 0) {
        success(`${label} — exit 0`);
      } else {
        error(`${label} — exit ${code}`);
      }
      resolvePromise(code);
    });
  });
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const shouldOpen = args.includes('--open');
const shouldUseForce = args.includes('--force');

console.log(`\n${BOLD}Aikami Client Preview Build${RESET}\n`);

// 1. Clean stale artifacts
cleanDir(BUILD_DIR, 'build/');
cleanDir(SVELTE_KIT_DIR, '.svelte-kit/');

// 2. Build the client in emulator mode
const buildCode = await spawn(
  [
    'bun',
    'run',
    'moon',
    'run',
    'client:build',
    shouldUseForce ? '--force' : '',
    '--',
    '--mode',
    'emulator',
  ],
  'client:build (emulator)',
);

if (buildCode !== 0) {
  error('Build failed. Aborting preview.');
  process.exit(buildCode);
}

// 3. Start preview server (background, keep alive)
info(`Starting preview server on port ${PREVIEW_PORT}…`);

const previewProc = Bun.spawn({
  cmd: ['bun', 'run', 'moon', 'run', 'client:preview', '--', '--mode', 'emulator'],
  cwd: ROOT,
  stdout: 'inherit',
  stderr: 'inherit',
});

// Wait for the server to be ready by polling the health endpoint
const started = await new Promise<boolean>((resolvePromise) => {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  const check = async (): Promise<void> => {
    if (Date.now() > deadline) {
      warn(`Preview server did not respond within ${STARTUP_TIMEOUT_MS}ms`);
      resolvePromise(false);
      return;
    }

    try {
      const response = await fetch(PREVIEW_URL, { signal: AbortSignal.timeout(2000) });
      if (response.ok || response.status === 404) {
        // 200 or 404 both mean the server is listening
        success(`Preview server ready at ${PREVIEW_URL}`);
        resolvePromise(true);
        return;
      }
    } catch {
      // Server not ready yet
    }

    setTimeout(check, 500);
  };

  check();
});

if (shouldOpen && started) {
  info(`Opening ${PREVIEW_URL} in browser…`);
  Bun.spawn({
    cmd: process.platform === 'darwin' ? ['open', PREVIEW_URL] : ['xdg-open', PREVIEW_URL],
    stdout: 'inherit',
    stderr: 'inherit',
  });
}

success('Preview server running. Press Ctrl+C to stop.');

// Keep the script alive while the preview server runs
await previewProc.exited;
