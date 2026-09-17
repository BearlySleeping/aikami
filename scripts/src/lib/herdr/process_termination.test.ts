// scripts/src/lib/herdr/process_termination.test.ts
//
// 🔴 These tests inspect the SIGNAL BOUNDARY, not a high-level boolean: the
// assertion is on whether the injected signaller ran. Each one fails if the
// creation-identity recheck is dropped from `terminateValidatedProcess`, which
// is exactly the regression the TOCTOU fix exists to prevent.

import { describe, expect, it } from 'bun:test';
import type { ProcessInspector, ValidatedProcessIdentity } from './instance_registry.ts';
import { terminateValidatedProcess } from './process_termination.ts';

const START = 1_700_000_000_000;
const RECYCLED = START + 900_000;
const IDENTITY: ValidatedProcessIdentity = { pid: 4242, pidStartTimeMs: START };

/** Inspector that answers each successive read from `reads`, repeating the last. */
const inspectorReading = (reads: (number | undefined)[]): ProcessInspector => {
  let index = 0;
  return {
    startTimeMs: async () => {
      const value = reads[Math.min(index, reads.length - 1)];
      index += 1;
      return value;
    },
    cwd: async () => undefined,
  };
};

/** Signal spy: records every PID the boundary actually signals. */
const spySignaller =
  (signalled: number[], outcome = true) =>
  async (pid: number) => {
    signalled.push(pid);
    return outcome;
  };

describe('terminateValidatedProcess', () => {
  // A. PID reused before termination. The identity was validated as `START`;
  // by the time the boundary looks, the number belongs to a different process.
  it('does not signal a PID that was recycled before termination', async () => {
    const signalled: number[] = [];

    const result = await terminateValidatedProcess({
      identity: IDENTITY,
      inspector: inspectorReading([RECYCLED]),
      signal: spySignaller(signalled),
    });

    expect(signalled).toEqual([]);
    expect(result).toEqual({
      terminated: false,
      reason: 'identity_changed',
      liveStartTimeMs: RECYCLED,
    });
  });

  // B. Identity stable. The signal runs exactly once, on the validated PID.
  it('signals exactly once when the validated identity still holds', async () => {
    const signalled: number[] = [];

    const result = await terminateValidatedProcess({
      identity: IDENTITY,
      inspector: inspectorReading([START]),
      signal: spySignaller(signalled),
    });

    expect(signalled).toEqual([IDENTITY.pid]);
    expect(result).toEqual({ terminated: true });
  });

  // C. Escalation / retry. There is no second signal anywhere in this pipeline
  // today, and this pins the property that makes adding one safe: the check is
  // per-SIGNAL, not per-cleanup, so a second attempt against a recycled PID is
  // refused even though the first attempt succeeded.
  it('refuses a second signal once the identity has changed', async () => {
    const signalled: number[] = [];
    const inspector = inspectorReading([START, RECYCLED]);
    const signal = spySignaller(signalled);

    const first = await terminateValidatedProcess({ identity: IDENTITY, inspector, signal });
    const second = await terminateValidatedProcess({ identity: IDENTITY, inspector, signal });

    expect(first).toEqual({ terminated: true });
    expect(second.terminated).toBe(false);
    // The decisive assertion: one signal total, never a second one.
    expect(signalled).toEqual([IDENTITY.pid]);
  });

  it('does not signal when the creation identity can no longer be read', async () => {
    const signalled: number[] = [];

    const result = await terminateValidatedProcess({
      identity: IDENTITY,
      inspector: inspectorReading([undefined]),
      signal: spySignaller(signalled),
    });

    expect(signalled).toEqual([]);
    expect(result).toEqual({ terminated: false, reason: 'identity_unknown' });
  });

  it('reports a failed signal without claiming termination', async () => {
    const signalled: number[] = [];

    const result = await terminateValidatedProcess({
      identity: IDENTITY,
      inspector: inspectorReading([START]),
      signal: spySignaller(signalled, false),
    });

    expect(signalled).toEqual([IDENTITY.pid]);
    expect(result).toEqual({ terminated: false, reason: 'signal_failed' });
  });

  // The registry's tolerance is part of the boundary's contract: a start time
  // read back a moment later is never bit-identical, so an exact comparison
  // would refuse to signal every process we do own.
  it('tolerates the platform jitter in a re-read start time', async () => {
    const signalled: number[] = [];

    const result = await terminateValidatedProcess({
      identity: IDENTITY,
      inspector: inspectorReading([START + 1_500]),
      signal: spySignaller(signalled),
    });

    expect(signalled).toEqual([IDENTITY.pid]);
    expect(result).toEqual({ terminated: true });
  });
});
