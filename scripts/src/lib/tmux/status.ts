#!/usr/bin/env bun
// scripts/src/lib/tmux/status.ts
// List all aikami tmux sessions.

import { hasTmux, printSessionStatus } from './session.ts';

if (!(await hasTmux())) {
  console.error('❌ tmux is not installed.');
  process.exit(1);
}

await printSessionStatus();
