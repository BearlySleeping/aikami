#!/usr/bin/env bun
// scripts/src/lib/herdr/list.ts
// List aikami herdr workspaces and their services with port status.
//
// Usage:
//   bun herdr:list                 # all workspaces
//   bun herdr:list --mode emulator # filter by mode

import { hasHerdr, printServiceList } from './session.ts';

const args = process.argv.slice(2);

let mode: 'emulator' | 'staging' | 'production' | undefined;
const modeIndex = args.indexOf('--mode');
if (modeIndex !== -1 && args[modeIndex + 1]) {
  const val = args[modeIndex + 1];
  if (['emulator', 'staging', 'production'].includes(val)) {
    mode = val as 'emulator' | 'staging' | 'production';
  }
}

if (!(await hasHerdr())) {
  console.error('❌ herdr is not installed.');
  process.exit(1);
}

await printServiceList(mode);
