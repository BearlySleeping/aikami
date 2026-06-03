#!/usr/bin/env bun
// scripts/src/lib/tmux/status.ts
// List all aikami tmux sessions (alias for `bun tmux:list`).

import { hasTmux, printServiceList } from './session.ts';

if (!(await hasTmux())) {
  console.error('❌ tmux is not installed.');
  process.exit(1);
}

await printServiceList();
