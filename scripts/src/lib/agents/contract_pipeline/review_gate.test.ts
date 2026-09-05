// scripts/src/lib/agents/contract_pipeline/review_gate.test.ts
import { describe, expect, it } from 'bun:test';
import {
  canEnterReview,
  hasBlockingResults,
  isEvidenceCurrent,
  isFingerprintCurrent,
  stageAfterReviewChanges,
} from './review_gate.ts';
import type { ValidationArtifact } from './validation_policy.ts';

// ── canEnterReview ─────────────────────────────────────────────────

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

// ── stageAfterReviewChanges ────────────────────────────────────────

describe('stageAfterReviewChanges', () => {
  it('routes contract edits to critique and code-only edits to verification', () => {
    expect(stageAfterReviewChanges(true)).toBe('critique');
    expect(stageAfterReviewChanges(false)).toBe('verify');
  });
});

// ── isFingerprintCurrent ───────────────────────────────────────────

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

// ── isEvidenceCurrent (AC-3) ───────────────────────────────────────

const makeArtifact = (overrides: Partial<ValidationArtifact> = {}): ValidationArtifact => ({
  version: 1,
  candidateFingerprint: 'candidate-hash',
  baseFingerprint: 'base-hash',
  profile: 'focused',
  checks: [],
  timestamp: new Date().toISOString(),
  overallOutcome: 'passed',
  ...overrides,
});

describe('isEvidenceCurrent (AC-3)', () => {
  it('current evidence with matching fingerprints is fresh', () => {
    expect(
      isEvidenceCurrent({
        artifact: makeArtifact(),
        currentFingerprint: 'candidate-hash',
        currentBaseFingerprint: 'base-hash',
      }),
    ).toBe(true);
  });

  it('undefined artifact is stale', () => {
    expect(
      isEvidenceCurrent({
        artifact: undefined,
        currentFingerprint: 'anything',
      }),
    ).toBe(false);
  });

  it('different candidate fingerprint → stale', () => {
    expect(
      isEvidenceCurrent({
        artifact: makeArtifact({ candidateFingerprint: 'old-hash' }),
        currentFingerprint: 'new-hash',
      }),
    ).toBe(false);
  });

  it('different base fingerprint → stale', () => {
    expect(
      isEvidenceCurrent({
        artifact: makeArtifact({ baseFingerprint: 'old-base' }),
        currentFingerprint: 'candidate-hash',
        currentBaseFingerprint: 'new-base',
      }),
    ).toBe(false);
  });

  it('failed overall outcome → stale even with matching fingerprints', () => {
    expect(
      isEvidenceCurrent({
        artifact: makeArtifact({ overallOutcome: 'failed' }),
        currentFingerprint: 'candidate-hash',
      }),
    ).toBe(false);
  });

  it('unavailable overall outcome → stale', () => {
    expect(
      isEvidenceCurrent({
        artifact: makeArtifact({ overallOutcome: 'unavailable' }),
        currentFingerprint: 'candidate-hash',
      }),
    ).toBe(false);
  });

  it('artifact without base fingerprint is fresh when candidate matches', () => {
    expect(
      isEvidenceCurrent({
        artifact: makeArtifact({ baseFingerprint: undefined }),
        currentFingerprint: 'candidate-hash',
      }),
    ).toBe(true);
  });
});

// ── hasBlockingResults (AC-4, AC-5) ────────────────────────────────

describe('hasBlockingResults (AC-4, AC-5)', () => {
  it('no blocking results when all required pass', () => {
    expect(
      hasBlockingResults({
        results: [
          { outcome: 'passed', required: true },
          { outcome: 'passed', required: true },
        ],
      }),
    ).toBe(false);
  });

  it('failed required check is blocking', () => {
    expect(
      hasBlockingResults({
        results: [
          { outcome: 'passed', required: true },
          { outcome: 'failed', required: true },
        ],
      }),
    ).toBe(true);
  });

  it('unavailable required check is blocking', () => {
    expect(
      hasBlockingResults({
        results: [
          { outcome: 'unavailable', required: true },
        ],
      }),
    ).toBe(true);
  });

  it('cancelled required check is blocking (AC-5)', () => {
    expect(
      hasBlockingResults({
        results: [
          { outcome: 'cancelled', required: true },
        ],
      }),
    ).toBe(true);
  });

  it('failed optional check is not blocking', () => {
    expect(
      hasBlockingResults({
        results: [
          { outcome: 'passed', required: true },
          { outcome: 'failed', required: false },
        ],
      }),
    ).toBe(false);
  });

  it('not_applicable is not blocking', () => {
    expect(
      hasBlockingResults({
        results: [
          { outcome: 'not_applicable', required: true },
        ],
      }),
    ).toBe(false);
  });
});
