#!/usr/bin/env bun
// scripts/src/lib/tmux/start.ts
// Start a tmux session for Aikami services.
//
// Usage: bun run tmux:start <service> [--mode <mode>] [--force]
//   service: emulators | pwa | game | all
//   --force:  kill and recreate even if already running

import { parseArgs } from './cli.ts';
import { startSession, hasTmux } from './session.ts';

const args = process.argv.slice(2);
const config = parseArgs(args);

if (!(await hasTmux())) {
  console.error('❌ tmux is not installed. Install it with your package manager.');
  process.exit(1);
}

try {
  const sessionName = await startSession({
    service: config.service,
    mode: config.mode,
    force: config.force,
  });
  console.log(`\nTo attach:  tmux attach -t ${sessionName}`);
  console.log(`To stop:    bun run tmux:stop ${config.service}`);
} catch (e) {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
}
