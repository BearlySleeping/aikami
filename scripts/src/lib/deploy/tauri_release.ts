// scripts/src/lib/deploy/tauri_release.ts
/**
 * Tauri desktop release strategy — builds the client desktop app.
 *
 * Path:
 *  1. Checksum check (skip if unchanged)
 *  2. Build SvelteKit app for web (moon build)
 *  3. Build Tauri desktop app via bun run tauri build (native to whichever OS
 *     this runs on — no cross-compilation; use CI matrix for multi-platform)
 *  4. Collect ONLY final, installable release artifacts (.deb/.rpm/.AppImage/
 *     .msi/.exe/.dmg/.app.tar.gz/.sig) — everything else in target/release/bundle
 *     is intermediate packaging scaffolding and is deliberately discarded.
 *  5. Upload to Firebase Storage in a single batched, parallel gcloud call:
 *       gs://{projectId}.firebasestorage.app/tauri-releases/{appName}/{platform}/
 *
 * Multi-platform:
 *   Run on ubuntu-latest, windows-latest, and macos-latest to get all three
 *   natively. Tauri v2 does not reliably cross-compile GUI bundles, and macOS
 *   codesigning/notarization requires Apple toolchain regardless.
 *
 *   Set TAURI_TARGET (e.g. "universal-apple-darwin") to pass --target through
 *   to `tauri build` — used for macOS universal binaries in CI.
 *
 * Requires:
 *   - Rust toolchain (cargo, rustc)
 *   - Tauri CLI (@tauri-apps/cli via bun)
 *   - Platform-specific system deps (webkit2gtk, etc. on Linux)
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { c, log, ok, warn } from '../cli_utils';
import { checkDeployCache, saveDeployCache } from './cache';
import type { AppConfig } from './deployment_config';
import { resolveChannel } from './deployment_config';
import { resolveProjectId, run, shortSha } from './utils';

// ── Final-artifact detection ──────────────────────────────────────────────
// tauri-bundler leaves a LOT of intermediate scaffolding under
// target/release/bundle (exploded .deb staging trees, control/data tarball
// components, AppDir contents used only to build other targets, etc). Only
// files matching these extensions, sitting directly inside one of the known
// target directories, are real installable outputs.

const KNOWN_TARGET_DIRS = new Set([
  'deb',
  'rpm',
  'appimage', // linux
  'msi',
  'nsis', // windows
  'dmg',
  'macos', // macos (macos/ holds .app.tar.gz + .sig updater artifacts)
  'updater', // auto-updater manifests
]);

const FINAL_ARTIFACT_SUFFIXES = [
  '.deb',
  '.rpm',
  '.appimage',
  '.msi',
  '.exe',
  '.dmg',
  '.app.tar.gz',
  '.sig',
] as const;

const isFinalArtifact = (fileName: string): boolean => {
  const lower = fileName.toLowerCase();
  return FINAL_ARTIFACT_SUFFIXES.some((suffix) => lower.endsWith(suffix));
};

/**
 * Walks target/release/bundle and returns only the final, distributable
 * artifacts — discarding intermediate staging files (control/data tarball
 * parts, exploded .deb trees, unused AppDir contents, etc).
 */
const collectFinalArtifacts = (bundleDir: string): { kept: string[]; skipped: number } => {
  const kept: string[] = [];
  let skipped = 0;

  const walk = (dir: string, targetDir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full, targetDir);
        continue;
      }
      if (KNOWN_TARGET_DIRS.has(targetDir) && isFinalArtifact(entry)) {
        kept.push(full);
      } else {
        skipped++;
      }
    }
  };

  for (const targetDir of readdirSync(bundleDir)) {
    const full = join(bundleDir, targetDir);
    if (statSync(full).isDirectory()) {
      walk(full, targetDir);
    }
  }

  return { kept, skipped };
};

/** linux / windows / macos, derived from the host running this script. */
const currentPlatformDir = (): 'linux' | 'windows' | 'macos' => {
  if (process.platform === 'win32') {
    return 'windows';
  }
  if (process.platform === 'darwin') {
    return 'macos';
  }
  return 'linux';
};

/**
 * Picks the single best canonical artifact for a given platform.
 * Priority order per platform:
 *   linux:   AppImage > deb > rpm
 *   windows: msi > exe
 *   macos:   dmg
 */
const pickCanonical = (artifacts: string[], platformDir: string): string | undefined => {
  const priorities: Record<string, string[]> = {
    linux: ['.appimage', '.deb', '.rpm'],
    windows: ['.msi', '.exe'],
    macos: ['.dmg'],
  };
  const order = priorities[platformDir] ?? [];
  for (const ext of order) {
    const found = artifacts.find((a) => a.toLowerCase().endsWith(ext));
    if (found) {
      return found;
    }
  }
  return undefined;
};

/**
 * Uploads all artifacts in ONE batched `gcloud storage cp -m` call (chunked
 * defensively in case the artifact count ever grows large enough to hit a
 * command-line length limit — not a concern today at 2-4 files, but cheap to
 * guard against). `gcloud storage cp -m` auto-parallelizes multi-file transfers
 * across threads/processes.
 */
const uploadArtifacts = (artifacts: string[], destPrefix: string): void => {
  const CHUNK_SIZE = 50;

  for (let i = 0; i < artifacts.length; i += CHUNK_SIZE) {
    const chunk = artifacts.slice(i, i + CHUNK_SIZE);
    const sources = chunk.map((f) => `"${f}"`).join(' ');
    run(`gcloud storage cp -m ${sources} "${destPrefix}/"`, { quiet: false });
  }
};

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
  const platformDir = currentPlatformDir();
  const releaseBucket = `gs://${projectId}.firebasestorage.app/tauri-releases/${appName}/${platformDir}`;
  const latestBucket = `gs://${projectId}.firebasestorage.app/tauri-releases/${appName}/latest/${platformDir}`;

  log(`\n${c.bold}🖥️  Building ${appName} Tauri desktop release${c.reset}`);
  log(`  Project:  ${projectId}`);
  log(`  Platform: ${platformDir} (${process.platform})`);
  log(`  App:      ${appRoot}`);
  log(`  Tauri:    ${tauriDir}\n`);

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
    const moonTarget = config.buildProject ?? appName;
    // env option is cross-platform — VAR=value prefix is bash-only and breaks on Windows
    run(`bunx moon run ${moonTarget}:build${modeFlag}`, {
      cwd: rootDir,
      env: { PUBLIC_APP_VERSION: ver },
    });

    if (!existsSync(buildDir)) {
      throw new Error(`Build directory not found: ${buildDir}. Build may have failed.`);
    }
  } else {
    log('🏗️  Web build already done, skipping...');
  }

  // 3. Build Tauri desktop app (native to whichever OS this script runs on).
  //    TAURI_TARGET env var (e.g. "universal-apple-darwin") passes --target
  //    through for macOS universal binary builds in CI.
  log(`🦀 Building Tauri desktop app${platformDir === 'macos' ? ' (universal binary)' : ''}...`);
  const tauriTarget = process.env.TAURI_TARGET;
  const targetFlag = tauriTarget ? ` -- --target ${tauriTarget}` : '';
  try {
    run(`bun run tauri build${targetFlag}`, { cwd: appRoot });
  } catch (err) {
    warn(`Tauri build failed: ${(err as Error).message}`);
    warn('Make sure Rust toolchain and system deps are installed.');
    warn('See: https://v2.tauri.app/start/prerequisites/');
    throw err;
  }

  // 4. Collect ONLY final, installable artifacts — see collectFinalArtifacts()
  const releaseDir = join(tauriDir, 'target/release');
  const bundleDir = join(releaseDir, 'bundle');

  if (!existsSync(bundleDir)) {
    warn('No bundle directory found — Tauri build may have produced nothing.');
    return;
  }

  const { kept: artifacts, skipped } = collectFinalArtifacts(bundleDir);

  if (artifacts.length === 0) {
    warn(
      'No final release artifacts found after filtering — Tauri build may have produced nothing installable.',
    );
    warn(
      `Check your tauri.conf.json "bundle.targets" — it must be "all" or list a target valid on ${platformDir}.`,
    );
    return;
  }

  log(
    `📦 Found ${artifacts.length} final artifact(s) (discarded ${skipped} intermediate build file(s)):`,
  );
  for (const art of artifacts) {
    log(`  • ${art}`);
  }

  // 5. Upload — single batched call with -m, gcloud auto-parallelizes
  log(`📤 Uploading ${artifacts.length} artifact(s) to ${releaseBucket}...`);
  uploadArtifacts(artifacts, releaseBucket);

  // Also upload to 'latest' pointer for auto-updater / CI consumption
  log(`🔄 Syncing artifacts to latest pointer: ${latestBucket}...`);
  uploadArtifacts(artifacts, latestBucket);

  // 5b. Upload canonical artifact to fixed channel path (stable/beta/alpha).
  //     The channel path never changes — only the bytes behind it do — so
  //     cdn.example.com/stable/linux always points to the latest production build.
  const channel = resolveChannel(mode);
  const canonical = pickCanonical(artifacts, platformDir);
  if (canonical) {
    const ext = canonical.slice(canonical.lastIndexOf('.'));
    const channelDest = `gs://${projectId}.firebasestorage.app/tauri-releases/${appName}/channel/${channel}/${platformDir}${ext}`;
    log(`📤 Uploading canonical artifact to ${channel} channel: ${channelDest}`);
    // Upload directly to the exact channel destination path
    run(`gcloud storage cp "${canonical}" "${channelDest}"`, { quiet: false });
    // Apply content-disposition metadata to the uploaded object
    run(
      `gcloud storage objects update --content-disposition="attachment; filename=Aikami-Setup${ext}" "${channelDest}"`,
      {},
    );
  }

  // 6. Save checksum on success
  await saveDeployCache(mode, appName, cache.checksum);
  ok(
    `${appName} Tauri release complete — ${artifacts.length} artifact(s) uploaded (${skipped} intermediate file(s) skipped)`,
  );
}
