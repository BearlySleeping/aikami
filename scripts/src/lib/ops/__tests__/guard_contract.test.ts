// scripts/src/lib/ops/__tests__/guard_contract.test.ts
//
// The sanctioned contraction step is the only thing allowed to WRITE a ratchet
// baseline automatically, so what it may write is the whole point:
//
//   • it invokes each ratcheted guard with `--update-baseline` — which is
//     reduction-only by construction — and never with `--bootstrap-baseline`,
//     which records whatever state the tree is in;
//   • it never treats a refusal as a verdict, because `:validate` reports the
//     real failure;
//   • it is not wired into CI (it writes files).

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ratchetedGuards } from '../guards/registry.ts';

const REPO_ROOT = resolve(import.meta.dir, '../../../../..');
const CONTRACT_SOURCE = readFileSync(
  resolve(REPO_ROOT, 'scripts/src/lib/ops/guard_contract.ts'),
  'utf8',
);
const SCRIPTS_TASKS = readFileSync(resolve(REPO_ROOT, '.moon/tasks/scripts.yml'), 'utf8');
const PR_CHECKS = readFileSync(resolve(REPO_ROOT, '.github/workflows/pr-checks.yml'), 'utf8');
const PRE_PUSH = readFileSync(
  resolve(REPO_ROOT, 'scripts/src/lib/agents/contract_pipeline/pre_push_gate.ts'),
  'utf8',
);

describe('guard contraction', () => {
  test('every ratcheted guard has a script on disk', () => {
    const guards = ratchetedGuards();
    expect(guards.length).toBeGreaterThan(0);
    for (const guard of guards) {
      expect(existsSync(resolve(REPO_ROOT, guard.script)), `${guard.id} script is missing`).toBe(
        true,
      );
    }
  });

  test('it contracts with --update-baseline and never with --bootstrap-baseline', () => {
    expect(CONTRACT_SOURCE).toContain("'--update-baseline'");
    expect(CONTRACT_SOURCE).not.toContain('--bootstrap-baseline');
  });

  test('every ratcheted guard accepts --update-baseline', () => {
    for (const guard of ratchetedGuards()) {
      const source = readFileSync(resolve(REPO_ROOT, guard.script), 'utf8');
      expect(source, `${guard.id} does not handle --update-baseline`).toContain(
        '--update-baseline',
      );
    }
  });

  test('it tolerates a guard that refuses to contract', () => {
    // The refusal path must not be fatal: `:validate` is the verdict.
    expect(CONTRACT_SOURCE).toMatch(/refused to contract/);
    expect(CONTRACT_SOURCE).toContain('catch');
  });

  test('it is not wired into CI', () => {
    // It writes files. Running it in CI would mutate a checkout and produce a
    // diff nobody committed.
    expect(SCRIPTS_TASKS).toMatch(/guard-contract:[\s\S]{0,400}runInCI: false/);
    expect(PR_CHECKS).not.toContain('scripts:guard-contract');
  });

  test('it runs in the pre-push gate between :fix and :validate, and is not a verdict', () => {
    const contractIndex = PRE_PUSH.indexOf("'scripts:guard-contract'");
    expect(contractIndex).toBeGreaterThan(-1);
    const block = PRE_PUSH.slice(Math.max(0, contractIndex - 200), contractIndex + 200);
    expect(block).toContain('verdict: false');
  });
});
