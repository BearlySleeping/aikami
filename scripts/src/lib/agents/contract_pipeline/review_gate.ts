// scripts/src/lib/agents/contract_pipeline/review_gate.ts
import type { ContractPipelineStage } from './types.ts';

/** Determine whether a verified run may start its final review session. */
export const canEnterReview = (options: {
  currentStage: ContractPipelineStage;
  verifierPassed: boolean;
  reviewAlreadyStarted: boolean;
}): boolean => {
  if (options.reviewAlreadyStarted || !options.verifierPassed) {
    return false;
  }
  return options.currentStage === 'verify' || options.currentStage === 'review';
};

/** Determine whether approval still refers to the independently verified diff. */
export const isFingerprintCurrent = (options: {
  storedFingerprint: string | undefined;
  currentFingerprint: string;
}): boolean =>
  typeof options.storedFingerprint === 'string' &&
  options.storedFingerprint.length > 0 &&
  options.storedFingerprint === options.currentFingerprint;

/** Route review edits through critique when the contract changed, otherwise verification. */
export const stageAfterReviewChanges = (contractChanged: boolean): 'critique' | 'verify' =>
  contractChanged ? 'critique' : 'verify';
