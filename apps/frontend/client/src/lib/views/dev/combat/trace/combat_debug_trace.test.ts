// apps/frontend/client/src/lib/views/dev/combat/trace/combat_debug_trace.test.ts
//
// Unit tests for the bounded trace buffer: monotonic sequence ordering,
// oldest-first drop at capacity with a dropped count, payload truncation,
// clear() reset and non-mutating filter().
//
// Contract: combat debug workspace (execution prompt §7, §8)
import { describe, expect, test } from 'bun:test';
import { type CombatDebugTraceAppend, CombatDebugTraceBuffer } from './combat_debug_trace.ts';

const entry = (overrides: Partial<CombatDebugTraceAppend> = {}): CombatDebugTraceAppend => ({
  kind: 'event',
  revision: 1,
  turnLabel: 'r1:player',
  actorId: 'player',
  commandId: undefined,
  summary: 'something happened',
  payload: undefined,
  ...overrides,
});

describe('CombatDebugTraceBuffer ordering', () => {
  test('assigns a monotonically increasing sequence', () => {
    const buffer = new CombatDebugTraceBuffer();
    buffer.append(entry({ summary: 'first' }));
    buffer.append(entry({ summary: 'second' }));
    buffer.append(entry({ summary: 'third' }));

    const { entries, nextSequence } = buffer.snapshot();
    expect(entries.map((item) => item.sequence)).toEqual([0, 1, 2]);
    expect(nextSequence).toBe(3);
    for (let index = 1; index < entries.length; index++) {
      expect(entries[index]?.sequence).toBeGreaterThan(entries[index - 1]?.sequence ?? -1);
    }
  });

  test('returns the stored entry from append', () => {
    const buffer = new CombatDebugTraceBuffer();
    const stored = buffer.append(entry({ summary: 'hello' }));
    expect(stored.summary).toBe('hello');
    expect(stored.sequence).toBe(0);
    expect(stored.payloadTruncated).toBe(false);
    expect(typeof stored.recordedAt).toBe('number');
  });
});

describe('CombatDebugTraceBuffer capacity', () => {
  test('drops the oldest entries at capacity and increments droppedCount', () => {
    const buffer = new CombatDebugTraceBuffer({ maxEntries: 3 });
    for (let index = 0; index < 5; index++) {
      buffer.append(entry({ summary: `entry-${index}` }));
    }

    const { entries, droppedCount, nextSequence } = buffer.snapshot();
    expect(entries).toHaveLength(3);
    expect(entries.map((item) => item.summary)).toEqual(['entry-2', 'entry-3', 'entry-4']);
    expect(entries.map((item) => item.sequence)).toEqual([2, 3, 4]);
    expect(droppedCount).toBe(2);
    expect(nextSequence).toBe(5);
  });

  test('never grows past the configured capacity across many appends', () => {
    const buffer = new CombatDebugTraceBuffer({ maxEntries: 2 });
    for (let index = 0; index < 100; index++) {
      buffer.append(entry({ summary: `entry-${index}` }));
    }
    const { entries, droppedCount } = buffer.snapshot();
    expect(entries).toHaveLength(2);
    expect(droppedCount).toBe(98);
  });
});

describe('CombatDebugTraceBuffer payload truncation', () => {
  test('truncates an oversized payload and flags payloadTruncated', () => {
    const buffer = new CombatDebugTraceBuffer({ maxPayloadChars: 5 });
    const stored = buffer.append(entry({ payload: 'abcdefghij' }));
    expect(stored.payload).toBe('abcde');
    expect(stored.payloadTruncated).toBe(true);
  });

  test('keeps a payload exactly at the budget without flagging', () => {
    const buffer = new CombatDebugTraceBuffer({ maxPayloadChars: 5 });
    const stored = buffer.append(entry({ payload: 'abcde' }));
    expect(stored.payload).toBe('abcde');
    expect(stored.payloadTruncated).toBe(false);
  });

  test('leaves an undefined payload untouched', () => {
    const buffer = new CombatDebugTraceBuffer({ maxPayloadChars: 5 });
    const stored = buffer.append(entry({ payload: undefined }));
    expect(stored.payload).toBeUndefined();
    expect(stored.payloadTruncated).toBe(false);
  });
});

describe('CombatDebugTraceBuffer clear', () => {
  test('resets entries and counters', () => {
    const buffer = new CombatDebugTraceBuffer({ maxEntries: 1 });
    buffer.append(entry());
    buffer.append(entry());
    expect(buffer.snapshot().droppedCount).toBe(1);

    buffer.clear();
    const snapshot = buffer.snapshot();
    expect(snapshot.entries).toEqual([]);
    expect(snapshot.droppedCount).toBe(0);
    expect(snapshot.nextSequence).toBe(0);

    const stored = buffer.append(entry({ summary: 'after-clear' }));
    expect(stored.sequence).toBe(0);
  });
});

describe('CombatDebugTraceBuffer filter', () => {
  test('filters by kind, actor and minimum revision', () => {
    const buffer = new CombatDebugTraceBuffer();
    buffer.append(entry({ kind: 'request', actorId: 'player', revision: 1, summary: 'a' }));
    buffer.append(entry({ kind: 'accepted', actorId: 'player', revision: 2, summary: 'b' }));
    buffer.append(entry({ kind: 'event', actorId: 'goblin', revision: 3, summary: 'c' }));

    expect(buffer.filter({ kind: 'request' }).map((item) => item.summary)).toEqual(['a']);
    expect(buffer.filter({ actorId: 'player' }).map((item) => item.summary)).toEqual(['a', 'b']);
    expect(buffer.filter({ minRevision: 2 }).map((item) => item.summary)).toEqual(['b', 'c']);
    expect(
      buffer
        .filter({ kind: 'accepted', actorId: 'player', minRevision: 1 })
        .map((item) => item.summary),
    ).toEqual(['b']);
    expect(buffer.filter({})).toHaveLength(3);
  });

  test('does not mutate the buffer', () => {
    const buffer = new CombatDebugTraceBuffer();
    buffer.append(entry({ kind: 'request', summary: 'a' }));
    buffer.append(entry({ kind: 'event', summary: 'b' }));

    const filtered = buffer.filter({ kind: 'request' });
    filtered.pop();
    filtered.push({ ...(filtered[0] as never) });

    expect(buffer.snapshot().entries).toHaveLength(2);
    expect(buffer.filter({ kind: 'request' })).toHaveLength(1);
  });
});
