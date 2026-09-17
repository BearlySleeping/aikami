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
// 🔴 `node:`-only. No `Bun.*` and no `cli_utils.ts` — this module is
// exercised from the contract pipeline, which pi reaches through the Bun
// bridge (scripts/src/lib/pi/); keeping it dependency-light keeps the bridge
// invocation cheap.
import { runGit } from '../git_worktree.ts';
import {
  authorizationCovers,
  type GateOutcome,
  type PublicationAuthorization,
} from './gate_outcome.ts';
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
    | 'unreadable_workspace'
    | 'never_validated'
    | 'stale_validation'
    | 'failed_validation'
    | 'unpushed_commits';
  /** What is wrong, in one line. */
  message: string;
  /** The exact action that clears this block. */
  remedy: string;
};

/**
 * Public verdict of the publication gate.
 *
 * 🔴 `ok` is true ONLY when the gate has positive evidence that the exact
 * commit on the remote is green. There is no longer an `indeterminate` escape
 * hatch: when git or the remote cannot be read, the gate returns
 * `outcome: 'unavailable'`, `ok: false`, and an `unreadable_workspace` block,
 * so PR creation is refused until the evidence is recoverable. Recovery and
 * review remain available — only *publication* is gated.
 */
export type PublicationGateResult = {
  /** The single verdict. */
  outcome: GateOutcome;
  /** True when no hard blocks remain, including an authorized non-green result. */
  ok: boolean;
  /** Every unmet hard precondition. Empty when publication is allowed. */
  blocks: readonly PublicationBlock[];
  /**
   * Advisory findings that do NOT block PR creation on their own. A red
   * validation verdict lands here ONLY when a revision-bound authorization
   * covers it; otherwise it is a hard block (`failed_validation`).
   */
  warnings: readonly PublicationBlock[];
  /** Local HEAD of the workspace, or undefined when git could not be read. */
  head?: string;
  /** Current branch name, or undefined when git could not be read. */
  branch?: string;
  /**
   * The outcome of the recorded validation verdict that authorized (or failed
   * to authorize) publication. Undefined when no verdict is recorded.
   */
  validationOutcome?: GateOutcome;
  /**
   * True when a non-green verification outcome was permitted by an explicit,
   * revision-bound authorization record (see gate_outcome.ts). Publication is
   * `ok` in that case, but the warning is still surfaced.
   */
  authorized?: boolean;
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
 * The hard blocks, and the failure each one prevents:
 *
 * | Block                 | Prevents |
 * |-----------------------|----------|
 * | `unreadable_workspace`| 🔴 Publishing without evidence (the fail-open case). |
 * | `dirty_worktree`      | Edits that exist locally but never reach the PR. |
 * | `never_validated`     | A PR from a branch nothing ever checked. |
 * | `stale_validation`    | 🔴 The C-484 case: a green verdict for an older commit. |
 * | `failed_validation`   | A PR opened on a known-red gate without authorization. |
 * | `unpushed_commits`    | The fix commit sitting only in the worktree. |
 *
 * 🔴 Fails CLOSED. When the workspace or remote cannot be read the gate
 * returns `outcome: 'unavailable'` and an `unreadable_workspace` block, so
 * publication is refused until the evidence is recoverable. This reverses the
 * previous behaviour, which returned `ok: true` and treated an unreadable
 * workspace as "allow" — the defect this gate exists to close.
 *
 * 🔴 A red verdict is a BLOCK unless an explicit, revision-bound
 * `authorization` covers it. The outcome and the revision must both match.
 */
export const evaluatePublicationGate = (options: {
  git: GitReader;
  manifest: RunManifest | undefined;
  /** Branch that the publication command will use; defaults to the checked-out branch. */
  branch?: string;
  /**
   * Explicit authorization to publish over a non-green outcome. Only honored
   * when its `outcome` and `revision` match the recorded verdict and HEAD.
   */
  authorization?: PublicationAuthorization;
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
  } catch (error) {
    // 🔴 Fail closed. An unreadable workspace is not evidence that the branch
    // is publishable — it is the absence of evidence, and the pipeline must
    // not turn that into a PR. Recovery/review remain available; only
    // publication is refused.
    const reason = error instanceof Error ? error.message : String(error);
    return {
      outcome: 'unavailable',
      ok: false,
      blocks: [
        {
          code: 'unreadable_workspace',
          message:
            `The publication gate could not read this workspace or its remote (${reason}). ` +
            'It cannot verify that the exact commit on the remote is green.',
          remedy:
            'Restore git access (check the repo is a valid checkout, the remote is ' +
            'reachable, and the branch exists), then call `gh_pr create` again.',
        },
      ],
      warnings: [],
    };
  }

  const blocks: PublicationBlock[] = [];
  const warnings: PublicationBlock[] = [];
  let validationOutcome: GateOutcome | undefined;
  let authorized = false;

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
  } else {
    // A verdict bound to this exact HEAD. Older manifests lacked `outcome`, so
    // retain their boolean interpretation without collapsing newer
    // unavailable/cancelled records into a code failure.
    validationOutcome = validation.outcome ?? (validation.ok ? 'passed' : 'failed');
    if (validationOutcome !== 'passed') {
      authorized = authorizationCovers({
        authorization: options.authorization,
        outcome: validationOutcome,
        revision: head,
      });
      if (authorized) {
        warnings.push({
          code: 'failed_validation',
          message:
            `Validation is ${validationOutcome.toUpperCase()} on ${head.slice(0, 12)}, published under an explicit ` +
            `authorization from ${options.authorization?.grantedBy ?? 'unknown'} ` +
            `at ${options.authorization?.grantedAt ?? 'unknown time'}.`,
          remedy:
            'CI will repeat these failures. Let CodeRabbit fix them on the PR, or fix ' +
            `and re-validate: ${VALIDATE_REMEDY}`,
        });
      } else {
        blocks.push({
          code: 'failed_validation',
          message:
            `Validation is ${validationOutcome.toUpperCase()} on ${head.slice(0, 12)} and no authorization covers this ` +
            'outcome and revision. A red verdict does not authorize PR creation on its own.',
          remedy:
            'Fix the failures and run: ' +
            VALIDATE_REMEDY +
            ' To publish the red commit deliberately, record a revision-bound ' +
            'authorization for this exact outcome and revision (YOLO records one ' +
            'automatically; interactive runs require explicit user permission).',
        });
      }
    }
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

  const ok = blocks.length === 0;
  const outcome: GateOutcome = (() => {
    if (validationOutcome === 'failed') {
      return 'failed';
    }
    if (validationOutcome !== 'passed' || blocks.length > 0) {
      return 'unavailable';
    }
    return 'passed';
  })();
  return {
    outcome,
    ok,
    blocks,
    warnings,
    head,
    branch,
    validationOutcome,
    authorized: authorized || undefined,
  };
};

const renderPublicationItems = (items: readonly PublicationBlock[]): string[] =>
  items.flatMap((item, index) => [
    `**${index + 1}. ${item.code}** — ${item.message}`,
    `   → ${item.remedy}`,
    '',
  ]);

/** Render a blocked gate as the refusal an agent sees in place of a PR. */
export const formatPublicationBlocks = (result: PublicationGateResult): string => {
  const parts = [
    '❌ **PR creation blocked — the branch is not in a publishable state.**',
    '',
    'One or more hard preconditions below are unmet. Clear each one, then call',
    '`gh_pr create` again.',
    '',
    ...renderPublicationItems(result.blocks),
  ];
  if (result.warnings.length > 0) {
    parts.push(
      '',
      '⚠️ **Non-blocking** — these do not stop PR creation on their own, but must',
      'be surfaced to the user:',
      '',
      ...renderPublicationItems(result.warnings),
    );
  }
  return parts.join('\n');
};

/** Render warnings for an otherwise-publishable branch (shown on PR-created success). */
export const formatPublicationWarning = (result: PublicationGateResult): string | undefined => {
  if (result.warnings.length === 0) {
    return undefined;
  }
  return [
    '⚠️ **PR created on top of a non-green validation verdict.**',
    '',
    ...renderPublicationItems(result.warnings),
    'CI will repeat these failures on the PR — let CodeRabbit fix them, or fix and',
    're-run `contract_stage` action `validate`.',
  ].join('\n');
};
