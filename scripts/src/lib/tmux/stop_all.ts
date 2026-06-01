#!/usr/bin/env bun
// scripts/src/lib/tmux/stop_all.ts
// Stop all aikami tmux sessions regardless of mode/service.

import { stopAllSessions, hasTmux } from './session.ts';

if (!(await hasTmux())) {
  console.error('❌ tmux is not installed.');
  process.exit(1);
}

await stopAllSessions();
