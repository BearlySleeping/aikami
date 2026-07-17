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

export const resolveNextStage = (options: {
  currentStage: ContractPipelineStage;
  verdict: ContractStageResult;
  verifyLoops: number;
}): { next: ContractPipelineStage; verifyLoops: number } => {
  if (options.verdict.status === 'blocked' || options.verdict.status === 'failed') {
    return { next: 'blocked', verifyLoops: options.verifyLoops };
  }
  if (options.currentStage === 'write_contract') {
    return { next: 'critique', verifyLoops: options.verifyLoops };
  }
  if (options.currentStage === 'critique') {
    return { next: 'implement', verifyLoops: options.verifyLoops };
  }
  if (options.currentStage === 'implement') {
    return { next: 'verify', verifyLoops: options.verifyLoops };
  }
  // Verify: pass → review (human creates PR). Bounce on changes_requested (max 2).
  if (options.currentStage === 'verify') {
    if (options.verdict.status !== 'changes_requested') {
      return { next: 'review', verifyLoops: options.verifyLoops };
    }
    const verifyLoops = options.verifyLoops + 1;
    return {
      next: verifyLoops >= MAX_VERIFY_LOOPS ? 'review' : 'implement',
      verifyLoops,
    };
  }
  return { next: 'blocked', verifyLoops: options.verifyLoops };
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
