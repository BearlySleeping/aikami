#!/usr/bin/env bun
// scripts/src/lib/herdr/stop.ts
// Stop aikami services by closing their herdr tabs or the whole workspace.
//
// Usage:
//   bun herdr:stop client              # kill client tab only
//   bun herdr:stop firebase,voice   # kill two tabs
//   bun herdr:stop all              # kill entire workspace

import { parseServiceArgs } from './cli.ts';
import { hasHerdr, stopServices } from './session.ts';

const args = process.argv.slice(2);
const config = parseServiceArgs(args);

if (!(await hasHerdr())) {
  console.error('❌ herdr is not installed.');
  process.exit(1);
}

try {
  await stopServices({ mode: config.mode, services: config.services });
} catch (e) {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
}
