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
//
// The commit-to-main half: independent of the root checkout's branch
// ---------------------------------------------------------------------
// `repoRoot` is normally the human's actual working directory — the same
// place they `git checkout` branches in for unrelated work. Multiple
// pipelines can also share it (every `bun run contract C-XXX` launched from
// the same cwd records that cwd as `repoRoot`). Nothing prevents a human — or
// another pipeline's stage transition — from changing what's checked out
// there while a sync is in flight.
//
// The old implementation ran `git add`/`git commit` against repoRoot's real
// working tree and index, refusing (leaving a dirty file behind) when the
// checked-out branch wasn't `main`. That's a real, observed failure mode: the
// refusal is safe, but the *write* that preceded it wasn't — the file lands
// in whatever branch happens to be checked out, dirtying it.
//
// `commitContentToMain` below instead commits via plumbing
// (`read-tree`/`hash-object`/`write-tree`/`commit-tree`) against a throwaway
// index file, and pushes as a compare-and-swap (`push origin <sha>:main`,
// which git rejects if `main` moved since we read it — the retry loop
// refetches and rebuilds on a race). None of this touches repoRoot's real
// working tree, index, or HEAD, so it is correct no matter what branch is
// checked out there, and safe under concurrent pipelines racing the same
// push. The working tree is only ever touched as a best-effort courtesy
// refresh, gated on repoRoot actually being on `main` with no local edit to
// that exact path — so it can no longer leave a stray dirty file on whatever
// branch a human happens to be using.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
    writeFileSync(worktreeCopy, readFileSync(contractPath));
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
 * Reads `relPath`'s content as committed on `main`, independent of whatever
 * is checked out in `repoRoot`'s working tree. Prefers `origin/main` (after a
 * best-effort fetch); falls back to the local `main` ref when there's no
 * reachable remote. Returns undefined when the path doesn't exist there yet
 * (a contract not yet committed for the first time).
 */
const readMainRef = (repoRoot: string): string => {
  try {
    runGit('fetch origin main', { cwd: repoRoot, timeoutMs: 30_000 });
  } catch {
    // Non-fatal — may not have a remote configured, or be offline. Fall
    // back to whatever local main already has.
  }
  try {
    runGit('rev-parse --verify refs/remotes/origin/main', { cwd: repoRoot, timeoutMs: 5000 });
    return 'refs/remotes/origin/main';
  } catch {
    return 'refs/heads/main';
  }
};

/**
 * Reads exact file bytes at `ref:relPath` — deliberately NOT via {@link runGit}
 * (which `.trim()`s every result), because a trimmed read would make the
 * no-op check below compare trimmed-vs-untrimmed content and treat a
 * trailing-whitespace-only difference as "changed", or worse, mask a real
 * change that happens to trim identically.
 */
const readContentAt = (options: {
  repoRoot: string;
  ref: string;
  relPath: string;
}): string | undefined => {
  try {
    return execFileSync('git', ['show', `${options.ref}:${options.relPath}`], {
      cwd: options.repoRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    });
  } catch {
    return undefined;
  }
};

/**
 * Resyncs repoRoot's index and working tree for `relPath` after
 * `refs/heads/main` has been moved by {@link commitContentToMain}.
 *
 * Not merely cosmetic: when repoRoot is checked out on `main`, `HEAD` IS
 * `refs/heads/main`, so moving that ref out from under the real index without
 * this repoints HEAD to a commit the index doesn't match — `git status` then
 * compares the stale index against the new HEAD and reports a phantom diff on
 * this exact path, regardless of what the working tree file already
 * contained. `git checkout main -- path` overwrites both the index entry and
 * the working tree file for that one path to match the new HEAD, which is
 * exactly what resolves it — deliberately unconditional on prior local edits
 * to this path (a `checkout -- path` is inherently that kind of operation).
 *
 * Gated on repoRoot actually being on `main`/`master`: when it's on some
 * other branch (the common case this module exists to make safe), the moved
 * ref isn't HEAD there and none of this is reachable or necessary — a no-op.
 */
const refreshWorkingCopyIfSafe = (options: { repoRoot: string; relPath: string }): void => {
  const { repoRoot, relPath } = options;
  try {
    const branch = currentBranch(repoRoot);
    if (branch !== 'main' && branch !== 'master') {
      return;
    }
    runGit(`checkout main -- '${relPath}'`, { cwd: repoRoot, timeoutMs: 10_000 });
  } catch {
    // Best-effort only — never let this fail the sync.
  }
};

const MAX_PUSH_RETRIES = 5;

/** git's stderr phrasing for "the remote ref moved since we read it" — the
 *  one failure worth refetching and retrying. Anything else (bad remote,
 *  network down, auth failure) fails identically on every retry, so retrying
 *  it is pure wasted latency. */
const isRaceRejection = (message: string): boolean =>
  /\[rejected\]|non-fast-forward|fetch first|stale info/i.test(message);

/**
 * Commits `content` at `relPath` onto `main`'s tip via plumbing
 * (`read-tree`/`hash-object`/`write-tree`/`commit-tree`) against a throwaway
 * index file, then pushes as a compare-and-swap
 * (`push origin <newSha>:refs/heads/main`, which git rejects outright if
 * `main` moved since we read it).
 *
 * Nothing here reads or writes repoRoot's real working tree or index, so the
 * result does not depend on — and cannot corrupt — whatever branch is
 * currently checked out there. On a push rejection (another pipeline won the
 * race), refetches and rebuilds on the new tip, up to {@link MAX_PUSH_RETRIES}
 * times — the same pattern as an optimistic-concurrency database write.
 */
const commitContentToMain = (options: {
  repoRoot: string;
  relPath: string;
  content: string;
  message: string;
}): ContractSyncResult => {
  const { repoRoot, relPath, content, message } = options;

  for (let attempt = 1; attempt <= MAX_PUSH_RETRIES; attempt++) {
    const ref = readMainRef(repoRoot);
    let baseCommit: string;
    try {
      baseCommit = runGit(`rev-parse ${ref}`, { cwd: repoRoot, timeoutMs: 10_000 }).trim();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        committed: false,
        message: `Could not resolve main (${ref}): ${msg.slice(0, 200)}`,
      };
    }

    const existing = readContentAt({ repoRoot, ref: baseCommit, relPath });
    if (existing === content) {
      return { ok: true, message: 'Contract unchanged — nothing to commit.', committed: false };
    }

    const tmpIndex = join(tmpdir(), `contract-sync-index-${process.pid}-${Date.now()}-${attempt}`);
    const tmpBlob = join(tmpdir(), `contract-sync-blob-${process.pid}-${Date.now()}-${attempt}`);
    const indexEnv = { GIT_INDEX_FILE: tmpIndex };
    try {
      let newCommit: string;
      try {
        runGit(`read-tree ${baseCommit}`, { cwd: repoRoot, env: indexEnv, timeoutMs: 15_000 });
        writeFileSync(tmpBlob, content);
        const blobSha = runGit(`hash-object -w ${tmpBlob}`, {
          cwd: repoRoot,
          timeoutMs: 10_000,
        }).trim();
        runGit(`update-index --add --cacheinfo 100644,${blobSha},${relPath}`, {
          cwd: repoRoot,
          env: indexEnv,
          timeoutMs: 10_000,
        });
        const treeSha = runGit('write-tree', {
          cwd: repoRoot,
          env: indexEnv,
          timeoutMs: 10_000,
        }).trim();
        newCommit = runGit(
          `commit-tree ${treeSha} -p ${baseCommit} -m ${JSON.stringify(message)}`,
          {
            cwd: repoRoot,
            env: { ...AGENT_ENV },
            timeoutMs: 10_000,
          },
        ).trim();
      } catch (buildError: unknown) {
        const msg = buildError instanceof Error ? buildError.message : String(buildError);
        return {
          ok: false,
          committed: false,
          message: `Contract commit failed: ${msg.slice(0, 300)}`,
        };
      }

      // Make the commit durable locally BEFORE attempting the push — a CAS
      // update against `baseCommit`, which only succeeds when local `main`
      // already happens to equal it. That holds whenever `repoRoot` was
      // already fully caught up with `origin/main` before this run started,
      // but NOT in general: `baseCommit` comes from `origin/main` (see
      // `readMainRef`), and another writer (a human, or another pipeline)
      // may have pushed straight to `origin/main` without this checkout ever
      // fetching/merging it — in which case this CAS fails, expected, and is
      // silently skipped. It exists only to let a push failure below report
      // a genuine partial success ("committed, not yet pushed"); the
      // common-case sync of the local ref + working tree is handled
      // unconditionally after a successful push, below, where we know for a
      // fact what `origin/main` now is instead of guessing.
      let localRefMovedPrePush = false;
      try {
        runGit(`update-ref refs/heads/main ${newCommit} ${baseCommit}`, {
          cwd: repoRoot,
          timeoutMs: 5000,
        });
        localRefMovedPrePush = true;
      } catch {
        // Local main isn't at baseCommit — see comment above.
      }

      // 🔴 Must happen immediately after moving the ref, regardless of push
      // outcome. Moving refs/heads/main without this repoints HEAD (when
      // repoRoot is on main) out from under the real index, so `git status`
      // starts comparing the old index against the new HEAD and reports a
      // phantom diff on this exact path, independent of whatever the working
      // tree file already contains. Only relevant when repoRoot is actually
      // on main; a no-op (see refreshWorkingCopyIfSafe) otherwise, which is
      // the common case this module exists to make safe.
      if (localRefMovedPrePush) {
        refreshWorkingCopyIfSafe({ repoRoot, relPath });
      }

      try {
        runGit(`push origin ${newCommit}:refs/heads/main`, { cwd: repoRoot, timeoutMs: 180_000 });
      } catch (pushError: unknown) {
        const msg = pushError instanceof Error ? pushError.message : String(pushError);
        if (isRaceRejection(msg) && attempt < MAX_PUSH_RETRIES) {
          // Another pipeline (or a human) pushed to main between our read
          // and our push. Refetch and rebuild on the new tip — the same
          // retry pattern as an optimistic-concurrency database write.
          continue;
        }
        // Not a race (or retries exhausted). Only a genuine partial success
        // ("committed locally, not pushed") when the pre-push local ref move
        // above actually landed — otherwise the commit exists solely as a
        // dangling object nothing local points at yet.
        return {
          ok: true,
          committed: localRefMovedPrePush,
          message: localRefMovedPrePush
            ? [
                `Contract committed to main locally, but the push failed: ${msg.slice(0, 300)}`,
                'Push when convenient:',
                '  git push origin main',
              ].join('\n')
            : `Contract push to main failed and was not committed locally: ${msg.slice(0, 300)}`,
        };
      }

      // Push succeeded — origin/main is now definitively `newCommit`. Force
      // the local ref to match (a plain fast-forward is always safe here;
      // we just confirmed origin has exactly this commit, and `readMainRef`
      // fetched it) regardless of whether the speculative pre-push CAS
      // above landed, then refresh the working copy.
      if (!localRefMovedPrePush) {
        try {
          runGit(`update-ref refs/heads/main ${newCommit}`, { cwd: repoRoot, timeoutMs: 5000 });
        } catch {
          // Best-effort only — never let this fail the sync.
        }
        refreshWorkingCopyIfSafe({ repoRoot, relPath });
      }

      return { ok: true, message: `Contract pushed to main: ${relPath}`, committed: true };
    } finally {
      for (const tmp of [tmpIndex, tmpBlob]) {
        try {
          rmSync(tmp, { force: true });
        } catch {
          // Best effort — /tmp cleanup.
        }
      }
    }
  }

  return {
    ok: false,
    committed: false,
    message: `Contract push to main failed after ${MAX_PUSH_RETRIES} attempts (repeated race).`,
  };
};

/**
 * Commits and pushes the root checkout's contract file to `main`.
 *
 * Reads the file's current bytes from disk (whatever is at `contractPath`
 * right now — this is always safe, it's just a read) and commits them onto
 * `main` via {@link commitContentToMain}. The result no longer depends on
 * what branch `repoRoot` has checked out: a human (or another pipeline)
 * working on an unrelated branch there can no longer cause this to leave a
 * dirty file behind, because nothing here touches repoRoot's real working
 * tree or index for the commit itself.
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
  const content = readFileSync(contractPath, 'utf-8');

  return commitContentToMain({ repoRoot, relPath, content, message });
};

/**
 * Commits explicit `content` (computed by the caller, e.g. a status-row
 * substitution) straight to `main` — without ever writing it to `contractPath`
 * on disk first. Use this instead of "write to contractPath, then
 * `commitContractToMain`" whenever the write is a pure transform: the
 * intermediate disk write is itself a hazard (it lands in whatever branch
 * repoRoot happens to have checked out, e.g. `updateContractStatus`'s old
 * call site in the critique-approval step), and it's entirely avoidable when
 * the caller already has the new content in hand.
 *
 * @param options.repoRoot - The root checkout.
 * @param options.contractPath - Absolute path to the contract (used only to
 *   compute the relative path — never read or written here).
 * @param options.content - The full new file content to commit.
 * @param options.message - Commit subject.
 */
export const commitContractContent = (options: {
  repoRoot: string;
  contractPath: string;
  content: string;
  message: string;
}): ContractSyncResult => {
  const { repoRoot, contractPath, content, message } = options;
  const relPath = relative(repoRoot, contractPath);
  return commitContentToMain({ repoRoot, relPath, content, message });
};

/**
 * Carries an agent's contract edit (Execution Report, AC evidence matrix) from
 * the worktree onto `main`.
 *
 * This is the counterpart to {@link isolateContractInWorktree}: because the
 * contract is `skip-worktree` in the worktree, the agent's edit exists only on
 * disk there and would otherwise be discarded with the worktree.
 *
 * No-ops when the worktree copy is byte-identical to what's already committed
 * on `main` — so a stage that did not touch the contract produces no empty
 * commit. Deliberately does NOT write into repoRoot's working tree first (the
 * old implementation did, via `copyFileSync`, which is exactly what left a
 * dirty file behind when repoRoot wasn't on `main`) — the worktree's content
 * goes straight to `main` via {@link commitContentToMain}, and repoRoot's
 * working copy only gets a best-effort cosmetic refresh when it's safe to.
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

  let worktreeContent: string;
  try {
    worktreeContent = readFileSync(worktreeCopy, 'utf-8');
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      committed: false,
      message: `Could not read the worktree contract copy: ${msg.slice(0, 200)}`,
    };
  }

  return commitContentToMain({
    repoRoot,
    relPath,
    content: worktreeContent,
    message: `docs(contracts): ${contractId} ${stage} notes`,
  });
};
