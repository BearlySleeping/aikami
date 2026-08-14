// scripts/src/lib/agents/contract_pipeline/review_alarm.test.ts
import { describe, expect, it } from 'bun:test';
import { waitForFirstResponse } from './review_alarm.ts';

const noSleep = async (): Promise<void> => {};

/** Feed a scripted status sequence; the last value repeats forever. */
const scripted = (statuses: Array<string | undefined>) => {
  let index = 0;
  return async (): Promise<string | undefined> => {
    const value = statuses[Math.min(index, statuses.length - 1)];
    index++;
    return value;
  };
};

const alive = async (): Promise<boolean> => true;

const run = (
  statuses: Array<string | undefined>,
  overrides: Partial<Parameters<typeof waitForFirstResponse>[0]> = {},
) =>
  waitForFirstResponse({
    getStatus: scripted(statuses),
    isPaneAlive: alive,
    pollMs: 0,
    settleSamples: 3,
    timeoutMs: 60_000,
    sleepFn: noSleep,
    ...overrides,
  });

describe('waitForFirstResponse', () => {
  it('resolves once the agent works and then settles', async () => {
    expect(await run(['idle', 'working', 'working', 'idle', 'idle', 'idle'])).toBe('responded');
  });

  it('does not resolve on the pre-start idle alone', async () => {
    // Never leaves idle → the deadline is what ends it, not a false positive.
    expect(await run(['idle'], { timeoutMs: 1 })).toBe('timeout');
  });

  it('reports pane_gone when the tab closes before responding', async () => {
    let calls = 0;
    const outcome = await run(['working'], {
      isPaneAlive: async () => {
        calls++;
        return calls < 3;
      },
    });
    expect(outcome).toBe('pane_gone');
  });

  it('times out rather than hanging forever on a stuck agent', async () => {
    expect(await run(['working'], { timeoutMs: 1 })).toBe('timeout');
  });

  it('survives a throwing status probe', async () => {
    let calls = 0;
    const outcome = await run([], {
      getStatus: async () => {
        calls++;
        if (calls < 3) {
          throw new Error('herdr socket closed');
        }
        return calls < 6 ? 'working' : 'idle';
      },
    });
    expect(outcome).toBe('responded');
  });

  it('stops polling once cancelled', async () => {
    let probes = 0;
    const outcome = await run([], {
      getStatus: async () => {
        probes++;
        return 'working';
      },
      isCancelled: () => probes >= 3,
    });
    expect(outcome).toBe('cancelled');
    expect(probes).toBe(3);
  });

  it('survives a throwing liveness probe by assuming alive', async () => {
    const outcome = await run(['working', 'working', 'idle', 'idle', 'idle'], {
      isPaneAlive: async () => {
        throw new Error('socket closed');
      },
    });
    expect(outcome).toBe('responded');
  });
});
