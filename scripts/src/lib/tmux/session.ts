// scripts/src/lib/tmux/session.ts
// Unified tmux session management for Aikami services.
//
// Architecture:
//   One tmux session per mode:  aikami-{mode}
//   Each service is a tmux window (tab) inside that session.
//   Windows are matched by name, not fixed indices.
//
//   Tab layout:
//     firebase  → bun run emulate
//     client     → bun run dev
//     voice      → bun run dev
//     image      → bun run dev
//
// Three consumers share the exact same tmux session:
//   1. pi extension (tmux-orchestrator.ts)
//   2. test_blackbox
//   3. root package.json scripts (tmux:start, tmux:stop, etc.)
//
// CLI:
//   bun tmux:start firebase          # firebase tab
//   bun tmux:start client            # add client tab
//   bun tmux:start voice             # add voice tab
//   bun tmux:start all --join        # all three + attach
//   bun tmux:stop client             # kill client tab
//   bun tmux:stop all                # kill entire session
//   bun tmux:list                    # show sessions + tabs + ports

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { EMULATOR_PORTS } from '@aikami/constants';

// ── Types ──────────────────────────────────────────────────

export type AikamiMode = 'emulator' | 'staging' | 'production';

/** Canonical service names (used internally). */
export type DevService = 'firebase' | 'client' | 'voice' | 'image' | 'text';

/** Accepted CLI values (includes singular aliases and 'all'). */
export type ServiceInput = DevService | 'emulator' | 'all';

export type ServiceDef = {
  name: string;
  command: string;
  cwd: (root: string) => string;
  readyPort: number;
};

// Keep old TmuxService alias for backward compat
/** @deprecated Use DevService or ServiceInput instead. */
export type TmuxService = DevService | 'all';

export type SessionConfig = {
  mode: AikamiMode;
  /** Canonical service names to start. */
  services: DevService[];
  force?: boolean;
  join?: boolean;
  projectRoot?: string;
};

export type ServiceStatus = {
  service: DevService;
  name: string;
  running: boolean;
  readyPort: number;
  portOpen: boolean;
};

export type SessionInfo = {
  name: string;
  mode: AikamiMode;
  attached: boolean;
  services: ServiceStatus[];
};

// ── Service definitions ────────────────────────────────────

const SERVICE_DEFS: Record<DevService, ServiceDef> = {
  firebase: {
    name: 'firebase',
    command: 'bun run emulate',
    cwd: (root) => resolve(root, 'apps/backend/firebase'),
    readyPort: EMULATOR_PORTS.auth,
  },
  client: {
    name: 'client',
    command: 'bun run dev',
    cwd: (root) => resolve(root, 'apps/frontend/client'),
    readyPort: EMULATOR_PORTS.client,
  },
  voice: {
    name: 'voice',
    command: 'bun run dev',
    cwd: (root) => resolve(root, 'apps/backend/voice'),
    readyPort: EMULATOR_PORTS.voice,
  },
  image: {
    name: 'image',
    command: 'bun run dev',
    cwd: (root) => resolve(root, 'apps/backend/image'),
    readyPort: EMULATOR_PORTS.image,
  },
  text: {
    name: 'text',
    command: 'bun run dev',
    cwd: (root) => resolve(root, 'apps/backend/text'),
    readyPort: EMULATOR_PORTS.text,
  },
};

const ALL_SERVICES: DevService[] = ['firebase', 'client', 'voice', 'image', 'text'];

/** Map CLI aliases to canonical names. */
export const normalizeService = (input: string): DevService | 'all' => {
  const alias: Record<string, DevService | 'all'> = {
    emulator: 'firebase',
    emulators: 'firebase',
    client: 'client',
    voice: 'voice',
    image: 'image',
    text: 'text',
    all: 'all',
  };
  const result = alias[input];
  if (!result) {
    throw new Error(
      `Unknown service: "${input}". Valid: firebase, client, voice, image, text, all`,
    );
  }
  return result;
};

/** Expand 'all' to the full list of canonical services. */
export const expandServices = (inputs: ServiceInput[]): DevService[] => {
  if (inputs.includes('all')) {
    return [...ALL_SERVICES];
  }
  const normalized = inputs.map((s) => (s === 'emulator' ? 'firebase' : s)) as DevService[];
  return [...new Set(normalized)];
};

// ── Session naming ─────────────────────────────────────────

/** Build the session name for a given mode. */
export const buildSessionName = (mode: AikamiMode): string => `aikami-${mode}`;

/** Parse a session name back to mode, or null if not an aikami session. */
export const parseSessionName = (name: string): AikamiMode | null => {
  const m = name.match(/^aikami-(emulator|staging|production)$/);
  if (!m) {
    return null;
  }
  return m[1] as AikamiMode;
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

/** Returns the mode stored in the session's AIKAMI_TMUX_MODE env var, or null. */
export const getSessionMode = async (sessionName: string): Promise<AikamiMode | null> => {
  try {
    const r = await tmux(['show-environment', '-t', sessionName, 'AIKAMI_TMUX_MODE']);
    const match = r.stdout.trim().match(/^AIKAMI_TMUX_MODE=(.+)$/);
    if (match && ['emulator', 'staging', 'production'].includes(match[1])) {
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

const wrapCommand = (command: string): string => {
  const keepalive = "; echo; echo '=== Stopped. Press Enter to close ==='; read";
  return `direnv exec . bash -c '${command}${keepalive}'`;
};

// ── Window (tab) management ────────────────────────────────

/** Get window names in the session. */
const getSessionWindowNames = async (sessionName: string): Promise<string[]> => {
  const r = await tmux(['list-windows', '-t', sessionName, '-F', '#{window_name}']);
  return r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
};

// ── Start services ─────────────────────────────────────────

/**
 * Start one or more services as tmux windows in the mode session.
 */
export const startServices = async (config: SessionConfig): Promise<string> => {
  const { mode, services, force = false, join = false, projectRoot = process.cwd() } = config;
  const sessionName = buildSessionName(mode);

  if (services.length === 0) {
    throw new Error('No services specified. Use: firebase, client, voice, all');
  }

  // ── Mode mismatch guard ──────────────────────────────
  if (await sessionExists(sessionName)) {
    const existingMode = await getSessionMode(sessionName);

    if (force) {
      const modeInfo = existingMode ? ` (was ${existingMode})` : '';
      console.log(`🔄 Force mode: recreating session ${sessionName}${modeInfo}...`);
      await tmux(['kill-session', '-t', sessionName]);
      await new Promise((r) => setTimeout(r, 500));
    } else if (existingMode && existingMode !== mode) {
      throw new Error(
        `Session ${sessionName} is already running in ${existingMode} mode (requested ${mode}). Use --force to recreate.`,
      );
    }
  }

  // ── Create session if needed ──────────────────────────
  if (!(await sessionExists(sessionName))) {
    const first = services[0];
    const svc = SERVICE_DEFS[first];
    const cwd = svc.cwd(projectRoot);

    console.log(`🚀 Creating session ${sessionName} (${mode} mode)...`);
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
      `AIKAMI_TMUX_MODE=${mode}`,
      wrapCommand(svc.command),
    ]);
    console.log(`  ✓ Tab: ${svc.name}`);

    // Add remaining services as new windows
    for (let i = 1; i < services.length; i++) {
      const s = SERVICE_DEFS[services[i]];
      await tmux([
        'new-window',
        '-d',
        '-t',
        sessionName,
        '-n',
        s.name,
        '-c',
        s.cwd(projectRoot),
        wrapCommand(s.command),
      ]);
      console.log(`  ✓ Tab: ${s.name}`);
    }
  } else {
    // ── Session exists — add missing windows ────────────
    const existing = await getSessionWindowNames(sessionName);

    for (const service of services) {
      const svc = SERVICE_DEFS[service];
      if (existing.includes(svc.name)) {
        console.log(`  ○ Tab: ${svc.name} already running, skipping`);
        continue;
      }
      await tmux([
        'new-window',
        '-d',
        '-t',
        sessionName,
        '-n',
        svc.name,
        '-c',
        svc.cwd(projectRoot),
        wrapCommand(svc.command),
      ]);
      console.log(`  ✓ Tab: ${svc.name}`);
    }
  }

  await new Promise((r) => setTimeout(r, 1500));

  // ── Attach if requested ───────────────────────────────
  if (join) {
    console.log(`🖥  Attaching to ${sessionName} (Ctrl+B D to detach)...`);
    const proc = spawn('tmux', ['attach-session', '-t', sessionName], { stdio: 'inherit' });
    await new Promise<number>((resolve) => proc.on('exit', resolve));
  } else {
    console.log(`\n✓ Session ${sessionName} ready (attach: tmux attach -t ${sessionName})`);
  }

  return sessionName;
};

// ── Stop services ──────────────────────────────────────────

/**
 * Stop services by killing their tmux windows.
 */
export const stopServices = async (config: {
  mode: AikamiMode;
  services: DevService[] | 'all';
}): Promise<void> => {
  const { mode, services } = config;
  const sessionName = buildSessionName(mode);

  if (!(await sessionExists(sessionName))) {
    console.log(`ℹ Session ${sessionName} is not running`);
    return;
  }

  const targets = services === 'all' ? ALL_SERVICES : services;

  if (targets.length === 0) {
    console.log('ℹ No services specified to stop');
    return;
  }

  const existing = await getSessionWindowNames(sessionName);
  const targetNames = targets.map((s) => SERVICE_DEFS[s].name);

  // If killing all existing windows, just nuke the session
  if (targetNames.length >= existing.length && existing.every((w) => targetNames.includes(w))) {
    await tmux(['kill-session', '-t', sessionName]);
    console.log(`✓ Session ${sessionName} stopped`);
    return;
  }

  for (const name of targetNames) {
    if (existing.includes(name)) {
      await tmux(['kill-window', '-t', `${sessionName}:=${name}`]);
      console.log(`  ✓ Stopped ${name}`);
    } else {
      console.log(`  ○ ${name} not running`);
    }
  }
};

/**
 * Stop all aikami sessions (all modes).
 */
export const stopAllSessions = async (): Promise<void> => {
  const sessions = await listAllSessionNames();
  for (const name of sessions) {
    await tmux(['kill-session', '-t', name]).catch(() => {});
  }
  if (sessions.length > 0) {
    console.log(`✓ Stopped ${sessions.length} aikami session(s)`);
  } else {
    console.log('ℹ No aikami sessions running');
  }
};

// ── Join session ───────────────────────────────────────────

export const joinSession = async (mode: AikamiMode): Promise<void> => {
  const sessionName = buildSessionName(mode);

  if (!(await sessionExists(sessionName))) {
    throw new Error(
      `Session ${sessionName} is not running. Start it first with: bun tmux:start all`,
    );
  }

  console.log(`🖥  Attaching to ${sessionName} (Ctrl+B D to detach)...`);
  const proc = spawn('tmux', ['attach-session', '-t', sessionName], { stdio: 'inherit' });
  await new Promise<number>((resolve) => proc.on('exit', resolve));
};

// ── List sessions & services ───────────────────────────────

const listAllSessionNames = async (): Promise<string[]> => {
  const r = await tmux(['list-sessions', '-F', '#{session_name}']);
  if (r.code !== 0) {
    return [];
  }
  return r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((n) => n.startsWith('aikami-'));
};

export const listServices = async (mode?: AikamiMode): Promise<SessionInfo[]> => {
  const names =
    mode != null
      ? (await sessionExists(buildSessionName(mode)))
        ? [buildSessionName(mode)]
        : []
      : await listAllSessionNames();

  const results: SessionInfo[] = [];

  for (const name of names) {
    const parsed = parseSessionName(name);
    const sessionMode = parsed ?? 'emulator';

    let attached = false;
    try {
      const attachR = await tmux(['list-clients', '-t', name, '-F', '#{client_name}']);
      attached = attachR.stdout.trim().length > 0;
    } catch {
      // Session may have died
    }

    const existing = await getSessionWindowNames(name);

    const servicesStatus: ServiceStatus[] = ALL_SERVICES.map((svc) => {
      const def = SERVICE_DEFS[svc];
      const running = existing.includes(def.name);
      return {
        service: svc,
        name: def.name,
        running,
        readyPort: def.readyPort,
        portOpen: false,
      };
    });

    const portChecks = await Promise.all(
      servicesStatus
        .filter((s) => s.running)
        .map(async (s) => ({ ...s, portOpen: await isPortReady(s.readyPort) })),
    );

    for (const check of portChecks) {
      const svc = servicesStatus.find((s) => s.service === check.service);
      if (svc) {
        svc.portOpen = check.portOpen;
      }
    }

    results.push({ name, mode: sessionMode, attached, services: servicesStatus });
  }

  return results;
};

export const printServiceList = async (mode?: AikamiMode): Promise<void> => {
  const sessions = await listServices(mode);

  if (sessions.length === 0) {
    console.log('No aikami tmux sessions running.');
    console.log('  Start one:  bun tmux:start all');
    return;
  }

  const Green = '\x1b[32m';
  const Yellow = '\x1b[33m';
  const Cyan = '\x1b[36m';
  const Dim = '\x1b[2m';
  const Red = '\x1b[31m';
  const Reset = '\x1b[0m';
  const Bold = '\x1b[1m';

  for (const session of sessions) {
    const statusIcon = session.attached
      ? `${Green}● attached${Reset}`
      : `${Yellow}○ detached${Reset}`;
    console.log(`\n${Bold}${session.name}${Reset}  ${Dim}${session.mode}${Reset}  ${statusIcon}`);

    for (const svc of session.services) {
      const runningIcon = svc.running ? `${Green}✓${Reset}` : `${Dim}✗${Reset}`;
      const portIndicator = svc.running
        ? svc.portOpen
          ? `${Green}:${svc.readyPort} ready${Reset}`
          : `${Yellow}:${svc.readyPort} booting${Reset}`
        : '';
      const name = svc.running ? svc.name : `${Red}${svc.name}${Reset}`;
      console.log(`  ${runningIcon} ${name.padEnd(14)} ${portIndicator}`);
    }
  }

  console.log(
    `\n${Dim}Start:  ${Cyan}bun tmux:start <service>${Reset}  ${Dim}Stop:  ${Cyan}bun tmux:stop <service>${Reset}`,
  );
  console.log(
    `${Dim}Join:   ${Cyan}bun tmux:join${Reset}               ${Dim}List:  ${Cyan}bun tmux:list${Reset}\n`,
  );
};

// ── Wait for readiness ─────────────────────────────────────

export const waitForReady = async (
  config: { services: DevService[]; mode: AikamiMode },
  timeoutMs = 180_000,
): Promise<void> => {
  const { services, mode } = config;
  const sessionName = buildSessionName(mode);

  if (!(await sessionExists(sessionName))) {
    console.warn(`⚠ Session ${sessionName} not found, skipping readiness check`);
    return;
  }

  console.log('  Waiting for services...');
  const targets = services.map((s) => SERVICE_DEFS[s]);

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
