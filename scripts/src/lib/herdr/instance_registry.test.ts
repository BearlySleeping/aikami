// scripts/src/lib/herdr/instance_registry.test.ts
//
// C-471 AC-1 / brief P0: process ownership must be PROVEN, not inferred from
// an executable name. These tests exercise the registry directly with an
// injected process inspector, so no real processes are ever inspected or
// killed.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearInstance,
  type InstanceRecord,
  ownedInstanceOnPort,
  type ProcessInspector,
  readInstanceRecords,
  recordInstance,
  verifyOwnership,
} from './instance_registry.ts';

const CHECKOUT = '/home/dev/.herdr/worktrees/aikami/contract-task-c-471';
const OTHER_CHECKOUT = '/repo/main';
const START = 1_700_000_000_000;

/** A record for a live process, parameterised for each test. */
const recordFor = (overrides: Partial<InstanceRecord> = {}): InstanceRecord => ({
  service: 'client',
  scope: 'run',
  runId: 'C-471',
  checkout: CHECKOUT,
  pid: 4242,
  pidStartTimeMs: START,
  port: 5274,
  startedAt: '2026-09-16T00:00:00Z',
  ...overrides,
});

/** Inspector that reports fixed live facts per PID. */
const inspectorFor = (
  facts: Record<number, { startTimeMs?: number; cwd?: string }>,
): ProcessInspector => ({
  startTimeMs: async (pid) => facts[pid]?.startTimeMs,
  cwd: async (pid) => facts[pid]?.cwd,
});

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'instances-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('recordInstance / readInstanceRecords', () => {
  it('round-trips a record through the registry directory', () => {
    recordInstance({ record: recordFor(), dir });

    const records = readInstanceRecords({ dir });
    expect(records).toHaveLength(1);
    expect(records[0]?.pid).toBe(4242);
    expect(records[0]?.service).toBe('client');
    expect(records[0]?.checkout).toBe(CHECKOUT);
  });

  it('clears a record', () => {
    recordInstance({ record: recordFor(), dir });
    clearInstance({ service: 'client', pid: 4242, dir });
    expect(readInstanceRecords({ dir })).toHaveLength(0);
  });

  it('ignores malformed record files', () => {
    const badPath = join(dir, 'broken.json');
    recordInstance({ record: recordFor(), dir });
    writeFileSync(badPath, '{not json');
    expect(readInstanceRecords({ dir })).toHaveLength(1);
  });
});

describe('verifyOwnership — a foreign process is never owned', () => {
  it('rejects a PID with no record at all (foreign Node/Python)', async () => {
    const verdict = await verifyOwnership({
      pid: 9999,
      records: [recordFor()],
      inspector: inspectorFor({ 9999: { startTimeMs: START + 5000 } }),
    });
    expect(verdict.owned).toBe(false);
    if (!verdict.owned) {
      expect(verdict.reason).toBe('no_record');
    }
  });
});

describe('verifyOwnership — PID reuse guard', () => {
  it('accepts the same process with matching creation identity', async () => {
    const verdict = await verifyOwnership({
      pid: 4242,
      expected: { service: 'client', runId: 'C-471', checkout: CHECKOUT },
      records: [recordFor()],
      inspector: inspectorFor({ 4242: { startTimeMs: START } }),
    });
    expect(verdict.owned).toBe(true);
  });

  it('rejects a record whose PID has been reused by a different process', async () => {
    const verdict = await verifyOwnership({
      pid: 4242,
      expected: { service: 'client', runId: 'C-471', checkout: CHECKOUT },
      records: [recordFor()],
      // Same PID, very different start time → a recycled PID.
      inspector: inspectorFor({ 4242: { startTimeMs: START + 600_000 } }),
    });
    expect(verdict.owned).toBe(false);
    if (!verdict.owned) {
      expect(verdict.reason).toBe('pid_reused');
    }
  });

  it('rejects when creation identity cannot be verified', async () => {
    const verdict = await verifyOwnership({
      pid: 4242,
      records: [recordFor()],
      inspector: inspectorFor({ 4242: {} }),
    });
    expect(verdict.owned).toBe(false);
    if (!verdict.owned) {
      expect(verdict.reason).toBe('pid_start_time_unknown');
    }
  });
});

describe('verifyOwnership — identity fields must match', () => {
  it('rejects a record for a different service', async () => {
    const verdict = await verifyOwnership({
      pid: 4242,
      expected: { service: 'hub' },
      records: [recordFor({ service: 'client' })],
      inspector: inspectorFor({ 4242: { startTimeMs: START } }),
    });
    expect(verdict.owned).toBe(false);
    if (!verdict.owned) {
      expect(verdict.reason).toBe('record_has_wrong_service');
    }
  });

  it('rejects a record for a different run', async () => {
    const verdict = await verifyOwnership({
      pid: 4242,
      expected: { runId: 'C-999' },
      records: [recordFor({ runId: 'C-471' })],
      inspector: inspectorFor({ 4242: { startTimeMs: START } }),
    });
    expect(verdict.owned).toBe(false);
    if (!verdict.owned) {
      expect(verdict.reason).toBe('record_has_wrong_run');
    }
  });

  it('rejects a record for a different checkout', async () => {
    const verdict = await verifyOwnership({
      pid: 4242,
      expected: { checkout: OTHER_CHECKOUT },
      records: [recordFor({ checkout: CHECKOUT })],
      inspector: inspectorFor({ 4242: { startTimeMs: START } }),
    });
    expect(verdict.owned).toBe(false);
    if (!verdict.owned) {
      expect(verdict.reason).toBe('record_has_wrong_checkout');
    }
  });
});

describe('ownedInstanceOnPort', () => {
  it('finds the owned PID among several listeners', async () => {
    const result = await ownedInstanceOnPort({
      port: 5274,
      pids: [1111, 4242],
      expected: { service: 'client', runId: 'C-471', checkout: CHECKOUT },
      records: [recordFor()],
      inspector: inspectorFor({
        1111: { startTimeMs: START + 1 }, // foreign — no record
        4242: { startTimeMs: START },
      }),
    });
    expect(result?.pid).toBe(4242);
    expect(result?.record.service).toBe('client');
  });

  it('returns undefined when every listener is foreign', async () => {
    const result = await ownedInstanceOnPort({
      port: 5274,
      pids: [1111, 2222],
      expected: { service: 'client' },
      records: [recordFor()],
      inspector: inspectorFor({
        1111: { startTimeMs: START },
        2222: { startTimeMs: START + 1 },
      }),
    });
    expect(result).toBeUndefined();
  });
});
