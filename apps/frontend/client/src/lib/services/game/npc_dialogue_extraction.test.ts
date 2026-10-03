// apps/frontend/client/src/lib/services/game/npc_dialogue_extraction.test.ts
//
// Integration tests for the C-401 call-2 extraction contract (issue #382).
//
// Split out of npc_dialogue_service.test.ts so the contract has one home and
// neither suite grows past the source-file-size guard.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  expectAbortRejection,
  makeContentProvider,
  makeExecutors,
  makeStreamingTextGenerator,
  resetDialogueServiceFixture,
} from './__tests__/npc_dialogue_fixtures.ts';
import { npcDialogueService } from './npc_dialogue_service.svelte';

beforeEach(() => {
  resetDialogueServiceFixture();
});

afterEach(() => {
  resetDialogueServiceFixture();
});

// ---------------------------------------------------------------------------
// Issue #382: call 2 extracts metadata only
//
// #413 measured that every call-2 envelope hit its 6 000 ms budget and was
// discarded, because the schema required the model to re-emit the narrative
// call 1 had already streamed. These tests pin the replacement contract:
// extraction returns metadata, the streamed narrative stays authoritative, and
// every existing safety behaviour survives the change.
// ---------------------------------------------------------------------------

describe('Issue #382: call 2 extracts metadata, narrative stays authoritative', () => {
  const configureWith = (textGenerator: ReturnType<typeof makeStreamingTextGenerator>): void => {
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator,
      executors: makeExecutors(),
    });
  };

  const turnFor = (textGenerator: ReturnType<typeof makeStreamingTextGenerator>) => {
    configureWith(textGenerator);
    return npcDialogueService.generateTurn({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [{ role: 'player', content: 'Tell me about the caravan.' }],
      signal: new AbortController().signal,
    });
  };

  test('call 2 uses the extraction schema, and never asks for a narrative', async () => {
    const textGenerator = mock(async (opts: Record<string, unknown>) => {
      const onChunk = opts.onChunk as ((t: string) => void) | undefined;
      if (opts.schema) {
        expect(String(opts.schemaName)).toBe('NpcDialogueExtraction');
        return { text: '', structured: { choices: [{ id: 'a', label: 'Ask again' }] } };
      }
      onChunk?.('The caravan never reached the mill.');
      return { text: 'The caravan never reached the mill.' };
    });
    const turn = await turnFor(textGenerator as never);

    expect(turn.narrative).toBe('The caravan never reached the mill.');
    expect(turn.source).toBe('ai');
    // The streamed narrative is byte-for-byte the turn narrative.
    expect(turn.choices.map((choice) => choice.id)).toEqual(['a']);
  });

  test('the extraction prompt no longer instructs the model to reproduce the narrative', async () => {
    let call2SystemPrompt = '';
    const textGenerator = mock(async (opts: Record<string, unknown>) => {
      const onChunk = opts.onChunk as ((t: string) => void) | undefined;
      if (opts.schema) {
        const messages = opts.messages as Array<{ role: string; content: string }>;
        call2SystemPrompt = messages.find((m) => m.role === 'system')?.content ?? '';
        return { text: '', structured: {} };
      }
      onChunk?.('Nothing more to say.');
      return { text: 'Nothing more to say.' };
    });
    await turnFor(textGenerator as never);

    expect(call2SystemPrompt).not.toContain('reuse the given narrative verbatim');
    expect(call2SystemPrompt).toContain('ALREADY spoken to the player');
    expect(call2SystemPrompt).toContain('Do not rewrite, summarize, quote, continue or return it');
    // NPC context must survive — the model still needs it to infer commands.
    expect(call2SystemPrompt).toContain('Allowed actions:');
  });

  test('model-authored choices survive validation', async () => {
    const turn = await turnFor(
      makeStreamingTextGenerator({
        chunks: ['The elder nods slowly.'],
        structured: {
          choices: [
            { id: 'c1', label: 'Where is the trail?' },
            { id: 'c2', label: 'Who followed it?' },
          ],
        },
      }) as never,
    );
    expect(turn.choices).toHaveLength(2);
    expect(turn.choices.map((choice) => choice.id)).toEqual(['c1', 'c2']);
    expect(turn.source).toBe('ai');
  });

  test('extraction with no command and no choices is a valid successful turn', async () => {
    const turn = await turnFor(
      makeStreamingTextGenerator({ chunks: ['The elder falls silent.'], structured: {} }) as never,
    );
    expect(turn.narrative).toBe('The elder falls silent.');
    expect(turn.source).toBe('ai');
    expect(turn.command).toBeUndefined();
    // Choices fall back to deterministic derivation, not the model.
    expect(turn.choices.length).toBeGreaterThan(0);
    expect(turn.choices.length).toBeLessThanOrEqual(4);
  });

  test('a valid command still flows through precondition validation', async () => {
    const turn = await turnFor(
      makeStreamingTextGenerator({
        chunks: ['Take this seal.'],
        structured: { command: { kind: 'offerQuest', questId: 'fading_ward' } },
      }) as never,
    );
    expect(turn.command?.kind).toBe('offerQuest');
    expect(turn.source).toBe('ai');
  });

  test('a command rejected by preconditions is dropped, narrative still renders', async () => {
    const turn = await turnFor(
      makeStreamingTextGenerator({
        chunks: ['The elder refuses.'],
        structured: { command: { kind: 'giveItem', itemId: 'wardShard', quantity: 1 } },
      }) as never,
    );
    expect(turn.narrative).toBe('The elder refuses.');
    // giveItem is not allowed for this NPC, so the command must not survive.
    expect(turn.command).toBeUndefined();
    expect(turn.source).toBe('ai');
  });

  test('an extraction that returns a narrative is malformed and degrades (AC-7)', async () => {
    const turn = await turnFor(
      makeStreamingTextGenerator({
        chunks: ['The real reply.'],
        structured: { narrative: 'A regenerated reply the client never asked for.' },
      }) as never,
    );
    // Narrative-only degrade, and the streamed text is what the player keeps.
    expect(turn.narrative).toBe('The real reply.');
    expect(turn.source).toBe('ai');
    expect(turn.command).toBeUndefined();
  });

  test('malformed extraction degrades to narrative-only, never discarding streamed text (AC-7)', async () => {
    const turn = await turnFor(
      makeStreamingTextGenerator({
        chunks: ['The elder smiles warmly.'],
        structured: { kind: 'garbage' },
      }) as never,
    );
    expect(turn.narrative).toBe('The elder smiles warmly.');
    expect(turn.source).toBe('ai');
    expect(turn.choices.length).toBeGreaterThan(0);
  });

  test('extraction timeout degrades to narrative-only (AC-4/AC-7)', async () => {
    const textGenerator = mock(async (opts: Record<string, unknown>) => {
      const onChunk = opts.onChunk as ((t: string) => void) | undefined;
      const signal = opts.signal as AbortSignal | undefined;
      if (opts.schema) {
        // Call 2 never completes; the shared timeout must fire and degrade.
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        });
        return { text: '', structured: undefined };
      }
      onChunk?.('A thought, unfinished.');
      return { text: 'A thought, unfinished.' };
    });
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator,
      executors: makeExecutors(),
      // The real deadline is 120 s; shorten it so the test does not wait it out.
      timeoutMs: 60,
    });

    // Call 2 hangs, so the shared absolute deadline must fire. AC-7 keeps the
    // streamed text: the failure degrades, it never discards prose the player
    // already read.
    const turn = await npcDialogueService.generateTurn({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [],
      signal: new AbortController().signal,
    });

    expect(turn.narrative).toBe('A thought, unfinished.');
    expect(turn.source).toBe('ai');
    expect(turn.command).toBeUndefined();
  });

  // C-568 regression: extracting metadata through the decision-aware path must
  // not have lost the bounded timeout. The first integration of that path
  // replaced the `_withTimeout` wrapper with a bare await, so a hanging call 2
  // hung the turn instead of degrading.
  test('a generator that IGNORES abort still times out and degrades', async () => {
    const textGenerator = mock(async (opts: Record<string, unknown>) => {
      const onChunk = opts.onChunk as ((t: string) => void) | undefined;
      if (opts.schema) {
        // Never settles and never listens to abort — the worst case a provider
        // integration can present. Only the caller's timer can end this.
        await new Promise<void>(() => {});
        return { text: '', structured: undefined };
      }
      onChunk?.('A thought, unfinished.');
      return { text: 'A thought, unfinished.' };
    });
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator,
      executors: makeExecutors(),
      timeoutMs: 60,
    });

    const turn = await npcDialogueService.generateTurn({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [],
      signal: new AbortController().signal,
    });

    // AC-7 again: the streamed prose survives; the failure degrades.
    expect(turn.narrative).toBe('A thought, unfinished.');
    expect(turn.source).toBe('ai');
    expect(turn.command).toBeUndefined();
  });

  test('empty call-1 narrative is surfaced as a provider failure, never a successful empty turn', async () => {
    let call2Count = 0;
    const textGenerator = mock(async (opts: Record<string, unknown>) => {
      const onChunk = opts.onChunk as ((t: string) => void) | undefined;
      if (opts.schema) {
        call2Count += 1;
        return { text: '', structured: { choices: [{ id: 'a', label: 'Continue' }] } };
      }
      onChunk?.('');
      return { text: '' };
    });
    configureWith(textGenerator as never);

    await expect(
      npcDialogueService.generateTurn({
        npcId: 'village_elder',
        npcName: 'Elder Thalia',
        messages: [],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow();

    // Extraction is not even attempted: with no narrative there is no turn to
    // attach metadata to, and `NpcDialogueTurnSchema.narrative` permits `''`, so
    // returning one would report a successful AI turn that says nothing.
    expect(call2Count).toBe(0);

    // The documented outcome for a provider that produced nothing.
    expect(npcDialogueService.turnState.kind).toBe('failed');
    if (npcDialogueService.turnState.kind === 'failed') {
      expect(npcDialogueService.turnState.reason).toBe('provider_error');
      expect(npcDialogueService.turnState.fallbackOffered).toBe(false);
    }
  });

  test('a whitespace-only call-1 narrative is also a provider failure', async () => {
    // `trim()` guards the invariant rather than a length threshold: short
    // replies are legitimate, but whitespace is not a reply.
    const textGenerator = mock(async (opts: Record<string, unknown>) => {
      const onChunk = opts.onChunk as ((t: string) => void) | undefined;
      if (opts.schema) {
        return { text: '', structured: {} };
      }
      onChunk?.('   \n  ');
      return { text: '   \n  ' };
    });
    configureWith(textGenerator as never);

    await expect(
      npcDialogueService.generateTurn({
        npcId: 'village_elder',
        npcName: 'Elder Thalia',
        messages: [],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow();
    expect(npcDialogueService.turnState.kind).toBe('failed');
  });

  test('abort during call 2 still rejects and never yields a partial turn', async () => {
    const textGenerator = mock(async (opts: Record<string, unknown>) => {
      const onChunk = opts.onChunk as ((t: string) => void) | undefined;
      const signal = opts.signal as AbortSignal | undefined;
      if (opts.schema) {
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        });
        return { text: '', structured: undefined };
      }
      onChunk?.('First half');
      onChunk?.(' second half');
      return { text: 'First half second half' };
    });
    configureWith(textGenerator as never);

    const controller = new AbortController();
    const turnPromise = npcDialogueService.generateTurn({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [],
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();

    await expectAbortRejection(turnPromise);
    expect(npcDialogueService.turnState.kind).toBe('failed');
  });
});
