// apps/frontend/docs/scripts/deploy.ts
/**
 * Firebase Hosting deploy script for the docs app.
 */

import { parseArgs } from 'node:util';
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
  console.error('Missing --mode argument or MODE env var');
  process.exit(1);
}

const projectId = MODE_PROJECT_MAP[mode];
if (!projectId) {
  console.error(`Unknown mode: ${mode}`);
  process.exit(1);
}

const targetSite = resolveHostingSiteId('docs', projectId);
if (!targetSite) {
  console.error('No hosting site ID configured for docs');
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

  await $`npx -y firebase-tools@latest deploy --only hosting --project ${projectId} --config ${deployConfigPath}`.cwd(
    process.cwd(),
  );
} catch (error) {
  console.error(error);
  process.exit(1);
} finally {
  const tempFile = file(deployConfigPath);
  if (await tempFile.exists()) {
    await $`rm ${deployConfigPath}`;
  }
}
