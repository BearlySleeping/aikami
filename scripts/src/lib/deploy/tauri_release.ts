import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { c, log, ok, warn } from '../cli_utils';
import { checkDeployCache, saveDeployCache } from './cache';
import type { AppConfig } from './deployment_config';
import { isVerbose, resolveProjectId, run } from './utils';

// ── Final-artifact detection ──────────────────────────────────────────────
const KNOWN_TARGET_DIRS = new Set([
  'deb',
  'rpm',
  'appimage', // linux
  'msi',
  'nsis', // windows
  'dmg',
  'macos', // macos (.app.tar.gz + .sig updater artifacts)
  'updater', // auto-updater manifests
]);

const FINAL_ARTIFACT_SUFFIXES = [
  '.app.tar.gz',
  '.deb',
  '.rpm',
  '.appimage',
  '.msi',
  '.exe',
  '.dmg',
  '.sig',
  '.json',
] as const;

const isFinalArtifact = (fileName: string): boolean => {
  const lower = fileName.toLowerCase();
  return FINAL_ARTIFACT_SUFFIXES.some((suffix) => lower.endsWith(suffix));
};

/**
 * Creates wrapper scripts for Tauri's cached linuxdeploy AppImages.
 * On NixOS + steam-run, the wrappers ensure APPIMAGE_EXTRACT_AND_RUN=1
 * is set and shebangs use /usr/bin/env (steam-run lacks /bin/sh).
 * Safe to call repeatedly — skips if wrappers are already in place.
 */
const LINUXDEPLOY_WRAPPER_MARKER = '#!/usr/bin/env sh';

const setupLinuxdeployWrappers = (): void => {
  const cacheDir = join(homedir(), '.cache', 'tauri');
  const appImages = ['linuxdeploy-x86_64.AppImage', 'linuxdeploy-plugin-appimage.AppImage'];

  for (const name of appImages) {
    const wrapper = join(cacheDir, name);
    const real = join(cacheDir, `${name}.real`);

    // Already wrapped — skip
    if (existsSync(wrapper)) {
      try {
        const head = readFileSync(wrapper, 'utf8').slice(0, LINUXDEPLOY_WRAPPER_MARKER.length);
        if (head === LINUXDEPLOY_WRAPPER_MARKER) {
          continue;
        }
      } catch {
        // Corrupt — recreate below
      }
    }

    // If .real doesn't exist yet, rename the original
    if (existsSync(wrapper) && !existsSync(real)) {
      const head = readFileSync(wrapper, 'utf8').slice(0, 2);
      if (head === '#!') {
        // Already a wrapper but with wrong shebang — fix it
      } else {
        // Original AppImage — move aside
        try {
          execSync(`mv "${wrapper}" "${real}"`, { stdio: 'ignore' });
        } catch {
          // mv failed — skip this one
          continue;
        }
      }
    }

    // Only create wrapper if .real exists (cold cache: linuxdeploy will bootstrap it)
    if (!existsSync(real)) {
      continue;
    }

    // Create wrapper script
    writeFileSync(
      wrapper,
      `${LINUXDEPLOY_WRAPPER_MARKER}\nexport APPIMAGE_EXTRACT_AND_RUN=1\nexec "$(dirname "$0")/${name}.real" "$@"\n`,
      { mode: 0o755 },
    );
  }
};

/**
 * Walks target/release/bundle and returns only final distributable artifacts.
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

/** linux / windows / macos, derived from host OS */
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
 * Safely extracts extensions including compound suffixes like .app.tar.gz
 */
const getArtifactExtension = (filename: string): string => {
  const lower = filename.toLowerCase();
  const matched = FINAL_ARTIFACT_SUFFIXES.find((suffix) => lower.endsWith(suffix));
  if (matched) {
    return matched;
  }
  const lastDot = filename.lastIndexOf('.');
  return lastDot !== -1 ? filename.slice(lastDot) : '';
};

export async function deployTauriRelease(
  config: AppConfig,
  appName: string,
  mode: string,
  rootDir: string,
  _version: string,
  isForce = false,
  preflightChecksum?: string,
): Promise<void> {
  const projectId = resolveProjectId(mode);
  const appRoot = join(rootDir, config.path);
  const tauriDir = join(appRoot, 'src-tauri');
  const platformDir = currentPlatformDir();
  const basePath = `gs://${projectId}.firebasestorage.app/tauri-releases/${appName}`;

  log(`\n${c.bold}🖥️  Building ${appName} Tauri desktop release${c.reset}`);
  log(`  Project:  ${projectId}`);
  log(`  Platform: ${platformDir} (${process.platform})`);
  log(`  App:      ${appRoot}`);
  log(`  Tauri:    ${tauriDir}\n`);

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
      ok(`${appName} Tauri release skipped (unchanged — cache hit: ${cache.source})`);
      return;
    }
    checksum = cache.checksum;
  }

  // 1. Verify Tauri directory exists
  if (!existsSync(tauriDir)) {
    warn(`No src-tauri directory found at ${tauriDir}. Skipping Tauri build.`);
    return;
  }

  // 2. Verify web build exists (built in Phase 1)
  const buildDir = join(appRoot, 'build');
  if (!existsSync(buildDir)) {
    throw new Error(
      `Build directory not found at ${buildDir}. Ensure Phase 1 web build ran successfully.`,
    );
  }

  // 3. Build Tauri desktop app
  log(`🦀 Building Tauri desktop app${platformDir === 'macos' ? ' (universal binary)' : ''}...`);
  const tauriTarget = process.env.TAURI_TARGET;
  const targetFlag = tauriTarget ? ` -- --target ${tauriTarget}` : '';
  // TAURI_BUNDLE_TARGETS env var overrides bundle targets (e.g. "appimage,deb,rpm" on CI)
  const bundleTargets = process.env.TAURI_BUNDLE_TARGETS;
  let bundlesFlag = '';
  if (bundleTargets) {
    // Validate bundle targets to prevent shell injection
    const validTargets = /^[a-z0-9_-]+(?:,\s*[a-z0-9_-]+)*$/i;
    if (!validTargets.test(bundleTargets)) {
      throw new Error(
        `Invalid TAURI_BUNDLE_TARGETS format: "${bundleTargets}". Must be comma-separated list of alphanumeric/dash/underscore target names.`,
      );
    }
    bundlesFlag = ` --bundles ${bundleTargets}`;
  }

  // On NixOS, Tauri's AppImage bundler hardcodes /usr/bin/xdg-open.
  // steam-run provides an FHS-compatible environment where it exists.
  // We also create wrapper scripts for cached linuxdeploy AppImages whose
  // shebangs need /usr/bin/env (not /bin/sh) inside steam-run.
  const xdgOpenPath = '/usr/bin/xdg-open';
  const needsXdgWrapper = platformDir === 'linux' && !existsSync(xdgOpenPath);
  let tauriBuildCmd = `bun run tauri build${targetFlag}${bundlesFlag}`;
  let tauriEnv: Record<string, string> | undefined;
  if (needsXdgWrapper) {
    try {
      execSync('which steam-run', { encoding: 'utf8', stdio: 'ignore' });
      setupLinuxdeployWrappers();
      tauriBuildCmd = `steam-run ${tauriBuildCmd}`;
      tauriEnv = { APPIMAGE_EXTRACT_AND_RUN: '1' };
      log(`  🐧 NixOS: wrapping with steam-run to provide ${xdgOpenPath}`);
    } catch {
      warn(`  ${xdgOpenPath} not found and steam-run unavailable.`);
      warn('  Install steam-run or run: sudo ln -sf $(which xdg-open) /usr/bin/xdg-open');
    }
  }

  try {
    run(tauriBuildCmd, { cwd: appRoot, env: tauriEnv });
  } catch (err) {
    warn(`Tauri build failed: ${(err as Error).message}`);
    warn('Make sure Rust toolchain and system deps are installed.');
    warn('See: https://v2.tauri.app/start/prerequisites/');
    throw err;
  }

  // 4. Collect final artifacts
  const releaseDir = join(tauriDir, 'target/release');
  const bundleDir = join(releaseDir, 'bundle');

  if (!existsSync(bundleDir)) {
    warn('No bundle directory found — Tauri build produced nothing.');
    return;
  }

  const { kept: artifacts, skipped } = collectFinalArtifacts(bundleDir);

  if (artifacts.length === 0) {
    warn('No final release artifacts found after filtering.');
    warn(`Check bundle.targets in tauri.conf.json for ${platformDir}.`);
    return;
  }

  log(
    `📦 Found ${artifacts.length} final artifact(s) (discarded ${skipped} intermediate build file(s)):`,
  );
  for (const art of artifacts) {
    log(`  • ${art}`);
  }

  // 5. Upload all final artifacts
  // Read version from Cargo.toml
  let ver = '0.0.0';
  try {
    const cargoToml = join(tauriDir, 'Cargo.toml');
    const cargoContent = readFileSync(cargoToml, 'utf8');
    const versionMatch = cargoContent.match(/version\s*=\s*"([^"]+)"/);
    if (versionMatch?.[1]) {
      ver = versionMatch[1];
    }
  } catch {
    // Fallback — keep default
  }

  for (const artifact of artifacts) {
    const ext = getArtifactExtension(artifact);

    // Upload to versioned path
    const versionDest = `${basePath}/versions/${ver}/${platformDir}${ext}`;
    log(`📤 Versioned release: ${versionDest}`);
    run(`gcloud storage cp "${artifact}" "${versionDest}"`, { quiet: false });
    run(
      `gcloud storage objects update "${versionDest}" --add-acl-grant=entity=allUsers,role=READER --content-disposition="attachment; filename=Aikami-${ver}${ext}"`,
      {},
    );

    // Always update latest pointer
    const latestDest = `${basePath}/latest/${platformDir}${ext}`;
    log(`📤 Latest pointer: ${latestDest}`);
    run(`gcloud storage cp "${artifact}" "${latestDest}"`, { quiet: false });
    run(
      `gcloud storage objects update "${latestDest}" --add-acl-grant=entity=allUsers,role=READER --content-disposition="attachment; filename=Aikami-latest${ext}"`,
      {},
    );

    // Production deploys also update stable pointer
    if (mode === 'production') {
      const stableDest = `${basePath}/stable/${platformDir}${ext}`;
      log(`📤 Stable pointer: ${stableDest}`);
      run(`gcloud storage cp "${artifact}" "${stableDest}"`, { quiet: false });
      run(
        `gcloud storage objects update "${stableDest}" --add-acl-grant=entity=allUsers,role=READER --content-disposition="attachment; filename=Aikami-stable${ext}"`,
        {},
      );
    }
  }

  // 6. Save cache on success (use Cargo.toml version for Tauri releases)
  await saveDeployCache(mode, appName, checksum, ver);
  ok(
    `${appName} Tauri release complete — v${ver} (${platformDir}, ${artifacts.length} artifact(s))`,
  );
}
