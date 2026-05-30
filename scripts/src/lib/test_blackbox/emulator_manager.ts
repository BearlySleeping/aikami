// scripts/src/lib/test_blackbox/emulator_manager.ts
// Spawn and manage Firebase emulators from within the test process.

import { type ChildProcess, execSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dir, '../../..');
const FIREBASE_DIR = resolve(PROJECT_ROOT, 'apps/backend/firebase');

// Standard Firebase emulator ports
const AUTH_PORT = 9099;
const FIRESTORE_PORT = 8080;

let firebaseProcess: ChildProcess | null = null;

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

  firebaseProcess = spawn('bun', ['run', 'emulate'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: FIREBASE_DIR,
  });

  let lastStderr = '';

  firebaseProcess.stdout?.on('data', (data: Buffer) => {
    const text = data.toString();
    if (text.includes('All emulators ready') || text.includes('Emulator')) {
      console.log(`  ${text.trim().slice(0, 120)}`);
    }
  });

  firebaseProcess.stderr?.on('data', (data: Buffer) => {
    lastStderr = data.toString();
  });

  firebaseProcess.on('error', (err) => {
    console.error(`  ✗ Emulator process error: ${err.message}`);
  });

  firebaseProcess.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.log(`  ⚠ Emulator exited with code ${code}`);
    }
  });

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
      execSync(`fuser -k ${port}/tcp 2>/dev/null`, { stdio: 'ignore', timeout: 2000 });
    } catch {
      // No process on this port
    }
  }
}

export async function stopEmulators(): Promise<void> {
  if (firebaseProcess) {
    const pid = firebaseProcess.pid;
    firebaseProcess.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 2000));
    try {
      if (pid) process.kill(pid, 0);
      firebaseProcess.kill('SIGKILL');
    } catch {
      // Already dead
    }
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
    if (open) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timeout (${timeoutMs}ms) waiting for port ${port}`);
}
