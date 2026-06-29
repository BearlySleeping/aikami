// apps/e2e/scripts/run_lpc_smoke_full.ts
// C-073: Full pipeline — starts emulator + PWA in tmux, waits for readiness,
// runs the capture+evaluation pipeline, then tears down tmux.
//
// Usage (single command):
//   bun run apps/e2e/scripts/run_lpc_smoke_full.ts
//
// Relies on the existing tmux session infrastructure (scripts/src/lib/tmux/session.ts)
// for reliable direnv-aware service startup, port polling, and session teardown.

import { resolve } from 'node:path';
import { $ } from 'bun';
import {
  buildSessionName,
  type DevService,
  expandServices,
  isPortReady,
  type SessionConfig,
  startServices,
  stopServices,
} from '../../../scripts/src/lib/tmux/session.ts';

// ── Configuration ──────────────────────────────────────────

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const E2E_DIR = resolve(import.meta.dirname, '..');
const MODE = 'emulator' as const;
const SERVICES: DevService[] = expandServices(['emulator', 'client'] as const);
const SMOKE_SCRIPT = resolve(E2E_DIR, 'scripts/lpc_smoke.ts');
const MAX_WAIT_S = 120;
const SESSION_NAME = buildSessionName(MODE);

// ── Helpers ────────────────────────────────────────────────

/**
 * Poll a port until it responds or timeout, returning true if ready.
 */
const pollPort = async (options: {
  port: number;
  label: string;
  timeoutMs: number;
}): Promise<boolean> => {
  const deadline = Date.now() + options.timeoutMs;
  let lastLog = 0;

  while (Date.now() < deadline) {
    if (await isPortReady(options.port)) {
      return true;
    }
    const now = Date.now();
    if (now - lastLog > 5000) {
      const elapsed = Math.round((now - (deadline - options.timeoutMs)) / 1000);
      console.log(`  ⏳ ${options.label} not ready yet (${elapsed}s)`);
      lastLog = now;
    }
    await Bun.sleep(2000);
  }
  return false;
};

// ── Main ───────────────────────────────────────────────────

console.log(`🚀 Starting emulator + PWA in tmux session '${SESSION_NAME}'...\n`);

let emulatorReady = false;
let pwaReady = false;

try {
  // Step 1: Start services via the existing tmux infrastructure
  const config: SessionConfig = {
    mode: MODE,
    services: SERVICES,
    projectRoot: REPO_ROOT,
    join: false,
    force: true,
  };

  await startServices(config);

  // Step 2: Wait for port readiness (poll in parallel)
  console.log('⏳ Waiting for services to be ready...\n');

  const [emulatorResult, pwaResult] = await Promise.all([
    pollPort({
      port: 9098, // EMULATOR_PORTS.auth
      label: 'Emulator (:9098)',
      timeoutMs: MAX_WAIT_S * 1000,
    }),
    pollPort({
      port: 5274, // EMULATOR_PORTS.client
      label: 'PWA (:5274)',
      timeoutMs: MAX_WAIT_S * 1000,
    }),
  ]);

  emulatorReady = emulatorResult;
  pwaReady = pwaResult;

  if (!pwaReady) {
    console.error('❌ PWA dev server failed to start within timeout.');
    console.error('   Check:  tmux attach -t aikami-emulator');
    process.exit(1);
  }

  console.log('✅ PWA ready on :5274');

  if (!emulatorReady) {
    console.warn('⚠️  Firebase emulators not responding — pre-existing env issue (openai dep).');
    console.warn('   Visual tests that need auth will fail. Screenshot capture will still work.\n');
  } else {
    console.log('✅ Emulator ready on :9098');
  }

  console.log();

  // Step 3: Run the smoke pipeline
  console.log('🧪 Running LPC smoke pipeline...\n');

  const smokeResult = await $`bun run ${SMOKE_SCRIPT}`.cwd(REPO_ROOT).nothrow();

  // Step 4: Tear down
  console.log('\n🧹 Tearing down tmux services...\n');
  await stopServices({ mode: MODE, services: SERVICES });

  if (smokeResult.exitCode !== 0) {
    console.error('\n⚠️  Smoke pipeline had failures.');
    process.exit(1);
  }

  console.log('\n✅ LPC smoke pipeline complete.');
  process.exit(0);
} catch (error) {
  console.error('\n❌', error instanceof Error ? error.message : String(error));

  // Best-effort cleanup
  try {
    await stopServices({ mode: MODE, services: SERVICES });
  } catch {
    // ignore
  }

  process.exit(1);
}
