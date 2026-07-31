// scripts/src/lib/deploy/docker_release.ts
/**
 * Docker release strategy — for backend services that are self-hosted
 * on GPU machines (ComfyUI image, Ollama text, Kokoro voice).
 *
 * Unlike Cloud Run, these services:
 *   - Build Docker images and push to Artifact Registry
 *   - Do NOT deploy to Cloud Run (GPU workloads, locally managed)
 *   - The Docker images are pulled and run on dedicated GPU instances
 *
 * Path:
 *  1. Checksum check (skip if unchanged)
 *  2. Docker build from the service directory (uses its Dockerfile)
 *  3. Push image to GCP Artifact Registry
 *  4. Optionally tag as :latest for downstream consumers
 */

import { join } from 'node:path';
import { c, log, ok } from '../cli_utils';
import { checkDeployCache, saveDeployCache } from './cache';
import type { AppConfig } from './deployment_config';
import {
  authenticateDocker,
  isVerbose,
  resolveProjectId,
  resolveRegion,
  run,
  shortSha,
} from './utils';

export async function deployDockerRelease(
  config: AppConfig,
  appName: string,
  mode: string,
  rootDir: string,
  version: string,
  isForce = false,
  preflightChecksum?: string,
): Promise<void> {
  const projectId = resolveProjectId(mode);
  const imageName = config.imageName ?? `aikami/${config.shortName}`;
  const region = resolveRegion(mode, config.region);
  const tag = `${region}-docker.pkg.dev/${projectId}/${imageName}:${shortSha()}`;
  // Build context defaults to repo root (monorepo deps); Dockerfile lives in the app dir.
  const dockerContext = config.dockerContext ? join(rootDir, config.dockerContext) : rootDir;
  const dockerfile = join(rootDir, config.path, 'Dockerfile');

  log(`\n${c.bold}🐳 Releasing ${appName} Docker image${c.reset}`);
  log(`  Project: ${projectId}`);
  log(`  Image:   ${tag}`);
  log(`  Context: ${dockerContext}`);
  log(`  Dockerfile: ${dockerfile}\n`);

  // 0. Checksum cache — use pre-flight checksum when available
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

  // 1. Authenticate Docker with Artifact Registry
  authenticateDocker();

  // 2. Build & push Docker image with layer caching
  log('🐳 Building & pushing Docker image (with layer cache)...');
  const cacheRepo = `${region}-docker.pkg.dev/${projectId}/${imageName}`;
  const cacheTag = `${cacheRepo}:latest`;
  run(`docker pull ${cacheTag} 2>/dev/null || true`, { quiet: true });
  run(`docker build -f ${dockerfile} -t ${tag} --cache-from=${cacheTag} ${dockerContext}`);
  run(`docker push ${tag}`);

  // 3. Tag as latest for downstream consumers
  run(`docker tag ${tag} ${cacheTag}`, { quiet: true });
  run(`docker push ${cacheTag}`, { quiet: true });

  // 4. Save checksum on success — use the pre-build consistent checksum
  await saveDeployCache(mode, appName, checksum, version);
  ok(`${appName} Docker image released — ${tag}`);
}
