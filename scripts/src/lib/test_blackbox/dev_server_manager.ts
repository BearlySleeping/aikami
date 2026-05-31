// scripts/src/lib/test_blackbox/dev_server_manager.ts
// Start dev servers for browser-based test suites.

import { resolve } from 'node:path';
import { PWA_EMULATOR_PORT } from '@aikami/constants';

const GAME_PORT = 5174;

const PROJECT_ROOT = resolve(import.meta.dir, '../../../..');

const DEV_SERVER_CONFIG = {
  pwa: { cwd: 'apps/frontend/pwa', port: PWA_EMULATOR_PORT },
  game: { cwd: 'apps/frontend/game', port: GAME_PORT },
} as const;

type AppName = keyof typeof DEV_SERVER_CONFIG;

const running = new Map<string, ReturnType<typeof Bun.spawn>>();

export async function startDevServer(app: AppName, timeoutMs = 30_000): Promise<void> {
  if (running.has(app)) {
    const existing = running.get(app);
    if (existing?.exitCode === null) {
      console.log(`  ✓ ${app} dev server already running`);
      return;
    }
    running.delete(app);
  }

  const config = DEV_SERVER_CONFIG[app];
  const cwd = resolve(PROJECT_ROOT, config.cwd);
  const port = config.port;

  console.log(`  Starting ${app} dev server...`);

  const proc = Bun.spawn({
    cmd: ['bun', 'run', 'dev'],
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Drain stdout/stderr to prevent backpressure
  (async () => { for await (const _chunk of proc.stdout) {} })().catch(() => {});
  (async () => { for await (const _chunk of proc.stderr) {} })().catch(() => {});

  running.set(app, proc);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok || res.status < 500) {
        console.log(`  ✓ ${app} dev server ready on :${port}`);
        return;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error(`Timeout starting ${app} dev server on :${port}`);
}

export async function stopAllDevServers(): Promise<void> {
  for (const [app, proc] of running) {
    proc.kill();
    running.delete(app);
  }
  console.log('✓ Dev servers stopped');
}
