// apps/frontend/client/src/lib/services/npc/npc_memory_freshness.test.ts
//
// SCENARIO: a prepared greeting is checked when it is CONSUMED, a failed
// digest's lines come back in the order they happened, and a very long wait
// cannot corrupt another campaign (issue #382).
//
// These are SCENARIO tests because every defect they cover lived in a gap
// between two moments, and neither moment can see the other from the inside:
//
//   - An opener was validated when it was GENERATED. Nothing validated it when
//     the player pressed interact, which is seconds to minutes later and after
//     a whole map walk's worth of world changes.
//   - A digest's transcript lines were CLAIMED at dispatch and GIVEN BACK on
//     failure, by which time a second conversation with the same NPC had
//     arrived. The give-back appended instead of prepending, so the buffer's
//     tail was its oldest content.
//   - Background work is generation-scoped, which is what keeps a campaign
//     switch from cross-writing — but nothing asserted that under a LONG wait,
//     which is the only condition under which the player actually notices.
//
// The service is exercised through its public surface with the world, the
// persona and the campaign all under the test's control, because those three
// are exactly the inputs whose movement the old checks could not see.

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { NpcMemoryRecord } from '@aikami/types';
import type { NpcMemoryServiceInterface } from './npc_memory_service.svelte.ts';

// ── Mocks ──────────────────────────────────────────────────────────────────

const campaign = { activeCampaign: { id: 'campaign_a' } as { id: string } | undefined };

/** The structured result the next provider call resolves with. */
let nextStructured: unknown;
/** Rejects the next provider call, standing in for a failed digest. */
let failNext: Error | undefined;
/** Holds every provider call open until released. */
let gate: Promise<unknown> | undefined;
/** The world facts the opener and digest prompts are built from. */
let worldFacts: string[] = ['Gold: 5'];
/** The authored persona. Rewriting it is the case the old checks missed. */
let persona = 'A gruff cartographer.';
/** Every provider call the service made, in order. */
const calls: Array<{ schemaName: string; prompt: string; systemPrompt?: string }> = [];

mock.module('../ai/text_generation_service.svelte.ts', () => ({
  textGenerationService: {
    extractStructure: (options: {
      schemaName: string;
      prompt: string;
      systemPrompt?: string;
      signal?: AbortSignal;
    }) => {
      calls.push({
        schemaName: options.schemaName,
        prompt: options.prompt,
        ...(options.systemPrompt === undefined ? {} : { systemPrompt: options.systemPrompt }),
      });
      if (gate !== undefined) {
        return gate;
      }
      if (failNext !== undefined) {
        const error = failNext;
        failNext = undefined;
        return Promise.reject(error);
      }
      return Promise.resolve(nextStructured);
    },
  },
}));
mock.module('../campaign/campaign_service.svelte.ts', () => ({
  campaignService: campaign,
}));
mock.module('../game/game_state_facts.ts', () => ({
  buildGameStateFacts: () => worldFacts,
}));
mock.module('../game/npc_dialogue_service.svelte.ts', () => ({
  npcDialogueService: {
    buildContext: () => ({ persona }),
    buildNpcPersonaForPrompt: () => persona,
  },
}));
mock.module('../game/serializable_service', () => ({
  registerSerializable: () => {},
}));

const { npcMemoryService } = (await import('./npc_memory_service.svelte.ts')) as {
  npcMemoryService: NpcMemoryServiceInterface;
};

// ── Helpers ────────────────────────────────────────────────────────────────

const AUTHORED = 'Welcome, traveller.';

const authoredNpc = (npcId = 'ivo') => ({
  npcId,
  npcName: 'Ivo',
  dialog: AUTHORED,
  initialSuggestions: [{ id: 'authored', label: 'Ask about the woods' }],
});

const DIGEST = {
  summary: 'The player asked about the woods and I marked the path.',
  notes: ['Player is a fighter'],
  opener: 'Back already? Did the woods path hold up?',
  suggestions: [
    {
      id: 'report_path',
      label: 'Report on the path',
      intentType: 'dialogue',
      prefillText: 'The path was clear, just as you said.',
    },
  ],
};

const OPENER_ONLY = {
  opener: 'The woods path is marked. Ready when you are.',
  suggestions: [
    { id: 'go_now', label: 'Head out', intentType: 'dialogue', prefillText: 'I am ready.' },
  ],
};

const talk = (text: string): Array<{ role: 'player' | 'npc'; content: string }> => [
  { role: 'npc', content: 'Welcome, traveller.' },
  { role: 'player', content: text },
  { role: 'npc', content: 'Take the woods path.' },
];

const recordOf = (npcId: string): NpcMemoryRecord | undefined =>
  npcMemoryService.serialize().records[npcId];

/** Yields until the service publishes no outstanding background work. */
const settleUntilIdle = async (): Promise<void> => {
  const published = () =>
    (
      (globalThis as Record<string, unknown>).__npc_memory_background_diagnostics as
        | { pending?: number }
        | undefined
    )?.pending ?? 0;
  for (let i = 0; i < 300; i += 1) {
    if (published() === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('background work never drained');
};

const deferred = (): {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
} => {
  let resolve: (value: unknown) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const realNow = Date.now;
let clockOffset = 0;

beforeEach(() => {
  campaign.activeCampaign = { id: 'campaign_a' };
  worldFacts = ['Gold: 5'];
  persona = 'A gruff cartographer.';
  nextStructured = DIGEST;
  failNext = undefined;
  gate = undefined;
  calls.length = 0;
  clockOffset = 0;
  Date.now = (): number => realNow() + clockOffset;
  npcMemoryService.reset();
});

afterEach(() => {
  Date.now = realNow;
  gate = undefined;
});

// ---------------------------------------------------------------------------
// Consumption-time revalidation
// ---------------------------------------------------------------------------

describe('a prepared greeting is revalidated when it is consumed', () => {
  it('is SHOWN when nothing relevant changed since it was generated', async () => {
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Which way to the woods?'),
    });
    // The whole point of the re-dating behaviour: an unchanged world reuses the
    // opener instead of spending another provider call.
    const greeted = npcMemoryService.resolveGreeting(authoredNpc());
    expect(greeted.dialog).toBe(DIGEST.opener);
    expect(greeted.initialSuggestions?.[0]?.id).toBe('report_path');
  });

  it('is NOT shown once the world state moved on, and the authored line is used', async () => {
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Which way to the woods?'),
    });
    expect(npcMemoryService.resolveGreeting(authoredNpc()).dialog).toBe(DIGEST.opener);

    // The player finishes the quest the greeting was about. Nothing about the
    // opener changed — only the world it referred to.
    worldFacts = ['Gold: 5', 'Quest: the woods path (completed)'];
    const greeted = npcMemoryService.resolveGreeting(authoredNpc());

    // The stale line is gone. The player is not greeted by an NPC asking about
    // a path they already walked.
    expect(greeted.dialog).toBe(AUTHORED);
    expect(greeted.initialSuggestions?.[0]?.id).toBe('authored');
  });

  it('is NOT shown once the authored PERSONA was rewritten', async () => {
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Which way to the woods?'),
    });

    // The world is byte-identical. Only the voice changed — and the old
    // greeting now speaks in a character the author deleted.
    persona = 'A cheerful courier who never stops talking about the weather.';
    const greeted = npcMemoryService.resolveGreeting(authoredNpc());
    expect(greeted.dialog).toBe(AUTHORED);
  });

  it('is NOT shown when the save predates the revalidation stamps', async () => {
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Which way to the woods?'),
    });
    // Simulate a save written by a build that stamped only the world.
    const snapshot = npcMemoryService.serialize();
    const record = snapshot.records.ivo;
    if (record?.opener === undefined) {
      throw new Error('expected an opener');
    }
    npcMemoryService.hydrate({
      campaignId: 'campaign_a',
      records: {
        ivo: { ...record, opener: { ...record.opener, promptRevision: undefined } },
      },
    });

    // An absent stamp can never match a computed one, so the service cannot
    // PROVE the greeting is current and must not present it as though it could.
    // The safe direction is the expensive one.
    expect(npcMemoryService.resolveGreeting(authoredNpc()).dialog).toBe(AUTHORED);
  });

  it('stays REUSED across many consumptions — revalidation is not a refresh loop', async () => {
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Which way to the woods?'),
    });
    const before = calls.length;
    for (let i = 0; i < 10; i += 1) {
      expect(npcMemoryService.resolveGreeting(authoredNpc()).dialog).toBe(DIGEST.opener);
    }
    // Ten times the player walks up to a remembered NPC, and not one extra
    // provider call is made. A revalidation that regenerated would turn the
    // fix into the cost it was meant to remove.
    expect(calls.length).toBe(before);
  });

  it('a stale greeting degrades safely AND asks for exactly one bounded refresh', async () => {
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Which way to the woods?'),
    });
    worldFacts = ['Gold: 5', 'Quest: the woods path (completed)'];
    nextStructured = OPENER_ONLY;

    const before = calls.length;
    for (let i = 0; i < 5; i += 1) {
      expect(npcMemoryService.resolveGreeting(authoredNpc()).dialog).toBe(AUTHORED);
    }
    await settleUntilIdle();

    // Five consumptions, and the debounce means the background work is bounded
    // — not one regeneration per approach.
    expect(calls.length - before).toBeLessThanOrEqual(1);
  });

  it('the regenerated greeting is shown on the NEXT approach', async () => {
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Which way to the woods?'),
    });
    worldFacts = ['Gold: 5', 'Quest: the woods path (completed)'];
    nextStructured = OPENER_ONLY;
    expect(npcMemoryService.resolveGreeting(authoredNpc()).dialog).toBe(AUTHORED);
    await settleUntilIdle();
    // Past the prefetch cooldown, which is what makes the refresh BOUNDED: the
    // next approach after the window gets the new line, and every approach
    // inside it got the authored one without spending a call. Still inside the
    // opener's own max age, so the wait is the cooldown and nothing else.
    clockOffset = 2 * 60 * 1000;

    expect(npcMemoryService.resolveGreeting(authoredNpc()).dialog).toBe(OPENER_ONLY.opener);
  });

  it('an opener that has merely AGED is still shown, and re-dated without a call', async () => {
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Which way to the woods?'),
    });
    // Past the max age, with the world and persona untouched. Age bounds how
    // often memory is looked at; it does not decide what is true, and the
    // re-dating path (#422) exists precisely so a full provider call is not
    // spent re-asking a byte-identical question.
    clockOffset = 30 * 24 * 60 * 60 * 1000;
    const before = calls.length;
    expect(npcMemoryService.resolveGreeting(authoredNpc()).dialog).toBe(DIGEST.opener);
    await settleUntilIdle();
    expect(calls.length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Digest line restoration
// ---------------------------------------------------------------------------

describe('a failed digest gives its lines back in the order they happened', () => {
  /** Indexes of the given utterances within a digest prompt, or -1 if absent. */
  const positions = (prompt: string, ...utterances: string[]): number[] =>
    utterances.map((utterance) => prompt.indexOf(utterance));

  it('older claimed lines precede lines that arrived during the digest', async () => {
    const first = deferred();
    gate = first.promise;

    // Conversation one claims its lines and goes to the provider.
    const digestOne = npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('FIRST-conversation'),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Conversation two happens while the first digest is still in flight. Its
    // lines are strictly newer, and the first digest has not claimed them.
    const second = deferred();
    gate = second.promise;
    const digestTwo = npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('SECOND-conversation'),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The FIRST digest fails, and returns its claimed lines to the buffer.
    first.reject(new Error('provider exploded'));
    await digestOne.catch(() => {});
    second.resolve(OPENER_ONLY);
    await digestTwo;
    await settleUntilIdle();

    // The next digest is the witness.
    const third = deferred();
    gate = third.promise;
    const digestThree = npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('THIRD-conversation'),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    third.resolve(OPENER_ONLY);
    await digestThree;

    const prompt = calls[calls.length - 1]?.prompt ?? '';
    const [firstAt, secondAt, thirdAt] = positions(
      prompt,
      'FIRST-conversation',
      'SECOND-conversation',
      'THIRD-conversation',
    );
    expect(firstAt).toBeGreaterThanOrEqual(0);
    expect(secondAt).toBeGreaterThanOrEqual(0);
    expect(thirdAt).toBeGreaterThanOrEqual(0);
    // The ordering assertion. Before the fix the restored lines were appended
    // after the newer ones, so this read as a buffer whose last line was the
    // earliest conversation it contained.
    expect(firstAt).toBeLessThan(secondAt);
    expect(secondAt).toBeLessThan(thirdAt);
  });

  it('overflow keeps the NEWEST lines, still in order', async () => {
    const first = deferred();
    gate = first.promise;
    const digestOne = npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('OLDEST-conversation'),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // A burst big enough to overflow the carry-forward bound: 90 utterances
    // against a ceiling of 60 lines.
    const second = deferred();
    gate = second.promise;
    const digestTwo = npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: Array.from({ length: 90 }, (_, index) => ({
        role: 'player' as const,
        content: `BURST-${String(index).padStart(3, '0')}`,
      })),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    first.reject(new Error('provider exploded'));
    await digestOne.catch(() => {});
    second.resolve(OPENER_ONLY);
    await digestTwo;
    await settleUntilIdle();

    const third = deferred();
    gate = third.promise;
    const digestThree = npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: [{ role: 'player', content: 'AFTER-BURST' }],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    third.resolve(OPENER_ONLY);
    await digestThree;

    const prompt = calls[calls.length - 1]?.prompt ?? '';
    // The digest prompt is itself bounded to the newest transcript lines, so
    // what is asserted is the ORDER of what survived, and that the surviving
    // window is the recent one rather than the stale one.
    const burstIndexes = [...prompt.matchAll(/BURST-(\d{3})/g)].map((match) => Number(match[1]));
    expect(burstIndexes.length).toBeGreaterThan(0);
    const ascending = [...burstIndexes].sort((a, b) => a - b);
    expect(burstIndexes).toEqual(ascending);
    expect(burstIndexes[burstIndexes.length - 1]).toBe(89);
    // The post-burst line is present and comes after everything it followed.
    expect(prompt.indexOf('AFTER-BURST')).toBeGreaterThan(prompt.indexOf('BURST-089'));
  });
});

// ---------------------------------------------------------------------------
// A long wait
// ---------------------------------------------------------------------------

describe('a very long queue delay preserves campaign, conversation and world validity', () => {
  it('91 seconds of waiting cannot cross-write into another campaign', async () => {
    const held = deferred();
    gate = held.promise;
    const digest = npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('OLD-CAMPAIGN-question'),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 91 virtual seconds pass — longer than a dialogue budget, longer than the
    // adapter's own 90 s watchdog, and long enough that a real provider would
    // have given up twice. Nothing about the request is cancelled: this is a
    // wait, not a failure.
    clockOffset = 91_000;

    // The player loads a save. Different campaign, same NPC id, new world.
    campaign.activeCampaign = { id: 'campaign_b' };
    worldFacts = ['Gold: 900'];
    persona = 'A stern harbourmaster.';
    nextStructured = {
      ...DIGEST,
      summary: 'The new campaign met the harbourmaster.',
      opener: 'The tide is out. Mind the pier.',
    };
    // The new campaign's own digest is free to run immediately; only the OLD
    // one is still in flight.
    gate = undefined;
    const inNewCampaign = npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('NEW-CAMPAIGN-question'),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The OLD digest finally answers — after the world moved, after the
    // campaign changed, 91 s later.
    held.resolve(DIGEST);
    await digest.catch(() => {});
    await inNewCampaign;
    await settleUntilIdle();

    const record = recordOf('ivo');
    // The new campaign's record is about the new campaign. The old digest's
    // answer is nowhere in it — not its summary, not its opener, not its notes.
    expect(npcMemoryService.serialize().campaignId).toBe('campaign_b');
    expect(record?.summary).toContain('harbourmaster');
    expect(record?.summary).not.toContain('OLD-CAMPAIGN-question');
    expect(record?.opener?.text).not.toBe(DIGEST.opener);
    // And the greeting on offer belongs to the world the player is actually in.
    expect(npcMemoryService.resolveGreeting(authoredNpc()).dialog).not.toBe(DIGEST.opener);
  });

  it('a world change under an in-flight digest leaves no opener dated from before it', async () => {
    const held = deferred();
    gate = held.promise;
    const digest = npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Where is the woods path?'),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    clockOffset = 91_000;
    // Same campaign, but the world moves on while the digest is in flight.
    worldFacts = ['Gold: 5', 'Quest: the woods path (completed)'];
    held.resolve(DIGEST);
    await digest;
    await settleUntilIdle();

    const record = recordOf('ivo');
    // The MEMORY is still applied — the conversation happened, and losing it
    // because the world moved would be a worse outcome than a late greeting.
    expect(record?.summary).toBe(DIGEST.summary);
    // The OPENER is not. Stamping a greeting generated against the previous
    // world with the current one is what lets it read as fresh for another full
    // max-age on the strength of a call that predates the change.
    expect(record?.opener).toBeUndefined();
    expect(npcMemoryService.resolveGreeting(authoredNpc()).dialog).toBe(AUTHORED);
  });
});
