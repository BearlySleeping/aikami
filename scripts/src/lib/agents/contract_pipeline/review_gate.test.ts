// scripts/src/lib/agents/contract_pipeline/review_gate.test.ts
import { describe, expect, it } from 'bun:test';
import { canEnterReview, isFingerprintCurrent, stageAfterReviewChanges } from './review_gate.ts';

describe('canEnterReview', () => {
  it('starts review only after verifier pass', () => {
    expect(
      canEnterReview({
        currentStage: 'verify',
        verifierPassed: true,
        reviewAlreadyStarted: false,
      }),
    ).toBe(true);
    expect(
      canEnterReview({
        currentStage: 'implement',
        verifierPassed: false,
        reviewAlreadyStarted: false,
      }),
    ).toBe(false);
  });

  it('prevents duplicate review sessions', () => {
    expect(
      canEnterReview({
        currentStage: 'review',
        verifierPassed: true,
        reviewAlreadyStarted: true,
      }),
    ).toBe(false);
  });
});

describe('stageAfterReviewChanges', () => {
  it('routes contract edits to critique and code-only edits to verification', () => {
    expect(stageAfterReviewChanges(true)).toBe('critique');
    expect(stageAfterReviewChanges(false)).toBe('verify');
  });
});

describe('isFingerprintCurrent', () => {
  it('accepts the exact verified content fingerprint', () => {
    expect(
      isFingerprintCurrent({
        storedFingerprint: 'verified-content-hash',
        currentFingerprint: 'verified-content-hash',
      }),
    ).toBe(true);
  });

  it('invalidates empty or changed fingerprints', () => {
    expect(
      isFingerprintCurrent({
        storedFingerprint: undefined,
        currentFingerprint: 'changed',
      }),
    ).toBe(false);
    expect(
      isFingerprintCurrent({
        storedFingerprint: 'verified',
        currentFingerprint: 'changed',
      }),
    ).toBe(false);
  });
});
