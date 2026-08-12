// scripts/src/lib/agents/contract_pipeline/contract_sync.ts
//
// Contract-file ownership: the contract document lives on `main`, never in a
// PR branch.
//
// Why this module exists
// ----------------------
// The contract file is the one path both the pipeline (root checkout) and the
// worker agents (worktree) want to write:
//
//   • the critic stamps `| **Status** | approved |`      → root
//   • the implementer appends the Execution Report        → worktree
//   • the verifier updates the AC evidence matrix         → worktree
//
// If those worktree edits ride the PR branch, the same file is modified on two
// branches and every `git pull` after a merge conflicts against whatever the
// root checkout still has staged. The fix is a single invariant:
//
//   🔴 The contract file is OWNED BY MAIN.
//      It is `skip-worktree` in every worktree (so it can never enter a PR
//      diff), and any agent edit is pulled back to root and pushed to main on
//      its own commit.
//
// Previously this lived inline in `orchestrator.ts` gated on
// `stage === 'critique'`. Runs started with `--source path` (a hand-authored
// contract) skip the authoring stages entirely, so the gate never fired: the
// contract was never `skip-worktree`d, the implementer's Execution Report was
// committed to the PR branch, and the root checkout was left dirty. Hoisting
// the logic here and calling it per-run instead of per-stage closes that hole.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { runGit } from '../git_worktree.ts';

/** Git identity used for pipeline-authored contract commits. */
const AGENT_ENV = {
  CONTRACT_PIPELINE_WORKTREE: '1',
  GIT_AUTHOR_NAME: 'Pi Agent',
  GIT_AUTHOR_EMAIL: 'agent@pi.internal',
  GIT_COMMITTER_NAME: 'Pi Agent',
  GIT_COMMITTER_EMAIL: 'agent@pi.internal',
} as const;

/** Outcome of a contract sync attempt — never throws, always reports. */
export type ContractSyncResult = {
  /** True when the operation completed and left no uncommitted contract edit. */
  ok: boolean;
  /** Human-readable outcome for the pipeline log / review pane. */
  message: string;
  /** True when a commit was actually created (no-op syncs report false). */
  committed: boolean;
};

/** Returns the current branch of a checkout, or undefined when detached/unknown. */
export const currentBranch = (cwd: string): string | undefined => {
  try {
    const branch = runGit('rev-parse --abbrev-ref HEAD', { cwd, timeoutMs: 5000 }).trim();
    return branch === 'HEAD' ? undefined : branch;
  } catch {
    return undefined;
  }
};

/**
 * Reports whether a path has uncommitted changes in the given checkout.
 *
 * Uses `status --porcelain` scoped to the single path so an unrelated dirty
 * working tree never masks (or fabricates) a contract-file finding.
 */
export const hasUncommittedChanges = (options: { cwd: string; path: string }): boolean => {
  try {
    const out = runGit(`status --porcelain -- '${options.path}'`, {
      cwd: options.cwd,
      timeoutMs: 10_000,
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
};

/**
 * Marks the contract file `skip-worktree` inside a worktree so it can never
 * enter the PR diff, after seeding it with the root's current content.
 *
 * Idempotent: safe to call before every stage. `skip-worktree` is re-applied
 * because a `git checkout`/`reset` inside the worktree can clear the bit.
 *
 * The file stays readable and writable on disk — agents can still append their
 * Execution Report; {@link pullContractFromWorktree} is what carries that edit
 * back to main.
 *
 * @param options.repoRoot - The root checkout (owner of the contract).
 * @param options.worktreePath - The worktree to isolate. No-op when undefined.
 * @param options.contractPath - Absolute path to the contract in the root checkout.
 */
export const isolateContractInWorktree = (options: {
  repoRoot: string;
  worktreePath: string | undefined;
  contractPath: string;
}): ContractSyncResult => {
  const { repoRoot, worktreePath, contractPath } = options;
  if (!worktreePath) {
    return { ok: true, message: 'No worktree — contract isolation not needed.', committed: false };
  }
  if (!existsSync(contractPath)) {
    return { ok: true, message: 'Contract file does not exist yet.', committed: false };
  }

  const relPath = relative(repoRoot, contractPath);
  const worktreeCopy = join(worktreePath, relPath);

  try {
    // The skip-worktree bit makes git ignore writes to the path, so it must be
    // cleared before seeding or the copy would be invisible to a later
    // `git checkout` and could be silently reverted.
    try {
      runGit(`update-index --no-skip-worktree '${relPath}'`, { cwd: worktreePath });
    } catch {
      // Not yet tracked/marked in this worktree — nothing to clear.
    }

    mkdirSync(dirname(worktreeCopy), { recursive: true });
    copyFileSync(contractPath, worktreeCopy);
    runGit(`update-index --skip-worktree '${relPath}'`, { cwd: worktreePath });

    return {
      ok: true,
      message: `Contract isolated in worktree (skip-worktree): ${relPath}`,
      committed: false,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: `Contract isolation failed (non-fatal): ${msg.slice(0, 200)}`,
      committed: false,
    };
  }
};

/**
 * Commits and pushes the root checkout's contract file to `main`.
 *
 * 🔴 Refuses when the root checkout is not on `main`. `git add` + `git commit`
 * operate on the checked-out branch, so committing while the root sits on
 * `contract/C-XXX` (root mode) would land the contract on that branch and the
 * subsequent `git push origin main` would push a *different*, unrelated ref.
 * In that case the file is left in place and the caller is told exactly what
 * to run — a dirty file the user knows about beats a commit on the wrong branch.
 *
 * @param options.repoRoot - The root checkout.
 * @param options.contractPath - Absolute path to the contract.
 * @param options.message - Commit subject.
 */
export const commitContractToMain = (options: {
  repoRoot: string;
  contractPath: string;
  message: string;
}): ContractSyncResult => {
  const { repoRoot, contractPath, message } = options;
  if (!existsSync(contractPath)) {
    return {
      ok: true,
      message: 'Contract file does not exist — nothing to commit.',
      committed: false,
    };
  }

  const relPath = relative(repoRoot, contractPath);

  if (!hasUncommittedChanges({ cwd: repoRoot, path: relPath })) {
    return { ok: true, message: 'Contract unchanged — nothing to commit.', committed: false };
  }

  const branch = currentBranch(repoRoot);
  if (branch !== 'main' && branch !== 'master') {
    return {
      ok: false,
      committed: false,
      message: [
        `Root checkout is on '${branch ?? 'a detached HEAD'}', not main — refusing to commit the contract there.`,
        `The contract edit is saved at ${relPath} but NOT committed.`,
        'Sync it manually once you are back on main:',
        `  git checkout main && git add -- '${relPath}' && git commit -m "${message}" && git push origin main`,
      ].join('\n'),
    };
  }

  // 🔴 Commit and push are reported separately on purpose. The user-visible
  // failure this module exists to prevent is a DIRTY ROOT TREE (it aborts
  // `git pull --ff-only`). A successful commit fixes that even if the push
  // later fails — reporting the whole thing as failed, and telling the user to
  // re-run `git add && git commit`, would be actively wrong.
  try {
    runGit(`add -- '${relPath}'`, { cwd: repoRoot });
    runGit(`commit --no-verify -m "${message}"`, { cwd: repoRoot, env: { ...AGENT_ENV } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      committed: false,
      message: [
        `Contract commit failed: ${msg.slice(0, 300)}`,
        `The edit is saved at ${relPath} but is NOT committed. Resolve manually:`,
        `  git add -- '${relPath}' && git commit -m "${message}" && git push origin main`,
      ].join('\n'),
    };
  }

  try {
    runGit('push origin main', { cwd: repoRoot, timeoutMs: 180_000 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      // The working tree is clean, which is what unblocks the user's `git pull`.
      // The unpushed commit is a follow-up, not a broken state.
      ok: true,
      committed: true,
      message: [
        `Contract committed to main locally, but the push failed: ${msg.slice(0, 300)}`,
        'The working tree is clean. Push when convenient:',
        '  git push origin main',
      ].join('\n'),
    };
  }

  return { ok: true, message: `Contract pushed to main: ${relPath}`, committed: true };
};

/**
 * Carries an agent's contract edit (Execution Report, AC evidence matrix) from
 * the worktree back to the root checkout and onto `main`.
 *
 * This is the counterpart to {@link isolateContractInWorktree}: because the
 * contract is `skip-worktree` in the worktree, the agent's edit exists only on
 * disk there and would otherwise be discarded with the worktree.
 *
 * No-ops when the worktree copy is byte-identical to the root's — so a stage
 * that did not touch the contract produces no empty commit.
 *
 * @param options.repoRoot - The root checkout.
 * @param options.worktreePath - The worktree holding the agent's edit.
 * @param options.contractPath - Absolute path to the contract in the root checkout.
 * @param options.contractId - Contract id, for the commit subject.
 * @param options.stage - Stage name, for the commit subject.
 */
export const pullContractFromWorktree = (options: {
  repoRoot: string;
  worktreePath: string | undefined;
  contractPath: string;
  contractId: string;
  stage: string;
}): ContractSyncResult => {
  const { repoRoot, worktreePath, contractPath, contractId, stage } = options;
  if (!worktreePath) {
    return { ok: true, message: 'No worktree — nothing to pull back.', committed: false };
  }

  const relPath = relative(repoRoot, contractPath);
  const worktreeCopy = join(worktreePath, relPath);
  if (!existsSync(worktreeCopy)) {
    return { ok: true, message: 'No contract copy in worktree.', committed: false };
  }

  try {
    const worktreeContent = readFileSync(worktreeCopy, 'utf-8');
    const rootContent = existsSync(contractPath) ? readFileSync(contractPath, 'utf-8') : '';
    if (worktreeContent === rootContent) {
      return { ok: true, message: 'Contract unchanged by this stage.', committed: false };
    }
    copyFileSync(worktreeCopy, contractPath);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      committed: false,
      message: `Could not read the worktree contract copy: ${msg.slice(0, 200)}`,
    };
  }

  return commitContractToMain({
    repoRoot,
    contractPath,
    message: `docs(contracts): ${contractId} ${stage} notes`,
  });
};
