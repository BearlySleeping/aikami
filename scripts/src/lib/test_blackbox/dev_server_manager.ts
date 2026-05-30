// scripts/src/lib/test_blackbox/dev_server_manager.ts
// Start dev servers for browser-based test suites.

import { type ChildProcess, spawn } from 'node:child_process';
import { resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dir, '../../..');

const PWA_PORT = 5173;

const running = new Map<string, ChildProcess>();

export async function startDevServer(app: 'pwa', timeoutMs = 30_000): Promise<void> {
  if (running.has(app)) {
    const existing = running.get(app);
    if (existing?.exitCode === null) {
      console.log(`  ✓ ${app} dev server already running`);
      return;
    }
    running.delete(app);
  }

  const cwd = resolve(PROJECT_ROOT, 'apps/frontend/pwa');

  console.log(`  Starting ${app} dev server...`);

  const proc = spawn('bun', ['run', 'dev'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd,
  });

  proc.stdout?.on('data', () => {});
  proc.stderr?.on('data', () => {});

  proc.on('error', (err) => {
    console.error(`  ✗ ${app} dev server error: ${err.message}`);
  });

  running.set(app, proc);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${PWA_PORT}/`, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status < 500) {
        console.log(`  ✓ ${app} dev server ready on :${PWA_PORT}`);
        return;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error(`Timeout starting ${app} dev server on :${PWA_PORT}`);
}

export async function stopAllDevServers(): Promise<void> {
  for (const [app, proc] of running) {
    proc.kill('SIGTERM');
    running.delete(app);
  }
  console.log('✓ Dev servers stopped');
}
