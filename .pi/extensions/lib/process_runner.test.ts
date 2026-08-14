import { describe, expect, test } from 'bun:test';
import { runCommand, runSync, runSyncOrThrow, startCommand } from './process_runner.ts';

describe('runCommand', () => {
  test('captures stdout and a zero exit code', async () => {
    const result = await runCommand('echo', ['hello']);
    expect(result.stdout).toBe('hello');
    expect(result.code).toBe(0);
    expect(result.killed).toBe(false);
  });

  test('captures stderr and a non-zero exit code', async () => {
    const result = await runCommand('sh', ['-c', 'echo oops >&2; exit 3']);
    expect(result.stderr).toContain('oops');
    expect(result.code).toBe(3);
  });

  test('reports a duration', async () => {
    const result = await runCommand('true');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('kills the process tree on timeout rather than hanging', async () => {
    const result = await runCommand('sleep', ['30'], { timeoutMs: 300 });
    expect(result.killed).toBe(true);
    expect(result.stderr).toContain('timed out');
  });

  test('does not deadlock on a child that never reads stdin', async () => {
    // stdin is closed immediately; a tool waiting for input must exit, not hang.
    const result = await runCommand('cat', [], { timeoutMs: 5000 });
    expect(result.killed).toBe(false);
    expect(result.code).toBe(0);
  });

  test('honours an already-aborted signal', async () => {
    const result = await runCommand('sleep', ['30'], {
      signal: AbortSignal.abort(),
      timeoutMs: 10_000,
    });
    expect(result.killed).toBe(true);
  });

  test('aborts mid-flight when the signal fires', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const result = await runCommand('sleep', ['30'], {
      signal: controller.signal,
      timeoutMs: 30_000,
    });
    expect(result.killed).toBe(true);
    expect(result.stderr).toContain('cancelled');
  });

  test('resolves rather than throwing for a missing binary', async () => {
    const result = await runCommand('definitely-not-a-real-binary-xyz');
    expect(result.code).toBeNull();
    expect(result.stderr).toContain('Failed to start process');
  });

  test('injects CI env guards', async () => {
    const result = await runCommand('sh', ['-c', 'echo "$CI:$GIT_TERMINAL_PROMPT"']);
    expect(result.stdout).toBe('true:0');
  });

  test('merges caller env on top of the defaults', async () => {
    const result = await runCommand('sh', ['-c', 'echo "$MY_VAR"'], {
      env: { MY_VAR: 'set' },
    });
    expect(result.stdout).toBe('set');
  });

  test('runs in the requested cwd', async () => {
    const result = await runCommand('pwd', [], { cwd: '/tmp' });
    expect(result.stdout).toContain('tmp');
  });
});

describe('startCommand', () => {
  test('exposes output incrementally while the process runs', async () => {
    const handle = startCommand('sh', ['-c', 'echo first; sleep 0.4; echo second'], {
      timeoutMs: 10_000,
    });

    // Give the first write time to land, but finish well before the second.
    await new Promise((r) => setTimeout(r, 200));
    const early = handle.output();
    expect(early).toContain('first');
    expect(early).not.toContain('second');
    expect(handle.running()).toBe(true);
    expect(handle.exitCode()).toBeUndefined();

    const result = await handle.completion;
    expect(result.stdout).toContain('second');
    expect(handle.running()).toBe(false);
    expect(handle.exitCode()).toBe(0);
  });

  test('interleaves stdout and stderr into output()', async () => {
    const handle = startCommand('sh', ['-c', 'echo out; echo err >&2']);
    await handle.completion;
    expect(handle.output()).toContain('out');
    expect(handle.output()).toContain('err');
    expect(handle.stdout()).toContain('out');
    expect(handle.stderr()).toContain('err');
  });

  test('exposes a pid', () => {
    const handle = startCommand('true');
    expect(typeof handle.pid).toBe('number');
  });

  test('kill() terminates a long-running process', async () => {
    const handle = startCommand('sleep', ['30'], { timeoutMs: 30_000 });
    await new Promise((r) => setTimeout(r, 100));
    handle.kill();
    const result = await handle.completion;
    expect(result.killed).toBe(true);
    expect(handle.running()).toBe(false);
  });

  test('kill(true) force-kills a process ignoring SIGTERM', async () => {
    const handle = startCommand('sh', ['-c', 'trap "" TERM; sleep 30'], { timeoutMs: 30_000 });
    await new Promise((r) => setTimeout(r, 200));
    handle.kill(true);
    const result = await handle.completion;
    expect(result.code).toBeNull();
    expect(handle.running()).toBe(false);
  });

  test('kills the whole process group, not just the direct child', async () => {
    // The child backgrounds a grandchild and exits-by-signal; killing the
    // group must reap both. If only the direct child died, the grandchild
    // would hold the pipe open and completion would hang until timeout.
    const handle = startCommand('sh', ['-c', 'sleep 30 & sleep 30'], { timeoutMs: 2000 });
    const result = await handle.completion;
    expect(result.killed).toBe(true);
    expect(result.durationMs).toBeLessThan(6000);
  });
});

describe('runSync', () => {
  test('returns stdout and exit code', () => {
    const result = runSync('echo', ['sync']);
    expect(result.stdout).toBe('sync');
    expect(result.code).toBe(0);
  });

  test('reports a non-zero exit code without throwing', () => {
    expect(runSync('false').code).toBe(1);
  });
});

describe('runSyncOrThrow', () => {
  test('returns trimmed stdout on success', () => {
    expect(runSyncOrThrow('echo', ['ok'])).toBe('ok');
  });

  test('throws on a non-zero exit code', () => {
    expect(() => runSyncOrThrow('sh', ['-c', 'echo bad >&2; exit 2'])).toThrow(/exit 2/);
  });
});
