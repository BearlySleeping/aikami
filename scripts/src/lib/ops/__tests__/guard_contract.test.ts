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
//
// 🔴 The refusal path is tested through the runner's INJECTED execution seam,
// not by grepping the implementation for a `catch`. An assertion that the source
// contains the string `'refused to contract'` proves nothing about whether an
// `execFileSync` failure is caught, reported as a skip, and allowed to exit 0 —
// which is the entire contract of this step.

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { contractOne, type GuardExec, runContraction } from '../guard_contract.ts';
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

/** Records what the runner asked for and replies with a scripted outcome. */
const scriptedExec = (
  outcomes: ({ ok: true; stdout: string } | { ok: false; stderr: string })[],
): { exec: GuardExec; calls: { scriptPath: string; root: string }[] } => {
  const calls: { scriptPath: string; root: string }[] = [];
  let index = 0;
  const exec: GuardExec = (options) => {
    calls.push(options);
    return outcomes[index++] ?? { ok: true, stdout: '✅ contracted' };
  };
  return { exec, calls };
};

/** Fixture roots, removed when the process exits so a long session does not accumulate them. */
const fixtureRoots: string[] = [];

/** A fixture root whose guard script paths exist. */
const fixtureRoot = (scripts: readonly string[]): string => {
  const root = mkdtempSync(join(tmpdir(), 'aikami-contract-'));
  fixtureRoots.push(root);
  for (const script of scripts) {
    const full = join(root, script);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, '// fixture\n');
  }
  return root;
};

describe('contractOne — the observable contract', () => {
  test('a successful contraction reports the guard’s own ✅ line', () => {
    const root = fixtureRoot(['scripts/src/lib/ops/guard_x.ts']);
    const { exec, calls } = scriptedExec([
      { ok: true, stdout: 'noise\n✅ guard-x baseline contracted: 3 → 2 file(s)\n' },
    ]);

    const outcome = contractOne({ id: 'x', script: 'scripts/src/lib/ops/guard_x.ts' }, exec, root);

    expect(outcome.contracted).toBe(true);
    expect(outcome.summary).toBe('✅ guard-x baseline contracted: 3 → 2 file(s)');
    expect(calls).toHaveLength(1);
    // The sanctioned flag, and ONLY the sanctioned flag.
    expect(calls[0]?.scriptPath).toBe(join(root, 'scripts/src/lib/ops/guard_x.ts'));
  });

  test('a guard that refuses is reported as a skip, not as a failure', () => {
    const root = fixtureRoot(['scripts/src/lib/ops/guard_x.ts']);
    const { exec } = scriptedExec([
      {
        ok: false,
        stderr:
          '\u001b[31m🔴 x guard refusing --update-baseline\u001b[0m\n\u001b[31m🔴 x guard failed — 1 growth\u001b[0m\n',
      },
    ]);

    const outcome = contractOne({ id: 'x', script: 'scripts/src/lib/ops/guard_x.ts' }, exec, root);

    expect(outcome.contracted).toBe(false);
    // The LAST 🔴 line is the summary, and the ANSI codes are stripped.
    expect(outcome.summary).toBe('🔴 x guard failed — 1 growth');
    expect(outcome.summary).not.toContain('\u001b');
  });

  test('a spawn failure with no stderr still yields an actionable skip summary', () => {
    const root = fixtureRoot(['scripts/src/lib/ops/guard_x.ts']);
    const { exec } = scriptedExec([{ ok: false, stderr: '' }]);

    const outcome = contractOne({ id: 'x', script: 'scripts/src/lib/ops/guard_x.ts' }, exec, root);

    expect(outcome.contracted).toBe(false);
    expect(outcome.summary).toBe('refused to contract');
  });

  test('a missing guard script is reported without executing anything', () => {
    const root = fixtureRoot([]);
    const { exec, calls } = scriptedExec([]);

    const outcome = contractOne(
      { id: 'gone', script: 'scripts/src/lib/ops/guard_gone.ts' },
      exec,
      root,
    );

    expect(outcome.contracted).toBe(false);
    expect(outcome.summary).toContain('guard script missing');
    expect(calls).toHaveLength(0);
  });
});

describe('runContraction', () => {
  test('runs every registered ratchet, in registry order, with --update-baseline', () => {
    const guards = ratchetedGuards();
    expect(guards.length).toBeGreaterThan(0);
    const { exec, calls } = scriptedExec(guards.map(() => ({ ok: true, stdout: '✅ contracted' })));

    const { outcomes, skipped } = runContraction(exec, REPO_ROOT);

    expect(outcomes).toHaveLength(guards.length);
    expect(skipped).toBe(0);
    expect(calls.map((call) => call.scriptPath)).toEqual(
      guards.map((guard) => resolve(REPO_ROOT, guard.script)),
    );
    expect(CONTRACT_SOURCE).toContain("'--update-baseline'");
  });

  test('counts refusals without throwing, so the caller can still exit 0', () => {
    const guards = ratchetedGuards();
    const outcomes = guards.map((_, index) =>
      index === 0
        ? { ok: false as const, stderr: '🔴 refused' }
        : { ok: true as const, stdout: '✅ ok' },
    );
    const { exec } = scriptedExec(outcomes);

    const result = runContraction(exec, REPO_ROOT);

    expect(result.skipped).toBe(1);
    expect(result.outcomes[0]?.contracted).toBe(false);
    expect(result.outcomes.slice(1).every((outcome) => outcome.contracted)).toBe(true);
  });

  test('every ratcheted guard has a script on disk', () => {
    for (const guard of ratchetedGuards()) {
      expect(existsSync(resolve(REPO_ROOT, guard.script)), `${guard.id} script is missing`).toBe(
        true,
      );
    }
  });
});

describe('guard contraction wiring', () => {
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

// Keep the temp fixture roots from accumulating in a long test session.
process.on('exit', () => {
  for (const entry of fixtureRoots) {
    rmSync(entry, { recursive: true, force: true });
  }
});
