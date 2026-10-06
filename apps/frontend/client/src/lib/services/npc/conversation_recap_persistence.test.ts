// apps/frontend/client/src/lib/services/npc/conversation_recap_persistence.test.ts
import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { readConversationRecap } from '$lib/utils/journal/conversation_recap.ts';
import { createRealLocalDatabase } from '../__tests__/local_database_fixture.ts';

const fixture = await createRealLocalDatabase();
const storage = await import('@aikami/frontend/storage');
mock.module('@aikami/frontend/storage', () => ({
  ...storage,
  getLocalDatabase: async () => fixture.db,
}));
const campaign = { activeCampaign: { id: 'campaign-a' } };
mock.module('../campaign/campaign_service.svelte.ts', () => ({ campaignService: campaign }));
const { playerJournalService } = await import('../game/player_journal_service.svelte.ts');
const { createConversationRecapService } = await import('./conversation_recap_service.svelte.ts');
mock.module('../game/world_state_service.svelte.ts', () => ({
  worldStateService: { worldGenOutput: { worldName: 'Emberwatch' } },
}));
const { sessionSummaryService } = await import('../gm/session_summary_service.svelte.ts');

beforeEach(async () => {
  await fixture.reset();
  playerJournalService.reset();
  sessionSummaryService.clearSummary();
  campaign.activeCampaign = { id: 'campaign-a' };
});
afterAll(() => fixture.close());

const conversation = {
  npcId: 'ana',
  npcName: 'Ana',
  sessionNumber: 4,
  messages: [
    { role: 'npc', content: 'Hello.' },
    { role: 'player', content: 'Where can I rest?' },
    { role: 'npc', content: 'A tavern stands near the road.' },
  ] as const,
};

test('records directly to real device SQLite and reloads both objective and diary evidence', async () => {
  const recorder = createConversationRecapService({ className: 'ConversationRecapService' });
  await recorder.recordConversation(conversation);
  playerJournalService.reset();
  await playerJournalService.loadEntries({ campaignId: 'campaign-a' });
  expect(playerJournalService.entries).toHaveLength(1);
  expect(playerJournalService.entries[0]?.sessionNumber).toBe(4);
  const recap = readConversationRecap(playerJournalService.entries[0]);
  expect(recap?.objective).toContain('Ana said: “A tavern stands near the road.”');
  expect(recap?.diary).toContain('I talked with Ana.');
});

test('session summaries use recorded evidence without a provider and reject stale campaign results', async () => {
  const recorder = createConversationRecapService({ className: 'ConversationRecapService' });
  await recorder.recordConversation(conversation);
  expect(sessionSummaryService.hasDialogue).toBe(true);
  const summary = await sessionSummaryService.generateSummary(10);
  expect(summary.synopsis).toContain('A tavern stands near the road.');
  expect(summary.keyEvents).toEqual(['Conversation with Ana']);
  const pending = sessionSummaryService.generateSummary(10);
  campaign.activeCampaign = { id: 'campaign-b' };
  await expect(pending).rejects.toThrow('invalidated');
  expect(sessionSummaryService.currentSummary).toBeNull();
  campaign.activeCampaign = { id: 'campaign-a' };
  expect(sessionSummaryService.currentSummary?.id).toBe(summary.id);
});

test('diary preference restores in a fresh recorder', () => {
  const recorder = createConversationRecapService({ className: 'ConversationRecapService' });
  recorder.setDiaryVoice(true);
  expect(createConversationRecapService({ className: 'ConversationRecapService' }).diaryVoice).toBe(
    true,
  );
  recorder.setDiaryVoice(false);
});

test('a pending old-campaign write persists there but does not contaminate newly hydrated state', async () => {
  const recorder = createConversationRecapService({ className: 'ConversationRecapService' });
  const pending = recorder.recordConversation(conversation);
  campaign.activeCampaign = { id: 'campaign-b' };
  playerJournalService.hydrate({ entries: [] });
  await pending;
  expect(playerJournalService.entries).toEqual([]);
  await playerJournalService.loadEntries({ campaignId: 'campaign-b' });
  expect(playerJournalService.entries).toEqual([]);
  await playerJournalService.loadEntries({ campaignId: 'campaign-a' });
  expect(playerJournalService.entries).toHaveLength(1);
});
