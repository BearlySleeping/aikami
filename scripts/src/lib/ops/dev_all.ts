#!/usr/bin/env bun
// scripts/src/lib/ops/dev_all.ts
/**
 * Start all development services using the unified herdr workspace library.
 *
 * Creates a herdr workspace "aikami-{mode}" with tabs for:
 *   - Firebase emulators (bun run emulate)
 *   - Client dev server
 *   - Game dev server
 *
 * Usage:
 *   bun run dev:all                  # Start all + attach
 *   bun run dev:all --detach         # Start in background
 *   bun run herdr:join                # Reattach later
 *   bun run herdr:stop all            # Stop everything
 */

import { type AikamiMode, hasHerdr, startServices } from '../herdr/session.ts';

const VALID_MODES: AikamiMode[] = ['emulator', 'staging', 'production'];
const args = process.argv.slice(2);
const detach = args.includes('--detach') || args.includes('-d');

// Read mode from env or default to emulator
const mode: AikamiMode = (() => {
  const envMode = process.env.AIKAMI_MODE;
  if (envMode && VALID_MODES.includes(envMode as AikamiMode)) {
    return envMode as AikamiMode;
  }
  return 'emulator';
})();

async function main() {
  console.log(`
╔══════════════════════════════════════════╗
║     Aikami Development Services           ║
║     Mode: ${mode.padEnd(32)}║
╚══════════════════════════════════════════╝
`);

  if (!(await hasHerdr())) {
    console.error('❌ herdr is not installed. Install it with your package manager.');
    console.error('   Fallback: start services manually with bun run dev in each project.');
    process.exit(1);
  }

  // Start all three services in the mode session
  await startServices({
    services: ['firebase', 'client'],
    mode,
    force: false,
    join: !detach,
  });

  if (detach) {
    console.log(`\n  Attach:  bun run herdr:join`);
    console.log(`  Stop:    bun run herdr:stop all\n`);
  }
}

main().catch((err) => {
  console.error('Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
