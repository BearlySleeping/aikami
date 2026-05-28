// scripts/src/lib/dev_all.ts
/**
 * Start all development services using tmux for parallel execution.
 *
 * Creates a tmux session "aikami-dev" with:
 *   - Left pane:  Firebase emulators (firestack emulate)
 *   - Right pane: PWA dev server (bun run dev)
 *
 * Usage:
 *   bun run dev:all              # Start session (attached)
 *   bun run dev:all --detach     # Start in background
 *   tmux attach -t aikami-dev    # Reattach later
 *   tmux kill-session -t aikami-dev  # Stop everything
 */

import { execSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dir, '../../..');
const FUNCTIONS_DIR = resolve(PROJECT_ROOT, 'apps/backend/functions');
const PWA_DIR = resolve(PROJECT_ROOT, 'apps/frontend/pwa');
const SESSION = 'aikami-dev';

const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const args = process.argv.slice(2);
const detach = args.includes('--detach') || args.includes('-d');

function hasTmux(): boolean {
  try {
    execSync('tmux -V', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function killExistingSession() {
  try {
    execSync(`tmux kill-session -t ${SESSION} 2>/dev/null`, { stdio: 'ignore' });
  } catch {
    // Session doesn't exist
  }
}

async function startInBackground(name: string, dir: string, cmd: string[]): Promise<void> {
  const proc = spawn(cmd[0], cmd.slice(1), {
    cwd: dir,
    stdio: 'ignore',
    detached: true,
  });
  proc.unref();
  console.log(`  ${GREEN}✓${RESET} ${name} started (PID ${proc.pid})`);
}

async function startForeground(cmd: string, dir: string): Promise<void> {
  const proc = spawn('bash', ['-c', cmd], {
    cwd: dir,
    stdio: 'inherit',
  });
  await new Promise<void>((resolve) => proc.on('exit', () => resolve()));
}

async function main() {
  console.log(`\n${BOLD}╔══════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}║     Aikami Development Services           ║${RESET}`);
  console.log(`${BOLD}╚══════════════════════════════════════════╝${RESET}\n`);

  if (!hasTmux()) {
    console.log(`${DIM}tmux not found — falling back to background mode${RESET}\n`);
    console.log('Starting services in background...');
    await startInBackground('Firebase Emulators', FUNCTIONS_DIR, ['bun', 'run', 'emulate']);
    await Bun.sleep(2000);
    await startInBackground('PWA Dev Server', PWA_DIR, ['bun', 'run', 'dev']);
    console.log(`\n  ${CYAN}Firebase emulators${RESET} → http://localhost:4000`);
    console.log(`  ${CYAN}PWA dev server${RESET}     → http://localhost:5173`);
    console.log(`\n${DIM}Use 'lsof -ti:4000,5173 | xargs kill' to stop${RESET}\n`);
    return;
  }

  // ── Tmux mode ──────────────────────────────────────────────
  killExistingSession();

  const flags = detach ? '-d' : '';
  console.log(`Creating tmux session: ${CYAN}${SESSION}${RESET}`);

  // Create session with first pane (emulators)
  execSync(
    `tmux new-session ${flags} -s ${SESSION} -n emulators -c '${FUNCTIONS_DIR}' "echo '🚀 Firebase Emulators'; echo ''; bun run emulate; read"`,
    { stdio: 'ignore' },
  );

  // Wait for session to exist
  await Bun.sleep(500);

  // Split vertically for PWA
  execSync(
    `tmux split-window -h -t ${SESSION} -c '${PWA_DIR}' "echo '📱 PWA Dev Server'; echo ''; bun run dev; read"`,
    { stdio: 'ignore' },
  );

  // Set layout
  execSync(`tmux select-layout -t ${SESSION} even-horizontal`, { stdio: 'ignore' });

  if (detach) {
    console.log(`\n  ${GREEN}✓${RESET} Session started detached`);
    console.log(`  Attach: ${CYAN}tmux attach -t ${SESSION}${RESET}`);
    console.log(`  Stop:   ${CYAN}tmux kill-session -t ${SESSION}${RESET}\n`);
  } else {
    // Attach to session
    console.log(`\n${DIM}Attaching to session (Ctrl+B D to detach)...${RESET}\n`);
    execSync(`tmux attach -t ${SESSION}`, { stdio: 'inherit' });
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
