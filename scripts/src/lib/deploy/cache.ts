// scripts/src/lib/deploy/cache.ts
/**
 * Deployment checksum cache — powered by Upstash Redis.
 *
 * Every deployable app gets a checksum computed from:
 *   - Git tree hash of the app's source directory
 *   - Dockerfile content hash
 *   - Deploy config (memory, cpu, region, etc.)
 *   - Mode-specific .env.{mode} file hash
 *
 * Before deploying, the local checksum is compared against the cached value.
 * If they match, the deployment is skipped (unless --force is used).
 *
 * Architecture — Online-first, single source of truth:
 *   Upstash Redis is the authoritative cache shared across CI, local, and the
 *   entire team. The local .deploy-cache.json file is ONLY used as a fallback
 *   when Redis is unreachable.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { c, log, warn } from '../cli_utils';
import type { AppConfig } from './deployment_config';
import { dirtyTreeHash, run } from './utils';

// ── Upstash Redis config ─────────────────────────────────────────────────

const _resolveRedisUrl = (): string =>
  process.env.REDIS_URL || 'https://famous-tarpon-106347.upstash.io';
const _resolveRedisToken = (): string => process.env.REDIS_TOKEN || '';

const CACHE_PREFIX = 'cache-aikami-deploy';

// ── Local file cache (fallback only — NEVER used when online is reachable)

const LOCAL_CACHE_PATH = '.deploy-cache.json';

type LocalCache = Record<string, string>; // key → checksum

function loadLocalCache(): LocalCache {
  try {
    if (existsSync(LOCAL_CACHE_PATH)) {
      return JSON.parse(readFileSync(LOCAL_CACHE_PATH, 'utf-8'));
    }
  } catch {
    // Corrupt cache — start fresh
  }
  return {};
}

function saveLocalCache(cache: LocalCache): void {
  writeFileSync(LOCAL_CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
}

function localCacheKey(mode: string, appName: string): string {
  return `${CACHE_PREFIX}:${mode}:${appName}`;
}

// ── Hashing helpers ──────────────────────────────────────────────────────

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function fileHash(filePath: string): string {
  if (!existsSync(filePath)) {
    return '';
  }
  const content = readFileSync(filePath, 'utf-8');
  return sha256(content);
}

/** Git tree hash for a directory — captures the state of all tracked files. */
function gitTreeHash(dirPath: string): string {
  return run(`git ls-tree HEAD -- ${dirPath} | sha256sum | cut -d' ' -f1`, {
    quiet: true,
  });
}

// ── Checksum computation ─────────────────────────────────────────────────

/**
 * Compute a deployment checksum for an app.
 *
 * Inputs:
 *   - Git tree hash of the app directory (source code state)
 *   - Dockerfile content hash (only for Docker-based apps)
 *   - Deploy config (memory, cpu, region, serviceType)
 *   - Mode-specific .env.{mode} file hash (if exists)
 *   - moon build command (appName identifies the build task)
 *
 * If ANY of these change, the checksum changes → redeploy needed.
 */
export function computeAppChecksum(
  config: AppConfig,
  appName: string,
  mode: string,
  rootDir: string,
): string {
  const appPath = join(rootDir, config.path);

  // Source code state (git captures everything under version control)
  const sourceHash = gitTreeHash(config.path);

  // Dockerfile (for Docker-based apps; hosting/functions skip)
  const dockerfilePath = join(appPath, 'Dockerfile');
  const dockerfileHash = existsSync(dockerfilePath) ? fileHash(dockerfilePath) : 'no-dockerfile';

  // Deploy configuration
  const deployConfig = JSON.stringify({
    memory: config.memory ?? '1Gi',
    cpu: config.cpu ?? 'boost',
    region: config.region ?? '',
    serviceType: config.serviceType,
    cloudRunServiceId: config.cloudRunServiceId ?? `aikami-${config.shortName}`,
    shortName: config.shortName,
    vpcConnector: config.vpcConnector ?? '',
    cloudSqlInstance: config.cloudSqlInstance ?? '',
    needsDist: config.needsDist ?? true,
    imageName: config.imageName ?? `aikami/${config.shortName}`,
    dockerContext: config.dockerContext ?? config.path,
  });

  // Mode-specific env vars (non-secret config)
  const modeEnvPath = join(appPath, `.env.${mode}`);
  const modeEnvHash = fileHash(modeEnvPath);

  // moon build command
  const buildTarget = `${appName}:build`;

  // Working tree dirty state — captures uncommitted changes that
  // don't appear in git ls-tree but DO affect the Docker build.
  const dirtyHash = dirtyTreeHash();

  const combined = `${sourceHash}:${dirtyHash}:${dockerfileHash}:${sha256(deployConfig)}:${modeEnvHash}:${buildTarget}`;
  return sha256(combined);
}

// ── Upstash Redis cache (authoritative) ──────────────────────────────────

async function upstashGet(key: string): Promise<string | null> {
  try {
    const baseUrl = _resolveRedisUrl();
    const token = _resolveRedisToken();
    if (!token) {
      return null;
    }
    const response = await fetch(`${baseUrl}/get/${key}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { result: string | null };
    return data.result ?? null;
  } catch {
    return null;
  }
}

async function upstashSet(key: string, value: string): Promise<void> {
  try {
    const baseUrl = _resolveRedisUrl();
    const token = _resolveRedisToken();
    if (!token) {
      return;
    }
    await fetch(`${baseUrl}/set/${key}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: value,
    });
  } catch {
    warn('Failed to update online deploy cache (Redis unreachable)');
  }
}

/**
 * Check online cache.
 * Returns the cached checksum, or null if Redis is unreachable or key not found.
 */
async function checkOnlineCache(
  mode: string,
  appName: string,
  currentChecksum: string,
): Promise<'hit' | 'miss' | null> {
  const key = `${CACHE_PREFIX}:${mode}:${appName}`;
  const online = await upstashGet(key);
  if (online === null) {
    return null; // Redis unreachable
  }
  return online === currentChecksum ? 'hit' : 'miss';
}

// ── Public API ───────────────────────────────────────────────────────────

export type CacheResult = {
  /** The computed checksum for the current state */
  checksum: string;
  /** Whether the deployment can be skipped (checksum unchanged) */
  skip: boolean;
  /** Source of the cache match: 'online' (authoritative), 'local' (fallback), or 'none' */
  source: 'online' | 'local' | 'none';
};

/**
 * Determine whether a deployment can be skipped.
 *
 * Strategy (online-first, local-fallback):
 *   1. Compute the current checksum
 *   2. Check online Upstash cache (authoritative, shared across team/CI)
 *   3. If online is reachable → use its result (hit or miss); NEVER consult local.
 *   4. If online is unreachable → fall back to local file cache.
 *   5. If checksum matches any cache AND not forced → skip
 */
export async function checkDeployCache(
  config: AppConfig,
  appName: string,
  mode: string,
  rootDir: string,
  isForce: boolean,
): Promise<CacheResult> {
  const checksum = computeAppChecksum(config, appName, mode, rootDir);
  const cacheKey = localCacheKey(mode, appName);

  if (isForce) {
    log(`  ${c.dim}--force: bypassing cache check${c.reset}`);
    return { checksum, skip: false, source: 'none' };
  }

  // 1. Online cache (authoritative — single source of truth)
  const onlineResult = await checkOnlineCache(mode, appName, checksum);

  if (onlineResult === 'hit') {
    log(`  ${c.dim}Cache hit (online): ${checksum.slice(0, 8)}...${c.reset}`);
    // Write-through to local cache so fallback is fresh if needed later
    const local = loadLocalCache();
    local[cacheKey] = checksum;
    saveLocalCache(local);
    return { checksum, skip: true, source: 'online' };
  }

  if (onlineResult === 'miss') {
    log(`  ${c.dim}Online cache miss — deploying${c.reset}`);
    return { checksum, skip: false, source: 'none' };
  }

  // 2. Online unreachable — fall back to local cache (best-effort)
  const local = loadLocalCache();
  if (local[cacheKey] === checksum) {
    log(
      `  ${c.yellow}Online cache unreachable — local cache HIT: ${checksum.slice(0, 8)}...${c.reset}`,
    );
    return { checksum, skip: true, source: 'local' };
  }

  log(`  ${c.yellow}Online cache unreachable — local cache miss: deploying${c.reset}`);
  return { checksum, skip: false, source: 'none' };
}

/**
 * Store a successful deployment checksum in the online (Redis) cache.
 * Call this AFTER a successful deployment.
 */
export async function saveDeployCache(
  mode: string,
  appName: string,
  checksum: string,
): Promise<void> {
  const key = `${CACHE_PREFIX}:${mode}:${appName}`;
  await upstashSet(key, checksum);
}
