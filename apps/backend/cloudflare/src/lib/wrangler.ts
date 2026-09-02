// apps/backend/cloudflare/src/lib/wrangler.ts
//
// C-455: Shared "spawn `bunx wrangler`, write a throwaway mode-scoped config,
// enforce the production guard" helper. Every D1 subcommand and the worker
// deploy path calls into this module instead of copy-pasting the same steps.

import { type ExecSyncOptions, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { D1DatabaseEntry } from '@aikami/constants';
import { D1_DATABASES } from '@aikami/constants';

/** Mode and locality resolved for a guarded Wrangler command. */
export type WranglerModeGuard = {
  /** Deployment mode selected for the command. */
  mode: string;
  /** Whether Wrangler must operate exclusively on local state. */
  isLocal: boolean;
};

/**
 * Refuses any non-local destructive command run without an explicit --mode.
 * Every --local path additionally refuses to run when CLOUDFLARE_API_TOKEN
 * is set (from d1_seed_local.ts's existing guard).
 *
 * Logic:
 * - `--local` → local mode (emulator)
 * - `--remote` → requires `--mode staging|production`
 * - Neither `--local` nor `--remote` → defaults to `--local` (emulator)
 * - `--mode` without `--remote` → still defaults to local (must explicitly say --remote)
 */
export const resolveModeGuard = (args: string[]): WranglerModeGuard => {
  const hasLocal = args.includes('--local');
  const hasRemote = args.includes('--remote');
  const isLocal = hasLocal || !hasRemote;

  if (isLocal) {
    checkLocalMode();
    return { mode: 'emulator', isLocal: true };
  }

  // hasRemote is true here
  const modeIdx = args.indexOf('--mode');
  const mode = modeIdx !== -1 ? args[modeIdx + 1] : undefined;
  if (mode !== 'staging' && mode !== 'production') {
    throw new Error('refusing: --mode staging|production is required for a non-local run.');
  }
  return { mode, isLocal: false };
};

/**
 * 🔴 Guard: refuse to run against non-local state.
 * If CLOUDFLARE_API_TOKEN is set, wrangler might reach remote D1.
 */
export const checkLocalMode = (): void => {
  if (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_API_TOKEN.length > 0) {
    process.exit(1);
  }
};

/** Confirm production operation with the user (interactive TTY). */
export const confirmProduction = async (): Promise<boolean> => {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('\n⚠️  This targets PRODUCTION. Continue? (y/N) ');
  rl.close();
  const normalized = answer.trim().toLowerCase();
  return normalized === 'y' || normalized === 'yes';
};

/** Options for writing a mode-scoped temporary D1 configuration. */
export type WriteConfigOptions = {
  /** Deployment mode represented by the temporary config. */
  mode: string;
  /** Whether the consuming Wrangler command targets local state. */
  isLocal: boolean;
  /** Working directory containing the hub Worker configuration. */
  dbDir: string;
  /** D1 binding to place in the temporary config. */
  dbBinding: D1DatabaseEntry;
  /** Absolute directory containing D1 migration files. */
  migrationsDir: string;
};

/**
 * Write a throwaway wrangler.jsonc with the mode-correct D1 database entry.
 * Returns the path to the temporary config file.
 */
export const writeThrowawayD1Config = (options: WriteConfigOptions): string => {
  const { mode, dbBinding, migrationsDir } = options;
  const tmpDir = mkdtempSync(join(tmpdir(), 'aikami-d1-'));
  const tmpConfigPath = join(tmpDir, 'wrangler.jsonc');
  writeFileSync(
    tmpConfigPath,
    JSON.stringify({
      name: `aikami-${mode}-ops`, // never deployed — wrangler just wants a name
      // biome-ignore lint/style/useNamingConvention: wrangler.jsonc uses snake_case
      compatibility_date: '2026-08-21',
      // biome-ignore lint/style/useNamingConvention: wrangler.jsonc uses snake_case
      d1_databases: [
        {
          binding: dbBinding.binding,
          // biome-ignore lint/style/useNamingConvention: wrangler.jsonc uses snake_case
          database_name: dbBinding.databaseName,
          // biome-ignore lint/style/useNamingConvention: wrangler.jsonc uses snake_case
          database_id: dbBinding.databaseId,
          // biome-ignore lint/style/useNamingConvention: wrangler.jsonc uses snake_case
          migrations_dir: migrationsDir,
        },
      ],
    }),
  );
  return tmpConfigPath;
};

/** Options for a bounded Wrangler subprocess invocation. */
export type RunWranglerOptions = {
  /** Wrangler arguments, excluding the executable name. */
  args: string[];
  /** Working directory for the Wrangler process. */
  cwd: string;
  /** Maximum process duration in milliseconds. */
  timeout?: number;
  /** Standard I/O configuration passed to the subprocess. */
  stdio?: ExecSyncOptions['stdio'];
};

/**
 * Run `bunx wrangler` with the given arguments.
 */
export const runWrangler = (options: RunWranglerOptions): Buffer => {
  const { args, cwd, timeout = 120_000, stdio = ['ignore', 'pipe', 'pipe'] } = options;
  try {
    return execFileSync('bunx', ['wrangler', ...args], {
      cwd,
      stdio,
      timeout,
    });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
    const stdout = (error as { stdout?: Buffer }).stdout?.toString().trim();
    throw new Error(stderr || stdout || (error as Error).message);
  }
};

/** Options for resolving a declared D1 binding. */
export type ResolveD1BindingOptions = {
  /** Deployment mode whose binding should be resolved. */
  mode: string;
  /** Declared database key; defaults to the hub database. */
  dbKey?: keyof typeof D1_DATABASES;
};

/** Resolve a D1 binding for the given mode from @aikami/constants. */
export const resolveD1Binding = (
  options: ResolveD1BindingOptions,
): D1DatabaseEntry | undefined => {
  const { mode, dbKey = 'hub' } = options;
  const db = D1_DATABASES[dbKey];
  const entry = db[mode as keyof typeof db];
  if (!entry) {
    return undefined;
  }
  return entry as D1DatabaseEntry;
};

/**
 * Get the hub directory path (needed as cwd for wrangler operations).
 * When called from apps/backend/cloudflare/src/lib/, import.meta.dir is that dir.
 * Root is 4 levels up.
 */
// From apps/backend/cloudflare/src/lib/, root is 5 levels up
const ROOT = resolve(import.meta.dir, '../../../../..');

/**
 * Get the hub directory path (needed as cwd for wrangler operations).
 */
export const getHubDir = (): string => resolve(ROOT, 'apps/frontend/hub');

/**
 * Get the migrations directory path.
 */
export const getMigrationsDir = (): string => resolve(ROOT, 'packages/backend/database/drizzle-d1');
