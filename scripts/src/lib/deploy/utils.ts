// scripts/src/lib/deploy/utils.ts
/**
 * Shared utilities for the deploy pipeline — local and CI.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { c, error, log } from '../cli_utils';
import {
  type AppConfig,
  CLOUD_FUNCTIONS_REGION,
  liveModes,
  MODE_PROJECT_MAP,
} from './deployment_config';

// ── Constants ────────────────────────────────────────────────────────────

/** Default region (staging). Use resolveRegion() for mode-aware resolution. */
export const GCP_REGION = CLOUD_FUNCTIONS_REGION;
export const REGISTRY = `${GCP_REGION}-docker.pkg.dev`;

/** Resolve the GCP region based on deployment mode and optional per-app override. */
export function resolveRegion(_mode: string, configOverride?: string): string {
  if (configOverride) {
    return configOverride;
  }
  return GCP_REGION;
}

// ── Shell ────────────────────────────────────────────────────────────────

let _verbose = false;
let _quiet = false;
const _dockerAuthenticated = new Set<string>();

/** Enable verbose shell output for subsequent run()/runArgs() calls. */
export function setVerbose(v: boolean): void {
  _verbose = v;
}

/** Whether verbose shell output is enabled. */
export function isVerbose(): boolean {
  return _verbose;
}

/** Suppress non-essential output for subsequent run()/runArgs() calls. */
export function setQuiet(v: boolean): void {
  _quiet = v;
}

/** Whether quiet mode is enabled. */
export function isQuiet(): boolean {
  return _quiet;
}

/**
 * Run a shell command and return its trimmed stdout.
 *
 * verbose or live → inherit stdio (direct terminal output, streams in CI);
 * quiet → pipe and suppress everything; default → pipe and show a command
 * prefix. Throws when the command fails unless quiet.
 */
export function run(
  cmd: string,
  opts: { cwd?: string; quiet?: boolean; env?: Record<string, string>; live?: boolean } = {},
): string {
  // verbose or live → inherit (direct terminal output, raw, streams in CI)
  // quiet   → pipe, suppress everything (no prefix, no output)
  // default → pipe, show only the command prefix
  const stdio: 'pipe' | 'inherit' = opts.live || (_verbose && !opts.quiet) ? 'inherit' : 'pipe';
  const suppressPrefix = _quiet || opts.quiet === true;
  try {
    if (!suppressPrefix && !_verbose) {
      log(`${c.dim}> ${cmd}${c.reset}`);
    }
    const result = execSync(cmd, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      encoding: 'utf-8',
      stdio,
      maxBuffer: 100 * 1024 * 1024, // 100MB — client build produces ~29k file listings
    });
    return result?.trim() || '';
  } catch (e) {
    if (opts.quiet || _quiet) {
      return '';
    }
    error(`Command failed: ${cmd}`);
    throw e;
  }
}

/**
 * Runs a command from an argument array WITHOUT a shell.
 *
 * Use this for commands whose arguments may contain untrusted values
 * (e.g. service-account emails read from .env files) — argument arrays
 * cannot be shell-interpreted, so no quoting/escaping is needed and no
 * injection is possible.
 *
 * Uses Bun.spawnSync (not node:child_process's spawnSync) because it
 * correctly resolves Windows .cmd/.bat shims (e.g. gcloud.cmd) via PATHEXT
 * without a shell; Node's spawnSync only finds true executables in that mode
 * and fails with ENOENT for shims like gcloud on Windows.
 *
 * When we pass a custom env object, Bun's executable resolution looks up
 * the key `PATH` case-sensitively — but cmd.exe/PowerShell populate the
 * variable as `Path`, so an explicit env silently breaks lookup on Windows
 * (this doesn't affect the default env, which Bun captures natively and
 * resolves case-insensitively). Normalize the key when building one.
 */
export function runArgs(
  cmd: string[],
  opts: { cwd?: string; quiet?: boolean; env?: Record<string, string>; live?: boolean } = {},
): string {
  const stdio: 'pipe' | 'inherit' = opts.live || (_verbose && !opts.quiet) ? 'inherit' : 'pipe';
  const suppressPrefix = _quiet || opts.quiet === true;
  try {
    if (!suppressPrefix && !_verbose) {
      log(`${c.dim}> ${cmd.join(' ')}${c.reset}`);
    }
    let env: Record<string, string | undefined> | undefined;
    if (opts.env) {
      env = { ...process.env, ...opts.env };
      if (!('PATH' in env)) {
        const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
        if (pathKey) {
          env.PATH = env[pathKey];
        }
      }
    }
    const result = Bun.spawnSync(cmd, {
      cwd: opts.cwd,
      ...(env ? { env } : {}),
      stdout: stdio,
      stderr: stdio,
    });
    const stdout = result.stdout instanceof Buffer ? result.stdout.toString('utf-8') : '';
    const stderr = result.stderr instanceof Buffer ? result.stderr.toString('utf-8') : '';
    if (!result.success && !(opts.quiet || _quiet)) {
      error(`Command failed: ${cmd.join(' ')}`);
      throw new Error(stderr.trim() || `exit code ${result.exitCode}`);
    }
    return stdout.trim();
  } catch (e) {
    if (opts.quiet || _quiet) {
      return '';
    }
    throw e;
  }
}

// ── Git ──────────────────────────────────────────────────────────────────

/** Return the current git branch name (defaults to 'dev' on failure). */
export function getCurrentBranch(): string {
  const branch = run('git rev-parse --abbrev-ref HEAD', { quiet: true });
  return branch || 'dev';
}

/**
 * Short git SHA of HEAD, suffixed with a dirty-tree hash when the working
 * tree has uncommitted changes (ensures unique Docker tags).
 */
export function shortSha(length = 8): string {
  const sha = run(`git rev-parse --short=${length} HEAD`, { quiet: true });
  // Append dirty suffix when working tree has uncommitted changes.
  // This ensures Docker tags are unique even when deploying from a dirty tree.
  const dirtyHash = dirtyTreeHash();
  if (!dirtyHash) {
    return sha;
  }
  return `${sha}-d${dirtyHash.slice(0, 8)}`;
}

/** Version string used to tag images: the short SHA plus dirty suffix. */
export function versionSha(): string {
  return shortSha();
}

/** Returns true if the working tree has uncommitted changes. */
export function isTreeDirty(): boolean {
  const status = run('git status --porcelain', { quiet: true });
  return status.length > 0;
}

/** Returns a hash of the working tree diff (including staged changes). Empty string if clean. */
export function dirtyTreeHash(): string {
  if (!isTreeDirty()) {
    return '';
  }
  return run("(git diff HEAD && git diff --cached) | sha256sum | cut -d' ' -f1", { quiet: true });
}

// ── GCP / Deploy ─────────────────────────────────────────────────────────

/** Resolve the GCP project id for a deployment mode. */
export function resolveProjectId(mode: string): string {
  return MODE_PROJECT_MAP[mode as keyof typeof MODE_PROJECT_MAP] || MODE_PROJECT_MAP.staging;
}

/**
 * Fully-qualified Artifact Registry image tag for an app config:
 * {region}-docker.pkg.dev/{projectId}/aikami/{shortName}:{tag}.
 */
export function dockerImageTag(
  config: AppConfig,
  projectId: string,
  sha?: string,
  mode: string = liveModes[0],
): string {
  const imageName = `aikami/${config.shortName}`;
  const tag = sha ?? shortSha();
  const region = resolveRegion(mode, config.region);
  return `${region}-docker.pkg.dev/${projectId}/${imageName}:${tag}`;
}

/** GCP Artifact Registry auth — authenticates the Docker registry.
 *  Idempotent per region: only configures a region once per process.
 *  @param region Region of the Artifact Registry to configure; defaults to the global region. */
export function authenticateDocker(region: string = GCP_REGION): void {
  if (_dockerAuthenticated.has(region)) {
    return;
  }
  _dockerAuthenticated.add(region);
  run(`gcloud auth configure-docker ${region}-docker.pkg.dev --quiet`, { quiet: true });
}

/**
 * Ensures gcloud is authenticated — user credentials first, then fall back
 * to the mode's service-account key (.secrets/gcp_sa_key.{mode}.json) so
 * deploys and log queries work in CI and for agents/pi without an
 * interactive `gcloud auth login`.
 *
 * Exits the process when neither credential source is available or the
 * service-account activation fails.
 *
 * @param mode      Deployment mode ('staging' | 'production') — selects the SA key file.
 * @param projectId GCP project id — passed to activate-service-account.
 * @param rootDir   Repo root — `.secrets/` lives at its top level.
 */
export function ensureGcloudAuth(mode: string, projectId: string, rootDir: string): void {
  const authCheck = run('gcloud auth print-access-token', { quiet: true });
  if (authCheck) {
    return;
  }
  const saKeyPath = resolve(rootDir, `.secrets/gcp_sa_key.${mode}.json`);
  if (!existsSync(saKeyPath)) {
    error('Not authenticated with gcloud and no service-account fallback found.');
    error('  Run: gcloud auth login');
    error(`  Or place a key at: ${saKeyPath}`);
    process.exit(1);
  }
  log(
    `${c.yellow}No gcloud user credentials — activating service account from ${saKeyPath}${c.reset}`,
  );
  run(`gcloud auth activate-service-account --key-file="${saKeyPath}" --project=${projectId}`, {
    quiet: true,
  });
  const retry = run('gcloud auth print-access-token', { quiet: true });
  if (!retry) {
    error(`Service account activation failed (${saKeyPath}). Run: gcloud auth login`);
    process.exit(1);
  }
}

// ── Env File ─────────────────────────────────────────────────────────────

/**
 * Parses an .env.example (or .env file) into key-value pairs.
 * Comments and empty lines are skipped.
 */
export function parseEnvKeys(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    return {};
  }
  const content = readFileSync(filePath, 'utf-8');
  const vars: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key) {
      vars[key] = value.replace(/^['"]|['"]$/g, '');
    }
  }
  return vars;
}

/**
 * Discover secret keys from the .env.example of a project.
 * Skips PUBLIC_ prefixed keys (SvelteKit build-time only),
 * FIREBASE_SERVICE_ACCOUNT, and empty/non-existent keys.
 */
export function discoverSecretKeys(appPath: string): string[] {
  const envPath = join(appPath, '.env.example');
  if (!existsSync(envPath)) {
    return [];
  }
  const vars = parseEnvKeys(envPath);
  const blacklist = new Set(['FIREBASE_SERVICE_ACCOUNT']);
  return Object.keys(vars).filter((key) => {
    if (key.startsWith('PUBLIC_')) {
      return false;
    }
    if (blacklist.has(key)) {
      return false;
    }
    return true;
  });
}
