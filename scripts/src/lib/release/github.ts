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
  const output = await checked(['git', 'log', '--no-merges', '--format=%H%x00%s', range]);
  return output
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
  const output = await checked(['git', 'tag', '--list', 'v*']);
  const parsed = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((tag) => ({ tag, version: parseSemver(tag) }))
    .filter((entry): entry is { tag: string; version: Semver } => entry.version !== null)
    .sort((a, b) => compareSemverDesc(a.version, b.version));
  return parsed[0] ?? null;
};

/** True when `tag` exists in the local repository. */
export const localTagExists = async (tag: string): Promise<boolean> =>
  (await checked(['git', 'tag', '--list', tag])) !== '';

/** True when `tag` exists on origin; transport failures are not mistaken for absence. */
export const originTagExists = async (tag: string): Promise<boolean> =>
  (await checked(['git', 'ls-remote', '--tags', 'origin', `refs/tags/${tag}`])) !== '';

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
 * Point `tag` at `sha`, locally and on the remote.
 *
 * The staging caller explicitly opts into force because that tag is rolling.
 * Stable tags never opt in, so git rejects collisions even if a caller misses
 * a preflight check.
 */
export const setTag = async (options: {
  tag: string;
  sha: string;
  message: string;
  force: boolean;
  dryRun: boolean;
}): Promise<void> => {
  const { tag, sha, message, force, dryRun } = options;
  const forceFlag = force ? ' -f' : '';
  if (dryRun) {
    log(
      `  ${c.dim}[dry-run] git tag${forceFlag} -a ${tag} ${sha.slice(0, 8)} && git push${forceFlag} origin ${tag}${c.reset}`,
    );
    return;
  }
  const tagArgs = ['git', 'tag', ...(force ? ['-f'] : []), '-a', tag, sha, '-m', message];
  const pushArgs = ['git', 'push', ...(force ? ['--force'] : []), 'origin', `refs/tags/${tag}`];
  await checked(tagArgs);
  await checked(pushArgs);
};

// ── gh release ───────────────────────────────────────────────────────────

export const releaseExists = async (tag: string): Promise<boolean> => {
  const res = await run(['gh', 'release', 'view', tag, '--json', 'tagName']);
  return res.code === 0;
};

/** Metadata needed to restore a published release after replacement fails. */
export type ReleaseMetadata = {
  title: string;
  body: string;
  prerelease: boolean;
};

/** Published release metadata, or null only when GitHub reports it missing. */
export const releaseMetadata = async (tag: string): Promise<ReleaseMetadata | null> => {
  const res = await run(['gh', 'release', 'view', tag, '--json', 'name,body,isPrerelease']);
  if (res.code !== 0) {
    if (/release not found/i.test(res.err + res.out)) {
      return null;
    }
    throw new Error(`gh release view ${tag} failed: ${res.err || res.out}`);
  }

  const value: unknown = JSON.parse(res.out);
  if (
    typeof value !== 'object' ||
    value === null ||
    !('name' in value) ||
    typeof value.name !== 'string' ||
    !('body' in value) ||
    typeof value.body !== 'string' ||
    !('isPrerelease' in value) ||
    typeof value.isPrerelease !== 'boolean'
  ) {
    throw new Error(`gh release view ${tag} returned invalid metadata`);
  }
  return { title: value.name, body: value.body, prerelease: value.isPrerelease };
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

const delay = async (milliseconds: number): Promise<void> =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

/** Wait for the release workflow for `sha` to appear and finish successfully. */
export const waitForReleaseWorkflow = async (sha: string): Promise<void> => {
  let runId = '';
  for (let attempt = 0; attempt < 30; attempt++) {
    runId = await checked([
      'gh',
      'run',
      'list',
      '--workflow',
      'release.yml',
      '--event',
      'release',
      '--commit',
      sha,
      '--limit',
      '1',
      '--json',
      'databaseId',
      '--jq',
      '.[0].databaseId',
    ]);
    if (runId !== '') {
      break;
    }
    await delay(2000);
  }
  if (runId === '') {
    throw new Error(`Timed out waiting for release.yml to start for ${sha.slice(0, 8)}`);
  }
  await checked(['gh', 'run', 'watch', runId, '--compact', '--exit-status']);
};

/** True when a published release exposes an asset with the exact name. */
export const releaseHasAsset = async (options: {
  tag: string;
  asset: string;
}): Promise<boolean> => {
  const output = await checked([
    'gh',
    'release',
    'view',
    options.tag,
    '--json',
    'assets',
    '--jq',
    '.assets[].name',
  ]);
  return output.split('\n').includes(options.asset);
};

/** URL of a release page, for the CLI's closing summary. */
export const releaseUrl = async (tag: string): Promise<string> => {
  const res = await run(['gh', 'release', 'view', tag, '--json', 'url', '--jq', '.url']);
  return res.code === 0 ? res.out.trim() : `(tag ${tag})`;
};

export const formatVersionTag = (version: Semver): string => `v${formatSemver(version)}`;
