#!/usr/bin/env bun
// scripts/src/lib/ops/run_tauri.ts
//
// Launches the already-built Tauri desktop binary for the current OS.
// Does NOT build — this just finds and runs what's already on disk.
//
// Usage:
//   bun run scripts/src/lib/ops/run_tauri.ts
//   bun moon run client:tauri-run
//   bun run scripts/src/lib/ops/run_tauri.ts --software-gl

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { c, error, info, ok } from '../cli_utils.ts';

const ROOT = resolve(import.meta.dirname, '../../../..');
const TARGET_DIR = resolve(ROOT, 'apps/frontend/client/src-tauri/target');
const BIN_NAME = process.platform === 'win32' ? 'aikami.exe' : 'aikami';

/**
 * WebKitGTK environment overrides that avoid wedging the Intel i915 GPU on
 * hybrid-graphics laptops (screen freeze + audio-alive hang) and the silent
 * WebGL init stalls that leave the map/sprite canvas blank while the DOM
 * (HUD, pause, inventory) still renders fine. Mirrors preview_client.ts's
 * getWebkitGtkSafeEnv — this launcher runs the packaged binary directly, so
 * it needs the same mitigations preview_client.ts bakes into its own spawn.
 *
 * `WEBKIT_DISABLE_DMABUF_RENDERER` is a dead end on WebKitGTK >= 2.44 (X11/WPE
 * renderers were removed); `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` is the
 * supported workaround that keeps compositing while avoiding the DMA-BUF
 * import path. `--software-gl` forces the whole webview onto llvmpipe.
 */
const softwareGl = process.argv.includes('--software-gl') || process.argv.includes('--sw-gl');
const webkitGtkSafeEnv: Record<string, string> = {
  WEBKIT_DMABUF_RENDERER_FORCE_SHM: '1',
  ...(softwareGl ? { LIBGL_ALWAYS_SOFTWARE: '1', GALLIUM_DRIVER: 'llvmpipe' } : {}),
};

// release (`bun moon run client:tauri-build`) wins over debug
// (`bun run preview --tauri` / `--tauri-dev`) when both exist.
const candidates = [
  { profile: 'release', path: resolve(TARGET_DIR, 'release', BIN_NAME) },
  { profile: 'debug', path: resolve(TARGET_DIR, 'debug', BIN_NAME) },
];

const found = candidates.find((candidate) => existsSync(candidate.path));

if (!found) {
  error('No built Tauri binary found.');
  info('Build one first:');
  info(
    `  ${c.cyan}bun moon run client:tauri-build${c.reset}   # release bundle (installers + binary)`,
  );
  info(`  ${c.cyan}bun run preview --tauri${c.reset}            # debug build, faster iterate`);
  process.exit(1);
}

ok(`Launching ${found.profile} build -> ${found.path}`);

const proc = Bun.spawn([found.path], {
  stdout: 'inherit',
  stderr: 'inherit',
  env: { ...process.env, ...webkitGtkSafeEnv },
});

const code = await proc.exited;
process.exit(code);
