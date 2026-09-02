// scripts/src/lib/agents/contract_pipeline/implement_guard.ts
//
// Ground-truth guard against an implementer that reports `passed` without
// producing any work.
//
// 🔴 C-457 (2026-09-02) is the incident this exists for. The implementer ran
// for 4m56s, called `contract_stage_complete` with `passed` while still
// inside its Phase 0 preflight, and wrote a summary that reads like a status
// update from the START of work ("Starting C-457 … implementation") with
// `filesTouched: []`. Nothing in the pipeline disagreed. `commitAll` on a
// clean tree is a successful no-op, `enforceStageStatus` only inspects the
// contract's lifecycle status, so the run transitioned to `verify`, the
// verifier spent 2m26s rediscovering that no implementation existed, blocked,
// and burned the run's single escalation on a review captain — three agent
// sessions spent on zero lines of code.
//
// 🔴 Why this does NOT read `result.diffHash` / `result.filesTouched`.
//
// Both fields are written by the worker itself; `validateStageResult` only
// checks that they are a string and a string[]. They are exactly as
// trustworthy as the `passed` verdict we are trying to catch — an agent that
// misreports its status can equally misreport its diff. C-457 happened to
// self-report the empty-string SHA-256 honestly, but a guard built on that
// coincidence catches one specific broken agent rather than the failure
// class.
//
// The orchestrator already captures the authoritative answer: a
// `captureGitState` snapshot on either side of every stage. This module
// consumes that observation instead, so the verdict rests on what the
// worktree actually contains rather than on what the worker claimed.
import type { ContractStageResult, GitStateSnapshot } from './types.ts';

/**
 * Did the implementer leave any trace in the worktree?
 *
 * Two independent signals, because either one alone produces false verdicts:
 *
 * - **Working tree changed.** `changedPaths` is `git diff --name-only HEAD`
 *   plus untracked files, so this covers the normal case where the agent
 *   edits files and leaves the commit to `commitAll`.
 * - **HEAD advanced.** Implementers frequently commit their own work
 *   mid-session. That leaves the tree clean and the fingerprint identical to
 *   the pre-stage snapshot — a tree-only check would flag a fully correct
 *   implementation as empty and bounce it to review.
 */
export const implementationProducedWork = (options: {
  before: GitStateSnapshot;
  after: GitStateSnapshot;
  headBefore: string;
  headAfter: string;
}): boolean => {
  if (options.before.fingerprint !== options.after.fingerprint) {
    return true;
  }
  // `currentCommit` returns 'unknown' when `git rev-parse` fails. A broken
  // git invocation is not evidence that the agent did nothing, so fail OPEN
  // and let the verifier judge — blocking real work on an unrelated git
  // failure is the worse error, and this guard is a safety net rather than
  // the only check in the chain.
  if (options.headBefore === 'unknown' || options.headAfter === 'unknown') {
    return true;
  }
  return options.headBefore !== options.headAfter;
};

/**
 * Convert an empty-diff implementer `passed` into a `blocked` verdict.
 *
 * Returns the result untouched in every other case. `blocked` routes through
 * {@link resolveNextStage} to the review captain with the run still live, so
 * this recovers the run rather than ending it — the same route every other
 * "we cannot continue" condition in this pipeline already takes.
 */
export const guardEmptyImplementation = (options: {
  result: ContractStageResult;
  before: GitStateSnapshot;
  after: GitStateSnapshot;
  headBefore: string;
  headAfter: string;
}): ContractStageResult => {
  if (options.result.status !== 'passed') {
    return options.result;
  }
  if (
    implementationProducedWork({
      before: options.before,
      after: options.after,
      headBefore: options.headBefore,
      headAfter: options.headAfter,
    })
  ) {
    return options.result;
  }
  return {
    ...options.result,
    status: 'blocked',
    summary:
      'Implementer reported `passed` but the worktree is byte-for-byte unchanged: ' +
      'no working-tree edits and no new commits. The stage produced no implementation. ' +
      `Worker's own summary was: "${options.result.summary.slice(0, 200)}"`,
    findings: [
      ...options.result.findings,
      'Zero-diff `passed` detected by the orchestrator from its own before/after git snapshots ' +
        '(not from the worker-reported diffHash, which is self-attested).',
      'Most likely the worker called `contract_stage_complete` during Phase 0, before writing code. ' +
        'If instead the previous attempt already satisfied the contract and there was genuinely ' +
        'nothing left to change, say so explicitly and approve — the run is recoverable either way.',
    ],
  };
};

/**
 * How long a zero-diff implementer `passed` stays PROVISIONAL while the
 * worker is still alive.
 *
 * 🔴 C-457 was not an agent that idled — it was an agent that reported too
 * early and kept going. `contract_stage_complete` does not cancel the agent
 * loop (the same property `GUARD_SETTLE_MS` exists for in stage_runner.ts),
 * so the session was still mid-flight when the orchestrator consumed its
 * verdict, and the real implementation landed in that very worktree
 * afterwards: 269 insertions across gm_prompt_service.svelte.ts and
 * gm_types.ts, plus a new test file.
 *
 * So a zero diff at the instant the verdict arrives does NOT mean the stage
 * produced nothing — it can mean the stage has not finished writing. Turning
 * that instant into a hard `blocked` would discard live work and burn the
 * run's one escalation, which is precisely the C-442 mistake relocated to a
 * new stage. We wait instead, and only while there is something to wait for:
 * a worker that is no longer active fails immediately (see
 * {@link settleEmptyImplementation}).
 */
export const IMPLEMENT_SETTLE_MS: number =
  Number(process.env.CONTRACT_IMPLEMENT_SETTLE_MS) || 10 * 60_000;

/** Re-check interval while waiting out {@link IMPLEMENT_SETTLE_MS}. */
const IMPLEMENT_SETTLE_POLL_MS = 10_000;

const sleep = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Resolve a zero-diff implementer `passed` without throwing away live work.
 *
 * Returns the result untouched the moment real work appears in the worktree,
 * and `blocked` only once the worker is gone (or the window expires) with the
 * worktree still byte-for-byte unchanged.
 *
 * Cost asymmetry drives the shape: waiting is bounded and only happens on a
 * run already headed for the scrap heap, whereas a wrong `blocked` costs a
 * verifier session, the review captain, and the run's single escalation —
 * about 25 minutes of wall clock in the C-457 run.
 */
export const settleEmptyImplementation = async (options: {
  result: ContractStageResult;
  before: GitStateSnapshot;
  headBefore: string;
  /** Re-read the worktree's current state. Polled until work appears. */
  captureAfter: () => { after: GitStateSnapshot; headAfter: string };
  /** Whether the worker session is still running. Absent = assume finished. */
  isWorkerActive?: () => Promise<boolean>;
  settleMs?: number;
  pollMs?: number;
  onWait?: (message: string) => void;
}): Promise<ContractStageResult> => {
  if (options.result.status !== 'passed') {
    return options.result;
  }
  const initial = options.captureAfter();
  const produced = (state: { after: GitStateSnapshot; headAfter: string }): boolean =>
    implementationProducedWork({
      before: options.before,
      after: state.after,
      headBefore: options.headBefore,
      headAfter: state.headAfter,
    });
  if (produced(initial)) {
    return options.result;
  }

  const settleMs = options.settleMs ?? IMPLEMENT_SETTLE_MS;
  // A still-running worker is the only reason to wait at all.
  if (settleMs > 0 && (await options.isWorkerActive?.()) === true) {
    options.onWait?.(
      `⏸️  implementer reported \`passed\` with an unchanged worktree, but its session is still ` +
        `running — treating the verdict as provisional and waiting up to ` +
        `${settleMs < 1000 ? `${settleMs}ms` : `${Math.round(settleMs / 1000)}s`} for the work to land…`,
    );
    // Scaled so a short test window is not swallowed by one long sleep.
    const pollMs =
      options.pollMs ?? Math.max(25, Math.min(IMPLEMENT_SETTLE_POLL_MS, Math.floor(settleMs / 10)));
    const deadline = Date.now() + settleMs;
    while (Date.now() < deadline) {
      await sleep(pollMs);
      if (produced(options.captureAfter())) {
        options.onWait?.(
          '✅ implementer produced changes after reporting — adopting the work and continuing to verify.',
        );
        return options.result;
      }
      // Worker finished without writing anything: nothing left to wait for.
      if ((await options.isWorkerActive?.()) !== true) {
        break;
      }
    }
  }
  return guardEmptyImplementation({
    result: options.result,
    before: options.before,
    after: initial.after,
    headBefore: options.headBefore,
    headAfter: initial.headAfter,
  });
};
