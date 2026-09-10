// apps/frontend/client/src/lib/views/chat/connected_chats_panel_view_model.test.ts
//
// Connected Chats panel ViewModel — capability-backed link/note/influence ops.

import { describe, expect, test } from 'bun:test';
import type { ChatLink } from '@aikami/types';
import {
  type ConnectedChatsCapabilities,
  createConnectedChatsPanelViewModel,
} from './connected_chats_panel_view_model.svelte';

const makeLink = (overrides: Partial<ChatLink> = {}): ChatLink =>
  ({
    linkId: 'link-1',
    notes: [],
    pendingInfluences: [],
    updatedAt: 0,
    ...overrides,
  }) as unknown as ChatLink;

const createVm = (
  overrides: Partial<ConnectedChatsCapabilities> = {},
): { vm: ReturnType<typeof createConnectedChatsPanelViewModel>; calls: string[] } => {
  const calls: string[] = [];
  const connectedChats: ConnectedChatsCapabilities = {
    getActiveLink: async () => makeLink(),
    createLink: async () => makeLink({ linkId: 'link-new' }),
    unlink: async () => {
      calls.push('unlink');
    },
    addNote: async () => {
      calls.push('addNote');
    },
    removeNote: async () => {
      calls.push('removeNote');
    },
    addInfluence: async () => {
      calls.push('addInfluence');
    },
    removeInfluence: async () => {
      calls.push('removeInfluence');
    },
    ...overrides,
  };
  const vm = createConnectedChatsPanelViewModel({
    className: 'ConnectedChatsPanelViewModel',
    targetChatId: 'game-chat',
    connectedChats,
  });
  return { vm, calls };
};

describe('ConnectedChatsPanelViewModel', () => {
  test('loadLinkData stores the active link', async () => {
    const { vm } = createVm();
    await vm.loadLinkData();
    expect(vm.activeLink?.linkId).toBe('link-1');
    expect(vm.isLoading).toBe(false);
  });

  test('loadLinkData surfaces a failure without throwing', async () => {
    const { vm } = createVm({
      getActiveLink: async () => {
        throw new Error('nope');
      },
    });
    await vm.loadLinkData();
    expect(vm.errorMessage).toBe('Failed to load link data');
  });

  test('linkChat stores the created link', async () => {
    const { vm } = createVm();
    await vm.linkChat({ sourceChatId: 'ooc', sourceChatName: 'OOC' });
    expect(vm.activeLink?.linkId).toBe('link-new');
    expect(vm.isLinking).toBe(false);
  });

  test('addNote optimistically appends and clears the input', async () => {
    const { vm, calls } = createVm();
    await vm.loadLinkData();
    vm.newNoteText = '  remember  ';
    await vm.addNote();
    expect(calls).toContain('addNote');
    expect(vm.activeLink?.notes).toEqual(['remember']);
    expect(vm.newNoteText).toBe('');
  });

  test('unlinkChat clears the active link', async () => {
    const { vm, calls } = createVm();
    await vm.loadLinkData();
    await vm.unlinkChat();
    expect(calls).toContain('unlink');
    expect(vm.activeLink).toBeUndefined();
  });
});
