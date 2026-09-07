// scripts/src/lib/agents/contract_pipeline/publication_gate.ts
//
// The last gate before a contract run becomes a public pull request.
//
// 🔴 Why this exists — the C-484 incident (PR #266, 2026-09-07).
//
// pre_push_gate.ts already runs `:fix` + `:validate` once, in the
// orchestrator, immediately before the branch is pushed. On that run it did
// its job: it caught an MVVM violation and briefed the review captain to fix
// it before opening the PR. The captain did fix it — and then:
//
//   1. hand-edited `capability_detail_view.svelte` to add the wrapper,
//   2. re-ran ONE task (`scripts:guard-mvvm-conventions`) — the one it knew
//      about — plus an incidental `guard-type-safety`,
//   3. committed with `--no-verify` (every pipeline commit path does),
//   4. pushed,
//   5. opened the PR.
//
// The hand edit was not re-indented, so `client:format` went red on CI. The
// pipeline had every tool needed to catch that (`moon run :fix` would have
// rewritten the file in place) and used none of them, because NOTHING after
// the orchestrator's one-shot gate re-checks anything. The gate's verdict was
// bound to a revision that no longer existed by the time the PR was opened.
//
// So the invariant moves out of the prompt and into a hard precondition:
//
//   A PR may not be created from a pipeline workspace unless a GREEN
//   validation verdict exists for the EXACT commit that is on the remote.
//
// Every way to violate that is a distinct, named block below, each with the
// remedy that clears it. Prompt guidance can be forgotten or half-followed;
// this cannot.
//
// 🔴 Node-only. No `Bun.*` and no `cli_utils.ts` — this module is reachable
// from `.pi/extensions/*`, which pi loads under Node.
// See scripts/src/lib/env/runtime_boundary.test.ts.
import { runGit } from '../git_worktree.ts';
import type { RunManifest } from './types.ts';

/**
 * Absolute path of the ROOT repo checkout that owns `.pi/contract-runs/`.
 *
 * 🔴 Not `process.cwd()`. An agent running inside a linked worktree has a cwd
 * that contains no `.pi/contract-runs/` at all, so a manifest read from there
 * silently returns undefined — which the gate would report as
 * `never_validated` forever. Both result and review paths are absolute and
 * embed the runs directory, so the root is recoverable from either.
 *
 * Windows paths are backslash-separated; the search runs on a
 * posix-normalized copy of the SAME LENGTH, so the index still slices the
 * original correctly.
 */
export const deriveRunRepoRoot = (): string => {
  const candidates = [
    process.env.CONTRACT_PIPELINE_RESULT_PATH,
    process.env.CONTRACT_PIPELINE_REVIEW_PATH,
  ];
  for (const path of candidates) {
    if (!path) {
      continue;
    }
    const index = path.replace(/\\/g, '/').indexOf('/.pi/contract-runs/');
    if (index !== -1) {
      return path.slice(0, index);
    }
  }
  return process.cwd();
};

/** A single reason the branch may not become a PR yet. */
export type PublicationBlock = {
  /** Stable identifier, so tests and callers never match on prose. */
  code:
    | 'dirty_worktree'
    | 'never_validated'
    | 'stale_validation'
    | 'failed_validation'
    | 'unpushed_commits';
  /** What is wrong, in one line. */
  message: string;
  /** The exact action that clears this block. */
  remedy: string;
};

export type PublicationGateResult = {
  /** True when the branch is safe to open a PR from. */
  ok: boolean;
  /** Every unmet precondition. Empty when `ok`. */
  blocks: readonly PublicationBlock[];
  /** Local HEAD of the workspace, or undefined when git could not be read. */
  head?: string;
  /** Current branch name, or undefined when git could not be read. */
  branch?: string;
  /**
   * True when the gate could not read the workspace at all (not a git
   * checkout, git missing). The caller must NOT block on this — an
   * unreadable workspace is an infra problem, not evidence of bad code.
   */
  indeterminate?: boolean;
};

/**
 * Minimal git surface the gate needs, injectable so tests never shell out.
 * Implementations throw on a failed command; the gate catches.
 */
export type GitReader = {
  /** `git status --porcelain` output for the workspace. */
  status: () => string;
  /** Local HEAD sha. */
  head: () => string;
  /** Current branch name (`git rev-parse --abbrev-ref HEAD`). */
  branch: () => string;
  /**
   * Sha the named branch points at ON THE REMOTE, or undefined when the
   * remote has no such branch. Must consult the remote (`ls-remote`), not a
   * possibly-stale local `origin/*` ref.
   */
  remoteHead: (branch: string) => string | undefined;
};

/**
 * A `GitReader` backed by the real `git` binary in a workspace checkout.
 *
 * 🔴 `remoteHead` uses `ls-remote`, not `rev-parse origin/<branch>`. The local
 * `origin/*` ref is only as fresh as the last fetch, and the whole point of
 * the `unpushed_commits` block is to catch a commit that never left the
 * worktree — a stale local ref would happily agree that it had.
 */
export const createWorkspaceGitReader = (workspacePath: string): GitReader => ({
  status: () => runGit('status --porcelain', { cwd: workspacePath }),
  head: () => runGit('rev-parse HEAD', { cwd: workspacePath }),
  branch: () => runGit('rev-parse --abbrev-ref HEAD', { cwd: workspacePath }),
  remoteHead: (branch) => {
    const quotedRef = `'refs/heads/${branch.replace(/'/g, "'\\''")}'`;
    const output = runGit(`ls-remote --heads origin ${quotedRef}`, {
      cwd: workspacePath,
      timeoutMs: 60_000,
    });
    const sha = output.split(/\s+/)[0]?.trim();
    return sha && sha.length > 0 ? sha : undefined;
  },
});

const VALIDATE_REMEDY =
  'Run `contract_stage` action `validate` with this workspacePath. It applies ' +
  '`moon run :fix`, re-runs `:validate`, commits any fixes, and records a fresh verdict.';

/**
 * Decide whether a pipeline workspace may become a pull request.
 *
 * The five blocks, and the failure each one prevents:
 *
 * | Block               | Prevents |
 * |---------------------|----------|
 * | `dirty_worktree`    | Edits that exist locally but never reach the PR. |
 * | `never_validated`   | A PR from a branch nothing ever checked. |
 * | `stale_validation`  | 🔴 The C-484 case: a green verdict for an older commit. |
 * | `failed_validation` | A PR opened on top of a known-red gate. |
 * | `unpushed_commits`  | The fix commit sitting only in the worktree. |
 *
 * 🔴 Returns `indeterminate` (and `ok: true`) when the workspace cannot be
 * read. A gate that cannot run must never become a wall — see the same
 * reasoning in pre_push_gate.ts's `ran` flag.
 */
export const evaluatePublicationGate = (options: {
  git: GitReader;
  manifest: RunManifest | undefined;
  /** Branch that the publication command will use; defaults to the checked-out branch. */
  branch?: string;
}): PublicationGateResult => {
  let head: string;
  let branch: string;
  let status: string;
  let remote: string | undefined;
  try {
    head = options.git.head().trim();
    branch = options.branch?.trim() || options.git.branch().trim();
    status = options.git.status();
    remote = options.git.remoteHead(branch);
  } catch {
    return { ok: true, blocks: [], indeterminate: true };
  }

  const blocks: PublicationBlock[] = [];

  if (status.trim().length > 0) {
    const changed = status
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    blocks.push({
      code: 'dirty_worktree',
      message:
        `${changed.length} uncommitted change(s) in the workspace — they would NOT ` +
        `reach the PR: ${changed.slice(0, 10).join(', ')}${changed.length > 10 ? ', …' : ''}`,
      remedy: 'Commit them (or discard them) before opening the PR.',
    });
  }

  const validation = options.manifest?.prePushValidation;
  if (!validation) {
    blocks.push({
      code: 'never_validated',
      message: 'No validation verdict is recorded for this run.',
      remedy: VALIDATE_REMEDY,
    });
  } else if (validation.revision !== head) {
    blocks.push({
      code: 'stale_validation',
      message:
        `The recorded verdict covers ${validation.revision.slice(0, 12)}, but HEAD is now ` +
        `${head.slice(0, 12)} — the commits made since then were never checked.`,
      remedy: VALIDATE_REMEDY,
    });
  } else if (!validation.ok) {
    blocks.push({
      code: 'failed_validation',
      message: `Validation is RED on ${head.slice(0, 12)}. CI will repeat these failures verbatim.`,
      remedy: `Fix the reported failures, commit, then ${VALIDATE_REMEDY}`,
    });
  }

  // Only meaningful once the tree is clean and validated — but reported
  // unconditionally, so the captain sees the whole list in one pass rather
  // than clearing blocks one round-trip at a time.
  if (remote === undefined) {
    blocks.push({
      code: 'unpushed_commits',
      message: `Branch \`${branch}\` does not exist on origin.`,
      remedy: `Push it: \`git push -u origin ${branch}\`.`,
    });
  } else if (remote !== head) {
    blocks.push({
      code: 'unpushed_commits',
      message:
        `Local HEAD (${head.slice(0, 12)}) differs from origin/${branch} ` +
        `(${remote.slice(0, 12)}) — the PR would not include the local commits.`,
      remedy: `Push them: \`git push origin ${branch}\`.`,
    });
  }

  return { ok: blocks.length === 0, blocks, head, branch };
};

/** Render a blocked gate as the refusal an agent sees in place of a PR. */
export const formatPublicationBlocks = (result: PublicationGateResult): string =>
  [
    '❌ **PR creation blocked — the branch is not in a publishable state.**',
    '',
    'A contract PR may only be opened from a commit that has a GREEN validation',
    'verdict AND is already on the remote. One or both is untrue right now:',
    '',
    ...result.blocks.flatMap((block, index) => [
      `**${index + 1}. ${block.code}** — ${block.message}`,
      `   → ${block.remedy}`,
      '',
    ]),
    'Clear every item above, then call `gh_pr create` again.',
  ].join('\n');
