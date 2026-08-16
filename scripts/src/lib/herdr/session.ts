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
//     text-ollama     → bun run dev:ollama (opt-in advanced, :11434)
//     image-comfyui   → bun run dev:comfyui (opt-in advanced, :8188)
//     postgres        → bun run scripts/src/lib/postgres/lifecycle.ts start --foreground
//     preview-client  → bun run scripts/src/lib/ops/preview_client.ts
//     preview-hub     → bun run scripts/src/lib/ops/preview_hub.ts
//     tauri           → bun run scripts/src/lib/ops/run_tauri.ts (launches an
//                        already-built desktop binary — build first with
//                        `bun moon run client:tauri-build`. Has no HTTP port,
//                        so there's nothing to poll for readiness; the pane
//                        itself IS the log — read it with `bun herdr:list` /
//                        `herdr pane read` / `herdr_session read tauri`
//                        instead of watching a terminal live.)
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
import { writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// need to be relative path since .pi/extensions/herdr-orchestrator.ts uses the same code and pi does not support path aliases
import { contractPortOffset, PORTS } from '../../../../packages/shared/constants/src/index';
import { hasDirenv } from '../env/direnv_detect';

// Re-exported for back-compat — the canonical definition now lives in
// ../env/mode (single source of truth for mode resolution).
import type { AikamiMode } from '../env/mode';

export type { AikamiMode } from '../env/mode';

import {
  killPid,
  killPortUnsafe,
  pidsOnPort,
  processAgeSeconds,
  processName,
} from '../env/process_info';
import { findBash, posixQuote } from '../env/which';

// ── Types ──────────────────────────────────────────────────

/** Canonical service names (used internally). */
export type DevService =
  | 'firebase'
  | 'client'
  | 'hub'
  | 'voice'
  | 'image'
  | 'text'
  | 'text-ollama'
  | 'image-comfyui'
  | 'postgres'
  | 'preview-client'
  | 'site'
  | 'preview-site'
  | 'preview-hub'
  | 'tauri';

/** Accepted CLI values (includes 'all'). */
export type ServiceInput = DevService | 'all';

/** How a service's readyPort should be probed: HTTP fetch or raw TCP connect. */
export type ReadyCheck = 'http' | 'tcp';

export type ServiceDef = {
  name: string;
  command: (mode: AikamiMode) => string;
  cwd: (root: string) => string;
  readyPort?: (mode: AikamiMode) => number | undefined;
  /** Readiness probe for readyPort — 'http' by default; raw-TCP services (postgres) use 'tcp'. */
  readyCheck?: ReadyCheck;
};

export type SessionConfig = {
  mode: AikamiMode;
  /** Canonical service names to start. */
  services: DevService[];
  force?: boolean;
  /** Kill whatever's already bound to each requested service's port before
   *  starting it, instead of failing with EADDRINUSE. Does NOT recreate the
   *  workspace (unlike `force`) — only frees the ports. */
  forcePorts?: boolean;
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
  hub: {
    name: 'hub',
    command: (mode) => `bun run dev -- --mode ${mode}`,
    cwd: (root) => resolve(root, 'apps/frontend/hub'),
    readyPort: (mode) => PORTS[mode].hub,
  },
  // C-392: the voice/image/text dev engines delegate to the C-390
  // local-stack compose topology (apps/backend/local-stack/compose.yaml) via
  // each project's scripts/start.ts — the same file the published stack
  // ships, so dev and user engines cannot drift. voice → sherpa-onnx :8089,
  // image → sd-server :8188, text → llama-server :11434.
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
  // C-392 advanced, opt-in engines — Ollama and ComfyUI stay one command
  // away via the local-stack compose profiles. Both share a port with the
  // default engine of their modality, so they are mutually exclusive with it
  // (assertNoPortConflicts refuses to start both). Kept OUT of ALL_SERVICES.
  'text-ollama': {
    name: 'text-ollama',
    command: () => 'bun run dev:ollama',
    cwd: (root) => resolve(root, 'apps/backend/text'),
    readyPort: (mode) => PORTS[mode].text,
  },
  'image-comfyui': {
    name: 'image-comfyui',
    command: () => 'bun run dev:comfyui',
    cwd: (root) => resolve(root, 'apps/backend/image'),
    readyPort: (mode) => PORTS[mode].image,
  },
  // Local PostgreSQL (C-387) — a real engine matching production, Nix-provided.
  // Runs the lifecycle script in foreground mode so the pane stays alive and
  // doubles as the log viewer. Emulator-only: no local Postgres exists in
  // staging/production, so readyPort returns undefined there.
  postgres: {
    name: 'postgres',
    command: (mode) =>
      mode === 'emulator'
        ? 'bun run scripts/src/lib/postgres/lifecycle.ts start --foreground'
        : 'echo "postgres is an emulator-only service — no local Postgres in this mode"',
    cwd: (root) => root,
    readyPort: (mode) => (mode === 'emulator' ? PORTS.emulator.postgres : undefined),
    // PostgreSQL speaks the wire protocol, not HTTP — the generic fetch()
    // probe would never pass (and would spam "invalid length of startup
    // packet" into the server log). Probe with a raw TCP connect instead.
    readyCheck: 'tcp',
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
  'preview-hub': {
    name: 'preview-hub',
    command: () => 'bun run scripts/src/lib/ops/preview_hub.ts',
    cwd: (root) => root,
  },
  tauri: {
    name: 'tauri',
    // Launch-only (no build step) — run_tauri.ts picks release over debug
    // and errors clearly if neither exists yet. Build first with
    // `bun moon run client:tauri-build`.
    command: () => 'bun run scripts/src/lib/ops/run_tauri.ts',
    cwd: (root) => root,
    // No HTTP port — the desktop window has nothing to poll.
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
  'tauri',
];

/**
 * All valid service names — superset of ALL_SERVICES. Used for CLI validation
 * and `herdr:list`. postgres (C-387) and the C-392 advanced engines
 * (text-ollama, image-comfyui) are fully manageable even though they are NOT
 * in the `all` group.
 */
export const KNOWN_SERVICES: DevService[] = [
  ...ALL_SERVICES,
  'postgres',
  'text-ollama',
  'image-comfyui',
];

/** Map a workspace tab label back to a known service key, or undefined. */
const serviceFromTabLabel = (label: string): DevService | undefined => {
  if (label === 'pi') {
    return 'preview-client';
  }
  return (KNOWN_SERVICES as readonly string[]).includes(label) ? (label as DevService) : undefined;
};
/** Services whose ports vary per contract — dev servers with a Firebase-
 *  adjacent port that collides across concurrent contract pipelines.
 *  voice/image/text stay on shared base ports (heavy singleton backends);
 *  the C-392 advanced engines (text-ollama, image-comfyui) stay on the same
 *  shared base ports as their modality. */
const OFFSET_AWARE_SERVICES = new Set<DevService>(['client', 'hub', 'site', 'firebase']);

/** Resolve a service's ready port, shifted by a contract's port offset
 *  when that service is offset-aware. */
export const resolveReadyPort = (
  serviceKey: DevService,
  mode: AikamiMode,
  offset: number,
): number | undefined => {
  const port = SERVICE_DEFS[serviceKey].readyPort?.(mode);
  if (port === undefined || offset === 0 || !OFFSET_AWARE_SERVICES.has(serviceKey)) {
    return port;
  }
  return port + offset;
};

/** Build the wrapped shell command for a service, prefixing
 *  PUBLIC_EMULATOR_PORT_OFFSET / PORT env vars for contract-scoped runs so
 *  concurrent contracts never bind the same port. */
const buildServiceCommand = (serviceKey: DevService, mode: AikamiMode, offset: number): string => {
  const command = SERVICE_DEFS[serviceKey].command(mode);
  if (offset === 0 || !OFFSET_AWARE_SERVICES.has(serviceKey)) {
    return command;
  }
  const port = resolveReadyPort(serviceKey, mode, offset);
  const portEnv = port !== undefined ? ` PORT=${port}` : '';
  return `PUBLIC_EMULATOR_PORT_OFFSET=${offset}${portEnv} ${command}`;
};

/** Map CLI aliases to canonical names. */
export const normalizeService = (input: string): DevService | 'all' => {
  if (![...KNOWN_SERVICES, 'all'].includes(input)) {
    throw new Error(`Unknown service: "${input}". Valid: ${KNOWN_SERVICES.join(', ')}, all`);
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

/**
 * Refuse to start two services that bind the same ready port (C-392 AC-7
 * watch point). The default engines and their advanced alternates share a
 * port — text/text-ollama on 11434, image/image-comfyui on 8188 — and
 * starting both would produce a confusing bind error instead of a clear
 * message. This is the one permitted herdr start-flow addition; the
 * SERVICE_DEFS shape and the offset mechanism are untouched.
 *
 * @throws Error when two requested services resolve to the same port.
 */
export const assertNoPortConflicts = (
  services: readonly DevService[],
  mode: AikamiMode,
  offset: number,
): void => {
  const portOwners = new Map<number, string>();
  for (const service of services) {
    const port = resolveReadyPort(service, mode, offset);
    if (port === undefined) {
      continue;
    }
    const owner = portOwners.get(port);
    if (owner !== undefined && owner !== service) {
      throw new Error(
        `Cannot start ${owner} and ${service} together: both bind :${port}. ` +
          `They are mutually exclusive (text↔text-ollama on 11434, ` +
          `image↔image-comfyui on 8188). Start one, or stop the other first.`,
      );
    }
    portOwners.set(port, service);
  }
};

/**
 * Validate port conflicts across the requested services plus any services
 * already running in an existing workspace (C-392 AC-7 watch point). Reusing
 * a workspace that already runs e.g. image-comfyui must refuse starting
 * `image` with the same clear message as starting both together, instead of
 * producing a confusing bind error later.
 */
export const assertNoRunningServiceConflicts = (
  services: readonly DevService[],
  runningTabLabels: readonly string[],
  mode: AikamiMode,
  offset: number,
): void => {
  const runningServices = runningTabLabels
    .map(serviceFromTabLabel)
    .filter((s): s is DevService => s !== undefined);
  assertNoPortConflicts([...new Set([...runningServices, ...services])], mode, offset);
};

// ── Workspace naming ───────────────────────────────────────

/** Build the workspace name for a given mode, optionally scoped to a contract. */
export const buildSessionName = (mode: AikamiMode, contractId?: string): string =>
  contractId ? `aikami-${mode}-${contractId}` : `aikami-${mode}`;

/** Extract a contract ID (e.g. `C-379`) from a contract file path, or undefined. */
export const parseContractIdFromPath = (contractPath: string | undefined): string | undefined => {
  if (!contractPath) {
    return undefined;
  }
  return contractPath.match(/(C-\d+|MIG-\d+)/)?.[0];
};

/** Extract the current contract ID from the pipeline env, or undefined. */
export const currentContractId = (): string | undefined =>
  parseContractIdFromPath(process.env.CONTRACT_PIPELINE_CONTRACT_PATH);

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
  stderr: string;
};

type HerdrOptions = {
  /** Kill + reject if the herdr CLI takes longer than this (default 10s).
   *  3s was too tight: `tab create --env` spawns a shell and triggers direnv,
   *  and under load a 3s reject produced spurious failures. Cheap local-socket
   *  probes (--version, status server) still complete in ms. */
  timeoutMs?: number;
  env?: Record<string, string>;
};

/**
 * Run a herdr CLI command. The herdr CLI talks to the headless server over a
 * unix socket, so the server's CURRENTLY FOCUSED workspace is the implicit
 * context for commands that do not take an explicit workspace/cwd (e.g.
 * `worktree create`). Commands that depend on the repo must pass `--cwd`
 * explicitly — see createWorktree/openWorktree in worktree.ts.
 */
export const herdr = (args: string[], opts: HerdrOptions = {}): Promise<HerdrResult> => {
  const timeout = opts.timeoutMs ?? 10_000;
  return new Promise((resolveH, rejectH) => {
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* already dead */
      }
      rejectH(new Error(`herdr timed out after ${timeout}ms: ${args.join(' ')}`));
    }, timeout);
    const proc = spawn('herdr', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...opts.env },
      // Windows: herdr is a console app — without windowsHide every headless
      // CLI call flashes a new console window (open/close popup storm). The
      // contract pipeline polls herdr every ~500ms, so this must be hidden.
      // No-op on POSIX.
      windowsHide: true,
    });
    let out = '';
    let errOut = '';
    proc.stdout?.on('data', (d) => {
      out += String(d);
    });
    proc.stderr?.on('data', (d) => {
      errOut += String(d);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolveH({ code: code ?? 1, stdout: out, stderr: errOut });
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      rejectH(err);
    });
  });
};

export const herdrJson = async <T>(args: string[], opts: HerdrOptions = {}): Promise<T | null> => {
  const r = await herdr(args, opts);
  if (r.code !== 0 || !r.stdout.trim()) {
    // herdr reports failures as JSON on stdout, but real CLI errors (bad
    // invocation context, missing worktree, etc.) land on stderr with a
    // non-zero code. Surface them instead of silently returning null — the
    // generic "failed" errors downstream are useless for debugging.
    const detail = (r.stderr.trim() || r.stdout.trim()).slice(0, 500) || `exit code ${r.code}`;
    if (/protocol_mismatch/i.test(detail)) {
      console.warn(
        `[herdr] ${args.join(' ')} failed: ${detail}\n` +
          '  💡 herdr client/server protocol mismatch — the running herdr server is older ' +
          'than the installed client. Fix: run `herdr server stop`, then `herdr` again to ' +
          'start a fresh server with the new binary.',
      );
    } else {
      console.warn(`[herdr] ${args.join(' ')} failed: ${detail}`);
    }
    return null;
  }
  try {
    return JSON.parse(r.stdout.trim()) as T;
  } catch {
    console.warn(
      `[herdr] ${args.join(' ')} returned non-JSON output: ${r.stdout.trim().slice(0, 200)}`,
    );
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

// ── Client/server compatibility ────────────────────────────

/** Structured view of `herdr status` output. */
export type HerdrCompatibility = {
  clientVersion?: string;
  clientProtocol?: number;
  serverStatus?: string;
  serverVersion?: string;
  serverProtocol?: number;
  /** The `compatible: yes|no` verdict from the server status block. */
  compatible?: boolean;
  restartNeeded?: boolean;
};

/** Parse `herdr status` output into structured fields. */
export const parseHerdrStatus = (stdout: string): HerdrCompatibility => {
  const result: HerdrCompatibility = {};
  let section: 'client' | 'server' | 'update' | null = null;
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === 'client:') {
      section = 'client';
      continue;
    }
    if (trimmed === 'server:') {
      section = 'server';
      continue;
    }
    if (trimmed === 'update:') {
      section = 'update';
      continue;
    }
    if (!section || !trimmed) {
      continue;
    }
    const [key, value] = trimmed.split(/:\s*/, 2);
    if (!key || value === undefined) {
      continue;
    }
    const v = value.trim();
    switch (section) {
      case 'client':
        if (key === 'version') {
          result.clientVersion = v;
        }
        if (key === 'protocol') {
          result.clientProtocol = Number(v) || undefined;
        }
        break;
      case 'server':
        if (key === 'status') {
          result.serverStatus = v;
        }
        if (key === 'version') {
          result.serverVersion = v;
        }
        if (key === 'protocol') {
          result.serverProtocol = Number(v) || undefined;
        }
        if (key === 'compatible') {
          result.compatible = v === 'yes';
        }
        break;
      case 'update':
        if (key === 'restart_needed') {
          result.restartNeeded = v === 'yes';
        }
        break;
    }
  }
  return result;
};

/**
 * Fail fast when the installed herdr client and the running herdr server are
 * on incompatible socket protocols. This happens when herdr is updated (e.g.
 * a `flake.lock` bump / devShell rebuild) while the OLD server daemon keeps
 * running: the client talks protocol N+1, the server answers N, and every
 * `herdr` API call fails with `protocol_mismatch`. Instead of letting that
 * surface as a cryptic `[herdr] ... failed` warning deep inside some script
 * (e.g. the contract pipeline), detect it up front and print the fix.
 * No-op when the server is down or the verdict is missing — starting a
 * fresh server from the current client binary is always compatible.
 */
export const assertHerdrCompatible = async (): Promise<void> => {
  const r = await herdr(['status']);
  if (r.code !== 0) {
    return; // Server down / status unavailable — ensureServer() handles that.
  }
  const status = parseHerdrStatus(r.stdout);
  if (status.compatible === false) {
    throw new Error(
      'herdr client/server protocol mismatch detected.\n' +
        `  client: ${status.clientVersion ?? '?'} (protocol ${status.clientProtocol ?? '?'})\n` +
        `  server: ${status.serverVersion ?? '?'} (protocol ${status.serverProtocol ?? '?'})\n` +
        '\n' +
        'The herdr server is still running the OLD binary from before an update. ' +
        'Every herdr command will fail with `protocol_mismatch` until it is restarted.\n' +
        '\n' +
        'Fix: stop the old server and start a fresh one with the new binary:\n' +
        '  herdr server stop\n' +
        '  herdr\n' +
        '\n' +
        '⚠️  Stopping the server exits running panes — save work in other panes first.',
    );
  }
};

/** Ensure the herdr headless server is running and client-compatible. */
export const ensureServer = async (): Promise<void> => {
  // Quick check first — avoid double spawn
  if (await serverRunning()) {
    // Server is up — but is it the SAME version as the installed client?
    // After a herdr update the old daemon keeps running and every API call
    // fails with protocol_mismatch. Fail fast with actionable instructions
    // instead of a cryptic failure later.
    await assertHerdrCompatible();
    return;
  }

  // Start the headless server
  const proc = spawn('herdr', ['server'], {
    stdio: 'ignore',
    env: process.env,
    // Windows: hide the server's console window — without this it appears as
    // a stray popup, and closing that window kills the server mid-run.
    windowsHide: true,
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

export const isPortReady = async (port: number, check: ReadyCheck = 'http'): Promise<boolean> => {
  if (check === 'tcp') {
    return tcpConnectReady(port);
  }
  try {
    const res = await fetch(`http://localhost:${port}/`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
};

/**
 * Raw TCP connect probe for non-HTTP services (e.g. PostgreSQL). Binds to
 * 127.0.0.1 explicitly — that is where the postgres listener is configured.
 */
const tcpConnectReady = (port: number, host = '127.0.0.1'): Promise<boolean> =>
  new Promise((resolveTcp) => {
    const socket = net.createConnection({ port, host });
    const settle = (ready: boolean): void => {
      socket.destroy();
      resolveTcp(ready);
    };
    socket.setTimeout(2000, () => settle(false));
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
  });

/**
 * Process names we're willing to kill to free a port — our own dev servers.
 * Anything else holding the port is someone else's and stays untouched.
 */
const KILLABLE_PROCESSES = ['node', 'bun', 'vite', 'uwsgi', 'python', 'firebase'];

/** True when a port holder is one of our dev servers rather than a bystander. */
export const isKillableProcess = (name: string): boolean =>
  KILLABLE_PROCESSES.some((candidate) => name.toLowerCase().includes(candidate));

/**
 * Kill any process occupying a port so the next bind succeeds deterministically.
 *
 * Identity is checked before killing: an unrelated process gets a warning and
 * is left alone. Platform differences (lsof/ps/kill vs netstat/tasklist/
 * taskkill) live in env/process_info.ts — this is the policy, not the plumbing.
 */
export const killPort = async (port: number): Promise<void> => {
  const pids = await pidsOnPort(port);

  if (pids.length === 0) {
    // No lookup tool, or genuinely nothing listening. `fuser -k` is the POSIX
    // last resort — it kills without an identity check, so it only runs when
    // we could not identify a holder at all (no-op on Windows).
    await killPortUnsafe(port);
    return;
  }

  for (const pid of pids) {
    const name = await processName(pid);
    if (name === undefined) {
      // Already exited between the lookup and now — nothing to do.
      continue;
    }
    if (!isKillableProcess(name)) {
      console.warn(
        `Port ${port} is busy with unrelated process (PID ${pid}, ${name}). Not killing.`,
      );
      continue;
    }
    await killPid(pid);
  }
};

// ── Direnv wrapper ─────────────────────────────────────────

/**
 * Shared `hasDirenv()` lives in env/direnv_detect.ts so scripts AND pi
 * extensions use the same check — it also documents the non-direnv
 * fallback contract (manual tool installs + .env.local).
 */

/** Keeps a crashed service's output on screen instead of closing the pane. */
const PANE_TRAILER = '=== Stopped. Press Enter to close ===';

/**
 * The shell a herdr pane runs — governs how a command string must be quoted
 * before `pane run` sends it to the pane's PTY.
 */
export type PaneShell = 'powershell' | 'nushell' | 'cmd' | 'posix';

/**
 * Map a pane's foreground process name to the shell kind it represents.
 * herdr launches panes with the user's configured default shell — on this
 * Windows install that is `powershell.exe` (the old "panes default to
 * Nushell" comment predates herdr 0.8.0-preview).
 */
const paneShellFromProcessName = (name: string): PaneShell => {
  const n = name.toLowerCase().replace(/\.exe$/, '');
  if (n.includes('powershell') || n.includes('pwsh')) {
    return 'powershell';
  }
  if (n === 'cmd' || n.includes('cmd')) {
    return 'cmd';
  }
  if (n === 'nu' || n === 'nushell' || n.includes('nu')) {
    return 'nushell';
  }
  return 'posix';
};

/** Detect the shell running in a herdr pane (defaults to posix on failure). */
export const detectPaneShell = async (paneId: string): Promise<PaneShell> => {
  try {
    const r = await herdrJson<PaneProcessInfo>(['pane', 'process-info', '--pane', paneId]);
    const name = r?.result?.process_info?.foreground_processes?.[0]?.name;
    return name ? paneShellFromProcessName(name) : 'posix';
  } catch {
    return 'posix';
  }
};

/**
 * Quote a value for a PowerShell single-quoted string: `'` → `''`.
 * PowerShell has no POSIX `'\''` escape; doubling is the single-quote escape.
 */
const psQuote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/**
 * Quote a value as a CMD double-quoted argument, escaping embedded `"` as
 * `\"` (cmd.exe has no literal-quote escape inside a `"…"` token; `\"` is
 * the accepted convention for native args). Used for `cmd` panes, which
 * treat POSIX single quotes as literals.
 */
const cmdQuote = (value: string): string => `"${value.replaceAll('"', '\\"')}"`;

/**
 * Write `script` to a unique temp .sh file and return its path. Used for
 * PowerShell panes, where passing `-c <script>` through PowerShell's native
 * arg mangling (embedded `"` becomes `\"` in the command line) corrupts the
 * script. A file avoids the `-c` boundary entirely: only two quoted paths
 * cross the shell.
 */
const writeTempBashScript = (script: string): string => {
  const path = join(
    tmpdir(),
    `herdr-pane-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
  );
  writeFileSync(path, script, 'utf-8');
  return path;
};

/**
 * Wraps a command for a herdr pane, in descending order of fidelity:
 *
 *   1. bash + direnv — `direnv exec .` loads the flake devShell (bun, jdk,
 *      chromium … from flake.nix) before running the command.
 *   2. bash, no direnv — on a machine without direnv (Windows without
 *      WSL+Nix, per `bun run setup`'s recommended-path check) the prefix is
 *      not a harmless no-op, it's a "command not found" that kills the pane
 *      before the real command runs. Drop it; the caller owns their PATH/env
 *      (manual tool installs, MOON_TOOLCHAIN_FORCE_GLOBALS, .env.local).
 *   3. Windows without bash — `cmd /c "… & pause"`. cmd.exe is always
 *      present, and `pause` gives the same keep-the-pane-open behavior.
 *   4. Anything else — run bare in the pane's own shell. The pane closes on
 *      exit, but the command still runs.
 *
 * `bash` is passed as an absolute path (see `findBash`) because herdr panes
 * default to the user's shell on Windows (PowerShell here), whose PATH does
 * not include Git's bash.
 *
 * PowerShell panes get `& 'bash' 'script.sh'` with the script in a temp
 * file — PowerShell rejects the POSIX `'bash' -c '…'` form (parse error at
 * `-c`) and mangles embedded `"` in native args, so a file is the only
 * reliable transport. With direnv, both the PowerShell and CMD forms route
 * through `direnv exec .` so the pane still gets the flake devShell env.
 * CMD panes invoke the temp script with double-quoted args (`cmd.exe` treats
 * single quotes as literals); the keep-open trailer is preserved in all
 * bash-backed forms.
 */
export const wrapCommand = (command: string, shell: PaneShell = 'posix'): string => {
  const bash = findBash();
  if (bash) {
    const script = `${command}; echo; echo "${PANE_TRAILER}"; read`;
    if (shell === 'powershell') {
      const scriptPath = writeTempBashScript(`#!/usr/bin/env bash\n${script}\n`);
      // With direnv, route through `direnv exec .` so the pane gets the flake
      // devShell env; the `&` call operator is only valid as the first token,
      // so it is dropped in the direnv form.
      if (hasDirenv()) {
        return `direnv exec . ${psQuote(bash)} ${psQuote(scriptPath)}`;
      }
      return `& ${psQuote(bash)} ${psQuote(scriptPath)}`;
    }
    if (shell === 'cmd') {
      // cmd.exe treats single quotes as literals, so the POSIX `-c '…'` form
      // would pass the script text as one literal arg and fail. Use the same
      // temp-script transport as PowerShell, invoked with CMD-compatible
      // double-quote escaping. direnv exec is retained for the direnv case,
      // matching the POSIX path.
      const scriptPath = writeTempBashScript(`#!/usr/bin/env bash\n${script}\n`);
      const invocation = `${cmdQuote(bash)} ${cmdQuote(scriptPath)}`;
      return hasDirenv() ? `direnv exec . ${invocation}` : invocation;
    }
    // Quoted so a Windows path like `C:\Program Files\Git\bin\bash.exe`
    // survives the pane shell's tokenizing — unquoted, the space in "Program
    // Files" would split it into two args.
    const prefix = hasDirenv() ? `direnv exec . ${posixQuote(bash)} -c` : `${posixQuote(bash)} -c`;
    return `${prefix} ${posixQuote(script)}`;
  }

  // cmd.exe has no escape for a literal `"` inside a `/c "…"` string, so only
  // take this path when the command has none (every SERVICE_DEFS command
  // does). Otherwise fall through to running it bare.
  if (process.platform === 'win32' && !command.includes('"')) {
    return `cmd /c "${command} & pause"`;
  }

  return command;
};

/** Detect the pane's shell, then wrap the command for it. */
export const wrapCommandForPane = async (paneId: string, command: string): Promise<string> =>
  wrapCommand(command, await detectPaneShell(paneId));

/**
 * Run a raw bash script in a pane, shell-aware. Same PowerShell-vs-POSIX
 * split as {@link wrapCommand}: PowerShell gets a temp script file invoked
 * via `& 'bash' 'file'` (its native-arg `"` mangling corrupts `-c`), other
 * shells get `'bash' -c '<script>'`.
 */
export const bashScriptForPane = async (paneId: string, script: string): Promise<string> => {
  const bash = findBash();
  if (!bash) {
    return script;
  }
  if ((await detectPaneShell(paneId)) === 'powershell') {
    const scriptPath = writeTempBashScript(`#!/usr/bin/env bash\n${script}\n`);
    return `& ${psQuote(bash)} ${psQuote(scriptPath)}`;
  }
  return `${posixQuote(bash)} -c ${posixQuote(script)}`;
};

/**
 * Shell process names that indicate an idle pane with no active command.
 * Includes the Windows set (herdr panes default to Nushell there, and
 * pwsh/cmd are the other two a developer may have configured) — without
 * them, an idle Windows pane reads as "busy" forever and the caller waits
 * out its full timeout instead of sending the command.
 */
export const SHELL_NAMES = new Set([
  'fish',
  'bash',
  'zsh',
  'sh',
  'dash',
  // Windows — matched case-insensitively against the process name, with any
  // `.exe` suffix stripped by `isIdleShellName`.
  'nu',
  'pwsh',
  'powershell',
  'cmd',
]);

/** True when a pane's foreground process name is just an idle shell. */
export const isIdleShellName = (name: string): boolean =>
  SHELL_NAMES.has(name.toLowerCase().replace(/\.exe$/, ''));

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
  readyCheck: ReadyCheck = 'http',
): Promise<'crashed' | 'booting' | 'healthy'> => {
  const r = await herdrJson<PaneProcessInfo>(['pane', 'process-info', '--pane', paneId]);
  const procs = r?.result?.process_info?.foreground_processes;

  // process-info unavailable — fall back to the port only, never restart on missing data
  if (!procs) {
    if (port !== undefined && (await isPortReady(port, readyCheck))) {
      return 'healthy';
    }
    return 'booting';
  }

  const real = procs.filter((p) => !isIdleShellName(p.name));
  if (real.length === 0) {
    // Only shells left → the wrapped command already exited (crash / stopped)
    return 'crashed';
  }

  if (port !== undefined && !(await isPortReady(port, readyCheck))) {
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
    forcePorts = false,
    join = false,
    wait = true,
    waitTimeoutMs = 120_000,
    projectRoot = process.cwd(),
  } = config;
  const workspaceLabel = resolveSessionName(mode);
  const offset = contractPortOffset(currentContractId());

  if (services.length === 0) {
    throw new Error(`No services specified. Use: ${KNOWN_SERVICES.join(', ')}, all`);
  }

  // C-392 AC-7: refuse mutually exclusive engine pairs (text/text-ollama,
  // image/image-comfyui) before any tab is created.
  assertNoPortConflicts(services, mode, offset);

  await ensureServer();

  const existingWsId = await findWorkspace(workspaceLabel);

  // C-392 AC-7: when a workspace already exists (and is not being
  // force-recreated), its running tabs own the engine ports too. Reusing a
  // workspace that runs e.g. image-comfyui must refuse `herdr:start image`
  // with the same clear message as starting both together, not a confusing
  // bind error.
  if (existingWsId && !force) {
    const existingTabNames = await getWorkspaceTabNames(existingWsId);
    assertNoRunningServiceConflicts(services, existingTabNames, mode, offset);
  }

  // ── Force-ports: kill whatever's squatting on our target ports first ──
  // Distinct from `force` (which recreates the whole workspace) — this only
  // clears the ports, so it's safe to use even when the workspace/tabs
  // already exist and are healthy. killPort() only kills known dev-tool
  // process names (node/bun/vite/uwsgi/python/firebase), never unrelated ones.
  if (forcePorts) {
    await Promise.all(
      services.map(async (s) => {
        const port = resolveReadyPort(s, mode, offset);
        if (port !== undefined) {
          await killPort(port);
        }
      }),
    );
  }

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
    await herdr([
      'pane',
      'run',
      rootPaneId,
      await wrapCommandForPane(rootPaneId, buildServiceCommand(first, mode, offset)),
    ]);
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
        await herdr([
          'pane',
          'run',
          tabR.result.root_pane.pane_id,
          await wrapCommandForPane(
            tabR.result.root_pane.pane_id,
            buildServiceCommand(service, mode, offset),
          ),
        ]);
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
          const port = resolveReadyPort(service, mode, offset);
          if (servicePane) {
            const state = await assessServicePane(servicePane.pane_id, port, svc.readyCheck);
            if (state === 'crashed') {
              console.log(`  ↻ Tab: ${svc.name} crashed, restarting...`);
              await herdr([
                'pane',
                'run',
                servicePane.pane_id,
                await wrapCommandForPane(
                  servicePane.pane_id,
                  buildServiceCommand(service, mode, offset),
                ),
              ]);
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
        await herdr([
          'pane',
          'run',
          tabR.result.root_pane.pane_id,
          await wrapCommandForPane(
            tabR.result.root_pane.pane_id,
            buildServiceCommand(service, mode, offset),
          ),
        ]);
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
      const port = resolveReadyPort(service, mode, offset);
      if (
        (await assessServicePane(pane.pane_id, port, SERVICE_DEFS[service].readyCheck)) ===
        'crashed'
      ) {
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
  const offset = contractPortOffset(currentContractId());

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
  // isn't defeated by orphaned Vite/uwsgi processes from prior runs. Uses
  // this workspace's own offset — never touches another contract's ports.
  for (const service of services) {
    const port = resolveReadyPort(service, mode, offset);
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
    // Derive the offset from THIS workspace's own label — listServices
    // inspects every aikami workspace, not just the current process's own
    // contract, so it must never assume `currentContractId()`.
    const wsOffset = contractPortOffset(contractIdFromSessionName(ws.label));

    const tabs = await getWorkspaceTabs(ws.workspace_id);
    const tabIdByName = new Map(tabs.map((t) => [t.label, t.tab_id]));
    const panes = await getWorkspacePanes(ws.workspace_id);
    const paneByTab = new Map(panes.map((p) => [p.tab_id, p]));

    const servicesStatus: ServiceStatus[] = KNOWN_SERVICES.map((svc) => {
      const def = SERVICE_DEFS[svc];
      const running = tabIdByName.has(def.name);
      return {
        service: svc,
        name: def.name,
        running,
        readyPort: resolveReadyPort(svc, wsMode, wsOffset),
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
          const port = resolveReadyPort(s.service, wsMode, wsOffset);
          s.state = await assessServicePane(pane.pane_id, port, def.readyCheck);
          if (port !== undefined) {
            s.portOpen = await isPortReady(port, def.readyCheck);
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
  const offset = contractPortOffset(currentContractId());

  const wsId = await findWorkspace(workspaceLabel);
  if (!wsId) {
    console.warn(`⚠ Workspace ${workspaceLabel} not found, skipping readiness check`);
    return [];
  }

  console.log('  Waiting for services...');
  const failed: string[] = [];

  await Promise.all(
    services.map(async (serviceKey) => {
      const svc = SERVICE_DEFS[serviceKey];
      const port = resolveReadyPort(serviceKey, mode, offset);
      const deadline = Date.now() + timeoutMs;

      // Services with no HTTP port (tauri, preview-*) can't be probed via
      // isPortReady — verify the pane itself is still running instead of
      // marking them ready unconditionally. When the wrapped command exits
      // (e.g. run_tauri.ts quits because no binary exists), the pane is left
      // with only shells and assessServicePane reports 'crashed'.
      if (port === undefined) {
        const tabId = await findTab(wsId, svc.name);
        const panes = await getWorkspacePanes(wsId);
        const pane = tabId ? panes.find((p) => p.tab_id === tabId) : undefined;
        if (!pane) {
          console.error(`  ✗ ${svc.name} pane not found`);
          failed.push(svc.name);
          return;
        }
        while (Date.now() < deadline) {
          const state = await assessServicePane(pane.pane_id);
          if (state !== 'crashed') {
            console.log(`  ✓ ${svc.name} running (no port check)`);
            return;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
        console.error(`  ✗ ${svc.name} exited (no port check)`);
        failed.push(svc.name);
        return;
      }

      while (Date.now() < deadline) {
        if (await isPortReady(port, svc.readyCheck)) {
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
