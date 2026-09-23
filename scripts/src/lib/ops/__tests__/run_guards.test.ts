// scripts/src/lib/ops/__tests__/run_guards.test.ts
//
// The fast, Moon-free guard runner the pre-commit hook and pi's `validate`
// tool call. Two properties matter:
//
//   1. `formatGuardFailures` must hand an agent the FAILURE, not the warning
//      wall — guards print a ⚠️ line per advisory, and a diagnostic buried in
//      hundreds of those is one an agent skims past.
//   2. It must always carry the registry's remediation, so the response to a
//      failure is "fix the code", never "raise the baseline".
//
// The parallel spawn is exercised with an injected guard list so the test does
// not depend on which guards currently exist.

import { describe, expect, it } from 'bun:test';
import type { GuardMeta } from '../guards/registry.ts';
import {
  formatGuardFailures,
  type GuardRunResult,
  guardOutputNamesPath,
  runGuards,
} from '../run_guards.ts';

const result = (overrides: Partial<GuardRunResult> = {}): GuardRunResult => ({
  id: 'source-file-size',
  label: 'Guard: source file size',
  task: 'scripts:guard-source-file-size',
  code: 1,
  durationMs: 12,
  output: '❌ ecs_worker.ts is 2497 lines (waiver ceiling 2488)',
  remediation: 'Extract a cohesive responsibility, or reduce the module.',
  ...overrides,
});

describe('formatGuardFailures', () => {
  it('returns an empty string when every guard passed', () => {
    expect(formatGuardFailures([result({ code: 0 })])).toBe('');
  });

  it('drops the ⚠️ warning wall and keeps the failure lines', () => {
    const formatted = formatGuardFailures([
      result({
        output: [
          '⚠️  advisory: file is 1200 lines',
          '❌ ecs_worker.ts is 2497 lines (waiver ceiling 2488)',
          '⚠️  advisory: file is 900 lines',
        ].join('\n'),
      }),
    ]);

    expect(formatted).toContain('ecs_worker.ts is 2497 lines');
    expect(formatted).not.toContain('⚠️');
    expect(formatted).not.toContain('advisory');
  });

  it('includes the label, task and remediation so the fix is unambiguous', () => {
    const formatted = formatGuardFailures([result()]);

    expect(formatted).toContain('### ❌ Guard: source file size');
    expect(formatted).toContain('(scripts:guard-source-file-size)');
    expect(formatted).toContain('→ Fix: Extract a cohesive responsibility');
  });

  it('renders only failing guards, separated into sections', () => {
    const formatted = formatGuardFailures([
      result({ code: 0, output: '' }),
      result({ id: 'type-safety', label: 'Guard: type safety' }),
      result({ id: 'data-plane', label: 'Guard: data plane' }),
    ]);

    expect(formatted).not.toContain('source file size');
    expect(formatted.split('### ❌')).toHaveLength(3);
  });
});

describe('guardOutputNamesPath', () => {
  it('normalizes separators while preserving full-path matching', () => {
    const output = 'Failure in apps\\frontend\\client\\src\\shared.ts';

    expect(guardOutputNamesPath({ output, path: 'apps/frontend/client/src/shared.ts' })).toBe(true);
    expect(guardOutputNamesPath({ output, path: 'packages/shared/src/shared.ts' })).toBe(false);
  });
});

describe('runGuards', () => {
  it('runs an injected guard list and reports a non-zero script as a failure', async () => {
    const guard: GuardMeta = {
      id: 'test-guard',
      task: 'scripts:test-guard',
      script: 'scripts/src/lib/ops/__run_guards_missing_fixture__.ts',
      label: 'Guard: test',
      category: 'maintainability',
      wholeRepo: false,
      ratcheted: false,
      aggregate: false,
      moonTask: false,
      documented: false,
      paths: ['scripts/**/*'],
      description: 'A guard that does not exist, used to exercise the runner.',
      remediation: 'Nothing to fix in production — this is a test fixture.',
    };

    const [outcome] = await runGuards({ guards: [guard] });

    expect(outcome?.id).toBe('test-guard');
    expect(outcome?.task).toBe('scripts:test-guard');
    expect(outcome?.remediation).toBe(guard.remediation);
    expect(outcome?.code).not.toBe(0);
    expect(outcome?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns an empty list for an empty guard set', async () => {
    expect(await runGuards({ guards: [] })).toEqual([]);
  });
});
