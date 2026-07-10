// apps/frontend/client/src/lib/views/chat/connected_chats_panel_view_model.svelte.ts
//
// ViewModel for the Connected Chats settings panel. Manages
// ChatLink creation, unlinking, note/influence editing, and
// connected status display.
//
// Contract: C-244 Connected Chats Cross-Mode Bridge

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { ChatLink } from '@aikami/types';
import { connectedChatsService } from '$services';

export type ConnectedChatsPanelViewModelInterface = BaseViewModelInterface & {
  /** The active ChatLink, or undefined if no link exists. */
  readonly activeLink: ChatLink | undefined;
  /** Whether the link data is loading. */
  readonly isLoading: boolean;
  /** List of available Conversation-mode chats to link to. */
  readonly availableOocChats: ReadonlyArray<{ id: string; name: string }>;
  /** Whether the link/unlink operation is in progress. */
  readonly isLinking: boolean;
  /** Error message from the last operation. */
  readonly errorMessage: string | undefined;
  /** New note text input. */
  newNoteText: string;
  /** New influence text input. */
  newInfluenceText: string;

  /** Loads the active link and available chats. */
  loadLinkData(): Promise<void>;
  /** Creates a link between this game chat and a selected OOC chat. */
  linkChat(options: { sourceChatId: string; sourceChatName: string }): Promise<void>;
  /** Soft-deactivates the current link. */
  unlinkChat(): Promise<void>;
  /** Adds a note to the active link. */
  addNote(): Promise<void>;
  /** Removes a note by index. */
  removeNote(options: { index: number }): Promise<void>;
  /** Adds an influence to the active link. */
  addInfluence(): Promise<void>;
  /** Removes an influence by index. */
  removeInfluence(options: { index: number }): Promise<void>;
};

export type ConnectedChatsPanelViewModelOptions = BaseViewModelOptions & {
  /** The game (target) chat ID this panel manages links for. */
  targetChatId: string;
};

class ConnectedChatsPanelViewModel
  extends BaseViewModel<ConnectedChatsPanelViewModelOptions>
  implements ConnectedChatsPanelViewModelInterface
{
  activeLink: ChatLink | undefined = $state(undefined);
  isLoading = $state(false);
  availableOocChats = $state<ReadonlyArray<{ id: string; name: string }>>([]);
  isLinking = $state(false);
  errorMessage: string | undefined = $state(undefined);
  newNoteText = $state('');
  newInfluenceText = $state('');

  private get _targetChatId(): string {
    return this._options.targetChatId;
  }

  async loadLinkData(): Promise<void> {
    this.isLoading = true;
    try {
      this.activeLink = await connectedChatsService.getActiveLink({
        targetChatId: this._targetChatId,
      });
    } catch {
      this.errorMessage = 'Failed to load link data';
    } finally {
      this.isLoading = false;
    }
  }

  async linkChat(options: { sourceChatId: string; sourceChatName: string }): Promise<void> {
    this.isLinking = true;
    this.errorMessage = undefined;
    try {
      const link = await connectedChatsService.createLink({
        sourceChatId: options.sourceChatId,
        targetChatId: this._targetChatId,
      });
      this.activeLink = link;
      this.debug('linkChat: created', {
        sourceChatId: options.sourceChatId,
        sourceChatName: options.sourceChatName,
      });
    } catch {
      this.errorMessage = 'Failed to create link';
    } finally {
      this.isLinking = false;
    }
  }

  async unlinkChat(): Promise<void> {
    if (!this.activeLink) {
      return;
    }
    this.isLinking = true;
    this.errorMessage = undefined;
    try {
      await connectedChatsService.unlink({
        linkId: this.activeLink.linkId,
        targetChatId: this._targetChatId,
      });
      this.activeLink = undefined;
    } catch {
      this.errorMessage = 'Failed to unlink chat';
    } finally {
      this.isLinking = false;
    }
  }

  async addNote(): Promise<void> {
    if (!this.activeLink || !this.newNoteText.trim()) {
      return;
    }
    try {
      await connectedChatsService.addNote({
        linkId: this.activeLink.linkId,
        targetChatId: this._targetChatId,
        note: this.newNoteText.trim(),
      });
      // Optimistically update local state
      this.activeLink = {
        ...this.activeLink,
        notes: [...this.activeLink.notes, this.newNoteText.trim()],
        updatedAt: Date.now(),
      };
      this.newNoteText = '';
    } catch {
      this.errorMessage = 'Failed to add note';
    }
  }

  async removeNote(options: { index: number }): Promise<void> {
    if (!this.activeLink) {
      return;
    }
    try {
      await connectedChatsService.removeNote({
        linkId: this.activeLink.linkId,
        targetChatId: this._targetChatId,
        index: options.index,
      });
      // Optimistically update local state
      const newNotes = this.activeLink.notes.filter((_, i) => i !== options.index);
      this.activeLink = { ...this.activeLink, notes: newNotes, updatedAt: Date.now() };
    } catch {
      this.errorMessage = 'Failed to remove note';
    }
  }

  async addInfluence(): Promise<void> {
    if (!this.activeLink || !this.newInfluenceText.trim()) {
      return;
    }
    try {
      await connectedChatsService.addInfluence({
        linkId: this.activeLink.linkId,
        targetChatId: this._targetChatId,
        influence: this.newInfluenceText.trim(),
      });
      this.activeLink = {
        ...this.activeLink,
        pendingInfluences: [...this.activeLink.pendingInfluences, this.newInfluenceText.trim()],
        updatedAt: Date.now(),
      };
      this.newInfluenceText = '';
    } catch {
      this.errorMessage = 'Failed to add influence';
    }
  }

  async removeInfluence(options: { index: number }): Promise<void> {
    if (!this.activeLink) {
      return;
    }
    try {
      await connectedChatsService.removeInfluence({
        linkId: this.activeLink.linkId,
        targetChatId: this._targetChatId,
        index: options.index,
      });
      const newInfluences = this.activeLink.pendingInfluences.filter((_, i) => i !== options.index);
      this.activeLink = {
        ...this.activeLink,
        pendingInfluences: newInfluences,
        updatedAt: Date.now(),
      };
    } catch {
      this.errorMessage = 'Failed to remove influence';
    }
  }
}

export const getConnectedChatsPanelViewModel = (
  options: ConnectedChatsPanelViewModelOptions,
): ConnectedChatsPanelViewModelInterface => ConnectedChatsPanelViewModel.create(options);
