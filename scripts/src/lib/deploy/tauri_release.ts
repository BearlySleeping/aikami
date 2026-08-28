import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { c, log, ok, warn } from '../cli_utils';
import { checkDeployCache, setTauriCache } from './cache';
import { type AppConfig, liveModes } from './deployment_config';
import { notifyDiscordRelease } from './discord_notify';
import { buildPlatformFragment, writeFragmentFile } from './updater_manifest';
import { isVerbose, run } from './utils';

// ── Canonical artifact naming ─────────────────────────────────────────────
//
// Tauri names bundles `<ProductName>_<version>_<arch>.<ext>` (e.g.
// `Aikami_0.1.0_amd64.AppImage`). The release tag/URL already carries the
// version, so release assets are renamed to stable, lowercase names —
// `aikami.appimage`, `aikami.deb`, `aikami.msi`, … — that never change
// between releases. `.sig` updater signatures are renamed alongside so the
// updater can resolve `<artifact>.sig` next to the artifact.

const CANONICAL_ARTIFACT_NAME = 'aikami';

const ARTIFACT_EXTENSION_RULES: ReadonlyArray<{ suffix: string; ext: string }> = [
  { suffix: '.app.tar.gz', ext: '.app.tar.gz' },
  { suffix: '.AppImage', ext: '.appimage' },
  { suffix: '.deb', ext: '.deb' },
  { suffix: '.rpm', ext: '.rpm' },
  { suffix: '.msi', ext: '.msi' },
  { suffix: '.dmg', ext: '.dmg' },
  { suffix: '.exe', ext: '.exe' },
];

/** Map a Tauri bundle file name to its canonical release name, or null when unknown. */
const canonicalArtifactName = (fileName: string): string | null => {
  const isSig = fileName.toLowerCase().endsWith('.sig');
  const base = isSig ? fileName.slice(0, -'.sig'.length) : fileName;
  for (const rule of ARTIFACT_EXTENSION_RULES) {
    if (base.endsWith(rule.suffix)) {
      return `${CANONICAL_ARTIFACT_NAME}${rule.ext}${isSig ? '.sig' : ''}`;
    }
  }
  return null;
};

/** Rename final artifacts to canonical names in place; returns updated paths. */
const normalizeArtifactNames = (artifacts: readonly string[]): string[] => {
  const normalized: string[] = [];
  for (const artifact of artifacts) {
    const canonical = canonicalArtifactName(basename(artifact));
    if (!canonical || canonical === basename(artifact)) {
      normalized.push(artifact);
      continue;
    }
    const dest = join(dirname(artifact), canonical);
    renameSync(artifact, dest);
    log(`  ${c.dim}renamed ${basename(artifact)} → ${canonical}${c.reset}`);
    normalized.push(dest);
  }
  return normalized;
};

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
  '.zip', // updater archives (.msi.zip / .nsis.zip) when createUpdaterArtifacts is "v1Compatible"
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
  /** The version actually embedded in the built bundle (see `versionOverride`). */
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
  /**
   * Version to embed in the built bundle, overriding both Cargo.toml and
   * tauri.conf.json's checked-in "version" — passed as a `--config` override
   * so it never requires a commit to cut a release. `ci_run.ts` derives this
   * from RELEASE_TAG (stripped of its leading "v") on `release: published`
   * runs; omitted on workflow_dispatch / local builds, which keep using
   * Cargo.toml's committed version as before.
   */
  versionOverride?: string;
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
  // Explicit bundles win; otherwise TAURI_BUNDLE_TARGETS env (set by the
  // workflow); otherwise tauri.conf.json defaults.
  const bundleTargets = opts.bundles ?? process.env.TAURI_BUNDLE_TARGETS;
  const bundlesFlag = bundleTargets ? ` --bundles ${bundleTargets}` : '';
  // `--target` is a top-level tauri build flag (e.g. universal-apple-darwin).
  // It must NOT go after `--` — everything after `--` is forwarded to cargo,
  // which rejects tauri's own flags ("unexpected argument '--bundles'").
  const targetFlag = tauriTarget ? ` --target ${tauriTarget}` : '';

  // Normalized once so an empty/whitespace-only string (e.g. a malformed
  // release tag stripped down to nothing) is treated the same as "no
  // override" everywhere below, rather than a truthy-check on the raw opt.
  const normalizedVersionOverride = opts.versionOverride?.trim() || undefined;

  const configOverride: {
    version?: string;
    build?: { beforeBuildCommand: string };
    bundle?: { createUpdaterArtifacts: boolean };
  } = {};
  if (opts.disableBeforeBuildCommand) {
    configOverride.build = { beforeBuildCommand: '' };
  }
  // Updater artifact signing only for real releases (staging/production) —
  // tauri.conf.json's static default stays `false` so a plain `bun tauri
  // build` (emulator/local, no TAURI_SIGNING_PRIVATE_KEY configured) keeps
  // working for any contributor without desktop-release secrets.
  if ((liveModes as readonly string[]).includes(mode)) {
    configOverride.bundle = { createUpdaterArtifacts: true };
  }
  if (normalizedVersionOverride !== undefined) {
    configOverride.version = normalizedVersionOverride;
  }

  let configOverridePath: string | undefined;
  let configFlag = '';
  if (Object.keys(configOverride).length > 0) {
    configOverridePath = join(tmpdir(), `tauri-build-override-${process.pid}.json`);
    writeFileSync(configOverridePath, JSON.stringify(configOverride));
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

  // 4. Collect final artifacts. With `--target <triple>` cargo places the
  // bundle under target/<triple>/release/bundle (e.g.
  // universal-apple-darwin) instead of target/release/bundle.
  const bundleSubdir = tauriTarget
    ? `target/${tauriTarget}/release/bundle`
    : 'target/release/bundle';
  const bundleDir = join(tauriDir, bundleSubdir);
  if (!existsSync(bundleDir)) {
    throw new Error('No bundle directory found — Tauri build produced nothing.');
  }

  const { kept: artifacts, skipped } = collectFinalArtifacts(bundleDir);

  if (artifacts.length === 0) {
    throw new Error('No final release artifacts found after filtering.');
  }

  // Canonical artifact names (aikami.appimage, aikami.deb, …) so release
  // assets stay stable across versions — the version lives in the tag/URL.
  const finalArtifacts = normalizeArtifactNames(artifacts);

  log(
    `📦 Found ${finalArtifacts.length} final artifact(s) (discarded ${skipped} intermediate build file(s)):`,
  );
  for (const art of finalArtifacts) {
    log(`  • ${art}`);
  }

  return {
    artifacts: finalArtifacts,
    version: normalizedVersionOverride ?? readCargoVersion(tauriDir),
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

  // 1-4. Build + collect (shared with ci_run.ts). When this local pipeline is
  // itself publishing to a real GitHub Release (RELEASE_TAG set — see step 5
  // below), derive the embedded version from the tag the same way ci_run.ts
  // does, so a manually-run `RELEASE_TAG=v0.1.1 bun run deploy ... client-tauri`
  // embeds the same version its own uploaded latest.json will claim.
  const versionOverride = releaseTag ? releaseTag.replace(/^v/, '') : undefined;
  const {
    artifacts,
    version: ver,
    bundleDir,
  } = await buildTauriArtifacts(config, mode, rootDir, { versionOverride });

  // 5. Publish artifacts
  // A real GitHub Release only exists when this run was triggered by
  // `release: published` — the workflow sets RELEASE_TAG in that case only.
  // workflow_dispatch / staging runs have no tag to attach to; the
  // workflow's own actions/upload-artifact step is the distribution path
  // for those (see .github/workflows/release.yml).
  if (releaseTag) {
    uploadArtifactsToRelease(releaseTag, artifacts);
    // Updater fragment — the CI update-manifest job merges these into
    // latest.json on the release.
    writeFragmentFile(
      platformDir,
      buildPlatformFragment({ platform: platformDir, artifactPaths: artifacts, releaseTag }),
    );
    // CI's desktop matrix has its own dedicated notify-discord job (it waits
    // for every platform leg first), so this in-process announce is LOCAL-only
    // — with RELEASE_TAG set in CI, every matrix leg would otherwise post a
    // duplicate announcement. Never let a Discord hiccup fail a deploy that
    // already succeeded — the release itself is what matters.
    if (process.env.CI !== 'true') {
      try {
        await notifyDiscordRelease(releaseTag, mode);
      } catch (err) {
        warn(
          `Discord announcement failed (release itself is unaffected): ${(err as Error).message}`,
        );
      }
    }
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
