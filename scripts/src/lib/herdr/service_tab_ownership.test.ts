// scripts/src/lib/herdr/service_tab_ownership.test.ts

import { describe, expect, test } from 'bun:test';
import type { InstanceRecord, ProcessInspector } from './instance_registry.ts';
import { assertServiceTabOwnership } from './service_tab_ownership.ts';

const expected = { service: 'client', checkout: '/owned-checkout', runId: 'owned-run' };
const record: InstanceRecord = {
  ...expected,
  scope: 'run',
  pid: 1234,
  pidStartTimeMs: 10_000,
  startedAt: '2026-10-04T00:00:00.000Z',
};
const inspector: ProcessInspector = {
  startTimeMs: async () => record.pidStartTimeMs,
  cwd: async () => undefined,
};

const attemptTabAction = async (options: {
  records?: readonly InstanceRecord[];
  panePids?: readonly number[];
  unresolvedPane?: boolean;
  processInspector?: ProcessInspector;
}) => {
  let actions = 0;
  try {
    await assertServiceTabOwnership({
      expected,
      panePids: options.panePids ?? [record.pid],
      unresolvedPane: options.unresolvedPane,
      records: options.records ?? [record],
      inspector: options.processInspector ?? inspector,
    });
    actions++;
  } catch {
    // This models the destructive operation after the guard, not its error text.
  }
  return actions;
};

describe('service tab ownership before destructive actions', () => {
  test('permits the proved-owned foreground process even when cwd is unavailable', async () => {
    expect(await attemptTabAction({})).toBe(1);
  });

  test.each([
    { records: [{ ...record, checkout: '/another-captain' }] },
    { records: [{ ...record, runId: 'another-run' }] },
    { records: [{ ...record, service: 'hub' }] },
    { records: [{ ...record, scope: 'shared' as const }] },
    { records: [{ ...record, scope: 'external' as const }] },
    { records: [] },
    { panePids: [] },
    { panePids: [record.pid], unresolvedPane: true },
    { panePids: [record.pid, 9999] },
    { processInspector: { ...inspector, startTimeMs: async () => undefined } },
    { processInspector: { ...inspector, startTimeMs: async () => 20_000 } },
  ])('never reaches tab closure or pane restart with unproved evidence %#', async (options) => {
    expect(await attemptTabAction(options)).toBe(0);
  });

  test('refuses PID recycling between initial verification and the action boundary', async () => {
    let reads = 0;
    expect(
      await attemptTabAction({
        processInspector: {
          ...inspector,
          startTimeMs: async () => (++reads === 1 ? 10_000 : 20_000),
        },
      }),
    ).toBe(0);
    expect(reads).toBe(2);
  });

  test('an ad-hoc captain cannot claim a pipeline-owned process by omitting runId', async () => {
    await expect(
      assertServiceTabOwnership({
        expected: { service: expected.service, checkout: expected.checkout },
        panePids: [record.pid],
        records: [record],
        inspector,
      }),
    ).rejects.toThrow('another run');
  });
});
