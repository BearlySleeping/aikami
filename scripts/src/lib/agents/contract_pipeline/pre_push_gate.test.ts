// scripts/src/lib/agents/contract_pipeline/pre_push_gate.test.ts
import { describe, expect, it } from 'bun:test';
import { validateConstituentTasks } from '../../ops/guards/registry.ts';
import {
  formatGateNotesForPrompt,
  type GateRunner,
  MAX_GATE_OUTPUT_CHARS,
  runPrePushGate,
} from './pre_push_gate.ts';

/** Records every invocation and replies from a scripted list of outcomes. */
const scriptedRunner = (
  outcomes: { status: number | null; output?: string; spawnFailed?: boolean }[],
): { runner: GateRunner; calls: { args: string[]; cwd: string }[] } => {
  const calls: { args: string[]; cwd: string }[] = [];
  let index = 0;
  const runner: GateRunner = ({ args, cwd }) => {
    calls.push({ args, cwd });
    const outcome = outcomes[index++] ?? { status: 0 };
    return {
      status: outcome.status,
      output: outcome.output ?? '',
      spawnFailed: outcome.spawnFailed ?? false,
    };
  };
  return { runner, calls };
};

describe('runPrePushGate', () => {
  it('runs required checks then :validate against the given base', () => {
    const { runner, calls } = scriptedRunner(Array.from({ length: 6 }, () => ({ status: 0 })));

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    expect(result).toEqual({ outcome: 'passed', ran: true, ok: true, output: '' });
    expect(calls).toHaveLength(6);
    expect(calls[0]?.args).toEqual([
      'moon',
      'run',
      ':fix',
      '--affected',
      '--base=origin/main',
      '--concurrency',
      '8',
    ]);
    expect(calls[1]?.args).toEqual([
      'moon',
      'run',
      ':typecheck',
      '--affected',
      '--base=origin/main',
    ]);
    expect(calls[2]?.args).toEqual(['moon', 'run', 'scripts:guard-whole-repo']);
    expect(calls[3]?.args).toEqual(['moon', 'run', 'scripts:guard-policy-diff']);
    expect(calls[4]?.args).toEqual(['moon', 'run', 'scripts:guard-contract']);
    expect(calls[5]?.args).toEqual([
      'moon',
      'run',
      ':validate',
      '--affected',
      '--base=origin/main',
    ]);
    expect(calls[0]?.cwd).toBe('/tmp/wt');
  });

  // 🔴 The whole-repo guard step must NOT carry `--affected`. These guards read
  // the entire repository, so the affected-project graph is the wrong gate: on
  // a base whose diff resolves to nothing they would be skipped entirely, which
  // is how oversized files reached main (PR #339).
  it('runs whole-repo guards without --affected', () => {
    const { runner, calls } = scriptedRunner(Array.from({ length: 6 }, () => ({ status: 0 })));

    runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    const wholeRepo = calls.find((call) => call.args[2] === 'scripts:guard-whole-repo');
    expect(wholeRepo?.args).toEqual(['moon', 'run', 'scripts:guard-whole-repo']);
    expect(wholeRepo?.args).not.toContain('--affected');
  });

  // The ratchets' reduction-only contraction runs as part of the sanctioned
  // flow, so a legitimate improvement is locked in automatically instead of
  // leaving CI red on a stale baseline.
  it('runs the sanctioned contraction step between :fix and :validate', () => {
    const { runner, calls } = scriptedRunner(Array.from({ length: 6 }, () => ({ status: 0 })));

    runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    const tasks = calls.map((call) => call.args[2]);
    expect(tasks.indexOf('scripts:guard-contract')).toBeGreaterThan(tasks.indexOf(':fix'));
    expect(tasks.indexOf('scripts:guard-contract')).toBeLessThan(tasks.indexOf(':validate'));
  });

  it('runs every required CI profile task (AC-2)', () => {
    const { runner, calls } = scriptedRunner(Array.from({ length: 9 }, () => ({ status: 0 })));

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner, profile: 'ci' });

    expect(result).toEqual({ outcome: 'passed', ran: true, ok: true, output: '' });
    const tasks = calls.map((call) => call.args[2]);
    expect(tasks).toContain(':build');
    expect(tasks).toContain(':test');
  });

  // 🔴 A "not found" message that is NOT a gate-setup failure is a CODE
  // failure, not an infrastructure one: the gate ran and reported red. Pinned
  // as `failed`/`ran: true` so this cannot silently drift into the
  // `unavailable` path (which the spawn-failure and missing-Moon tests below
  // cover) — an assertion of `ran: false` here would be asserting the wrong
  // outcome for this fixture.
  it('reports a red verdict — not unavailable — when a required check fails', () => {
    const { runner } = scriptedRunner([
      { status: 0 },
      { status: 0 },
      { status: 1, output: 'error: Task not found "scripts:guard-whole-repo"' },
    ]);

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    expect(result.outcome).toBe('failed');
    expect(result.ran).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('not found');
  });

  it('reports a verdict of failed when :validate is red, carrying the diagnostics', () => {
    const diagnostics = 'client:lint | × useBlockStatements: Block statements are preferred.';
    const { runner } = scriptedRunner([
      { status: 0 },
      { status: 0 },
      { status: 0 },
      { status: 0 },
      { status: 0 },
      { status: 1, output: diagnostics },
    ]);

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    expect(result.ran).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.output).toBe(diagnostics);
  });

  it('correctly reports unavailable checks as not-ok (AC-4)', () => {
    // When the gate cannot run a required check but it's NOT a setup failure
    // (moon binary exists, base ref is valid), the result must be not-ok.
    const { runner } = scriptedRunner([
      { status: 0 },
      { status: 0 },
      { status: 1, output: 'client:typecheck | × TS2345: Type mismatch' },
    ]);

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    expect(result.ran).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('TS2345');
  });

  // 🔴 `:fix` exits non-zero on any lint rule it cannot auto-fix. That is not
  // a verdict — it is the normal precursor to :validate reporting it properly.
  // Treating it as one would block on problems that :validate then declares
  // green, and would skip the only step that actually produces diagnostics.
  it('does not treat a non-zero :fix as the verdict', () => {
    const { runner, calls } = scriptedRunner([
      { status: 1, output: 'unfixable' },
      ...Array.from({ length: 5 }, () => ({ status: 0 })),
    ]);

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    expect(result).toEqual({ outcome: 'passed', ran: true, ok: true, output: '' });
    expect(calls).toHaveLength(6);
  });

  // The contraction step is not a verdict either: it can legitimately refuse
  // (there is real growth to fix) and `:validate` reports that properly.
  it('does not treat a refusing contraction step as the verdict', () => {
    const { runner } = scriptedRunner([
      { status: 0 },
      { status: 0 },
      { status: 0 },
      { status: 0 },
      { status: 1, output: 'refused to contract' },
      { status: 0 },
    ]);

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    expect(result).toEqual({ outcome: 'passed', ran: true, ok: true, output: '' });
  });

  // 🔴 "The gate could not run" must never read as "the code is broken" — but
  // it also must never read as green. A missing moon binary yields
  // `unavailable`, which blocks promotion without blaming the code.
  it('returns unavailable — not green — when the step cannot be spawned', () => {
    const { runner, calls } = scriptedRunner([
      { status: null, output: 'ENOENT', spawnFailed: true },
    ]);

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    expect(result.outcome).toBe('unavailable');
    expect(result.ok).toBe(false);
    expect(result.ran).toBe(false);
    expect(result.output).toBe('ENOENT');
    // Bailed on the first step — never reached :validate.
    expect(calls).toHaveLength(1);
  });

  it('uses focused profile when specified (AC-2)', () => {
    const { runner, calls } = scriptedRunner([{ status: 0 }, { status: 0 }, { status: 0 }]);

    runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner, profile: 'focused' });

    const tasks = calls.map((call) => call.args[2]);
    expect(tasks).toEqual([':fix', ':typecheck', 'scripts:guard-contract', ':validate']);
    expect(tasks).not.toContain(':build');
    expect(tasks).not.toContain(':test');
  });

  it('treats a missing Moon command as unavailable rather than validation failure', () => {
    const { runner, calls } = scriptedRunner([
      { status: 1, output: 'error: Script not found "moon"' },
    ]);

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    expect(result.outcome).toBe('unavailable');
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('treats an invalid base reference as unavailable before returning a verdict', () => {
    const { runner, calls } = scriptedRunner([
      { status: 0 },
      {
        status: 1,
        output:
          "fatal: ambiguous argument 'origin/missing...HEAD': unknown revision or path not in the working tree.",
      },
    ]);

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/missing', runner });

    expect(result.outcome).toBe('unavailable');
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it('attributes a :validate failure to the specific constituent task that failed', () => {
    // The attribution list is derived from the guard registry, so this test
    // builds its scripted outcomes from the same source instead of hard-coding
    // a count that would silently drift when a guard is added.
    const constituents = validateConstituentTasks();
    const outcomes: { status: number | null; output?: string }[] = [
      { status: 0 }, // :fix
      { status: 0 }, // :typecheck
      { status: 0 }, // scripts:guard-whole-repo
      { status: 0 }, // scripts:guard-policy-diff
      { status: 0 }, // scripts:guard-contract
      { status: 1, output: 'opaque interleaved :validate blob' }, // :validate
    ];
    const failingTask = 'scripts:guard-type-safety';
    for (const { task } of constituents) {
      outcomes.push(
        task === failingTask
          ? { status: 1, output: '❌ T1 `as unknown as X` — 2 found, baseline allows 0' }
          : { status: 0 },
      );
    }

    const { runner, calls } = scriptedRunner(outcomes);
    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    expect(result.ran).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('Guard: type safety');
    expect(result.output).toContain('baseline allows 0');
    expect(result.output).not.toContain('opaque interleaved');
    expect(calls).toHaveLength(6 + constituents.length);

    // Every aggregate guard is re-run for attribution — including the ones the
    // old hand-written list forgot (orphaned-capability, test-boundary,
    // view-model-composition, source-file-size, cognitive-complexity).
    const rerunTasks = calls.slice(6).map((call) => call.args[2]);
    expect(rerunTasks).toEqual(constituents.map((entry) => entry.task));

    // A whole-repo guard is re-run WITHOUT --affected.
    const typeSafety = calls.find((call) => call.args[2] === failingTask);
    expect(typeSafety?.args).toEqual(['moon', 'run', failingTask]);
  });

  it('falls back to the raw :validate output when no constituent re-run reproduces the failure', () => {
    const diagnostics = 'flaky :validate failure that did not reproduce';
    const { runner } = scriptedRunner([
      { status: 0 },
      { status: 0 },
      { status: 0 },
      { status: 0 },
      { status: 0 },
      { status: 1, output: diagnostics },
      ...validateConstituentTasks().map(() => ({ status: 0 })),
    ]);

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    expect(result.ok).toBe(false);
    expect(result.output).toBe(diagnostics);
  });

  it('truncates oversized diagnostics so they cannot crowd out the review prompt', () => {
    const huge = 'x'.repeat(MAX_GATE_OUTPUT_CHARS * 3);
    const { runner } = scriptedRunner([
      { status: 0 },
      { status: 0 },
      { status: 0 },
      { status: 0 },
      { status: 0 },
      { status: 1, output: huge },
    ]);

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    expect(result.output.length).toBeLessThan(huge.length);
    expect(result.output).toContain('truncated');
  });
});

describe('formatGateNotesForPrompt', () => {
  it('is empty when the gate passed or was never recorded', () => {
    expect(formatGateNotesForPrompt(undefined)).toBe('');
    expect(formatGateNotesForPrompt({ outcome: 'passed', ran: true, ok: true, output: '' })).toBe(
      '',
    );
  });

  it('frames a failure as authorization-gated and includes the diagnostics', () => {
    const notes = formatGateNotesForPrompt({
      outcome: 'failed',
      ran: true,
      ok: false,
      output: 'hub:format | × src/lib/server/api/account_delete.ts',
    });

    expect(notes).toContain('authorization');
    expect(notes).toContain('account_delete.ts');
  });

  it('distinguishes unavailable from a code failure', () => {
    const notes = formatGateNotesForPrompt({
      outcome: 'unavailable',
      ran: false,
      ok: false,
      output: 'moon: command not found',
    });

    expect(notes).toContain('UNAVAILABLE');
    expect(notes).toContain('moon: command not found');
    expect(notes).not.toContain('FAILED');
  });
});
