#!/usr/bin/env bun
// scripts/src/lib/ops/guard_workspace_boundary.ts
//
// Refuse a destructive git operation performed by a pipeline agent against a
// repository that is NOT its own worktree.
//
// 🔴 2026-09-02: an agent running in a worktree pane decided on its own to
// compare typecheck errors against `main`. It did that by operating on the
// MAIN checkout — a live developer workspace holding uncommitted work — and
// left a merge conflict that disrupted unrelated in-flight development.
//
// The prompts now forbid this (see WORKSPACE_BOUNDARY_RULES in
// prompt_loader.ts and the WORKSPACE BOUNDARY section of .pi/prompts/dev.md),
// but a prompt is advice. This is the enforcement.
//
// ── How the caller is identified ──
//
// `CONTRACT_PIPELINE_WORKSPACE_PATH` is exported into every pipeline agent
// pane by herdr_adapter (`tab create --env`), and names that pane's worktree.
// It is inherited by every command the agent runs, so it is present no matter
// how deeply the agent nests shells. A human's shell never has it.
//
// The rule is therefore exact: that variable set, plus a repository root that
// is not the named worktree, means an agent has reached outside its workspace.
//
// ── Deliberate exemptions ──
//
// * `CONTRACT_PIPELINE_ROLE=review` — the review captain is SUPPOSED to work
//   in root. herdr_adapter gives it the worktree cwd only for yolo/blocked/
//   worktree reviews; otherwise it runs in repoRoot to create PRs and push
//   contract updates to `main`. Blocking it would break the pipeline's own
//   recovery path.
// * Variable unset — a human, CI, or the orchestrator process itself (which
//   is launched from the user's shell and legitimately commits to root).
//
// ── Known coverage gap ──
//
// Git has no `pre-checkout` or `pre-reset` hook, so `git checkout`, `git
// switch`, `git reset` and `git stash` in another repo CANNOT be intercepted
// here. This guard covers the operations that leave lasting damage — commit,
// merge, rebase, push. The prompt rules remain the primary defense.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

/** Resolve symlinks and casing so two spellings of one path compare equal. */
const canonical = (path: string): string => {
  try {
    return realpathSync.native(resolve(path));
  } catch {
    return resolve(path);
  }
};

const repositoryRoot = (): string | undefined => {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
  } catch {
    return undefined;
  }
};

/**
 * The boundary decision, split out from process control so it is testable
 * without spawning git or exiting the process.
 */
export const isOutsideAgentWorkspace = (options: {
  workspacePath: string | undefined;
  role: string | undefined;
  repositoryRoot: string | undefined;
}): boolean => {
  if (!options.workspacePath) {
    return false; // Human, CI, or the orchestrator itself.
  }
  if (options.role === 'review') {
    return false; // The review captain works in root by design.
  }
  if (!options.repositoryRoot) {
    return false; // Not in a repo — nothing to protect.
  }
  return canonical(options.repositoryRoot) !== canonical(options.workspacePath);
};

const main = (): void => {
  const workspacePath = process.env.CONTRACT_PIPELINE_WORKSPACE_PATH;
  const role = process.env.CONTRACT_PIPELINE_ROLE;
  const root = repositoryRoot();
  if (!isOutsideAgentWorkspace({ workspacePath, role, repositoryRoot: root })) {
    return;
  }
  const operation = process.env.GIT_REFLOG_ACTION ?? 'this git operation';
  console.error(
    [
      '',
      '❌ BLOCKED: workspace boundary violation',
      '',
      `   You are the pipeline ${role ?? 'agent'}, and your workspace is:`,
      `     ${workspacePath}`,
      '   But you are running git against a DIFFERENT repository:',
      `     ${root}`,
      '',
      `   That is the human's live checkout. It holds uncommitted work, and ${operation}`,
      '   here would disrupt development that has nothing to do with your contract.',
      '',
      '   Everything you need is readable from inside your own worktree:',
      '     git show main:<path>       # file contents on main',
      '     git diff main -- <path>    # your changes vs main',
      '     git log main..HEAD         # commits you added',
      '     git fetch origin main      # refresh the ref (no checkout)',
      '',
      '   For a baseline measurement, `git stash` INSIDE your worktree, or create a',
      '   second worktree of your own. If you cannot answer the question without',
      "   another checkout, report it in your findings — disrupting the human's",
      '   workspace is never the right trade.',
      '',
    ].join('\n'),
  );
  process.exit(1);
};

if (import.meta.main) {
  main();
}
