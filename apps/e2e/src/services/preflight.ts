// apps/e2e/src/services/preflight.ts
//
// Per-run E2E server orchestration, run from Playwright globalSetup.
//
// A linked worktree is a first-class E2E owner: it receives a durable port
// offset, starts its own servers on those ports, and never asks a shared
// Herdr workspace to lend it a tab. A listener is reusable only after its
// service/checkout identity has been proven. This distinction matters because
// every Vite dev server answers HTTP on its port, including one belonging to a
// different checkout.

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  pidsOnPort,
  processCwd,
  processStartTimeMs,
} from '../../../../scripts/src/lib/env/process_info.ts';
import {
  type ProcessInspector,
  readInstanceRecords,
  recordInstance,
  type ValidatedProcessIdentity,
  verifyOwnership,
} from '../../../../scripts/src/lib/herdr/instance_registry.ts';
import { E2E_PORT_OFFSET } from '../config';
import { canonicalizeCheckout } from './port_allocation';
import { stopSpawnedServers, trackSpawned } from './server_registry';
import {
  FALLBACK_BUILD_ENV,
  resolveRequiredServices,
  SERVICE_DEFS,
  type ServiceDef,
  type ServiceId,
} from './service_map';

const PROBE_TIMEOUT_MS = 2000;
const POLL_INTERVAL_MS = 1000;
const runSequence = { value: 0 };

export type ListenerIdentityProbeOptions = {
  url: string;
  serviceId: ServiceId;
  expectedService: string;
  checkout: string;
  runId?: string;
};

export type ListenerOwnershipProbeOptions = {
  port: number;
  service: string;
  checkout: string;
  expectedCwd?: string;
  /** Parent PID of the detached process group started by this preflight. */
  trustedParentPid?: number;
};

export type ListenerOwnershipProbeResult =
  | {
      proven: true;
      /** The exact identity established by this probe, carried forward unchanged. */
      identity: ValidatedProcessIdentity;
      /** True when a durable record already proved the listener. */
      existingRecord: boolean;
    }
  | {
      proven: false;
    };

export type ListenerOwnershipRecordOptions = {
  port: number;
  service: string;
  checkout: string;
  identity: ValidatedProcessIdentity;
  runId?: string;
};

/** Injectable process, filesystem, and identity boundary for preflight tests. */
export type PreflightIo = {
  /** HTTP liveness only; it never establishes ownership by itself. */
  probe(url: string): Promise<boolean>;
  /** Proves that the listener is this checkout's expected service. */
  probeIdentity(options: ListenerIdentityProbeOptions): Promise<boolean>;
  /** Capability-aware fallback for preview/Worker listeners without an endpoint. */
  probeListener?(options: ListenerOwnershipProbeOptions): Promise<ListenerOwnershipProbeResult>;
  /** Persists the exact process identity established by a trusted probe. */
  recordListener?(options: ListenerOwnershipRecordOptions): Promise<void>;
  runSync(
    command: string,
    args: string[],
    options: { cwd: string; env?: Record<string, string> },
  ): { status: number | null; stdout: string; stderr: string };
  spawnDetached(
    command: string,
    args: string[],
    options: { cwd: string; env: Record<string, string>; logFile: string },
  ): number;
  /** A linked Herdr/Git worktree (its `.git` is a file, not a directory). */
  linkedWorktree(top: string): boolean;
  gitTopLevel(): string | undefined;
  env(key: string): string | undefined;
  now(): number;
  sleep(ms: number): Promise<void>;
  log(line: string): void;
  /** Cleanup seam; defaults to the process registry. */
  stopSpawnedServers(options: { runId: string }): void;
};

type DevIdentity = {
  service?: string;
  checkout?: string;
  runId?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readDevIdentity = async (url: string): Promise<DevIdentity | undefined> => {
  try {
    const response = await fetch(new URL('/.aikami/identity', url), {
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return undefined;
    }
    const value = (await response.json()) as unknown;
    if (!isRecord(value)) {
      return undefined;
    }
    return {
      service: typeof value.service === 'string' ? value.service : undefined,
      checkout: typeof value.checkout === 'string' ? value.checkout : undefined,
      runId: typeof value.runId === 'string' ? value.runId : undefined,
    };
  } catch {
    return undefined;
  }
};

const sameCheckout = (left: string, right: string): boolean =>
  canonicalizeCheckout(left) === canonicalizeCheckout(right);

const isWithinCheckout = (cwd: string, checkout: string): boolean => {
  const path = relative(checkout, cwd);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
};

const processInspector: ProcessInspector = {
  startTimeMs: (pid) => processStartTimeMs(pid),
  cwd: (pid) => processCwd(pid),
};

const processGroupId = (pid: number): number | undefined => {
  if (process.platform === 'win32') {
    return undefined;
  }
  const result = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });
  if (result.status !== 0) {
    return undefined;
  }
  const group = Number(result.stdout.trim());
  return Number.isInteger(group) && group > 0 ? group : undefined;
};

const isTrustedSpawnedListener = async (options: {
  parentPid: number;
  listenerPid: number;
  expectedCwd: string;
}): Promise<boolean> => {
  const parentGroup = processGroupId(options.parentPid);
  const listenerGroup = processGroupId(options.listenerPid);
  if (
    parentGroup === undefined ||
    parentGroup !== options.parentPid ||
    listenerGroup !== parentGroup
  ) {
    return false;
  }
  const cwd = await processCwd(options.listenerPid);
  return cwd !== undefined && isWithinCheckout(cwd, options.expectedCwd);
};

/**
 * Prove a listener that cannot expose the Vite identity endpoint. A durable
 * ownership record is preferred. A listener without one is accepted only when
 * it belongs to the process group spawned by this preflight and its cwd is
 * inside the expected service directory. Unknown PIDs, missing process tools,
 * and foreign cwd values fail closed.
 */
const probeListenerOwnership = async (
  options: ListenerOwnershipProbeOptions,
): Promise<ListenerOwnershipProbeResult> => {
  const pids = await pidsOnPort(options.port);
  if (pids.length === 0) {
    return { proven: false };
  }

  const records = readInstanceRecords();
  for (const pid of pids) {
    const verdict = await verifyOwnership({
      pid,
      expected: { service: options.service, checkout: options.checkout },
      records,
      inspector: processInspector,
    });
    if (verdict.owned && verdict.record.port === options.port) {
      return {
        proven: true,
        identity: verdict.identity,
        existingRecord: true,
      };
    }

    // A record-less listener is never trusted from cwd alone. It must belong
    // to the process group this preflight spawned, and its cwd must be inside
    // the service directory we asked that process to serve. Both facts are
    // required; an omitted cwd fails closed.
    if (options.trustedParentPid === undefined || options.expectedCwd === undefined) {
      continue;
    }
    const trusted = await isTrustedSpawnedListener({
      parentPid: options.trustedParentPid,
      listenerPid: pid,
      expectedCwd: options.expectedCwd,
    });
    if (!trusted) {
      continue;
    }
    const pidStartTimeMs = await processStartTimeMs(pid);
    if (pidStartTimeMs === undefined) {
      continue;
    }
    return {
      proven: true,
      identity: { pid, pidStartTimeMs },
      existingRecord: false,
    };
  }
  return { proven: false };
};

const recordListenerOwnership = async (options: ListenerOwnershipRecordOptions): Promise<void> => {
  recordInstance({
    record: {
      service: options.service,
      scope: 'run',
      checkout: options.checkout,
      pid: options.identity.pid,
      pidStartTimeMs: options.identity.pidStartTimeMs,
      port: options.port,
      startedAt: new Date().toISOString(),
      ...(options.runId === undefined ? {} : { runId: options.runId }),
    },
  });
};

type ListenerIdentityProof = {
  proven: boolean;
  listener?: ListenerOwnershipProbeResult;
};

const proveListenerIdentity = async (
  io: PreflightIo,
  options: ListenerIdentityProbeOptions,
  ownership?: ListenerOwnershipProbeOptions,
): Promise<ListenerIdentityProof> => {
  // Ownership-capable services deliberately never fall through to the Vite
  // identity endpoint. Preview and Wrangler do not expose that route, and a
  // failed endpoint request must not be treated as evidence either way.
  if (ownership) {
    try {
      const listener = await (io.probeListener ?? probeListenerOwnership)(ownership);
      return { proven: listener.proven, listener };
    } catch {
      return { proven: false };
    }
  }
  try {
    return { proven: await io.probeIdentity(options) };
  } catch {
    return { proven: false };
  }
};

const probeServiceReadiness = async (
  io: PreflightIo,
  options: {
    endpoint: ListenerIdentityProbeOptions;
    ownership?: ListenerOwnershipProbeOptions;
  },
): Promise<{ reachable: boolean; proof: ListenerIdentityProof }> => {
  const reachable = await io.probe(options.endpoint.url);
  if (!reachable) {
    return { reachable: false, proof: { proven: false } };
  }
  return {
    reachable: true,
    proof: await proveListenerIdentity(io, options.endpoint, options.ownership),
  };
};

const recordListenerProof = async (
  io: PreflightIo,
  options: {
    def: ServiceDef;
    repoRoot: string;
    proof: ListenerIdentityProof;
    runId: string;
  },
): Promise<void> => {
  if (!options.proof.proven || !options.proof.listener?.proven) {
    return;
  }
  if (options.proof.listener.existingRecord || !io.recordListener) {
    return;
  }
  try {
    // Persist the identity returned by the validation verbatim. Re-reading a
    // PID here would reopen the PID-reuse window the probe just closed.
    await io.recordListener({
      port: options.def.port,
      service: options.def.ownershipService ?? options.def.id,
      checkout: options.repoRoot,
      identity: options.proof.listener.identity,
      runId: options.runId,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    io.log(`  ⚠️ Could not persist ownership for ${options.def.label}: ${detail}`);
  }
};

const defaultIo = (): PreflightIo => ({
  probe: async (url) => {
    try {
      await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      // HTTP liveness is intentionally separate from identity below.
      return true;
    } catch {
      return false;
    }
  },
  probeIdentity: async (options) => {
    const identity = await readDevIdentity(options.url);
    if (!identity?.service || !identity.checkout) {
      return false;
    }
    if (identity.service !== options.expectedService) {
      return false;
    }
    if (!sameCheckout(identity.checkout, options.checkout)) {
      return false;
    }
    return options.runId === undefined || identity.runId === options.runId;
  },
  probeListener: probeListenerOwnership,
  recordListener: recordListenerOwnership,
  runSync: (command, args, options) => {
    const result = spawnSync(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      encoding: 'utf8',
    });
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  },
  spawnDetached: (command, args, options) => {
    mkdirSync(dirname(options.logFile), { recursive: true });
    const log = openSync(options.logFile, 'a');
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      detached: true,
      stdio: ['ignore', log, log],
    });
    child.unref();
    return child.pid ?? 0;
  },
  linkedWorktree: (top) => {
    try {
      return statSync(join(top, '.git')).isFile();
    } catch {
      return false;
    }
  },
  gitTopLevel: () => {
    const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const top = (result.stdout ?? '').trim();
    return result.status === 0 && top ? top : undefined;
  },
  env: (key) => process.env[key],
  now: () => Date.now(),
  sleep: (ms) => new Promise((settle) => setTimeout(settle, ms)),
  log: (line) => console.log(line),
  stopSpawnedServers,
});

const reposRoot = (io: PreflightIo): string => {
  const top = io.gitTopLevel();
  if (!top) {
    throw new Error(
      'E2E preflight: cannot locate the repo root (`git rev-parse --show-toplevel` failed).',
    );
  }
  return top;
};

const tail = (text: string, lines = 8): string => {
  const parts = text.trimEnd().split('\n');
  return parts.slice(-lines).join('\n');
};

const describeSyncFailure = (
  command: string,
  args: string[],
  result: {
    status: number | null;
    stdout: string;
    stderr: string;
  },
): string =>
  `\`${command} ${args.join(' ')}\` exited with code ${result.status}\n` +
  `${result.stderr.trim() || result.stdout.trim() || '(no output)'}\n` +
  `${tail(result.stdout)}`;

/**
 * Env-seed gate for a raw linked worktree. The root checkout has its normal
 * env files and must not be sent through worktree bootstrap.
 */
const ensureEnvSeeds = (io: PreflightIo, repoRoot: string): void => {
  if (!io.linkedWorktree(repoRoot)) {
    return;
  }
  const result = io.runSync(
    'bun',
    [
      'run',
      'worktree:bootstrap',
      '--',
      '--cwd',
      repoRoot,
      '--no-install',
      '--no-seed',
      '--no-content',
    ],
    { cwd: repoRoot },
  );
  if (result.status !== 0) {
    throw new Error(
      `E2E preflight: this checkout is missing required env seed files.\n` +
        `${tail(result.stderr) || tail(result.stdout)}\n` +
        `🔧 Fix: run \`bun run worktree:bootstrap\` in the root checkout, then retry.`,
    );
  }
};

/** Run the build tasks for every artifact the non-Herdr fallback serves. */
const ensureBuildArtifacts = (io: PreflightIo, repoRoot: string, defs: ServiceDef[]): void => {
  const builtOutput = defs.filter((def) => def.servesBuild && def.artifactPath);
  if (builtOutput.length === 0) {
    return;
  }
  const tasks = [...new Set(builtOutput.flatMap((def) => def.buildTasks))];
  if (tasks.length === 0) {
    throw new Error(
      `E2E preflight: no build tasks are defined for ` +
        `${builtOutput.map((def) => def.label).join(', ')}.`,
    );
  }
  io.log(`  🔨 Preparing build artifacts: ${tasks.join(', ')}`);
  const result = io.runSync('bun', ['moon', 'run', ...tasks], {
    cwd: repoRoot,
    env: {
      ...FALLBACK_BUILD_ENV,
      PUBLIC_EMULATOR_PORT_OFFSET: String(E2E_PORT_OFFSET),
    },
  });
  if (result.status !== 0) {
    throw new Error(
      `E2E preflight: moon build failed (${tasks.join(', ')}) — ` +
        `${describeSyncFailure('bun moon run', tasks, result)}\n` +
        `🔧 Fix: run \`bun moon run ${tasks.join(' ')}\` and resolve the build error.`,
    );
  }
};

const startViaHerdr = (io: PreflightIo, repoRoot: string, defs: ServiceDef[]): void => {
  const names = defs.map((def) => def.herdrService).filter((name): name is string => Boolean(name));
  if (names.length === 0) {
    return;
  }
  io.log(`  🐇 herdr: starting ${names.join(', ')}`);
  const result = io.runSync('bun', ['run', 'herdr:start', names.join(',')], { cwd: repoRoot });
  if (result.status !== 0) {
    throw new Error(
      `E2E preflight: herdr failed to start ${names.join(', ')}.\n` +
        `${tail(result.stderr) || tail(result.stdout)}\n` +
        `🔧 Fix: check \`herdr status\`, or start the tabs manually with ` +
        `\`bun run herdr:start ${names.join(',')}\`, then retry.`,
    );
  }
};

const startDetachedServers = (
  io: PreflightIo,
  repoRoot: string,
  defs: ServiceDef[],
  logDir: string,
  runId: string,
  serverRunId: string,
): Map<ServiceId, number> => {
  const spawned = new Map<ServiceId, number>();
  const offset = String(E2E_PORT_OFFSET);
  for (const def of defs) {
    const logFile = join(logDir, `${def.id}.log`);
    const serveCommand = [def.serve.command, ...def.serve.args].join(' ');
    io.log(`  ▶️  ${def.label} on :${def.port} (\`${serveCommand}\` in ${def.serve.cwd})`);
    const pid = io.spawnDetached(def.serve.command, def.serve.args, {
      cwd: join(repoRoot, def.serve.cwd),
      env: {
        ...def.serve.env,
        // The server reads this at startup for its backend/emulator URLs. Do
        // not rely on the parent shell inheriting an unset value.
        PUBLIC_EMULATOR_PORT_OFFSET: offset,
        // Make the dev identity endpoint independent of the captain's ambient
        // contract variables. This is especially important for a linked
        // worktree launched from a root-checkout Pi process.
        CONTRACT_PIPELINE_WORKSPACE_PATH: repoRoot,
        CONTRACT_PIPELINE_RUN_ID: serverRunId,
      },
      logFile,
    });
    if (!trackSpawned({ label: def.label, pid, logFile, runId })) {
      throw new Error(
        `E2E preflight: ${def.label} did not return a usable PID; refusing to treat an untracked listener as ours.`,
      );
    }
    spawned.set(def.id, pid);
  }
  return spawned;
};

const ownershipProbeOptions = (options: {
  def: ServiceDef;
  repoRoot: string;
  trustedPids: ReadonlyMap<ServiceId, number>;
}): ListenerOwnershipProbeOptions | undefined => {
  if (options.def.listenerIdentity !== 'ownership') {
    return undefined;
  }
  const trustedParentPid = options.trustedPids.get(options.def.id);
  return {
    port: options.def.port,
    service: options.def.ownershipService ?? options.def.id,
    checkout: options.repoRoot,
    expectedCwd: join(options.repoRoot, options.def.serve.cwd),
    ...(trustedParentPid === undefined ? {} : { trustedParentPid }),
  };
};

const probeDefinitionReadiness = async (
  io: PreflightIo,
  options: {
    def: ServiceDef;
    repoRoot: string;
    identityRunId: string | undefined;
    trustedPids: ReadonlyMap<ServiceId, number>;
  },
): Promise<{ reachable: boolean; proof: ListenerIdentityProof }> => {
  const ownership = ownershipProbeOptions(options);
  return probeServiceReadiness(io, {
    endpoint: {
      url: options.def.baseUrl,
      serviceId: options.def.id,
      expectedService: options.def.identityService ?? options.def.id,
      checkout: options.repoRoot,
      ...(options.identityRunId === undefined ? {} : { runId: options.identityRunId }),
    },
    ...(ownership === undefined ? {} : { ownership }),
  });
};

const recordReadyDefinition = async (
  io: PreflightIo,
  options: {
    def: ServiceDef;
    repoRoot: string;
    proof: ListenerIdentityProof;
    runId: string;
    pending: Set<ServiceDef>;
  },
): Promise<void> => {
  await recordListenerProof(io, options);
  options.pending.delete(options.def);
  io.log(`  ✅ ${options.def.label} ready → ${options.def.baseUrl}`);
};

const throwReadinessTimeout = (def: ServiceDef): never => {
  const started = `serve: \`${[def.serve.command, ...def.serve.args].join(' ')}\` in ${def.serve.cwd}`;
  throw new Error(
    `E2E preflight: timed out waiting for ${def.label} at ${def.baseUrl}.\n` +
      `🔧 Fix: ${started}, then inspect the log at test-results/preflight/${def.id}.log`,
  );
};

const waitUntilReady = async (
  io: PreflightIo,
  repoRoot: string,
  defs: ServiceDef[],
  overrideTimeoutMs: number | undefined,
  identityRunIds: ReadonlyMap<ServiceId, string | undefined>,
  trustedPids: ReadonlyMap<ServiceId, number>,
  cleanupRunId: string,
): Promise<void> => {
  const startedAt = io.now();
  const deadline = new Map<ServiceDef, number>(
    defs.map((def) => [def, startedAt + (overrideTimeoutMs ?? def.readyTimeoutMs)]),
  );
  const pending = new Set(defs);

  while (pending.size > 0) {
    for (const def of [...pending]) {
      const readiness = await probeDefinitionReadiness(io, {
        def,
        repoRoot,
        identityRunId: identityRunIds.get(def.id),
        trustedPids,
      });
      if (readiness.reachable && readiness.proof.proven) {
        await recordReadyDefinition(io, {
          def,
          repoRoot,
          proof: readiness.proof,
          runId: cleanupRunId,
          pending,
        });
        continue;
      }
      const deadlineAt = deadline.get(def);
      if (deadlineAt === undefined || io.now() <= deadlineAt) {
        continue;
      }
      throwReadinessTimeout(def);
    }
    if (pending.size > 0) {
      await io.sleep(POLL_INTERVAL_MS);
    }
  }
};

const rejectForeignListeners = (options: {
  readiness: readonly { def: ServiceDef; reachable: boolean; proven: boolean }[];
  repoRoot: string;
}): void => {
  const foreign = options.readiness.filter((entry) => entry.reachable && !entry.proven);
  if (foreign.length === 0) {
    return;
  }
  const details = foreign
    .map(
      (entry) =>
        `${entry.def.label} at ${entry.def.baseUrl} (service identity or checkout did not match ${options.repoRoot})`,
    )
    .join('\n');
  throw new Error(
    `E2E preflight: refusing to reuse a foreign listener.\n${details}\n` +
      'The listener was left untouched; stop it yourself or choose a different checkout offset.',
  );
};

// ── Entry point ──────────────────────────────────────────────

export type PreflightResult = { reused: ServiceId[]; started: ServiceId[] };

/**
 * Ensure every server the requested projects need is up before a test runs.
 * Throws with an actionable message on any failure.
 */
export const runPreflight = async (options: {
  /** Names from `--project`; undefined/empty = run all projects. */
  requestedProjects?: readonly string[];
  readyTimeoutMs?: number;
  io?: PreflightIo;
  /** Directory for spawned-server logs (testable override). */
  logDir?: string;
  /** Stable id used to scope failure cleanup to this invocation. */
  runId?: string;
}): Promise<PreflightResult> => {
  const io = options.io ?? defaultIo();
  const serviceIds = resolveRequiredServices(options.requestedProjects);
  const allDefs = serviceIds.map((id) => SERVICE_DEFS[id]);

  if (allDefs.length === 0) {
    io.log('✅ E2E preflight: no app servers required for this selection.');
    return { reused: [], started: [] };
  }

  const repoRoot = reposRoot(io);
  const linked = io.linkedWorktree(repoRoot);
  const runId = options.runId ?? `e2e-${process.pid}-${runSequence.value++}`;
  const ambientRunId = io.env('CONTRACT_PIPELINE_RUN_ID');
  // A detached child must carry a deterministic identity into the Vite
  // endpoint. A Herdr-started tab may predate this invocation, so it keeps the
  // ambient run id (if any) and is not forced to claim this run's id.
  const serverRunId = ambientRunId ?? runId;
  const noTrustedPids = new Map<ServiceId, number>();
  const readiness = await Promise.all(
    allDefs.map(async (def) => {
      const serviceReadiness = await probeDefinitionReadiness(io, {
        def,
        repoRoot,
        identityRunId: ambientRunId,
        trustedPids: noTrustedPids,
      });
      return {
        def,
        reachable: serviceReadiness.reachable,
        proven: serviceReadiness.proof.proven,
        proof: serviceReadiness.proof,
      };
    }),
  );

  rejectForeignListeners({ readiness, repoRoot });

  const reusedEntries = readiness.filter((entry) => entry.proven);
  const reused = reusedEntries.map((entry) => entry.def);
  for (const entry of reusedEntries) {
    await recordListenerProof(io, {
      def: entry.def,
      repoRoot,
      proof: entry.proof,
      runId,
    });
  }
  const todo = readiness.filter((entry) => !entry.reachable).map((entry) => entry.def);

  io.log(
    `🚦 E2E preflight: ${reused.length} server(s) already verified, ` +
      `${todo.length} to prepare — [${serviceIds.join(', ')}]`,
  );
  for (const def of reused) {
    io.log(`  ✅ ${def.label} verified for this checkout (reused) → ${def.baseUrl}`);
  }

  const logDir = options.logDir ?? resolve(join(repoRoot, 'apps/e2e/test-results/preflight'));

  if (todo.length === 0) {
    return { reused: reused.map((def) => def.id), started: [] };
  }

  try {
    ensureEnvSeeds(io, repoRoot);

    // A linked worktree is self-managing even when Herdr is installed. Calling
    // herdr:start here would attach this checkout to a shared workspace and
    // could leave a foreign tab serving the allocated port.
    const hasHerdr = linked
      ? false
      : io.runSync('herdr', ['--version'], { cwd: repoRoot }).status === 0;
    const started: ServiceDef[] = [];
    let trustedPids = new Map<ServiceId, number>();

    if (linked) {
      ensureBuildArtifacts(io, repoRoot, todo);
      trustedPids = startDetachedServers(io, repoRoot, todo, logDir, runId, serverRunId);
      started.push(...todo);
    } else if (hasHerdr) {
      startViaHerdr(
        io,
        repoRoot,
        todo.filter((def) => def.herdrService),
      );
      const selfManaged = todo.filter((def) => !def.herdrService);
      trustedPids = startDetachedServers(io, repoRoot, selfManaged, logDir, runId, serverRunId);
      started.push(...todo);
    } else {
      ensureBuildArtifacts(io, repoRoot, todo);
      trustedPids = startDetachedServers(io, repoRoot, todo, logDir, runId, serverRunId);
      started.push(...todo);
    }

    const identityRunIds = new Map<ServiceId, string | undefined>(
      todo.map((def) => [def.id, trustedPids.has(def.id) ? serverRunId : ambientRunId]),
    );
    await waitUntilReady(
      io,
      repoRoot,
      todo,
      options.readyTimeoutMs,
      identityRunIds,
      trustedPids,
      runId,
    );
    return { reused: reused.map((def) => def.id), started: started.map((def) => def.id) };
  } catch (error) {
    // Only PIDs registered by this invocation are eligible for cleanup. A
    // Herdr tab, a reused listener, and a foreign process are never in this set.
    try {
      io.stopSpawnedServers({ runId });
    } catch {
      // Preserve the startup/readiness failure if a best-effort cleanup seam
      // itself fails.
    }
    throw error;
  }
};
