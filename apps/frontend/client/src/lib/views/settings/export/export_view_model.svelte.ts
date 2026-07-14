// apps/frontend/client/src/lib/views/settings/export/export_view_model.svelte.ts
//
// ViewModel for the Export & Data settings tab (C-246, AC-6).
// Bridges the exportService to the settings UI — lists chats, characters,
// sessions, and provides download triggers for all export operations.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { ChatData, NpcData, PersonaData } from '@aikami/types';
import type { GameSession } from '$lib/services/game/session_service.svelte';
import { exportService } from '$services';

// ── Types ───────────────────────────────────────────────────────────────

/** A display-ready character entry combining NPCs and personas. */
export type ExportableCharacter = {
  id: string;
  name: string;
  type: 'character' | 'npc' | 'persona';
  avatarUrl?: string;
  source: NpcData | PersonaData;
};

/** A display-ready session entry. */
export type ExportableSession = GameSession;

// ── Interface ───────────────────────────────────────────────────────────

export type ExportViewModelInterface = BaseViewModelInterface & {
  /** All chats available for export. */
  readonly chats: ChatData[];
  /** All characters available for export. */
  readonly characters: ExportableCharacter[];
  /** All completed sessions available for EPUB export. */
  readonly sessions: ExportableSession[];
  /** Whether data is loading. */
  readonly isLoading: boolean;
  /** Backup progress message. */
  readonly backupProgress: string;

  // ── Chat exports ──
  exportChatAsJsonl(chat: ChatData): Promise<void>;
  exportChatAsPlainText(chat: ChatData): Promise<void>;

  // ── Character exports ──
  exportCharacterAsJson(character: ExportableCharacter): Promise<void>;
  exportCharacterAsPng(character: ExportableCharacter): Promise<void>;

  // ── Session exports ──
  exportSessionAsEpub(session: ExportableSession): Promise<void>;

  // ── Bulk backup ──
  exportBulkBackup(): Promise<void>;

  /** Formats a Firestore Timestamp or ISO string to a locale date. */
  formatDate(timestamp: unknown): string;
};

// ── Options ─────────────────────────────────────────────────────────────

export type ExportViewModelOptions = BaseViewModelOptions;

// ── Implementation ──────────────────────────────────────────────────────

export class ExportViewModel
  extends BaseViewModel<ExportViewModelOptions>
  implements ExportViewModelInterface
{
  chats: ChatData[] = $state([]);
  characters: ExportableCharacter[] = $state([]);
  sessions: ExportableSession[] = $state([]);
  isLoading = $state(false);
  backupProgress = $state('');

  override async initialize(): Promise<void> {
    this.isLoading = true;
    try {
      await this._loadData();
    } finally {
      this.isLoading = false;
    }
    await super.initialize();
  }

  // ── Chat exports ────────────────────────────────────────────────────

  async exportChatAsJsonl(chat: ChatData): Promise<void> {
    await exportService.exportChatAsJsonl({ chat });
  }

  async exportChatAsPlainText(chat: ChatData): Promise<void> {
    await exportService.exportChatAsPlainText({ chat });
  }

  // ── Character exports ───────────────────────────────────────────────

  async exportCharacterAsJson(character: ExportableCharacter): Promise<void> {
    await exportService.exportCharacterAsJson({
      character: character.source,
      type: character.type,
    });
  }

  async exportCharacterAsPng(character: ExportableCharacter): Promise<void> {
    await exportService.exportCharacterAsPng({
      character: character.source,
      type: character.type,
    });
  }

  // ── Session exports ─────────────────────────────────────────────────

  async exportSessionAsEpub(session: ExportableSession): Promise<void> {
    await exportService.exportSessionAsEpub({ session });
  }

  // ── Bulk backup ─────────────────────────────────────────────────────

  async exportBulkBackup(): Promise<void> {
    await exportService.exportBulkBackup();
  }

  formatDate(timestamp: unknown): string {
    if (!timestamp) {
      return '—';
    }
    if (timestamp instanceof Date) {
      return timestamp.toLocaleDateString();
    }
    if (
      typeof timestamp === 'object' &&
      timestamp !== null &&
      'toDate' in timestamp &&
      typeof (timestamp as { toDate: () => Date }).toDate === 'function'
    ) {
      return (timestamp as { toDate: () => Date }).toDate().toLocaleDateString();
    }
    return '—';
  }

  // ── Internal ────────────────────────────────────────────────────────

  async _loadData(): Promise<void> {
    const [chats, exportableCharacters, sessions] = await Promise.all([
      this._loadChats(),
      this._loadCharacters(),
      this._loadSessions(),
    ]);
    this.chats = chats;
    this.characters = exportableCharacters;
    this.sessions = sessions;
  }

  async _loadChats(): Promise<ChatData[]> {
    try {
      return await exportService.listChats();
    } catch (error) {
      this.error('_loadChats failed', error);
      return [];
    }
  }

  async _loadCharacters(): Promise<ExportableCharacter[]> {
    try {
      const raw = await exportService.listExportableCharacters();
      return raw.map((source) => {
        const isPersona = 'uid' in source && !('faction' in source);
        return {
          id: ((source as Record<string, unknown>).id as string) || '',
          name: ((source as Record<string, unknown>).name as string) || 'Unnamed',
          type: isPersona ? ('persona' as const) : ('npc' as const),
          avatarUrl: (source as NpcData).avatarUrl,
          source,
        };
      });
    } catch (error) {
      this.error('_loadCharacters failed', error);
      return [];
    }
  }

  async _loadSessions(): Promise<ExportableSession[]> {
    try {
      return exportService.listCompletedSessions();
    } catch (error) {
      this.error('_loadSessions failed', error);
      return [];
    }
  }
}

export const getExportViewModel = (options: ExportViewModelOptions): ExportViewModelInterface =>
  ExportViewModel.create(options);
