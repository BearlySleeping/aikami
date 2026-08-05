#!/usr/bin/env bun
// scripts/src/lib/deploy/ci_planning.ts
//
// CI-only planner for the Tauri desktop release. Runs in TWO jobs (see
// release.yml) because GitHub Actions drops any job output whose value
// contains a masked secret substring — and using a multiline JSON secret
// (GCP_SA_KEY) in a job causes the runner to mask `{`/`}` characters, which
// would silently strip a JSON matrix output ("Skip output ... since it may
// contain secret"). So the secret-touching work and the matrix emission are
// deliberately separated:
//
//   plan (default mode, touches GCP secrets):
//     downloads secrets (workflow), computes the checksum + shared version,
//     reads the Redis cache → emits checksum / version / cached_checksum /
//     cached_release_tag (all plain, brace-free strings).
//   plan-matrix (--decide mode, NO secret references):
//     filters the platform/bundle legs and runs the build/skip/reuse decision
//     from the passed-in cache state → emits matrix / needs_build. This job
//     never expands a GitHub secret, so `{`/`}` are not masked and the JSON
//     matrix output survives.
//
// The Redis cache entry (cache-aikami-deploy:{mode}:client-tauri, see
// cache.ts getTauriCache/setTauriCache) is the source of truth for what a
// given checksum last produced and which release holds the artifacts.
//
// Usage:
//   # compute (secret job):
//   bun scripts/src/lib/deploy/ci_planning.ts --mode="$MODE"
//   # decide (clean job):
//   bun scripts/src/lib/deploy/ci_planning.ts --mode="$MODE" --decide \
//     --checksum="$CHECKSUM" --version="$VERSION" \
//     --cached-checksum="$CACHED_CHECKSUM" --cached-release-tag="$CACHED_TAG" \
//     --platforms="$PLATFORMS" --bundles="$BUNDLES" [--force]
//   env: RELEASE_TAG (set only on release:published), REDIS_URL/REDIS_TOKEN
//        (via scripts/.env.{mode}) for compute mode.

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { c, log, ok, parseCliArgs, run, warn } from '../cli_utils';
import { initScriptsEnv } from '../env/scripts_env';
import { computeAppChecksum, generateVersionString, getTauriCache } from './cache';
import { APP_CONFIG } from './deployment_config';

const _filename = fileURLToPath(import.meta.url);
const _scriptDir = dirname(_filename);
const ROOT_DIR = resolve(_scriptDir, '../../../..');

// ── Platform defaults (mirrors the old workflow matrix) ──────────────────

type PlatformDef = { runsOn: string; platform: string; bundles: string };

const PLATFORM_DEFAULTS: PlatformDef[] = [
  { runsOn: 'ubuntu-latest', platform: 'linux', bundles: 'appimage,deb,rpm' },
  { runsOn: 'windows-latest', platform: 'windows', bundles: 'msi' },
  // `app` is required on macOS: createUpdaterArtifacts only emits the
  // .app.tar.gz updater bundle when the MacOsBundle target is built.
  { runsOn: 'macos-latest', platform: 'macos', bundles: 'app,dmg' },
];

/** Bundle → file extension (used by assetsPresentOnRelease). */
const BUNDLE_EXTENSIONS: Record<string, string> = {
  appimage: '.appimage',
  deb: '.deb',
  rpm: '.rpm',
  msi: '.msi',
  dmg: '.dmg',
  app: '.app.tar.gz',
};

// ── GitHub Release asset checks ───────────────────────────────────────────

/**
 * True when the release at `tag` has at least one asset per requested bundle
 * type (extension match — Tauri filenames embed the version, so exact names
 * aren't required). For updater-capable bundles (appimage, msi, app), BOTH the
 * artifact AND its .sig file must be present. False on any gh failure (missing
 * release, no assets…).
 */
async function assetsPresentOnRelease(tag: string, bundles: string[]): Promise<boolean> {
  const res = await run([
    'gh',
    'release',
    'view',
    tag,
    '--json',
    'assets',
    '--jq',
    '.assets[].name',
  ]);
  if (res.code !== 0) {
    warn(`  gh release view ${tag} failed: ${res.err || res.out}`);
    return false;
  }
  const names = res.out
    .split('\n')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (names.length === 0) {
    return false;
  }
  // Updater bundles requiring signatures (appimage, msi, app.tar.gz)
  const UPDATER_BUNDLES = new Set(['appimage', 'msi', 'app']);
  return bundles.every((b) => {
    const ext = BUNDLE_EXTENSIONS[b];
    if (!ext) {
      return false;
    }
    const hasArtifact = names.some((n) => n.endsWith(ext));
    if (!hasArtifact) {
      return false;
    }
    // For updater bundles, also require the .sig file
    if (UPDATER_BUNDLES.has(b)) {
      return names.some((n) => n.endsWith(`${ext}.sig`));
    }
    return true;
  });
}

// ── Output emission ───────────────────────────────────────────────────────

/** Write a single-line value to $GITHUB_OUTPUT (or console when not in CI). */
function emitOutput(key: string, value: string): void {
  const outPath = process.env.GITHUB_OUTPUT;
  if (!outPath) {
    console.log(`[GITHUB_OUTPUT] ${key}=${value}`);
    return;
  }
  writeFileSync(outPath, `${key}=${value}\n`, { flag: 'a' });
}

// ── Decision algorithm ────────────────────────────────────────────────────

type Leg = {
  runsOn: string;
  platform: string;
  bundles: string;
  action: 'build' | 'reuse';
  sourceReleaseTag: string | null;
};

type CacheState = { checksum: string; releaseTag: string | null } | null;

/**
 * Decide what to do with a single (platform, bundles) pair.
 *
 *   isForce                                  → build
 *   no cached entry / checksum changed       → build
 *   no current release (workflow_dispatch)   → skip (ephemeral artifacts only)
 *   same release as cached, assets present   → skip (re-run, nothing to do)
 *   same release, assets MISSING             → build (don't trust the cache)
 *   different release, source has assets     → reuse (copy forward)
 *   different release, source has NO assets  → build (fall back)
 */
async function decideLeg(
  leg: PlatformDef,
  checksum: string,
  releaseTag: string | null,
  cached: CacheState,
  isForce: boolean,
): Promise<Leg | null> {
  const bundles = leg.bundles.split(',').filter(Boolean);

  if (isForce) {
    return {
      runsOn: leg.runsOn,
      platform: leg.platform,
      bundles: leg.bundles,
      action: 'build',
      sourceReleaseTag: null,
    };
  }
  if (!cached || cached.checksum !== checksum) {
    return {
      runsOn: leg.runsOn,
      platform: leg.platform,
      bundles: leg.bundles,
      action: 'build',
      sourceReleaseTag: null,
    };
  }
  if (releaseTag === null) {
    // workflow_dispatch / staging run — no permanent release to attach to.
    // Existing ephemeral-artifact behavior is fine: nothing to do.
    log(`  ${leg.platform}: unchanged checksum + no release → skip`);
    return null;
  }
  if (cached.releaseTag === releaseTag) {
    // Re-running the same release — verify before trusting the cache.
    if (await assetsPresentOnRelease(releaseTag, bundles)) {
      log(`  ${leg.platform}: same release, assets present → skip`);
      return null;
    }
    log(`  ${leg.platform}: same release but assets missing → build (don't trust cache)`);
    return {
      runsOn: leg.runsOn,
      platform: leg.platform,
      bundles: leg.bundles,
      action: 'build',
      sourceReleaseTag: null,
    };
  }
  // Different release than the one that built these artifacts.
  if (cached.releaseTag && (await assetsPresentOnRelease(cached.releaseTag, bundles))) {
    log(`  ${leg.platform}: reuse artifacts from ${cached.releaseTag}`);
    return {
      runsOn: 'ubuntu-latest', // no native OS needed to copy files
      platform: leg.platform,
      bundles: leg.bundles,
      action: 'reuse',
      sourceReleaseTag: cached.releaseTag,
    };
  }
  log(`  ${leg.platform}: source release lacks assets → build`);
  return {
    runsOn: leg.runsOn,
    platform: leg.platform,
    bundles: leg.bundles,
    action: 'build',
    sourceReleaseTag: null,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseCliArgs(Bun.argv.slice(2), {
    mode: { type: 'string', map: { prod: 'production', stg: 'staging' } },
    force: { type: 'boolean', aliases: ['f'] },
    platforms: { type: 'string' },
    bundles: { type: 'string' },
    decide: { type: 'boolean' },
    checksum: { type: 'string' },
    version: { type: 'string' },
    'cached-checksum': { type: 'string' },
    'cached-release-tag': { type: 'string' },
  });
  const mode = opts.mode ?? 'production';
  const releaseTag = process.env.RELEASE_TAG?.trim() || null;

  // ── Compute mode (default): checksum + version + cache read ─────────
  if (!opts.decide) {
    initScriptsEnv(mode);
    log(`\n${c.bold}📋 Planning Tauri desktop release (compute)${c.reset}`);
    log(`  Mode:       ${mode}`);
    log(`  Release:    ${releaseTag ?? '(none — workflow_dispatch)'}`);

    const config = APP_CONFIG['client-tauri'];
    const checksum = computeAppChecksum(config, 'client-tauri', mode, ROOT_DIR);
    const version = generateVersionString();
    const cached = await getTauriCache(mode);

    log(`  Checksum:   ${checksum.slice(0, 16)}...`);
    log(`  Version:    ${version}`);
    log(
      `  Cached:     ${cached ? `${cached.checksum.slice(0, 16)}... (release=${cached.releaseTag ?? 'none'})` : '(none)'}`,
    );

    // Brace-free outputs only — this job touches GCP secrets, so GitHub's
    // masker has `{`/`}` registered; JSON outputs would be silently dropped.
    emitOutput('checksum', checksum);
    emitOutput('version', version);
    emitOutput('cached_checksum', cached?.checksum ?? '');
    emitOutput('cached_release_tag', cached?.releaseTag ?? '');
    ok('Compute complete.');
    return;
  }

  // ── Decide mode: filter legs + build/skip/reuse (no secrets here) ──
  const isForce = opts.force ?? false;
  const checksum = opts.checksum ?? '';
  const version = opts.version ?? '';
  const cached: CacheState =
    opts['cached-checksum'] && opts['cached-checksum'] !== ''
      ? {
          checksum: opts['cached-checksum'],
          releaseTag: opts['cached-release-tag'] ? opts['cached-release-tag'] : null,
        }
      : null;

  log(`\n${c.bold}📋 Planning Tauri desktop release (decide)${c.reset}`);
  log(`  Mode:       ${mode}`);
  log(`  Force:      ${isForce}`);
  log(`  Release:    ${releaseTag ?? '(none — workflow_dispatch)'}`);
  log(`  Checksum:   ${checksum.slice(0, 16)}...`);
  log(`  Version:    ${version}`);
  log(
    `  Cached:     ${cached ? `${cached.checksum.slice(0, 16)}... (release=${cached.releaseTag ?? 'none'})` : '(none)'}`,
  );

  // Filter requested platforms/bundles (empty = all / platform defaults).
  const requestedPlatforms = (opts.platforms ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const requestedBundles = (opts.bundles ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const legs: PlatformDef[] = [];
  for (const def of PLATFORM_DEFAULTS) {
    if (requestedPlatforms.length > 0 && !requestedPlatforms.includes(def.platform)) {
      continue;
    }
    let bundles = def.bundles.split(',').filter(Boolean);
    if (requestedBundles.length > 0) {
      bundles = bundles.filter((b) => requestedBundles.includes(b));
      if (bundles.length === 0) {
        log(`  ${def.platform}: no requested bundle matches (${def.bundles}) → skip`);
        continue;
      }
    }
    legs.push({ ...def, bundles: bundles.join(',') });
  }

  if (legs.length === 0) {
    log(`${c.yellow}No legs requested — emitting empty matrix.${c.reset}`);
  }

  const matrix: Leg[] = [];
  let needsBuild = false;

  for (const leg of legs) {
    const decided = await decideLeg(leg, checksum, releaseTag, cached, isForce);
    if (!decided) {
      continue;
    }
    if (decided.action === 'build') {
      needsBuild = true;
    }
    matrix.push(decided);
  }

  emitOutput('matrix', JSON.stringify(matrix));
  emitOutput('needs_build', String(needsBuild));

  if (matrix.length > 0) {
    ok(`Planned ${matrix.length} leg(s):`);
    for (const leg of matrix) {
      const tag = leg.action === 'reuse' ? ` (from ${leg.sourceReleaseTag})` : '';
      ok(`  - ${leg.platform} [${leg.bundles}] → ${leg.action}${tag} on ${leg.runsOn}`);
    }
  } else {
    warn('Nothing to do — matrix is empty.');
  }
}

await main();
