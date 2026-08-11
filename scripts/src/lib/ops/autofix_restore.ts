#!/usr/bin/env bun

// scripts/src/lib/ops/autofix_restore.ts
//
// Restore the working tree to a pre-autofix baseline snapshot.
//
// The autofix pipeline (`bun autofix` → start_autofix.ts) snapshots the full
// working-tree state BEFORE the agent runs, storing it under
// ~/.herdr/autofix-snapshots/<timestamp>/ as:
//   - tracked.patch    — `git diff --binary HEAD` (combined; backward-compat)
//   - staged.patch     — `git diff --cached --binary` (index-only changes)
//   - unstaged.patch   — `git diff --binary` (worktree-only changes)
//   - untracked.txt    — list of untracked files
//   - untracked/       — copies of those untracked files
//   - HEAD.txt         — the HEAD commit the patches apply to
//
// If the agent ever destroys pre-existing work (e.g. reverting CRLF churn
// with `git checkout --`), this script restores it. Staged changes are put
// back on the index (via `git apply --cached`); unstaged changes are applied
// to the working tree only.
//
// Usage:
//   bun run autofix:restore              # list available snapshots
//   bun run autofix:restore <timestamp>  # restore that snapshot
//
// Note: if the agent already committed (pipeline step 4), restoring the patch
// may conflict with the new HEAD. Apply the patch manually (`git apply --binary
// <snapshot>/tracked.patch`) and resolve conflicts if that happens.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const SNAPSHOT_ROOT = join(homedir(), '.herdr', 'autofix-snapshots');

/** True when `name` is a direct child entry of SNAPSHOT_ROOT. */
const isDirectChild = (name: string): boolean =>
  name.length > 0 && name === basename(name) && name !== '.' && name !== '..';

const listSnapshots = (): void => {
  if (!existsSync(SNAPSHOT_ROOT)) {
    console.log('No autofix snapshots found yet.');
    return;
  }
  const snapshots = readdirSync(SNAPSHOT_ROOT)
    .filter((d) => isDirectChild(d) && existsSync(join(SNAPSHOT_ROOT, d, 'tracked.patch')))
    .sort();
  if (snapshots.length === 0) {
    console.log('No autofix snapshots found yet.');
    return;
  }
  console.log('Available autofix snapshots:');
  for (const s of snapshots) {
    const headFile = join(SNAPSHOT_ROOT, s, 'HEAD.txt');
    const head = existsSync(headFile)
      ? ` (HEAD ${readFileSync(headFile, 'utf8').trim().slice(0, 12)})`
      : '';
    console.log(`  ${s}${head}`);
  }
  console.log('\nRestore one with: bun run autofix:restore <timestamp>');
};

const git = (args: string[], repoRoot: string): string => {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString();
};

const restoreSnapshot = (timestamp: string): void => {
  // Reject nested or otherwise invalid paths — the timestamp must identify an
  // existing entry directly under SNAPSHOT_ROOT (no path traversal).
  if (!isDirectChild(timestamp)) {
    console.error(`❌ Invalid snapshot: "${timestamp}"`);
    listSnapshots();
    process.exit(1);
  }
  const dir = resolve(SNAPSHOT_ROOT, timestamp);
  if (!dir.startsWith(`${resolve(SNAPSHOT_ROOT)}\\`) && dir !== resolve(SNAPSHOT_ROOT)) {
    console.error(`❌ Invalid snapshot path: ${dir}`);
    process.exit(1);
  }
  const combinedPatch = join(dir, 'tracked.patch');
  if (!existsSync(combinedPatch)) {
    console.error(`❌ No snapshot found at ${dir}`);
    listSnapshots();
    process.exit(1);
  }

  const repoRoot = process.cwd();

  // Sanity: only restore when the patch still applies to the current HEAD.
  const headFile = join(dir, 'HEAD.txt');
  let currentHead = '';
  try {
    currentHead = git(['rev-parse', 'HEAD'], repoRoot).trim();
  } catch {
    // not a git repo — let git apply complain
  }
  if (existsSync(headFile)) {
    const snapshotHead = readFileSync(headFile, 'utf8').trim();
    if (currentHead && currentHead !== snapshotHead) {
      console.warn(
        `⚠️  Current HEAD (${currentHead.slice(0, 12)}) differs from snapshot HEAD (${snapshotHead.slice(0, 12)}).`,
      );
      console.warn('  The patch may not apply cleanly if the agent committed changes.');
      console.warn('  Proceeding with `git apply --3way` for the best-effort restore…\n');
    }
  }

  const applyPatch = (patch: string, extraArgs: string[], label: string): boolean => {
    try {
      git(['apply', '--binary', ...extraArgs, patch], repoRoot);
      console.log(`✓ Applied ${label}`);
      return true;
    } catch {
      return false;
    }
  };

  // 1. Restore tracked changes. New snapshots carry staged/unstaged split;
  //    older ones only have the combined tracked.patch — fall back to it.
  const stagedPatch = join(dir, 'staged.patch');
  const unstagedPatch = join(dir, 'unstaged.patch');
  if (existsSync(stagedPatch) && existsSync(unstagedPatch)) {
    // Worktree first, then stage the index-only changes so the index matches
    // the pre-run state exactly.
    if (!applyPatch(unstagedPatch, [], 'unstaged.patch (working tree)')) {
      console.warn('  Plain unstaged apply failed (HEAD likely moved) — retrying with --3way…');
      applyPatch(unstagedPatch, ['--3way'], 'unstaged.patch via --3way');
    }
    if (!applyPatch(stagedPatch, ['--cached'], 'staged.patch (index)')) {
      console.warn('  Plain staged apply failed — retrying with --3way --cached…');
      applyPatch(stagedPatch, ['--3way', '--cached'], 'staged.patch via --3way --cached');
    }
  } else {
    // Legacy snapshot: apply the combined patch to the working tree; fall
    // back to --3way (stages) only when it no longer applies cleanly.
    if (!applyPatch(combinedPatch, [], 'tracked.patch (legacy, unstaged)')) {
      console.warn('  Plain apply failed (HEAD likely moved) — retrying with --3way…');
      applyPatch(combinedPatch, ['--3way'], 'tracked.patch via --3way');
    }
  }

  // 2. Restore untracked files.
  const untrackedList = join(dir, 'untracked.txt');
  const untrackedDir = join(dir, 'untracked');
  if (existsSync(untrackedList) && existsSync(untrackedDir)) {
    const files = readFileSync(untrackedList, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    let restored = 0;
    for (const f of files) {
      const src = join(untrackedDir, f);
      const dest = join(repoRoot, f);
      if (existsSync(src)) {
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(src, dest);
        restored += 1;
      }
    }
    console.log(`✓ Restored ${restored}/${files.length} untracked files`);
  } else {
    console.log('✓ No untracked files in snapshot');
  }

  console.log('\nDone. Verify with `git status`.');
};

const arg = process.argv[2];
if (!arg) {
  listSnapshots();
} else {
  restoreSnapshot(arg);
}
