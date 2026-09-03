// apps/frontend/client/src/lib/views/settings/export/export_view_model.svelte.ts
//
// C-464 AC-8: Export & Data settings tab — export operations, offline mode,
// telemetry opt-out, and delete local data.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { ChatData, NpcData, PersonaData } from '@aikami/types';
import { exportService } from '$services';
import type { GameSession } from '$types';

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

  // ── Privacy toggles (C-464 AC-8) ──
  /** Offline mode — when true, no AI calls are attempted. */
  readonly offlineMode: boolean;
  /** Telemetry opt-out. */
  readonly telemetryOptOut: boolean;

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

  // ── Privacy actions (C-464 AC-8) ──
  toggleOfflineMode(): void;
  toggleTelemetry(): void;

  // ── Delete local data (C-464 AC-7) ──
  readonly isDeleteLocalDialogOpen: boolean;
  readonly deleteLocalConfirmText: string;
  readonly isDeletingLocal: boolean;
  openDeleteLocalDialog(): void;
  closeDeleteLocalDialog(): void;
  updateDeleteLocalConfirmText(value: string): void;
  confirmDeleteLocalData(): Promise<void>;
}
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

  // ── Privacy toggles (C-464 AC-8) ──
  offlineMode = $state<boolean>(false);
  telemetryOptOut = $state<boolean>(false);

  // ── Delete local data (C-464 AC-7) ──
  isDeleteLocalDialogOpen = $state(false);
  deleteLocalConfirmText = $state('');
  isDeletingLocal = $state(false);

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
      return '\u2014';
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
    return '\u2014';
  }

  // ── Privacy actions (C-464 AC-8) ──

  toggleOfflineMode(): void {
    this.offlineMode = !this.offlineMode;
    this._persistPrivacySettings();
    this.debug('toggleOfflineMode', { offlineMode: this.offlineMode });
  }

  toggleTelemetry(): void {
    this.telemetryOptOut = !this.telemetryOptOut;
    this._persistPrivacySettings();
    this.debug('toggleTelemetry', { telemetryOptOut: this.telemetryOptOut });
  }

  // ── Delete local data (C-464 AC-7) ──

  openDeleteLocalDialog(): void {
    this.deleteLocalConfirmText = '';
    this.isDeleteLocalDialogOpen = true;
  }

  closeDeleteLocalDialog(): void {
    this.isDeleteLocalDialogOpen = false;
    this.deleteLocalConfirmText = '';
  }

  updateDeleteLocalConfirmText(value: string): void {
    this.deleteLocalConfirmText = value;
  }

  async confirmDeleteLocalData(): Promise<void> {
    if (this.deleteLocalConfirmText !== 'DELETE') {
      return;
    }
    this.isDeletingLocal = true;
    try {
      localStorage.clear();
      window.location.reload();
    } catch (error) {
      this.error('confirmDeleteLocalData', error);
    } finally {
      this.isDeletingLocal = false;
    }
  }


  private _persistPrivacySettings(): void {
      localStorage.setItem(
        'aikami_ai_privacy_settings',
        JSON.stringify({
          offlineMode: this.offlineMode,
          telemetryOptOut: this.telemetryOptOut,
        }),
      );
    } catch {
      // localStorage may be unavailable
    }
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

    // Load persisted privacy settings (C-464 AC-8: keep the same key)
    this._loadPrivacySettings();
  }

  private _loadPrivacySettings(): void {
    try {
      const stored = localStorage.getItem('aikami_ai_privacy_settings');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (typeof parsed.offlineMode === 'boolean') {
          this.offlineMode = parsed.offlineMode;
        }
        if (typeof parsed.telemetryOptOut === 'boolean') {
          this.telemetryOptOut = parsed.telemetryOptOut;
        }
      }
    } catch {
      // Invalid stored data — keep defaults
    }
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
