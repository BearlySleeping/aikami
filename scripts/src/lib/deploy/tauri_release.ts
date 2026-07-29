// scripts/src/lib/deploy/tauri_release.ts
/**
 * Tauri desktop release strategy — builds the client desktop app.
 *
 * Path:
 *  1. Checksum check (skip if unchanged)
 *  2. Build SvelteKit app for web (moon build)
 *  3. Build Tauri desktop app via cargo tauri build
 *  4. Collect release artifacts (AppImage, deb, msi, dmg)
 *  5. Upload artifacts to GCS release bucket
 *
 * Requires:
 *   - Rust toolchain (cargo, rustc)
 *   - Tauri CLI (@tauri-apps/cli)
 *   - Platform-specific system deps (webkit2gtk, etc.)
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { c, log, ok, warn } from '../cli_utils';
import { checkDeployCache, saveDeployCache } from './cache';
import type { AppConfig } from './deployment_config';
import { resolveProjectId, run, shortSha } from './utils';

export async function deployTauriRelease(
  config: AppConfig,
  appName: string,
  mode: string,
  rootDir: string,
  isForce = false,
): Promise<void> {
  const projectId = resolveProjectId(mode);
  const appRoot = join(rootDir, config.path);
  const tauriDir = join(appRoot, 'src-tauri');
  const releaseBucket = `gs://${projectId}-releases/${appName}`;

  log(`\n${c.bold}🖥️  Building ${appName} Tauri desktop release${c.reset}`);
  log(`  Project: ${projectId}`);
  log(`  App:     ${appRoot}`);
  log(`  Tauri:   ${tauriDir}\n`);

  // 0. Checksum cache — skip if nothing changed
  const cache = await checkDeployCache(config, appName, mode, rootDir, isForce);
  if (cache.skip) {
    ok(`${appName} Tauri release skipped (unchanged — cache hit: ${cache.source})`);
    return;
  }

  // 1. Verify Tauri directory exists
  if (!existsSync(tauriDir)) {
    warn(`No src-tauri directory found at ${tauriDir}. Skipping Tauri build.`);
    return;
  }

  // 2. Build the web app first (Tauri needs the SvelteKit build output)
  const buildDir = join(appRoot, 'build');
  if (!existsSync(buildDir)) {
    log('🏗️  Building web app...');
    const ver = shortSha();
    const modeFlag = mode !== 'production' ? ` -- --mode ${mode}` : '';
    run(`PUBLIC_APP_VERSION=${ver} bunx moon run ${appName}:build${modeFlag}`, {
      cwd: rootDir,
    });

    if (!existsSync(buildDir)) {
      throw new Error(`Build directory not found: ${buildDir}. Build may have failed.`);
    }
  } else {
    log('🏗️  Web build already done, skipping...');
  }

  // 3. Build Tauri desktop app
  log('🦀 Building Tauri desktop app...');
  try {
    run('cargo tauri build', { cwd: appRoot });
  } catch (err) {
    warn(`Tauri build failed: ${(err as Error).message}`);
    warn('Make sure Rust toolchain and system deps are installed.');
    warn('See: https://tauri.app/v1/guides/getting-started/prerequisites');
    throw err;
  }

  // 4. Collect release artifacts
  const releaseDir = join(tauriDir, 'target/release');
  const bundleDir = join(releaseDir, 'bundle');
  const artifacts: string[] = [];

  // Collect all bundle artifacts (AppImage, deb, msi, dmg)
  if (existsSync(bundleDir)) {
    function collectBundles(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          collectBundles(full);
        } else if (stat.isFile()) {
          artifacts.push(full);
        }
      }
    }
    collectBundles(bundleDir);
  }

  if (artifacts.length === 0) {
    warn('No release artifacts found — Tauri build may have produced nothing.');
    return;
  }

  log(`📦 Found ${artifacts.length} release artifact(s):`);
  for (const art of artifacts) {
    log(`  • ${art}`);
  }

  // 5. Upload artifacts to GCS release bucket
  log(`📤 Uploading artifacts to ${releaseBucket}...`);
  for (const art of artifacts) {
    run(`gcloud storage cp "${art}" "${releaseBucket}/"`, { quiet: false });
  }

  // 6. Save checksum on success
  await saveDeployCache(mode, appName, cache.checksum);
  ok(`${appName} Tauri release complete — ${artifacts.length} artifact(s) uploaded`);
}
