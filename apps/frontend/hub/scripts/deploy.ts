// apps/frontend/hub/scripts/deploy.ts
/**
 * Firebase Hosting deploy script for the hub app.
 *
 * The hub is a SvelteKit SSR app deployed to Cloud Run (`aikami-hub`); the
 * Firebase Hosting sites (`aikami-staging-hub` / `aikami-production-hub`)
 * sit in front of it and rewrite every request to the Cloud Run service.
 *
 * The site ID is resolved per mode from the shared deployment config and
 * injected into firebase.json at deploy time (the committed firebase.json
 * intentionally has no `site` field so the same file works for both modes).
 */

import { parseArgs } from 'node:util';
import { logger } from '@aikami/logger';
import { toMode } from '@aikami/utils';
import { $, file } from 'bun';
import {
  MODE_PROJECT_MAP,
  resolveHostingSiteId,
} from '../../../../scripts/src/lib/deploy/deployment_config';

const { values } = parseArgs({
  args: Bun.argv,
  options: { mode: { type: 'string' } },
  strict: false,
  allowPositionals: true,
});

const mode = toMode(values.mode || process.env.MODE);
if (!mode) {
  logger.error('Missing --mode argument or MODE env var');
  process.exit(1);
}

const projectId = MODE_PROJECT_MAP[mode];
if (!projectId) {
  logger.error(`Unknown mode: ${mode}`);
  process.exit(1);
}

const targetSite = resolveHostingSiteId('hub', projectId);
if (!targetSite) {
  logger.error('No hosting site ID configured for hub');
  process.exit(1);
}

const firebaseJsonPath = 'firebase.json';
const deployConfigPath = 'firebase.deploy.json';

try {
  const firebaseJsonFile = file(firebaseJsonPath);
  if (!(await firebaseJsonFile.exists())) {
    throw new Error(`Could not find ${firebaseJsonPath}`);
  }

  const config = await firebaseJsonFile.json();
  config.hosting.site = targetSite;
  await Bun.write(deployConfigPath, JSON.stringify(config, null, 4));

  // Pinned firebase-tools version (not @latest) so deploys are reproducible.
  await $`bunx firebase-tools@15.25.1 deploy --only hosting --project ${projectId} --config ${deployConfigPath}`.cwd(
    process.cwd(),
  );
} catch (error) {
  logger.error(error as Error);
  process.exit(1);
} finally {
  const tempFile = file(deployConfigPath);
  if (await tempFile.exists()) {
    await $`rm ${deployConfigPath}`;
  }
}
