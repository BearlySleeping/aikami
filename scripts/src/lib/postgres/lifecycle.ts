// scripts/src/lib/postgres/lifecycle.ts
// C-387: local PostgreSQL dev environment lifecycle.
//
// Provides init / start / stop / reset / psql / status for a real PostgreSQL
// (pinned to major 17 via flake.nix) whose data lives under the repo-local,
// gitignored .postgres/ directory. No Docker, no system service, no sudo —
// the server runs as the invoking OS user and binds to 127.0.0.1 only.
//
//   bun postgres:init     # initdb + create the aikami_dev database (idempotent)
//   bun postgres:start    # start in the background (idempotent)
//   bun postgres:stop     # stop (idempotent)
//   bun postgres:reset    # delete data + re-init (requires --yes)
//   bun postgres:psql     # interactive psql against the local server
//   bun postgres:status   # server state + connection details
//
// `start --foreground` is the herdr pane entry point: it keeps the pane alive
// as the server's live log (teed to the log file as well).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
// Relative import — scripts resolve shared constants directly (same pattern as
// scripts/src/lib/herdr/session.ts) so the single port allocation stays
// authoritative for both the herdr service and the lifecycle.
import { PORTS } from '../../../../packages/shared/constants/src/index';

// ── Configuration ──────────────────────────────────────────
// Mirrors the State section of contract C-387:
//   Data directory:  .postgres/data/
//   Socket dir:      .postgres/run/    (avoids /tmp collisions between projects)
//   Database name:   aikami_dev
//   Connection URL:  postgresql://localhost:5433/aikami_dev?sslmode=disable
// Port 5432 is deliberately left free for a developer's system Postgres.

export const POSTGRES_PORT: number = PORTS.emulator.postgres;
export const POSTGRES_DATABASE = 'aikami_dev';
export const POSTGRES_CONNECTION_URL = `postgresql://localhost:${POSTGRES_PORT}/${POSTGRES_DATABASE}?sslmode=disable`;

/** Repo root, resolved from this file's location (scripts/src/lib/postgres/). */
export const repoRoot = (): string => resolve(import.meta.dir, '../../../..');

/** Data directory (gitignored; survives stop/start, destroyed only by reset). */
export const dataDir = (root: string = repoRoot()): string => resolve(root, '.postgres/data');

/** Unix socket directory — repo-local so concurrent projects never collide. */
export const runDir = (root: string = repoRoot()): string => resolve(root, '.postgres/run');

/** Server log file inside the data tree; tailed by the herdr pane when needed. */
export const logFile = (root: string = repoRoot()): string =>
  resolve(root, '.postgres/log/postgres.log');

/**
 * Server CLI options. The listener is bound to 127.0.0.1 ONLY — never
 * 0.0.0.0 — which is what makes trust auth acceptable: the socket and the
 * TCP listener are both loopback-scoped (contract C-387 security directive).
 */
export const serverOptions = (root: string = repoRoot()): string =>
  `-p ${POSTGRES_PORT} -h 127.0.0.1 -k ${runDir(root)}`;

// ── State helpers ──────────────────────────────────────────

/** True once initdb has produced a PG_VERSION marker. */
export const isInitialized = (root: string = repoRoot()): boolean =>
  existsSync(resolve(dataDir(root), 'PG_VERSION'));

/** Create the .postgres tree (data, socket, log) — pg_ctl does not mkdir parents for -l. */
export const ensureDirs = (root: string = repoRoot()): void => {
  mkdirSync(dataDir(root), { recursive: true });
  mkdirSync(runDir(root), { recursive: true });
  mkdirSync(dirname(logFile(root)), { recursive: true });
};

/** PID from postmaster.pid, or undefined when absent/unparseable. */
export const postmasterPid = (root: string = repoRoot()): number | undefined => {
  const pidPath = resolve(dataDir(root), 'postmaster.pid');
  if (!existsSync(pidPath)) {
    return undefined;
  }
  const firstLine = readFileSync(pidPath, 'utf8').split('\n')[0]?.trim() ?? '';
  const pid = Number.parseInt(firstLine, 10);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
};

/** True when the pid responds to signal 0 (i.e. the process exists). */
export const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Remove a stale postmaster.pid whose process is gone (unclean shutdown),
 * so a later start doesn't fail with an opaque "lock file already exists".
 * Returns true when a stale file was cleared.
 */
export const clearStalePid = (root: string = repoRoot()): boolean => {
  const pid = postmasterPid(root);
  if (pid === undefined || isProcessAlive(pid)) {
    return false;
  }
  rmSync(resolve(dataDir(root), 'postmaster.pid'), { force: true });
  return true;
};

/** Server liveness, detected via pg_ctl status against the data directory (never port probing). */
export const isRunning = (root: string = repoRoot()): boolean => {
  if (!isInitialized(root)) {
    return false;
  }
  const res = spawnSync('pg_ctl', ['-D', dataDir(root), 'status'], { encoding: 'utf8' });
  return res.status === 0;
};

// ── Tooling ────────────────────────────────────────────────

const runTool = (
  tool: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } => {
  const res = spawnSync(tool, args, { encoding: 'utf8' });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
};

const requireTool = (tool: string): boolean => {
  if (Bun.which(tool) !== undefined) {
    return true;
  }
  console.error(
    `❌ "${tool}" not found on PATH. Enter the Nix devShell first (nix develop / direnv allow) — flake.nix pins postgresql_17.`,
  );
  return false;
};

const requireTools = (tools: string[]): boolean => tools.every(requireTool);

/** Print the tail of the server log on failure (observability requirement). */
const printLogTail = (root: string, lines: number = 20): void => {
  const log = logFile(root);
  if (!existsSync(log)) {
    console.error('  (no log file yet)');
    return;
  }
  console.error(`── tail of ${log} ──`);
  const content = readFileSync(log, 'utf8').trim().split('\n');
  for (const line of content.slice(-lines)) {
    console.error(line);
  }
};

// ── Subcommands ────────────────────────────────────────────

/**
 * init: initdb + create the aikami_dev database. Idempotent — a no-op when
 * the data directory is already initialised. Leaves the server stopped.
 */
export const cmdInit = (root: string = repoRoot()): number => {
  if (isInitialized(root)) {
    console.log(`postgres data already initialised at ${dataDir(root)} — nothing to do`);
    return 0;
  }
  if (!requireTools(['initdb', 'pg_ctl', 'psql', 'createdb'])) {
    return 1;
  }
  ensureDirs(root);

  // Deterministic locale so text ordering matches managed-provider defaults.
  const initRes = runTool('initdb', [
    '-D',
    dataDir(root),
    '--encoding=UTF8',
    '--locale=C',
    // Trust auth is loopback-only (see serverOptions) — acceptable locally.
    '--auth=trust',
  ]);
  if (initRes.status !== 0) {
    console.error(initRes.stderr.trim());
    return initRes.status ?? 1;
  }
  console.log(`✓ initialised data directory at ${dataDir(root)}`);

  // initdb only creates postgres/template* — start briefly to create the
  // contract database, then stop again (init leaves the server stopped).
  const startRes = runTool('pg_ctl', [
    '-D',
    dataDir(root),
    '-l',
    logFile(root),
    '-o',
    serverOptions(root),
    'start',
    '-w',
  ]);
  if (startRes.status !== 0) {
    printLogTail(root);
    return startRes.status ?? 1;
  }

  const dbExists = runTool('psql', [
    '-h',
    '127.0.0.1',
    '-p',
    String(POSTGRES_PORT),
    '-d',
    'postgres',
    '-tAc',
    `SELECT 1 FROM pg_database WHERE datname = '${POSTGRES_DATABASE}'`,
  ]);
  if (dbExists.stdout.trim() !== '1') {
    const createRes = runTool('createdb', [
      '-h',
      '127.0.0.1',
      '-p',
      String(POSTGRES_PORT),
      POSTGRES_DATABASE,
    ]);
    if (createRes.status !== 0) {
      console.error(createRes.stderr.trim());
      runTool('pg_ctl', ['-D', dataDir(root), 'stop', '-m', 'fast', '-w']);
      return createRes.status ?? 1;
    }
    console.log(`✓ created database "${POSTGRES_DATABASE}"`);
  }

  const stopRes = runTool('pg_ctl', ['-D', dataDir(root), 'stop', '-m', 'fast', '-w']);
  if (stopRes.status !== 0) {
    console.error(stopRes.stderr.trim());
    return stopRes.status ?? 1;
  }
  console.log(`✓ postgres initialised and stopped. Start it with: bun postgres:start`);
  return 0;
};

/**
 * start: daemonised server start (pg_ctl). Idempotent — no-op when already
 * running. Auto-initialises on a fresh checkout so `bun herdr:start postgres`
 * works with zero setup.
 */
export const cmdStart = (root: string = repoRoot()): number => {
  if (!isInitialized(root)) {
    const initCode = cmdInit(root);
    if (initCode !== 0) {
      return initCode;
    }
  }
  if (!requireTools(['pg_ctl'])) {
    return 1;
  }
  ensureDirs(root);
  if (isRunning(root)) {
    console.log(`postgres already running on 127.0.0.1:${POSTGRES_PORT} (data: ${dataDir(root)})`);
    return 0;
  }
  if (clearStalePid(root)) {
    console.log('⚠ cleared stale postmaster.pid (previous unclean shutdown)');
  }
  const res = runTool('pg_ctl', [
    '-D',
    dataDir(root),
    '-l',
    logFile(root),
    '-o',
    serverOptions(root),
    'start',
    '-w',
  ]);
  if (res.status !== 0) {
    printLogTail(root);
    return res.status ?? 1;
  }
  console.log(`✓ postgres running on 127.0.0.1:${POSTGRES_PORT} — ${POSTGRES_CONNECTION_URL}`);
  return 0;
};

/**
 * start --foreground: herdr pane entry point. Runs the server in the
 * foreground (pane stays alive as the live log) or tails the log file when a
 * daemonised instance is already running.
 */
export const cmdStartForeground = (root: string = repoRoot()): number => {
  if (!isInitialized(root)) {
    const initCode = cmdInit(root);
    if (initCode !== 0) {
      return initCode;
    }
  }
  if (!requireTools(['postgres', 'tail'])) {
    return 1;
  }
  ensureDirs(root);
  if (isRunning(root)) {
    console.log(`postgres already running on 127.0.0.1:${POSTGRES_PORT} — tailing log file`);
    spawnSync('tail', ['-F', logFile(root)], { stdio: 'inherit' });
    return 0;
  }
  if (clearStalePid(root)) {
    console.log('⚠ cleared stale postmaster.pid (previous unclean shutdown)');
  }
  console.log(`Starting postgres on 127.0.0.1:${POSTGRES_PORT} (data: ${dataDir(root)})...`);
  // postgres → stderr → tee: written to the log file AND the pane.
  // Closing the pane (bun herdr:stop postgres) kills postgres with a clean
  // fast shutdown.
  const res = spawnSync(
    'bash',
    [
      '-c',
      `postgres -D '${dataDir(root)}' -p ${POSTGRES_PORT} -h 127.0.0.1 -k '${runDir(root)}' 2>&1 | tee -a '${logFile(root)}'`,
    ],
    { stdio: 'inherit' },
  );
  return res.status ?? 1;
};

/** stop: idempotent — succeeds (exit 0) even when already stopped. */
export const cmdStop = (root: string = repoRoot()): number => {
  if (!isInitialized(root) || !isRunning(root)) {
    console.log('postgres not running — nothing to stop');
    return 0;
  }
  const res = runTool('pg_ctl', ['-D', dataDir(root), 'stop', '-m', 'fast', '-w']);
  if (res.status !== 0) {
    printLogTail(root);
    return res.status ?? 1;
  }
  console.log('✓ postgres stopped (data preserved in .postgres/data)');
  return 0;
};

/**
 * reset: delete the data directory, re-initialise, leave the server stopped.
 * Destructive — requires an explicit confirmation flag.
 */
export const cmdReset = (options: { yes: boolean; root?: string }): number => {
  const root = options.root ?? repoRoot();
  if (!options.yes) {
    console.error(
      '❌ reset deletes ALL local postgres data. Pass --yes to confirm: bun postgres:reset --yes',
    );
    return 1;
  }
  if (isRunning(root)) {
    cmdStop(root);
  }
  rmSync(resolve(root, '.postgres'), { recursive: true, force: true });
  console.log('✓ removed .postgres/');
  return cmdInit(root);
};

/** psql: interactive/scripted shell against the local server. */
export const cmdPsql = (args: string[], root: string = repoRoot()): number => {
  if (!isRunning(root)) {
    console.error(
      '❌ postgres is not running. Start it first: bun postgres:start (or bun herdr:start postgres)',
    );
    return 1;
  }
  const res = spawnSync('psql', [POSTGRES_CONNECTION_URL, ...args], { stdio: 'inherit' });
  return res.status ?? 1;
};

/** status: server state + connection details. Exit 0 when running, 1 when not. */
export const cmdStatus = (root: string = repoRoot()): number => {
  if (!isInitialized(root)) {
    console.log('postgres: not initialised (no .postgres/data — run: bun postgres:init)');
    return 1;
  }
  const res = runTool('pg_ctl', ['-D', dataDir(root), 'status']);
  const message = `${res.stdout.trim()}\n${res.stderr.trim()}`.trim();
  if (message.length > 0) {
    console.log(message);
  }
  console.log(`  data dir:     ${dataDir(root)}`);
  console.log(`  socket dir:   ${runDir(root)}`);
  console.log(`  log file:     ${logFile(root)}`);
  console.log(`  connection:   ${POSTGRES_CONNECTION_URL}`);
  return res.status ?? 1;
};

// ── CLI ────────────────────────────────────────────────────

const printUsage = (): void => {
  console.log(`Local PostgreSQL dev server (C-387) — pinned to PostgreSQL 17 via Nix

Usage:
  bun postgres:init      Initialise the data directory + create aikami_dev (idempotent)
  bun postgres:start     Start the server in the background (idempotent)
  bun postgres:stop      Stop the server (idempotent)
  bun postgres:reset     Delete .postgres/ and re-initialise (requires --yes)
  bun postgres:psql      Interactive psql against the local server
  bun postgres:status    Show server state and connection details

Connection: ${POSTGRES_CONNECTION_URL}`);
};

export const main = (argv: string[]): number => {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case 'init':
      return cmdInit();
    case 'start':
      if (rest.includes('--foreground')) {
        return cmdStartForeground();
      }
      return cmdStart();
    case 'stop':
      return cmdStop();
    case 'reset':
      return cmdReset({ yes: rest.includes('--yes') || rest.includes('-y') });
    case 'psql':
      return cmdPsql(rest);
    case 'status':
      return cmdStatus();
    case '--help':
    case '-h':
    case undefined:
      printUsage();
      return 0;
    default:
      console.error(`Unknown command: "${subcommand}"`);
      printUsage();
      return 1;
  }
};

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
