#!/usr/bin/env bun
// scripts/src/lib/herdr/stop_pi.ts
// Stop the aikami-pi herdr workspace.
//
// Usage:
//   bun herdr:stop-pi

import { ensureServer, findWorkspace, herdr } from './session.ts';

await ensureServer();

const wsId = await findWorkspace('aikami-pi');

if (!wsId) {
  console.log('ℹ aikami-pi is not running');
  process.exit(0);
}

await herdr(['workspace', 'close', wsId]);
console.log('✓ Stopped aikami-pi');
