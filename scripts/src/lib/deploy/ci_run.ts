#!/usr/bin/env bun
// scripts/src/lib/deploy/ci_run.ts
//
// CI-only per-leg executor for the Tauri desktop release. Runs once per
// deploy-desktop matrix leg, with the leg decision already made by the `plan`
// job (ci_planning.ts) — this script never re-decides skip/reuse/build.
//
//   action == "build": run the Tauri build + artifact collection (reusing
//                      tauri_release.ts's buildTauriArtifacts), upload to the
//                      GitHub Release when RELEASE_TAG is set, and write the
//                      new JSON cache entry.
//   action == "reuse": no Rust/cargo — download the artifacts from the
//                      source release and re-upload them to the current
//                      release (--clobber), then chain the cache forward.
//
// The web build is NOT rebuilt here: the build-web job produced it and the
// workflow downloaded it to apps/frontend/client/build; tauri build runs with
// beforeBuildCommand disabled (see buildTauriArtifacts).
//
// Usage (workflow):
//   bun scripts/src/lib/deploy/ci_run.ts \
//     --mode="$MODE" --version="$VERSION" --checksum="$CHECKSUM"
//   env: LEG (JSON from ${{ toJson(matrix) }}), RELEASE_TAG, GH_TOKEN,
//        REDIS_URL/REDIS_TOKEN (via scripts/.env.{mode})

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { c, error, log, ok, parseCliArgs, runStream, warn } from '../cli_utils';
import { initScriptsEnv } from '../env/scripts_env';
import { getTauriCache, setTauriCache } from './cache';
import { APP_CONFIG } from './deployment_config';
import { buildTauriArtifacts, uploadArtifactsToRelease } from './tauri_release';
import {
  buildPlatformFragment,
  type PlatformName,
  type UpdaterManifest,
  writeFragmentFile,
} from './updater_manifest';

const _filename = fileURLToPath(import.meta.url);
const _scriptDir = dirname(_filename);
const ROOT_DIR = resolve(_scriptDir, '../../../..');

/** Bundle → glob patterns for gh release download. */
const BUNDLE_GLOBS: Record<string, string[]> = {
  appimage: ['*.AppImage', '*.AppImage.sig'],
  deb: ['*.deb', '*.deb.sig'],
  rpm: ['*.rpm', '*.rpm.sig'],
  msi: ['*.msi', '*.msi.sig'],
  dmg: ['*.dmg'],
  app: ['*.app.tar.gz', '*.app.tar.gz.sig'],
};

type Leg = {
  runsOn: string;
  platform: string;
  bundles: string;
  action: 'build' | 'reuse';
  sourceReleaseTag: string | null;
};

function parseLeg(raw: string | undefined): Leg {
  if (!raw) {
    throw new Error('Missing leg definition — set the LEG env var or pass --leg');
  }
  const parsed = JSON.parse(raw) as Partial<Leg>;
  if (parsed.action !== 'build' && parsed.action !== 'reuse') {
    throw new Error(`Invalid leg action: ${String(parsed.action)}`);
  }
  const VALID_PLATFORMS: PlatformName[] = ['linux', 'windows', 'macos'];
  const platform = parsed.platform ?? '';
  if (!VALID_PLATFORMS.includes(platform as PlatformName)) {
    throw new Error(
      `Invalid leg platform: ${platform}. Expected one of: ${VALID_PLATFORMS.join(', ')}`,
    );
  }
  return {
    runsOn: parsed.runsOn ?? '',
    platform: platform as PlatformName,
    bundles: parsed.bundles ?? '',
    action: parsed.action,
    sourceReleaseTag: parsed.sourceReleaseTag ?? null,
  };
}

/** Normalize Node/Bun process.arch to Tauri updater target architectures */
function resolveTauriArch(): string {
  if (process.env.TAURI_TARGET === 'universal-apple-darwin') {
    return 'universal';
  }
  const rawArch = process.arch;
  if (rawArch === 'x64') return 'x86_64';
  if (rawArch === 'arm64') return 'aarch64';
  return rawArch;
}

/** gh release download with per-bundle globs; fails loudly on error. */
async function downloadReleaseAssets(
  sourceTag: string,
  bundles: string[],
  destDir: string,
): Promise<string[]> {
  mkdirSync(destDir, { recursive: true });
  const args = ['release', 'download', sourceTag, '-D', destDir];
  for (const b of bundles) {
    for (const glob of BUNDLE_GLOBS[b] ?? []) {
      args.push('-p', glob);
    }
  }
  log(`⬇️  Downloading assets from ${c.cyan}${sourceTag}${c.reset} (${bundles.join(', ')})...`);
  const code = await runStream(['gh', ...args]);
  if (code !== 0) {
    throw new Error(`gh release download ${sourceTag} failed (exit ${code})`);
  }
  return readdirSync(destDir).map((f) => join(destDir, f));
}

/** Upload all downloaded files to the current release, clobbering. */
async function uploadToCurrentRelease(releaseTag: string, files: string[]): Promise<void> {
  if (files.length === 0) {
    throw new Error(`No files downloaded to upload to ${releaseTag}`);
  }
  log(`📤 Uploading ${files.length} artifact(s) to ${c.cyan}${releaseTag}${c.reset}...`);
  const code = await runStream(['gh', 'release', 'upload', releaseTag, ...files, '--clobber']);
  if (code !== 0) {
    throw new Error(`gh release upload ${releaseTag} failed (exit ${code})`);
  }
  ok(`  Uploaded ${files.length} artifact(s) to ${releaseTag}`);
}

async function downloadSourceManifest(
  sourceTag: string,
  destDir: string,
): Promise<UpdaterManifest | null> {
  mkdirSync(destDir, { recursive: true });
  const code = await runStream([
    'gh',
    'release',
    'download',
    sourceTag,
    '-D',
    destDir,
    '-p',
    'latest.json',
  ]);
  if (code !== 0) {
    log(
      `  ${c.dim}Source release ${sourceTag} has no latest.json (pre-updater?) — fragment keys derived from artifacts instead.${c.reset}`,
    );
    return null;
  }
  try {
    return JSON.parse(readFileSync(join(destDir, 'latest.json'), 'utf8')) as UpdaterManifest;
  } catch (err) {
    warn(
      `  Could not parse ${sourceTag} latest.json: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

async function main(): Promise<void> {
  const opts = parseCliArgs(Bun.argv.slice(2), {
    mode: { type: 'string', map: { prod: 'production', stg: 'staging' } },
    version: { type: 'string' },
    checksum: { type: 'string' },
    leg: { type: 'string' },
  });
  const mode = opts.mode ?? '';
  if (!mode) {
    error('--mode is required');
    process.exit(1);
  }
  initScriptsEnv(mode);

  const leg = parseLeg(process.env.LEG ?? opts.leg);
  const releaseTag = process.env.RELEASE_TAG?.trim() || null;
  const config = APP_CONFIG['client-tauri'];
  const checksum = opts.checksum ?? '';
  if (!checksum) {
    error('--checksum is required');
    process.exit(1);
  }

  log(`\n${c.bold}🖥️  CI run: ${leg.platform} [${leg.bundles}] — ${leg.action}${c.reset}`);
  log(`  Mode:     ${mode}`);
  log(`  Release:  ${releaseTag ?? '(none — workflow_dispatch)'}`);

  if (leg.action === 'build') {
    // Clean target bundle directory before building to prevent uploading stale artifacts
    const targetBundleDir = join(ROOT_DIR, 'apps/frontend/client/src-tauri/target/release/bundle');
    if (existsSync(targetBundleDir)) {
      rmSync(targetBundleDir, { recursive: true, force: true });
    }

    const { artifacts, version } = await buildTauriArtifacts(config, mode, ROOT_DIR, {
      bundles: leg.bundles,
      disableBeforeBuildCommand: true,
    });

    if (releaseTag) {
      uploadArtifactsToRelease(releaseTag, artifacts);

      const arch = resolveTauriArch();
      writeFragmentFile(
        leg.platform,
        buildPlatformFragment({
          platform: leg.platform,
          artifactPaths: artifacts,
          releaseTag,
          arch,
        }),
      );
    } else {
      log(
        `  ${c.dim}No RELEASE_TAG set (workflow_dispatch run) — artifacts remain on disk for workflow steps.${c.reset}`,
      );
    }

    await setTauriCache(mode, {
      checksum,
      version,
      releaseTag,
      builtAt: new Date().toISOString(),
    });
    ok(`Leg complete — v${version} (${leg.platform}, ${artifacts.length} artifact(s))`);
    return;
  }

  if (!leg.sourceReleaseTag) {
    error('Reuse leg requires sourceReleaseTag in the leg JSON');
    process.exit(1);
  }
  if (!releaseTag) {
    error('Reuse leg requires RELEASE_TAG to upload the copied artifacts');
    process.exit(1);
  }

  const destDir = join(tmpdir(), `aikami-reuse-${leg.platform}-${process.pid}`);
  const manifestDir = join(tmpdir(), `aikami-reuse-manifest-${leg.platform}-${process.pid}`);
  const bundles = leg.bundles.split(',').filter(Boolean);
  const files = await downloadReleaseAssets(leg.sourceReleaseTag, bundles, destDir);
  await uploadToCurrentRelease(releaseTag, files);

  const sourceManifest = await downloadSourceManifest(leg.sourceReleaseTag, manifestDir);
  writeFragmentFile(
    leg.platform,
    buildPlatformFragment({
      platform: leg.platform,
      artifactPaths: files,
      releaseTag,
      sourceManifest,
    }),
  );

  const existing = await getTauriCache(mode);
  if (existing) {
    await setTauriCache(mode, { ...existing, releaseTag });
    ok(`Cache chained: ${leg.sourceReleaseTag} → ${releaseTag}`);
  }
}

await main();
