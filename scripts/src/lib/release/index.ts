#!/usr/bin/env bun
// scripts/src/lib/release/index.ts
/**
 * Release CLI — cuts staging releases and promotes them to production.
 *
 * Usage:
 *   bun run release                  # cut/refresh the staging release (on `staging`)
 *   bun run release --minor          # …starting a new minor version
 *   bun run release --major          # …starting a new major version
 *   bun run release --promote        # promote the staging cut (on `production`)
 *   bun run release --dry-run        # print every git/gh mutation, do none of them
 *   bun run release --yes            # skip the confirmation prompt
 *
 * ── The model ────────────────────────────────────────────────────────────
 *
 *   main ──spam──┐
 *                ├─► staging ──push──► web deploys (automatic, unversioned)
 *                │             └────► bun run release
 *                │                      bumps the committed version, moves the
 *                │                      rolling `staging` tag, republishes the
 *                │                      single "Staging (rolling)" prerelease
 *                │                      → release.yml builds desktop @ staging
 *                └─► production ─push──► web deploys (automatic)
 *                              └────► bun run release --promote
 *                                       tags v<version>, transfers the staging
 *                                       notes, publishes as Latest
 *                                       → release.yml builds desktop @ production
 *
 * Why a rolling `staging` tag instead of one prerelease per cut: the repo is
 * public. A `v0.2.0-rc.7` prerelease per staging push buries the real releases
 * under rc noise for anyone browsing /releases, and gives the staging updater
 * channel no stable URL to poll. One permanent entry keeps the list readable
 * (v0.2.0, Staging, v0.1.0) and makes
 * `releases/download/staging/latest.json` a fixed endpoint — which is exactly
 * what tauri_release.ts points staging builds at.
 *
 * Why the version is committed rather than derived from the tag: the rolling
 * tag is the literal string "staging", so there is no version to derive. See
 * version.ts.
 *
 * Why staging bundles embed the FINAL version (0.2.0, never 0.2.0-rc.7): the
 * version a tester reports from the About screen is then the version that
 * ships, with no mental arithmetic. The tag and release entry are what
 * identify a particular staging build.
 */

import { dirname, resolve } from 'node:path';
import { stdin as processStdin, stdout as processStdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { banner, c, error, log, ok, parseCliArgs, run, step, warn } from '../cli_utils';
import {
  commitFiles,
  commitsInRange,
  createRelease,
  currentBranch,
  deleteRelease,
  formatVersionTag,
  isTreeClean,
  latestStableTag,
  localTagExists,
  originTagExists,
  pushBranch,
  releaseBody,
  releaseExists,
  releaseHasAsset,
  releaseMetadata,
  releaseUrl,
  revParse,
  STAGING_RELEASE_TITLE,
  STAGING_TAG,
  setTag,
  waitForReleaseWorkflow,
} from './github';
import { promoteNotes, renderNotes } from './notes';
import {
  type BumpKind,
  CARGO_TOML,
  formatSemver,
  parseSemver,
  readCommittedVersion,
  resolveNextVersion,
  TAURI_CONF,
  writeCommittedVersion,
} from './version';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

const STAGING_BRANCH = 'staging';
const PRODUCTION_BRANCH = 'production';

// ── Helpers ──────────────────────────────────────────────────────────────

const confirm = async (message: string, autoYes: boolean): Promise<boolean> => {
  if (autoYes) {
    log(`${c.dim}(--yes)${c.reset} ${message}`);
    return true;
  }
  if (!processStdin.isTTY) {
    warn('Non-TTY input and no --yes — refusing to cut a release unattended.');
    return false;
  }
  const rl = createInterface({ input: processStdin, output: processStdout });
  const answer = await rl.question(`\n${c.yellow}?${c.reset} ${message} ${c.dim}(y/N)${c.reset} `);
  rl.close();
  return ['y', 'yes'].includes(answer.trim().toLowerCase());
};

/**
 * Fail unless we are on `expected` with a clean tree.
 *
 * The clean-tree check is not fussiness: this command commits a version bump
 * with an explicit file list, and an unrelated dirty file would ride along
 * into a commit that a tag then points at permanently.
 */
const requireBranch = async (expected: string, dryRun: boolean): Promise<void> => {
  const branch = await currentBranch();
  if (branch !== expected) {
    throw new Error(
      `Must be on \`${expected}\` to run this (currently on \`${branch}\`).\n` +
        `  Promote main into ${expected} first, then re-run.`,
    );
  }
  if (!(await isTreeClean()) && !dryRun) {
    throw new Error(
      'Working tree is dirty — commit or stash first. A release commit must contain only the version bump.',
    );
  }
};

/** `<lastTag>..HEAD`, or every commit when the repo has no stable tag yet. */
const rangeSinceLastRelease = (lastTag: string | null): string =>
  lastTag ? `${lastTag}..HEAD` : 'HEAD';

// ── Staging cut ──────────────────────────────────────────────────────────

const cutStaging = async (options: {
  bump: BumpKind | null;
  dryRun: boolean;
  autoYes: boolean;
}): Promise<void> => {
  const { bump, dryRun, autoYes } = options;
  await requireBranch(STAGING_BRANCH, dryRun);

  step('Resolving version');
  const lastStable = await latestStableTag();
  const committedRaw = readCommittedVersion(ROOT_DIR);
  const committed = parseSemver(committedRaw);
  if (!committed) {
    throw new Error(
      `Committed version "${committedRaw}" is not semver — fix ${'Cargo.toml'} before cutting a release.`,
    );
  }

  const version = formatSemver(
    resolveNextVersion({ committed, lastStable: lastStable?.version ?? null, bump }),
  );

  log(`  Last stable:  ${lastStable?.tag ?? '(none)'}`);
  log(`  Committed:    ${committedRaw}`);
  log(`  This cut:     ${c.cyan}${version}${c.reset}${bump ? ` (--${bump})` : ''}`);

  step('Generating notes');
  const commits = await commitsInRange(rangeSinceLastRelease(lastStable?.tag ?? null));
  const body = renderNotes(commits);
  log(`  ${commits.length} commit(s) since ${lastStable?.tag ?? 'the beginning'}`);
  log(`\n${c.dim}${body}${c.reset}\n`);

  if (
    !(await confirm(`Cut staging release ${version} (rolling tag \`${STAGING_TAG}\`)?`, autoYes))
  ) {
    warn('Aborted.');
    return;
  }

  step('Committing version bump');
  // Guarded, unlike the git/gh helpers which take dryRun themselves: this one
  // edits the working tree, and a --dry-run that leaves Cargo.toml rewritten
  // and uncommitted is not a dry run.
  const changed = dryRun ? [CARGO_TOML, TAURI_CONF] : writeCommittedVersion(ROOT_DIR, version);
  if (dryRun) {
    log(`  ${c.dim}[dry-run] set version ${version} in ${changed.join(', ')}${c.reset}`);
  } else if (changed.length === 0) {
    log(`  ${c.dim}Version files already at ${version} — nothing to commit.${c.reset}`);
  }
  await commitFiles({ files: changed, message: `chore(release): v${version}`, dryRun });
  await pushBranch({ branch: STAGING_BRANCH, dryRun });

  step('Publishing staging release');
  const sha = dryRun ? 'HEAD' : await revParse('HEAD');
  await setTag({ tag: STAGING_TAG, sha, message: `Staging ${version}`, force: true, dryRun });
  // Delete-then-create rather than edit: only a newly *published* release
  // fires release.yml's `release: published` trigger. See createRelease.
  const previousRelease = await releaseMetadata(STAGING_TAG);
  if (previousRelease !== null) {
    await deleteRelease({ tag: STAGING_TAG, dryRun });
  }
  try {
    await createRelease({
      tag: STAGING_TAG,
      title: `${STAGING_RELEASE_TITLE} — ${version}`,
      body: `> Rolling staging build of \`${version}\`. Not a production release.\n\n${body}`,
      prerelease: true,
      latest: false,
      dryRun,
    });
  } catch (createError) {
    if (previousRelease === null || dryRun) {
      throw createError;
    }
    warn('Replacement failed after deleting the staging release; restoring prior metadata.');
    await createRelease({
      tag: STAGING_TAG,
      title: previousRelease.title,
      body: previousRelease.body,
      prerelease: previousRelease.prerelease,
      latest: false,
      dryRun: false,
    });
    await waitForReleaseWorkflow(sha);
    if (!(await releaseHasAsset({ tag: STAGING_TAG, asset: 'latest.json' }))) {
      throw new Error(
        `Restored ${STAGING_TAG} release completed without latest.json; original replacement error: ${createError instanceof Error ? createError.message : String(createError)}`,
      );
    }
    ok(
      'Previous staging release metadata restored; rebuild completed and latest.json is available.',
    );
    throw createError;
  }

  ok(
    `Staging release ${version} published — ${dryRun ? '(dry run)' : await releaseUrl(STAGING_TAG)}`,
  );
  log(
    `  ${c.dim}Desktop legs build now; promote with \`bun run release --promote\` on ${PRODUCTION_BRANCH}.${c.reset}`,
  );
};

// ── Production promote ───────────────────────────────────────────────────

const promote = async (options: { dryRun: boolean; autoYes: boolean }): Promise<void> => {
  const { dryRun, autoYes } = options;
  await requireBranch(PRODUCTION_BRANCH, dryRun);

  step('Verifying the staging cut is in production');
  const stagingSha = await revParse(STAGING_TAG).catch(() => {
    throw new Error(
      `No \`${STAGING_TAG}\` tag — cut a staging release first (\`bun run release\` on ${STAGING_BRANCH}).`,
    );
  });
  // An ancestor check, not an equality check: production may legitimately
  // carry hotfixes on top of the staging cut. What must never happen is
  // promoting notes for a commit production doesn't actually contain.
  const ancestry = await run(['git', 'merge-base', '--is-ancestor', stagingSha, 'HEAD']);
  if (ancestry.code !== 0) {
    throw new Error(
      `${PRODUCTION_BRANCH} does not contain the \`${STAGING_TAG}\` commit (${stagingSha.slice(0, 8)}).\n` +
        `  Merge ${STAGING_BRANCH} into ${PRODUCTION_BRANCH} first.`,
    );
  }

  const versionRaw = readCommittedVersion(ROOT_DIR);
  const version = parseSemver(versionRaw);
  if (!version) {
    throw new Error(`Committed version "${versionRaw}" is not semver.`);
  }
  const tag = formatVersionTag(version);
  const [localTagPresent, originTagPresent, publishedReleasePresent] = await Promise.all([
    localTagExists(tag),
    originTagExists(tag),
    releaseExists(tag),
  ]);
  if (localTagPresent || originTagPresent || publishedReleasePresent) {
    throw new Error(
      `${tag} already exists locally, on origin, or as a release. Cut a new staging version instead of re-promoting.`,
    );
  }

  step('Transferring notes from the staging release');
  const stagingBody = await releaseBody(STAGING_TAG);
  if (stagingBody === null) {
    throw new Error(`No \`${STAGING_TAG}\` release to transfer notes from.`);
  }
  // Strip the staging-only banner line; the rest is carried verbatim so any
  // hand-editing done on the staging release survives the promote.
  const carried = stagingBody
    .split('\n')
    .filter((line) => !line.startsWith('> Rolling staging build'))
    .join('\n')
    .trim();
  const sinceStaging = await commitsInRange(`${stagingSha}..HEAD`);
  const body = promoteNotes({ stagingBody: carried, sinceStaging });

  log(`  Version:      ${c.cyan}${formatSemver(version)}${c.reset}`);
  log(`  Extra commits since the staging cut: ${sinceStaging.length}`);
  log(`\n${c.dim}${body}${c.reset}\n`);

  if (!(await confirm(`Publish production release ${tag} as Latest?`, autoYes))) {
    warn('Aborted.');
    return;
  }

  step('Publishing production release');
  const sha = dryRun ? 'HEAD' : await revParse('HEAD');
  await setTag({
    tag,
    sha,
    message: `Release ${formatSemver(version)}`,
    force: false,
    dryRun,
  });
  await createRelease({
    tag,
    title: `Aikami ${formatSemver(version)}`,
    body,
    prerelease: false,
    latest: true,
    dryRun,
  });

  ok(`Production release ${tag} published — ${dryRun ? '(dry run)' : await releaseUrl(tag)}`);
  log(
    `  ${c.dim}Desktop legs rebuild against production config (staging bundles embed staging env, so they are never reused here).${c.reset}`,
  );
};

// ── Main ─────────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  const opts = parseCliArgs(Bun.argv.slice(2), {
    promote: { type: 'boolean' },
    patch: { type: 'boolean' },
    minor: { type: 'boolean' },
    major: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    yes: { type: 'boolean', aliases: ['y'] },
  });

  const bumps: BumpKind[] = [];
  if (opts.patch) {
    bumps.push('patch');
  }
  if (opts.minor) {
    bumps.push('minor');
  }
  if (opts.major) {
    bumps.push('major');
  }
  if (bumps.length > 1) {
    throw new Error(`Pass at most one of --patch/--minor/--major (got ${bumps.join(', ')}).`);
  }
  if (opts.promote && bumps.length > 0) {
    throw new Error('--promote takes the staging cut as-is; it cannot also bump the version.');
  }

  banner(opts.promote ? 'Promote to production' : 'Cut staging release');
  if (opts['dry-run']) {
    warn('Dry run — no git or gh mutation will be performed.\n');
  }

  if (opts.promote) {
    await promote({ dryRun: opts['dry-run'], autoYes: opts.yes });
    return;
  }
  await cutStaging({
    bump: bumps[0] ?? null,
    dryRun: opts['dry-run'],
    autoYes: opts.yes,
  });
};

try {
  await main();
} catch (err) {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
