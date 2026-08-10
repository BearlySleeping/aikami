#!/usr/bin/env bun
/**
 * Builds the web bundle for the Tauri desktop app with an explicit Vite mode.
 *
 * tauri.conf.json's `beforeBuildCommand` is executed through the platform
 * shell (sh on unix, cmd.exe on Windows), so `${VAR}` expansion is NOT
 * portable. This wrapper reads `TAURI_BUILD_MODE` (set by the deploy
 * pipeline in scripts/src/lib/deploy/tauri_release.ts) and spawns vite
 * directly — the same behavior on every OS.
 *
 *   TAURI_BUILD_MODE=staging bun run build:tauri   → vite build --mode staging
 *   bun run build:tauri                            → vite build --mode emulator (default)
 *
 * The deploy pipeline always sets TAURI_BUILD_MODE explicitly (staging or
 * production), so this fallback only matters for ad-hoc local builds
 * (`bun tauri build` / `bun moon run client:tauri-build`) — those need
 * neither GCP access nor real secrets, so emulator is the safe default.
 */

import { spawnSync } from 'node:child_process';

const mode = process.env.TAURI_BUILD_MODE || 'emulator';

const result = spawnSync('bunx', ['vite', 'build', '--mode', mode], {
  stdio: 'inherit',
  // Windows needs a shell to resolve bunx.cmd from PATH.
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(`[tauri-build] failed to spawn vite: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
