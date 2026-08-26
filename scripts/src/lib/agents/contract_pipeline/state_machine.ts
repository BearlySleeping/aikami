// scripts/src/lib/agents/contract_pipeline/state_machine.ts
//
// Contract pipeline state machine.
// Writer → Critic (fixes+approves, no bounce) → Implement → Verify (max 2 bounces) → Review → ...
import type {
  ContractPipelineStage,
  ContractStageResult,
  ReviewDecision,
  RunManifest,
} from './types.ts';

export const MAX_VERIFY_LOOPS = 2;

/**
 * How many worker-reported `blocked`/`failed` verdicts are escalated to the
 * review captain before the run really does end.
 *
 * 🔴 One. The captain gets exactly one shot at a blocked stage: it can
 * diagnose, fix trivia, push a branch, open a draft PR, or send the work back
 * to the implementer. If the stage blocks a second time, the escalation
 * itself is not working and ending the run is the honest outcome.
 */
export const MAX_BLOCKED_ESCALATIONS = 1;

/**
 * Decide where a stage verdict sends the run.
 *
 * 🔴 A worker `blocked`/`failed` is NOT terminal on its own.
 *
 * It used to be: any blocked verdict jumped straight to the terminal
 * `blocked` stage, which prints a banner to a pane nobody is watching and
 * ends the process. That path threw away every recoverable case — C-442
 * (2026-08-26) died there on a cost-guard false positive even though the
 * verifier had in fact passed all 7 ACs, and the run had a pushed branch and
 * a full implementation sitting in the worktree.
 *
 * Every other "we cannot continue" route in this pipeline (verify-loop
 * exhaustion, reconciliation failure, branch-push failure) already escalates
 * to `review` so the captain can diagnose and recover with the run's context
 * still live. A blocked worker is the same kind of event and takes the same
 * route, bounded by {@link MAX_BLOCKED_ESCALATIONS}.
 */
export const resolveNextStage = (options: {
  currentStage: ContractPipelineStage;
  verdict: ContractStageResult;
  verifyLoops: number;
  /** Escalations already spent on this run. Absent is treated as zero. */
  blockedEscalations?: number;
}): {
  next: ContractPipelineStage;
  verifyLoops: number;
  blockedEscalations: number;
  /** True when this transition spent an escalation — the caller must record
   *  `blockedReason` so the review captain is briefed as a blocked review. */
  escalated: boolean;
} => {
  const spent = options.blockedEscalations ?? 0;
  const unchanged = {
    verifyLoops: options.verifyLoops,
    blockedEscalations: spent,
    escalated: false,
  };
  if (options.verdict.status === 'blocked' || options.verdict.status === 'failed') {
    if (spent >= MAX_BLOCKED_ESCALATIONS) {
      return { next: 'blocked', ...unchanged };
    }
    return {
      next: 'review',
      verifyLoops: options.verifyLoops,
      blockedEscalations: spent + 1,
      escalated: true,
    };
  }
  if (options.currentStage === 'write_contract') {
    return { next: 'critique', ...unchanged };
  }
  if (options.currentStage === 'critique') {
    return { next: 'implement', ...unchanged };
  }
  if (options.currentStage === 'implement') {
    return { next: 'verify', ...unchanged };
  }
  // Verify: pass → review (human creates PR). Bounce on changes_requested (max 2).
  if (options.currentStage === 'verify') {
    if (options.verdict.status !== 'changes_requested') {
      return { next: 'review', ...unchanged };
    }
    const verifyLoops = options.verifyLoops + 1;
    return {
      next: verifyLoops >= MAX_VERIFY_LOOPS ? 'review' : 'implement',
      verifyLoops,
      blockedEscalations: spent,
      escalated: false,
    };
  }
  return { next: 'blocked', ...unchanged };
};

export const resolveReviewDecision = (decision: ReviewDecision): ContractPipelineStage => {
  switch (decision) {
    case 'approve':
      return 'pr_created';
    case 'merge':
      return 'merged';
    case 'change':
      return 'implement';
    case 'reject':
      return 'blocked';
  }
};

export const transition = (options: {
  manifest: RunManifest;
  next: ContractPipelineStage;
}): RunManifest => ({
  ...options.manifest,
  currentStage: options.next,
  lastUpdated: new Date().toISOString(),
});
