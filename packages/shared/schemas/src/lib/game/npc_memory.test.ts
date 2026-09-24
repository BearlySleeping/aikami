// packages/shared/schemas/src/lib/game/npc_memory.test.ts
//
// Stored NPC memory obeys the save and prompt budgets; LLM output stays loose.

import { describe, expect, test } from 'bun:test';
import { NPC_MEMORY_LIMITS } from '@aikami/constants';
import { Value } from 'typebox/value';
import { NpcMemoryDigestSchema, NpcMemoryStateSchema } from './npc_memory.ts';

const record = {
  npcId: 'ivo',
  npcName: 'Ivo',
  conversationCount: 1,
  lastTalkedAt: 1,
  summary: 'A conversation.',
  notes: ['A fact.'],
  lastExchange: [{ role: 'player', content: 'Hello.' }],
};

describe('NPC memory storage bounds', () => {
  test('rejects oversized stored fields and record collections', () => {
    const state = { records: { ivo: record } };
    expect(Value.Check(NpcMemoryStateSchema, state)).toBe(true);
    expect(
      Value.Check(NpcMemoryStateSchema, {
        records: { ivo: { ...record, summary: 'x'.repeat(NPC_MEMORY_LIMITS.summaryChars + 1) } },
      }),
    ).toBe(false);
    expect(
      Value.Check(NpcMemoryStateSchema, {
        records: { ivo: { ...record, notes: ['x'.repeat(NPC_MEMORY_LIMITS.noteChars + 1)] } },
      }),
    ).toBe(false);
    expect(
      Value.Check(NpcMemoryStateSchema, {
        records: { ivo: { ...record, notes: new Array(NPC_MEMORY_LIMITS.maxNotes + 1).fill('x') } },
      }),
    ).toBe(false);
    expect(
      Value.Check(NpcMemoryStateSchema, {
        records: {
          ivo: {
            ...record,
            lastExchange: [
              { role: 'player', content: 'x'.repeat(NPC_MEMORY_LIMITS.lineChars + 1) },
            ],
          },
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(NpcMemoryStateSchema, {
        records: {
          ivo: {
            ...record,
            lastExchange: new Array(NPC_MEMORY_LIMITS.lastExchangeLines + 1).fill({
              role: 'player',
              content: 'x',
            }),
          },
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(NpcMemoryStateSchema, {
        records: Object.fromEntries(
          Array.from({ length: NPC_MEMORY_LIMITS.maxRecords + 1 }, (_, index) => [
            `npc_${index}`,
            { ...record, npcId: `npc_${index}` },
          ]),
        ),
      }),
    ).toBe(false);
  });

  test('accepts digest output above stored field budgets for later clamping', () => {
    expect(
      Value.Check(NpcMemoryDigestSchema, {
        summary: 'x'.repeat(NPC_MEMORY_LIMITS.summaryChars + 1),
        notes: ['x'.repeat(NPC_MEMORY_LIMITS.noteChars + 1)],
        opener: 'Hello.',
        suggestions: [],
      }),
    ).toBe(true);
  });
});
