#!/usr/bin/env bun
// scripts/src/lib/ops/pre_commit.ts
//
// Centralized pre-commit hook. Run from .moon/workspace.yml via `bun run pre-commit`.
// Skips everything in contract pipeline worktrees (CONTRACT_PIPELINE_WORKTREE=1)
// to prevent shared files (PROGRESS.md, PROMOTION.md, .context/llms.txt) from
// being regenerated and staged — which causes merge conflicts in PRs.
//
// In worktrees, the pipeline's commitAll passes CONTRACT_PIPELINE_WORKTREE=1.
// On main (after PR merge), these files are regenerated normally.

import { execSync } from 'node:child_process';

if (process.env.CONTRACT_PIPELINE_WORKTREE) {
  console.log('🔇 Skipping pre-commit hooks in contract pipeline worktree.');
  process.exit(0);
}

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

// 1. Fix formatting + lint on affected staged files
run('bunx moon run :fix --affected --status=staged');

// 2. Typecheck affected projects
run('bunx moon run :typecheck --affected --status=staged');

// 3. Regenerate contract dashboard files (PROGRESS.md, PROMOTION.md, .context/llms.txt)
run('bun knowledge:sync');

// 4. Stage any files modified by the sync/formatters
run('git add .context/llms.txt docs/contracts/ 2>/dev/null || true');
run('git diff -z --name-only --cached | xargs -0 git add 2>/dev/null || true');
