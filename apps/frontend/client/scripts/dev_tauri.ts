#!/usr/bin/env bun
// apps/frontend/client/scripts/dev_tauri.ts

/**
 * Runs the Vite dev server in Tauri (desktop) mode.
 *
 * Wired into `beforeDevCommand` in tauri.conf.json so `tauri dev` gets the
 * same environment as the production desktop bundle.
 *
 * Why a wrapper instead of an inline env assignment
 * ------------------------------------------------
 * `beforeDevCommand` runs through the platform shell, where `VAR=value cmd`
 * is not portable (`cmd.exe` has no such syntax). bun is always the runner,
 * so TypeScript is fine here — the same reason `build_tauri.ts` exists.
 *
 * Why AIKAMI_DESKTOP_BUILD matters
 * --------------------------------
 * vite.config.ts aliases every `@tauri-apps/*` import to
 * `lib/stubs/tauri_stub.ts` (which exports only a default `{}`) for browser
 * builds. Under `tauri dev` the app runs in a real Tauri webview and the
 * guarded paths DO execute, so the stub would leave `appDataDir`,
 * `readTextFile`, `info` and friends `undefined` — every call site failing
 * with `TypeError: x is not a function`. This flag makes the desktop build
 * resolve the real plugin packages.
 *
 * Mode resolution matches build_tauri.ts: --mode > TAURI_BUILD_MODE > emulator.
 */

import { type SpawnSyncOptions, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '@aikami/logger';

const CLIENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const VALID_MODES = ['emulator', 'staging', 'production'] as const;
type BuildMode = (typeof VALID_MODES)[number];

const args = process.argv.slice(2);
const modeIndex = args.findIndex((arg) => arg === '--mode' || arg.startsWith('--mode='));
let modeFlag: string | undefined;
if (modeIndex !== -1) {
  const modeArg = args[modeIndex];
  modeFlag = modeArg === '--mode' ? (args[modeIndex + 1] ?? '') : modeArg?.slice('--mode='.length);
}
const rawMode = modeFlag ?? process.env.TAURI_BUILD_MODE ?? 'emulator';

if (!VALID_MODES.includes(rawMode as BuildMode)) {
  logger.error(`❌ Invalid mode "${rawMode}". Valid: ${VALID_MODES.join(', ')}`);
  process.exit(1);
}

logger.info(`\n▶ vite dev (Tauri desktop mode) — mode: ${rawMode}`);

const opts: SpawnSyncOptions = {
  cwd: CLIENT_DIR,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, AIKAMI_DESKTOP_BUILD: 'true' },
};

const result = spawnSync('bunx', ['vite', 'dev', '--mode', rawMode], opts);
if (result.error) {
  logger.error(`❌ Failed to spawn vite dev: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? (result.signal ? 1 : 0));
