// apps/frontend/site/scripts/deploy.ts
/** biome-ignore-all lint/suspicious/noConsole: This file will only be used in the deploy script */

import { parseArgs } from 'node:util';
import { toMode } from '@aikami/utils';
import { $, file } from 'bun';
import {
  MODE_PROJECT_MAP,
  resolveHostingSiteId,
} from '../../../../scripts/src/lib/deploy/deployment_config';

// 1. Parse incoming arguments
const { values } = parseArgs({
  args: Bun.argv,
  options: {
    mode: { type: 'string' },
    verbose: { type: 'boolean', default: false },
  },
  strict: false,
  allowPositionals: true,
});

const verbose = values.verbose === true;

// Grab from CLI args FIRST, fallback to Environment Variable SECOND
const mode = toMode(values.mode || process.env.MODE);

if (!mode) {
  console.error('Missing --mode argument or MODE env var');
  process.exit(1);
}

// 2. Resolve project ID from shared deployment config
const projectId: string | undefined = MODE_PROJECT_MAP[mode];

if (!projectId) {
  console.error(`Unknown mode: ${mode}`);
  process.exit(1);
}

// 3. Compute Firebase Hosting site ID from shared deployment config
const targetSite = resolveHostingSiteId('site', projectId);

if (!targetSite) {
  console.error('No hosting site ID configured for site');
  process.exit(1);
}

const firebaseJsonPath = 'firebase.json';
const deployConfigPath = 'firebase.deploy.json';

try {
  // 4. Read the existing firebase.json
  const firebaseJsonFile = file(firebaseJsonPath);
  if (!(await firebaseJsonFile.exists())) {
    throw new Error(
      `Could not find ${firebaseJsonPath}. Make sure you are in the right directory.`,
    );
  }

  // Parse the JSON safely
  const config = await firebaseJsonFile.json();

  // 5. Inject the target site dynamically
  config.hosting.site = targetSite;

  // Write a temporary configuration file for this deployment
  await Bun.write(deployConfigPath, JSON.stringify(config, null, 4));

  // 6. Execute deployment using the repo-pinned firebase-tools.
  //    🔴 Do NOT use `firebase-tools@latest` here: bunx re-resolves the
  //    latest version and downloads a fresh `re2` native module on Windows,
  //    which fails with EBUSY during cache extraction. The pinned version is
  //    a devDependency and resolves locally/offline via `bunx firebase-tools`.
  if (verbose) {
    console.log(`[deploy] mode=${mode}`);
    console.log(`[deploy] project=${projectId}`);
    console.log(`[deploy] hosting site=${targetSite}`);
    console.log(`[deploy] config=${deployConfigPath}`);
    // Bun 1.3+: `$` echoes command + output by default (old `$.verbose` was removed).
    await $`bunx firebase-tools deploy --only hosting --project ${projectId} --config ${deployConfigPath} --debug`.cwd(
      process.cwd(),
    );
  } else {
    await $`bunx firebase-tools deploy --only hosting --project ${projectId} --config ${deployConfigPath}`
      .quiet()
      .cwd(process.cwd());
  }
} catch (error) {
  const err = error as { stderr?: string; stdout?: string; message?: string };
  console.error(err.stderr ?? err.message ?? error);
  process.exit(1);
} finally {
  // 7. Cleanup the temporary config file so we don't pollute the git workspace
  const tempFile = file(deployConfigPath);
  if (await tempFile.exists()) {
    await $`rm ${deployConfigPath}`;
  }
}
