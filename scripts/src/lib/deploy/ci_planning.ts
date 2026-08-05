#!/usr/bin/env bun
// scripts/src/lib/deploy/ci_planning.ts
//
// CI-only planner for the Tauri desktop release. Runs ONCE per workflow run
// (the `plan` job in release.yml), before any desktop matrix leg is
// scheduled, and decides:
//
//   1. Which (platform, bundles) legs to run at all (ports the old per-leg
//      bash "Platform gate" into TypeScript — unneeded legs are never
//      scheduled instead of being scheduled and early-exiting).
//   2. What each leg should DO:
//        build  — compile + bundle (or rebuild after a change)
//        reuse  — the checksum is unchanged and a previous release already
//                 holds the exact artifacts; copy them forward instead of
//                 recompiling byte-identical files
//        skip   — nothing to do (workflow_dispatch with unchanged checksum)
//   3. The shared version string (PUBLIC_APP_VERSION), generated exactly
//      once so all platform legs embed the same value (previously each
//      matrix leg computed its own UTC timestamp → version drift).
//
// The Redis cache entry (cache-aikami-deploy:{mode}:client-tauri, see
// cache.ts getTauriCache/setTauriCache) is the source of truth for what a
// given checksum last produced and which release holds the artifacts.
//
// Emits (via $GITHUB_OUTPUT when present, console otherwise):
//   matrix       — JSON array of legs: {runsOn, platform, bundles, action, sourceReleaseTag}
//   needs_build  — "true" if any leg must compile
//   version      — shared version string
//   checksum     — computed checksum (for debugging)
//
// Usage (workflow):
//   bun scripts/src/lib/deploy/ci_planning.ts \
//     --mode="$MODE" $FORCE_FLAG --platforms="$PLATFORMS" --bundles="$BUNDLES"
//   env: RELEASE_TAG (set only on release:published), REDIS_URL/REDIS_TOKEN
//        (via scripts/.env.{mode}, loaded by download_secrets.ts first)

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
  { runsOn: 'macos-latest', platform: 'macos', bundles: 'dmg' },
];

/** Bundle → file extension (used by assetsPresentOnRelease). */
const BUNDLE_EXTENSIONS: Record<string, string> = {
  appimage: '.appimage',
  deb: '.deb',
  rpm: '.rpm',
  msi: '.msi',
  dmg: '.dmg',
};

// ── GitHub Release asset checks ───────────────────────────────────────────

/**
 * True when the release at `tag` has at least one asset per requested bundle
 * type (extension match — Tauri filenames embed the version, so exact names
 * aren't required). False on any gh failure (missing release, no assets…).
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
  return bundles.every((b) => {
    const ext = BUNDLE_EXTENSIONS[b];
    return !!ext && names.some((n) => n.endsWith(ext));
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
  cached: { checksum: string; releaseTag: string | null } | null,
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
  });
  const mode = opts.mode ?? 'production';
  const isForce = opts.force ?? false;

  initScriptsEnv(mode);

  const releaseTag = process.env.RELEASE_TAG?.trim() || null;

  log(`\n${c.bold}📋 Planning Tauri desktop release${c.reset}`);
  log(`  Mode:       ${mode}`);
  log(`  Force:      ${isForce}`);
  log(`  Release:    ${releaseTag ?? '(none — workflow_dispatch)'}`);

  // 1. Checksum + shared version — computed exactly once here.
  const config = APP_CONFIG['client-tauri'];
  const checksum = computeAppChecksum(config, 'client-tauri', mode, ROOT_DIR);
  const version = generateVersionString();
  log(`  Checksum:   ${checksum.slice(0, 16)}...`);
  log(`  Version:    ${version}`);

  // 2. Resolve requested platforms/bundles (empty = all / platform defaults).
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

  // 3. Read the cache + decide each leg.
  const cached = await getTauriCache(mode);
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

  // 4. Emit outputs.
  emitOutput('matrix', JSON.stringify(matrix));
  emitOutput('needs_build', String(needsBuild));
  emitOutput('version', version);
  emitOutput('checksum', checksum);

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
