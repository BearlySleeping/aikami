// scripts/src/lib/release/github.ts
/**
 * git + `gh` wrappers used by the release CLI.
 *
 * Every mutating helper takes a `dryRun` flag and logs what it *would* do
 * instead of doing it, so `bun run release --dry-run` exercises the real code
 * path (including all the read-side lookups) without touching the remote.
 */

import { c, log, run } from '../cli_utils';
import type { Commit } from './notes';
import { compareSemverDesc, formatSemver, parseSemver, type Semver } from './version';

/** The rolling tag every staging cut points at. Never version-numbered. */
export const STAGING_TAG = 'staging';

/** Title of the single rolling staging release entry. */
export const STAGING_RELEASE_TITLE = 'Staging (rolling)';

const checked = async (cmd: string[]): Promise<string> => {
  const res = await run(cmd);
  if (res.code !== 0) {
    throw new Error(`${cmd.join(' ')} failed (exit ${res.code}): ${res.err || res.out}`);
  }
  return res.out.trim();
};

// ── git reads ────────────────────────────────────────────────────────────

export const currentBranch = async (): Promise<string> =>
  checked(['git', 'rev-parse', '--abbrev-ref', 'HEAD']);

export const revParse = async (ref: string): Promise<string> => checked(['git', 'rev-parse', ref]);

/** True when the working tree and index are both clean. */
export const isTreeClean = async (): Promise<boolean> => {
  const res = await run(['git', 'status', '--porcelain']);
  return res.code === 0 && res.out.trim() === '';
};

/**
 * Commits in `range` (`a..b`), newest first.
 *
 * `--no-merges` drops merge commits at the source rather than filtering them
 * out downstream — a squash-merge repo's merge commits carry no subject worth
 * rendering, and keeping them would make every PR appear twice.
 */
export const commitsInRange = async (range: string): Promise<Commit[]> => {
  const res = await run(['git', 'log', '--no-merges', '--format=%H%x00%s', range]);
  if (res.code !== 0) {
    return [];
  }
  return res.out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha = '', subject = ''] = line.split('\0');
      return { sha, subject };
    })
    .filter((commit) => commit.subject !== '');
};

/**
 * The newest `v<semver>` tag in the repo, or null when none exists.
 *
 * Sorted numerically here rather than with `git tag --sort=-v:refname`
 * because the existing tag history (v0.0.11, v0.0.101, v0.0.195, v0.1.1)
 * is exactly the shape where lexical fallbacks pick the wrong one.
 */
export const latestStableTag = async (): Promise<{ tag: string; version: Semver } | null> => {
  const res = await run(['git', 'tag', '--list', 'v*']);
  if (res.code !== 0) {
    return null;
  }
  const parsed = res.out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((tag) => ({ tag, version: parseSemver(tag) }))
    .filter((entry): entry is { tag: string; version: Semver } => entry.version !== null)
    .sort((a, b) => compareSemverDesc(a.version, b.version));
  return parsed[0] ?? null;
};

// ── git writes ───────────────────────────────────────────────────────────

export const commitFiles = async (options: {
  files: readonly string[];
  message: string;
  dryRun: boolean;
}): Promise<void> => {
  const { files, message, dryRun } = options;
  if (files.length === 0) {
    return;
  }
  if (dryRun) {
    log(`  ${c.dim}[dry-run] git commit ${files.join(' ')} -m "${message}"${c.reset}`);
    return;
  }
  await checked(['git', 'add', ...files]);
  await checked(['git', 'commit', '-m', message]);
};

export const pushBranch = async (options: { branch: string; dryRun: boolean }): Promise<void> => {
  const { branch, dryRun } = options;
  if (dryRun) {
    log(`  ${c.dim}[dry-run] git push origin ${branch}${c.reset}`);
    return;
  }
  await checked(['git', 'push', 'origin', branch]);
};

/**
 * Point `tag` at `sha`, locally and on the remote, creating or moving it.
 *
 * The staging tag is deliberately rolling, so this force-pushes. Stable `v*`
 * tags are created once and never passed through here with an existing tag —
 * `cutStaging`/`promote` check for collisions before calling.
 */
export const setTag = async (options: {
  tag: string;
  sha: string;
  message: string;
  dryRun: boolean;
}): Promise<void> => {
  const { tag, sha, message, dryRun } = options;
  if (dryRun) {
    log(
      `  ${c.dim}[dry-run] git tag -f -a ${tag} ${sha.slice(0, 8)} && git push -f origin ${tag}${c.reset}`,
    );
    return;
  }
  await checked(['git', 'tag', '-f', '-a', tag, sha, '-m', message]);
  await checked(['git', 'push', '--force', 'origin', `refs/tags/${tag}`]);
};

// ── gh release ───────────────────────────────────────────────────────────

export const releaseExists = async (tag: string): Promise<boolean> => {
  const res = await run(['gh', 'release', 'view', tag, '--json', 'tagName']);
  return res.code === 0;
};

/** The release body for `tag`, or null when there is no such release. */
export const releaseBody = async (tag: string): Promise<string | null> => {
  const res = await run(['gh', 'release', 'view', tag, '--json', 'body', '--jq', '.body']);
  return res.code === 0 ? res.out : null;
};

export const deleteRelease = async (options: { tag: string; dryRun: boolean }): Promise<void> => {
  const { tag, dryRun } = options;
  if (dryRun) {
    log(`  ${c.dim}[dry-run] gh release delete ${tag} --yes${c.reset}`);
    return;
  }
  // --cleanup-tag is deliberately NOT passed: setTag has already moved the
  // tag to the new commit, and deleting it here would drop the ref the
  // release we are about to create needs to point at.
  const res = await run(['gh', 'release', 'delete', tag, '--yes']);
  if (res.code !== 0 && !/release not found/i.test(res.err + res.out)) {
    throw new Error(`gh release delete ${tag} failed: ${res.err || res.out}`);
  }
};

/**
 * Create a published GitHub Release.
 *
 * `release: published` is what triggers the desktop pipeline in release.yml,
 * and only a *newly published* release fires it — editing an existing one
 * fires `edited`, which the workflow does not listen to. That is why the
 * staging path deletes and recreates rather than editing in place.
 */
export const createRelease = async (options: {
  tag: string;
  title: string;
  body: string;
  prerelease: boolean;
  /** false marks the release as NOT the repo's "Latest" (staging). */
  latest: boolean;
  dryRun: boolean;
}): Promise<void> => {
  const { tag, title, body, prerelease, latest, dryRun } = options;
  const flags = [
    'gh',
    'release',
    'create',
    tag,
    '--title',
    title,
    '--notes',
    body,
    `--latest=${latest}`,
  ];
  if (prerelease) {
    flags.push('--prerelease');
  }
  if (dryRun) {
    log(
      `  ${c.dim}[dry-run] gh release create ${tag} --title "${title}" ${prerelease ? '--prerelease ' : ''}--latest=${latest}${c.reset}`,
    );
    return;
  }
  await checked(flags);
};

/** URL of a release page, for the CLI's closing summary. */
export const releaseUrl = async (tag: string): Promise<string> => {
  const res = await run(['gh', 'release', 'view', tag, '--json', 'url', '--jq', '.url']);
  return res.code === 0 ? res.out.trim() : `(tag ${tag})`;
};

export const formatVersionTag = (version: Semver): string => `v${formatSemver(version)}`;
