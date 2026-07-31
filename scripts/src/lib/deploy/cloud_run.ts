// scripts/src/lib/deploy/cloud_run.ts
/**
 * Cloud Run deployment strategy — SvelteKit (client web).
 *
 * Path:
 *  1. Checksum check (skip if unchanged)
 *  2. Build via moon
 *  3. Prepare minimal package.json
 *  4. Build Docker image from project root (uses per-project Dockerfile)
 *  5. Push image to GCP Artifact Registry
 *  6. Deploy to Cloud Run with GSM secrets
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { c, log, ok } from '../cli_utils';
import { checkDeployCache, saveDeployCache } from './cache';
import type { AppConfig } from './deployment_config';
import { prepareCloudRunPackage } from './prepare_package';
import { buildSecretArgsFromEnvFile } from './secrets';
import {
  authenticateDocker,
  buildGcloudRunArgs,
  isVerbose,
  parseEnvKeys,
  resolveCloudRunServiceName,
  resolveProjectId,
  resolveRegion,
  run,
  shortSha,
  versionSha,
} from './utils';

// ── Deduplication helpers ─────────────────────────────────────────────────

/** Escape a value for safe use in --set-env-vars. Handles commas via gcloud's ^:^ delimiter. */
function escapeEnvValue(value: string): string {
  if (value.includes(',')) {
    // gcloud supports ^:^ as an alternative delimiter for comma-containing values
    return `^:^${value}^:^`;
  }
  return value;
}

/**
 * Remove env vars from the extra vars string that are already present
 * in the GSM --set-secrets argument. Cloud Run rejects deployments
 * when the same key appears in both --set-env-vars and --set-secrets.
 */
function deduplicateEnvVars(extraEnvVars: string, secretArgs: string): string {
  if (!extraEnvVars || !secretArgs) {
    return extraEnvVars;
  }

  const secretMatch = secretArgs.match(/--set-secrets=(.+)/);
  if (!secretMatch?.[1]) {
    return extraEnvVars;
  }

  const secretKeys = new Set(
    secretMatch[1]
      .split(',')
      .map((mapping) => mapping.split('=')[0]?.trim())
      .filter(Boolean),
  );

  const vars = extraEnvVars.split(',').filter(Boolean);
  const deduplicated = vars.filter((v) => {
    const key = v.split('=')[0]?.trim();
    return key && !secretKeys.has(key);
  });

  return deduplicated.length > 0 ? `,${deduplicated.join(',')}` : '';
}

// ── SvelteKit Cloud Run ──────────────────────────────────────────────────

export async function deployCloudRunSveltekit(
  config: AppConfig,
  appName: string,
  mode: string,
  rootDir: string,
  version: string,
  isForce = false,
  preflightChecksum?: string,
): Promise<void> {
  const projectId = resolveProjectId(mode);
  const serviceId = resolveCloudRunServiceName(config, appName);
  const imageName = `aikami/${config.shortName}`;
  const region = resolveRegion(mode, config.region);
  const tag = `${region}-docker.pkg.dev/${projectId}/${imageName}:${shortSha()}`;
  const appRoot = join(rootDir, config.path);
  const buildDir = join(appRoot, 'build');

  log(`\n${c.bold}🚀 Deploying ${appName} to Cloud Run (SvelteKit)${c.reset}`);
  log(`  Service: ${serviceId}`);
  log(`  Project: ${projectId}`);
  log(`  Image:   ${tag}`);
  log(`  Context: ${appRoot}\n`);

  // 0. Checksum cache — use pre-flight checksum when available (avoids
  //    recomputing after build, which may have a different dirty hash).
  let checksum: string;
  if (preflightChecksum !== undefined) {
    checksum = preflightChecksum;
    if (isVerbose()) {
      log(`  Using pre-flight checksum: ${checksum.slice(0, 16)}...`);
    }
  } else {
    const cache = await checkDeployCache(config, appName, mode, rootDir, isForce);
    if (cache.skip) {
      ok(`${appName} skipped (unchanged — cache hit: ${cache.source})`);
      return;
    }
    checksum = cache.checksum;
  }

  // 1. Build — skip if already built in Phase 1 (parallel deploy safety)
  if (existsSync(buildDir)) {
    log('🏗️  Build already done, skipping...');
  } else {
    log(`🏗️  Building (mode: ${mode})...`);
    const ver = versionSha();
    const modeFlag = mode !== 'production' ? ` -- --mode ${mode}` : '';
    const forceFlag = isForce ? ' --force' : '';
    run(`bunx moon run ${appName}:build${forceFlag}${modeFlag}`, {
      cwd: rootDir,
      env: { PUBLIC_APP_VERSION: ver },
    });

    if (!existsSync(buildDir)) {
      throw new Error(`Build directory not found: ${buildDir}. Build may have failed.`);
    }
  }

  // 2. Generate minimal package.json for runtime deps
  log('📦 Preparing runtime package...');
  await prepareCloudRunPackage({ appName, buildDir, appPath: appRoot });

  // 3. Build & push Docker image with layer caching from previous build
  log('🐳 Building & pushing Docker image (with layer cache)...');
  authenticateDocker();
  const cacheRepo = `${region}-docker.pkg.dev/${projectId}/${imageName}`;
  const cacheTag = `${cacheRepo}:latest`;
  run(`docker pull ${cacheTag} 2>/dev/null || true`, { quiet: true });
  run(`docker build -t ${tag} --cache-from=${cacheRepo} ${appRoot}`);
  run(`docker push ${tag}`);
  run(`docker tag ${tag} ${cacheTag}`, { quiet: true });
  run(`docker push ${cacheTag}`, { quiet: true });

  // 4. Build --set-secrets from .env.{mode} (no GSM fetch)
  log('🔐 Building secret mappings from .env.{mode}...');
  const secretArgs = await buildSecretArgsFromEnvFile(
    join(rootDir, config.path),
    config.prefix,
    mode,
    projectId,
  );

  // 5. Load mode-specific env vars from .env.{mode} for Cloud Run runtime
  const modeEnvPath = join(appRoot, `.env.${mode}`);
  let extraEnvVars = '';
  if (existsSync(modeEnvPath)) {
    const modeVars = parseEnvKeys(modeEnvPath);
    for (const [key, value] of Object.entries(modeVars)) {
      if (
        key.startsWith('PUBLIC_') ||
        key === 'FIREBASE_SERVICE_ACCOUNT' ||
        key === 'SERVICE_KEY' ||
        !value
      ) {
        continue;
      }
      extraEnvVars += `,${key}=${escapeEnvValue(value)}`;
    }
  }

  // 6. Deploy
  log('🚀 Deploying...');
  let envVars = `,AIKAMI_MODE=${mode},MODE=${mode},FIRESTORE_PREFER_REST=true,PUBLIC_APP_VERSION=${shortSha()}${extraEnvVars}`;
  envVars = deduplicateEnvVars(envVars, secretArgs);
  run(buildGcloudRunArgs(config, serviceId, tag, projectId, mode, envVars, secretArgs));

  // 7. Save checksum on success — use the pre-build consistent checksum
  await saveDeployCache(mode, appName, checksum, version);
  ok(`${appName} deployed to Cloud Run`);
}
