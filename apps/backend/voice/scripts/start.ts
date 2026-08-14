// apps/backend/voice/scripts/start.ts
// Dev engine launcher for the voice modality (C-392).
//
// Delegates to the C-390 local-stack compose topology instead of owning a
// container definition: `docker compose --profile <profile> up` against
// apps/backend/local-stack/compose.yaml — the same file the published stack
// ships, so the dev engine cannot drift from the user engine.
//
//   default profile  → "voice" → sherpa-onnx (Kokoro TTS) on :8089
//
// Runs in the foreground so the herdr pane stays alive streaming logs. On
// teardown (SIGINT/SIGTERM, or compose exiting on its own) it runs
// `docker compose down` so containers never leak between herdr sessions.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const COMPOSE_DIR = resolve(import.meta.dir, '../../local-stack');
const PROFILE = Bun.argv[2] ?? 'voice';
const COMPOSE_ARGS = ['compose', '--profile', PROFILE, 'up'];

const log = (message: string): void => console.log(`[voice] ${message}`);

let tearingDown = false;

/**
 * Tear down the compose topology. Idempotent — `docker compose down` is a
 * no-op when nothing is up. Runs on SIGINT/SIGTERM (herdr closes the pane)
 * and when `up` exits on its own.
 */
const teardown = (): void => {
  if (tearingDown) {
    return;
  }
  tearingDown = true;
  log(`stopping compose profile "${PROFILE}" (docker compose down)`);
  const down = spawn('docker', ['compose', '--profile', PROFILE, 'down'], {
    cwd: COMPOSE_DIR,
    stdio: 'inherit',
    env: process.env,
  });
  down.on('close', (code) => process.exit(code ?? 0));
  down.on('error', (error) => {
    console.error(`[voice] docker compose down failed: ${error.message}`);
    process.exit(1);
  });
};

process.on('SIGINT', teardown);
process.on('SIGTERM', teardown);

const child = spawn('docker', COMPOSE_ARGS, {
  cwd: COMPOSE_DIR,
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (error) => {
  console.error(`[voice] failed to run docker compose: ${error.message}`);
  console.error('  Is Docker (or a docker-compatible runtime) installed and running?');
  process.exit(1);
});

child.on('close', (code) => {
  if (!tearingDown) {
    log(`docker compose exited with code ${code ?? 'unknown'} — tearing down`);
    teardown();
  }
});
