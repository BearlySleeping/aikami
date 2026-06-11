#!/usr/bin/env bun
// scripts/src/lib/tmux/stop.ts
// Stop aikami services by killing their tmux windows or the whole session.
//
// Usage:
//   bun tmux:stop client              # kill client tab only
//   bun tmux:stop emulator,voice   # kill two tabs
//   bun tmux:stop all              # kill entire session

import { parseServiceArgs } from './cli.ts';
import { hasTmux, stopServices } from './session.ts';

const args = process.argv.slice(2);
const config = parseServiceArgs(args);

if (!(await hasTmux())) {
  console.error('❌ tmux is not installed.');
  process.exit(1);
}

try {
  await stopServices({ mode: config.mode, services: config.services });
} catch (e) {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
}
