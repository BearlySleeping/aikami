// scripts/src/lib/ops/sync_workspace.ts
//
// `moon sync` for the post-checkout / post-merge git hooks, and for
// `postinstall`.
//
// 🔴 Why `postinstall` needs this instead of calling `moon sync` directly.
//
// A bare `moon sync` in `postinstall` writes/inspects `.git/hooks`, which a
// git-restricted sandbox (AI coding agents included — see CodeRabbit's
// autofix logs) denies. `bun install` doesn't hard-fail on a nonzero
// postinstall script, but it does surface the failure as an error that then
// has to be manually triaged and re-confirmed harmless every time. Routing
// through this script's try/catch makes that install silent instead.
//
// 🔴 Why this is a script and not a shell one-liner in .moon/workspace.yml.
//
// The hook used to be `if [ -x node_modules/.bin/moon ]; then bunx moon sync; fi`.
// moon copies hook commands verbatim into the generated hook file, and on
// Windows it generates PowerShell (.ps1) rather than bash — where POSIX test
// syntax is a parse error, so the hook failed on every checkout and merge for
// Windows contributors. `bun run <script>` is the one spelling that behaves
// identically on Linux, macOS and Windows.
//
// 🔴 Why `moon sync` must never run in a linked worktree.
//
//   * `post-checkout` fires on `git worktree add`, and again on every branch
//     switch inside the worktree, with the cwd set to that worktree.
//   * If `moon sync` runs there, it writes tsconfig references and project
//     sync artifacts into the worktree before the orchestrator takes its
//     pre-stage `captureGitState` snapshot, and `commitAll`'s `git add -A`
//     then sweeps those unrelated files into the implementation commit.
//
// This used to be enforced by accident: the "is moon installed locally" guard
// below found no `.bin/moon` in a worktree, because pipeline worktrees got a
// `node_modules` holding only the `@aikami` workspace symlinks. That accident
// no longer holds — herdr/worktree.ts now symlinks root's `node_modules/.bin`
// into every worktree precisely so the pre-commit hook can find moon, biome
// and tsc there. `isLinkedWorktree` is the explicit guard that replaces it;
// the moon-binary check stays for the case it actually describes (a fresh
// clone before `bun install`).
//
// So: sync the developer's main checkout, never a worktree. Silence is the
// correct outcome in both cases — a git hook must not fail a checkout over a
// workspace nicety.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isLinkedWorktree } from './git_worktree_detect.ts';

const localMoonBinary = (): string | undefined => {
  // Bun/npm write `moon` (shell shim) on POSIX and `moon.cmd`/`moon.exe` on
  // Windows; checking all three keeps the guard honest cross-platform.
  for (const name of ['moon', 'moon.cmd', 'moon.exe']) {
    const candidate = join(process.cwd(), 'node_modules', '.bin', name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
};

const main = (): void => {
  if (isLinkedWorktree()) {
    // See the header: a worktree must never gain `moon sync` artifacts.
    return;
  }
  const binary = localMoonBinary();
  if (!binary) {
    // Fresh clone before `bun install` — exit 0 so the checkout/merge is
    // never blocked.
    return;
  }
  try {
    execFileSync(binary, ['sync'], {
      stdio: 'inherit',
      // Windows: .cmd shims are not directly executable without a shell.
      shell: process.platform === 'win32',
      windowsHide: true,
    });
  } catch (error: unknown) {
    // A failed sync is a warning, never a blocked checkout.
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️  moon sync failed (non-fatal): ${message.slice(0, 200)}`);
  }
};

main();
