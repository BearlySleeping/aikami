// scripts/src/lib/agents/contract_pipeline/state_machine.ts
import type { ContractPipelineStage, ContractStageResult, RunManifest } from './types.ts';

const MAX_CRITIC_LOOPS = 3;
const MAX_VERIFY_LOOPS = 3;

/** Resolve the next stage from a validated worker result. */
export const resolveNextStage = (options: {
  currentStage: ContractPipelineStage;
  verdict: ContractStageResult;
  criticLoops: number;
  verifyLoops: number;
}): { next: ContractPipelineStage; criticLoops: number; verifyLoops: number } => {
  if (options.verdict.status === 'blocked' || options.verdict.status === 'failed') {
    return {
      next: 'blocked',
      criticLoops: options.criticLoops,
      verifyLoops: options.verifyLoops,
    };
  }

  if (options.currentStage === 'write_contract') {
    return { next: 'critique', criticLoops: options.criticLoops, verifyLoops: options.verifyLoops };
  }

  if (options.currentStage === 'critique') {
    if (options.verdict.status !== 'changes_requested') {
      return {
        next: 'implement',
        criticLoops: options.criticLoops,
        verifyLoops: options.verifyLoops,
      };
    }
    const criticLoops = options.criticLoops + 1;
    return {
      next: criticLoops >= MAX_CRITIC_LOOPS ? 'blocked' : 'write_contract',
      criticLoops,
      verifyLoops: options.verifyLoops,
    };
  }

  if (options.currentStage === 'implement') {
    return { next: 'verify', criticLoops: options.criticLoops, verifyLoops: options.verifyLoops };
  }

  if (options.currentStage === 'verify') {
    if (options.verdict.status !== 'changes_requested') {
      return { next: 'review', criticLoops: options.criticLoops, verifyLoops: options.verifyLoops };
    }
    const verifyLoops = options.verifyLoops + 1;
    return {
      next: verifyLoops >= MAX_VERIFY_LOOPS ? 'blocked' : 'implement',
      criticLoops: options.criticLoops,
      verifyLoops,
    };
  }

  return {
    next: options.currentStage === 'review' ? 'accepted' : 'blocked',
    criticLoops: options.criticLoops,
    verifyLoops: options.verifyLoops,
  };
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
