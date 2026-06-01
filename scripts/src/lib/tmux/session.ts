// scripts/src/lib/tmux/session.ts
// Unified tmux session management for Aikami services.
//
// Session naming:  aikami-{mode}-{service}
//   mode:    emulator | development | production
//   service: emulators | pwa | game | all
//
// Mode is stored as a tmux environment variable so we can
// detect mismatches without inspecting running processes.
//
// Usage from scripts:
//   import { startSession, joinSession, stopSession, listSessions } from './session';
//   await startSession({ service: 'pwa', mode: 'emulator' });
//   await joinSession({ service: 'pwa', mode: 'emulator' });
//   await stopSession({ service: 'pwa', mode: 'emulator' });

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { EMULATOR_PORTS } from '@aikami/constants';

// ── Types ──────────────────────────────────────────────────

export type AikamiMode = 'emulator' | 'development' | 'production';
export type TmuxService = 'emulators' | 'pwa' | 'game' | 'all';

export type SessionConfig = {
  mode: AikamiMode;
  service: TmuxService;
  force?: boolean;
  projectRoot?: string;
};

export type ServiceDef = {
  window: number;
  name: string;
  command: string;
  cwd: (root: string) => string;
  readyPort: number;
};

// ── Service definitions ────────────────────────────────────

const SERVICE_DEFS: Record<Exclude<TmuxService, 'all'>, ServiceDef> = {
  emulators: {
    window: 1,
    name: 'emulators',
    command: 'bun run emulate',
    cwd: (root) => resolve(root, 'apps/backend/firebase'),
    readyPort: EMULATOR_PORTS.auth,
  },
  pwa: {
    window: 2,
    name: 'pwa',
    command: 'bun run dev',
    cwd: (root) => resolve(root, 'apps/frontend/pwa'),
    readyPort: EMULATOR_PORTS.pwa,
  },
  game: {
    window: 3,
    name: 'game',
    command: 'bun run dev -- --mode emulator',
    cwd: (root) => resolve(root, 'apps/frontend/game'),
    readyPort: EMULATOR_PORTS.game,
  },
};

const ORDERED_SERVICES: Exclude<TmuxService, 'all'>[] = ['emulators', 'pwa', 'game'];

// ── Session naming ─────────────────────────────────────────

export const buildSessionName = (mode: AikamiMode, service: TmuxService): string =>
  `aikami-${mode}-${service}`;

export const parseSessionName = (
  name: string,
): { mode: AikamiMode; service: TmuxService } | null => {
  const m = name.match(/^aikami-(emulator|development|production)-(emulators|pwa|game|all)$/);
  if (!m) {
    return null;
  }
  return { mode: m[1] as AikamiMode, service: m[2] as TmuxService };
};

// ── Tmux CLI helpers ───────────────────────────────────────

const tmux = (args: string[]): Promise<{ code: number; stdout: string }> =>
  new Promise((resolve) => {
    const proc = spawn('tmux', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout?.on('data', (d) => {
      out += String(d);
    });
    proc.on('close', (code) => resolve({ code: code ?? 1, stdout: out }));
  });

export const hasTmux = async (): Promise<boolean> => {
  const r = await tmux(['-V']);
  return r.code === 0;
};

// ── Session existence ──────────────────────────────────────

export const sessionExists = async (sessionName: string): Promise<boolean> => {
  const r = await tmux(['has-session', '-t', sessionName]);
  return r.code === 0;
};

// ── Mode detection ─────────────────────────────────────────

/** Returns the mode stored in the session's AIKAMI_TMUX_MODE env var, or null. */
export const getSessionMode = async (sessionName: string): Promise<AikamiMode | null> => {
  try {
    const r = await tmux(['show-environment', '-t', sessionName, 'AIKAMI_TMUX_MODE']);
    const match = r.stdout.trim().match(/^AIKAMI_TMUX_MODE=(.+)$/);
    if (match && ['emulator', 'development', 'production'].includes(match[1])) {
      return match[1] as AikamiMode;
    }
    return null;
  } catch {
    return null;
  }
};

// ── Health check ───────────────────────────────────────────

export const isPortReady = async (port: number): Promise<boolean> => {
  try {
    const res = await fetch(`http://localhost:${port}/`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
};

// ── Direnv wrapper ─────────────────────────────────────────
// Tmux spawns a fresh shell without direnv hooks, so we need
// `direnv exec` to load the Nix environment before running commands.

const wrapCommand = (command: string): string => {
  // Keep the pane alive after the command exits so the user can see output.
  // For emulators, we print a message and wait for Enter.
  const keepalive = "; echo; echo '=== Stopped. Press Enter to close ==='; read";
  return `direnv exec . bash -c '${command}${keepalive}'`;
};

// ── Start service ──────────────────────────────────────────

const startSingleService = async (
  sessionName: string,
  svc: ServiceDef,
  projectRoot: string,
): Promise<void> => {
  const cwd = svc.cwd(projectRoot);

  if (!(await sessionExists(sessionName))) {
    // Create new session with the first window
    await tmux([
      'new-session',
      '-d',
      '-s',
      sessionName,
      '-c',
      cwd,
      '-n',
      svc.name,
      '-e',
      `AIKAMI_TMUX_MODE=${sessionName.split('-')[1]}`,
      wrapCommand(svc.command),
    ]);
    return;
  }

  // Session exists — add window if not already present
  const list = await tmux(['list-windows', '-t', sessionName, '-F', '#{window_index}']);
  const existing = list.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (!existing.includes(String(svc.window))) {
    await tmux([
      'new-window',
      '-d',
      '-t',
      sessionName,
      '-n',
      svc.name,
      '-c',
      cwd,
      wrapCommand(svc.command),
    ]);
  }
};

// ── Public API ─────────────────────────────────────────────

/**
 * Start a tmux session for the given mode and service.
 *
 * - If session does NOT exist: create it
 * - If session exists, same mode: attach (no-op for background start)
 * - If session exists, different mode:
 *   - force=true: kill then recreate
 *   - force=false: throw error
 *
 * Returns the session name.
 */
export const startSession = async (config: SessionConfig): Promise<string> => {
  const { mode, service, force = false, projectRoot = process.cwd() } = config;
  const sessionName = buildSessionName(mode, service);

  // Check if session already exists
  if (await sessionExists(sessionName)) {
    const existingMode = await getSessionMode(sessionName);

    if (force) {
      // Force: always kill and recreate
      const modeInfo = existingMode ? ` (was ${existingMode})` : '';
      console.log(`🔄 Force mode: recreating session ${sessionName}${modeInfo}...`);
      await tmux(['kill-session', '-t', sessionName]);
      // Brief pause to let tmux clean up
      await new Promise((r) => setTimeout(r, 500));
    } else if (existingMode && existingMode !== mode) {
      throw new Error(
        `Session ${sessionName} is already running in ${existingMode} mode (requested ${mode}). Use --force to recreate.`,
      );
    } else {
      // Same mode (or unknown) — session is already running, reuse it
      console.log(`✓ Session ${sessionName} is already running (${mode} mode)`);
      return sessionName;
    }
  }

  console.log(`🚀 Starting ${service} in ${mode} mode (session: ${sessionName})...`);

  if (service === 'all') {
    // Multi-window: emulators + pwa + game
    for (const s of ORDERED_SERVICES) {
      await startSingleService(sessionName, SERVICE_DEFS[s], projectRoot);
    }
  } else {
    await startSingleService(sessionName, SERVICE_DEFS[service], projectRoot);
  }

  // Wait briefly for the shell to start processing commands
  await new Promise((r) => setTimeout(r, 1500));

  console.log(`✓ Session ${sessionName} started (attach: tmux attach -t ${sessionName})`);
  return sessionName;
};

/**
 * Wait for services in a session to be ready on their ports.
 */
export const waitForReady = async (config: SessionConfig, timeoutMs = 180_000): Promise<void> => {
  const { service, mode } = config;
  const targets: ServiceDef[] =
    service === 'all' ? ORDERED_SERVICES.map((s) => SERVICE_DEFS[s]) : [SERVICE_DEFS[service]];

  const sessionName = buildSessionName(mode, service);

  if (!(await sessionExists(sessionName))) {
    console.warn(`⚠ Session ${sessionName} not found, skipping readiness check`);
    return;
  }

  console.log('  Waiting for services...');
  await Promise.allSettled(
    targets.map(async (svc) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await isPortReady(svc.readyPort)) {
          console.log(`  ✓ ${svc.name} ready on :${svc.readyPort}`);
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      console.error(`  ✗ ${svc.name} timed out on :${svc.readyPort}`);
    }),
  );
};

/**
 * Join (attach to) an existing tmux session.
 * Throws if the session does not exist.
 */
export const joinSession = async (config: {
  mode: AikamiMode;
  service: TmuxService;
}): Promise<void> => {
  const { mode, service } = config;
  const sessionName = buildSessionName(mode, service);

  if (!(await sessionExists(sessionName))) {
    throw new Error(
      `Session ${sessionName} is not running. Start it first with: bun run tmux:start`,
    );
  }

  console.log(`🖥  Attaching to ${sessionName} (Ctrl+B D to detach)...`);
  const proc = spawn('tmux', ['attach-session', '-t', sessionName], {
    stdio: 'inherit',
  });
  await new Promise<number>((resolve) => proc.on('exit', resolve));
};

/**
 * Stop (kill) a tmux session.
 * No-ops if the session does not exist.
 */
export const stopSession = async (config: {
  mode: AikamiMode;
  service: TmuxService;
}): Promise<void> => {
  const { mode, service } = config;
  const sessionName = buildSessionName(mode, service);

  if (!(await sessionExists(sessionName))) {
    console.log(`ℹ Session ${sessionName} is not running`);
    return;
  }

  await tmux(['kill-session', '-t', sessionName]);
  console.log(`✓ Session ${sessionName} stopped`);
};

/**
 * Stop all aikami tmux sessions regardless of mode/service.
 */
export const stopAllSessions = async (): Promise<void> => {
  const sessions = await listAllSessions();
  for (const s of sessions) {
    await tmux(['kill-session', '-t', s.name]).catch(() => {});
  }
  if (sessions.length > 0) {
    console.log(`✓ Stopped ${sessions.length} aikami session(s)`);
  } else {
    console.log('ℹ No aikami sessions running');
  }
};

// ── Listing ────────────────────────────────────────────────

export type SessionInfo = {
  name: string;
  mode: AikamiMode | 'unknown';
  service: TmuxService | 'unknown';
  windows: number;
  attached: boolean;
};

export const listAllSessions = async (): Promise<SessionInfo[]> => {
  const r = await tmux(['list-sessions', '-F', '#{session_name}']);
  if (r.code !== 0) {
    return [];
  }

  return r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((n) => n.startsWith('aikami-'))
    .map((name) => {
      const parsed = parseSessionName(name);
      return {
        name,
        mode: parsed?.mode ?? 'unknown',
        service: parsed?.service ?? 'unknown',
        windows: 0,
        attached: false,
      };
    });
};

export const listSessions = async (): Promise<SessionInfo[]> => {
  const sessions = await listAllSessions();

  // Enrich with window count and attachment status
  return await Promise.all(
    sessions.map(async (s) => {
      try {
        const winR = await tmux(['list-windows', '-t', s.name, '-F', '#{window_index}']);
        s.windows = winR.stdout.split('\n').filter((l) => l.trim()).length;

        const attachR = await tmux(['list-clients', '-t', s.name, '-F', '#{client_name}']);
        s.attached = attachR.stdout.trim().length > 0;
      } catch {
        // Session may have died between listing and querying
      }
      return s;
    }),
  );
};

/**
 * Print a formatted table of running aikami sessions.
 */
export const printSessionStatus = async (): Promise<void> => {
  const sessions = await listSessions();

  if (sessions.length === 0) {
    console.log('No aikami tmux sessions running.');
    console.log(`  Start one:  bun run tmux:start emulators`);
    return;
  }

  const Green = '\x1b[32m';
  const Yellow = '\x1b[33m';
  const Cyan = '\x1b[36m';
  const Dim = '\x1b[2m';
  const Reset = '\x1b[0m';
  const Bold = '\x1b[1m';

  console.log(`\n${Bold}Aikami Tmux Sessions${Reset}\n`);
  console.log(`${Dim}${'SESSION'.padEnd(32)} MODE          SERVICE    WINS  STATUS${Reset}`);

  for (const s of sessions) {
    const statusIcon = s.attached ? `${Green}● attached${Reset}` : `${Yellow}○ detached${Reset}`;
    console.log(
      ` ${s.name.padEnd(31)} ${s.mode.padEnd(13)} ${s.service.padEnd(10)} ${String(s.windows).padEnd(5)} ${statusIcon}`,
    );
  }

  console.log(
    `\n${Dim}Attach:  ${Cyan}tmux attach -t <session>${Reset}  or  ${Cyan}bun run tmux:join <service>${Reset}${Dim}`,
  );
  console.log(
    `Stop:    ${Cyan}tmux kill-session -t <session>${Reset}  or  ${Cyan}bun run tmux:stop <service>${Reset}\n`,
  );
};
