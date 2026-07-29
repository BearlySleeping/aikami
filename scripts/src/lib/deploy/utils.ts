// scripts/src/lib/deploy/utils.ts
/**
 * Shared utilities for the deploy pipeline — local and CI.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { c, error, log } from '../cli_utils';
import {
  type AppConfig,
  CLOUD_FUNCTIONS_REGION,
  liveModes,
  MODE_PROJECT_MAP,
  resolveCloudRunServiceId,
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
let _dockerAuthenticated = false;

export function setVerbose(v: boolean): void {
  _verbose = v;
}

export function isVerbose(): boolean {
  return _verbose;
}

export function setQuiet(v: boolean): void {
  _quiet = v;
}

export function isQuiet(): boolean {
  return _quiet;
}

export function run(cmd: string, opts: { cwd?: string; quiet?: boolean } = {}): string {
  // verbose → inherit (direct terminal output, raw)
  // quiet   → pipe, suppress everything (no prefix, no output)
  // default → pipe, show only the command prefix
  const stdio: 'pipe' | 'inherit' = _verbose ? 'inherit' : 'pipe';
  const suppressPrefix = _quiet || opts.quiet === true;
  try {
    if (!suppressPrefix && !_verbose) {
      log(`${c.dim}> ${cmd}${c.reset}`);
    }
    const result = execSync(cmd, {
      cwd: opts.cwd,
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

// ── Git ──────────────────────────────────────────────────────────────────

export function getCurrentBranch(): string {
  const branch = run('git rev-parse --abbrev-ref HEAD', { quiet: true });
  return branch || 'dev';
}

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

export function resolveProjectId(mode: string): string {
  return MODE_PROJECT_MAP[mode as keyof typeof MODE_PROJECT_MAP] || MODE_PROJECT_MAP.staging;
}

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

export function resolveCloudRunServiceName(config: AppConfig, appName: string): string {
  return resolveCloudRunServiceId(appName as never) || `aikami-${config.shortName}`;
}

/** GCP Artifact Registry auth — authenticates the Docker registry.
 *  Idempotent: only runs the first time it's called per process. */
export function authenticateDocker(): void {
  if (_dockerAuthenticated) {
    return;
  }
  _dockerAuthenticated = true;
  run(`gcloud auth configure-docker ${GCP_REGION}-docker.pkg.dev --quiet`, { quiet: true });
}

/**
 * Build common Cloud Run deploy args.
 * Returns the complete `gcloud run deploy ...` command string.
 */
export function buildGcloudRunArgs(
  config: AppConfig,
  serviceId: string,
  tag: string,
  projectId: string,
  mode: string,
  extraEnvVars = '',
  secretArgs = '',
): string {
  const region = resolveRegion(mode, config.region);
  const memory = config.memory ?? '1Gi';
  const args = [
    'gcloud',
    'run',
    'deploy',
    serviceId,
    '--image',
    tag,
    '--platform',
    'managed',
    '--memory',
    memory,
    '--timeout',
    '300',
    '--region',
    region,
    '--allow-unauthenticated',
    '--project',
    projectId,
  ];

  // CPU allocation
  if (config.cpu) {
    args.push('--cpu', config.cpu);
  } else {
    args.push('--cpu-boost');
  }

  // VPC connector for Cloud SQL access
  if (config.vpcConnector) {
    args.push('--vpc-connector', config.vpcConnector);
  } else {
    args.push('--clear-vpc-connector');
  }

  // Cloud SQL Auth Proxy (Unix socket)
  if (config.cloudSqlInstance) {
    args.push('--add-cloudsql-instances', config.cloudSqlInstance);
  }

  args.push('--set-env-vars', `NODE_ENV=production,HOST=0.0.0.0${extraEnvVars}`);

  if (secretArgs) {
    args.push(secretArgs);
  }

  return args.join(' ');
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
