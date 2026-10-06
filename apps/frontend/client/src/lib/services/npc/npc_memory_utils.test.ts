// apps/frontend/client/src/lib/services/npc/npc_memory_utils.test.ts
//
// Unit tests for the pure NPC memory helpers — every bound holds.

import { describe, expect, it } from 'bun:test';
import { NPC_MEMORY_LIMITS } from '@aikami/constants';
import type { NpcMemoryState } from '@aikami/types';
import {
  clampSummary,
  clampText,
  evictOldest,
  fallbackSummary,
  mergeNotes,
  mergeRestoredDigestLines,
  toMemoryLines,
} from './npc_memory_utils.ts';

describe('npc_memory_utils', () => {
  it('clampText collapses whitespace and truncates with an ellipsis', () => {
    expect(clampText({ text: '  a   b  ', max: 10 })).toBe('a b');
    expect(clampText({ text: 'abcdefghij', max: 5 })).toBe('abcd…');
  });

  it('clampSummary keeps the newest detail within budget', () => {
    const long = Array.from({ length: 100 }, (_, index) => `Sentence ${index}.`).join(' ');
    const clamped = clampSummary(long);
    expect(clamped.length).toBeLessThanOrEqual(NPC_MEMORY_LIMITS.summaryChars);
    expect(clamped.endsWith('Sentence 99.')).toBe(true);
  });

  it('toMemoryLines drops empty utterances', () => {
    expect(
      toMemoryLines([
        { role: 'npc', content: '   ' },
        { role: 'player', content: 'hi' },
      ]),
    ).toEqual([{ role: 'player', content: 'hi' }]);
  });

  it('mergeNotes de-duplicates case-insensitively and caps the count', () => {
    const existing = Array.from({ length: 8 }, (_, index) => `old ${index}`);
    const merged = mergeNotes({ existing, incoming: ['OLD 7', 'new fact'] });
    expect(merged.length).toBe(NPC_MEMORY_LIMITS.maxNotes);
    expect(merged).toContain('new fact');
    expect(merged.filter((note) => note.toLowerCase() === 'old 7').length).toBe(1);
  });

  it('fallbackSummary records player topics and leaves NPC-only talks alone', () => {
    expect(fallbackSummary({ previous: 'Prior.', lines: [{ role: 'npc', content: 'x' }] })).toBe(
      'Prior.',
    );
    expect(
      fallbackSummary({ previous: '', lines: [{ role: 'player', content: 'the ruins' }] }),
    ).toContain('the ruins');
  });

  it('evictOldest keeps the most recently talked-to NPCs', () => {
    const records: NpcMemoryState['records'] = {};
    for (let index = 0; index < NPC_MEMORY_LIMITS.maxRecords + 3; index++) {
      records[`npc_${index}`] = {
        npcId: `npc_${index}`,
        npcName: `Npc ${index}`,
        conversationCount: 1,
        lastTalkedAt: index,
        summary: '',
        notes: [],
        lastExchange: [],
      };
    }
    evictOldest(records);
    expect(Object.keys(records).length).toBe(NPC_MEMORY_LIMITS.maxRecords);
    expect(records.npc_0).toBeUndefined();
    expect(records[`npc_${NPC_MEMORY_LIMITS.maxRecords + 2}`]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Digest line restoration — chronology under supersession (issue #382)
// ---------------------------------------------------------------------------

const line = (content: string) => ({ role: 'player' as const, content });

describe('mergeRestoredDigestLines', () => {
  it("puts the failed digest's OLDER lines before the newer ones", () => {
    const merged = mergeRestoredDigestLines({
      claimed: [line('first'), line('second')],
      // Arrived while the digest was in flight, so strictly newer.
      accumulated: [line('third'), line('fourth')],
      limit: 60,
    });
    expect(merged.map((entry) => entry.content)).toEqual(['first', 'second', 'third', 'fourth']);
  });

  it('a single restored line does not jump ahead of newer conversation', () => {
    const merged = mergeRestoredDigestLines({
      claimed: [line('oldest')],
      accumulated: [line('newer')],
      limit: 60,
    });
    // The previous implementation appended, producing ['newer', 'oldest'] — a
    // buffer whose last line is the earliest thing in it.
    expect(merged.map((entry) => entry.content)).toEqual(['oldest', 'newer']);
  });

  it('OVERFLOW keeps the intended chronology: the newest lines, in order', () => {
    const claimed = Array.from({ length: 8 }, (_, index) => line(`old-${index}`));
    const accumulated = Array.from({ length: 8 }, (_, index) => line(`new-${index}`));
    const merged = mergeRestoredDigestLines({ claimed, accumulated, limit: 10 });

    expect(merged).toHaveLength(10);
    // The two newest OLD lines and all eight NEW ones, still in order. What is
    // dropped is the oldest conversation — a bounded, stated loss — and never
    // the newest, which is the failure the old ordering produced under the cap.
    expect(merged.map((entry) => entry.content)).toEqual([
      'old-6',
      'old-7',
      ...Array.from({ length: 8 }, (_, index) => `new-${index}`),
    ]);
    // And the tail is genuinely the tail: the newest line is last.
    expect(merged[merged.length - 1]?.content).toBe('new-7');
  });

  it('overflow with no accumulated lines still keeps the newest claimed ones', () => {
    const claimed = Array.from({ length: 12 }, (_, index) => line(`c-${index}`));
    const merged = mergeRestoredDigestLines({ claimed, accumulated: [], limit: 5 });
    expect(merged.map((entry) => entry.content)).toEqual(['c-7', 'c-8', 'c-9', 'c-10', 'c-11']);
  });

  it('an empty claim leaves the accumulated lines untouched and in order', () => {
    const accumulated = [line('a'), line('b')];
    expect(mergeRestoredDigestLines({ claimed: [], accumulated, limit: 60 })).toEqual(accumulated);
  });

  it('a zero limit retains nothing rather than throwing', () => {
    expect(mergeRestoredDigestLines({ claimed: [line('a')], accumulated: [], limit: 0 })).toEqual(
      [],
    );
  });
});
