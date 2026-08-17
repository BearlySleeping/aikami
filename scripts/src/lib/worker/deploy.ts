#!/usr/bin/env bun
// scripts/src/lib/worker/deploy.ts
//
// Builds + pushes apps/backend/worker and rolls it out to the always-on
// Compute Engine VM (`aikami-worker`, us-central1-a) that hosts it — NOT
// part of the generic firestack/docker-release deploy pipeline
// (scripts/src/lib/deploy/deployment_config.ts), since that framework
// models one-shot deploys of stateless services/functions and this is a
// single persistent VM with its own build→push→restart step. Production
// only — there is no staging VM for this (a single Discord guild, no
// reason to run a second bot instance against it).
//
// Path:
//   1. `bun run build` in apps/backend/worker — bundles src/index.ts (and
//      every workspace import, e.g. @aikami/backend-discord-bot) into one
//      self-contained dist/index.js. No `bun install` happens in the
//      image itself — see the Dockerfile.
//   2. docker build (context = apps/backend/worker only, NOT the repo
//      root — the Dockerfile only needs the prebuilt dist/index.js).
//   3. Push to the region-matched Artifact Registry repo (`aikami-worker`,
//      us-central1 — same region as the VM, so pulls stay within GCP's
//      Always Free tier; the rest of this repo's Docker images live in
//      the europe-west4 `aikami` repo, deliberately not reused here).
//   4. `gcloud compute instances update-container` — pulls the new image
//      and restarts the running container in place.
//
// Usage: bun run scripts/src/lib/worker/deploy.ts

import { join } from 'node:path';
import { c, error, log, ok } from '../cli_utils';
import { authenticateDocker, resolveProjectId, run, shortSha } from '../deploy/utils';

const REGION = 'us-central1';
const ZONE = 'us-central1-a';
const VM_NAME = 'aikami-worker';
const ARTIFACT_REPO = 'aikami-worker';
const IMAGE_NAME = 'worker';

async function main(): Promise<void> {
  const mode = 'production';
  const projectId = resolveProjectId(mode);
  const appDir = join(import.meta.dirname, '../../../../apps/backend/worker');
  const registry = `${REGION}-docker.pkg.dev/${projectId}/${ARTIFACT_REPO}/${IMAGE_NAME}`;
  const tag = `${registry}:${shortSha()}`;
  const latestTag = `${registry}:latest`;

  log(`\n${c.bold}🚀 Deploying worker to ${VM_NAME} (${projectId})${c.reset}`);
  log(`  Image: ${tag}\n`);

  log('📦 Building bundle...');
  run('bun run build', { cwd: appDir });

  log('🐳 Authenticating Docker...');
  authenticateDocker(REGION);

  log('🐳 Building & pushing image...');
  run(`docker build -f ${join(appDir, 'Dockerfile')} -t ${tag} -t ${latestTag} ${appDir}`);
  run(`docker push ${tag}`);
  run(`docker push ${latestTag}`);

  log(`🔄 Rolling out to ${VM_NAME}...`);
  run(
    `gcloud compute instances update-container ${VM_NAME} --zone=${ZONE} --project=${projectId} --container-image=${tag}`,
  );

  ok(`Deployed ${tag} to ${VM_NAME}.`);
}

main().catch((err) => {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
