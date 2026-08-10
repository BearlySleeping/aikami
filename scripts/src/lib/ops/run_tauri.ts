#!/usr/bin/env bun
// scripts/src/lib/ops/run_tauri.ts
//
// Launches the already-built Tauri desktop binary for the current OS.
// Does NOT build — this just finds and runs what's already on disk.
//
// Usage:
//   bun run scripts/src/lib/ops/run_tauri.ts
//   bun moon run client:tauri-run

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { c, error, info, ok } from '../cli_utils.ts';

const ROOT = resolve(import.meta.dirname, '../../../..');
const TARGET_DIR = resolve(ROOT, 'apps/frontend/client/src-tauri/target');
const BIN_NAME = process.platform === 'win32' ? 'aikami.exe' : 'aikami';

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
});

const code = await proc.exited;
process.exit(code);
