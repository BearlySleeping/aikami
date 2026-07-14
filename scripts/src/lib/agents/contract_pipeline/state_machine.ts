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

const MAX_VERIFY_LOOPS = 2;

/** Resolve the next stage from a validated worker result. */
export const resolveNextStage = (options: {
  currentStage: ContractPipelineStage;
  verdict: ContractStageResult;
  verifyLoops: number;
}): { next: ContractPipelineStage; verifyLoops: number } => {
  if (options.verdict.status === 'blocked' || options.verdict.status === 'failed') {
    return { next: 'blocked', verifyLoops: options.verifyLoops };
  }

  // Writer → always proceed to critic. No bounce.
  if (options.currentStage === 'write_contract') {
    return { next: 'critique', verifyLoops: options.verifyLoops };
  }

  // Critic fixes inline and approves. Only blocks for structural issues.
  if (options.currentStage === 'critique') {
    return { next: 'implement', verifyLoops: options.verifyLoops };
  }

  // Implementer → verify.
  if (options.currentStage === 'implement') {
    return { next: 'verify', verifyLoops: options.verifyLoops };
  }

  // Verify → review or bounce back to implement (max 2).
  if (options.currentStage === 'verify') {
    if (options.verdict.status !== 'changes_requested') {
      return { next: 'review', verifyLoops: options.verifyLoops };
    }
    const verifyLoops = options.verifyLoops + 1;
    return {
      next: verifyLoops >= MAX_VERIFY_LOOPS ? 'blocked' : 'implement',
      verifyLoops,
    };
  }

  return { next: 'blocked', verifyLoops: options.verifyLoops };
};

/** Map review decision to next stage. */
export const resolveReviewDecision = (decision: ReviewDecision): ContractPipelineStage => {
  switch (decision) {
    case 'approve':
      return 'accepted';
    case 'approve_pr':
    case 'approve_merge':
      return 'accepted'; // orchestrator handles reconciliation after accepted
    case 'changes_applied':
      return 'verify'; // re-verify (not critique — contract changes are rare, verifier catches)
    case 'reject':
    case 'blocked':
      return 'blocked';
  }
};

/** Return a manifest with its current stage changed. */
export const transition = (options: {
  manifest: RunManifest;
  next: ContractPipelineStage;
}): RunManifest => ({
  ...options.manifest,
  currentStage: options.next,
  lastUpdated: new Date().toISOString(),
});
