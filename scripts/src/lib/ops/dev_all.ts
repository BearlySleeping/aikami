#!/usr/bin/env bun
// scripts/src/lib/ops/dev_all.ts
/**
 * Start all development services using the unified tmux session library.
 *
 * Creates a tmux session "aikami-{mode}-all" with windows for:
 *   - Firebase emulators (firestack emulate)
 *   - PWA dev server
 *   - Game dev server
 *
 * Usage:
 *   bun run dev:all                  # Start session (attached)
 *   bun run dev:all --detach         # Start in background
 *   bun run tmux:join all            # Reattach later
 *   bun run tmux:stop all            # Stop everything
 */

import { startSession, joinSession, hasTmux, type AikamiMode } from '../tmux/session.ts';

const VALID_MODES: AikamiMode[] = ['emulator', 'development', 'production'];
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

  if (!(await hasTmux())) {
    console.error('❌ tmux is not installed. Install it with your package manager.');
    console.error('   Fallback: start services manually with bun run dev in each project.');
    process.exit(1);
  }

  // Start (or reuse) the session
  const sessionName = await startSession({
    service: 'all',
    mode,
    force: false, // Don't force kill — let startSession handle mode mismatch
  });

  if (detach) {
    console.log(`\n✓ Session started detached: ${sessionName}`);
    console.log(`  Attach:  bun run tmux:join all`);
    console.log(`  Stop:    bun run tmux:stop all\n`);
  } else {
    console.log(`\nAttaching to session (Ctrl+B D to detach)...\n`);
    await joinSession({ service: 'all', mode });
  }
}

main().catch((err) => {
  console.error('Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
