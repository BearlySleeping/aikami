// scripts/src/lib/agents/contract_pipeline/review_gate.ts
import type { ContractPipelineStage } from './types.ts';
import type { CheckOutcome, ValidationArtifact } from './validation_policy.ts';
import { isBlockingOutcome } from './validation_policy.ts';

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

/**
 * Determine whether a validation artifact represents current evidence for
 * the given candidate.
 * AC-3: Stale evidence is rejected — an unchanged candidate can reuse valid
 * evidence, but any change (staged edit, new commit, base change) invalidates it.
 */
export const isEvidenceCurrent = (options: {
  artifact: ValidationArtifact | undefined;
  currentFingerprint: string;
  currentBaseFingerprint?: string;
}): boolean => {
  if (!options.artifact) {
    return false;
  }
  // Different candidate fingerprint → stale
  if (options.artifact.candidateFingerprint !== options.currentFingerprint) {
    return false;
  }
  // Different base fingerprint → diff context changed → stale
  if (
    options.currentBaseFingerprint !== undefined &&
    options.artifact.baseFingerprint !== undefined &&
    options.artifact.baseFingerprint !== options.currentBaseFingerprint
  ) {
    return false;
  }
  // Evidence must show passed or it doesn't count
  return options.artifact.overallOutcome === 'passed';
};

/**
 * Determine whether failed/unavailable/cancelled checks exist in a set of
 * validation results, preventing promotion.
 * AC-4: Failed or unavailable checks prevent promotion.
 * AC-5: Cancellation cannot satisfy check requirements.
 */
export const hasBlockingResults = (options: {
  results: readonly { outcome: CheckOutcome; required: boolean }[];
}): boolean => options.results.some((r) => r.required && isBlockingOutcome(r.outcome));

/**
 * Route review edits through critique when the contract changed, otherwise verification.
 * AC-3: A contract change during review invalidates prior evidence.
 */
export const stageAfterReviewChanges = (contractChanged: boolean): 'critique' | 'verify' =>
  contractChanged ? 'critique' : 'verify';
