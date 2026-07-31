import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { c, log, ok, warn } from '../cli_utils';
import { checkDeployCache, saveDeployCache } from './cache';
import type { AppConfig } from './deployment_config';
import { isVerbose, run } from './utils';

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

export async function deployTauriRelease(
  config: AppConfig,
  appName: string,
  mode: string,
  rootDir: string,
  _version: string,
  isForce = false,
  preflightChecksum?: string,
): Promise<void> {
  const appRoot = join(rootDir, config.path);
  const tauriDir = join(appRoot, 'src-tauri');
  const platformDir = currentPlatformDir();

  log(`\n${c.bold}🖥️  Building ${appName} Tauri desktop release${c.reset}`);
  log(`  Mode:     ${mode}`);
  log(`  Platform: ${platformDir} (${process.platform})`);
  log(`  App:      ${appRoot}`);
  log(`  Tauri:    ${tauriDir}\n`);

  // 0. Checksum cache — use pre-flight checksum when available
  // Extract RELEASE_TAG early for cache key consistency
  const releaseTag = process.env.RELEASE_TAG?.trim();

  let checksum: string;
  if (preflightChecksum !== undefined) {
    checksum = preflightChecksum;
    if (isVerbose()) {
      log(`  Using pre-flight checksum: ${checksum.slice(0, 16)}...`);
    }
  } else {
    const cache = await checkDeployCache(config, appName, mode, rootDir, isForce, releaseTag);
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
  const bundlesFlag = bundleTargets ? ` --bundles ${bundleTargets}` : '';

  try {
    run(`bun run tauri build${targetFlag}${bundlesFlag}`, { cwd: appRoot });
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

  // 5. Publish artifacts
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

  // A real GitHub Release only exists when this run was triggered by
  // `release: published` — the workflow sets RELEASE_TAG in that case only.
  // workflow_dispatch / staging runs have no tag to attach to; the
  // workflow's own actions/upload-artifact step is the distribution path
  // for those (see .github/workflows/release.yml).

  if (releaseTag) {
    log(`\n📤 Publishing to GitHub Release ${c.cyan}${releaseTag}${c.reset}...`);
    // gh CLI reads auth from GH_TOKEN, set by the workflow from
    // secrets.GITHUB_TOKEN. This is intentionally NOT wrapped in a
    // warn-and-continue like the build step above — a failed upload here
    // means the release silently ships with no desktop binaries attached,
    // which should fail the job loudly, not degrade quietly.
    for (const artifact of artifacts) {
      // --clobber makes this idempotent: safe to re-run the same release
      // (e.g. after a --force rebuild) without a "asset already exists" error.
      try {
        run(`gh release upload "${releaseTag}" "${artifact}" --clobber`, { quiet: false });
      } catch (err) {
        throw new Error(
          `Failed to upload artifact to GitHub Release ${releaseTag}: ${artifact}\n${(err as Error).message}`,
        );
      }
    }
    ok(`  Uploaded ${artifacts.length} artifact(s) to release ${releaseTag}`);
  } else if (process.env.CI === 'true') {
    log(
      `  ${c.dim}No RELEASE_TAG set (workflow_dispatch run) — skipping Release upload.${c.reset}`,
    );
    log(`  ${c.dim}Artifacts remain on disk for the workflow's upload-artifact step.${c.reset}`);
  } else {
    log(`  ${c.dim}Local build — artifacts left on disk, nothing published:${c.reset}`);
    log(`  ${c.dim}${bundleDir}${c.reset}`);
  }

  // 6. Save cache on success (use Cargo.toml version for Tauri releases)
  await saveDeployCache(mode, appName, checksum, ver, releaseTag);
  ok(
    `${appName} Tauri release complete — v${ver} (${platformDir}, ${artifacts.length} artifact(s))`,
  );
}
