// scripts/src/lib/deploy/firebase.ts
/**
 * Firebase deployments — Hosting (site, docs) and Functions (firebase).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { c, log, ok } from '../cli_utils';
import { checkDeployCache, saveDeployCache } from './cache';
import type { AppConfig } from './deployment_config';
import { resolveProjectId, run, isVerbose } from './utils';

// ── Firebase Hosting (site, docs) ────────────────────────────────────────

export async function deployFirebaseHosting(
  config: AppConfig,
  appName: string,
  mode: string,
  rootDir: string,
  version: string,
  isForce = false,
  preflightChecksum?: string,
): Promise<void> {
  const projectId = resolveProjectId(mode);

  log(`\n${c.bold}🚀 Deploying ${appName} to Firebase Hosting${c.reset}`);
  log(`  Project: ${projectId}\n`);

  // 0. Checksum cache — use pre-flight checksum when available (avoids
  //    recomputing after build, which may have a different dirty hash).
  let checksum: string;
  if (preflightChecksum !== undefined) {
    // Pre-flight already determined this is a miss; use its checksum.
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

  // Build — skip if already built in Phase 1 (parallel deploy safety)
  const distDir = join(rootDir, config.path, 'dist');
  if (existsSync(distDir)) {
    log('🏗️  Build already done, skipping...');
  } else {
    log('🏗️  Building...');
    // Always force — moon's passthrough arg caching can silently reuse builds
    // with the wrong env mode (e.g., production instead of staging).
    run(`bunx moon run ${appName}:build --force -- --mode ${mode}`, { cwd: rootDir });
  }

  log('🔥 Deploying to Firebase Hosting...');
  run(`bunx moon run ${appName}:deploy -- --mode ${mode}`, { cwd: rootDir });

  // Save checksum on success — use the pre-build consistent checksum
  await saveDeployCache(mode, appName, checksum, version);
  ok(`${appName} deployed to Firebase Hosting`);
}

// ── Firebase Functions ───────────────────────────────────────────────────

export async function deployFirebaseFunctions(
  _config: AppConfig,
  appName: string,
  mode: string,
  rootDir: string,
  isForce = false,
): Promise<void> {
  const projectId = resolveProjectId(mode);

  log(`\n${c.bold}🚀 Deploying ${appName} to Firebase Functions${c.reset}`);
  log(`  Project: ${projectId}\n`);

  log('⚡ Deploying functions...');
  const forceFlag = isForce ? ' --force' : '';
  run(`bunx moon run ${appName}:deploy${forceFlag} -- --mode=${mode} --deploy-engine gcloud`, {
    cwd: rootDir,
  });
  ok(`${appName} deployed`);
}
