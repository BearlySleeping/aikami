#!/usr/bin/env bun
// scripts/src/lib/herdr/worktree_bootstrap.ts
//
// `bun run worktree:bootstrap` — seed + install a worktree created by the RAW
// `herdr worktree create` CLI.
//
// Why this exists: `createWorktree()` in herdr/worktree.ts bootstraps the
// worktrees IT creates (task sessions, contract pipeline), but a worktree
// made by hand with `herdr worktree create` (or by any tool that doesn't go
// through that function) is a bare git checkout with none of the gitignored
// env files. Without them the client boots in the wrong mode (the
// `__AIKAMI_TEST__` seam is not installed), the site build fails validation,
// and the visual runner finds no OPENROUTER_API_KEY. Herdr has no
// repo-scoped post-create hook (its plugin `worktree.created` event is
// user-global), so this command is the documented manual path.
//
// Usage:
//   bun run worktree:bootstrap -- --cwd <path>
//   bun run worktree:bootstrap                    # current directory
//   bun run worktree:bootstrap -- --cwd <path> --no-install
//   bun run worktree:bootstrap -- --cwd <path> --no-seed
//   bun run worktree:bootstrap -- --cwd <path> --repo-root <path>
//
// Exits non-zero when a seed file present in the root checkout is missing from
// the worktree after seeding, or when the requested install failed.

import { resolve } from 'node:path';
import { bootstrapWorktree, worktreeRepoRoot } from './worktree.ts';

const args = process.argv.slice(2);

const argValue = (flag: string): string | undefined => {
  const inline = args.find((argument) => argument.startsWith(`${flag}=`));
  if (inline) {
    return inline.slice(flag.length + 1);
  }
  const index = args.indexOf(flag);
  return index !== -1 && args[index + 1] ? args[index + 1] : undefined;
};

const hasFlag = (flag: string): boolean => args.includes(flag);

if (hasFlag('--help') || hasFlag('-h')) {
  console.log(`Usage: bun run worktree:bootstrap -- --cwd <path> [options]

Bootstraps a manually created herdr worktree: seed gitignored env files from
the root checkout, then bun install.

Options:
  --cwd <path>        Worktree checkout (default: current directory).
  --repo-root <path>  Root checkout to seed FROM (default: derived from .git).
  --no-install        Skip bun install (seed files only).
  --no-seed           Skip env seed files (install only).
  -h, --help          Show this help.`);
  process.exit(0);
}

const checkoutPath = resolve(argValue('--cwd') ?? process.cwd());
let repoRoot = argValue('--repo-root');
if (!repoRoot) {
  try {
    repoRoot = worktreeRepoRoot(checkoutPath);
  } catch (err: unknown) {
    console.error(
      `❌ Cannot determine the root checkout for ${checkoutPath}: ` +
        `${err instanceof Error ? err.message : String(err)}\n` +
        '   Pass --repo-root <path> explicitly.',
    );
    process.exit(1);
  }
}
const install = !hasFlag('--no-install');
const seed = !hasFlag('--no-seed');

console.log(`🔧 Bootstrapping worktree ${checkoutPath}`);
console.log(`   root checkout: ${repoRoot}`);
console.log(`   seed files: ${seed ? 'yes' : 'no'}   bun install: ${install ? 'yes' : 'no'}`);

const { installed, missingSeeds } = await bootstrapWorktree({
  checkoutPath,
  repoRoot,
  install,
  seed,
});

let failed = false;
if (missingSeeds.length > 0) {
  console.error(
    `\n❌ Missing env seeds in the worktree: ${missingSeeds.join(', ')}\n` +
      '   Dev servers / E2E would boot without required environment.',
  );
  failed = true;
}
if (install && !installed) {
  console.error(`\n❌ bun install did not complete in ${checkoutPath}.`);
  failed = true;
}

if (failed) {
  process.exit(1);
}
console.log(`\n✅ Worktree bootstrapped: ${checkoutPath}`);
