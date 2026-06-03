#!/usr/bin/env bun
// scripts/src/lib/tmux/join.ts
// Join (attach to) an existing aikami tmux session by mode.
//
// Usage:
//   bun tmux:join                 # uses $AIKAMI_MODE
//   bun tmux:join --mode emulator

import { resolveMode } from './cli.ts';
import { hasTmux, joinSession } from './session.ts';

const args = process.argv.slice(2);
const mode = resolveMode(args);

if (!(await hasTmux())) {
  console.error('❌ tmux is not installed. Install it with your package manager.');
  process.exit(1);
}

try {
  await joinSession(mode);
} catch (e) {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
}
