// apps/frontend/client/src/browser_tests/journal_recap.browser.test.ts
import { flushSync, mount, unmount } from 'svelte';
import { expect, test } from 'vitest';
import { buildConversationRecap } from '../lib/utils/journal/conversation_recap.ts';
import JournalView from '../lib/views/journal/journal_view.svelte';
import { createJournalViewModel } from '../lib/views/journal/journal_view_model.svelte';
import { JournalRecapFixture } from './journal_recap_fixture.svelte';

test('compiled Journal reacts to conversation arrival and diary choice, preserving objective facts', async () => {
  const state = new JournalRecapFixture();
  const viewModel = createJournalViewModel({
    className: 'JournalRecapBrowserTest',
    questState: { quests: [], journalEntries: [] },
    notes: {
      get entries() {
        return state.entries;
      },
      loadEntries: async () => {},
      createEntry: async () => {
        throw new Error('Not used');
      },
      updateEntry: async () => {},
      deleteEntry: async () => {},
    },
    recap: { summary: null },
    campaign: { campaignId: 'campaign-a', sessionNumber: 1 },
    overlays: { closeJournal: () => {} },
    diary: state,
  });
  viewModel.setActiveTab('recaps');
  const target = document.createElement('div');
  document.body.append(target);
  const component = mount(JournalView, { target, props: { viewModel, embedded: true } });
  const { prose, cleanup } = state.observe(() => viewModel.conversationRecaps[0]?.prose ?? '');
  flushSync();
  expect(target.textContent).toContain('No session recap yet');
  viewModel.setSearchQuery('unmatched');
  flushSync();
  expect(target.textContent).toContain('No session recap yet');
  expect(viewModel.conversationRecapCount).toBe(0);
  viewModel.setSearchQuery('');
  const recap = buildConversationRecap({
    npcName: 'Ana',
    messages: [
      { role: 'player', content: 'Where is the tavern?' },
      { role: 'npc', content: 'Near the road.' },
    ],
  });
  state.entries = [
    {
      id: 'recap-1',
      campaignId: 'campaign-a',
      sessionNumber: 1,
      title: 'Conversation with Ana',
      content: JSON.stringify(recap),
      tags: ['conversation-recap'],
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ];
  flushSync();
  expect(prose.at(-1)).toContain('Talked with Ana.');
  expect(viewModel.notes).toHaveLength(0);
  expect(target.textContent).toContain('Talked with Ana.');
  const checkbox = target.querySelector<HTMLInputElement>('#journal-diary-voice');
  expect(checkbox).not.toBeNull();
  checkbox?.click();
  flushSync();
  expect(target.textContent).toContain('I talked with Ana.');
  expect(target.textContent).toContain('Objective record');
  expect(prose.at(-1)).toContain('I talked with Ana.');
  expect(viewModel.conversationRecaps[0]?.objective).toContain('The player said:');
  expect(viewModel.conversationRecaps[0]?.prose).toContain('Ana said: “Near the road.”');
  expect(viewModel.conversationRecapCount).toBe(1);
  viewModel.setSearchQuery('unmatched');
  flushSync();
  expect(viewModel.conversationRecaps).toHaveLength(0);
  expect(viewModel.conversationRecapCount).toBe(1);
  expect(target.textContent).toContain('No matching recaps');
  expect(target.textContent).toContain('Clear the search');
  expect(target.textContent).not.toContain('No session recap yet');
  viewModel.setSearchQuery('   ');
  flushSync();
  expect(target.textContent).not.toContain('No matching recaps');
  expect(target.textContent).toContain('I talked with Ana.');
  cleanup();
  await unmount(component);
  target.remove();
});
