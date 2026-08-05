import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { c, log, ok, warn } from '../cli_utils';
import { checkDeployCache, setTauriCache } from './cache';
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
 * Exported so ci_run.ts can reuse the exact same filtering (no duplication).
 */
export const collectFinalArtifacts = (bundleDir: string): { kept: string[]; skipped: number } => {
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
export const currentPlatformDir = (): 'linux' | 'windows' | 'macos' => {
  if (process.platform === 'win32') {
    return 'windows';
  }
  if (process.platform === 'darwin') {
    return 'macos';
  }
  return 'linux';
};

/** Read the app version from src-tauri/Cargo.toml (falls back to '0.0.0'). */
export const readCargoVersion = (tauriDir: string): string => {
  try {
    const cargoToml = join(tauriDir, 'Cargo.toml');
    const cargoContent = readFileSync(cargoToml, 'utf8');
    const versionMatch = cargoContent.match(/version\s*=\s*"([^"]+)"/);
    if (versionMatch?.[1]) {
      return versionMatch[1];
    }
  } catch {
    // Fallback — keep default
  }
  return '0.0.0';
};

export type TauriBuildResult = {
  /** Absolute paths to the final distributable artifacts. */
  artifacts: string[];
  /** Cargo.toml version. */
  version: string;
  /** Host platform dir (linux/windows/macos). */
  platformDir: 'linux' | 'windows' | 'macos';
  /** Absolute path to target/release/bundle. */
  bundleDir: string;
};

export type TauriBuildOptions = {
  /** Override the bundle targets (e.g. "appimage" for a debug run). Defaults to TAURI_BUNDLE_TARGETS env. */
  bundles?: string;
  /**
   * Skip the web rebuild via `--config {"build":{"beforeBuildCommand":""}}`.
   * Used by ci_run.ts, where the shared web build was already produced by the
   * build-web job and downloaded to apps/frontend/client/build. The config
   * override is written to a temp file (cross-platform safe — the tauri CLI
   * accepts a path to a JSON config to merge; inline JSON quoting breaks under
   * cmd.exe on Windows).
   */
  disableBeforeBuildCommand?: boolean;
};

/**
 * Build the Tauri desktop app and collect the final installer artifacts.
 * Shared by the local pipeline (deployTauriRelease) and the CI per-leg runner
 * (ci_run.ts). Does NOT touch the deploy cache — callers decide skip/reuse.
 */
export async function buildTauriArtifacts(
  config: AppConfig,
  mode: string,
  rootDir: string,
  opts: TauriBuildOptions = {},
): Promise<TauriBuildResult> {
  const appRoot = join(rootDir, config.path);
  const tauriDir = join(appRoot, 'src-tauri');
  const platformDir = currentPlatformDir();

  // 1. Verify Tauri directory exists
  if (!existsSync(tauriDir)) {
    throw new Error(`No src-tauri directory found at ${tauriDir}.`);
  }

  // 2. Verify web build exists (produced by Phase 1 locally, or downloaded
  // from the build-web job artifact in CI — see release.yml).
  const buildDir = join(appRoot, 'build');
  if (!existsSync(buildDir)) {
    throw new Error(
      `Build directory not found at ${buildDir}. Ensure the web build ran before the Tauri build.`,
    );
  }

  // 3. Build Tauri desktop app
  log(`🦀 Building Tauri desktop app${platformDir === 'macos' ? ' (universal binary)' : ''}...`);
  const tauriTarget = process.env.TAURI_TARGET;
  const targetFlag = tauriTarget ? ` -- --target ${tauriTarget}` : '';
  // Explicit bundles win; otherwise TAURI_BUNDLE_TARGETS env (set by the
  // workflow); otherwise tauri.conf.json defaults.
  const bundleTargets = opts.bundles ?? process.env.TAURI_BUNDLE_TARGETS;
  const bundlesFlag = bundleTargets ? ` --bundles ${bundleTargets}` : '';

  let configOverridePath: string | undefined;
  let configFlag = '';
  if (opts.disableBeforeBuildCommand) {
    configOverridePath = join(tmpdir(), `tauri-ci-override-${process.pid}.json`);
    writeFileSync(configOverridePath, JSON.stringify({ build: { beforeBuildCommand: '' } }));
    configFlag = ` --config ${configOverridePath}`;
  }

  try {
    // Forward the deploy mode to the Tauri beforeBuildCommand (build:tauri →
    // vite build --mode {mode}). Without this, the desktop web bundle would
    // always be built with production PUBLIC_ vars even on staging runs.
    process.env.TAURI_BUILD_MODE = mode;
    // live: stream cargo output so CI watchers see build progress instead of
    // minutes of silence while the ~15-25min Tauri compile runs.
    run(`bun run tauri build${configFlag}${targetFlag}${bundlesFlag}`, {
      cwd: appRoot,
      live: true,
    });
  } catch (err) {
    warn(`Tauri build failed: ${(err as Error).message}`);
    warn('Make sure Rust toolchain and system deps are installed.');
    warn('See: https://v2.tauri.app/start/prerequisites/');
    throw err;
  } finally {
    if (configOverridePath) {
      try {
        unlinkSync(configOverridePath);
      } catch {
        // Best-effort cleanup
      }
    }
  }

  // 4. Collect final artifacts
  const bundleDir = join(tauriDir, 'target/release/bundle');
  if (!existsSync(bundleDir)) {
    throw new Error('No bundle directory found — Tauri build produced nothing.');
  }

  const { kept: artifacts, skipped } = collectFinalArtifacts(bundleDir);

  if (artifacts.length === 0) {
    throw new Error('No final release artifacts found after filtering.');
  }

  log(
    `📦 Found ${artifacts.length} final artifact(s) (discarded ${skipped} intermediate build file(s)):`,
  );
  for (const art of artifacts) {
    log(`  • ${art}`);
  }

  return {
    artifacts,
    version: readCargoVersion(tauriDir),
    platformDir,
    bundleDir,
  };
}

/**
 * Upload the built artifacts to a GitHub Release (RELEASE_TAG env). Loud on
 * failure — a failed upload means the release ships with no desktop binaries.
 */
export function uploadArtifactsToRelease(releaseTag: string, artifacts: string[]): void {
  log(`\n📤 Publishing to GitHub Release ${c.cyan}${releaseTag}${c.reset}...`);
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
}

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

  // 1-4. Build + collect (shared with ci_run.ts)
  const {
    artifacts,
    version: ver,
    bundleDir,
  } = await buildTauriArtifacts(config, appName, mode, rootDir);

  // 5. Publish artifacts
  // A real GitHub Release only exists when this run was triggered by
  // `release: published` — the workflow sets RELEASE_TAG in that case only.
  // workflow_dispatch / staging runs have no tag to attach to; the
  // workflow's own actions/upload-artifact step is the distribution path
  // for those (see .github/workflows/release.yml).
  if (releaseTag) {
    uploadArtifactsToRelease(releaseTag, artifacts);
  } else if (process.env.CI === 'true') {
    log(
      `  ${c.dim}No RELEASE_TAG set (workflow_dispatch run) — skipping Release upload.${c.reset}`,
    );
    log(`  ${c.dim}Artifacts remain on disk for the workflow's upload-artifact step.${c.reset}`);
  } else {
    log(`  ${c.dim}Local build — artifacts left on disk, nothing published:${c.reset}`);
    log(`  ${c.dim}${bundleDir}${c.reset}`);
  }

  // 6. Save cache on success (new JSON schema — tauri-release only)
  await setTauriCache(mode, {
    checksum,
    version: ver,
    releaseTag: releaseTag ?? null,
    builtAt: new Date().toISOString(),
  });
  ok(
    `${appName} Tauri release complete — v${ver} (${platformDir}, ${artifacts.length} artifact(s))`,
  );
}
