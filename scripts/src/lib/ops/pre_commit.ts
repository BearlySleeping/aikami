#!/usr/bin/env bun
// scripts/src/lib/ops/pre_commit.ts
//
// Centralized pre-commit hook. Run from .moon/workspace.yml via `bun run pre-commit`.
// In contract pipeline worktrees (CONTRACT_PIPELINE_WORKTREE=1), skips only
// knowledge:sync — shared dashboard files cause merge conflicts in PRs.
// Formatting and typechecking always run.

import { execSync } from 'node:child_process';

const isWorktree = !!process.env.CONTRACT_PIPELINE_WORKTREE;

const run = (cmd: string): void => {
  console.log(`  → ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Pre-commit step failed: ${msg.slice(0, 300)}`);
    process.exit(1);
  }
};

// 1. Fix formatting + lint on affected staged files (always)
run('bunx moon run :fix --affected --status=staged');

// 2. Typecheck affected projects (always)
run('bunx moon run :typecheck --affected --status=staged');

if (!isWorktree) {
  // 3. Regenerate dashboard files (main repo only)
  run('bun knowledge:sync');

  // 4. Stage dashboard files modified by sync
  run('git add .context/llms.txt docs/contracts/ 2>/dev/null || true');
}

// 5. Re-stage files that formatters may have modified (always)
run('git diff -z --name-only --cached | xargs -0 git add 2>/dev/null || true');
