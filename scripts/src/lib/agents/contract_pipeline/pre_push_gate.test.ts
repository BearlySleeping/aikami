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
  it('runs :fix then :validate against the given base and passes when validate is green', () => {
    const { runner, calls } = scriptedRunner([{ status: 0 }, { status: 0 }]);

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    expect(result).toEqual({ ran: true, ok: true, output: '' });
    expect(calls).toHaveLength(2);
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
      ':validate',
      '--affected',
      '--base=origin/main',
    ]);
    expect(calls[0]?.cwd).toBe('/tmp/wt');
  });

  it('reports a verdict of failed when :validate is red, carrying the diagnostics', () => {
    const diagnostics = 'client:lint | × useBlockStatements: Block statements are preferred.';
    const { runner } = scriptedRunner([{ status: 0 }, { status: 1, output: diagnostics }]);

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    expect(result.ran).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.output).toBe(diagnostics);
  });

  // 🔴 `:fix` exits non-zero on any lint rule it cannot auto-fix. That is not
  // a verdict — it is the normal precursor to :validate reporting it properly.
  // Treating it as one would block on problems that :validate then declares
  // green, and would skip the only step that actually produces diagnostics.
  it('does not treat a non-zero :fix as the verdict', () => {
    const { runner, calls } = scriptedRunner([{ status: 1, output: 'unfixable' }, { status: 0 }]);

    const result = runPrePushGate({ cwd: '/tmp/wt', base: 'origin/main', runner });

    expect(result).toEqual({ ran: true, ok: true, output: '' });
    expect(calls).toHaveLength(2);
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

  it('truncates oversized diagnostics so they cannot crowd out the review prompt', () => {
    const huge = 'x'.repeat(MAX_GATE_OUTPUT_CHARS * 3);
    const { runner } = scriptedRunner([{ status: 0 }, { status: 1, output: huge }]);

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

  it('frames a failure as must-fix-before-PR and includes the diagnostics', () => {
    const notes = formatGateNotesForPrompt({
      ran: true,
      ok: false,
      output: 'hub:format | × src/lib/server/api/account_delete.ts',
    });

    expect(notes).toContain('fix before opening the PR');
    expect(notes).toContain('account_delete.ts');
  });
});
