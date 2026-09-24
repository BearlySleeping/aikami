// apps/frontend/client/src/lib/services/npc/npc_memory_service.test.ts
//
// Unit tests for NpcMemoryService — capture, digest, returning greeting,
// prompt projection, prefetch staleness, campaign scoping and save round-trip.

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { NPC_MEMORY_LIMITS } from '@aikami/constants';
import type { NpcMemoryServiceInterface } from './npc_memory_service.svelte.ts';

// ── Mocks ──────────────────────────────────────────────────────────────────

const campaign = { activeCampaign: { id: 'campaign_a' } as { id: string } | undefined };

let nextStructured: unknown = {};
const extractStructure = mock(async () => nextStructured);

mock.module('../ai/text_generation_service.svelte.ts', () => ({
  textGenerationService: { extractStructure },
}));
mock.module('../campaign/campaign_service.svelte.ts', () => ({
  campaignService: campaign,
}));
mock.module('../game/game_state_facts.ts', () => ({
  buildGameStateFacts: () => ['Gold: 5'],
}));
mock.module('../game/npc_dialogue_service.svelte.ts', () => ({
  npcDialogueService: {
    buildContext: () => ({ persona: 'A gruff cartographer.' }),
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
