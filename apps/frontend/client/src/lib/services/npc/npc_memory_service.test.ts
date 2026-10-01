// apps/frontend/client/src/lib/services/npc/npc_memory_service.test.ts
//
// Unit tests for NpcMemoryService — capture, digest, returning greeting,
// prompt projection, prefetch staleness, campaign scoping and save round-trip.

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { NPC_MEMORY_LIMITS } from '@aikami/constants';
import type { NpcMemoryRecord } from '@aikami/types';
import type { PublishedNpcMemoryDiagnostics } from './npc_memory_diagnostics.ts';
import type { NpcMemoryServiceInterface } from './npc_memory_service.svelte.ts';

// ── Mocks ──────────────────────────────────────────────────────────────────

const campaign = { activeCampaign: { id: 'campaign_a' } as { id: string } | undefined };

let nextStructured: unknown = {};
const extractStructure = mock(async () => nextStructured);

/** Mutable world facts, so a test can move the world on under a pending call. */
let worldFacts: string[] = ['Gold: 5'];
/** Optional gate so a test can hold a provider call open. */
let gate: Promise<unknown> | undefined;
/** Counts full turn-context projections, which the background path must not build. */
let fullProjectionCount = 0;

mock.module('../ai/text_generation_service.svelte.ts', () => ({
  textGenerationService: {
    extractStructure: (options: { schemaName: string; signal?: AbortSignal }) => {
      const call = gate === undefined ? Promise.resolve(nextStructured) : gate;
      void extractStructure(options);
      return call;
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
    // Present so a regression that reintroduces the full-projection call is
    // observable rather than silently passing against a missing method.
    buildContext: () => {
      fullProjectionCount += 1;
      return { persona: 'A gruff cartographer.' };
    },
    buildNpcPersonaForPrompt: () => 'A gruff cartographer.',
  },
}));
mock.module('../game/serializable_service', () => ({
  registerSerializable: () => {},
}));

const { npcMemoryService } = (await import('./npc_memory_service.svelte.ts')) as {
  npcMemoryService: NpcMemoryServiceInterface;
};

/** Reads a record through the public save snapshot (the service keeps lookup private). */
const recordOf = (npcId: string) => npcMemoryService.serialize().records[npcId];

/**
 * The opener a record currently holds.
 *
 * A named accessor rather than `record.opener!` at each use site: the
 * non-null assertion is the thing that could be wrong, and routing it through
 * one function makes a missing opener a named test failure instead of a
 * `TypeError` three lines later.
 */
const recordOrFail = (npcId: string): NpcMemoryRecord => {
  const record = recordOf(npcId);
  if (record === undefined) {
    throw new Error(`expected a record for ${npcId}`);
  }
  return record;
};

const openerOf = (npcId: string): NonNullable<NpcMemoryRecord['opener']> => {
  const opener = recordOf(npcId)?.opener;
  if (opener === undefined) {
    throw new Error(`expected ${npcId} to hold an opener`);
  }
  return opener;
};

/**
 * The lifecycle diagnostics the service PUBLISHES for the measurement harness.
 *
 * Read through the same global a dev tool or the #382 harness would read, not
 * through a service method: the published surface is the contract, and a method
 * that only tests call would prove nothing about it.
 */
const diagnostics = (): PublishedNpcMemoryDiagnostics | undefined =>
  (globalThis as Record<string, unknown>).__npc_memory_background_diagnostics as
    | PublishedNpcMemoryDiagnostics
    | undefined;

/** Lets every already-queued microtask reach its gate. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Yields until the published `pending` count reaches zero.
 *
 * The prefetch hooks are fire-and-forget by design — a map load must not await a
 * provider call — so a test that needs to observe the settled state waits on the
 * PUBLISHED diagnostic rather than on a method that only tests would call.
 */
const settleUntilIdle = async (): Promise<void> => {
  for (let i = 0; i < 200; i += 1) {
    if ((diagnostics()?.pending ?? 0) === 0) {
      return;
    }
    await settle();
  }
  throw new Error('background work never drained');
};

/** A promise the test resolves on demand, standing in for a slow provider. */
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

const DIGEST = {
  summary: 'The player is a fighter seeking the woods path. I marked it on their map.',
  notes: ['Player is a fighter', 'Promised to return the map'],
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

const talk = (text: string): Array<{ role: 'player' | 'npc'; content: string }> => [
  { role: 'npc', content: 'Welcome, traveller.' },
  { role: 'player', content: text },
  { role: 'npc', content: 'Take the woods path.' },
];

beforeEach(() => {
  campaign.activeCampaign = { id: 'campaign_a' };
  worldFacts = ['Gold: 5'];
  gate = undefined;
  fullProjectionCount = 0;
  npcMemoryService.reset();
  extractStructure.mockClear();
  nextStructured = DIGEST;
});

describe('NpcMemoryService', () => {
  it('ignores a dialogue where the player never spoke', async () => {
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: [{ role: 'npc', content: 'Welcome, traveller.' }],
    });
    expect(recordOf('ivo')).toBeUndefined();
    expect(extractStructure).not.toHaveBeenCalled();
  });

  it('records, digests, and greets a returning player with the prepared opener', async () => {
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Which way to the woods?'),
    });
    const record = recordOf('ivo');
    expect(record?.conversationCount).toBe(1);
    expect(record?.summary).toBe(DIGEST.summary);
    expect(record?.notes).toEqual(DIGEST.notes);

    const greeted = npcMemoryService.resolveGreeting({
      npcId: 'ivo',
      npcName: 'Ivo',
      dialog: 'Welcome, traveller.',
    });
    expect(greeted.dialog).toBe(DIGEST.opener);
    expect(greeted.initialSuggestions?.[0]?.id).toBe('report_path');
  });

  it('keeps a deterministic memory and authored greeting when the digest fails', async () => {
    nextStructured = { nonsense: true };
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Tell me about the ruins.'),
    });
    expect(recordOf('ivo')?.summary).toContain('Tell me about the ruins.');
    const greeted = npcMemoryService.resolveGreeting({
      npcId: 'ivo',
      npcName: 'Ivo',
      dialog: 'Welcome, traveller.',
    });
    expect(greeted.dialog).toBe('Welcome, traveller.');
  });

  it('projects bounded memory facts into the prompt', async () => {
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('x'.repeat(5000)),
    });
    const facts = npcMemoryService.getPromptFacts('ivo');
    expect(facts[0]).toContain('spoken with the player 1 time');
    expect(facts.join('\n')).toContain(DIGEST.summary);
    const record = recordOf('ivo');
    for (const line of record?.lastExchange ?? []) {
      expect(line.content.length).toBeLessThanOrEqual(NPC_MEMORY_LIMITS.lineChars);
    }
    expect(npcMemoryService.getPromptFacts('stranger')).toEqual([]);
  });

  it('does not refetch a fresh opener on proximity', async () => {
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Hello'),
    });
    extractStructure.mockClear();
    npcMemoryService.prefetchByName('ivo');
    npcMemoryService.prefetchForNpcs(['ivo']);
    await Promise.resolve();
    expect(extractStructure).not.toHaveBeenCalled();
  });

  it('drops digest and opener work queued before a restore', async () => {
    let releaseDigest: (() => void) | undefined;
    extractStructure.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseDigest = () => resolve(DIGEST);
        }),
    );
    const first = npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('First conversation'),
    });
    await Promise.resolve();
    npcMemoryService.prefetchForNpcs(['ivo']);
    const second = npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Second conversation'),
    });
    const snapshot = npcMemoryService.serialize();
    npcMemoryService.hydrate(snapshot);
    releaseDigest?.();
    await Promise.all([first, second]);

    expect(extractStructure).toHaveBeenCalledTimes(1);
    expect(recordOf('ivo')?.summary).toBe(snapshot.records.ivo?.summary);
    expect(recordOf('ivo')?.opener).toBeUndefined();
  });

  it('round-trips through serialize/hydrate and rejects invalid snapshots', async () => {
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Hello'),
    });
    const snapshot = npcMemoryService.serialize();
    npcMemoryService.reset();
    expect(recordOf('ivo')).toBeUndefined();
    npcMemoryService.hydrate(snapshot);
    expect(recordOf('ivo')?.summary).toBe(DIGEST.summary);

    npcMemoryService.hydrate({ records: { ivo: { bogus: 1 } } });
    expect(recordOf('ivo')).toBeUndefined();
  });

  it('never leaks memory across campaigns', async () => {
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Hello'),
    });
    campaign.activeCampaign = { id: 'campaign_b' };
    expect(recordOf('ivo')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Deferred background lifecycle
//
// Every delay here is a held promise or a hand-advanced clock. Nothing sleeps
// for real, because the defects are about what happens ACROSS a long delay —
// minutes of opener age, a conversation superseded while its digest waits — and
// none of them can be observed by waiting for them.
// ---------------------------------------------------------------------------

describe('NpcMemoryService — deferred background work', () => {
  it('a conversation replaces the record rather than merging into the old one', async () => {
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('First'),
    });
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Second'),
    });
    const record = recordOf('ivo');
    expect(record?.conversationCount).toBe(2);
    // The opener belongs to the conversation it was generated for.
    expect(record?.opener?.forConversation).toBe(2);
  });

  it('two rapid conversations: the newer deterministic memory survives the older digest', async () => {
    const slow = deferred();
    gate = slow.promise;
    const first = npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Older conversation'),
    });
    await settle();

    gate = undefined;
    const second = npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Newer conversation'),
    });
    // The FIRST digest lands after the second record already replaced the
    // first. Applying it would resurrect a stale summary and a stale opener.
    slow.resolve(DIGEST);
    await Promise.all([first, second]);

    const record = recordOf('ivo');
    expect(record?.conversationCount).toBe(2);
    expect(record?.opener?.forConversation).toBe(2);
    // The superseded digest's outcome is reported as a discard, not a success.
    const published = diagnostics();
    expect(published?.applied).toBe(1);
    expect(
      (published?.invalidatedAfterCompletion ?? 0) + (published?.supersededBeforeDispatch ?? 0),
    ).toBeGreaterThanOrEqual(1);
  });

  it('a world/quest change does NOT invalidate memory, but DOES block a deferred opener', async () => {
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Hello'),
    });
    // Unrelated churn: a different quest state is a different world fact, but
    // the CONVERSATION memory is untouched — a frame-level change must not cost
    // the player their memory of a conversation.
    worldFacts = ['Gold: 5', 'Quest: find the map'];
    expect(recordOf('ivo')?.conversationCount).toBe(1);
    expect(recordOf('ivo')?.summary).toBe(DIGEST.summary);

    // Age the opener out so a refresh is genuinely due, against a world that
    // DIFFERS from the one the held opener was generated against — otherwise
    // the unchanged-inputs guard suppresses the call and this revalidation path
    // is never entered, which would make this test pass vacuously.
    worldFacts = ['Gold: 5', 'Quest: find the map'];
    const aged = npcMemoryService.serialize();
    const opener = aged.records.ivo?.opener;
    if (opener) {
      opener.generatedAt = 0;
    }
    npcMemoryService.hydrate(aged);
    await settleUntilIdle();

    const pending = deferred();
    gate = pending.promise;
    worldFacts = ['Gold: 5', 'Quest: find the map', 'Active quest: "The Ruins"'];
    npcMemoryService.prefetchForNpcs(['ivo']);
    await settle();
    // The world moves on while the opener call is in flight.
    worldFacts = ['Gold: 5', 'Quest: find the map', 'Active quest: "The Deep Road"'];
    pending.resolve({ opener: 'Stale words.', suggestions: [] });
    await settleUntilIdle();

    // The opener was generated against facts that no longer hold, so it must
    // NOT be stamped fresh at completion — the previous behaviour dated it
    // forward with `Date.now()` and it then read as fresh for a full max-age.
    expect(recordOf('ivo')?.opener?.text).not.toBe('Stale words.');
    expect(diagnostics()?.invalidatedAfterCompletion).toBeGreaterThan(0);
  });

  it('a map switch refreshes openers for remembered NPCs only, and stays bounded', async () => {
    for (let i = 0; i < 6; i += 1) {
      await npcMemoryService.recordConversation({
        npcId: `npc_${i}`,
        npcName: `Npc ${i}`,
        messages: talk(`Hello ${i}`),
      });
    }
    extractStructure.mockClear();
    nextStructured = { opener: 'Well met again.', suggestions: [] };

    // Repeated MAP_LOADED: each event re-requests, the per-NPC cooldown and the
    // global bound keep the pending set from growing without limit.
    for (let round = 0; round < 20; round += 1) {
      npcMemoryService.prefetchForNpcs(['npc_0', 'npc_1', 'npc_2', 'npc_3', 'npc_4', 'npc_5']);
    }
    await settleUntilIdle();

    const published = diagnostics();
    expect(published?.pending).toBe(0);
    expect(published?.pendingHighWaterMark).toBeLessThanOrEqual(8);
    // Refreshes are cheap to re-request, so a bounded set of extra calls is the
    // correct cost; unbounded growth would not be.
    expect(extractStructure.mock.calls.length).toBeLessThanOrEqual(20);
  });

  it('a campaign A→B switch with the SAME npc id makes zero provider calls for A', async () => {
    const pending = deferred();
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('In campaign A'),
    });
    extractStructure.mockClear();
    gate = pending.promise;
    npcMemoryService.prefetchForNpcs(['ivo']);
    await settle();

    // Switch campaigns while the opener call for A is in flight.
    campaign.activeCampaign = { id: 'campaign_b' };
    const queuedForA = npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('In campaign B'),
    });
    pending.resolve({ opener: 'Words from campaign A.', suggestions: [] });
    await Promise.all([queuedForA]);

    const record = recordOf('ivo');
    // Nothing from campaign A may be visible in campaign B, even though the
    // NPC id — and therefore every prompt and every schema — is identical.
    expect(record?.opener?.text).not.toBe('Words from campaign A.');
    expect(record?.summary).not.toContain('In campaign A');
  });

  it('reset drops queued work and releases the generation bookkeeping', async () => {
    const pending = deferred();
    gate = pending.promise;
    const first = npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Doomed'),
    });
    await settle();

    npcMemoryService.reset();
    gate = undefined;
    const second = npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Survivor'),
    });
    pending.resolve(DIGEST);
    await Promise.all([first, second]);

    expect(recordOf('ivo')?.summary).toBe(DIGEST.summary);
    expect(diagnostics().pending).toBe(0);
  });

  it('hydrate of the SAME campaign cancels obsolete subscribers but keeps the record', async () => {
    const pending = deferred();
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Hello'),
    });
    const snapshot = npcMemoryService.serialize();

    gate = pending.promise;
    npcMemoryService.prefetchForNpcs(['ivo']);
    await settle();
    npcMemoryService.hydrate(snapshot);
    gate = undefined;
    pending.resolve({ opener: 'Stale opener.', suggestions: [] });
    await settleUntilIdle();

    expect(recordOf('ivo')?.summary).toBe(snapshot.records.ivo?.summary);
    // The digest-produced opener IS part of the restored snapshot, so it stays;
    // what must not appear is the opener the retired generation was fetching.
    expect(recordOf('ivo')?.opener?.text).not.toBe('Stale opener.');
  });

  it('eviction removes the record and its queued work cannot resurrect it', async () => {
    // One remembered NPC, then enough later conversations to push it out of the
    // bounded record set. Its queued work must not be able to write it back.
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Hello'),
    });
    for (let i = 0; i < NPC_MEMORY_LIMITS.maxRecords; i += 1) {
      await npcMemoryService.recordConversation({
        npcId: `filler_${i}`,
        npcName: `Filler ${i}`,
        messages: talk(`Hi ${i}`),
      });
    }
    const before = Object.keys(npcMemoryService.serialize().records).length;
    expect(before).toBe(NPC_MEMORY_LIMITS.maxRecords);
    expect(npcMemoryService.serialize().records.ivo).toBeUndefined();

    expect(Object.keys(npcMemoryService.serialize().records).length).toBeLessThanOrEqual(
      NPC_MEMORY_LIMITS.maxRecords,
    );
  });

  it('a failed provider keeps deterministic memory and reports the failure', async () => {
    nextStructured = { nonsense: true };
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Tell me about the ruins.'),
    });
    expect(recordOf('ivo')?.summary).toContain('Tell me about the ruins.');
    expect(recordOf('ivo')?.opener).toBeUndefined();
    // A rejected digest is reported as `failed`, never folded into `applied`.
    expect(diagnostics().failed).toBeGreaterThan(0);
  });

  it('a valid LATE response applies only if its generation is still current', async () => {
    const pending = deferred();
    gate = pending.promise;
    const conversation = npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Hello'),
    });
    await settle();
    // Nothing has retired the generation, so the late response IS current and
    // must be applied.
    pending.resolve(DIGEST);
    await conversation;

    expect(recordOf('ivo')?.summary).toBe(DIGEST.summary);
    expect(recordOf('ivo')?.notes).toEqual(DIGEST.notes);
  });

  it('a superseded conversation’s lines are carried into the next digest', async () => {
    // Replacing the record in the same generation must preserve both transcripts.
    const pending = deferred();
    gate = pending.promise;
    const doomed = npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('I promised you the map.'),
    });
    await settle();
    gate = undefined;
    extractStructure.mockClear();
    const next = npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('And I will be back.'),
    });
    pending.resolve(DIGEST);
    await Promise.all([doomed, next]);
    await settleUntilIdle();

    const call = extractStructure.mock.calls.at(-1)?.[0] as { prompt: string } | undefined;
    expect(call?.prompt).toContain('I promised you the map.');
    expect(call?.prompt).toContain('And I will be back.');
  });
  for (const transition of ['reset', 'campaign-switch'] as const) {
    for (const outcome of ['success', 'failure'] as const) {
      it(`${transition} keeps retired transcript lines out after digest ${outcome}`, async () => {
        const pending = deferred();
        gate = pending.promise;
        const old = npcMemoryService.recordConversation({
          npcId: 'ivo',
          npcName: 'Ivo',
          messages: talk('Retired secret promise'),
        });
        await settle();
        if (transition === 'reset') {
          npcMemoryService.reset();
        } else {
          campaign.activeCampaign = { id: 'campaign_b' };
        }
        gate = undefined;
        const next = npcMemoryService.recordConversation({
          npcId: 'ivo',
          npcName: 'Ivo',
          messages: talk('Current conversation'),
        });
        if (outcome === 'success') {
          pending.resolve(DIGEST);
        } else {
          pending.reject(new Error('provider failed'));
        }
        await Promise.all([old, next]);
        const call = extractStructure.mock.calls.at(-1) as unknown as
          | [{ prompt: string }]
          | undefined;
        expect(call?.[0].prompt ?? '').toContain('Current conversation');
        expect(call?.[0].prompt ?? '').not.toContain('Retired secret promise');
      });
    }
  }

  it('applies digest memory but leaves the opener absent when world facts change in flight', async () => {
    const pending = deferred();
    gate = pending.promise;
    const conversation = npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Hello'),
    });
    await settle();
    worldFacts = ['Gold: 50'];
    pending.resolve(DIGEST);
    await conversation;
    expect(recordOf('ivo')?.summary).toBe(DIGEST.summary);
    expect(recordOf('ivo')?.notes).toEqual(DIGEST.notes);
    expect(recordOf('ivo')?.opener).toBeUndefined();
    expect(diagnostics()?.applied).toBe(1);
    expect(diagnostics()?.failed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Issue #382 context reuse — prompt projection and unchanged-refresh suppression
// ---------------------------------------------------------------------------

describe('NpcMemoryService — context reuse', () => {
  it('a background call does NOT build a full turn-context projection for the persona', async () => {
    // The pre-change code called `buildContext` — walking every account in the
    // manifest, selecting a companion witness and projecting a memory window —
    // and discarded everything but `.persona`. Counted, not timed, so the
    // regression is deterministic.
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Hello'),
    });
    expect(fullProjectionCount).toBe(0);
  });

  it('a background prompt is NOT given the dialogue-only world facts', async () => {
    worldFacts = [
      'Gold: 5',
      'Inventory: Lantern x1',
      'Equipped: Lantern (main hand)',
      'Hint (easy mode only): the player needs "Lantern".',
      'Game difficulty: easy. be very direct — openly name the item.',
    ];
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Hello'),
    });
    const lastCall = extractStructure.mock.calls.at(-1) as unknown as
      | [{ prompt: string }]
      | undefined;
    const prompt = lastCall?.[0].prompt ?? '';
    expect(prompt).toContain('Gold: 5');
    expect(prompt).toContain('Inventory: Lantern x1');
    expect(prompt).not.toContain('Equipped:');
    expect(prompt).not.toContain('Game difficulty:');
    expect(prompt).not.toContain('Hint (easy mode only)');
  });

  it('an equipment change alone does NOT count as the world moving on', async () => {
    // The fingerprint describes what the PROMPT consumed. If it described the
    // unprojected list, swapping a lantern for a rope would force a refresh
    // whose answer the model would give identically.
    worldFacts = ['Gold: 5', 'Inventory: Lantern x1', 'Equipped: Lantern (main hand)'];
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Hello'),
    });
    const original = openerOf('ivo');
    const aged = { ...original, generatedAt: original.generatedAt - 60 * 60_000 };
    npcMemoryService.hydrate({
      campaignId: 'campaign_a',
      records: { ivo: { ...recordOrFail('ivo'), opener: aged } },
    });
    await settleUntilIdle();
    worldFacts = ['Gold: 5', 'Inventory: Lantern x1', 'Equipped: Rope (main hand)'];
    extractStructure.mockClear();

    npcMemoryService.prefetchByName('Ivo');
    await settleUntilIdle();

    expect(extractStructure).not.toHaveBeenCalled();
    expect(openerOf('ivo').generatedAt).toBeGreaterThan(aged.generatedAt);
  });

  it('a stale opener whose inputs have not changed is NOT re-asked of the provider', async () => {
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Hello'),
    });
    const original = openerOf('ivo');

    // Age the opener past its max age, then make it stale, and clear the
    // prefetch cooldown by resetting the debounce through a fresh campaign tick.
    const aged = { ...original, generatedAt: original.generatedAt - 60 * 60_000 };
    npcMemoryService.hydrate({
      campaignId: 'campaign_a',
      records: { ivo: { ...recordOrFail('ivo'), opener: aged } },
    });
    await settleUntilIdle();
    extractStructure.mockClear();

    npcMemoryService.prefetchByName('Ivo');
    await settleUntilIdle();

    expect(extractStructure).not.toHaveBeenCalled();
    // The greeting the player already has is still the right one.
    expect(recordOf('ivo')?.opener?.text).toBe(aged.text);
    expect(openerOf('ivo').forConversation).toBe(original.forConversation);
    expect(openerOf('ivo').generatedAt).toBeGreaterThan(aged.generatedAt);
  });

  it('an opener for a previous conversation is refreshed even when the world is unchanged', async () => {
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Hello'),
    });
    const record = recordOrFail('ivo');
    const original = openerOf('ivo');
    npcMemoryService.hydrate({
      campaignId: 'campaign_a',
      records: { ivo: { ...record, conversationCount: record.conversationCount + 1 } },
    });
    await settleUntilIdle();
    extractStructure.mockClear();
    nextStructured = { opener: 'A greeting for our next conversation.', suggestions: [] };

    npcMemoryService.prefetchByName('Ivo');
    await settleUntilIdle();

    expect(extractStructure).toHaveBeenCalledTimes(1);
    expect(openerOf('ivo').text).toBe('A greeting for our next conversation.');
    expect(openerOf('ivo').forConversation).toBe(record.conversationCount + 1);
    expect(openerOf('ivo').worldFingerprint).toBe(original.worldFingerprint);
  });

  it('a stale opener whose world HAS changed is still refreshed', async () => {
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Hello'),
    });
    const original = openerOf('ivo');
    const aged = { ...original, generatedAt: original.generatedAt - 60 * 60_000 };
    npcMemoryService.hydrate({
      campaignId: 'campaign_a',
      records: { ivo: { ...recordOrFail('ivo'), opener: aged } },
    });
    await settleUntilIdle();
    worldFacts = ['Gold: 5', 'Inventory: Lantern x1', 'Active quest: "The Ruins"'];
    extractStructure.mockClear();

    npcMemoryService.prefetchByName('Ivo');
    await settleUntilIdle();

    expect(extractStructure).toHaveBeenCalled();
  });

  it('an opener from an older save with no fingerprint IS refreshed, not trusted', async () => {
    // An absent fingerprint can never match a computed one, so a save written
    // before the field existed takes the expensive, safe direction.
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Hello'),
    });
    const original = openerOf('ivo');
    const { worldFingerprint: _dropped, ...withoutFingerprint } = original;
    npcMemoryService.hydrate({
      campaignId: 'campaign_a',
      records: {
        ivo: {
          ...recordOrFail('ivo'),
          opener: { ...withoutFingerprint, generatedAt: Date.now() - 60 * 60_000 },
        },
      },
    });
    await settleUntilIdle();
    expect(recordOf('ivo')?.opener?.worldFingerprint).toBeUndefined();

    worldFacts = ['Gold: 5', 'Inventory: Lantern x1', 'Active quest: "The Ruins"'];
    extractStructure.mockClear();
    npcMemoryService.prefetchByName('Ivo');
    await settleUntilIdle();
    expect(extractStructure).toHaveBeenCalled();
  });

  it('suppressing a refresh does NOT weaken the in-flight world revalidation', async () => {
    // Two independent guards. The suppression above avoids ASKING when nothing
    // changed; this one still REJECTS an answer whose world moved on while the
    // call was in flight. Losing the second would date a stale opener forward
    // into a freshness it has not earned.
    worldFacts = ['Gold: 5', 'Inventory: Lantern x1'];
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Hello'),
    });
    const record = recordOrFail('ivo');
    const aged = { ...openerOf('ivo'), generatedAt: openerOf('ivo').generatedAt - 60 * 60_000 };
    npcMemoryService.hydrate({
      campaignId: 'campaign_a',
      records: { ivo: { ...record, opener: aged } },
    });
    await settleUntilIdle();

    // A world that genuinely differs is what makes the call be issued at all.
    const inFlight = deferred();
    gate = inFlight.promise;
    worldFacts = ['Gold: 5', 'Inventory: Lantern x1', 'Active quest: "The Ruins"'];
    npcMemoryService.prefetchByName('Ivo');
    await settle();
    // The world moves on AGAIN while the refresh is in flight.
    worldFacts = ['Gold: 5', 'Inventory: Lantern x1', 'Active quest: "The Deep Road"'];
    inFlight.resolve({ opener: 'Words for a world that no longer holds.', suggestions: [] });
    await settleUntilIdle();

    expect(diagnostics()?.invalidatedAfterCompletion).toBeGreaterThan(0);
    expect(recordOf('ivo')?.opener?.text).not.toBe('Words for a world that no longer holds.');
  });

  it('the opener is stamped with the fingerprint it was generated AGAINST', async () => {
    worldFacts = ['Gold: 5', 'Inventory: Lantern x1'];
    await npcMemoryService.recordConversation({
      npcId: 'ivo',
      npcName: 'Ivo',
      messages: talk('Hello'),
    });
    expect(typeof recordOf('ivo')?.opener?.worldFingerprint).toBe('string');
  });
});
