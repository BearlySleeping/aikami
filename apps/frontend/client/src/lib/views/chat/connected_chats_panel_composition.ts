// apps/frontend/client/src/lib/views/chat/connected_chats_panel_composition.ts
//
// Production wiring for the Connected Chats panel ViewModel.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { connectedChatsService } from '$services';
import {
  type ConnectedChatsPanelViewModelInterface,
  createConnectedChatsPanelViewModel,
} from './connected_chats_panel_view_model.svelte.ts';

export type ConnectedChatsPanelCompositionOptions = BaseViewModelOptions & {
  targetChatId: string;
};

export const getConnectedChatsPanelViewModel = (
  options: ConnectedChatsPanelCompositionOptions,
): ConnectedChatsPanelViewModelInterface =>
  createConnectedChatsPanelViewModel({ ...options, connectedChats: connectedChatsService });
