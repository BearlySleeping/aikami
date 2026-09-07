// scripts/src/lib/release/version.ts
/**
 * Version source of truth for the desktop release pipeline.
 *
 * Historically the release TAG carried the version: ci_run.ts derived the
 * embedded bundle version from `RELEASE_TAG` (v0.1.1 → 0.1.1) so cutting a
 * release needed no version-bump commit. That breaks the moment a release tag
 * isn't a version — the rolling `staging` tag (see release/index.ts) would
 * strip to the literal string "staging" and get embedded as the app version,
 * then published in latest.json as the version every client compares against.
 *
 * So the committed version wins instead: `bun run release` bumps Cargo.toml
 * and tauri.conf.json, commits, and tags that commit. `resolveReleaseVersion`
 * still honours a semver tag when there is one (every historical `v*` release,
 * and any hand-cut tag) and falls back to the committed version otherwise.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The two files that carry the desktop app version, relative to the repo root. */
export const CARGO_TOML = 'apps/frontend/client/src-tauri/Cargo.toml';
export const TAURI_CONF = 'apps/frontend/client/src-tauri/tauri.conf.json';

export type Semver = { major: number; minor: number; patch: number };

export type BumpKind = 'major' | 'minor' | 'patch';

/** `v0.2.0` / `0.2.0` → `{0,2,0}`. Returns null for anything else. */
export const parseSemver = (raw: string): Semver | null => {
  const match = raw.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
};

/** `{0,2,0}` → `0.2.0`. */
export const formatSemver = (v: Semver): string => `${v.major}.${v.minor}.${v.patch}`;

/** Next version for a bump kind (minor/major reset the lower components). */
export const bumpSemver = (v: Semver, kind: BumpKind): Semver => {
  if (kind === 'major') {
    return { major: v.major + 1, minor: 0, patch: 0 };
  }
  if (kind === 'minor') {
    return { major: v.major, minor: v.minor + 1, patch: 0 };
  }
  return { major: v.major, minor: v.minor, patch: v.patch + 1 };
};

/** Newest-first comparator. */
export const compareSemverDesc = (a: Semver, b: Semver): number =>
  b.major - a.major || b.minor - a.minor || b.patch - a.patch;

// ── Committed version ────────────────────────────────────────────────────

/**
 * Read the version committed to Cargo.toml.
 *
 * Only the `[package]` section is matched. A naive /version\s*=\s*"…"/ search
 * over the whole file hits the first dependency pin instead the moment
 * anything is added above `[package]`, which is how you ship a release
 * numbered after whichever crate happens to sort first.
 */
export const readCommittedVersion = (rootDir: string): string => {
  const cargo = readFileSync(join(rootDir, CARGO_TOML), 'utf8');
  const packageSection = cargo.split(/^\[/m).find((section) => section.startsWith('package]'));
  const match = packageSection?.match(/^\s*version\s*=\s*"([^"]+)"/m);
  if (!match?.[1]) {
    throw new Error(`Could not read the [package] version from ${CARGO_TOML}`);
  }
  return match[1];
};

/**
 * Write `version` into both Cargo.toml's `[package]` block and
 * tauri.conf.json. Returns the repo-relative paths that actually changed
 * (empty when both already held this version — a re-run is a no-op).
 */
export const writeCommittedVersion = (rootDir: string, version: string): string[] => {
  const changed: string[] = [];

  const cargoPath = join(rootDir, CARGO_TOML);
  const cargo = readFileSync(cargoPath, 'utf8');
  let inPackage = false;
  let replaced = false;
  const nextCargo = cargo
    .split('\n')
    .map((line) => {
      if (line.startsWith('[')) {
        inPackage = line.trim() === '[package]';
        return line;
      }
      if (inPackage && !replaced && /^\s*version\s*=/.test(line)) {
        replaced = true;
        return `version = "${version}"`;
      }
      return line;
    })
    .join('\n');
  if (!replaced) {
    throw new Error(`Could not find a [package] version line to rewrite in ${CARGO_TOML}`);
  }
  if (nextCargo !== cargo) {
    writeFileSync(cargoPath, nextCargo);
    changed.push(CARGO_TOML);
  }

  const confPath = join(rootDir, TAURI_CONF);
  const conf = readFileSync(confPath, 'utf8');
  // Textual edit rather than JSON.parse → JSON.stringify: the config is
  // hand-maintained, and round-tripping it reflows every line and drops key
  // order, turning a one-line version bump into an unreviewable diff.
  const nextConf = conf.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
  if (nextConf === conf && !conf.includes(`"version": "${version}"`)) {
    throw new Error(`Could not find a "version" field to rewrite in ${TAURI_CONF}`);
  }
  if (nextConf !== conf) {
    writeFileSync(confPath, nextConf);
    changed.push(TAURI_CONF);
  }

  return changed;
};

/**
 * The version a staging cut should claim.
 *
 * The committed version is the floor: a repeated cut must move beyond the
 * version already installed from the rolling staging endpoint, or the updater
 * will treat newly built artifacts as the same release and ignore them.
 */
export const resolveNextVersion = (options: {
  committed: Semver;
  lastStable: Semver | null;
  bump: BumpKind | null;
}): Semver => {
  const { committed, lastStable, bump } = options;
  const claimed = lastStable === null || compareSemverDesc(committed, lastStable) < 0;
  if (bump !== null) {
    return bumpSemver(claimed ? committed : lastStable, bump);
  }
  if (claimed) {
    return bumpSemver(committed, 'patch');
  }
  return bumpSemver(lastStable, 'patch');
};

// ── Release-time resolution (consumed by the CI deploy pipeline) ──────────

/**
 * The version a release embeds in its bundles and publishes in latest.json.
 *
 * A semver tag (`v0.2.0`) still wins, so every pre-existing release and any
 * hand-cut tag behaves exactly as it did before this module existed. A
 * non-semver tag (the rolling `staging` tag) or no tag at all falls back to
 * the committed version, which `bun run release` bumped in the very commit
 * being tagged.
 */
export const resolveReleaseVersion = (
  releaseTag: string | null | undefined,
  rootDir: string,
): string => {
  const fromTag = releaseTag ? parseSemver(releaseTag) : null;
  return fromTag ? formatSemver(fromTag) : readCommittedVersion(rootDir);
};
