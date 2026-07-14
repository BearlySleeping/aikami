#!/usr/bin/env bun
// scripts/src/lib/herdr/stop_all.ts
// Stop all aikami herdr workspaces regardless of mode.

import { hasHerdr, stopAllSessions } from './session.ts';

if (!(await hasHerdr())) {
  console.error('❌ herdr is not installed.');
  process.exit(1);
}

await stopAllSessions();
