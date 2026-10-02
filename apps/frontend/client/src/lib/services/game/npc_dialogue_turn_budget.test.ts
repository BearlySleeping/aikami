// apps/frontend/client/src/lib/services/game/npc_dialogue_turn_budget.test.ts
//
// The dialogue turn's budget and identity reach the transport (issue #382).
//
// Its own file because the question is a different one from the orchestrator
// suite's. Those tests ask "what does the orchestrator DO with a provider
// answer?" — fallback, malformed output, precondition whitelisting, command
// dispatch. This one asks "what does the orchestrator hand DOWN?", and the
// answer is invisible from every existing test because the text generator is a
// stub that ignores everything except the messages.
//
// The defect it covers: the orchestrator has always owned a 120 s turn budget
// and enforced it with a timer around the promise. That timer cannot reach the
// provider — it aborts the caller's signal, and the adapter, which is the only
// layer that can stop a request, never learns the budget existed and applies
// its own shorter 90 s watchdog over the top of it. A dialogue turn with
// thirty seconds of its own budget left was being cut at ninety.

import { beforeEach, describe, expect, test } from 'bun:test';
import {
  makeContentProvider,
  makeExecutors,
  resetDialogueServiceFixture,
} from './__tests__/npc_dialogue_fixtures.ts';
import { npcDialogueService } from './npc_dialogue_service.svelte';

beforeEach(() => {
  resetDialogueServiceFixture();
});

describe('dialogue turn budget and identity (issue #382)', () => {
  test('both calls of one turn receive the SAME absolute deadline and turn id', async () => {
    const seen: Array<{ deadlineAt?: number; requestId?: string; schema?: string }> = [];
    const controller = new AbortController();
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      // Records what the orchestrator handed down, then behaves like a
      // successful two-call turn.
      textGenerator: async (opts) => {
        seen.push({
          ...(opts.deadlineAt === undefined ? {} : { deadlineAt: opts.deadlineAt }),
          ...(opts.requestId === undefined ? {} : { requestId: opts.requestId }),
          ...(opts.schemaName === undefined ? {} : { schema: opts.schemaName }),
        });
        if (opts.schemaName === undefined) {
          opts.onChunk?.('The ridge is the way to take.');
          return { text: 'The ridge is the way to take.' };
        }
        return {
          text: '',
          structured: {
            stateDeltas: [],
            npcMood: 'wary',
            suggestedChips: [],
            memoryNotes: [],
          },
        };
      },
      executors: makeExecutors(),
    });

    const before = Date.now();
    await npcDialogueService.generateTurn({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [{ role: 'player', content: 'Which road is safest?' }],
      signal: controller.signal,
    });
    const after = Date.now();

    expect(seen.length).toBeGreaterThanOrEqual(2);
    const [narrative, envelope] = seen;
    // A 120 s turn budget, expressed as an ABSOLUTE instant — not a duration,
    // because a duration is a budget the transport has to restart.
    expect(narrative?.deadlineAt).toBeGreaterThanOrEqual(before + 119_000);
    expect(narrative?.deadlineAt).toBeLessThanOrEqual(after + 120_000);
    // The SAME instant for call 2. The extraction reads the narrative call 1
    // just produced, so it has less budget, not a fresh one.
    expect(envelope?.deadlineAt).toBe(narrative?.deadlineAt);
    // One turn is one logical request even though it makes two provider calls.
    expect(envelope?.requestId).toBe(narrative?.requestId);
    expect(narrative?.requestId).toMatch(/^dialogue-turn-\d+$/);
    // And the two calls are actually distinguishable — an assertion that passes
    // trivially when only one call was made would prove nothing.
    expect(narrative?.schema).toBeUndefined();
    expect(envelope?.schema).toBe('NpcDialogueExtraction');
  });

  test('two turns get different identities, so one turn is never conflated with another', async () => {
    const ids: string[] = [];
    const controller = new AbortController();
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator: async (opts) => {
        if (opts.requestId !== undefined && ids[ids.length - 1] !== opts.requestId) {
          ids.push(opts.requestId);
        }
        if (opts.schemaName === undefined) {
          opts.onChunk?.('Go north.');
          return { text: 'Go north.' };
        }
        return {
          text: '',
          structured: { stateDeltas: [], npcMood: 'neutral', suggestedChips: [], memoryNotes: [] },
        };
      },
      executors: makeExecutors(),
    });

    for (const line of ['Which road?', 'And after that?']) {
      await npcDialogueService.generateTurn({
        npcId: 'village_elder',
        npcName: 'Elder Thalia',
        messages: [{ role: 'player', content: line }],
        signal: controller.signal,
      });
    }

    expect(ids.length).toBe(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
