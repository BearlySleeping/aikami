// apps/e2e/src/services/preflight.ts
//
// Per-run E2E server orchestration, run from Playwright globalSetup.
//
// Why globalSetup: Playwright starts `webServer` entries BEFORE globalSetup,
// so a webServer-based approach can never react to a preflight decision
// (never mind a build). Orchestrating here instead means every entry point —
// `bun run test`, `test:client`, `test:game`, moon `e2e:test:*`, CI — gets the
// exact same lifecycle, and Playwright's generic "webServer was not able to
// start" can never be the only failure signal again.
//
// Per requested `--project` selection (see service_map.ts):
//   1. Probe each service's URL — reuse anything already listening
//      (typically the herdr dev tabs).
//   2. Fail fast with an actionable message when required env seeds are
//      missing (e.g. site/.env.emulator in a fresh worktree), pointing at
//      `bun run worktree:bootstrap`.
//   3. Start the rest — preferring herdr (`bun run herdr:start <services>`,
//      the same dev tabs an agent keeps running). Without herdr fall back to
//      exactly the CI recipe (pr-checks.yml): build the artifacts through
//      moon, then serve the built output with detached processes whose life
//      ends in global_teardown via server_registry.ts.
//   4. Poll until every started service is reachable, or fail naming the
//      service, its URL, its log file and the command to run it by hand.

// 🔴 Node runtime: Playwright loads this tree with its own Node ESM loader
// (not Bun), so only node: APIs belong in the default io.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { trackSpawned } from './server_registry';
import {
  FALLBACK_BUILD_ENV,
  resolveRequiredServices,
  SERVICE_DEFS,
  type ServiceDef,
  type ServiceId,
} from './service_map';

const PROBE_TIMEOUT_MS = 2000;
const POLL_INTERVAL_MS = 1000;

// Injectable process/env boundary — preflight tests replace the whole thing.
export type PreflightIo = {
  probe(url: string): Promise<boolean>;
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
  /** A linked herdr/git worktree (its .git is a file, not a directory). */
  linkedWorktree(top: string): boolean;
  gitTopLevel(): string | undefined;
  env(key: string): string | undefined;
  now(): number;
  sleep(ms: number): Promise<void>;
  log(line: string): void;
};

const defaultIo = (): PreflightIo => ({
  probe: async (url) => {
    try {
      await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      // Any HTTP response at all means something is serving this port.
      return true;
    } catch {
      return false;
    }
  },
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
  linkedWorktree: (top) => statSync(join(top, '.git')).isFile(),
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
});

// ── Steps ────────────────────────────────────────────────────

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
 * Env-seed gate: a checkout missing the gitignored env files (a raw herdr
 * worktree) boots servers in the wrong mode or fails validation mid-build.
 * Check-only bootstrap run — it never mutates, it just reports what's missing.
 *
 * 🔴 Only linked worktrees are checked: bootstrapWorktree refuses root-mode
 * runs entirely (checkoutPath == repoRoot), and in the root checkout every
 * seed trivially exists — `missingWorktreeSeeds` is a worktree-vs-root diff.
 */
const ensureEnvSeeds = (io: PreflightIo, repoRoot: string): void => {
  if (!io.linkedWorktree(repoRoot)) {
    return;
  }
  const result = io.runSync(
    'bun',
    ['run', 'worktree:bootstrap', '--', '--cwd', repoRoot, '--no-install', '--no-seed'],
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

/** Run the build tasks for every artifact the non-herdr fallback serves. */
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
    env: FALLBACK_BUILD_ENV,
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
): void => {
  for (const def of defs) {
    const logFile = join(logDir, `${def.id}.log`);
    const serveCommand = [def.serve.command, ...def.serve.args].join(' ');
    io.log(`  ▶️  ${def.label} on :${def.port} (\`${serveCommand}\` in ${def.serve.cwd})`);
    const pid = io.spawnDetached(def.serve.command, def.serve.args, {
      cwd: join(repoRoot, def.serve.cwd),
      env: def.serve.env,
      logFile,
    });
    trackSpawned({ label: def.label, pid, logFile });
  }
};

const waitUntilReady = async (
  io: PreflightIo,
  defs: ServiceDef[],
  overrideTimeoutMs: number | undefined,
): Promise<void> => {
  const startedAt = io.now();
  const deadline = new Map<ServiceDef, number>(
    defs.map((def) => [def, startedAt + (overrideTimeoutMs ?? def.readyTimeoutMs)]),
  );
  const pending = new Set(defs);

  while (pending.size > 0) {
    for (const def of [...pending]) {
      const deadlineAt = deadline.get(def);
      if (await io.probe(def.baseUrl)) {
        pending.delete(def);
        io.log(`  ✅ ${def.label} ready → ${def.baseUrl}`);
      } else if (deadlineAt !== undefined && io.now() > deadlineAt) {
        pending.delete(def);
        const started = [
          def.herdrService
            ? `start tabs: \`bun run herdr:start ${def.herdrService}\``
            : `serve: \`${[def.serve.command, ...def.serve.args].join(' ')}\` in ${def.serve.cwd}`,
        ].join(' | ');
        throw new Error(
          `E2E preflight: timed out waiting for ${def.label} at ${def.baseUrl}.\n` +
            `🔧 Fix: ${started}, then inspect the log at test-results/preflight/${def.id}.log`,
        );
      }
    }
    if (pending.size > 0) {
      await io.sleep(POLL_INTERVAL_MS);
    }
  }
};

// ── Entry point ──────────────────────────────────────────────

export type PreflightResult = { reused: ServiceId[]; started: ServiceId[] };

/**
 * Ensure every server the requested projects need is up before a test runs.
 * Throws with an actionable message on any failure — this runs inside
 * Playwright's globalSetup, so an exception aborts the run cleanly.
 */
export const runPreflight = async (options: {
  /** Names from `--project`; undefined/empty = run all projects. */
  requestedProjects?: readonly string[];
  readyTimeoutMs?: number;
  io?: PreflightIo;
  /** Directory for spawned-server logs (testable override). */
  logDir?: string;
}): Promise<PreflightResult> => {
  const io = options.io ?? defaultIo();
  const serviceIds = resolveRequiredServices(options.requestedProjects);
  const allDefs = serviceIds.map((id) => SERVICE_DEFS[id]);

  if (allDefs.length === 0) {
    io.log('✅ E2E preflight: no app servers required for this selection.');
    return { reused: [], started: [] };
  }

  // Probe up front, in parallel.
  const readiness = await Promise.all(
    allDefs.map(async (def) => ({ def, ready: await io.probe(def.baseUrl) })),
  );
  const reused = readiness.filter((entry) => entry.ready).map((entry) => entry.def);
  const todo = readiness.filter((entry) => !entry.ready).map((entry) => entry.def);

  io.log(
    `🚦 E2E preflight: ${reused.length} server(s) already up, ` +
      `${todo.length} to prepare — [${serviceIds.join(', ')}]`,
  );
  for (const def of reused) {
    io.log(`  ✅ ${def.label} ready (reused) → ${def.baseUrl}`);
  }

  const repoRoot = reposRoot(io);
  const logDir = options.logDir ?? resolve(join(repoRoot, 'apps/e2e/test-results/preflight'));

  if (todo.length === 0) {
    return { reused: reused.map((def) => def.id), started: [] };
  }

  ensureEnvSeeds(io, repoRoot);

  const hasHerdr = io.runSync('herdr', ['--version'], { cwd: repoRoot }).status === 0;

  const started: ServiceDef[] = [];
  if (hasHerdr) {
    // herdr path: dev servers with the right mode/env, outliving the run.
    startViaHerdr(
      io,
      repoRoot,
      todo.filter((def) => def.herdrService),
    );
    // client-llm has no herdr service — self-managed even with herdr present.
    const selfManaged = todo.filter((def) => !def.herdrService);
    startDetachedServers(io, repoRoot, selfManaged, logDir);
    started.push(...todo);
  } else {
    ensureBuildArtifacts(io, repoRoot, todo);
    startDetachedServers(io, repoRoot, todo, logDir);
    started.push(...todo);
  }

  await waitUntilReady(io, todo, options.readyTimeoutMs);

  return { reused: reused.map((def) => def.id), started: started.map((def) => def.id) };
};
