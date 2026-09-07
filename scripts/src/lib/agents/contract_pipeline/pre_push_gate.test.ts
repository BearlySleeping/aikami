// scripts/src/lib/agents/contract_pipeline/pre_push_gate.test.ts
import { describe, expect, it } from 'bun:test';
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
    const { runner, calls } = scriptedRunner([{ status: 0 }, { status: 0 }, { status: 0 }]);

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    expect(result).toEqual({ ran: true, ok: true, output: '' });
    expect(calls).toHaveLength(3);
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
    expect(calls[2]?.args).toEqual([
      'moon',
      'run',
      ':validate',
      '--affected',
      '--base=origin/main',
    ]);
    expect(calls[0]?.cwd).toBe('/tmp/wt');
  });

  it('runs every required CI profile task (AC-2)', () => {
    const { runner, calls } = scriptedRunner([
      { status: 0 },
      { status: 0 },
      { status: 0 },
      { status: 0 },
      { status: 0 },
    ]);

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner, profile: 'ci' });

    expect(result).toEqual({ ran: true, ok: true, output: '' });
    const tasks = calls.map((call) => call.args[2]);
    expect(tasks).toContain(':build');
    expect(tasks).toContain(':test');
  });

  it('returns unavailable when a required check cannot be executed (AC-4)', () => {
    const { runner } = scriptedRunner([
      { status: 0 },
      { status: 0 },
      { status: 1, output: 'error: Task not found ":validate"' },
    ]);

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    expect(result.ran).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('not found');
  });

  it('reports a verdict of failed when :validate is red, carrying the diagnostics', () => {
    const diagnostics = 'client:lint | × useBlockStatements: Block statements are preferred.';
    const { runner } = scriptedRunner([
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
      { status: 0 },
      { status: 0 },
    ]);

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    expect(result).toEqual({ ran: true, ok: true, output: '' });
    expect(calls).toHaveLength(3);
  });

  // 🔴 "The gate could not run" must never read as "the code is broken" — a
  // missing moon binary would otherwise send the review captain hunting for
  // lint errors that do not exist, and could block a run over infrastructure.
  it('returns ran=false, ok=true when the step cannot be spawned', () => {
    const { runner, calls } = scriptedRunner([
      { status: null, output: 'ENOENT', spawnFailed: true },
    ]);

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    expect(result).toEqual({ ran: false, ok: true, output: '' });
    // Bailed on the first step — never reached :validate.
    expect(calls).toHaveLength(1);
  });

  it('uses focused profile when specified (AC-2)', () => {
    const { runner, calls } = scriptedRunner([{ status: 0 }, { status: 0 }, { status: 0 }]);

    runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner, profile: 'focused' });

    const tasks = calls.map((call) => call.args[2]);
    expect(tasks).toEqual([':fix', ':typecheck', ':validate']);
    expect(tasks).not.toContain(':build');
    expect(tasks).not.toContain(':test');
  });

  it('treats a missing Moon command as infrastructure rather than validation failure', () => {
    const { runner, calls } = scriptedRunner([
      { status: 1, output: 'error: Script not found "moon"' },
    ]);

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    expect(result).toEqual({ ran: false, ok: true, output: '' });
    expect(calls).toHaveLength(1);
  });

  it('treats an invalid base reference as infrastructure before returning a verdict', () => {
    const { runner, calls } = scriptedRunner([
      { status: 0 },
      {
        status: 1,
        output:
          "fatal: ambiguous argument 'origin/missing...HEAD': unknown revision or path not in the working tree.",
      },
    ]);

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/missing', runner });

    expect(result).toEqual({ ran: false, ok: true, output: '' });
    expect(calls).toHaveLength(2);
  });

  it('attributes a :validate failure to the specific constituent task that failed', () => {
    // fix, typecheck, :validate (red) — then the attribution re-runs every
    // constituent task; only guard-type-safety is scripted to fail.
    const outcomes: { status: number | null; output?: string }[] = [
      { status: 0 }, // :fix
      { status: 0 }, // :typecheck
      { status: 1, output: 'opaque interleaved :validate blob' }, // :validate
    ];
    // :lint, :format, :typecheck, guard-mvvm, guard-service, guard-mock,
    // guard-image, guard-data-plane → all pass.
    for (let i = 0; i < 8; i++) {
      outcomes.push({ status: 0 });
    }
    outcomes.push({ status: 1, output: '❌ T1 `as unknown as X` — 2 found, baseline allows 0' }); // guard-type-safety
    outcomes.push({ status: 0 }); // validate-agent-guidance

    const { runner, calls } = scriptedRunner(outcomes);
    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    expect(result.ran).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('Guard: type safety');
    expect(result.output).toContain('baseline allows 0');
    expect(result.output).not.toContain('opaque interleaved');
    // fix + typecheck + validate (3) + 10 constituent re-runs.
    expect(calls).toHaveLength(13);
    expect(calls.at(-3)?.args).toEqual([
      'moon',
      'run',
      'scripts:guard-data-plane',
      '--affected',
      '--base=origin/main',
    ]);
    expect(calls.at(-2)?.args).toEqual([
      'moon',
      'run',
      'scripts:guard-type-safety',
      '--affected',
      '--base=origin/main',
    ]);
  });

  it('falls back to the raw :validate output when no constituent re-run reproduces the failure', () => {
    const diagnostics = 'flaky :validate failure that did not reproduce';
    const { runner } = scriptedRunner([
      { status: 0 },
      { status: 0 },
      { status: 1, output: diagnostics },
    ]);

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    expect(result.ok).toBe(false);
    expect(result.output).toBe(diagnostics);
  });

  it('truncates oversized diagnostics so they cannot crowd out the review prompt', () => {
    const huge = 'x'.repeat(MAX_GATE_OUTPUT_CHARS * 3);
    const { runner } = scriptedRunner([{ status: 0 }, { status: 0 }, { status: 1, output: huge }]);

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    expect(result.output.length).toBeLessThan(huge.length);
    expect(result.output).toContain('truncated');
  });
});

describe('formatGateNotesForPrompt', () => {
  it('is empty when the gate passed, never ran, or was never recorded', () => {
    expect(formatGateNotesForPrompt(undefined)).toBe('');
    expect(formatGateNotesForPrompt({ ran: true, ok: true, output: '' })).toBe('');
    expect(formatGateNotesForPrompt({ ran: false, ok: true, output: '' })).toBe('');
  });

  it('frames a failure as permission-gated and includes the diagnostics', () => {
    const notes = formatGateNotesForPrompt({
      ran: true,
      ok: false,
      output: 'hub:format | × src/lib/server/api/account_delete.ts',
    });

    expect(notes).toContain('explicit permission');
    expect(notes).toContain('account_delete.ts');
  });
});
