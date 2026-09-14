// scripts/src/lib/agents/contract_pipeline/state_machine.test.ts
//
// A blocked worker must reach the review captain, not a banner in a pane
// nobody is watching. See the C-442 incident note in state_machine.ts.
import { describe, expect, it } from 'bun:test';
import {
  MAX_BLOCKED_ESCALATION_ROUNDS,
  MAX_BLOCKED_ESCALATIONS,
  resolveNextStage,
} from './state_machine.ts';
import type { ContractStageResult } from './types.ts';

const verdict = (status: ContractStageResult['status']): ContractStageResult => ({
  runId: 'run-test-C-999',
  stage: 'verifier',
  attempt: 1,
  status,
  summary: `verifier ${status}`,
  findings: [],
  filesTouched: [],
  evidence: [],
  contractHash: '',
  diffHash: '',
});

describe('resolveNextStage blocked escalation', () => {
  it('sends a blocked worker to review instead of terminating', () => {
    const next = resolveNextStage({
      currentStage: 'verify',
      verdict: verdict('blocked'),
      verifyLoops: 0,
    });
    expect(next.next).toBe('review');
    expect(next.escalated).toBe(true);
    expect(next.blockedEscalations).toBe(1);
    expect(next.blockedEscalationRounds).toBe(1);
  });

  it('treats a failed worker the same way', () => {
    const next = resolveNextStage({
      currentStage: 'implement',
      verdict: verdict('failed'),
      verifyLoops: 0,
    });
    expect(next.next).toBe('review');
  });

  it('terminates once the escalation budget is spent', () => {
    const next = resolveNextStage({
      currentStage: 'verify',
      verdict: verdict('blocked'),
      verifyLoops: 0,
      blockedEscalations: MAX_BLOCKED_ESCALATIONS,
    });
    expect(next.next).toBe('blocked');
    expect(next.escalated).toBe(false);
    expect(next.blockedEscalationRounds).toBe(0);
  });

  it('escalates again after a captain change reset the episode budget', () => {
    // C-526 regression: the captain sent the work back (`change` resets
    // blockedEscalations to 0), the retry made real progress but blocked
    // again — the next blocked verdict must reach the captain, not terminate.
    const next = resolveNextStage({
      currentStage: 'implement',
      verdict: verdict('blocked'),
      verifyLoops: 0,
      blockedEscalations: 0,
      blockedEscalationRounds: 1,
    });
    expect(next.next).toBe('review');
    expect(next.escalated).toBe(true);
    expect(next.blockedEscalations).toBe(1);
    expect(next.blockedEscalationRounds).toBe(2);
  });

  it('terminates once the run-total escalation rounds are exhausted', () => {
    const next = resolveNextStage({
      currentStage: 'implement',
      verdict: verdict('blocked'),
      verifyLoops: 0,
      blockedEscalations: 0,
      blockedEscalationRounds: MAX_BLOCKED_ESCALATION_ROUNDS,
    });
    expect(next.next).toBe('blocked');
    expect(next.escalated).toBe(false);
    expect(next.blockedEscalationRounds).toBe(MAX_BLOCKED_ESCALATION_ROUNDS);
  });

  it('does not spend an escalation on a healthy verdict', () => {
    const next = resolveNextStage({
      currentStage: 'implement',
      verdict: verdict('passed'),
      verifyLoops: 0,
      blockedEscalations: 1,
      blockedEscalationRounds: 2,
    });
    expect(next.next).toBe('verify');
    expect(next.blockedEscalations).toBe(1);
    expect(next.blockedEscalationRounds).toBe(2);
    expect(next.escalated).toBe(false);
  });

  it('still bounces verify → implement on changes_requested', () => {
    const next = resolveNextStage({
      currentStage: 'verify',
      verdict: verdict('changes_requested'),
      verifyLoops: 0,
    });
    expect(next.next).toBe('implement');
    expect(next.verifyLoops).toBe(1);
  });

  it('routes to review once the verify bounce budget is exhausted', () => {
    const next = resolveNextStage({
      currentStage: 'verify',
      verdict: verdict('changes_requested'),
      verifyLoops: 1,
    });
    expect(next.next).toBe('review');
  });
});
