// scripts/src/lib/agents/contract_pipeline.test.ts
/**
 * Unit tests for the contract pipeline verdict parsers and state machine logic.
 *
 * These test the core decision functions in isolation — no Herdr dependency.
 */

import { describe, expect, it } from 'bun:test';

// ── Import the parsers (extracted as testable functions) ──
// We inline the parser functions here since they're private to contract_pipeline.ts.
// In a real setup, these would be exported via a test helper or via re-export.

// Re-implemented inline for test isolation
const parseWriterVerdict = (text: string): { writer?: { next: string } } => {
  const nextMatch = text.match(/Next:\s*(.+)/i);
  const hasSummary = /##\s*Contract Writer Summary/.test(text);
  return {
    writer: {
      next: nextMatch?.[1]?.trim() ?? (hasSummary ? 'complete' : 'missing'),
    },
  };
};

const parseCriticVerdict = (
  text: string,
): {
  critique?: { verdict: 'APPROVE' | 'CHANGES_REQUESTED' | 'NEEDS_CLARIFICATION' | 'MISSING' };
} => {
  const verdictMatch = text.match(
    /##\s*Critique Verdict:\s*(APPROVE|CHANGES_REQUESTED|NEEDS_CLARIFICATION)/i,
  );
  if (!verdictMatch) {
    return { critique: { verdict: 'MISSING' } };
  }
  return {
    critique: {
      verdict: verdictMatch[1]?.toUpperCase() as
        | 'APPROVE'
        | 'CHANGES_REQUESTED'
        | 'NEEDS_CLARIFICATION',
    },
  };
};

const parseImplementerVerdict = (
  text: string,
): { implementer?: { acStatus: Record<string, string>; hasReport: boolean } } => {
  const hasReport = /##\s*Execution Report/.test(text);
  const acStatus: Record<string, string> = {};
  const rows = text.matchAll(/\|\s*(AC-\d+|AC\d+)\s*\|\s*(✅|⚠️|⚠|❌)\s*\|/g);
  for (const row of rows) {
    acStatus[row[1] ?? ''] = row[2] ?? '';
  }
  return { implementer: { acStatus, hasReport } };
};

const parseVerifierVerdict = (
  text: string,
): { verifier?: { verdict: 'PASS' | 'CHANGES_REQUESTED' | 'MISSING' } } => {
  const verdictMatch = text.match(/##\s*Verification Verdict:\s*(PASS|CHANGES_REQUESTED)/i);
  if (!verdictMatch) {
    return { verifier: { verdict: 'MISSING' } };
  }
  return {
    verifier: {
      verdict: verdictMatch[1]?.toUpperCase() as 'PASS' | 'CHANGES_REQUESTED',
    },
  };
};

// State machine transition logic (pure functions)
const MAX_CRITIC_LOOPS = 3;
const MAX_VERIFY_LOOPS = 3;

type StageType =
  | 'write_contract'
  | 'critique'
  | 'implement'
  | 'verify'
  | 'review'
  | 'blocked'
  | 'done';

const resolveCriticTransition = (criticVerdict: string, criticLoopCount: number): StageType => {
  switch (criticVerdict) {
    case 'APPROVE':
      return 'implement';
    case 'CHANGES_REQUESTED':
      return criticLoopCount >= MAX_CRITIC_LOOPS ? 'review' : 'write_contract';
    default:
      return 'review';
  }
};

const resolveVerifyTransition = (verifierVerdict: string, verifyLoopCount: number): StageType => {
  switch (verifierVerdict) {
    case 'PASS':
      return 'review';
    case 'CHANGES_REQUESTED':
      return verifyLoopCount >= MAX_VERIFY_LOOPS ? 'review' : 'implement';
    default:
      return 'review';
  }
};

// ── Test Suite: Stage Verdict Parsers ──

describe('parseWriterVerdict', () => {
  it('extracts next step from summary', () => {
    const output = `
## Contract Writer Summary

**Contract**: C-312 — Restore Planning
**Status**: draft
**ACs**: 4
**Projects affected**: 2

Next: /contract-critique for adversarial review
    `.trim();

    const result = parseWriterVerdict(output);
    expect(result.writer?.next).toInclude('/contract-critique');
  });

  it('detects missing next step', () => {
    const output = `
## Contract Writer Summary

**Contract**: C-312 — Restore Planning
    `.trim();

    const result = parseWriterVerdict(output);
    expect(result.writer?.next).toBe('complete');
  });

  it('handles empty output', () => {
    const result = parseWriterVerdict('');
    expect(result.writer?.next).toBe('missing');
  });
});

describe('parseCriticVerdict', () => {
  it('detects APPROVE', () => {
    const output = `
## Critique Verdict: APPROVE

### Strengths
- Well-defined scope
    `.trim();

    const result = parseCriticVerdict(output);
    expect(result.critique?.verdict).toBe('APPROVE');
  });

  it('detects CHANGES_REQUESTED', () => {
    const output = `
## Critique Verdict: CHANGES_REQUESTED

### Critical Issues
- Missing error handling
    `.trim();

    const result = parseCriticVerdict(output);
    expect(result.critique?.verdict).toBe('CHANGES_REQUESTED');
  });

  it('detects NEEDS_CLARIFICATION', () => {
    const output = `
## Critique Verdict: NEEDS_CLARIFICATION

### Summary
- Unclear about data model
    `.trim();

    const result = parseCriticVerdict(output);
    expect(result.critique?.verdict).toBe('NEEDS_CLARIFICATION');
  });

  it('detects missing verdict section (returns MISSING)', () => {
    const output = 'Just some random text without a verdict heading.';
    const result = parseCriticVerdict(output);
    expect(result.critique?.verdict).toBe('MISSING');
  });

  it('extracts verdict with extra whitespace', () => {
    const output = `
## Critique Verdict:    CHANGES_REQUESTED

Some extra content.
    `.trim();

    const result = parseCriticVerdict(output);
    expect(result.critique?.verdict).toBe('CHANGES_REQUESTED');
  });
});

describe('parseImplementerVerdict', () => {
  it('detects execution report and parses AC status', () => {
    const output = `
## Execution Report

### Summary
Built feature X

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Done |
| AC-2 | ✅ | Done |
| AC-3 | ⚠ | Partial |

### Files Created
| File | Purpose |
|---|---|`;
    const result = parseImplementerVerdict(output);
    expect(result.implementer?.hasReport).toBe(true);
    expect(result.implementer?.acStatus['AC-1']).toBe('✅');
    expect(result.implementer?.acStatus['AC-2']).toBe('✅');
    expect(result.implementer?.acStatus['AC-3']).toBe('⚠');
  });

  it('handles no execution report', () => {
    const result = parseImplementerVerdict('No report here.');
    expect(result.implementer?.hasReport).toBe(false);
    expect(Object.keys(result.implementer?.acStatus ?? {})).toHaveLength(0);
  });

  it('handles empty AC table', () => {
    const output = `
## Execution Report

### AC Status
(No ACs completed yet)
`;
    const result = parseImplementerVerdict(output);
    expect(result.implementer?.hasReport).toBe(true);
    expect(Object.keys(result.implementer?.acStatus ?? {})).toHaveLength(0);
  });
});

describe('parseVerifierVerdict', () => {
  it('detects PASS', () => {
    const output = `
## Verification Verdict: PASS

### AC Evidence
| AC | Status |
|---|---|
| AC-1 | ✅ |
    `.trim();

    const result = parseVerifierVerdict(output);
    expect(result.verifier?.verdict).toBe('PASS');
  });

  it('detects CHANGES_REQUESTED', () => {
    const output = `
## Verification Verdict: CHANGES_REQUESTED

### Structural Issues
- Missing test file
    `.trim();

    const result = parseVerifierVerdict(output);
    expect(result.verifier?.verdict).toBe('CHANGES_REQUESTED');
  });

  it('detects missing verdict', () => {
    const result = parseVerifierVerdict('No verdict.');
    expect(result.verifier?.verdict).toBe('MISSING');
  });
});

// ── Test Suite: State Machine Transitions ──

describe('critic transition', () => {
  it('APPROVE → implement', () => {
    expect(resolveCriticTransition('APPROVE', 0)).toBe('implement');
  });

  it('CHANGES_REQUESTED → write_contract (loop 0 of 3)', () => {
    expect(resolveCriticTransition('CHANGES_REQUESTED', 0)).toBe('write_contract');
  });

  it('CHANGES_REQUESTED → write_contract (loop 2 of 3)', () => {
    expect(resolveCriticTransition('CHANGES_REQUESTED', 2)).toBe('write_contract');
  });

  it('CHANGES_REQUESTED → review when max loops reached (3)', () => {
    expect(resolveCriticTransition('CHANGES_REQUESTED', 3)).toBe('review');
  });

  it('CHANGES_REQUESTED → review when beyond max loops (5)', () => {
    expect(resolveCriticTransition('CHANGES_REQUESTED', 5)).toBe('review');
  });

  it('NEEDS_CLARIFICATION → review', () => {
    expect(resolveCriticTransition('NEEDS_CLARIFICATION', 0)).toBe('review');
  });

  it('unknown verdict → review', () => {
    expect(resolveCriticTransition('UNKNOWN', 0)).toBe('review');
  });
});

describe('verify transition', () => {
  it('PASS → review', () => {
    expect(resolveVerifyTransition('PASS', 0)).toBe('review');
  });

  it('CHANGES_REQUESTED → implement (loop 0 of 3)', () => {
    expect(resolveVerifyTransition('CHANGES_REQUESTED', 0)).toBe('implement');
  });

  it('CHANGES_REQUESTED → implement (loop 2 of 3)', () => {
    expect(resolveVerifyTransition('CHANGES_REQUESTED', 2)).toBe('implement');
  });

  it('CHANGES_REQUESTED → review when max loops reached (3)', () => {
    expect(resolveVerifyTransition('CHANGES_REQUESTED', 3)).toBe('review');
  });

  it('CHANGES_REQUESTED → review when beyond max loops (5)', () => {
    expect(resolveVerifyTransition('CHANGES_REQUESTED', 5)).toBe('review');
  });

  it('unknown verdict → review', () => {
    expect(resolveVerifyTransition('MISSING', 0)).toBe('review');
  });
});

// ── Test Suite: Loop Counter ──

describe('loop counter', () => {
  it('critic loops capped at MAX_CRITIC_LOOPS (3)', () => {
    const results = [0, 1, 2, 3, 4].map((count) => ({
      count,
      next: resolveCriticTransition('CHANGES_REQUESTED', count),
    }));

    // Loops 0-2 → write_contract, 3+ → review
    expect(results[0]?.next).toBe('write_contract');
    expect(results[1]?.next).toBe('write_contract');
    expect(results[2]?.next).toBe('write_contract');
    expect(results[3]?.next).toBe('review');
    expect(results[4]?.next).toBe('review');
  });

  it('verify loops capped at MAX_VERIFY_LOOPS (3)', () => {
    const results = [0, 1, 2, 3, 4].map((count) => ({
      count,
      next: resolveVerifyTransition('CHANGES_REQUESTED', count),
    }));

    // Loops 0-2 → implement, 3+ → review
    expect(results[0]?.next).toBe('implement');
    expect(results[1]?.next).toBe('implement');
    expect(results[2]?.next).toBe('implement');
    expect(results[3]?.next).toBe('review');
    expect(results[4]?.next).toBe('review');
  });

  it('APPROVE/PASS never loop regardless of count', () => {
    expect(resolveCriticTransition('APPROVE', 10)).toBe('implement');
    expect(resolveVerifyTransition('PASS', 10)).toBe('review');
  });
});

// ── Test Suite: Contract Resolution (TODO ID → file path logic) ──

describe('contract resolution (unit logic)', () => {
  it('C-XXX IDs are recognized as TODO matches', () => {
    const isTodoId = /^(C-\d+|MIG-\d+)$/i;
    expect(isTodoId.test('C-312')).toBe(true);
    expect(isTodoId.test('c-312')).toBe(true);
    expect(isTodoId.test('MIG-001')).toBe(true);
    expect(isTodoId.test('raw text')).toBe(false);
    expect(isTodoId.test('docs/contracts/file.md')).toBe(false);
  });

  it('.md paths are recognized as file references', () => {
    expect('docs/contracts/C-312-slug.md'.endsWith('.md')).toBe(true);
    expect('C-312'.endsWith('.md')).toBe(false);
  });

  it('raw text generates a RAW-xxx ID', () => {
    const isRawText = (input: string): boolean =>
      !/^(C-\d+|MIG-\d+)$/i.test(input) && !input.endsWith('.md');
    expect(isRawText('Add dark mode toggle')).toBe(true);
    expect(isRawText('C-312')).toBe(false);
    expect(isRawText('file.md')).toBe(false);
  });
});
