// scripts/src/lib/agents/contract_pipeline/postconditions.test.ts
import { describe, expect, it } from 'bun:test';
import { validatePostconditions } from './postconditions.ts';
import type { GitStateSnapshot } from './types.ts';

const snapshot = (files: Record<string, string>): GitStateSnapshot => ({
  files,
  fingerprint: JSON.stringify(files),
});

const contractPath = '/repo/docs/contracts/C-365-test.md';
const repoRoot = '/repo';

describe('validatePostconditions', () => {
  it('allows the writer to modify only the exact contract', () => {
    const result = validatePostconditions({
      role: 'writer',
      contractPath,
      repoRoot,
      before: snapshot({ 'docs/contracts/C-365-test.md': 'before' }),
      after: snapshot({ 'docs/contracts/C-365-test.md': 'after' }),
    });
    expect(result.passed).toBe(true);
  });

  it('blocks the C-313 regression: writer creates source and tests', () => {
    const result = validatePostconditions({
      role: 'writer',
      contractPath,
      repoRoot,
      before: snapshot({ 'docs/contracts/C-365-test.md': 'before' }),
      after: snapshot({
        'docs/contracts/C-365-test.md': 'implemented',
        'packages/shared/schemas/src/lib/campaign.ts': 'schema',
        'packages/shared/schemas/src/lib/campaign.test.ts': 'test',
      }),
    });
    expect(result.passed).toBe(false);
    expect(result.unauthorizedPaths).toEqual([
      'packages/shared/schemas/src/lib/campaign.test.ts',
      'packages/shared/schemas/src/lib/campaign.ts',
    ]);
  });

  it('detects modification and deletion of existing files, not only additions', () => {
    const result = validatePostconditions({
      role: 'writer',
      contractPath,
      repoRoot,
      before: snapshot({
        'docs/contracts/C-365-test.md': 'before',
        'scripts/src/lib/existing.ts': 'old',
      }),
      after: snapshot({ 'docs/contracts/C-365-test.md': 'after' }),
    });
    expect(result.unauthorizedPaths).toEqual(['scripts/src/lib/existing.ts']);
  });

  it('keeps critic read-only and verifier source-read-only', () => {
    const critic = validatePostconditions({
      role: 'critic',
      contractPath,
      repoRoot,
      before: snapshot({ 'docs/contracts/C-365-test.md': 'a' }),
      after: snapshot({ 'docs/contracts/C-365-test.md': 'b' }),
    });
    const verifier = validatePostconditions({
      role: 'verifier',
      contractPath,
      repoRoot,
      before: snapshot({ 'scripts/src/lib/code.ts': 'a' }),
      after: snapshot({ 'scripts/src/lib/code.ts': 'b' }),
    });
    expect(critic.passed).toBe(false);
    expect(verifier.passed).toBe(false);
  });

  it('allows implementer changes', () => {
    const result = validatePostconditions({
      role: 'implementer',
      contractPath,
      repoRoot,
      before: snapshot({}),
      after: snapshot({ 'scripts/src/lib/code.ts': 'new' }),
    });
    expect(result.passed).toBe(true);
  });
});
