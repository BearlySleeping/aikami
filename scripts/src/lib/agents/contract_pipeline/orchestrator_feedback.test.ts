// scripts/src/lib/agents/contract_pipeline/orchestrator_feedback.test.ts
//
// Covers verifierFeedback()'s assembly of the implementer's next-attempt
// context — in particular that a review captain's `change` decision (from
// either fallback recovery or a live human-in-the-loop review) reaches the
// implementer, `summary` and `details` both included.
import { describe, expect, it } from 'bun:test';
import { prePushGateForRevision, verifierFeedback } from './orchestrator.ts';
import type { ContractStageResult, RunManifest, StageAttempt } from './types.ts';

const baseManifest = (overrides: Partial<RunManifest> = {}): RunManifest => ({
  version: 3,
  runId: 'run-test-C-999',
  contractId: 'C-999',
  contractPath: 'docs/contracts/C-999-test.md',
  baseCommit: 'abc123',
  baselineFingerprint: 'fp1',
  startTime: new Date().toISOString(),
  lastUpdated: new Date().toISOString(),
  currentStage: 'implement',
  verifyLoops: 1,
  attempts: [],
  usage: {},
  autofixCycles: 0,
  ...overrides,
});

const verifyResult = (): ContractStageResult => ({
  runId: 'run-test-C-999',
  stage: 'verifier',
  attempt: 1,
  status: 'changes_requested',
  summary: 'Verifier found a broken redirect.',
  findings: ['Redirect loop on /login'],
  filesTouched: [],
  evidence: [],
  contractHash: 'h1',
  diffHash: 'h2',
});

const verifyAttempt = (): StageAttempt => ({
  stage: 'verify',
  role: 'verifier',
  attempt: 1,
  paneId: 'pane-verify',
  startTime: new Date().toISOString(),
  result: verifyResult(),
});

describe('verifierFeedback', () => {
  it('returns undefined on the first attempt regardless of state', () => {
    const manifest = baseManifest({ attempts: [verifyAttempt()] });
    expect(verifierFeedback({ manifest, attempt: 1 })).toBeUndefined();
  });

  it('includes the review captain summary and details on a change decision', () => {
    const manifest = baseManifest({
      attempts: [verifyAttempt()],
      reviewDecision: {
        runId: 'run-test-C-999',
        decision: 'change',
        summary: 'Fix the redirect loop in the login handler.',
        details: 'AskClaude found the loop originates in middleware.ts:42.',
        diffHash: 'h3',
        contractChanged: false,
        createdAt: new Date().toISOString(),
      },
    });
    const feedback = verifierFeedback({ manifest, attempt: 2 });
    expect(feedback).toContain('Fix the redirect loop in the login handler.');
    expect(feedback).toContain('AskClaude found the loop originates in middleware.ts:42.');
    expect(feedback).toContain('## Review Captain diagnosis');
  });

  it('omits the details section when the captain left it empty', () => {
    const manifest = baseManifest({
      attempts: [verifyAttempt()],
      reviewDecision: {
        runId: 'run-test-C-999',
        decision: 'change',
        summary: 'Just fix the typo in the header.',
        diffHash: 'h3',
        contractChanged: false,
        createdAt: new Date().toISOString(),
      },
    });
    const feedback = verifierFeedback({ manifest, attempt: 2 });
    expect(feedback).toContain('Just fix the typo in the header.');
    expect(feedback).not.toContain('Additional context from the review captain');
  });

  it('does not surface review details from a non-change decision', () => {
    const manifest = baseManifest({
      attempts: [verifyAttempt()],
      reviewDecision: {
        runId: 'run-test-C-999',
        decision: 'reject',
        summary: 'Cannot proceed without human input.',
        details: 'Should never reach the implementer.',
        diffHash: 'h3',
        contractChanged: false,
        createdAt: new Date().toISOString(),
      },
    });
    const feedback = verifierFeedback({ manifest, attempt: 2 });
    expect(feedback).not.toContain('Should never reach the implementer.');
    expect(feedback).toContain('Verifier found a broken redirect.');
  });

  it('falls back to verifier findings alone when there is no review decision', () => {
    const manifest = baseManifest({ attempts: [verifyAttempt()] });
    const feedback = verifierFeedback({ manifest, attempt: 2 });
    expect(feedback).toContain('Redirect loop on /login');
    expect(feedback).not.toContain('Review Captain diagnosis');
  });
});

describe('prePushGateForRevision', () => {
  it('returns diagnostics produced by the current revision', () => {
    const manifest = baseManifest({
      prePushValidation: {
        ok: false,
        output: 'scripts:typecheck failed',
        checkedAt: new Date().toISOString(),
        revision: 'revision-current',
      },
    });

    expect(prePushGateForRevision({ manifest, revision: 'revision-current' })).toEqual({
      ran: true,
      ok: false,
      output: 'scripts:typecheck failed',
    });
  });

  it('ignores diagnostics from an earlier or unknown revision', () => {
    const manifest = baseManifest({
      prePushValidation: {
        ok: false,
        output: 'stale failure',
        checkedAt: new Date().toISOString(),
        revision: 'revision-old',
      },
    });

    expect(prePushGateForRevision({ manifest, revision: 'revision-new' })).toBeUndefined();
    expect(prePushGateForRevision({ manifest, revision: 'unknown' })).toBeUndefined();
  });
});
