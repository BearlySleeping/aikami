#!/usr/bin/env bun
// scripts/src/lib/tmux/stop.ts
// Stop a tmux session.
//
// Usage: bun run tmux:stop <service> [--mode <mode>]

import { parseArgs } from './cli.ts';
import { stopSession, hasTmux } from './session.ts';

const args = process.argv.slice(2);
const config = parseArgs(args);

if (!(await hasTmux())) {
  console.error('❌ tmux is not installed.');
  process.exit(1);
}

try {
  await stopSession({ service: config.service, mode: config.mode });
} catch (e) {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
}
