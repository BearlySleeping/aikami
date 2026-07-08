// scripts/src/lib/herdr/session.ts
// Unified herdr workspace management for Aikami services.
//
// Architecture:
//   One herdr workspace per mode:  aikami-{mode}
//   Each service is a herdr tab inside that workspace.
//   Tabs are matched by name, not fixed indices.
//   The herdr server handles persistence — panes survive client detach.
//
//   Tab layout (per workspace):
//     firebase       → bun run emulate
//     client          → bun run dev
//     voice           → bun run dev
//     image           → bun run dev
//     text            → bun run dev
//     preview-client  → bun run scripts/src/lib/ops/preview_client.ts
//
// Three consumers share the exact same herdr server:
//   1. pi extension (herdr-orchestrator.ts)
//   2. test_blackbox
//   3. root package.json scripts (herdr:start, herdr:stop, etc.)
//
// CLI:
//   bun herdr:start firebase          # firebase tab
//   bun herdr:start client            # add client tab
//   bun herdr:start voice             # add voice tab
//   bun herdr:start all --join        # all + attach
//   bun herdr:stop client             # kill client tab
//   bun herdr:stop all                # kill entire workspace
//   bun herdr:list                    # show workspaces + tabs + ports

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
// need to be relative path since .pi/extensions/herdr-orchestrator.ts uses the same code and pi does not support path aliases
import { EMULATOR_PORTS } from '../../../../packages/shared/constants/src/index';

// ── Types ──────────────────────────────────────────────────

export type AikamiMode = 'emulator' | 'staging' | 'production';

/** Canonical service names (used internally). */
export type DevService = 'firebase' | 'client' | 'voice' | 'image' | 'text' | 'preview-client';

/** Accepted CLI values (includes 'all'). */
export type ServiceInput = DevService | 'all';

export type ServiceDef = {
  name: string;
  command: string;
  cwd: (root: string) => string;
  readyPort?: number;
};

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
  readyPort?: number;
  portOpen: boolean;
};

export type SessionInfo = {
  name: string;
  mode: AikamiMode;
  attached: boolean;
  services: ServiceStatus[];
};

// ── Service definitions ────────────────────────────────────

export const SERVICE_DEFS: Record<DevService, ServiceDef> = {
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
  'preview-client': {
    name: 'preview-client',
    command: 'bun run scripts/src/lib/ops/preview_client.ts',
    cwd: (root) => root,
  },
};

export const ALL_SERVICES: DevService[] = [
  'firebase',
  'client',
  'voice',
  'image',
  'text',
  'preview-client',
];

/** Map CLI aliases to canonical names. */
export const normalizeService = (input: string): DevService | 'all' => {
  if (![...ALL_SERVICES, 'all'].includes(input)) {
    throw new Error(
      `Unknown service: "${input}". Valid: firebase, client, voice, image, text, preview-client, all`,
    );
  }
  return input as DevService | 'all';
};

/** Expand 'all' to the full list of canonical services. */
export const expandServices = (inputs: ServiceInput[]): DevService[] => {
  if (inputs.includes('all')) {
    return [...ALL_SERVICES];
  }
  return [...new Set(inputs.filter((s) => s !== 'all') as DevService[])];
};

// ── Workspace naming ───────────────────────────────────────

/** Build the workspace name for a given mode. */
export const buildSessionName = (mode: AikamiMode): string => `aikami-${mode}`;

/** Parse a workspace name back to mode, or null if not an aikami workspace. */
export const parseWorkspaceName = (name: string): AikamiMode | null => {
  if (name.startsWith('aikami-')) {
    const suffix = name.slice(7);
    if (suffix === 'emulator' || suffix === 'staging' || suffix === 'production') {
      return suffix;
    }
  }
  return null;
};

// ── Herdr CLI helpers ──────────────────────────────────────

type HerdrResult = {
  code: number;
  stdout: string;
};

export const herdr = (args: string[], env?: Record<string, string>): Promise<HerdrResult> =>
  new Promise((resolveH) => {
    const proc = spawn('herdr', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    let out = '';
    proc.stdout?.on('data', (d) => {
      out += String(d);
    });
    proc.on('close', (code) => resolveH({ code: code ?? 1, stdout: out }));
  });

export const herdrJson = async <T>(
  args: string[],
  env?: Record<string, string>,
): Promise<T | null> => {
  const r = await herdr(args, env);
  if (r.code !== 0 || !r.stdout.trim()) {
    return null;
  }
  try {
    return JSON.parse(r.stdout.trim()) as T;
  } catch {
    return null;
  }
};

export const hasHerdr = async (): Promise<boolean> => {
  const r = await herdr(['--version']);
  return r.code === 0;
};

/** Returns true if the herdr server daemon is running. */
const serverRunning = async (): Promise<boolean> => {
  const r = await herdr(['status', 'server']);
  return r.code === 0 && /status:\s*running/i.test(r.stdout);
};

/** Ensure the herdr headless server is running. */
export const ensureServer = async (): Promise<void> => {
  // Quick check first — avoid double spawn
  if (await serverRunning()) {
    return;
  }

  // Start the headless server
  const proc = spawn('herdr', ['server'], {
    stdio: 'ignore',
    env: process.env,
  });
  proc.unref(); // detach — don't keep parent event loop alive

  // Wait for the server to come up
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await serverRunning()) {
      return; // server is up, daemon keeps running independently
    }
  }

  // If after 7.5s server isn't up, kill the spawn attempt and throw
  try {
    proc.kill();
  } catch {
    // ignore
  }
  throw new Error('herdr server did not start within timeout — is herdr installed correctly?');
};

// ── Workspace existence ────────────────────────────────────

type WorkspaceListEntry = {
  workspace_id: string;
  label: string;
};

type WorkspaceListResult = {
  result: {
    workspaces: WorkspaceListEntry[];
  };
};

/** Check if a workspace with the given label exists. Returns id or null. */
export const findWorkspace = async (label: string): Promise<string | null> => {
  const r = await herdrJson<WorkspaceListResult>(['workspace', 'list']);
  if (!r?.result?.workspaces) {
    return null;
  }
  const ws = r.result.workspaces.find((w) => w.label === label);
  return ws?.workspace_id ?? null;
};

export const workspaceExists = async (workspaceLabel: string): Promise<boolean> => {
  const id = await findWorkspace(workspaceLabel);
  return id !== null;
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

export const wrapCommand = (command: string): string =>
  `direnv exec . bash -c '${command}; echo; echo "=== Stopped. Press Enter to close ==="; read'`;

/** Shell process names that indicate an idle pane with no active command. */
const SHELL_NAMES = new Set(['fish', 'bash', 'zsh', 'sh', 'dash']);

/**
 * Check if a herdr pane is idle — only a shell running, no active command process.
 * Uses `herdr pane process-info` to inspect foreground processes.
 */
const isPaneIdle = async (paneId: string): Promise<boolean> => {
  const r = await herdrJson<{
    result: {
      process_info: {
        foreground_processes: { name: string }[];
      };
    };
  }>(['pane', 'process-info', '--pane', paneId]);

  if (!r?.result?.process_info?.foreground_processes) {
    return true;
  }

  const procs = r.result.process_info.foreground_processes;
  return procs.every((p) => SHELL_NAMES.has(p.name));
};

// ── Tab management ─────────────────────────────────────────

type TabListEntry = {
  tab_id: string;
  label: string;
};

type TabListResult = {
  result: {
    tabs: TabListEntry[];
  };
};

type PaneListEntry = {
  pane_id: string;
  tab_id: string;
  workspace_id: string;
};

type PaneListResult = {
  result: {
    panes: PaneListEntry[];
  };
};

type WorkspaceCreateResult = {
  result: {
    workspace: { workspace_id: string };
    tab: { id: string };
    root_pane: { pane_id: string };
  };
};

type TabCreateResult = {
  result: {
    tab: { tab_id: string };
    root_pane: { pane_id: string };
  };
};

/** Get tab names in a workspace. */
export const getWorkspaceTabNames = async (workspaceId: string): Promise<string[]> => {
  const r = await herdrJson<TabListResult>(['tab', 'list', '--workspace', workspaceId]);
  if (!r?.result?.tabs) {
    return [];
  }
  return r.result.tabs.map((t) => t.label);
};

/** Get tab id by label in a workspace. */
const findTab = async (workspaceId: string, label: string): Promise<string | null> => {
  const r = await herdrJson<TabListResult>(['tab', 'list', '--workspace', workspaceId]);
  if (!r?.result?.tabs) {
    return null;
  }
  const tab = r.result.tabs.find((t) => t.label === label);
  return tab?.tab_id ?? null;
};

/**
 * Get all panes for a workspace with their tab assignments.
 * Returns an array of { pane_id, tab_id, workspace_id }.
 */
const getWorkspacePanes = async (workspaceId: string): Promise<PaneListEntry[]> => {
  const r = await herdrJson<PaneListResult>(['pane', 'list', '--workspace', workspaceId]);
  if (!r?.result?.panes) {
    return [];
  }
  return r.result.panes;
};

// ── Start services ─────────────────────────────────────────

/**
 * Start one or more services as herdr tabs in the mode workspace.
 */
export const startServices = async (config: SessionConfig): Promise<string> => {
  const { mode, services, force = false, join = false, projectRoot = process.cwd() } = config;
  const workspaceLabel = buildSessionName(mode);

  if (services.length === 0) {
    throw new Error('No services specified. Use: firebase, client, voice, image, text, all');
  }

  await ensureServer();

  const existingWsId = await findWorkspace(workspaceLabel);

  // ── Mode mismatch guard: force-recreate workspace if requested ──
  if (force && existingWsId) {
    console.log(`🔄 Force mode: recreating workspace ${workspaceLabel}...`);
    await herdr(['workspace', 'close', existingWsId]);
    await new Promise((r) => setTimeout(r, 500));
    // Fall through to create new workspace
  } else if (existingWsId && !force) {
    // Workspace exists — check if wrong mode is stored
    // (herdr doesn't store mode, but we check by existence)
    // Just proceed to add missing tabs
  }

  let workspaceId = existingWsId && !force ? existingWsId : null;

  // ── Create workspace if needed ──────────────────────────
  if (!workspaceId) {
    const first = services[0];
    if (!first) {
      throw new Error('No services available');
    }
    const svc = SERVICE_DEFS[first];
    const cwd = svc.cwd(projectRoot);

    console.log(`🚀 Creating workspace ${workspaceLabel} (${mode} mode)...`);
    const r = await herdrJson<WorkspaceCreateResult>([
      'workspace',
      'create',
      '--cwd',
      cwd,
      '--label',
      workspaceLabel,
      '--no-focus',
    ]);
    if (!r?.result) {
      throw new Error(`Failed to create workspace ${workspaceLabel}`);
    }

    workspaceId = r.result.workspace.workspace_id;

    // Rename initial tab and run command
    const rootPaneId = r.result.root_pane.pane_id;
    await herdr(['tab', 'rename', `${workspaceId}:1`, svc.name]);
    await herdr(['pane', 'run', rootPaneId, wrapCommand(svc.command)]);
    console.log(`  ✓ Tab: ${svc.name}`);

    // Add remaining services as new tabs
    for (const service of services.slice(1)) {
      const s = SERVICE_DEFS[service];
      const tabR = await herdrJson<TabCreateResult>([
        'tab',
        'create',
        '--workspace',
        workspaceId,
        '--cwd',
        s.cwd(projectRoot),
        '--label',
        s.name,
        '--no-focus',
      ]);
      if (tabR?.result) {
        await herdr(['pane', 'run', tabR.result.root_pane.pane_id, wrapCommand(s.command)]);
        console.log(`  ✓ Tab: ${s.name}`);
      }
    }
  } else {
    // ── Workspace exists — add missing tabs ────────────
    const existing = await getWorkspaceTabNames(workspaceId);
    const existingPanes = await getWorkspacePanes(workspaceId);

    for (const service of services) {
      const svc = SERVICE_DEFS[service];
      if (existing.includes(svc.name)) {
        // Tab exists — verify the pane actually has the command running
        const tabId = await findTab(workspaceId, svc.name);
        if (tabId) {
          const servicePane = existingPanes.find((p) => p.tab_id === tabId);
          if (servicePane && (await isPaneIdle(servicePane.pane_id))) {
            console.log(`  ↻ Tab: ${svc.name} idle, restarting...`);
            await herdr(['pane', 'run', servicePane.pane_id, wrapCommand(svc.command)]);
            continue;
          }
        }
        console.log(`  ○ Tab: ${svc.name} already running, skipping`);
        continue;
      }
      const tabR = await herdrJson<TabCreateResult>([
        'tab',
        'create',
        '--workspace',
        workspaceId,
        '--cwd',
        svc.cwd(projectRoot),
        '--label',
        svc.name,
        '--no-focus',
      ]);
      if (tabR?.result) {
        await herdr(['pane', 'run', tabR.result.root_pane.pane_id, wrapCommand(svc.command)]);
        console.log(`  ✓ Tab: ${svc.name}`);
      }
    }
  }

  await new Promise((r) => setTimeout(r, 1500));

  // ── Attach if requested ───────────────────────────────
  if (join) {
    console.log(`🖥  Attaching to ${workspaceLabel}...`);
    const proc = spawn('herdr', ['session', 'attach', 'default'], { stdio: 'inherit' });
    await new Promise<number>((resolveJ) => proc.on('exit', resolveJ));
  } else {
    console.log(`\n✓ Workspace ${workspaceLabel} ready (attach: herdr session attach default)`);
  }

  return workspaceLabel;
};

// ── Stop services ──────────────────────────────────────────

/**
 * Stop services by closing their herdr tabs or the whole workspace.
 */
export const stopServices = async (config: {
  mode: AikamiMode;
  services: DevService[] | 'all';
}): Promise<void> => {
  const { mode, services } = config;
  const workspaceLabel = buildSessionName(mode);

  const workspaceId = await findWorkspace(workspaceLabel);
  if (!workspaceId) {
    console.log(`ℹ Workspace ${workspaceLabel} is not running`);
    return;
  }

  const targets = services === 'all' ? ALL_SERVICES : services;

  if (targets.length === 0) {
    console.log('ℹ No services specified to stop');
    return;
  }

  const existing = await getWorkspaceTabNames(workspaceId);
  const targetNames = targets.map((s) => SERVICE_DEFS[s].name);

  // If killing all existing tabs, just nuke the workspace
  if (targetNames.length >= existing.length && existing.every((w) => targetNames.includes(w))) {
    await herdr(['workspace', 'close', workspaceId]);
    console.log(`✓ Workspace ${workspaceLabel} stopped`);
    return;
  }

  for (const name of targetNames) {
    const tabId = await findTab(workspaceId, name);
    if (tabId) {
      await herdr(['tab', 'close', tabId]);
      console.log(`  ✓ Stopped ${name}`);
    } else {
      console.log(`  ○ ${name} not running`);
    }
  }
};

// ── Restart services ────────────────────────────────────────

/**
 * Restart a dev service: stop (if running) → brief cooldown → start fresh.
 *
 * Critical: after the coder creates new SvelteKit routes, the client dev
 * server must be restarted for Vite to pick up the new files. The QA agent
 * must call `herdr_session restart client` before running tests that hit
 * new routes.
 */
export const restartServices = async (config: SessionConfig): Promise<string> => {
  const { mode, services, projectRoot } = config;
  const workspaceLabel = buildSessionName(mode);

  const svcNames = services.map((s) => SERVICE_DEFS[s].name).join(', ');
  console.log(`🔄 Restarting ${svcNames}...`);

  // Stop if running
  const workspaceId = await findWorkspace(workspaceLabel);
  if (workspaceId) {
    const tabNames = await getWorkspaceTabNames(workspaceId);
    const running = services.filter((s) => tabNames.includes(SERVICE_DEFS[s].name));
    if (running.length > 0) {
      await stopServices({ mode, services: running });
    }
  }

  // Brief cooldown — let the OS release the port
  await new Promise((r) => setTimeout(r, 1000));

  // Start fresh
  return startServices({ mode, services, projectRoot });
};

/**
 * Stop all aikami workspaces (all modes).
 */
export const stopAllSessions = async (): Promise<void> => {
  await ensureServer();

  const r = await herdrJson<WorkspaceListResult>(['workspace', 'list']);
  if (!r?.result?.workspaces) {
    console.log('ℹ No aikami workspaces running');
    return;
  }

  const aikamiWorkspaces = r.result.workspaces.filter((w) => w.label.startsWith('aikami-'));
  for (const ws of aikamiWorkspaces) {
    await herdr(['workspace', 'close', ws.workspace_id]).catch(() => {});
  }

  if (aikamiWorkspaces.length > 0) {
    console.log(`✓ Stopped ${aikamiWorkspaces.length} aikami workspace(s)`);
  } else {
    console.log('ℹ No aikami workspaces running');
  }
};

// ── Join workspace ─────────────────────────────────────────

export const joinSession = async (mode: AikamiMode): Promise<void> => {
  const workspaceLabel = buildSessionName(mode);

  if (!(await workspaceExists(workspaceLabel))) {
    throw new Error(
      `Workspace ${workspaceLabel} is not running. Start it first with: bun herdr:start all`,
    );
  }

  console.log(`🖥  Attaching to herdr (workspace: ${workspaceLabel})...`);
  const proc = spawn('herdr', ['session', 'attach', 'default'], { stdio: 'inherit' });
  await new Promise<number>((resolveJ) => proc.on('exit', resolveJ));
};

// ── List workspaces & services ─────────────────────────────

type WorkspaceInfo = {
  workspace_id: string;
  label: string;
  cwd: string;
};

type WorkspaceFullListResult = {
  result: {
    workspaces: WorkspaceInfo[];
  };
};

export const listServices = async (mode?: AikamiMode): Promise<SessionInfo[]> => {
  await ensureServer();

  const r = await herdrJson<WorkspaceFullListResult>(['workspace', 'list']);
  if (!r?.result?.workspaces) {
    return [];
  }

  const aikamiWorkspaces = mode
    ? r.result.workspaces.filter((w) => w.label === buildSessionName(mode))
    : r.result.workspaces.filter((w) => {
        if (!w.label.startsWith('aikami-')) {
          return false;
        }
        // Only show mode workspaces (emulator/staging/production) in service list.
        // pi workspace is shown separately.
        const parsed = parseWorkspaceName(w.label);
        return parsed !== null || w.label === 'aikami-pi';
      });

  const results: SessionInfo[] = [];

  for (const ws of aikamiWorkspaces) {
    // ── pi workspace — special handling ──────────────────
    if (ws.label === 'aikami-pi') {
      const existing = await getWorkspaceTabNames(ws.workspace_id);
      const piRunning = existing.includes('pi');
      results.push({
        name: ws.label,
        mode: 'emulator',
        attached: false,
        services: [
          {
            service: 'preview-client' as DevService,
            name: 'pi',
            running: piRunning,
            portOpen: piRunning,
          },
        ],
      });
      continue;
    }

    const parsed = parseWorkspaceName(ws.label);
    const wsMode = parsed ?? 'emulator';

    const existing = await getWorkspaceTabNames(ws.workspace_id);

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
        .filter((s) => s.running && s.readyPort !== undefined)
        .map(async (s) => ({ ...s, portOpen: await isPortReady(s.readyPort ?? 0) })),
    );

    for (const check of portChecks) {
      const svc = servicesStatus.find((s) => s.service === check.service);
      if (svc) {
        svc.portOpen = check.portOpen;
      }
    }

    results.push({
      name: ws.label,
      mode: wsMode,
      attached: false, // herdr doesn't expose client attachment per workspace easily
      services: servicesStatus,
    });
  }

  return results;
};

export const printServiceList = async (mode?: AikamiMode): Promise<void> => {
  const sessions = await listServices(mode);

  if (sessions.length === 0) {
    console.log('No aikami herdr workspaces running.');
    console.log('  Start one:  bun herdr:start all');
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
    const isPi = session.name === 'aikami-pi';
    const modeLabel = isPi ? 'agent' : session.mode;
    const statusIcon = `${Yellow}○ detached${Reset}`;
    console.log(`\n${Bold}${session.name}${Reset}  ${Dim}${modeLabel}${Reset}  ${statusIcon}`);

    for (const svc of session.services) {
      const runningIcon = svc.running ? `${Green}✓${Reset}` : `${Dim}✗${Reset}`;
      const portIndicator =
        svc.running && svc.readyPort !== undefined
          ? svc.portOpen
            ? `${Green}:${svc.readyPort} ready${Reset}`
            : `${Yellow}:${svc.readyPort} booting${Reset}`
          : '';
      const name = svc.running ? svc.name : `${Red}${svc.name}${Reset}`;
      console.log(`  ${runningIcon} ${name.padEnd(14)} ${portIndicator}`);
    }
  }

  console.log(
    `\n${Dim}Start:  ${Cyan}bun herdr:start <service>${Reset}  ${Dim}Stop:  ${Cyan}bun herdr:stop <service>${Reset}`,
  );
  console.log(
    `${Dim}Join:   ${Cyan}bun herdr:join${Reset}               ${Dim}List:  ${Cyan}bun herdr:list${Reset}\n`,
  );
};

// ── Wait for readiness ─────────────────────────────────────

export const waitForReady = async (
  config: { services: DevService[]; mode: AikamiMode },
  timeoutMs = 180_000,
): Promise<void> => {
  const { services, mode } = config;
  const workspaceLabel = buildSessionName(mode);

  const wsId = await findWorkspace(workspaceLabel);
  if (!wsId) {
    console.warn(`⚠ Workspace ${workspaceLabel} not found, skipping readiness check`);
    return;
  }

  console.log('  Waiting for services...');
  const targets = services.map((s) => SERVICE_DEFS[s]);

  await Promise.allSettled(
    targets.map(async (svc) => {
      if (svc.readyPort === undefined) {
        console.log(`  ✓ ${svc.name} (no port check)`);
        return;
      }
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
