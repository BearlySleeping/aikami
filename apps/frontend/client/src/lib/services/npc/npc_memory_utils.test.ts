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
