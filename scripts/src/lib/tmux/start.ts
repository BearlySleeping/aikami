#!/usr/bin/env bun
// scripts/src/lib/tmux/start.ts
// Start aikami services as tmux windows.
//
// Usage:
//   bun tmux:start emulator           # emulators tab
//   bun tmux:start pwa,voice          # two tabs
//   bun tmux:start all --join         # all three + attach

import { parseServiceArgs } from './cli.ts';
import { hasTmux, startServices } from './session.ts';

const args = process.argv.slice(2);
const config = parseServiceArgs(args);

if (!(await hasTmux())) {
  console.error('❌ tmux is not installed. Install it with your package manager.');
  process.exit(1);
}

try {
  await startServices(config);
} catch (e) {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
}
