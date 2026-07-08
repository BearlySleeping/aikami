#!/usr/bin/env bun
// scripts/src/lib/herdr/restart.ts
// Restart aikami services: stop (if running) → 1s cooldown → start fresh.
//
// Usage:
//   bun herdr:restart client              # restart client tab only
//   bun herdr:restart firebase,client     # restart two tabs
//   bun herdr:restart all --join          # restart all + attach

import { parseServiceArgs } from './cli.ts';
import { hasHerdr, restartServices } from './session.ts';

const args = process.argv.slice(2);
const config = parseServiceArgs(args);

if (!(await hasHerdr())) {
  console.error('❌ herdr is not installed. Install it with your package manager.');
  process.exit(1);
}

try {
  const workspaceId = await restartServices({
    mode: config.mode,
    services: config.services,
    projectRoot: process.cwd(),
  });
  console.log(`✅ Restarted: ${config.services.join(', ')} (${workspaceId})`);
} catch (e) {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
}
