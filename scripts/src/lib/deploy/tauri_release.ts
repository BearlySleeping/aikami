// scripts/src/lib/deploy/tauri_release.ts
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
import { buildPlatformFragment, writeFragmentFile } from './updater_manifest';
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
  '.zip',
] as const;

const isFinalArtifact = (fileName: string): boolean => {
  const lower = fileName.toLowerCase();
  return FINAL_ARTIFACT_SUFFIXES.some((suffix) => lower.endsWith(suffix));
};

/**
 * Walks target/release/bundle and returns only final distributable artifacts.
 * Skips uncompressed .app bundle directories on macOS to avoid scanning thousands of internal assets.
 */
export const collectFinalArtifacts = (bundleDir: string): { kept: string[]; skipped: number } => {
  const kept: string[] = [];
  let skipped = 0;

  const walk = (dir: string, targetDir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);

      if (stat.isDirectory()) {
        // Skip walking inside raw .app bundle directories on macOS
        if (entry.endsWith('.app')) {
          skipped++;
          continue;
        }
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

/** Read the app version from src-tauri/Cargo.toml [package] section. */
export const readCargoVersion = (tauriDir: string): string => {
  const cargoToml = join(tauriDir, 'Cargo.toml');
  let cargoContent: string;
  try {
    cargoContent = readFileSync(cargoToml, 'utf8');
  } catch (err) {
    throw new Error(
      `Failed to read Cargo.toml at ${cargoToml}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const packageMatch = cargoContent.match(/^\[package\]\s*$(.*?)(?=^\[|\n\n|$)/ms);
  if (!packageMatch) {
    throw new Error(`[package] section not found in ${cargoToml}`);
  }
  const packageSection = packageMatch[1];
  const versionMatch = packageSection.match(/^\s*version\s*=\s*"([^"]+)"/m);
  if (!versionMatch?.[1]) {
    throw new Error(`version field not found in [package] section of ${cargoToml}`);
  }
  return versionMatch[1];
};

export type TauriBuildResult = {
  artifacts: string[];
  version: string;
  platformDir: 'linux' | 'windows' | 'macos';
  bundleDir: string;
};

export type TauriBuildOptions = {
  bundles?: string;
  disableBeforeBuildCommand?: boolean;
};

export async function buildTauriArtifacts(
  config: AppConfig,
  mode: string,
  rootDir: string,
  opts: TauriBuildOptions = {},
): Promise<TauriBuildResult> {
  const appRoot = join(rootDir, config.path);
  const tauriDir = join(appRoot, 'src-tauri');
  const platformDir = currentPlatformDir();

  if (!existsSync(tauriDir)) {
    throw new Error(`No src-tauri directory found at ${tauriDir}.`);
  }

  const buildDir = join(appRoot, 'build');
  if (!existsSync(buildDir)) {
    throw new Error(
      `Build directory not found at ${buildDir}. Ensure the web build ran before the Tauri build.`,
    );
  }

  log(`🦀 Building Tauri desktop app${platformDir === 'macos' ? ' (universal binary)' : ''}...`);
  const tauriTarget = process.env.TAURI_TARGET;
  const targetFlag = tauriTarget ? ` -- --target ${tauriTarget}` : '';
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
    process.env.TAURI_BUILD_MODE = mode;
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

/** Upload artifacts to a GitHub Release in a single batched `gh` call. */
export function uploadArtifactsToRelease(releaseTag: string, artifacts: string[]): void {
  if (artifacts.length === 0) return;
  log(`\n📤 Publishing ${artifacts.length} artifact(s) to GitHub Release ${c.cyan}${releaseTag}${c.reset}...`);

  const quotedArtifacts = artifacts.map((a) => `"${a}"`).join(' ');
  try {
    run(`gh release upload "${releaseTag}" ${quotedArtifacts} --clobber`, { quiet: false });
  } catch (err) {
    throw new Error(
      `Failed to upload artifacts to GitHub Release ${releaseTag}:\n${(err as Error).message}`,
    );
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

  const {
    artifacts,
    version: ver,
    bundleDir,
  } = await buildTauriArtifacts(config, mode, rootDir, {});

  if (releaseTag) {
    uploadArtifactsToRelease(releaseTag, artifacts);
    writeFragmentFile(
      platformDir,
      buildPlatformFragment({ platform: platformDir, artifactPaths: artifacts, releaseTag }),
    );
  } else if (process.env.CI === 'true') {
    log(
      `  ${c.dim}No RELEASE_TAG set (workflow_dispatch run) — skipping Release upload.${c.reset}`,
    );
    log(`  ${c.dim}Artifacts remain on disk for the workflow's upload-artifact step.${c.reset}`);
  } else {
    log(`  ${c.dim}Local build — artifacts left on disk, nothing published:${c.reset}`);
    log(`  ${c.dim}${bundleDir}${c.reset}`);
  }

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
