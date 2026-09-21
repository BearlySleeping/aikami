// scripts/src/lib/deploy/build_output.ts
//
// Build-output hygiene for the deploy path.
//
// Deliberately its own module, not a helper inside `index.ts`: `index.ts` ends
// with a bare `await main()`, so importing it from a test starts a deploy.
// Anything the deploy path needs to be testable lives beside it instead.

import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '../cli_utils';
import { APP_CONFIG } from './deployment_config';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * Remove an app's adapter output directory before it is built.
 *
 * 🔴 The directory MUST start empty. moon hydrates a cached task's `outputs` by
 * copying the archived tree in WITHOUT removing files that are not in it, so a
 * cache hit overlays this build onto the previous one. Measured: a dev-route
 * build (301 files, including `build/dev/`) followed by a cached production
 * build left 385 files, two `app.*.js` entries and `build/dev/` still present —
 * which then fails the deploy-asset guard on a build that correctly excluded
 * the sandboxes, and inflates what Cloudflare is asked to store. A real
 * (non-cached) run is clean because the adapter rimrafs these paths itself;
 * this covers the hydrated path, where nothing else can.
 *
 * Only apps that declare `cloudflare.buildOutputDir` are cleaned: the layout of
 * every other service type (docker contexts, Tauri bundles) is not ours to
 * assume, and guessing there could delete something we did not produce.
 *
 * @param rootDir Workspace root, injectable so tests can use a fixture tree.
 * @returns true when a directory was actually removed, so the caller can stay
 *   quiet about the common case of a first build.
 */
export function cleanBuildOutput(appName: string, rootDir: string = ROOT_DIR): boolean {
  const config = APP_CONFIG[appName as keyof typeof APP_CONFIG];
  const outputDir = config?.cloudflare?.buildOutputDir;
  if (!config || !outputDir) {
    return false;
  }

  const target = resolve(rootDir, config.path, outputDir);
  if (!existsSync(target)) {
    return false;
  }

  rmSync(target, { recursive: true, force: true });
  log(`  🧹 Cleared stale ${outputDir}/ before building ${appName}`);
  return true;
}
