// scripts/src/lib/agents/contract_pipeline/state_machine.test.ts
import { describe, expect, it } from 'bun:test';
import { resolveNextStage, transition } from './state_machine.ts';
import type { ContractStageResult, RunManifest } from './types.ts';

const result = (options: Partial<ContractStageResult>): ContractStageResult => ({
  runId: 'run-test',
  stage: 'writer',
  attempt: 1,
  status: 'passed',
  summary: '',
  findings: [],
  filesTouched: [],
  evidence: [],
  contractHash: '',
  diffHash: '',
  ...options,
});

const manifest = (): RunManifest => ({
  version: 3,
  runId: 'run-test',
  contractId: 'C-365',
  contractPath: 'docs/contracts/C-365-test.md',
  baseCommit: 'abc',
  baselineFingerprint: 'baseline',
  startTime: '2026-01-01T00:00:00.000Z',
  lastUpdated: '2026-01-01T00:00:00.000Z',
  currentStage: 'write_contract',
  verifyLoops: 0,
  attempts: [],
  usage: {},
});

describe('resolveNextStage', () => {
  it('moves writer to critique; critic to implement (no bounce)', () => {
    expect(
      resolveNextStage({
        currentStage: 'write_contract',
        verdict: result({ stage: 'writer', status: 'passed' }),
        verifyLoops: 0,
      }).next,
    ).toBe('critique');
    expect(
      resolveNextStage({
        currentStage: 'critique',
        verdict: result({ stage: 'critic' }),
        verifyLoops: 0,
      }).next,
    ).toBe('implement');
  });

  it('blocks on failed/blocked verdicts', () => {
    expect(
      resolveNextStage({
        currentStage: 'write_contract',
        verdict: result({ stage: 'writer', status: 'blocked' }),
        verifyLoops: 0,
      }).next,
    ).toBe('blocked');
  });

  it('routes implementation to verify', () => {
    expect(
      resolveNextStage({
        currentStage: 'implement',
        verdict: result({ stage: 'implementer' }),
        verifyLoops: 0,
      }).next,
    ).toBe('verify');
  });

  it('loops verification feedback max 2 times, then blocks', () => {
    // First changes_requested → bounce back to implement.
    const retry1 = resolveNextStage({
      currentStage: 'verify',
      verdict: result({ stage: 'verifier', status: 'changes_requested' }),
      verifyLoops: 0,
    });
    expect(retry1.next).toBe('implement');
    expect(retry1.verifyLoops).toBe(1);

    // Second changes_requested (loop exhausted at MAX=2) → blocked.
    const blocked = resolveNextStage({
      currentStage: 'verify',
      verdict: result({ stage: 'verifier', status: 'changes_requested' }),
      verifyLoops: 1,
    });
    expect(blocked.next).toBe('blocked');
    expect(blocked.verifyLoops).toBe(2);
  });

  it('routes passed verification to review', () => {
    expect(
      resolveNextStage({
        currentStage: 'verify',
        verdict: result({ stage: 'verifier', status: 'passed' }),
        verifyLoops: 0,
      }).next,
    ).toBe('review');
  });
});

describe('transition', () => {
  it('returns a manifest with the requested stage', () => {
    const updated = transition({ manifest: manifest(), next: 'critique' });
    expect(updated.currentStage).toBe('critique');
  });
});
