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
//     hub             → bun run dev
//     voice           → bun run dev
//     image           → bun run dev
//     text            → bun run dev
//     preview-client  → bun run scripts/src/lib/ops/preview_client.ts
//     preview-hub     → bun run scripts/src/lib/ops/preview_hub.ts
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

// biome-ignore-all lint/style/useNamingConvention: HerDr API response field names (snake_case) — must match external API contract
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
// need to be relative path since .pi/extensions/herdr-orchestrator.ts uses the same code and pi does not support path aliases
import { PORTS } from '../../../../packages/shared/constants/src/index';

// ── Types ──────────────────────────────────────────────────

export type AikamiMode = 'emulator' | 'staging' | 'production';

/** Canonical service names (used internally). */
export type DevService =
  | 'firebase'
  | 'client'
  | 'hub'
  | 'voice'
  | 'image'
  | 'text'
  | 'preview-client'
  | 'site'
  | 'preview-site'
  | 'preview-hub';

/** Accepted CLI values (includes 'all'). */
export type ServiceInput = DevService | 'all';

export type ServiceDef = {
  name: string;
  command: (mode: AikamiMode) => string;
  cwd: (root: string) => string;
  readyPort?: (mode: AikamiMode) => number | undefined;
};

export type SessionConfig = {
  mode: AikamiMode;
  /** Canonical service names to start. */
  services: DevService[];
  force?: boolean;
  join?: boolean;
  projectRoot?: string;
  /**
   * Wait for requested services' readyPorts to open after starting, then fail
   * loudly if any never come up. Default: true.
   */
  wait?: boolean;
  /** Per-service readiness timeout in ms. Default: 120_000. */
  waitTimeoutMs?: number;
};

export type ServiceStatus = {
  service: DevService;
  name: string;
  running: boolean;
  readyPort?: number;
  portOpen: boolean;
  /** Health state derived from pane processes + port liveness. */
  state: 'healthy' | 'booting' | 'crashed' | 'stopped';
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
    command: (mode) => `bun run emulate -- --mode ${mode}`,
    cwd: (root) => resolve(root, 'apps/backend/firebase'),
    readyPort: (mode) => (mode === 'emulator' ? PORTS.emulator.auth : undefined),
  },
  client: {
    name: 'client',
    command: (mode) => `bun run dev -- --mode ${mode}`,
    cwd: (root) => resolve(root, 'apps/frontend/client'),
    readyPort: (mode) => PORTS[mode].client,
  },
  voice: {
    name: 'voice',
    command: () => 'bun run dev',
    cwd: (root) => resolve(root, 'apps/backend/voice'),
    readyPort: (mode) => PORTS[mode].voice,
  },
  image: {
    name: 'image',
    command: () => 'bun run dev',
    cwd: (root) => resolve(root, 'apps/backend/image'),
    readyPort: (mode) => PORTS[mode].image,
  },
  text: {
    name: 'text',
    command: () => 'bun run dev',
    cwd: (root) => resolve(root, 'apps/backend/text'),
    readyPort: (mode) => PORTS[mode].text,
  },
  'preview-client': {
    name: 'preview-client',
    command: () => 'bun run scripts/src/lib/ops/preview_client.ts',
    cwd: (root) => root,
  },
  site: {
    name: 'site',
    command: (mode) => `bun run dev -- --mode ${mode}`,
    cwd: (root) => resolve(root, 'apps/frontend/site'),
    readyPort: (mode) => PORTS[mode].site,
  },
  'preview-site': {
    name: 'preview-site',
    command: () => 'bun run scripts/src/lib/ops/preview_site.ts',
    cwd: (root) => root,
  },
  hub: {
    name: 'hub',
    command: (mode) => `bun run dev -- --mode ${mode}`,
    cwd: (root) => resolve(root, 'apps/frontend/hub'),
    readyPort: (mode) => PORTS[mode].hub,
  },
  'preview-hub': {
    name: 'preview-hub',
    command: () => 'bun run scripts/src/lib/ops/preview_hub.ts',
    cwd: (root) => root,
  },
};

export const ALL_SERVICES: DevService[] = [
  'firebase',
  'client',
  'hub',
  'voice',
  'image',
  'text',
  'preview-client',
  'site',
  'preview-site',
  'preview-hub',
];

/** Map CLI aliases to canonical names. */
export const normalizeService = (input: string): DevService | 'all' => {
  if (![...ALL_SERVICES, 'all'].includes(input)) {
    throw new Error(
      `Unknown service: "${input}". Valid: firebase, client, hub, voice, image, text, preview-client, site, preview-site, preview-hub, all`,
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

/** Build the workspace name for a given mode, optionally scoped to a contract. */
export const buildSessionName = (mode: AikamiMode, contractId?: string): string =>
  contractId ? `aikami-${mode}-${contractId}` : `aikami-${mode}`;

/** Extract the current contract ID from the pipeline env, or undefined. */
export const currentContractId = (): string | undefined => {
  const contractPath = process.env.CONTRACT_PIPELINE_CONTRACT_PATH;
  if (contractPath) {
    const m = contractPath.match(/(C-\d+|MIG-\d+)/);
    return m?.[0];
  }
  return undefined;
};

/** Resolve the workspace name for a given mode in the current context. */
export const resolveSessionName = (mode: AikamiMode): string =>
  buildSessionName(mode, currentContractId());

/** Extract contract ID from a session name. Returns undefined if not contract-scoped. */
export const contractIdFromSessionName = (name: string): string | undefined => {
  // aikami-emulator-C-331 → C-331
  // aikami-emulator → undefined
  const parts = name.split('-');
  // After 'aikami-{mode}', if there are more segments, the rest is the contract ID
  if (parts.length > 2) {
    const contractParts = parts.slice(2);
    return contractParts.join('-');
  }
  return undefined;
};

/** Parse a workspace name back to mode, or null if not an aikami workspace. */
export const parseWorkspaceName = (name: string): AikamiMode | null => {
  if (name.startsWith('aikami-')) {
    const rest = name.slice(7);
    // Extract mode: 'emulator', 'staging', 'production'
    // May be followed by -C-XXX (contract-scoped)
    for (const mode of ['emulator', 'staging', 'production'] as const) {
      if (rest === mode || rest.startsWith(`${mode}-`)) {
        return mode;
      }
    }
  }
  return null;
};

// ── Herdr CLI helpers ──────────────────────────────────────

type HerdrResult = {
  code: number;
  stdout: string;
};

export const herdr = (args: string[], env?: Record<string, string>): Promise<HerdrResult> => {
  const timeout = 3000;
  return new Promise((resolveH, rejectH) => {
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* already dead */
      }
      rejectH(new Error(`herdr timed out after ${timeout}ms: ${args[0]}`));
    }, timeout);
    const proc = spawn('herdr', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    let out = '';
    proc.stdout?.on('data', (d) => {
      out += String(d);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolveH({ code: code ?? 1, stdout: out });
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      rejectH(err);
    });
  });
};

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

/** Kill any process occupying a port so the next bind succeeds deterministically. */
export const killPort = (port: number): Promise<void> =>
  new Promise((resolveK) => {
    // First, identify the PID listening on the port
    const lsofProc = spawn('lsof', ['-ti', `tcp:${port}`], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    let pidOutput = '';
    lsofProc.stdout?.on('data', (chunk) => {
      pidOutput += chunk.toString();
    });

    lsofProc.on('close', (code) => {
      if (code !== 0 || !pidOutput.trim()) {
        // Port not in use or lsof unavailable — nothing to kill
        resolveK();
        return;
      }

      const pid = pidOutput.trim().split('\n')[0];
      if (pid === undefined || !/^\d+$/.test(pid)) {
        resolveK();
        return;
      }

      // Verify the process is one we expect (node, bun, vite, uwsgi, etc.)
      // by checking its command line. If it's unrelated, don't kill it.
      const psProc = spawn('ps', ['-p', pid, '-o', 'comm='], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      let psOutput = '';
      psProc.stdout?.on('data', (chunk) => {
        psOutput += chunk.toString();
      });

      psProc.on('close', (psCode) => {
        if (psCode !== 0) {
          // Process already gone or ps failed
          resolveK();
          return;
        }

        const comm = psOutput.trim().toLowerCase();
        const expectedProcs = ['node', 'bun', 'vite', 'uwsgi', 'python', 'firebase'];
        const isExpected = expectedProcs.some((name) => comm.includes(name));

        if (!isExpected) {
          // Port is occupied by an unrelated process — don't kill it
          console.warn(
            `Port ${port} is busy with unrelated process (PID ${pid}, ${comm}). Not killing.`,
          );
          resolveK();
          return;
        }

        // Safe to kill — it's one of our dev server processes
        const killProc = spawn('kill', [pid], { stdio: 'ignore' });
        killProc.on('close', () => {
          resolveK();
        });
        killProc.on('error', () => resolveK());
      });
    });

    lsofProc.on('error', () => {
      // lsof not available — fall back to fuser (less safe, but original behavior)
      const fuserProc = spawn('fuser', ['-k', '-n', 'tcp', String(port)], {
        stdio: 'ignore',
      });
      fuserProc.on('close', () => resolveK());
      fuserProc.on('error', () => resolveK());
    });
  });

// ── Direnv wrapper ─────────────────────────────────────────

export const wrapCommand = (command: string): string =>
  `direnv exec . bash -c '${command}; echo; echo "=== Stopped. Press Enter to close ==="; read'`;

/** Shell process names that indicate an idle pane with no active command. */
const SHELL_NAMES = new Set(['fish', 'bash', 'zsh', 'sh', 'dash']);

/**
 * How old (seconds) a foreground process must be before a closed port counts
 * as a crash rather than a slow boot.
 */
const CRASH_GRACE_SECONDS = 45;

type PaneProcessInfo = {
  result: {
    process_info: {
      foreground_processes: { name: string; pid: number }[];
    };
  };
};

/** Elapsed seconds since a PID started (`ps -o etimes=` or `ps -o etime=` fallback), or undefined. */
const processAgeSeconds = async (pid: number): Promise<number | undefined> => {
  // Try GNU/Linux etimes (seconds) first
  const etimesOut = await new Promise<string>((res) => {
    const p = spawn('ps', ['-o', 'etimes=', '-p', String(pid)], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let o = '';
    p.stdout?.on('data', (d) => {
      o += String(d);
    });
    p.on('close', () => res(o));
    p.on('error', () => res(''));
  });
  const etimesVal = Number.parseInt(etimesOut.trim(), 10);
  if (Number.isFinite(etimesVal)) {
    return etimesVal;
  }

  // Fallback to BSD/macOS etime ([[dd-]hh:]mm:ss format)
  const etimeOut = await new Promise<string>((res) => {
    const p = spawn('ps', ['-o', 'etime=', '-p', String(pid)], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let o = '';
    p.stdout?.on('data', (d) => {
      o += String(d);
    });
    p.on('close', () => res(o));
    p.on('error', () => res(''));
  });

  // Parse [[dd-]hh:]mm:ss into total seconds
  const parts = etimeOut.trim().split(/[-:]/);
  if (parts.length === 0) {
    return undefined;
  }

  let totalSeconds = 0;
  if (parts.length === 2) {
    // mm:ss
    const [mm, ss] = parts.map((s) => Number.parseInt(s, 10));
    if (Number.isFinite(mm) && Number.isFinite(ss) && mm !== undefined && ss !== undefined) {
      totalSeconds = mm * 60 + ss;
    }
  } else if (parts.length === 3) {
    // hh:mm:ss
    const [hh, mm, ss] = parts.map((s) => Number.parseInt(s, 10));
    if (Number.isFinite(hh) && Number.isFinite(mm) && Number.isFinite(ss) && hh !== undefined && mm !== undefined && ss !== undefined) {
      totalSeconds = hh * 3600 + mm * 60 + ss;
    }
  } else if (parts.length === 4) {
    // dd-hh:mm:ss
    const [dd, hh, mm, ss] = parts.map((s) => Number.parseInt(s, 10));
    if (Number.isFinite(dd) && Number.isFinite(hh) && Number.isFinite(mm) && Number.isFinite(ss) && dd !== undefined && hh !== undefined && mm !== undefined && ss !== undefined) {
      totalSeconds = dd * 86400 + hh * 3600 + mm * 60 + ss;
    }
  }

  return totalSeconds > 0 ? totalSeconds : undefined;
};

/**
 * Assess a service pane's health from its foreground processes + port:
 *  - 'crashed' → the wrapped command exited (only shells left in the pane), or
 *                the process is alive but its port has been dead longer than
 *                CRASH_GRACE_SECONDS (wedged).
 *  - 'booting' → port not open yet but the process is young (still starting).
 *  - 'healthy' → port open, or no port defined and a real process is running.
 */
const assessServicePane = async (
  paneId: string,
  port?: number,
): Promise<'crashed' | 'booting' | 'healthy'> => {
  const r = await herdrJson<PaneProcessInfo>(['pane', 'process-info', '--pane', paneId]);
  const procs = r?.result?.process_info?.foreground_processes;

  // process-info unavailable — fall back to the port only, never restart on missing data
  if (!procs) {
    if (port !== undefined && (await isPortReady(port))) {
      return 'healthy';
    }
    return 'booting';
  }

  const real = procs.filter((p) => !SHELL_NAMES.has(p.name));
  if (real.length === 0) {
    // Only shells left → the wrapped command already exited (crash / stopped)
    return 'crashed';
  }

  if (port !== undefined && !(await isPortReady(port))) {
    const pid = real[0]?.pid;
    if (pid !== undefined) {
      const age = await processAgeSeconds(pid);
      // Wedged: process still alive but its port has been dead too long
      if (age !== undefined && age > CRASH_GRACE_SECONDS) {
        return 'crashed';
      }
    }
    return 'booting';
  }
  return 'healthy';
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

/** Get tabs (id + label) in a workspace. */
const getWorkspaceTabs = async (
  workspaceId: string,
): Promise<{ tab_id: string; label: string }[]> => {
  const r = await herdrJson<TabListResult>(['tab', 'list', '--workspace', workspaceId]);
  return r?.result?.tabs ?? [];
};

/** Get tab names in a workspace. */
export const getWorkspaceTabNames = async (workspaceId: string): Promise<string[]> => {
  const tabs = await getWorkspaceTabs(workspaceId);
  return tabs.map((t) => t.label);
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
  const {
    mode,
    services,
    force = false,
    join = false,
    wait = true,
    waitTimeoutMs = 120_000,
    projectRoot = process.cwd(),
  } = config;
  const workspaceLabel = resolveSessionName(mode);

  if (services.length === 0) {
    throw new Error(
      'No services specified. Use: firebase, client, hub, voice, image, text, preview-client, site, preview-site, preview-hub, all',
    );
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
    await herdr(['pane', 'run', rootPaneId, wrapCommand(svc.command(mode))]);
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
        await herdr(['pane', 'run', tabR.result.root_pane.pane_id, wrapCommand(s.command(mode))]);
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
          const port = svc.readyPort?.(mode);
          if (servicePane) {
            const state = await assessServicePane(servicePane.pane_id, port);
            if (state === 'crashed') {
              console.log(`  ↻ Tab: ${svc.name} crashed, restarting...`);
              await herdr(['pane', 'run', servicePane.pane_id, wrapCommand(svc.command(mode))]);
              continue;
            }
            if (state === 'booting') {
              console.log(`  ⏳ Tab: ${svc.name} still booting, skipping`);
              continue;
            }
          }
        }
        console.log(`  ✓ Tab: ${svc.name} already running, skipping`);
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
        await herdr(['pane', 'run', tabR.result.root_pane.pane_id, wrapCommand(svc.command(mode))]);
        console.log(`  ✓ Tab: ${svc.name}`);
      }
    }
  }

  await new Promise((r) => setTimeout(r, 1500));

  // ── Verify requested services actually came up ────────
  const failed: string[] = [];
  if (wait) {
    failed.push(...(await waitForReady({ services, mode }, waitTimeoutMs)));

    // ── Workspace health sweep: flag crashed sibling services ──
    // Catches services that died outside this invocation (e.g. a client tab
    // that crashed earlier) so the workspace isn't reported as fully healthy.
    const tabNames = await getWorkspaceTabNames(workspaceId);
    const panes = await getWorkspacePanes(workspaceId);
    const paneByTab = new Map(panes.map((p) => [p.tab_id, p]));
    const crashedOthers: string[] = [];
    for (const tabName of tabNames) {
      // Map "pi" tab to preview-client service (matches herdr:list's mapping)
      const service = (tabName === 'pi' ? 'preview-client' : tabName) as DevService;
      if (!SERVICE_DEFS[service] || services.includes(service)) {
        continue;
      }
      const tabId = await findTab(workspaceId, tabName);
      const pane = tabId ? paneByTab.get(tabId) : undefined;
      if (!pane) {
        continue;
      }
      const port = SERVICE_DEFS[service].readyPort?.(mode);
      if ((await assessServicePane(pane.pane_id, port)) === 'crashed') {
        crashedOthers.push(tabName);
      }
    }
    if (crashedOthers.length > 0) {
      console.log(`\n⚠  Health check — crashed service(s) in ${workspaceLabel}:`);
      for (const name of crashedOthers) {
        console.log(`    ✗ ${name} is DOWN. Restart it with: bun herdr:start ${name}`);
      }
    }
  }

  if (failed.length > 0) {
    throw new Error(
      `Services failed to start within ${waitTimeoutMs / 1000}s: ${failed.join(', ')}. ` +
        `Check logs with 'bun herdr:list' or 'herdr session attach default'.`,
    );
  }

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
  const workspaceLabel = resolveSessionName(mode);

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

  const targetNames = targets.map((s) => SERVICE_DEFS[s].name);

  // Stop tabs individually. Never nuke the workspace — contract-scoped
  // sessions only contain the services we started, so the "all tabs match"
  // optimization would fire on every restart and destroy the workspace.
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
  const workspaceLabel = resolveSessionName(mode);

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

  // Force-kill any stale processes on the target ports so the cooldown
  // isn't defeated by orphaned Vite/uwsgi processes from prior runs.
  for (const service of services) {
    const def = SERVICE_DEFS[service];
    const port = def.readyPort?.(mode);
    if (port !== undefined) {
      await killPort(port);
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
  const workspaceLabel = resolveSessionName(mode);

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
    ? r.result.workspaces.filter((w) => {
        const parsed = parseWorkspaceName(w.label);
        return parsed === mode;
      })
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
            state: piRunning ? 'healthy' : 'stopped',
          },
        ],
      });
      continue;
    }

    const parsed = parseWorkspaceName(ws.label);
    const wsMode = parsed ?? 'emulator';

    const tabs = await getWorkspaceTabs(ws.workspace_id);
    const tabIdByName = new Map(tabs.map((t) => [t.label, t.tab_id]));
    const panes = await getWorkspacePanes(ws.workspace_id);
    const paneByTab = new Map(panes.map((p) => [p.tab_id, p]));

    const servicesStatus: ServiceStatus[] = ALL_SERVICES.map((svc) => {
      const def = SERVICE_DEFS[svc];
      const running = tabIdByName.has(def.name);
      return {
        service: svc,
        name: def.name,
        running,
        readyPort: def.readyPort ? def.readyPort(wsMode) : undefined,
        portOpen: false,
        state: running ? 'booting' : 'stopped',
      };
    });

    // Assess per-service health: pane processes + port liveness
    await Promise.all(
      servicesStatus
        .filter((s) => s.running)
        .map(async (s) => {
          const def = SERVICE_DEFS[s.service];
          const tabId = tabIdByName.get(def.name);
          const pane = tabId ? paneByTab.get(tabId) : undefined;
          if (!pane) {
            return;
          }
          const port = def.readyPort?.(wsMode);
          s.state = await assessServicePane(pane.pane_id, port);
          if (port !== undefined) {
            s.portOpen = await isPortReady(port);
          }
        }),
    );

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
      let indicator = '';
      if (svc.state === 'crashed') {
        indicator = `${Red}crashed${Reset}`;
      } else if (svc.state === 'booting' && svc.readyPort !== undefined) {
        indicator = `${Yellow}:${svc.readyPort} booting${Reset}`;
      } else if (svc.state === 'healthy' && svc.readyPort !== undefined) {
        indicator = `${Green}:${svc.readyPort} ready${Reset}`;
      } else if (svc.running) {
        indicator = 'running';
      }
      const name = svc.running ? svc.name : `${Red}${svc.name}${Reset}`;
      console.log(`  ${runningIcon} ${name.padEnd(14)} ${indicator}`);
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
): Promise<string[]> => {
  const { services, mode } = config;
  const workspaceLabel = resolveSessionName(mode);

  const wsId = await findWorkspace(workspaceLabel);
  if (!wsId) {
    console.warn(`⚠ Workspace ${workspaceLabel} not found, skipping readiness check`);
    return [];
  }

  console.log('  Waiting for services...');
  const targets = services.map((s) => SERVICE_DEFS[s]);
  const failed: string[] = [];

  await Promise.all(
    targets.map(async (svc) => {
      const port = svc.readyPort?.(mode);
      if (port === undefined) {
        console.log(`  ✓ ${svc.name} (no port check)`);
        return;
      }
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await isPortReady(port)) {
          console.log(`  ✓ ${svc.name} ready on :${port}`);
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      console.error(`  ✗ ${svc.name} timed out on :${port}`);
      failed.push(svc.name);
    }),
  );

  return failed;
};

// ── Contract session lifecycle ────────────────────────────

/**
 * Stop the contract-scoped herdr session for a given mode.
 * Closes the entire workspace (stopping all services — client, firebase, etc.).
 * Called during pipeline cleanup after merge/block.
 */
export const stopContractSession = async (mode: AikamiMode, contractId: string): Promise<void> => {
  const label = buildSessionName(mode, contractId);
  const wsId = await findWorkspace(label);
  if (!wsId) {
    return; // Already stopped or never started
  }
  await herdr(['workspace', 'close', wsId]);
  console.log(`🧹 Stopped contract session: ${label}`);
};
