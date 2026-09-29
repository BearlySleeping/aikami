// apps/frontend/client/src/lib/services/game/game_test_seam_dialogue_probes.test.ts
import { beforeEach, expect, mock, test } from 'bun:test';
import { NpcMemoryStateSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';

const extractStructure = mock(async () => ({ opener: 'Welcome back.', suggestions: [] }));
const generateTurn = mock(
  async (): Promise<unknown> => ({
    narrative: 'Hello.',
    choices: [],
    source: 'ai',
  }),
);

mock.module('../ai/text_generation_service.svelte.ts', () => ({
  textGenerationService: { extractStructure },
}));
mock.module('../campaign/campaign_service.svelte.ts', () => ({
  campaignService: { activeCampaign: { id: 'benchmark-campaign' } },
}));
mock.module('./game_state_facts.ts', () => ({ buildGameStateFacts: () => [] }));
mock.module('./npc_dialogue_service.svelte.ts', () => ({
  npcDialogueService: {
    generateTurn,
    buildContext: () => ({ persona: 'A village elder.' }),
  },
}));
mock.module('./serializable_service', () => ({ registerSerializable: () => {} }));

const { npcMemoryService } = await import('../npc/npc_memory_service.svelte.ts');
const { prepareNpcPrefetchProbe, runDialogueTurnProbe, runNpcPrefetchBurstProbe } = await import(
  './game_test_seam_dialogue_probes.ts'
);

beforeEach(() => {
  npcMemoryService.reset();
  extractStructure.mockClear();
});

test('prefetch probe restores valid missing openers and dispatches on every repetition', async () => {
  const npcIds = ['elder', 'merchant'];
  for (let repetition = 0; repetition < 3; repetition++) {
    prepareNpcPrefetchProbe({ npcIds, npcNames: { elder: 'Village Elder' } });
    const snapshot = npcMemoryService.serialize();
    expect(Value.Check(NpcMemoryStateSchema, snapshot)).toBe(true);
    expect(snapshot.campaignId).toBe('benchmark-campaign');
    expect(snapshot.records.elder?.npcName).toBe('Village Elder');
    expect(snapshot.records.merchant?.npcName).toBe('merchant');
    for (const npcId of npcIds) {
      expect(snapshot.records[npcId]?.opener).toBeUndefined();
    }
    // Setup must never spend provider calls, even after a successful refresh.
    expect(extractStructure).toHaveBeenCalledTimes(repetition * npcIds.length);
    await runNpcPrefetchBurstProbe({ npcIds });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(extractStructure).toHaveBeenCalledTimes((repetition + 1) * npcIds.length);
    for (const npcId of npcIds) {
      expect(npcMemoryService.serialize().records[npcId]?.opener?.text).toBe('Welcome back.');
    }
  }
});

test('dialogue probe rejects invalid fields that pass the old handwritten checks', async () => {
  generateTurn.mockResolvedValueOnce({ narrative: 'Hello.', choices: [], source: 'ai' });
  const options = { npcId: 'elder', npcName: 'Village Elder', playerLine: 'Hello.' };
  expect((await runDialogueTurnProbe(options)).schemaValid).toBe(true);
  generateTurn.mockResolvedValueOnce({
    narrative: 'Hello.',
    choices: [{ id: 'greeting', label: 42 }],
    source: 'ai',
  });
  expect((await runDialogueTurnProbe(options)).schemaValid).toBe(false);
});
