// scripts/src/lib/agents/subagents/__tests__/pane_completion.test.ts

import { describe, expect, spyOn, test } from 'bun:test';
import { logger } from '$logger';
import { completionPaneArgs, settleSubagentPane } from '../pane_completion.ts';

describe('quiet subagent completion', () => {
  test('default and legacy specs release our own hook without an idle/Done report', () => {
    const args = completionPaneArgs({ paneId: 'owned:p1', message: 'succeeded' });
    expect(args).toEqual([
      'pane',
      'release-agent',
      'owned:p1',
      '--source',
      'aikami-subagent',
      '--agent',
      'pi',
    ]);
    expect(args).not.toContain('report-agent');
    expect(args).not.toContain('idle');
  });

  test('explicit alert opt-in preserves the old completion report', () => {
    const args = completionPaneArgs({ paneId: 'owned:p1', message: 'failed', alerts: true });
    expect(args).toContain('report-agent');
    expect(args).toContain('idle');
    expect(args).toContain('failed');
    expect(args).not.toContain('release-agent');
  });

  test('awaits the release command before completion cleanup returns', async () => {
    let released = false;
    let permitRelease: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      permitRelease = resolve;
    });
    const completion = settleSubagentPane({
      paneId: 'owned:p1',
      message: 'succeeded',
      runHerdr: async (args) => {
        expect(args[1]).toBe('release-agent');
        await gate;
        released = true;
        return { code: 0, stderr: '' };
      },
    });
    expect(released).toBe(false);
    permitRelease?.();
    await completion;
    expect(released).toBe(true);
  });

  test('a release error never falls back to noisy idle reporting', async () => {
    const commands: string[][] = [];
    await settleSubagentPane({
      paneId: 'owned:p1',
      message: 'failed',
      runHerdr: async (args) => {
        commands.push(args);
        throw new Error('Herdr unavailable');
      },
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]?.[1]).toBe('release-agent');
  });

  test('detached agents have no pane command to send', async () => {
    let calls = 0;
    await settleSubagentPane({
      message: 'succeeded',
      runHerdr: async () => {
        calls++;
        return { code: 0, stderr: '' };
      },
    });
    expect(calls).toBe(0);
  });
});

test('nonzero release exits are diagnosed and never settle or report idle', async () => {
  const warn = spyOn(logger, 'warn').mockImplementation(() => {});
  const commands: string[][] = [];
  try {
    const settled = await settleSubagentPane({
      paneId: 'owned:p1',
      message: 'succeeded',
      runHerdr: async (args) => {
        commands.push(args);
        return { code: 1, stderr: 'release rejected' };
      },
    });
    expect(settled).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe('Subagent pane settlement failed');
    expect(commands).toHaveLength(1);
    expect(commands[0]?.[1]).toBe('release-agent');
  } finally {
    warn.mockRestore();
  }
});
