// scripts/src/lib/test_blackbox/emulator_manager.ts
// Spawn and manage Firebase emulators from within the test process.

import { execSync as nodeExecSync } from 'node:child_process';
import { resolve } from 'node:path';
import { EMULATOR_PORTS } from '@aikami/constants';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../..');
const FIREBASE_DIR = resolve(PROJECT_ROOT, 'apps/backend/firebase');

// Standard Firebase emulator ports
const AUTH_PORT = EMULATOR_PORTS.auth;
const FIRESTORE_PORT = EMULATOR_PORTS.firestore;

let firebaseProcess: ReturnType<typeof Bun.spawn> | null = null;

export async function startEmulators(timeoutMs = 90_000): Promise<void> {
  const skip = process.argv.includes('--no-emulator');
  if (skip) {
    console.log('⏭  Skipping emulator startup (--no-emulator)');
    return;
  }

  // Kill stale emulator processes
  killStaleEmulators();

  // Check if emulator is already running
  const alreadyRunning = await probePort(AUTH_PORT, 2000);
  if (alreadyRunning) {
    console.log(`✓ Emulator already running on :${AUTH_PORT}, reusing`);
    return;
  }

  console.log('🚀 Starting Firebase emulators...');

  firebaseProcess = Bun.spawn({
    cmd: ['bun', 'run', 'emulate'],
    cwd: FIREBASE_DIR,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  let lastStderr = '';

  // Read stdout/stderr from Bun.spawn
  (async () => {
    const stdout = firebaseProcess?.stdout;
    if (!stdout || typeof stdout === 'number') {
      return;
    }
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const text = decoder.decode(value);
      if (text.includes('All emulators ready') || text.includes('Emulator')) {
        console.log(`  ${text.trim().slice(0, 120)}`);
      }
    }
  })().catch(() => {});

  (async () => {
    const stderr = firebaseProcess?.stderr;
    if (!stderr || typeof stderr === 'number') {
      return;
    }
    const reader = stderr.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      lastStderr = decoder.decode(value);
    }
  })().catch(() => {});

  try {
    await waitForPort(AUTH_PORT, timeoutMs);
  } catch (e) {
    if (lastStderr) {
      console.error(`  Last stderr: ${lastStderr.slice(-500)}`);
    }
    throw e;
  }

  console.log('✓ Emulators ready');
}

function killStaleEmulators(): void {
  const ports = [AUTH_PORT, FIRESTORE_PORT, 5001, 9199, 4400];
  for (const port of ports) {
    try {
      nodeExecSync(`fuser -k ${port}/tcp 2>/dev/null`, { stdio: 'ignore', timeout: 2000 });
    } catch {
      // No process on this port
    }
  }
}

export async function stopEmulators(): Promise<void> {
  if (firebaseProcess) {
    firebaseProcess.kill();
    await new Promise((r) => setTimeout(r, 2000));
    firebaseProcess = null;
  }
  killStaleEmulators();
  console.log('✓ Emulators stopped');
}

async function probePort(port: number, timeoutMs = 2000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    await fetch(`http://localhost:${port}/`, { signal: controller.signal }).finally(() =>
      clearTimeout(timer),
    );
    return true;
  } catch {
    return false;
  }
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await probePort(port, 2000);
    if (open) {
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timeout (${timeoutMs}ms) waiting for port ${port}`);
}
