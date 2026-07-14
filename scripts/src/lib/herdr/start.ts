#!/usr/bin/env bun
// scripts/src/lib/herdr/start.ts
// Start aikami services as herdr tabs.
//
// Usage:
//   bun herdr:start firebase           # firebase tab
//   bun herdr:start client,voice          # two tabs
//   bun herdr:start all --join         # all + attach

import { parseServiceArgs } from './cli.ts';
import { hasHerdr, startServices } from './session.ts';

const args = process.argv.slice(2);
const config = parseServiceArgs(args);

if (!(await hasHerdr())) {
  console.error('❌ herdr is not installed. Install it with your package manager.');
  process.exit(1);
}

try {
  await startServices(config);
} catch (e) {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
}
