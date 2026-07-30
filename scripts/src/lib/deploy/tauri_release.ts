import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { c, log, ok, warn } from '../cli_utils';
import { checkDeployCache, saveDeployCache } from './cache';
import type { AppConfig } from './deployment_config';
import { resolveProjectId, run } from './utils';

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

/**
 * Picks canonical release binary for a platform.
 */
const pickCanonical = (artifacts: string[], platformDir: string): string | undefined => {
  const priorities: Record<string, string[]> = {
    linux: ['.appimage', '.deb', '.rpm'],
    windows: ['.msi', '.exe'],
    macos: ['.dmg', '.app.tar.gz'],
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
  isForce = false,
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

  // 0. Checksum cache — skip if unchanged
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
  try {
    run(`bun run tauri build${targetFlag}`, { cwd: appRoot });
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

  // 5. Upload canonical artifact with fixed name
  const canonical = pickCanonical(artifacts, platformDir);
  if (!canonical) {
    warn('No canonical artifact found for this platform — skipping upload.');
    return;
  }

  const ext = getArtifactExtension(canonical);

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

  // Upload to versioned path
  const versionDest = `${basePath}/versions/${ver}/${platformDir}${ext}`;
  log(`📤 Versioned release: ${versionDest}`);
  run(`gcloud storage cp "${canonical}" "${versionDest}" --add-acl-grant=entity=allUsers,role=READER`, { quiet: false });
  run(
    `gcloud storage objects update --content-disposition="attachment; filename=Aikami-${ver}${ext}" "${versionDest}"`,
    {},
  );

  // Always update latest pointer
  const latestDest = `${basePath}/latest/${platformDir}${ext}`;
  log(`📤 Latest pointer: ${latestDest}`);
  run(`gcloud storage cp "${canonical}" "${latestDest}" --add-acl-grant=entity=allUsers,role=READER`, { quiet: false });
  run(
    `gcloud storage objects update --content-disposition="attachment; filename=Aikami-latest${ext}" "${latestDest}"`,
    {},
  );

  // Production deploys also update stable pointer
  if (mode === 'production') {
    const stableDest = `${basePath}/stable/${platformDir}${ext}`;
    log(`📤 Stable pointer: ${stableDest}`);
    run(`gcloud storage cp "${canonical}" "${stableDest}" --add-acl-grant=entity=allUsers,role=READER`, { quiet: false });
    run(
      `gcloud storage objects update --content-disposition="attachment; filename=Aikami-stable${ext}" "${stableDest}"`,
      {},
    );
  }

  // 6. Save cache on success
  await saveDeployCache(mode, appName, cache.checksum);
  ok(
    `${appName} Tauri release complete — v${ver} (${platformDir}${ext})`,
  );
}
