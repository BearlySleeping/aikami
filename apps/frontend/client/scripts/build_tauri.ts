#!/usr/bin/env bun

/**
 * Builds the Tauri desktop app for a specific Vite mode.
 *
 * Two entry points, one file:
 *
 *   bun run build:tauri                     → vite build --mode <m> + cargo build
 *   bun run build:tauri --mode production   → vite build --mode production + cargo build --release
 *   bun run build:tauri --web-only          → vite build only (tauri.conf.json beforeBuildCommand)
 *
 * Mode resolution: --mode flag > TAURI_BUILD_MODE env > emulator.
 * The deploy pipeline (tauri_release.ts) sets TAURI_BUILD_MODE before it runs
 * `tauri build`, whose beforeBuildCommand (`bun run build:tauri-web`) is this
 * script in --web-only mode. A wrapper file is required there because
 * beforeBuildCommand runs through the platform shell (sh/cmd.exe), where
 * `${VAR}` expansion is not portable — bun is always the runner (local dev,
 * `bun run deploy`, and CI all invoke via bun), so TypeScript is fine.
 *
 * Mode → cargo profile:
 *   - production / staging  → release  (optimized binary, [profile.release] in Cargo.toml)
 *   - emulator (default)    → debug    (fast local iteration)
 *
 * Env comes from .env.{mode} — generate first with download-secrets
 * (bun run scripts/src/lib/ops/download_secrets.ts --mode <mode>).
 * --dry-run prints the commands without running them.
 */

import { type SpawnSyncOptions, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_TAURI_DIR = join(CLIENT_DIR, 'src-tauri');

const VALID_MODES = ['emulator', 'staging', 'production'] as const;
type BuildMode = (typeof VALID_MODES)[number];

// ── parse args: --mode <m> | --mode=<m> | --web-only | --dry-run ──────────

const args = process.argv.slice(2);
let webOnly = false;
let dryRun = false;
let modeFlag: string | undefined;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--mode') {
    modeFlag = args[++i];
  } else if (arg.startsWith('--mode=')) {
    modeFlag = arg.slice('--mode='.length);
  } else if (arg === '--web-only') {
    webOnly = true;
  } else if (arg === '--dry-run') {
    dryRun = true;
  }
}

const rawMode = modeFlag ?? process.env.TAURI_BUILD_MODE ?? 'emulator';
if (!VALID_MODES.includes(rawMode as BuildMode)) {
  console.error(`❌ Invalid mode "${rawMode}". Valid: ${VALID_MODES.join(', ')}`);
  console.error(
    `   Usage: bun run build:tauri [--mode emulator|staging|production] [--web-only] [--dry-run]`,
  );
  process.exit(1);
}
const mode = rawMode as BuildMode;

const isRelease = mode !== 'emulator';
const binName = process.platform === 'win32' ? 'aikami.exe' : 'aikami';
const binDir = isRelease ? 'release' : 'debug';

/** Runs a command, inheriting stdio; exits with its code on failure. */
function run(label: string, cmd: string, argsList: string[], opts: SpawnSyncOptions = {}): void {
  console.log(`\n▶ ${label}`);
  if (dryRun) {
    console.log(`  (dry-run) ${cmd} ${argsList.join(' ')}`);
    return;
  }
  const result = spawnSync(cmd, argsList, {
    stdio: 'inherit',
    // Windows needs a shell to resolve .cmd shims (bunx).
    shell: process.platform === 'win32',
    ...opts,
  });
  if (result.error) {
    console.error(`❌ Failed to spawn ${cmd}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`❌ ${label} failed (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

console.log(
  `\n🎯 Building Tauri ${webOnly ? 'web bundle' : 'app'} — mode: ${mode}` +
    (webOnly ? '' : ` (${isRelease ? 'release profile' : 'debug profile'})`),
);

// 1. Web bundle — vite loads .env.{mode} for the selected mode.
run('vite build', 'bunx', ['vite', 'build', '--mode', mode], { cwd: CLIENT_DIR });

// 2. Rust binary — skipped in --web-only mode (the tauri CLI runs cargo itself).
if (!webOnly) {
  const cargoArgs = ['build'];
  if (isRelease) {
    cargoArgs.push('--release');
  }
  cargoArgs.push('--features', 'tauri/custom-protocol');
  run('cargo build', 'cargo', cargoArgs, { cwd: SRC_TAURI_DIR });

  const binPath = join(SRC_TAURI_DIR, 'target', binDir, binName);
  if (!dryRun && existsSync(binPath)) {
    console.log(`\n✅ Done — optimized ${isRelease ? 'release' : 'debug'} binary: ${binPath}`);
    console.log(`   Run it with: bun run tauri:run (picks release over debug when both exist)`);
  } else {
    console.log(`\n✅ Done — ${isRelease ? 'release' : 'debug'} build complete.`);
  }
} else {
  console.log('\n✅ Done — web bundle ready (cargo build is handled by the tauri CLI).');
}
