#!/usr/bin/env bun

// scripts/src/lib/ops/autofix_restore.ts
//
// Restore the working tree to a pre-autofix baseline snapshot.
//
// The autofix pipeline (`bun autofix` → start_autofix.ts) snapshots the full
// working-tree state BEFORE the agent runs, storing it under
// ~/.herdr/autofix-snapshots/<timestamp>/ as:
//   - tracked.patch  — `git diff --binary HEAD` (all tracked modifications)
//   - untracked.txt  — list of untracked files
//   - untracked/     — copies of those untracked files
//   - HEAD.txt       — the HEAD commit the patch applies to
//
// If the agent ever destroys pre-existing work (e.g. reverting CRLF churn
// with `git checkout --`), this script restores it.
//
// Usage:
//   bun run autofix:restore              # list available snapshots
//   bun run autofix:restore <timestamp>  # restore that snapshot
//
// Note: if the agent already committed (pipeline step 4), restoring the patch
// may conflict with the new HEAD. Apply the patch manually (`git apply --binary
// <snapshot>/tracked.patch`) and resolve conflicts if that happens.

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const SNAPSHOT_ROOT = join(homedir(), '.herdr', 'autofix-snapshots');

const listSnapshots = (): void => {
  if (!existsSync(SNAPSHOT_ROOT)) {
    console.log('No autofix snapshots found yet.');
    return;
  }
  const snapshots = readdirSync(SNAPSHOT_ROOT)
    .filter((d) => existsSync(join(SNAPSHOT_ROOT, d, 'tracked.patch')))
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

const restoreSnapshot = (timestamp: string): void => {
  const dir = join(SNAPSHOT_ROOT, timestamp);
  const patchFile = join(dir, 'tracked.patch');
  if (!existsSync(patchFile)) {
    console.error(`❌ No snapshot found at ${dir}`);
    listSnapshots();
    process.exit(1);
  }

  const repoRoot = process.cwd();

  // Sanity: only restore when the patch still applies to the current HEAD.
  const headFile = join(dir, 'HEAD.txt');
  let currentHead = '';
  try {
    currentHead = execSync('git rev-parse HEAD', { cwd: repoRoot }).toString().trim();
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

  // 1. Restore tracked modifications. Plain apply first so the working tree
  //    matches the pre-run state (unstaged); fall back to --3way (stages) only
  //    when the patch no longer applies cleanly.
  let applyResult = '';
  try {
    applyResult = execSync(`git apply --binary "${patchFile}"`, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
    console.log(`✓ Applied tracked.patch (${applyResult.trim() || 'clean, unstaged'})`);
  } catch {
    console.warn('  Plain apply failed (HEAD likely moved) — retrying with --3way…');
    applyResult = execSync(`git apply --3way --binary "${patchFile}"`, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
    console.log(`✓ Applied tracked.patch via --3way (${applyResult.trim() || 'staged'})`);
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
