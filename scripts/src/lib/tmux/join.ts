#!/usr/bin/env bun
// scripts/src/lib/tmux/join.ts
// Join (attach to) an existing tmux session.
//
// Usage: bun run tmux:join <service> [--mode <mode>]
//   service: emulators | pwa | game | all

import { parseArgs } from './cli.ts';
import { hasTmux, joinSession } from './session.ts';

const args = process.argv.slice(2);
const config = parseArgs(args);

if (!(await hasTmux())) {
  console.error('❌ tmux is not installed. Install it with your package manager.');
  process.exit(1);
}

try {
  await joinSession({ service: config.service, mode: config.mode });
} catch (e) {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
}
