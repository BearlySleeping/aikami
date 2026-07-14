#!/usr/bin/env bun
// scripts/src/lib/herdr/join.ts
// Join (attach to) the herdr session displaying aikami workspaces.
//
// Usage:
//   bun herdr:join                 # uses $AIKAMI_MODE to verify workspace exists
//   bun herdr:join --mode emulator

import { resolveMode } from './cli.ts';
import { hasHerdr, joinSession } from './session.ts';

const args = process.argv.slice(2);
const mode = resolveMode(args);

if (!(await hasHerdr())) {
  console.error('❌ herdr is not installed. Install it with your package manager.');
  process.exit(1);
}

try {
  await joinSession(mode);
} catch (e) {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
}
