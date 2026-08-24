#!/usr/bin/env bun
// scripts/src/lib/ops/pre_commit.ts
//
// Centralized pre-commit hook. Run from .moon/workspace.yml via `bun run pre-commit`.
// In contract pipeline worktrees (CONTRACT_PIPELINE_WORKTREE=1), skips knowledge:sync.
// Formatting and typechecking always run.

import { runStream } from '../cli_utils.ts';
import { syncContracts } from './sync_contracts.ts';

const isWorktree = !!process.env.CONTRACT_PIPELINE_WORKTREE;

const sh = async (cmd: string): Promise<void> => {
  const parts = cmd.split(' ').filter(Boolean);
  const code = await runStream(parts);
  if (code !== 0) {
    console.error(`❌ Pre-commit step failed (exit ${code}): ${cmd}`);
    process.exit(1);
  }
};

// 1. Bun version must be declared identically in .bun-version and
//    .moon/toolchains.yml — a drift silently breaks CI cache keys.
await sh('bun run scripts/src/lib/ops/verify_bun_version.ts');

// 2. Fix formatting + lint on affected staged files
await sh('bun moon run :fix --affected --status=staged --concurrency 8');

// 3. Typecheck affected projects
await sh('bun moon run :typecheck --affected --status=staged --concurrency 8');

if (!isWorktree) {
  // 4. Sync contract dashboard files (PROGRESS.md, PROMOTION.md)
  syncContracts();

  // 5. Generate .context/llms.txt
  await sh('bun run scripts/src/lib/ops/generate_llms_txt.ts');

  // 6. Stage files modified by sync
  await runStream(['sh', '-c', 'git add .context/llms.txt docs/contracts/ 2>/dev/null || true']);
}

// 7. Re-stage files that formatters may have modified
await runStream([
  'sh',
  '-c',
  'git diff -z --name-only --cached | xargs -0 -r git add 2>/dev/null || true',
]);
