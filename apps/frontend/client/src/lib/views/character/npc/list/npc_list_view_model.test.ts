// apps/frontend/client/src/lib/views/character/npc/list/npc_list_view_model.test.ts
//
// Unit tests for the NPC list ViewModel built from explicit capabilities.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setDialogCapabilities } from '@aikami/frontend/services/base';
import { generateMockNpc } from '@aikami/mocks';
import { createNpcListViewModel, type NpcListViewModelOptions } from './npc_list_view_model.svelte';

const previousDialogCapabilities: Array<ReturnType<typeof setDialogCapabilities>> = [];

beforeEach(() => {
  previousDialogCapabilities.push(
    setDialogCapabilities({
      showSnackbar: () => {},
      showConditionalSnackbar: () => {},
      setAppLoading: () => {},
      open: async () => undefined,
    }),
  );
});

afterEach(() => {
  setDialogCapabilities(previousDialogCapabilities.pop());
});

const npc = (id: string, name: string) => ({ ...generateMockNpc(), id, name });

const createOptions = (
  overrides: Partial<NpcListViewModelOptions> = {},
): NpcListViewModelOptions => ({
  className: 'NpcListViewModelTest',
  auth: { currentUser: { id: 'u1' } },
  npcs: {
    getSystemNpcs: async () => [npc('sys-1', 'System One')],
    getUserNpcs: async () => [npc('user-1', 'User One')],
    getPublicNpcs: async () => [npc('pub-1', 'Public One')],
    importFromFile: async () => 'imported',
    importFromUrl: async () => 'imported',
    createNpc: async () => 'created',
    forkNpc: async () => 'forked',
    deleteNpc: async () => {},
    get: async () => undefined,
    updateNpc: async () => {},
  },
  chats: {
    deleteChatById: async () => {},
    getOrCreateChat: async () => {
      throw new Error('unused in this test');
    },
  },
  router: { goToRoute: async () => {} },
  ...overrides,
});

describe('NpcListViewModel', () => {
  test('initialize loads system, user, and public NPCs', async () => {
    const viewModel = createNpcListViewModel(createOptions());
    await viewModel.initialize();

    expect(viewModel.systemNpcs.map((n) => n.id)).toEqual(['sys-1']);
    expect(viewModel.userNpcs.map((n) => n.id)).toEqual(['user-1']);
    expect(viewModel.publicNpcs.map((n) => n.id)).toEqual(['pub-1']);
    // "all" tab merges system + user, excluding public.
    expect(viewModel.npcs.map((n) => n.id)).toEqual(['sys-1', 'user-1']);
  });

  test('setActiveTab switches the visible list', async () => {
    const viewModel = createNpcListViewModel(createOptions());
    await viewModel.initialize();

    viewModel.setActiveTab('public');
    expect(viewModel.npcs.map((n) => n.id)).toEqual(['pub-1']);

    viewModel.setActiveTab('mine');
    expect(viewModel.npcs.map((n) => n.id)).toEqual(['user-1']);
  });

  test('getTabCount reports per-tab totals', async () => {
    const viewModel = createNpcListViewModel(createOptions());
    await viewModel.initialize();

    expect(viewModel.getTabCount('all')).toBe(2);
    expect(viewModel.getTabCount('mine')).toBe(1);
    expect(viewModel.getTabCount('public')).toBe(1);
    expect(viewModel.getTabCount('system')).toBe(1);
  });

  test('currentUserId reads through the injected identity capability', () => {
    const viewModel = createNpcListViewModel(createOptions());
    expect(viewModel.currentUserId).toBe('u1');
  });
});
