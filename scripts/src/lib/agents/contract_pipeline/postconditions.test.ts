// scripts/src/lib/agents/contract_pipeline/postconditions.test.ts
//
// The post-stage check deliberately does NOT enforce role filesystem
// boundaries (see postconditions.ts). These tests pin that honesty: the
// result must never claim to have enforced a boundary it does not have, and
// must still report the changed-path diff for the audit trail.

import { describe, expect, it } from 'bun:test';
import { validatePostconditions } from './postconditions.ts';
import type { GitStateSnapshot } from './types.ts';

const snapshot = (files: Record<string, string>): GitStateSnapshot => ({
  files,
  fingerprint: JSON.stringify(files),
});

describe('validatePostconditions — honest contract', () => {
  it('reports enforced: false so a vacuous pass is never a boundary claim', () => {
    const result = validatePostconditions({
      role: 'writer',
      contractPath: 'docs/contracts/C-1.md',
      repoRoot: '/repo',
      before: snapshot({ 'a.ts': '1' }),
      after: snapshot({ 'a.ts': '1' }),
    });
    expect(result.passed).toBe(true);
    expect(result.enforced).toBe(false);
    expect(result.unauthorizedPaths).toEqual([]);
  });

  it('reports every changed path for the audit trail', () => {
    const result = validatePostconditions({
      role: 'implementer',
      contractPath: 'docs/contracts/C-1.md',
      repoRoot: '/repo',
      before: snapshot({ 'a.ts': '1', 'b.ts': '2' }),
      after: snapshot({ 'a.ts': 'changed', 'c.ts': '3' }),
    });
    expect(result.changedPaths).toContain('a.ts');
    expect(result.changedPaths).toContain('b.ts');
    expect(result.changedPaths).toContain('c.ts');
    // Zero unauthorized paths, because zero boundaries are enforced.
    expect(result.unauthorizedPaths).toEqual([]);
  });
});
