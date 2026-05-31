// scripts/src/lib/test_blackbox/tmux_manager.ts
// Start/stop Firebase emulators + dev servers via tmux.
// Uses tmux send-keys to bypass Nix posix_spawn PATH issues.
// Pattern ported from nordclaw's blackbox test infrastructure.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { EMULATOR_PORTS, PWA_EMULATOR_PORT } from '@aikami/constants';

const SESSION = 'aikami-blackbox';
const GAME_PORT = 5174;

type TmuxService = {
  window: number;
  name: string;
  command: string;
  cwd: string;
  readyPort: number;
  readyPath?: string;
};

const buildServices = (projectRoot: string): TmuxService[] => [
  {
    window: 1,
    name: 'emulators',
    command: 'bun run emulate',
    cwd: resolve(projectRoot, 'apps/backend/firebase'),
    readyPort: EMULATOR_PORTS.auth,
  },
  {
    window: 2,
    name: 'game',
    command: 'bun run dev',
    cwd: resolve(projectRoot, 'apps/frontend/game'),
    readyPort: GAME_PORT,
  },
  {
    window: 3,
    name: 'pwa',
    command: 'bun run dev',
    cwd: resolve(projectRoot, 'apps/frontend/pwa'),
    readyPort: PWA_EMULATOR_PORT,
  },
];

// ── tmux CLI helpers ─────────────────────────────────────────

const tmux = (args: string[]): Promise<{ code: number; stdout: string }> =>
  new Promise((resolve) => {
    const proc = spawn('tmux', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout?.on('data', (d) => { out += String(d); });
    proc.on('close', (code) => resolve({ code: code ?? 1, stdout: out }));
  });

const sessionExists = async (): Promise<boolean> => {
  const r = await tmux(['has-session', '-t', SESSION]);
  return r.code === 0;
};

const isReady = async (svc: TmuxService): Promise<boolean> => {
  const path = svc.readyPath ?? '/';
  const url = `http://localhost:${svc.readyPort}${path}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
};

// ── lifecycle ────────────────────────────────────────────────

const startService = async (svc: TmuxService): Promise<void> => {
  if (!(await sessionExists())) {
    await tmux(['new-session', '-d', '-s', SESSION, '-c', svc.cwd, '-n', svc.name]);
    await tmux(['send-keys', '-t', `${SESSION}:${svc.window}`, svc.command, 'Enter']);
  } else {
    const list = await tmux(['list-windows', '-t', SESSION, '-F', '#{window_index}']);
    const existing = list.stdout.split('\n').map((l) => l.trim()).filter(Boolean);

    if (!existing.includes(String(svc.window))) {
      await tmux(['new-window', '-d', '-t', SESSION, '-n', svc.name, '-c', svc.cwd]);
      await tmux(['send-keys', '-t', `${SESSION}:${svc.window}`, svc.command, 'Enter']);
    } else {
      const paneResult = await tmux(['capture-pane', '-p', '-t', `${SESSION}:${svc.window}`, '-S', '-5']);
      const paneContent = paneResult.stdout?.trim() ?? '';
      if (!paneContent || paneContent.includes('command not found')) {
        await tmux(['send-keys', '-t', `${SESSION}:${svc.window}`, 'C-c']);
        await new Promise((r) => setTimeout(r, 500));
        await tmux(['send-keys', '-t', `${SESSION}:${svc.window}`, svc.command, 'Enter']);
      }
    }
  }

  // Brief delay to let the shell start processing the command
  await new Promise((r) => setTimeout(r, 3000));
};

export const startServices = async (
  options: { only?: string[]; timeoutMs?: number; projectRoot?: string } = {},
): Promise<void> => {
  const { timeoutMs = 180_000, projectRoot = process.cwd() } = options;
  const services = buildServices(projectRoot);

  const targets = options.only
    ? services.filter((s) => options.only!.includes(s.name))
    : services;

  if (targets.length === 0) return;

  console.log(`Starting services in tmux session '${SESSION}'...`);

  for (const svc of targets) {
    await startService(svc);
  }

  console.log('  Waiting for services...');
  await Promise.allSettled(
    targets.map(async (svc) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await isReady(svc)) {
          console.log(`  ✓ ${svc.name} ready on :${svc.readyPort}`);
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      console.error(`  ✗ ${svc.name} timed out on :${svc.readyPort}`);
    }),
  );
};

export const stopServices = async (): Promise<void> => {
  if (!(await sessionExists())) return;

  await tmux(['kill-session', '-t', SESSION]);
  console.log('✓ Tmux session closed');
};
