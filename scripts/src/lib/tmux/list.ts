#!/usr/bin/env bun
// scripts/src/lib/tmux/list.ts
// List aikami tmux sessions and their services with port status.
//
// Usage:
//   bun tmux:list                 # all sessions
//   bun tmux:list --mode emulator # filter by mode

import { hasTmux, printServiceList } from './session.ts';

const args = process.argv.slice(2);

let mode: 'emulator' | 'staging' | 'production' | undefined;
const modeIndex = args.indexOf('--mode');
if (modeIndex !== -1 && args[modeIndex + 1]) {
  const val = args[modeIndex + 1];
  if (['emulator', 'staging', 'production'].includes(val)) {
    mode = val as 'emulator' | 'staging' | 'production';
  }
}

if (!(await hasTmux())) {
  console.error('❌ tmux is not installed.');
  process.exit(1);
}

await printServiceList(mode);
