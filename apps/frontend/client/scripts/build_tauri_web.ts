#!/usr/bin/env bun

/**
 * Builds the Vite web bundle for the Tauri desktop app for a specific mode.
 *
 * This is the tauri.conf.json `beforeBuildCommand` target (invoked via
 * `bun run build:tauri-web`). It ONLY builds the web bundle — the cargo
 * binary and installers are produced by the tauri CLI itself.
 *
 *   bun run build:tauri-web                     → vite build --mode emulator (default)
 *   bun run build:tauri-web --mode production   → vite build --mode production
 *
 * Mode resolution: --mode flag > TAURI_BUILD_MODE env > emulator.
 * The deploy pipeline (scripts/src/lib/deploy/tauri_release.ts) and the
 * build_tauri.ts wrapper set TAURI_BUILD_MODE before invoking `tauri build`;
 * the env var is the portable channel because the tauri CLI runs
 * beforeBuildCommand through the platform shell (sh/cmd.exe), where `${VAR}`
 * expansion is not portable — bun is always the runner, so reading the env
 * var here is safe on every OS.
 *
 * Env comes from .env.{mode} — generate first with download-secrets
 * (bun run scripts/src/lib/ops/download_secrets.ts --mode <mode>).
 */

import { type SpawnSyncOptions, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const VALID_MODES = ['emulator', 'staging', 'production'] as const;
type BuildMode = (typeof VALID_MODES)[number];

// ── parse args: --mode <m> | --mode=<m> | --dry-run ──────────────────────

const args = process.argv.slice(2);
let dryRun = false;
let modeFlag: string | undefined;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--') {
    continue; // bun passes a bare `--` through; it carries no meaning here
  }
  if (arg === '--mode') {
    modeFlag = args[++i];
  } else if (arg.startsWith('--mode=')) {
    modeFlag = arg.slice('--mode='.length);
  } else if (arg === '--dry-run') {
    dryRun = true;
  }
}

const rawMode = modeFlag ?? process.env.TAURI_BUILD_MODE ?? 'emulator';
if (!VALID_MODES.includes(rawMode as BuildMode)) {
  console.error(`❌ Invalid mode "${rawMode}". Valid: ${VALID_MODES.join(', ')}`);
  console.error(
    `   Usage: bun run build:tauri-web [--mode emulator|staging|production] [--dry-run]`,
  );
  process.exit(1);
}
const mode = rawMode as BuildMode;

console.log(`\n🎯 Building Tauri web bundle — mode: ${mode}`);

if (dryRun) {
  console.log(`  (dry-run) bunx vite build --mode ${mode}`);
  process.exit(0);
}

// vite loads .env.{mode} for the selected mode.
const result = spawnSync('bunx', ['vite', 'build', '--mode', mode], {
  stdio: 'inherit',
  // Windows needs a shell to resolve .cmd shims (bunx).
  shell: process.platform === 'win32',
  cwd: CLIENT_DIR,
});

if (result.error) {
  console.error(`❌ Failed to spawn vite: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`❌ vite build failed (exit ${result.status})`);
  process.exit(result.status ?? 1);
}

console.log('\n✅ Done — web bundle ready (cargo build + bundling handled by the tauri CLI).');
