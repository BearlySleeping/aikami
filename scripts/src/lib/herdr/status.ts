#!/usr/bin/env bun
// scripts/src/lib/herdr/status.ts
// List all aikami herdr workspaces (alias for `bun herdr:list`).

import { hasHerdr, printServiceList } from './session.ts';

if (!(await hasHerdr())) {
  console.error('❌ herdr is not installed.');
  process.exit(1);
}

await printServiceList();
