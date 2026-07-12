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
  criticLoops: 0,
  verifyLoops: 0,
  attempts: [],
  usage: {},
});

describe('resolveNextStage', () => {
  it('moves a successful writer to critique and blocks a failed writer', () => {
    expect(
      resolveNextStage({
        currentStage: 'write_contract',
        verdict: result({ stage: 'writer', status: 'passed' }),
        criticLoops: 0,
        verifyLoops: 0,
      }).next,
    ).toBe('critique');
    expect(
      resolveNextStage({
        currentStage: 'write_contract',
        verdict: result({ stage: 'writer', status: 'blocked' }),
        criticLoops: 0,
        verifyLoops: 0,
      }).next,
    ).toBe('blocked');
  });

  it('loops critic feedback and stops at the bound', () => {
    const retry = resolveNextStage({
      currentStage: 'critique',
      verdict: result({ stage: 'critic', status: 'changes_requested' }),
      criticLoops: 0,
      verifyLoops: 0,
    });
    expect(retry.next).toBe('write_contract');
    expect(retry.criticLoops).toBe(1);

    const bounded = resolveNextStage({
      currentStage: 'critique',
      verdict: result({ stage: 'critic', status: 'changes_requested' }),
      criticLoops: 2,
      verifyLoops: 0,
    });
    expect(bounded.next).toBe('blocked');
  });

  it('routes approved critique to implement and implementation to verify', () => {
    expect(
      resolveNextStage({
        currentStage: 'critique',
        verdict: result({ stage: 'critic' }),
        criticLoops: 0,
        verifyLoops: 0,
      }).next,
    ).toBe('implement');
    expect(
      resolveNextStage({
        currentStage: 'implement',
        verdict: result({ stage: 'implementer' }),
        criticLoops: 0,
        verifyLoops: 0,
      }).next,
    ).toBe('verify');
  });

  it('loops verification feedback and sends PASS to review', () => {
    expect(
      resolveNextStage({
        currentStage: 'verify',
        verdict: result({ stage: 'verifier', status: 'changes_requested' }),
        criticLoops: 0,
        verifyLoops: 0,
      }).next,
    ).toBe('implement');
    expect(
      resolveNextStage({
        currentStage: 'verify',
        verdict: result({ stage: 'verifier', status: 'passed' }),
        criticLoops: 0,
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
