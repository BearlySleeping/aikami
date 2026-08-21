/** biome-ignore-all lint/suspicious/noConsole: Deploy scripts run standalone; console.error is intentional. */
// apps/frontend/hub/scripts/deploy.ts
/**
 * Cloudflare Worker deploy script for the hub app.
 *
 * The hub is a SvelteKit SSR app built with @sveltejs/adapter-cloudflare and
 * deployed as a Cloudflare Worker. Delegates to the shared Cloudflare deploy
 * module (single source of truth in scripts/src/lib/deploy/cloudflare.ts).
 * Per-app config (worker name, route, build output dir) lives in
 * deployment_config.ts.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { toMode } from '@aikami/utils';
import { generateVersionString } from '../../../../scripts/src/lib/deploy/cache';
import { deployCloudflareWorker } from '../../../../scripts/src/lib/deploy/cloudflare';
import { APP_CONFIG } from '../../../../scripts/src/lib/deploy/deployment_config';

// Repo root = 4 levels up from apps/frontend/hub/scripts/deploy.ts
const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

const { values } = parseArgs({
  args: Bun.argv,
  options: {
    mode: { type: 'string' },
    verbose: { type: 'boolean', default: false },
  },
  strict: false,
  allowPositionals: true,
});

const mode = toMode(values.mode || process.env.MODE);
if (!mode) {
  console.error('Missing --mode argument or MODE env var');
  process.exit(1);
}

const appName = 'hub';
const config = APP_CONFIG[appName];
if (!config?.cloudflare) {
  console.error('No cloudflare config for hub');
  process.exit(1);
}

try {
  await deployCloudflareWorker(config, appName, mode, ROOT_DIR, generateVersionString(), false);
} catch (error) {
  const err = error as { stderr?: string; stdout?: string; message?: string };
  console.error(err.stderr ?? err.message ?? String(error));
  process.exit(1);
}
